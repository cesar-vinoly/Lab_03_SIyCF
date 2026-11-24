#include "lab03_runtime.h"
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <inttypes.h>
#include <stdatomic.h>
#include "esp_timer.h"
#include "esp_system.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "esp_log.h"
#include "esp_websocket_client.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/event_groups.h"

#if CONFIG_FREERTOS_UNICORE
#error "lab03_runtime requiere ESP32 de dos nucleos"
#endif
#define INICIAR BIT0
#define PERIODO_US 20000
static const char *TAG = "lab03";
static const char *estados[] = {"ESPERA","CLASIFICANDO","POSICIONANDO","TRANSPORTANDO","REARME","FALLA"};
static const char *eventos[] = {"objeto","decision_a","decision_b","dudoso","servo_orden","servo_confirmado",
    "falla","motor_orden_parar","motor_detenido","alarma","fin_ciclo","rearme"};
typedef struct {
    int tipo; /* 0 snapshot, 1 evento, 2 IA */
    int64_t t_us, plazo, entrada_us, inferencia_us;
    uint32_t objeto;
    lab_snapshot_t s;
    lab_evento_t evento;
    lab_ia_t ia;
    float valor;
    unsigned ejecucion, retraso, perdidos, stack_min;
} mensaje_t;
static lab_hooks_t h;
static QueueHandle_t firmas, novedades, instantanea;
static EventGroupHandle_t inicio;
static atomic_uint drop_ia, drop_eventos, coalescidas;
static char dispositivo[13], arranque[17];
static bool iniciado;

bool lab03_encolar_firma(const lab_firma_t *f)
{
    if (!firmas || !f || !f->objeto) return false;
    if (xQueueSend(firmas, f, 0) == pdTRUE) return true;
    atomic_fetch_add(&drop_ia, 1);
    return false;
}

bool lab03_evento(lab_evento_t e, uint32_t objeto, int64_t t_us, float valor, int64_t plazo)
{
    if (!novedades || (unsigned)e >= sizeof(eventos)/sizeof(eventos[0]) || !objeto || t_us < 0) return false;
    mensaje_t m = {.tipo=1, .evento=e, .objeto=objeto, .t_us=t_us, .valor=valor, .plazo=plazo};
    if (xQueueSend(novedades, &m, 0) == pdTRUE) return true;
    atomic_fetch_add(&drop_eventos, 1);
    return false;
}

static void tarea_control(void *arg)
{
    (void)arg;
    xEventGroupWaitBits(inicio, INICIAR, pdFALSE, pdTRUE, portMAX_DELAY);
    if (h.iniciar_control() != ESP_OK) {
        h.parar();
        ESP_LOGE(TAG, "Fallo al inicializar hardware; control detenido");
        vTaskDelete(NULL);
        return;
    }
    TickType_t despertar = xTaskGetTickCount();
    int64_t anterior = esp_timer_get_time(), previsto = anterior+PERIODO_US, sensor = anterior+100000;
    unsigned omitidos = 0, max_ejecucion = 0, max_retraso = 0;
    for (;;) {
        xTaskDelayUntil(&despertar, pdMS_TO_TICKS(20));
        int64_t ahora = esp_timer_get_time();
        unsigned tarde = ahora > previsto ? (unsigned)(ahora-previsto) : 0;
        bool muestrear = ahora >= sensor;
        if (muestrear) { sensor += 100000; if (sensor <= ahora) sensor = ahora+100000; }
        mensaje_t m = {.tipo=0, .t_us=ahora, .retraso=tarde};
        m.s = (lab_snapshot_t){.rpm_motor=NAN, .dist_cm=NAN, .pos_m=NAN, .pos_real_m=NAN};
        h.paso_control(ahora, (ahora-anterior)/1000000.0f, muestrear, &m.s);
        int64_t fin = esp_timer_get_time();
        m.ejecucion = (unsigned)(fin-ahora);
        if (m.ejecucion > max_ejecucion) max_ejecucion = m.ejecucion;
        if (tarde > max_retraso) max_retraso = tarde;
        anterior = ahora;
        previsto += PERIODO_US;
        // Evitar rafagas de "recuperacion": una muestra atrasada no se repite.
        if (fin >= previsto) {
            omitidos += (unsigned)((fin-previsto)/PERIODO_US)+1;
            despertar = xTaskGetTickCount();
            previsto = fin+PERIODO_US;
        }
        m.perdidos = omitidos;
        m.stack_min = (unsigned)uxTaskGetStackHighWaterMark(NULL);
        if (muestrear) {
            m.ejecucion = max_ejecucion;
            m.retraso = max_retraso;
            max_ejecucion = max_retraso = 0;
            if (uxQueueMessagesWaiting(instantanea)) atomic_fetch_add(&coalescidas, 1);
            xQueueOverwrite(instantanea, &m);
        }
    }
}

