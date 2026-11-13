#pragma once
#include <stdbool.h>
#include <stdint.h>

typedef enum { ESPERA, CLASIFICANDO, POSICIONANDO, TRANSPORTANDO, REARME } estado_t;

typedef struct {
    estado_t estado;
    bool metal;
    bool desviar_servo;
    int cerca;
    int libre;
    int64_t inicio_ms;
    int64_t ultimo_metal_ms;
    int64_t inicio_empuje_ms;
    int64_t ultimo_eco_ms;
    float ultimo_eco_cm;
    int muestras_salida;
    bool recuperando_eco;
    bool parada_por_perdida;
} ciclo_t;

void ciclo_iniciar(ciclo_t *c);
void ciclo_actualizar(ciclo_t *c, int64_t ahora_ms, float distancia_cm,
                      bool flanco_metal, bool inductivo_bajo, bool centro_listo);
