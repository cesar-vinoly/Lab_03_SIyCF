#ifndef MODELO_TS1_ECONOMICO_H
#define MODELO_TS1_ECONOMICO_H
#include <math.h>
// Planta identificada; no es un controlador. SIN PRUEBA FINAL INDEPENDIENTE
// y(k+1) = sum w_i(u(k-d)) * (A_i*y(k) + B_i*u(k-d) + C0_i)
// Llamar ts1_economico_paso(u(k)) UNA VEZ por TS1_ECONOMICO_TS; devuelve y(k+1).
#define TS1_ECONOMICO_R 4
#define TS1_ECONOMICO_D 0
#define TS1_ECONOMICO_GAUSSIANAS 0
static const float TS1_ECONOMICO_TS = 0.1f;
static const float TS1_ECONOMICO_SIGMA = 0.0f;
static const float TS1_ECONOMICO_CENTROS[TS1_ECONOMICO_R] = {0.0f, 1333.33333f, 2666.66667f, 4000.0f};
static const float TS1_ECONOMICO_A[TS1_ECONOMICO_R] = {0.806349977f, 0.520315934f, 1e-06f, 0.028324826f};
static const float TS1_ECONOMICO_B[TS1_ECONOMICO_R] = {-0.0175929455f, -0.00676567179f, 0.0127128342f, 0.0116457831f};
static const float TS1_ECONOMICO_C0[TS1_ECONOMICO_R] = {-0.000887793072f, 33.0246564f, 66.0952103f, 99.0302344f};

static inline void ts1_economico_pesos(float z, const float *c, float *w) {
    for (int i = 0; i < TS1_ECONOMICO_R; ++i) w[i] = 0.0f;
    if (TS1_ECONOMICO_R == 1) { w[0] = 1.0f; return; }
#if TS1_ECONOMICO_GAUSSIANAS
    float logw[TS1_ECONOMICO_R], maximo = -INFINITY, total = 0.0f;
    for (int i = 0; i < TS1_ECONOMICO_R; ++i) {
        float x = (z - c[i]) / TS1_ECONOMICO_SIGMA;
        logw[i] = -0.5f*x*x;
        if (logw[i] > maximo) maximo = logw[i];
    }
    for (int i = 0; i < TS1_ECONOMICO_R; ++i) { w[i] = expf(logw[i]-maximo); total += w[i]; }
    for (int i = 0; i < TS1_ECONOMICO_R; ++i) w[i] /= total;
#else
    if (z <= c[0]) { w[0] = 1.0f; return; }
    if (z >= c[TS1_ECONOMICO_R-1]) { w[TS1_ECONOMICO_R-1] = 1.0f; return; }
    for (int i = 0; i < TS1_ECONOMICO_R-1; ++i) {
        if (z <= c[i+1]) {
            w[i+1] = (z-c[i])/(c[i+1]-c[i]); w[i] = 1.0f-w[i+1]; return;
        }
    }
#endif
}
// z debe ser u(k-d), también cuando TS1_ECONOMICO_D > 0.
static inline float ts1_economico_predecir(float yk, float ud, float z) {
#if TS1_ECONOMICO_R == 1
    (void)z;
    return TS1_ECONOMICO_A[0]*yk + TS1_ECONOMICO_B[0]*ud + TS1_ECONOMICO_C0[0];
#elif TS1_ECONOMICO_GAUSSIANAS
    float w[TS1_ECONOMICO_R], siguiente = 0.0f;
    ts1_economico_pesos(z, TS1_ECONOMICO_CENTROS, w);
    for (int i = 0; i < TS1_ECONOMICO_R; ++i)
        siguiente += w[i] * (TS1_ECONOMICO_A[i]*yk + TS1_ECONOMICO_B[i]*ud + TS1_ECONOMICO_C0[i]);
    return siguiente;
#else
    // Partición triangular: sólo dos reglas vecinas pueden estar activas.
    if (z <= TS1_ECONOMICO_CENTROS[0])
        return TS1_ECONOMICO_A[0]*yk + TS1_ECONOMICO_B[0]*ud + TS1_ECONOMICO_C0[0];
    if (z >= TS1_ECONOMICO_CENTROS[TS1_ECONOMICO_R-1])
        return TS1_ECONOMICO_A[TS1_ECONOMICO_R-1]*yk + TS1_ECONOMICO_B[TS1_ECONOMICO_R-1]*ud + TS1_ECONOMICO_C0[TS1_ECONOMICO_R-1];
    int i = 0;
    while (i < TS1_ECONOMICO_R-2 && z > TS1_ECONOMICO_CENTROS[i+1]) ++i;
    float alfa = (z-TS1_ECONOMICO_CENTROS[i])/(TS1_ECONOMICO_CENTROS[i+1]-TS1_ECONOMICO_CENTROS[i]);
    float izquierda = TS1_ECONOMICO_A[i]*yk + TS1_ECONOMICO_B[i]*ud + TS1_ECONOMICO_C0[i];
    float derecha = TS1_ECONOMICO_A[i+1]*yk + TS1_ECONOMICO_B[i+1]*ud + TS1_ECONOMICO_C0[i+1];
    return izquierda + alfa*(derecha-izquierda);
#endif
}
typedef struct { float y, historia[TS1_ECONOMICO_D+1]; unsigned indice; } TS1EconomicoEstado;
static inline void ts1_economico_iniciar(TS1EconomicoEstado *e, float y0, float u0) {
    e->y = y0; e->indice = 0;
    for (int j = 0; j <= TS1_ECONOMICO_D; ++j) e->historia[j] = u0;
}
static inline float ts1_economico_paso(TS1EconomicoEstado *e, float u_actual) {
    e->historia[e->indice] = u_actual;
    unsigned lectura = (e->indice + 1) % (TS1_ECONOMICO_D+1);
    float ud = e->historia[lectura];
    e->y = ts1_economico_predecir(e->y, ud, ud);
    e->indice = lectura;
    return e->y;
}
#endif
