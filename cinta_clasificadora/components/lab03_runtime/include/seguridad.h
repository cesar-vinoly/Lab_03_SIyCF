#pragma once
#include <stdbool.h>
#include <stdint.h>
/* Solo tarea de control. La entrada falla viene de diagnostico/entrada fisica,
   NO de "sin eco" aislado. Este latch no reemplaza el enclavamiento fisico. */
typedef struct { bool enclavada; int64_t falla_us; } lab_seguridad_t;
static inline bool lab_seguridad_paso(lab_seguridad_t *s, bool falla, bool rearme_operador, int64_t ahora)
{
    if (falla && !s->enclavada) { s->enclavada=true; s->falla_us=ahora; }
    if (!falla && rearme_operador) { s->enclavada=false; s->falla_us=0; }
    return s->enclavada; /* Si true: motor_aplicar(0), alarma; no pasar por IA/red. */
}
