#include "hardware.h"
#include "configuracion.h"
#include "encoder_medicion.h"
#include <math.h>
#include "driver/gpio.h"
#include "driver/gptimer.h"
#include "esp_attr.h"
#include "driver/mcpwm_prelude.h"
#include "esp_err.h"
#include "esp_rom_sys.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "sdkconfig.h"

#if !CONFIG_IDF_TARGET_ESP32
#error "Seleccionar el target esp32 (ESP32-WROOM-32D)."
#endif

#define ECO_TIMEOUT_US 10000
#define SERVO_PERIODO_US 20000
#define STEP_RELOJ_HZ 10000000U

static portMUX_TYPE mutex = portMUX_INITIALIZER_UNLOCKED;
static bool flanco_inductivo;
static portMUX_TYPE encoder_mutex = portMUX_INITIALIZER_UNLOCKED;
static encoder_medicion_t encoder;
static bool eco_pendiente;
static int64_t disparo_us;
static int64_t eco_subida_us;
static int eco_ancho_us;
static unsigned ultimo_mando_hz;
static unsigned frecuencia_step;
static gptimer_handle_t step_timer;
static bool timer_en_marcha;
static portMUX_TYPE step_mutex = portMUX_INITIALIZER_UNLOCKED;
static volatile bool step_habilitado, step_alto;
static float servo_grados = SERVO_CENTRO_GRADOS;
static float servo_objetivo_grados = SERVO_CENTRO_GRADOS;
static uint32_t ultimo_pulso_servo;
static mcpwm_cmpr_handle_t servo_comparador;
static int64_t servo_centro_desde_us;
static int64_t servo_inicio_us;

static void isr_inductivo(void *arg)
{
    portENTER_CRITICAL_ISR(&mutex);
    flanco_inductivo = true;
    portEXIT_CRITICAL_ISR(&mutex);
}

bool inductivo_consumir_flanco(void)
{
    portENTER_CRITICAL(&mutex);
    bool detectado = flanco_inductivo;
    flanco_inductivo = false;
    portEXIT_CRITICAL(&mutex);
    return detectado;
}

bool inductivo_activo(void)
{
    return gpio_get_level(PIN_INDUCTIVO) == 0;
}

static void isr_encoder(void *arg)
{
    int64_t ahora = esp_timer_get_time();
    portENTER_CRITICAL_ISR(&encoder_mutex);
    encoder_medicion_senal(&encoder, ahora, gpio_get_level(PIN_ENCODER) != 0);
    portEXIT_CRITICAL_ISR(&encoder_mutex);
}

void encoder_reiniciar(void)
{
    portENTER_CRITICAL(&encoder_mutex);
    encoder_medicion_reiniciar(&encoder);
    portEXIT_CRITICAL(&encoder_mutex);
}

bool encoder_rpm_motor(float *rpm)
{
    portENTER_CRITICAL(&encoder_mutex);
    encoder_medicion_t copia = encoder;
    portEXIT_CRITICAL(&encoder_mutex);
    // Leer el reloj DESPUES del snapshot para no ver un flanco del futuro.
    *rpm = encoder_medicion_rpm(&copia, esp_timer_get_time());
    return isfinite(*rpm);
}

uint32_t encoder_rechazados(void)
{
    portENTER_CRITICAL(&encoder_mutex);
    uint32_t n = encoder.rechazados;
    portEXIT_CRITICAL(&encoder_mutex);
    return n;
}

static void isr_eco(void *arg)
{
    int64_t ahora = esp_timer_get_time();
    bool alto = gpio_get_level(PIN_ECHO);
    portENTER_CRITICAL_ISR(&mutex);
    if (eco_pendiente && ahora >= disparo_us && ahora - disparo_us <= ECO_TIMEOUT_US) {
        if (alto) {
            eco_subida_us = ahora;
        } else if (eco_subida_us > 0) {
            eco_ancho_us = (int)(ahora - eco_subida_us);
            eco_pendiente = false;
        }
    }
    portEXIT_CRITICAL_ISR(&mutex);
}

