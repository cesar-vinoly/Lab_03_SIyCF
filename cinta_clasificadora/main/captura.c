#include "captura.h"
#include "red.h"
#include "tiny_ia.h"
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static captura_t actual;
static uint32_t secuencia;
static bool activa;
static uint32_t orden_manual;

void captura_reiniciar(void)
{
    if (activa) { actual.cancelada = true; red_encolar(&actual); }
    activa = false;
    orden_manual = 0;
}

bool captura_lista(void) { return !activa && !orden_manual; }
bool captura_ocupada(void) { return activa || orden_manual; }
void captura_manual(uint32_t orden)
{
    if (orden && !captura_ocupada()) orden_manual = orden;
}
unsigned captura_registro_restante_ms(void)
{
    if (orden_manual) return FIRMA_MUESTRAS * 100;
    return activa && actual.manual ? (FIRMA_MUESTRAS - actual.cantidad) * 100 : 0;
}

void captura_actualizar(bool nuevo_ciclo, bool metal, bool cancelada, const muestra_t *muestra)
{
    if (nuevo_ciclo || orden_manual) {
        if (activa) { actual.cancelada = true; red_encolar(&actual); }
        // Limpiar en sitio: evitar un temporal de 100 muestras en la pila.
        memset(&actual, 0, sizeof(actual));
        actual.ciclo_id = ++secuencia;
        actual.ia.clase = -1;
        actual.manual = orden_manual != 0;
        actual.orden_manual = orden_manual;
        orden_manual = 0;
        activa = true;
    }
    if (!activa) return;
    actual.metal |= metal;
    actual.cancelada |= cancelada;
    actual.muestras[actual.cantidad++] = *muestra;
    if (actual.cantidad == FIRMA_MUESTRAS) {
        actual.stack_libre_min = (unsigned)uxTaskGetStackHighWaterMark(NULL);
        tiny_encolar(&actual);
        activa = false;
    }
}

uint32_t captura_id(void) { return secuencia; }
