#include "tiny_ia.h"
#include "red.h"
#include "lab03_runtime.h"
#include "modelo_calidad.h"
#include "modelo_calidad_info.h"
#include <cmath>
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

static_assert(TINY_CLASS_VERSION == 2, "Etiquetas incompatibles");
static_assert(TINY_FEATURE_VERSION == FIRMA_VERSION, "Version de firma incompatible");
static_assert(TINY_N_FEATURES == FIRMA_FEATURES, "Cantidad de features incompatible");
static_assert(TINY_N_CLASSES == 3, "Se esperan normal, intermitente y anomala");
static_assert(TINY_N_ARBOLES > 0, "El modelo debe tener arboles");

// Control/TS CPU1; inferencia y comunicaciones CPU0, con colas independientes.
#if defined(CONFIG_FREERTOS_UNICORE) && CONFIG_FREERTOS_UNICORE
static constexpr BaseType_t NUCLEO_IA = 0;
#else
static constexpr BaseType_t NUCLEO_IA = 0;
#endif
static constexpr unsigned PILA_IA_BYTES = 4096;
static QueueHandle_t cola;
static captura_t pendiente; // Propiedad exclusiva del trabajador, fuera de su pila.
static const char *const CLASES[] = {"senal_normal", "senal_intermitente", "senal_anomala"};

// Unico llamador: tarea_ia. No es reentrante (vector estatico de 1600 bytes).
static tiny_resultado_t tiny_evaluar(const captura_t *c)
{
    tiny_resultado_t r = {};
    r.clase = -1;
    if (c->cantidad != FIRMA_MUESTRAS || c->previas != FIRMA_PREVIAS || c->cancelada) return r;
    int64_t inicio = esp_timer_get_time();
    static float x[FIRMA_FEATURES];
    for (int i = 0; i < FIRMA_MUESTRAS; ++i) {
        const muestra_t *s = &c->muestras[i];
        // Mismo contrato que features.py: orden temporal y division fija por 200.
        bool eco = std::isfinite(s->dist_cm) && s->dist_cm >= 2.0f && s->dist_cm <= 200.0f;
        if (i && (s->t_ms - c->muestras[i-1].t_ms < 70 || s->t_ms - c->muestras[i-1].t_ms > 160)) return r;
        x[4*i] = s->inductivo ? 1.0f : 0.0f;
        x[4*i+1] = s->flanco ? 1.0f : 0.0f;
        x[4*i+2] = eco ? 1.0f : 0.0f;
        x[4*i+3] = eco ? s->dist_cm / 200.0f : 0.0f;
    }
    ModeloCalidad modelo;
    r.clase = modelo.predict(x, &r.voto);
    r.activa = true;
    r.dudosa = r.voto < TINY_UMBRAL_VOTO;
    r.inferencia_us = esp_timer_get_time() - inicio;
    return r;
}

static void tarea_ia(void *arg)
{
    (void)arg;
    for (;;) {
        if (xQueueReceive(cola, &pendiente, portMAX_DELAY) != pdTRUE) continue;
        pendiente.ia = tiny_evaluar(&pendiente);
        pendiente.ia.stack_libre_min = (unsigned)uxTaskGetStackHighWaterMark(NULL);
        if (pendiente.ia.activa) {
            ESP_LOGI("tiny_ia", "ciclo=%lu modo=%s clase=%s voto=%.3f dudosa=%d inferencia=%lld us pila_libre_min=%u",
                     (unsigned long)pendiente.ciclo_id, pendiente.manual ? "manual" : "automatica",
                     CLASES[pendiente.ia.clase], (double)pendiente.ia.voto, pendiente.ia.dudosa,
                     (long long)pendiente.ia.inferencia_us, pendiente.ia.stack_libre_min);
        } else {
            ESP_LOGW("tiny_ia", "ciclo=%lu sin inferencia: captura cancelada, incompleta o tiempos invalidos",
                     (unsigned long)pendiente.ciclo_id);
        }
        lab_ia_t resultado={};
        resultado.activa=pendiente.ia.activa; resultado.dudosa=pendiente.ia.dudosa;
        resultado.clase=pendiente.ia.clase; resultado.voto=pendiente.ia.voto;
        lab03_publicar_ia(pendiente.ciclo_id,pendiente.muestras[0].t_ms*1000,
            pendiente.ia.inferencia_us,resultado,pendiente.manual);
        red_encolar(&pendiente); // Cola HTTP independiente; tampoco espera a Internet.
    }
}

extern "C" void tiny_iniciar(void)
{
    if (cola) return;
    cola = xQueueCreate(1, sizeof(captura_t));
    if (!cola || xTaskCreatePinnedToCore(tarea_ia, "tiny_ia", PILA_IA_BYTES, nullptr, 3, nullptr, NUCLEO_IA) != pdPASS) {
        if (cola) vQueueDelete(cola);
        cola = nullptr;
        ESP_LOGE("tiny_ia", "Sin memoria para tarea IA; se conserva control y envio sin inferencia");
        return;
    }
    ESP_LOGI("tiny_ia", "Modelo cargado: %.12s; %d arboles, %d entradas; umbral=%.2f; nucleo=%d",
             TINY_MODELO_SHA256, TINY_N_ARBOLES, TINY_N_FEATURES, (double)TINY_UMBRAL_VOTO, (int)NUCLEO_IA);
    ESP_LOGI("tiny_ia", "Entrenamiento=%s; alcance=%s; supervision sin accionar motor ni servo",
             TINY_ORIGEN_ENTRENAMIENTO, TINY_ALCANCE_MODELO);
    ESP_LOGW("tiny_ia", "Predicciones en automatico pendientes de validacion en movimiento");
    ESP_LOGI("tiny_ia", "RAM reservada: cola+captura=%u, vector=%u, pila=%u bytes (no es RAM total)",
             (unsigned)(2 * sizeof(captura_t)), (unsigned)(FIRMA_FEATURES * sizeof(float)), PILA_IA_BYTES);
}

extern "C" void tiny_encolar(const captura_t *c)
{
    // La cola copia la ventana: el control puede reutilizar 'actual' de inmediato.
    if (cola && xQueueSend(cola, c, 0) == pdTRUE) return;
    lab03_descarte_ia();
    ESP_LOGW("tiny_ia", "ciclo=%lu sin inferencia: cola IA llena o no disponible",
             (unsigned long)c->ciclo_id);
    // La captura aun contiene ia.activa=false y clase=-1 desde su inicializacion.
    // Si tambien esta llena la cola HTTP, red_encolar contabiliza el descarte.
    red_encolar(c);
}

