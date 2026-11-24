#pragma once
/* Para el FUTURO main: depende de captura.h existente. No incluir en el componente. */
#include "captura.h"
#include "lab03_runtime.h"
#include <math.h>
static inline bool lab_encolar_captura(const captura_t *c)
{
    if (c->cantidad!=100 || c->previas!=0 || c->cancelada) return false;
    lab_firma_t f = {.objeto=c->ciclo_id, .t_us=c->muestras[99].t_ms*1000};
    for (int i=0;i<100;i++) {
        const muestra_t *s=&c->muestras[i];
        if (i && (s->t_ms-c->muestras[i-1].t_ms<70 || s->t_ms-c->muestras[i-1].t_ms>160)) return false;
        bool eco=isfinite(s->dist_cm) && s->dist_cm>=2 && s->dist_cm<=200;
        f.x[4*i]=s->inductivo?1:0; f.x[4*i+1]=s->flanco?1:0;
        f.x[4*i+2]=eco?1:0; f.x[4*i+3]=eco?s->dist_cm/200.0f:0;
    }
    return lab03_encolar_firma(&f);
}
