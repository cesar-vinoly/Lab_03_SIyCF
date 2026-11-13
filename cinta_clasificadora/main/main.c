#include "clasificacion.h"
#include "configuracion.h"
#include "hardware.h"
#include "velocidad.h"
#include "captura.h"
#include "red.h"
#include "tiny_ia.h"
#include "lab03_runtime.h"
#include "seguridad.h"
#include <math.h>
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

/* Todo el estado mutable de actuacion pertenece a CPU1. */
static const char *TAG="cinta";
#if !PRUEBA_SOLO_SERVO
static ciclo_t ciclo;
static velocidad_t velocidad;
static lab_seguridad_t seguridad;
static bool automatico, ensayo_manual, valida, bajo;
static int direccion;
static unsigned porcentaje=50, hz;
static float cm=NAN, medida, integral_step, intervalo;
static uint32_t ensayo_orden, objeto, episodio=0x40000000;
static int64_t ensayo_inicio_ms, ultimo_log_ms;

static void evento(lab_evento_t e,int64_t t,float valor,int64_t plazo)
{ lab03_evento(e,objeto?objeto:episodio,t,valor,plazo); }

static void detener(void)
{
    hz=motor_aplicar(0); direccion=0; automatico=false;
    ciclo_iniciar(&ciclo); velocidad_iniciar(&velocidad);
    captura_reiniciar(); servo_posicionar(false);
    integral_step=intervalo=0; ensayo_inicio_ms=0;
}

static void fallar(int64_t ahora)
{
    if (seguridad.enclavada) return;
    ++episodio;
    lab_seguridad_paso(&seguridad,true,false,ahora);
    evento(LAB_FALLA_EVENTO,ahora,NAN,200000);
    detener(); evento(LAB_MOTOR_ORDEN_PARAR,ahora,0,200000); evento(LAB_ALARMA,ahora,1,200000);
    // No emitir motor_detenido sin feedback fisico de parada.
}

static void aplicar_orden(const lab_orden_t *o,int64_t ahora)
{
    const char *error=NULL;
    if (o->accion==LAB_E) fallar(ahora);
    else if (o->accion==LAB_S) { detener(); evento(LAB_MOTOR_ORDEN_PARAR,ahora,0,200000); }
    else if (!lab03_enlace_vigente()) error="enlace vencido";
    else if (o->accion==LAB_RESET) {
        detener(); lab_seguridad_paso(&seguridad,false,true,ahora); evento(LAB_EVENTO_REARME,ahora,0,0);
    } else if (seguridad.enclavada) error="rearmar antes de mover";
    else if (ensayo_manual) error="salir del ensayo en el panel de capturas";
    else if (o->accion==LAB_AUTO) { detener(); motor_direccion(true); automatico=o->valor!=0; }
    else if (automatico) error="desactivar clasificacion automatica";
    else if (o->accion==LAB_V) { porcentaje=o->valor; if (!porcentaje) detener(); }
    else if (!servo_centro_listo()) error="esperar servo centrado";
    else if (!porcentaje) error="seleccionar velocidad mayor a cero";
    else {
        const int nueva=o->accion==LAB_F?1:-1;
        if (direccion && direccion!=nueva) error="detener antes de invertir";
        else if (!direccion) {
            motor_direccion(nueva==1); encoder_reiniciar(); velocidad_iniciar(&velocidad); direccion=nueva;
        }
    }
    lab03_responder(o,error==NULL,error?error:"aplicada por control");
}

static esp_err_t iniciar_control(void)
{
    hardware_iniciar(); ciclo_iniciar(&ciclo); velocidad_iniciar(&velocidad);
    tiny_iniciar(); ultrasonido_disparar();
    ESP_LOGI(TAG,"DIRECTO detenido al iniciar. Automatico solo con check del gemelo.");
    ESP_LOGI(TAG,"TMC2208 1/%d | directo 100%%=%.0f RPM | STEP GPTimer | ajuste servo=%d grados",
        MOTOR_MICROPASOS,(double)DIRECTO_MAX_RPM,SERVO_AJUSTE_GRADOS);
    ESP_LOGI(TAG,"Control/TS CPU1; IA/WiFi/WS CPU0. TS %.0f ms; servo %d grados a %.1f cm",
        (double)(TS1_ECONOMICO_TS*1000),SERVO_DESVIO_GRADOS,(double)DISTANCIA_EMPUJE_METAL_CM);
    return ESP_OK;
}

