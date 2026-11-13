#pragma once
#include "captura.h"
#ifdef __cplusplus
extern "C" {
#endif
void red_iniciar(void);
bool red_lista(void);
const char *red_device_id(void);
const char *red_boot_id(void);
const char *red_gemelo_uri(void);
const char *red_estado_texto(void);
bool red_encolar(const captura_t *captura);
typedef struct { bool manual; uint32_t orden; } ensayo_orden_t;
bool red_orden_ensayo(ensayo_orden_t *orden);
void red_estado_ensayo(bool manual, bool lista, bool ocupada, unsigned restante_ms, uint32_t orden, unsigned registro_restante_ms);
#ifdef __cplusplus
}
#endif

