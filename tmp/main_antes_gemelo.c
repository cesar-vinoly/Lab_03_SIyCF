#include "clasificacion.h"
#include "configuracion.h"
#include "hardware.h"
#include "velocidad.h"
#include "captura.h"
#include "red.h"
#include "tiny_ia.h"
#include <math.h>
#include <stdio.h>
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "cinta";

static const char *nombre_estado(estado_t estado)
{
    static const char *const nombres[] = {
        "ESPERA", "CLASIFICANDO", "POSICIONANDO", "TRANSPORTANDO", "REARME"
    };
    return nombres[estado];
}

void app_main(void)
{
    hardware_iniciar();
    ESP_LOGI(TAG, "Servo: MCPWM 50 Hz en GPIO%d; STEP: LEDC en GPIO%d", PIN_SERVO, PIN_STEP);

#if PRUEBA_SOLO_SERVO
    // Prueba optativa de alimentacion, pulso y mecanica, sin arrancar la cinta.
    ESP_LOGW(TAG, "PRUEBA SOLO SERVO: motor y Wi-Fi deshabilitados. Centro/desvio cada 3 s.");
    TickType_t prueba_proxima = xTaskGetTickCount();
    const TickType_t prueba_periodo = pdMS_TO_TICKS(ACTUADORES_PERIODO_MS);
    configASSERT(prueba_periodo > 0);
    int64_t prueba_cambio_ms = esp_timer_get_time() / 1000;
    bool prueba_desviar = false;
    for (;;) {
        xTaskDelayUntil(&prueba_proxima, prueba_periodo);
        int64_t prueba_ahora_ms = esp_timer_get_time() / 1000;
        if (prueba_ahora_ms - prueba_cambio_ms >= 3000) {
            prueba_desviar = !prueba_desviar;
            servo_posicionar(prueba_desviar);
            prueba_cambio_ms = prueba_ahora_ms;
            ESP_LOGI(TAG, "Servo hacia %s; pulso previo=%u us",
                     prueba_desviar ? "DESVIO" : "CENTRO", servo_pulso_us());
        }
        servo_actualizar(ACTUADORES_PERIODO_MS / 1000.0f);
    }
#endif

    // Prioridad superior al emisor HTTP; ninguna llamada de red ocurre en este bucle.
    vTaskPrioritySet(NULL, 5);
    red_iniciar();
    tiny_iniciar();
    ciclo_t ciclo;
    ciclo_iniciar(&ciclo);
    velocidad_t velocidad;
    velocidad_iniciar(&velocidad);

    ESP_LOGI(TAG, "Lista. Motor parado, servo %d grados, consigna motor %.1f RPM, base TS %.0f Hz",
             SERVO_CENTRO_GRADOS, (double)CONSIGNA_MOTOR_RPM, (double)velocidad.base_hz);
    ESP_LOGI(TAG, "Empuje metalico al alcanzar %.1f cm; desvio %d grados",
             (double)DISTANCIA_EMPUJE_METAL_CM, SERVO_DESVIO_GRADOS);
    ESP_LOGI(TAG, "Espera de colocacion: %d ms desde la presencia confirmada", ESPERA_CLASIFICACION_MS);
    ESP_LOGI(TAG, "Encoder: media de hasta %d periodos; minimo %d; flancos < %lld us invalidan lectura",
             ENCODER_VENTANA_PERIODOS, ENCODER_MIN_PERIODOS, (long long)ENCODER_PERIODO_MIN_US);
    ESP_LOGI(TAG, "No metalicos: recuperar eco hasta %d ms antes de %.1f cm; zona de salida requiere %d ecos",
             RECUPERACION_ECO_NO_METAL_MS, (double)DISTANCIA_SALIDA_NO_METAL_CM, MUESTRAS_ZONA_SALIDA);
    if (DISTANCIA_SEGUIMIENTO_MAX_CM > 0.0f) {
        ESP_LOGI(TAG, "Ultrasonido: entrada <= %.1f cm; seguimiento < %.1f cm; parada tras %d ausencias",
                 (double)DISTANCIA_ENTRADA_CM, (double)DISTANCIA_SEGUIMIENTO_MAX_CM, MUESTRAS_FIN_TRANSPORTE);
    } else {
        ESP_LOGI(TAG, "Ultrasonido: entrada <= %.1f cm; seguimiento por eco valido sin corte superior; parada tras %d ausencias",
                 (double)DISTANCIA_ENTRADA_CM, MUESTRAS_FIN_TRANSPORTE);
    }
    const TickType_t periodo = pdMS_TO_TICKS(ACTUADORES_PERIODO_MS);
    configASSERT(periodo > 0);
    const int64_t periodo_control_us = lroundf(1000000.0f * TS1_ECONOMICO_TS);
    TickType_t proxima = xTaskGetTickCount();
    int64_t ultimo_log_ms = 0;
    int64_t anterior_us = esp_timer_get_time();
    int64_t proximo_control_us = anterior_us + periodo_control_us;
    float integral_step_hz_s = 0.0f;
    float intervalo_modelo_s = 0.0f;
    float cm = NAN;
    float medida = 0.0f;
    bool valida = false;
    bool bajo = false;
    unsigned hz = 0;
    bool ensayo_manual = false;
    uint32_t ensayo_orden = 0;
    int64_t ensayo_inicio_ms = 0;
    ultrasonido_disparar();
    for (;;) {
        xTaskDelayUntil(&proxima, periodo);
        int64_t ahora_us = esp_timer_get_time();
        int64_t ahora_ms = ahora_us / 1000;
        float dt_s = (ahora_us - anterior_us) / 1000000.0f;
        anterior_us = ahora_us;

        ensayo_orden_t orden;
        if (red_orden_ensayo(&orden)) {
            if (orden.manual != ensayo_manual) {
                ensayo_manual = orden.manual;
                motor_aplicar(0);
                hz = 0;
                ciclo_iniciar(&ciclo);
                velocidad_iniciar(&velocidad);
                captura_reiniciar();
                servo_posicionar(false);
                integral_step_hz_s = intervalo_modelo_s = 0.0f;
                ensayo_inicio_ms = 0;
                ESP_LOGW(TAG, "Modo %s", ensayo_manual ? "ENSAYO MANUAL: cinta detenida" : "AUTOMATICO: deteccion habilitada");
            }
            if (ensayo_manual && orden.orden > ensayo_orden && !ensayo_inicio_ms &&
                captura_lista() && servo_centro_listo()) {
                ensayo_orden = orden.orden;
                ensayo_inicio_ms = ahora_ms + ENSAYO_PREPARACION_MS;
                ESP_LOGI(TAG, "Ensayo manual %lu: captura en %d ms", (unsigned long)ensayo_orden, ENSAYO_PREPARACION_MS);
            }
        }

        if (ciclo.estado == TRANSPORTANDO) {
            integral_step_hz_s += hz * dt_s;
            intervalo_modelo_s += dt_s;
        }

        // Sensores, clasificacion y PI conservan el periodo identificado de 100 ms.
        if (ahora_us >= proximo_control_us) {
            proximo_control_us += periodo_control_us;
            // Si hubo un retraso largo, no contar varias veces el mismo eco.
            if (proximo_control_us <= ahora_us) proximo_control_us = ahora_us + periodo_control_us;
            if (intervalo_modelo_s > 0.0f) {
                // Durante la rampa, aproximar la entrada del intervalo por su media.
                // En regimen es el STEP constante. El TS se evalua una sola vez.
                ts1_economico_paso(&velocidad.modelo, integral_step_hz_s / intervalo_modelo_s);
            }
            integral_step_hz_s = 0.0f;
            intervalo_modelo_s = 0.0f;
            cm = ultrasonido_leer_cm();
            ultrasonido_disparar();
            bajo = inductivo_activo();
            bool flanco = inductivo_consumir_flanco();
            estado_t anterior = ciclo.estado;
            bool desvio_anterior = ciclo.desviar_servo;
            bool recuperando_anterior = ciclo.recuperando_eco;
            if (!ensayo_manual) ciclo_actualizar(&ciclo, ahora_ms, cm, flanco, bajo, servo_centro_listo());

            if (ciclo.recuperando_eco && !recuperando_anterior) {
                ESP_LOGW(TAG, "Caja sin eco antes de salida; ultimo=%.1f cm; margen total=%d ms desde ultimo eco",
                         (double)ciclo.ultimo_eco_cm, RECUPERACION_ECO_NO_METAL_MS);
            } else if (recuperando_anterior && !ciclo.recuperando_eco && ciclo.estado == TRANSPORTANDO) {
                ESP_LOGI(TAG, "Eco recuperado en transporte: %.1f cm", (double)cm);
            }

            servo_posicionar(ciclo.desviar_servo);
            if (ciclo.desviar_servo && !desvio_anterior) {
                ESP_LOGI(TAG, "EMPUJE METALICO: dist_cm=%.1f; barrido de %d grados con cinta en marcha",
                         (double)cm, SERVO_DESVIO_GRADOS);
            } else if (!ciclo.desviar_servo && desvio_anterior) {
                ESP_LOGI(TAG, "Empuje terminado: servo hacia el centro");
            }

            if (ciclo.estado != anterior) {
                if (anterior == REARME && ciclo.estado != ESPERA) {
                    ESP_LOGI(TAG, "Presencia recuperada: nueva clasificacion (dist_cm=%.1f metal=%d)",
                             (double)cm, bajo);
                }
                if (ciclo.estado == POSICIONANDO) {
                    ESP_LOGI(TAG, "Pieza %s; arranque al confirmar servo centrado y eco valido",
                             ciclo.metal ? "METALICA" : "NO METALICA");
                } else if (ciclo.estado == TRANSPORTANDO) {
                    encoder_reiniciar();
                    velocidad_iniciar(&velocidad);
                } else if (ciclo.estado == REARME) {
                    // Detener la cinta; la logica del ciclo decide cuando retornar
                    // el servo para no interrumpir un empuje iniciado recientemente.
                    motor_aplicar(0);
                    if (ciclo.parada_por_perdida) {
                        ESP_LOGW(TAG, "Parada: eco perdido %lld ms antes de confirmar zona de salida; ultimo=%.1f cm. Revisar orientacion del ultrasonido",
                                 (long long)(ahora_ms - ciclo.ultimo_eco_ms), (double)ciclo.ultimo_eco_cm);
                    } else {
                        ESP_LOGW(TAG, "Parada desde %s: %d lecturas sin presencia (dist_cm=%.1f metal=%d zona_salida=%d)",
                                 nombre_estado(anterior),
                                 anterior == TRANSPORTANDO ? MUESTRAS_FIN_TRANSPORTE : MUESTRAS_AUSENCIA,
                                 (double)cm, bajo, ciclo.muestras_salida >= MUESTRAS_ZONA_SALIDA);
                    }
                }
                ESP_LOGI(TAG, "%s -> %s", nombre_estado(anterior), nombre_estado(ciclo.estado));
            }

            valida = encoder_rpm_motor(&medida);
            if (ciclo.estado == TRANSPORTANDO) velocidad_actualizar(&velocidad, medida, valida);
            bool nuevo_ciclo = (anterior == ESPERA || anterior == REARME) &&
                               (ciclo.estado == CLASIFICANDO || ciclo.estado == POSICIONANDO);
            bool cancelada = (anterior == CLASIFICANDO && ciclo.estado == ESPERA) ||
                             (anterior == POSICIONANDO && ciclo.estado == REARME);
            muestra_t muestra = {
                .t_ms = ahora_ms, .dist_cm = cm, .inductivo = bajo, .flanco = flanco,
                .step_hz = hz, .rpm_motor = valida ? medida : NAN,
                .rpm_ts = velocidad.modelo.y, .servo_us = servo_pulso_us(),
                .estado = ciclo.estado, .empuje = ciclo.desviar_servo,
            };
            if (ensayo_manual && ensayo_inicio_ms && ahora_ms >= ensayo_inicio_ms) {
                captura_manual(ensayo_orden);
                ensayo_inicio_ms = 0;
                ESP_LOGI(TAG, "Capturando ensayo manual %lu: 100 muestras en 10 s, una sola prueba", (unsigned long)ensayo_orden);
            }
            captura_actualizar(!ensayo_manual && nuevo_ciclo, ensayo_manual ? bajo : ciclo.metal,
                               !ensayo_manual && cancelada, &muestra);
        }

        servo_actualizar(dt_s);
        bool marcha = !ensayo_manual && ciclo.estado == TRANSPORTANDO;
        if (marcha) {
            hz = motor_aplicar(velocidad_rampa(&velocidad, dt_s));
            velocidad_aplicada(&velocidad, (float)hz);
        } else {
            hz = motor_aplicar(0);
        }
        red_estado_ensayo(ensayo_manual, ensayo_manual && !ensayo_inicio_ms && captura_lista() && servo_centro_listo(),
                         ensayo_inicio_ms || captura_ocupada(),
                         ensayo_inicio_ms > ahora_ms ? (unsigned)(ensayo_inicio_ms - ahora_ms) : 0, ensayo_orden,
                         captura_registro_restante_ms());

        if (ahora_ms - ultimo_log_ms >= 1000) {
            char distancia[16] = "sin_eco";
            char rpm[16] = "sin_lectura";
            if (isfinite(cm)) snprintf(distancia, sizeof(distancia), "%.1f", (double)cm);
            if (valida) snprintf(rpm, sizeof(rpm), "%.1f", (double)medida);
            ESP_LOGI(TAG, "%s | dist_cm=%s metal=%d | STEP=%u Hz RPM_motor=%s RPM_TS=%.1f servo_us=%u empuje=%d wifi=%s modo=%s enc_rech_ciclo=%lu recuperando_eco=%d",
                     nombre_estado(ciclo.estado), distancia, bajo, hz, rpm,
                     (double)(marcha ? velocidad.modelo.y : 0.0f), servo_pulso_us(), ciclo.desviar_servo, red_estado_texto(),
                     ensayo_manual ? "MANUAL" : "AUTO", (unsigned long)encoder_rechazados(), ciclo.recuperando_eco);
            ultimo_log_ms = ahora_ms;
        }
    }
}