static void paso_control(int64_t ahora_us,float dt_s,bool muestrear,lab_snapshot_t *s)
{
    const int64_t ahora_ms=ahora_us/1000;
    if (!lab03_enlace_vigente() && (automatico || direccion || hz)) fallar(ahora_us);
    lab_orden_t mando;
    while (lab03_orden(&mando)) aplicar_orden(&mando,ahora_us);
    ensayo_orden_t orden;
    if (red_orden_ensayo(&orden)) {
        if (orden.manual!=ensayo_manual) {
            detener(); ensayo_manual=orden.manual;
            ESP_LOGW(TAG,"Modo %s",ensayo_manual?"ENSAYO: cinta detenida":"DIRECTO detenido");
        }
        if (ensayo_manual && !seguridad.enclavada && orden.orden>ensayo_orden &&
            !ensayo_inicio_ms && captura_lista() && servo_centro_listo()) {
            ensayo_orden=orden.orden; ensayo_inicio_ms=ahora_ms+ENSAYO_PREPARACION_MS;
        }
    }
    if (hz) { integral_step+=hz*dt_s; intervalo+=dt_s; }
    if (muestrear) {
        if (intervalo>0) ts1_economico_paso(&velocidad.modelo,integral_step/intervalo);
        integral_step=intervalo=0;
        cm=ultrasonido_leer_cm(); ultrasonido_disparar();
        bajo=inductivo_activo(); bool flanco=inductivo_consumir_flanco();
        estado_t anterior=ciclo.estado; bool desvio_anterior=ciclo.desviar_servo;
        if (automatico && !ensayo_manual && !seguridad.enclavada)
            ciclo_actualizar(&ciclo,ahora_ms,cm,flanco,bajo,servo_centro_listo());
        bool nuevo=(anterior==ESPERA || anterior==REARME) &&
            (ciclo.estado==CLASIFICANDO || ciclo.estado==POSICIONANDO);
        bool cancelada=(anterior==CLASIFICANDO && ciclo.estado==ESPERA) ||
            (anterior==POSICIONANDO && ciclo.estado==REARME);
        if (ciclo.estado!=anterior) {
            if (ciclo.estado==TRANSPORTANDO) {
                motor_direccion(true); direccion=1; encoder_reiniciar(); velocidad_iniciar(&velocidad);
            } else if (ciclo.estado==REARME) {
                hz=motor_aplicar(0); direccion=0;
                evento(LAB_MOTOR_ORDEN_PARAR,ahora_us,0,200000);
                if (anterior==TRANSPORTANDO) {
                    evento(LAB_FIN_CICLO,ahora_us,ciclo.parada_por_perdida?0:1,0);
                    if (ciclo.parada_por_perdida) evento(LAB_ALARMA,ahora_us,2,0);
                }
            }
        }
        servo_posicionar(ciclo.desviar_servo);
        valida=encoder_rpm_motor(&medida);
        if (automatico && ciclo.estado==TRANSPORTANDO) velocidad_actualizar(&velocidad,medida,valida);
        muestra_t muestra={.t_ms=ahora_ms,.dist_cm=cm,.inductivo=bajo,.flanco=flanco,
            .step_hz=hz,.rpm_motor=valida?medida:NAN,.rpm_ts=hz?velocidad.modelo.y:0,
            .servo_us=servo_pulso_us(),.estado=ciclo.estado,.empuje=ciclo.desviar_servo};
        if (ensayo_manual && ensayo_inicio_ms && ahora_ms>=ensayo_inicio_ms) {
            captura_manual(ensayo_orden); ensayo_inicio_ms=0;
        }
        captura_actualizar(automatico && nuevo,ensayo_manual?bajo:ciclo.metal,
            automatico && cancelada,&muestra);
        if (nuevo) { objeto=captura_id(); evento(LAB_OBJETO,ahora_us,cm,0); }
        if (ciclo.estado==POSICIONANDO && anterior!=POSICIONANDO)
            evento(ciclo.metal?LAB_DECISION_A:LAB_DECISION_B,ahora_us,cm,0);
        if (cancelada) evento(LAB_DUDOSO,ahora_us,cm,0);
        if (desvio_anterior!=ciclo.desviar_servo)
            evento(LAB_SERVO_ORDEN,ahora_us,ciclo.desviar_servo?SERVO_DESVIO_GRADOS:0,0);
    }
    servo_actualizar(dt_s);
    bool marcha=!ensayo_manual && !seguridad.enclavada && lab03_enlace_vigente() &&
        (automatico?ciclo.estado==TRANSPORTANDO:direccion!=0);
    if (marcha) {
        unsigned objetivo=automatico?velocidad_rampa(&velocidad,dt_s):velocidad_directa(&velocidad,porcentaje,dt_s);
        hz=motor_aplicar(objetivo); velocidad_aplicada(&velocidad,hz);
    } else hz=motor_aplicar(0);
    red_estado_ensayo(ensayo_manual,ensayo_manual && !seguridad.enclavada && !ensayo_inicio_ms &&
        captura_lista() && servo_centro_listo(),ensayo_inicio_ms || captura_ocupada(),
        ensayo_inicio_ms>ahora_ms?(unsigned)(ensayo_inicio_ms-ahora_ms):0,ensayo_orden,captura_registro_restante_ms());
    *s=(lab_snapshot_t){.rpm_motor=valida?medida:NAN,.rpm_ts=hz?velocidad.modelo.y:0,
        .setpoint_rpm=automatico?CONSIGNA_MOTOR_RPM:DIRECTO_MAX_RPM*porcentaje/100.0f,.dist_cm=cm,.pos_m=NAN,.pos_real_m=NAN,
        .step_hz=hz,.servo_us=servo_pulso_us(),.servo_grados=servo_angulo_ordenado(),
        .manual=!automatico,.automatico=automatico,.emergencia=seguridad.enclavada,
        .ensayo=ensayo_manual,.capturando=ensayo_inicio_ms || captura_ocupada(),
        .metal=bajo,.encoder_valido=valida,.direccion=marcha?direccion:0,.porcentaje=porcentaje,
        .encoder_rechazados=encoder_rechazados(),.objeto=objeto,
        .estado=seguridad.enclavada?LAB_FALLA:(automatico?(lab_estado_t)ciclo.estado:(marcha?LAB_TRANSPORTANDO:LAB_ESPERA))};
    if (ahora_ms-ultimo_log_ms>=1000) {
        ESP_LOGI(TAG,"modo=%s estado=%d | dist_cm=%.1f metal=%d STEP=%u Hz RPM_motor=%.1f valida=%d RPM_TS=%.1f servo=%.1f WS=%s emergencia=%d",
            ensayo_manual?"ENSAYO":automatico?"AUTO":"DIRECTO",ciclo.estado,(double)cm,bajo,hz,
            (double)(valida?medida:NAN),valida,(double)s->rpm_ts,(double)s->servo_grados,
            lab03_enlace_vigente()?"activo":"sin permiso",seguridad.enclavada);
        ultimo_log_ms=ahora_ms;
    }
}

#endif

void app_main(void)
{
#if PRUEBA_SOLO_SERVO
    hardware_iniciar(); ESP_LOGW(TAG,"PRUEBA SOLO SERVO: sin motor ni red");
    for (;;) {
        servo_posicionar((esp_timer_get_time()/3000000)%2);
        servo_actualizar(ACTUADORES_PERIODO_MS/1000.0f);
        vTaskDelay(pdMS_TO_TICKS(ACTUADORES_PERIODO_MS));
    }
#else
    red_iniciar();
    lab_hooks_t hooks={.iniciar_control=iniciar_control,.paso_control=paso_control,.parar=detener,
        .red_lista=red_lista,.ws_uri=red_gemelo_uri(),.device_id=red_device_id(),.boot_id=red_boot_id()};
    ESP_LOGI(TAG,"Gemelo: %s",hooks.ws_uri); ESP_ERROR_CHECK(lab03_iniciar(&hooks));
#endif
}
