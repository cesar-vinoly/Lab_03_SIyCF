#pragma once
#include <math.h>
#include <stdbool.h>
typedef struct { bool valida, viable; float vuelo_s, espera_s, velocidad_limite_m_s; } lab_llegada_t;
/* Referencia para la futura integracion: no sustituye ahora el disparo empirico a 30 cm. */
static inline lab_llegada_t lab_planificar(float distancia_m, float velocidad_m_s, float servo_s, float margen_s)
{
    lab_llegada_t r = {0};
    if (!isfinite(distancia_m)||!isfinite(velocidad_m_s)||!isfinite(servo_s)||!isfinite(margen_s)||
        distancia_m<=0||velocidad_m_s<=0||servo_s<=0||margen_s<0) return r;
    r.valida=true; r.vuelo_s=distancia_m/velocidad_m_s;
    r.espera_s=r.vuelo_s-servo_s-margen_s; r.viable=r.espera_s>0;
    r.velocidad_limite_m_s=distancia_m/(servo_s+margen_s);
    if (r.espera_s<0) r.espera_s=0;
    return r;
}