void ultrasonido_disparar(void)
{
    portENTER_CRITICAL(&mutex);
    disparo_us = esp_timer_get_time();
    eco_pendiente = true;
    eco_subida_us = 0;
    eco_ancho_us = 0;
    portEXIT_CRITICAL(&mutex);
    gpio_set_level(PIN_TRIG, 1);
    esp_rom_delay_us(10);
    gpio_set_level(PIN_TRIG, 0);
}

float ultrasonido_leer_cm(void)
{
    portENTER_CRITICAL(&mutex);
    int ancho_us = eco_ancho_us;
    portEXIT_CRITICAL(&mutex);
    return ancho_us > 0 ? ancho_us * 0.0343f * 0.5f : NAN;
}

static float pulso_servo(float grados)
{
    grados += SERVO_AJUSTE_GRADOS;
    grados = fminf(180.0f, fmaxf(0.0f, grados));
    return SERVO_PULSO_MIN_US +
           grados * ((SERVO_PULSO_MAX_US - SERVO_PULSO_MIN_US) / 180.0f);
}

void servo_posicionar(bool desviar)
{
    int grados = SERVO_CENTRO_GRADOS;
    if (desviar) grados += SERVO_INVERTIR ? -SERVO_DESVIO_GRADOS : SERVO_DESVIO_GRADOS;
    servo_objetivo_grados = grados;
    if (desviar) servo_centro_desde_us = 0;
}

void servo_actualizar(float dt_s)
{
    const float delta = SERVO_VELOCIDAD_GRADOS_S *
                        fminf(ACTUADORES_PERIODO_MS / 1000.0f, fmaxf(0.0f, dt_s));
    float diferencia = servo_objetivo_grados - servo_grados;
    servo_grados += fminf(delta, fmaxf(-delta, diferencia));
    uint32_t pulso_us = (uint32_t)lroundf(pulso_servo(servo_grados));
    if (pulso_us != ultimo_pulso_servo) {
        // MCPWM aplica el comparador al inicio del siguiente periodo, sin esperar
        // el fin de un ciclo PWM dentro de una seccion critica de LEDC.
        ESP_ERROR_CHECK(mcpwm_comparator_set_compare_value(servo_comparador, pulso_us));
        ultimo_pulso_servo = pulso_us;
    }
    // El periferico mantiene los pulsos a 50 Hz aunque no cambie la posicion.
    if (servo_objetivo_grados == SERVO_CENTRO_GRADOS &&
        fabsf(servo_grados - SERVO_CENTRO_GRADOS) < 0.01f) {
        if (!servo_centro_desde_us) servo_centro_desde_us = esp_timer_get_time();
    } else {
        servo_centro_desde_us = 0;
    }
}

bool servo_centro_listo(void)
{
    // Confirma la consigna y el tiempo de asentamiento; el MG996R no devuelve posicion.
    return esp_timer_get_time() - servo_inicio_us >= SERVO_PREPARACION_MS * 1000LL &&
           servo_centro_desde_us > 0 &&
           esp_timer_get_time() - servo_centro_desde_us >= SERVO_ESTABILIZACION_MS * 1000LL;
}

unsigned servo_pulso_us(void)
{
    return (unsigned)ultimo_pulso_servo;
}

static bool IRAM_ATTR step_alarma(gptimer_handle_t timer, const gptimer_alarm_event_data_t *evento, void *arg)
{
    (void)timer; (void)evento; (void)arg;
    portENTER_CRITICAL_ISR(&step_mutex);
    if (step_habilitado) { step_alto = !step_alto; gpio_set_level(PIN_STEP, step_alto); }
    portEXIT_CRITICAL_ISR(&step_mutex);
    return false;
}

