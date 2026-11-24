#include "lab03_runtime.h"
// Copiar este archivo al main futuro; el modelo solo lo toca la tarea IA.
#if __has_include("modelo_calidad.h")
#include "modelo_calidad.h"
static_assert(TINY_FEATURE_VERSION==2 && TINY_N_FEATURES==400 && TINY_CLASS_VERSION==2 && TINY_N_CLASSES==3,
              "Reentrenar modelo con el contrato actual");
#define MODELO_DISPONIBLE 1
#else
#define MODELO_DISPONIBLE 0
#endif
extern "C" lab_ia_t inferir_modelo(const float entrada[400])
{
    lab_ia_t r = {};
    r.clase=-1;
#if MODELO_DISPONIBLE
    float x[400];
    for (int i=0;i<400;i++) x[i]=entrada[i];
    ModeloCalidad modelo;
    r.clase=modelo.predict(x,&r.voto); r.activa=true; r.dudosa=r.voto<TINY_UMBRAL_VOTO;
#else
    (void)entrada;
#endif
    return r;
}
