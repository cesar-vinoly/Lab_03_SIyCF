#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "clasificacion.h"

#define FIRMA_MUESTRAS 100
#define FIRMA_PREVIAS 0
#define FIRMA_FEATURES (FIRMA_MUESTRAS * 4)
#define FIRMA_VERSION 2

typedef struct {
    bool activa;
    int clase;
    float voto;
    bool dudosa;
    int64_t inferencia_us;
    unsigned stack_libre_min;
} tiny_resultado_t;

typedef struct {
    int64_t t_ms;
    float dist_cm;
    float rpm_motor;
    float rpm_ts;
    unsigned step_hz;
    unsigned servo_us;
    bool inductivo;
    bool flanco;
    bool empuje;
    estado_t estado;
} muestra_t;

typedef struct {
    uint32_t ciclo_id;
    int cantidad;
    int previas;
    bool metal;
    bool cancelada;
    bool manual;
    uint32_t orden_manual;
    tiny_resultado_t ia;
    unsigned stack_libre_min;
    muestra_t muestras[FIRMA_MUESTRAS];
} captura_t;

/* Solo la tarea de control llama a estas funciones; nunca hacen HTTP ni esperan. */
void captura_actualizar(bool nuevo_ciclo, bool metal, bool cancelada, const muestra_t *muestra);
void captura_reiniciar(void);
bool captura_lista(void);
bool captura_ocupada(void);
void captura_manual(uint32_t orden);
unsigned captura_registro_restante_ms(void);


uint32_t captura_id(void);