static void detener_step(void)
{
    portENTER_CRITICAL(&step_mutex);
    step_habilitado = step_alto = false;
    gpio_set_level(PIN_STEP, 0);
    portEXIT_CRITICAL(&step_mutex);
    if (timer_en_marcha) { ESP_ERROR_CHECK(gptimer_stop(step_timer)); timer_en_marcha = false; }
    ultimo_mando_hz = frecuencia_step = 0;
}

unsigned motor_aplicar(unsigned hz)
{
    if (hz > 0 && hz < STEP_MIN_HZ) hz = STEP_MIN_HZ;
    if (hz > STEP_MAX_HZ) hz = STEP_MAX_HZ;
    if (!hz) {
        if (timer_en_marcha) detener_step();
        return 0;
    }
    if (hz == ultimo_mando_hz) return frecuencia_step;
    // Lab 1: dos alarmas por pulso, sin reiniciar el contador en marcha.
    uint64_t mitad = STEP_RELOJ_HZ / (2ULL * hz);
    gptimer_alarm_config_t alarma = {.alarm_count = mitad, .reload_count = 0,
                                    .flags.auto_reload_on_alarm = true};
    ESP_ERROR_CHECK(gptimer_set_alarm_action(step_timer, &alarma));
    if (!timer_en_marcha) {
        ESP_ERROR_CHECK(gptimer_set_raw_count(step_timer, 0));
        portENTER_CRITICAL(&step_mutex); step_habilitado = true; portEXIT_CRITICAL(&step_mutex);
        ESP_ERROR_CHECK(gptimer_start(step_timer)); timer_en_marcha = true;
    }
    ultimo_mando_hz = hz;
    frecuencia_step = (unsigned)((STEP_RELOJ_HZ + mitad) / (2 * mitad));
    return frecuencia_step;
}

static void instalar_entrada(int pin, gpio_int_type_t interrupcion,
                             gpio_pullup_t pullup, gpio_isr_t callback)
{
    gpio_config_t entrada = {
        .pin_bit_mask = 1ULL << pin,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = pullup,
        .intr_type = interrupcion
    };
    ESP_ERROR_CHECK(gpio_config(&entrada));
    ESP_ERROR_CHECK(gpio_isr_handler_add(pin, callback, NULL));
}

static void iniciar_step(void)
{
    gptimer_config_t temporizador = {.clk_src = GPTIMER_CLK_SRC_DEFAULT,
        .direction = GPTIMER_COUNT_UP, .resolution_hz = STEP_RELOJ_HZ};
    ESP_ERROR_CHECK(gptimer_new_timer(&temporizador, &step_timer));
    gptimer_event_callbacks_t callbacks = {.on_alarm = step_alarma};
    ESP_ERROR_CHECK(gptimer_register_event_callbacks(step_timer, &callbacks, NULL));
    ESP_ERROR_CHECK(gptimer_enable(step_timer));
}