static void tarea_ia(void *arg)
{
    (void)arg;
    xEventGroupWaitBits(inicio, INICIAR, pdFALSE, pdTRUE, portMAX_DELAY);
    lab_firma_t f;
    for (;;) {
        if (xQueueReceive(firmas, &f, portMAX_DELAY) != pdTRUE) continue;
        int64_t t = esp_timer_get_time();
        lab_ia_t resultado = h.inferir ? h.inferir(f.x) : (lab_ia_t){.clase=-1};
        int64_t fin = esp_timer_get_time();
        mensaje_t m = {.tipo=2, .objeto=f.objeto, .t_us=fin, .entrada_us=f.t_us,
                       .inferencia_us=fin-t, .ia=resultado};
        if (xQueueSend(novedades, &m, 0) != pdTRUE) atomic_fetch_add(&drop_eventos, 1);
    }
}

static const char *numero(float x, char b[32])
{
    if (!isfinite(x)) return "null";
    snprintf(b, 32, "%.9g", (double)x);
    return b;
}

static int serializar(const mensaje_t *m, uint64_t seq, char *salida, size_t tam)
{
    char datos[2300], a[32], b[32], c[32], d[32];
    const lab_snapshot_t *s = &m->s;
    const char *tipo;
    int n;
    if (m->tipo == 0) {
        if ((unsigned)s->estado >= sizeof(estados)/sizeof(estados[0]) || !isfinite(s->rpm_ts) || !isfinite(s->setpoint_rpm)) return -1;
        tipo = "snapshot";
        n = snprintf(datos, sizeof(datos), "{\"estado\":\"%s\",\"rpm_motor\":%s,\"rpm_ts\":%.9g,\"setpoint_rpm\":%.9g,"
          "\"dist_cm\":%s,\"pos_m\":%s,\"pos_real_m\":%s,\"manual\":%s,\"metal\":%s,\"encoder_valido\":%s,"
          "\"step_hz\":%u,\"servo_us\":%u,\"control_exec_us\":%u,\"control_late_us\":%u,\"control_missed\":%u,"
          "\"heap_min\":%lu,\"stack_min\":%u,\"dropped_ia\":%u,\"dropped_events\":%u,\"coalesced\":%u}",
          estados[s->estado], numero(s->encoder_valido?s->rpm_motor:NAN,a), (double)s->rpm_ts, (double)s->setpoint_rpm,
          numero(s->dist_cm,b), numero(s->pos_m,c), numero(s->pos_real_m,d), s->manual?"true":"false",
          s->metal?"true":"false", s->encoder_valido?"true":"false", s->step_hz,s->servo_us,
          m->ejecucion,m->retraso,m->perdidos,(unsigned long)esp_get_minimum_free_heap_size(),m->stack_min,
          atomic_load(&drop_ia),atomic_load(&drop_eventos),atomic_load(&coalescidas));
    } else if (m->tipo == 1) {
        tipo = "event";
        char plazo[32] = "null";
        if (m->plazo > 0) snprintf(plazo,sizeof(plazo),"%" PRId64,m->plazo);
        n = snprintf(datos,sizeof(datos),"{\"name\":\"%s\",\"object_id\":%lu,\"value\":%s,\"deadline_us\":%s}",
            eventos[m->evento],(unsigned long)m->objeto,numero(m->valor,a),plazo);
    } else {
        tipo = "ia";
        if (!isfinite(m->ia.voto)) return -1;
        n = snprintf(datos,sizeof(datos),"{\"object_id\":%lu,\"input_t_us\":%" PRId64 ",\"inferencia_us\":%" PRId64
            ",\"activa\":%s,\"clase\":%d,\"voto\":%.9g,\"dudosa\":%s}",
            (unsigned long)m->objeto,m->entrada_us,m->inferencia_us,m->ia.activa?"true":"false",
            m->ia.clase,(double)m->ia.voto,m->ia.dudosa?"true":"false");
    }
    if (n < 0 || n >= (int)sizeof(datos)) return -1;
    n = snprintf(salida,tam,"{\"v\":1,\"device_id\":\"%s\",\"boot_id\":\"%s\",\"seq\":%" PRIu64
        ",\"t_us\":%" PRId64 ",\"kind\":\"%s\",\"data\":%s}", dispositivo,arranque,seq,m->t_us,tipo,datos);
    return n >= 0 && (size_t)n < tam ? n : -1;
}

