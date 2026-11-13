#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif
typedef enum { LAB_ESPERA, LAB_CLASIFICANDO, LAB_POSICIONANDO, LAB_TRANSPORTANDO,
               LAB_REARME, LAB_FALLA } lab_estado_t;
typedef enum { LAB_OBJETO, LAB_DECISION_A, LAB_DECISION_B, LAB_DUDOSO, LAB_SERVO_ORDEN,
    LAB_SERVO_CONFIRMADO, LAB_FALLA_EVENTO, LAB_MOTOR_ORDEN_PARAR, LAB_MOTOR_DETENIDO,
    LAB_ALARMA, LAB_FIN_CICLO, LAB_EVENTO_REARME } lab_evento_t;
typedef struct {
    float rpm_motor, rpm_ts, setpoint_rpm, dist_cm, pos_m, pos_real_m;
    unsigned step_hz, servo_us;
    bool manual, metal, encoder_valido;
    bool automatico, emergencia, ensayo, capturando;
    int direccion;
    unsigned porcentaje, encoder_rechazados, objeto;
    float servo_grados;
    lab_estado_t estado;
} lab_snapshot_t;
typedef struct { bool activa, dudosa; int clase; float voto; } lab_ia_t;
typedef enum { LAB_F, LAB_R, LAB_S, LAB_E, LAB_V, LAB_AUTO, LAB_RESET } lab_accion_t;
typedef struct { uint32_t id, generacion; lab_accion_t accion; int valor; } lab_orden_t;
typedef struct {
    /* Se ejecuta en CPU1: hardware/ISR y estado privados del control. No HTTP. */
    esp_err_t (*iniciar_control)(void);
    /* Paso 20 ms. Actualizar sensores/PI/TS solo cuando muestrear100 es true. */
    void (*paso_control)(int64_t ahora_us, float dt_s, bool muestrear100, lab_snapshot_t *s);
    /* Solo CPU1. Debe tolerar inicializacion parcial. No espera red/IA. */
    void (*parar)(void);
    /* Wi-Fi previamente iniciado UNA vez, fuera del lazo de control. */
    bool (*red_lista)(void);
    const char *ws_uri; /* Vida estatica. ws://IP_PC:8001/ws/device */
    const char *device_id, *boot_id;
} lab_hooks_t;

/* Llamar una sola vez desde app_main. Crea control CPU1 y telemetria CPU0. */
esp_err_t lab03_iniciar(const lab_hooks_t *hooks);
/* Copias por valor, timeout cero; false significa descarte contabilizado. */
bool lab03_evento(lab_evento_t evento, uint32_t objeto, int64_t t_us, float valor, int64_t deadline_us);
/* RX solo encola; exclusivamente CPU1 aplica y confirma las ordenes. */
bool lab03_enlace_vigente(void);
bool lab03_orden(lab_orden_t *orden);
void lab03_responder(const lab_orden_t *orden, bool aplicada, const char *razon);
void lab03_publicar_ia(uint32_t objeto, int64_t entrada_us, int64_t inferencia_us, lab_ia_t resultado, bool manual);
void lab03_descarte_ia(void);
#ifdef __cplusplus
}
#endif