static void iniciar_servo(void)
{
    // Un tick equivale a un microsegundo; 20000 ticks producen 50 Hz.
    // Estos objetos permanecen asignados durante toda la vida del firmware.
    mcpwm_timer_handle_t timer;
    mcpwm_timer_config_t temporizador = {
        .group_id = 0,
        .clk_src = MCPWM_TIMER_CLK_SRC_DEFAULT,
        .resolution_hz = 1000000,
        .count_mode = MCPWM_TIMER_COUNT_MODE_UP,
        .period_ticks = SERVO_PERIODO_US
    };
    ESP_ERROR_CHECK(mcpwm_new_timer(&temporizador, &timer));

    mcpwm_oper_handle_t operador;
    mcpwm_operator_config_t operacion = { .group_id = 0 };
    ESP_ERROR_CHECK(mcpwm_new_operator(&operacion, &operador));
    ESP_ERROR_CHECK(mcpwm_operator_connect_timer(operador, timer));

    mcpwm_comparator_config_t comparador = { .flags.update_cmp_on_tez = true };
    ESP_ERROR_CHECK(mcpwm_new_comparator(operador, &comparador, &servo_comparador));
    mcpwm_gen_handle_t generador;
    mcpwm_generator_config_t salida = { .gen_gpio_num = PIN_SERVO };
    ESP_ERROR_CHECK(mcpwm_new_generator(operador, &salida, &generador));

    ultimo_pulso_servo = (uint32_t)lroundf(pulso_servo(SERVO_CENTRO_GRADOS));
    ESP_ERROR_CHECK(mcpwm_comparator_set_compare_value(servo_comparador, ultimo_pulso_servo));
    ESP_ERROR_CHECK(mcpwm_generator_set_action_on_timer_event(generador,
        MCPWM_GEN_TIMER_EVENT_ACTION(MCPWM_TIMER_DIRECTION_UP, MCPWM_TIMER_EVENT_EMPTY, MCPWM_GEN_ACTION_HIGH)));
    ESP_ERROR_CHECK(mcpwm_generator_set_action_on_compare_event(generador,
        MCPWM_GEN_COMPARE_EVENT_ACTION(MCPWM_TIMER_DIRECTION_UP, servo_comparador, MCPWM_GEN_ACTION_LOW)));
    ESP_ERROR_CHECK(mcpwm_timer_enable(timer));
    ESP_ERROR_CHECK(mcpwm_timer_start_stop(timer, MCPWM_TIMER_START_NO_STOP));
    servo_inicio_us = esp_timer_get_time();
}

void hardware_iniciar(void)
{
    ESP_ERROR_CHECK(gpio_set_level(PIN_EN, 1));
    gpio_config_t salidas = {
        .pin_bit_mask = (1ULL << PIN_EN) | (1ULL << PIN_DIR) | (1ULL << PIN_MS1) |
                        (1ULL << PIN_MS2) | (1ULL << PIN_TRIG) | (1ULL << PIN_STEP),
        .mode = GPIO_MODE_OUTPUT
    };
    ESP_ERROR_CHECK(gpio_config(&salidas));
    ESP_ERROR_CHECK(gpio_set_level(PIN_EN, 1));
    ESP_ERROR_CHECK(gpio_set_level(PIN_DIR, 1));
    ESP_ERROR_CHECK(gpio_set_level(PIN_STEP, 0));
    ESP_ERROR_CHECK(gpio_set_level(PIN_MS1, 0));
    ESP_ERROR_CHECK(gpio_set_level(PIN_MS2, 0));
    ESP_ERROR_CHECK(gpio_set_level(PIN_TRIG, 0));

    iniciar_step();
    iniciar_servo();
    ESP_ERROR_CHECK(gpio_install_isr_service(0));
    instalar_entrada(PIN_ENCODER, GPIO_INTR_ANYEDGE, GPIO_PULLUP_ENABLE, isr_encoder);
    instalar_entrada(PIN_INDUCTIVO, GPIO_INTR_NEGEDGE, GPIO_PULLUP_DISABLE, isr_inductivo);
    instalar_entrada(PIN_ECHO, GPIO_INTR_ANYEDGE, GPIO_PULLUP_DISABLE, isr_eco);
#if !PRUEBA_SOLO_SERVO
    // TMC2208 como en Lab 1: habilitado en reposo, STEP detenido. Evita
    // apagar/reencender las bobinas en cada parada y cambio de sentido.
    ESP_ERROR_CHECK(gpio_set_level(PIN_EN, 0));
#endif
}

void motor_direccion(bool adelante)
{
    // STEP bajo antes de DIR; EN permanece activo como en el montaje original.
    detener_step();
    ESP_ERROR_CHECK(gpio_set_level(PIN_DIR,adelante?1:0));
    esp_rom_delay_us(10);
}
float servo_angulo_ordenado(void) { return fabsf(servo_grados-SERVO_CENTRO_GRADOS); }