static void tarea_red(void *arg)
{
    (void)arg;
    xEventGroupWaitBits(inicio, INICIAR, pdFALSE, pdTRUE, portMAX_DELAY);
    while (!h.red_lista()) vTaskDelay(pdMS_TO_TICKS(250));
    esp_websocket_client_config_t cfg = {.uri=h.ws_uri, .task_core_id_set=true, .task_core_id=0,
        .task_prio=2, .task_stack=4096, .network_timeout_ms=1000, .reconnect_timeout_ms=2000,
        .enable_close_reconnect=true};
    esp_websocket_client_handle_t ws = esp_websocket_client_init(&cfg);
    if (!ws || esp_websocket_client_start(ws) != ESP_OK) {
        ESP_LOGE(TAG,"WebSocket no iniciado; control sigue local");
        if (ws) esp_websocket_client_destroy(ws);
        vTaskDelete(NULL); return;
    }
    static char json[3072]; /* Unico escritor: esta tarea. */
    uint64_t secuencia = 0;
    mensaje_t m;
    unsigned rafaga = 0;
    for (;;) {
        if (!esp_websocket_client_is_connected(ws)) { vTaskDelay(pdMS_TO_TICKS(100)); continue; }
        // Como maximo cuatro eventos seguidos antes de atender la instantanea.
        bool hay = false;
        if (rafaga >= 4 && xQueueReceive(instantanea,&m,0)==pdTRUE) { hay=true; rafaga=0; }
        if (!hay && xQueueReceive(novedades,&m,0)==pdTRUE) { hay=true; ++rafaga; }
        if (!hay && xQueueReceive(instantanea,&m,0)==pdTRUE) { hay=true; rafaga=0; }
        if (!hay) { vTaskDelay(pdMS_TO_TICKS(10)); continue; }
        int n = serializar(&m,++secuencia,json,sizeof(json));
        if (n < 0 || esp_websocket_client_send_text(ws,json,n,pdMS_TO_TICKS(100)) != n) {
            atomic_fetch_add(&drop_eventos,1);
        }
        // Telemetria best effort: no se considera confirmacion fisica ni ACK persistente.
        vTaskDelay(pdMS_TO_TICKS(1));
    }
}

esp_err_t lab03_iniciar(const lab_hooks_t *hooks)
{
    if (iniciado) return ESP_ERR_INVALID_STATE;
    if (!hooks || !hooks->iniciar_control || !hooks->paso_control || !hooks->parar || !hooks->red_lista ||
        !hooks->ws_uri || strncmp(hooks->ws_uri,"ws://",5)) return ESP_ERR_INVALID_ARG;
    if (pdMS_TO_TICKS(20) == 0) return ESP_ERR_INVALID_STATE;
    h = *hooks;
    uint8_t mac[6];
    esp_err_t e = esp_read_mac(mac,ESP_MAC_WIFI_STA);
    if (e != ESP_OK) return e;
    snprintf(dispositivo,sizeof(dispositivo),"%02x%02x%02x%02x%02x%02x",mac[0],mac[1],mac[2],mac[3],mac[4],mac[5]);
    snprintf(arranque,sizeof(arranque),"%08lx%08lx",(unsigned long)esp_random(),(unsigned long)esp_random());
    firmas=xQueueCreate(4,sizeof(lab_firma_t));
    novedades=xQueueCreate(32,sizeof(mensaje_t));
    instantanea=xQueueCreate(1,sizeof(mensaje_t));
    inicio=xEventGroupCreate();
    TaskHandle_t control=NULL, ia=NULL, red=NULL;
    if (!firmas || !novedades || !instantanea || !inicio) goto fallo;
    if (xTaskCreatePinnedToCore(tarea_control,"lab_control",6144,NULL,5,&control,1)!=pdPASS) goto fallo;
    if (xTaskCreatePinnedToCore(tarea_ia,"lab_ia",6144,NULL,3,&ia,0)!=pdPASS) goto fallo;
    if (xTaskCreatePinnedToCore(tarea_red,"lab_tx",6144,NULL,2,&red,0)!=pdPASS) goto fallo;
    iniciado=true;
    ESP_LOGI(TAG,"Control+TS CPU1/prio5; IA CPU0/prio3; WS CPU0/prio2; cola eventos %u bytes",(unsigned)(32*sizeof(mensaje_t)));
    xEventGroupSetBits(inicio,INICIAR);
    return ESP_OK;
fallo:
    if (control) vTaskDelete(control);
    if (ia) vTaskDelete(ia);
    if (red) vTaskDelete(red);
    if (firmas) vQueueDelete(firmas);
    if (novedades) vQueueDelete(novedades);
    if (instantanea) vQueueDelete(instantanea);
    if (inicio) vEventGroupDelete(inicio);
    firmas=novedades=instantanea=NULL; inicio=NULL;
    return ESP_ERR_NO_MEM;
}
