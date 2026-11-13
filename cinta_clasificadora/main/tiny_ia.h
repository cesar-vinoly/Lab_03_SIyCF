#pragma once
#include "captura.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Inicializar una vez desde app_main, despues de red_iniciar(). */
void tiny_iniciar(void);
/* Copia la captura a una cola sin esperar; solo llama la tarea de control. */
void tiny_encolar(const captura_t *captura);
#ifdef __cplusplus
}
#endif

