#pragma once
#include <math.h>
#include "configuracion.h"
#include "lab03_runtime.h"

typedef struct {
    bool vigente, moviendo, encoder_valido, eco_valido, en_regimen;
    float rpm_teoricas, rpm_reales, cm_s_teoricos, cm_s_reales;
    float posicion_cm, error_pct;
    unsigned porcentaje;
} pantalla_vista_t;

/* Solo conversiones de visualizacion. No filtra ni escribe sensores/control.
 * T = cinemática a partir de STEP; R = encoder. Ambas RPM son del RODILLO,
 * como en Lab 1. La prediccion TS permanece en la telemetria del gemelo. */
static inline pantalla_vista_t pantalla_calcular(const lab_snapshot_t *s,
                                                int64_t muestra_us, int64_t ahora_us)
{
    pantalla_vista_t v = {0};
    v.vigente = muestra_us > 0 && ahora_us >= muestra_us &&
        ahora_us - muestra_us <= (int64_t)OLED_DATOS_VENCIDOS_MS * 1000;
    if (!v.vigente) return v;
    v.moviendo = s->step_hz > 0 && s->direccion != 0 && !s->emergencia && !s->ensayo;
    float rpm_motor_teoricas = v.moviendo ?
        s->step_hz * 60.0f / (MOTOR_PASOS_VUELTA * MOTOR_MICROPASOS) : 0.0f;
    float relacion = DIENTES_MOTOR / DIENTES_RODILLO;
    float cm_por_vuelta = 3.14159265358979323846f * OLED_DIAMETRO_RODILLO_MM / 10.0f;
    v.rpm_teoricas = rpm_motor_teoricas * relacion;
    v.cm_s_teoricos = v.rpm_teoricas * cm_por_vuelta / 60.0f;
    v.encoder_valido = s->encoder_valido && isfinite(s->rpm_motor) &&
        s->rpm_motor >= 0 && s->rpm_motor <= ENCODER_MAX_MOTOR_RPM;
    v.rpm_reales = v.encoder_valido ? s->rpm_motor * relacion : NAN;
    v.cm_s_reales = v.rpm_reales * cm_por_vuelta / 60.0f;
    v.error_pct = v.encoder_valido ? (v.rpm_teoricas > 1.0f ?
        fabsf(v.rpm_reales - v.rpm_teoricas) / v.rpm_teoricas * 100.0f : 0.0f) : NAN;
    v.eco_valido = isfinite(s->dist_cm) && s->dist_cm >= 2.0f && s->dist_cm <= 200.0f;
    /* POS conserva offset y recorrido del Lab 1; un eco del fondo no es una pieza. */
    v.posicion_cm = v.eco_valido && s->dist_cm >= OLED_OFFSET_HC_CM - 1.0f &&
        s->dist_cm <= OLED_OFFSET_HC_CM + OLED_LONGITUD_BANDA_CM + 2.0f ?
        fminf(OLED_LONGITUD_BANDA_CM, fmaxf(0, s->dist_cm - OLED_OFFSET_HC_CM)) : NAN;
    v.en_regimen = v.moviendo && isfinite(s->setpoint_rpm) && s->setpoint_rpm > 0 &&
        fabsf(rpm_motor_teoricas - s->setpoint_rpm) < 2.0f;
    /* En automatico, el porcentaje manual guardado no es la consigna activa. */
    float porcentaje = s->automatico ? s->setpoint_rpm * 100.0f / DIRECTO_MAX_RPM : s->porcentaje;
    v.porcentaje = isfinite(porcentaje) ? (unsigned)lroundf(fminf(100, fmaxf(0, porcentaje))) : 0;
    return v;
}
