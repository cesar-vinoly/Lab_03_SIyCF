#pragma once
#include <stdbool.h>
#include "modelo_ts1_economico.h"

typedef struct {
    TS1EconomicoEstado modelo;
    float base_hz;
    float integral_hz;
    float aplicada_hz;
    float objetivo_hz;
    float rampa_hz;
    float rpm_filtradas;
    bool filtro_iniciado;
    bool base_alcanzada;
} velocidad_t;

void velocidad_iniciar(velocidad_t *v);
/* PI cada TS1_ECONOMICO_TS; rampa independiente cada ACTUADORES_PERIODO_MS. */
void velocidad_actualizar(velocidad_t *v, float rpm_medidas, bool encoder_valido);
unsigned velocidad_rampa(velocidad_t *v, float dt_s);
unsigned velocidad_directa(velocidad_t *v, unsigned porcentaje, float dt_s);
void velocidad_aplicada(velocidad_t *v, float hz);
