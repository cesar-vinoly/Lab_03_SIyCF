#pragma once
#include "lab03_runtime.h"

/* Una vez desde app_main, antes de crear el control. I2C solo en CPU0. */
void pantalla_iniciar(void);
/* Copia del estado del control; cola de una posicion, sin espera ni I2C. */
void pantalla_publicar(const lab_snapshot_t *estado, int64_t t_us);
