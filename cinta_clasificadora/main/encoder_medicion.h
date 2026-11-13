#pragma once
#include <stdbool.h>
#include <stdint.h>
#include <string.h>
#include <math.h>
#include "configuracion.h"

/* El llamador protege este estado compartido con la ISR. El modelo TS no
 * participa en la medida; no se sustituye una lectura mala por RPM teoricas. */
typedef struct {
    int64_t ultimo_flanco_us;
    int64_t suma_us;
    int64_t periodos[ENCODER_VENTANA_PERIODOS];
    unsigned cantidad;
    unsigned indice;
    uint32_t rechazados;
    int64_t subida_us;
    int64_t bajada_us;
} encoder_medicion_t;

static inline void encoder_medicion_reiniciar(encoder_medicion_t *e)
{
    memset(e, 0, sizeof(*e));
}

static inline void encoder_medicion_flanco(encoder_medicion_t *e, int64_t ahora_us)
{
    int64_t anterior_us = e->ultimo_flanco_us;
    int64_t periodo_us = ahora_us - anterior_us;
    // Actualizar en TODOS los flancos: espaciar artificialmente el ruido por
    // tiempo muerto lo convertiria en una velocidad aparentemente plausible.
    e->ultimo_flanco_us = ahora_us;
    if (!anterior_us || periodo_us < ENCODER_PERIODO_MIN_US || periodo_us > ENCODER_REINICIO_US) {
        if (anterior_us && periodo_us < ENCODER_PERIODO_MIN_US) ++e->rechazados;
        e->cantidad = 0;
        e->indice = 0;
        e->suma_us = 0;
        return;
    }
    if (e->cantidad == ENCODER_VENTANA_PERIODOS) e->suma_us -= e->periodos[e->indice];
    else ++e->cantidad;
    e->periodos[e->indice] = periodo_us;
    e->suma_us += periodo_us;
    e->indice = (e->indice + 1) % ENCODER_VENTANA_PERIODOS;
}

static inline float encoder_medicion_rpm(const encoder_medicion_t *e, int64_t ahora_us)
{
    if (e->cantidad < ENCODER_MIN_PERIODOS || e->suma_us <= 0) return NAN;
    int64_t limite_us = 2 * e->suma_us / e->cantidad;
    if (limite_us < 200000) limite_us = 200000;
    if (limite_us > ENCODER_REINICIO_US) limite_us = ENCODER_REINICIO_US;
    if (ahora_us < e->ultimo_flanco_us || ahora_us - e->ultimo_flanco_us > limite_us) return NAN;
    return (60000000.0f * e->cantidad / (ENCODER_PULSOS_VUELTA * (float)e->suma_us)) *
           (DIENTES_RODILLO / DIENTES_MOTOR);
}

/* Validar ambos niveles. Se confirma el pulso anterior al comenzar el siguiente:
 * agrega un periodo de latencia, pero descarta glitches altos Y bajos sin borrar
 * el promedio. El periodo se sigue midiendo entre subidas, no entre confirmaciones.
 * Una senal sostenida demasiado rapida sigue rechazada por el limite fisico. */
static inline void encoder_medicion_senal(encoder_medicion_t *e, int64_t ahora_us, bool alto)
{
    if (alto) {
        if (e->bajada_us && ahora_us - e->bajada_us < ENCODER_PULSO_MIN_US) {
            ++e->rechazados; e->bajada_us = 0; return; // Rebote bajo: conservar la subida original.
        }
        if (e->bajada_us && e->subida_us) encoder_medicion_flanco(e, e->subida_us);
        e->subida_us = ahora_us; e->bajada_us = 0;
    } else if (e->subida_us) {
        if (ahora_us - e->subida_us < ENCODER_PULSO_MIN_US) {
            ++e->rechazados; e->subida_us = 0; e->bajada_us = 0;
        } else e->bajada_us = ahora_us;
    }
}
