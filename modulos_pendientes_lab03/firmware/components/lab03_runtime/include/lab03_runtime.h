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
    lab_estado_t estado;
} lab_snapshot_t;
typedef struct { uint32_t objeto; int64_t t_us; float x[400]; } lab_firma_t;
typedef struct { bool activa, dudosa; int clase; float voto; } lab_ia_t;
typedef struct {
    /* Se ejecuta en CPU1: hardware/ISR y estado privados del control. No HTTP. */
    esp_err_t (*iniciar_control)(void);
    /* Paso 20 ms. Actualizar sensores/PI/TS solo cuando muestrear100 es true. */
    void (*paso_control)(int64_t ahora_us, float dt_s, bool muestrear100, lab_snapshot_t *s);
    /* Solo CPU1. Debe tolerar inicializacion parcial. No espera red/IA. */
    void (*parar)(void);
    /* Solo CPU0, por firma; modelo inmutable. No escribir motor, TS ni ciclo. */
    lab_ia_t (*inferir)(const float x[400]);
    /* Wi-Fi previamente iniciado UNA vez, fuera del lazo de control. */
    bool (*red_lista)(void);
    const char *ws_uri; /* Vida estatica. ws://IP_PC:8765/ws/device */
} lab_hooks_t;

/* Llamar una sola vez desde app_main. No reemplaza el firmware hasta integrarlo. */
esp_err_t lab03_iniciar(const lab_hooks_t *hooks);
/* Copias por valor, timeout cero; false significa descarte contabilizado. */
bool lab03_encolar_firma(const lab_firma_t *firma);
bool lab03_evento(lab_evento_t evento, uint32_t objeto, int64_t t_us, float valor, int64_t deadline_us);
#ifdef __cplusplus
}
#endif
