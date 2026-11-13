#include "red.h"
#include "configuracion_red.h"
#include "configuracion.h"
#include "modelo_calidad_info.h"
#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include <stdatomic.h>
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "esp_wifi_default.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/queue.h"
#include "freertos/task.h"

#define CON_IP BIT0
#define RECONECTAR BIT1
typedef enum {
    RED_SIN_CONFIG, RED_INICIANDO, RED_CONECTANDO, RED_ESPERANDO_IP,
    RED_CONECTADA, RED_ERROR
} estado_red_t;
static const char *TAG = "red";
static QueueHandle_t cola;
static QueueHandle_t ordenes;
static atomic_uint ensayo_flags, ensayo_restante, ensayo_ultima;
static atomic_uint ensayo_registro_restante;
static char url_ensayo[256];
static EventGroupHandle_t eventos;
static atomic_uint descartadas;
static atomic_int estado_red = RED_SIN_CONFIG;
static char dispositivo[13], arranque[17];
/* Solo la tarea de red usa este buffer; no ocupa la pila del control. */
static char json[32768];

bool red_orden_ensayo(ensayo_orden_t *orden)
{
    return ordenes && xQueueReceive(ordenes, orden, 0) == pdTRUE;
}

void red_estado_ensayo(bool manual, bool lista, bool ocupada, unsigned restante_ms, uint32_t orden, unsigned registro_restante_ms)
{
    atomic_store(&ensayo_registro_restante, registro_restante_ms);
    atomic_store(&ensayo_restante, restante_ms);
    atomic_store(&ensayo_flags, (manual ? 1u : 0u) | (lista ? 2u : 0u) | (ocupada ? 4u : 0u));
    atomic_store(&ensayo_ultima, orden);
}

typedef struct { char texto[64]; size_t usados; bool excedido; } respuesta_ensayo_t;
static esp_err_t recibir_ensayo(esp_http_client_event_t *evento)
{
    respuesta_ensayo_t *r = evento->user_data;
    if (evento->event_id == HTTP_EVENT_ON_DATA && evento->data_len > 0) {
        if (r->usados + evento->data_len >= sizeof(r->texto)) r->excedido = true;
        else {
            memcpy(r->texto + r->usados, evento->data, evento->data_len);
            r->usados += evento->data_len;
            r->texto[r->usados] = 0;
        }
    }
    return ESP_OK;
}

static void sondear_ensayo(void)
{
    if (!url_ensayo[0]) return;
    char cuerpo[384];
    unsigned flags = atomic_load(&ensayo_flags);
    snprintf(cuerpo, sizeof(cuerpo), "{\"device_id\":\"%s\",\"boot_id\":\"%s\","
             "\"manual\":%s,\"lista\":%s,\"ocupada\":%s,\"restante_ms\":%u,\"orden\":%u,"
             "\"registro_restante_ms\":%u,\"registro_total_ms\":%u,\"feature_version\":2}",
             dispositivo, arranque, flags & 1 ? "true" : "false", flags & 2 ? "true" : "false",
             flags & 4 ? "true" : "false", atomic_load(&ensayo_restante), atomic_load(&ensayo_ultima),
             atomic_load(&ensayo_registro_restante), (unsigned)(FIRMA_MUESTRAS * 100));
    respuesta_ensayo_t respuesta = {0};
    esp_http_client_config_t conf = {
        .url = url_ensayo, .method = HTTP_METHOD_POST, .timeout_ms = 1200,
        .disable_auto_redirect = true, .event_handler = recibir_ensayo, .user_data = &respuesta,
    };
    esp_http_client_handle_t http = esp_http_client_init(&conf);
    if (!http) return;
    esp_err_t err = esp_http_client_set_header(http, "Content-Type", "application/json");
    if (err == ESP_OK) err = esp_http_client_set_post_field(http, cuerpo, (int)strlen(cuerpo));
    if (err == ESP_OK) err = esp_http_client_perform(http);
    int codigo = esp_http_client_get_status_code(http);
    esp_http_client_cleanup(http);
    unsigned manual, orden;
    char sobra;
    if (err == ESP_OK && codigo == 200 && !respuesta.excedido &&
        sscanf(respuesta.texto, "%u %u %c", &manual, &orden, &sobra) == 2 && manual <= 1 && orden <= INT32_MAX) {
        ensayo_orden_t comando = { .manual = manual != 0, .orden = orden };
        xQueueOverwrite(ordenes, &comando);
    }
}

const char *red_estado_texto(void)
{
    switch (atomic_load(&estado_red)) {
    case RED_SIN_CONFIG: return "sin_config";
    case RED_INICIANDO: return "iniciando";
    case RED_CONECTANDO: return "conectando";
    case RED_ESPERANDO_IP: return "esperando_ip";
    case RED_CONECTADA: return "conectado";
    default: return "error";
    }
}

static const char *motivo_desconexion(unsigned motivo)
{
    switch (motivo) {
    case WIFI_REASON_NO_AP_FOUND: return "SSID no encontrado; revisar nombre y red de 2.4 GHz";
    case WIFI_REASON_AUTH_FAIL: return "autenticacion fallida; revisar clave y seguridad del router";
    case WIFI_REASON_AUTH_EXPIRE: return "autenticacion vencida; revisar senal y router";
    case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_HANDSHAKE_TIMEOUT: return "negociacion agotada; revisar clave, senal y router";
    case WIFI_REASON_BEACON_TIMEOUT: return "se perdio la senal del router";
    case WIFI_REASON_NO_AP_FOUND_W_COMPATIBLE_SECURITY:
    case WIFI_REASON_NO_AP_FOUND_IN_AUTHMODE_THRESHOLD: return "no hay una red con seguridad compatible";
    case WIFI_REASON_NO_AP_FOUND_IN_RSSI_THRESHOLD: return "senal del router insuficiente";
    default: return "verificar configuracion y disponibilidad del router";
    }
}

static void evento(void *arg, esp_event_base_t base, int32_t id, void *datos)
{
    if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        const ip_event_got_ip_t *ip = datos;
        atomic_store(&estado_red, RED_CONECTADA);
        xEventGroupClearBits(eventos, RECONECTAR);
        xEventGroupSetBits(eventos, CON_IP);
        ESP_LOGI(TAG, "Wi-Fi conectado; IP " IPSTR, IP2STR(&ip->ip_info.ip));
        ESP_LOGI(TAG, "Destino de capturas: %s; se comprobara al enviar una pieza", RED_SERVIDOR_URL);
    } else if (base == IP_EVENT && id == IP_EVENT_STA_LOST_IP) {
        atomic_store(&estado_red, RED_ESPERANDO_IP);
        xEventGroupClearBits(eventos, CON_IP);
        ESP_LOGW(TAG, "Wi-Fi sin direccion IP; esperando DHCP del router");
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_CONNECTED) {
        atomic_store(&estado_red, RED_ESPERANDO_IP);
        ESP_LOGI(TAG, "Enlace Wi-Fi establecido; esperando direccion IP por DHCP");
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        const wifi_event_sta_disconnected_t *desconexion = datos;
        unsigned motivo = desconexion ? desconexion->reason : 0;
        atomic_store(&estado_red, RED_CONECTANDO);
        xEventGroupClearBits(eventos, CON_IP);
        xEventGroupSetBits(eventos, RECONECTAR);
        ESP_LOGW(TAG, "Wi-Fi desconectado: motivo=%u (%s). Reintento en hasta %d ms",
                 motivo, motivo_desconexion(motivo), RED_REINTENTO_MS);
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        ESP_LOGI(TAG, "Wi-Fi iniciado en modo estacion; preparando conexion");
        xEventGroupSetBits(eventos, RECONECTAR);
    }
}

/* Un error de red deshabilita solo la telemetria; no reinicia la cinta. */
#define RED_INTENTAR(expr) do { esp_err_t e = (expr); if (e != ESP_OK) { \
    ESP_LOGE(TAG, "%s: %s; cinta sigue autonoma", #expr, esp_err_to_name(e)); return false; } } while (0)

static bool wifi_iniciar(void)
{
    RED_INTENTAR(nvs_flash_init()); // No borrar NVS automaticamente ante un error.
    RED_INTENTAR(esp_netif_init());
    RED_INTENTAR(esp_event_loop_create_default());
    if (!esp_netif_create_default_wifi_sta()) {
        ESP_LOGE(TAG, "No se pudo crear la interfaz Wi-Fi");
        return false;
    }
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    RED_INTENTAR(esp_wifi_init(&init));
    RED_INTENTAR(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, evento, NULL));
    RED_INTENTAR(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, evento, NULL));
    RED_INTENTAR(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_LOST_IP, evento, NULL));
    wifi_config_t conf = { .sta = {
        .ssid = RED_WIFI_SSID, .password = RED_WIFI_CLAVE,
        .threshold.authmode = WIFI_AUTH_WPA2_PSK,
        .sae_pwe_h2e = WPA3_SAE_PWE_BOTH,
    }};
    if (strlen(RED_WIFI_CLAVE) == 0) conf.sta.threshold.authmode = WIFI_AUTH_OPEN;
    RED_INTENTAR(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    RED_INTENTAR(esp_wifi_set_mode(WIFI_MODE_STA));
    RED_INTENTAR(esp_wifi_set_config(WIFI_IF_STA, &conf));
    RED_INTENTAR(esp_wifi_start());
    RED_INTENTAR(esp_wifi_set_ps(WIFI_PS_NONE));
    return true;
}

static bool agregar(size_t *usado, const char *formato, ...)
{
    if (*usado >= sizeof(json)) return false;
    va_list args;
    va_start(args, formato);
    int n = vsnprintf(json + *usado, sizeof(json) - *usado, formato, args);
    va_end(args);
    if (n < 0 || (size_t)n >= sizeof(json) - *usado) return false;
    *usado += (size_t)n;
    return true;
}

static const char *numero(float valor, char *buf, size_t n)
{
    if (isfinite(valor)) snprintf(buf, n, "%.9g", (double)valor);
    else snprintf(buf, n, "null");
    return buf;
}

static bool serializar(const captura_t *c, const tiny_resultado_t *ia)
{
    size_t n = 0;
    char config_auto[192] = "";
    if (!c->manual) {
        // La prueba manual sigue usando los mismos sensores y contrato. Marcar
        // la revision del transporte solo en automatico para no mezclar lotes.
        snprintf(config_auto, sizeof(config_auto), ",\"control_revision\":4,\"recuperacion_no_metal_ms\":%d,\"salida_no_metal_cm\":%.1f,\"encoder_periodos\":%d,\"servo_ajuste_grados\":%d,\"encoder_pulso_min_us\":%lld",
                 RECUPERACION_ECO_NO_METAL_MS, (double)DISTANCIA_SALIDA_NO_METAL_CM, ENCODER_VENTANA_PERIODOS,
                 SERVO_AJUSTE_GRADOS, (long long)ENCODER_PULSO_MIN_US);
    }
    if (!agregar(&n, "{\"schema_version\":1,\"feature_version\":%d,"
                 "\"device_id\":\"%s\",\"boot_id\":\"%s\",\"cycle_id\":%lu,"
                 "\"firmware\":\"cinta-ia-3\",\"period_ms\":100,\"pretrigger\":%d,\"metal\":%s,"
                 "\"origen\":\"%s\",\"orden_manual\":%lu,"
                 "\"cancelada\":%s,\"descartadas\":%u,\"heap_free\":%lu,\"heap_min\":%lu,\"control_stack_free_min\":%u,"
                 "\"config\":{\"espera_ms\":%d,\"empuje_cm\":%.2f,\"servo_grados\":%d%s},"
                 "\"ia\":{\"activa\":%s,\"clase\":%d,\"voto\":%.4f,\"dudosa\":%s,"
                 "\"inferencia_us\":%lld,\"buffer_bytes\":%u,\"stack_free_min\":%u,"
                 "\"modelo_sha256\":\"%s\",\"origen_entrenamiento\":\"%s\",\"alcance\":\"%s\","
                 "\"fuera_procedimiento\":%s},\"samples\":[",
                 FIRMA_VERSION, dispositivo, arranque, (unsigned long)c->ciclo_id, c->previas,
                 c->metal ? "true" : "false", c->manual ? "manual" : "automatica",
                 (unsigned long)c->orden_manual, c->cancelada ? "true" : "false",
                 atomic_load(&descartadas), (unsigned long)esp_get_free_heap_size(),
                 (unsigned long)esp_get_minimum_free_heap_size(), c->stack_libre_min, ESPERA_CLASIFICACION_MS,
                 (double)DISTANCIA_EMPUJE_METAL_CM, SERVO_DESVIO_GRADOS, config_auto,
                 ia->activa ? "true" : "false", ia->clase, (double)ia->voto,
                 ia->dudosa ? "true" : "false", (long long)ia->inferencia_us,
                 (unsigned)(sizeof(captura_t) + FIRMA_FEATURES * sizeof(float)), ia->stack_libre_min,
                 TINY_MODELO_SHA256, TINY_ORIGEN_ENTRENAMIENTO, TINY_ALCANCE_MODELO,
                 c->manual != (bool)TINY_ENTRENADO_MANUAL ? "true" : "false")) return false;
    for (int i = 0; i < c->cantidad; ++i) {
        const muestra_t *s = &c->muestras[i];
        char dist[32], rpm[32];
        if (!agregar(&n, "%s{\"t_ms\":%lld,\"dist_cm\":%s,\"inductivo\":%s,\"flanco\":%s,"
                     "\"step_hz\":%u,\"rpm_motor\":%s,\"rpm_ts\":%.4f,\"servo_us\":%u,"
                     "\"estado\":%d,\"empuje\":%s}", i ? "," : "", (long long)s->t_ms,
                     numero(s->dist_cm, dist, sizeof(dist)), s->inductivo ? "true" : "false",
                     s->flanco ? "true" : "false", s->step_hz,
                     numero(s->rpm_motor, rpm, sizeof(rpm)), (double)s->rpm_ts, s->servo_us,
                     s->estado, s->empuje ? "true" : "false")) return false;
    }
    return agregar(&n, "]}");
}

static void tarea_red(void *arg)
{
    ESP_LOGI(TAG, "Iniciando Wi-Fi; SSID=\"%s\"; configuracion_red.h", RED_WIFI_SSID);
    if (!wifi_iniciar()) {
        atomic_store(&estado_red, RED_ERROR);
        ESP_LOGE(TAG, "No se pudo iniciar Wi-Fi. Revisar configuracion/NVS; cinta sigue operativa.");
        vTaskDelete(NULL);
        return;
    }
    static captura_t pendiente; /* 100 muestras: fuera de la pila de la tarea HTTP. */
    bool tiene_pendiente = false;
    unsigned intentos = 0;
    int64_t ultimo_sondeo = -500000;
    for (;;) {
        EventBits_t bits = xEventGroupGetBits(eventos);
        if (bits & RECONECTAR) {
            xEventGroupClearBits(eventos, RECONECTAR);
            atomic_store(&estado_red, RED_CONECTANDO);
            ESP_LOGI(TAG, "Intento Wi-Fi %u; conectando al router...", ++intentos);
            esp_err_t conexion = esp_wifi_connect();
            if (conexion != ESP_OK) {
                ESP_LOGW(TAG, "No se pudo iniciar la conexion: %s", esp_err_to_name(conexion));
                xEventGroupSetBits(eventos, RECONECTAR);
            }
        }
        if (!tiene_pendiente && xQueueReceive(cola, &pendiente, pdMS_TO_TICKS(200)) == pdTRUE) {
            tiene_pendiente = true;
        }
        if (!(xEventGroupGetBits(eventos) & CON_IP)) {
            vTaskDelay(pdMS_TO_TICKS(RED_REINTENTO_MS));
            continue;
        }
        int64_t ahora = esp_timer_get_time();
        if (ahora - ultimo_sondeo >= 500000) {
            ultimo_sondeo = ahora;
            sondear_ensayo();
        }
        if (!tiene_pendiente) continue;
        if (!serializar(&pendiente, &pendiente.ia)) {
            ESP_LOGE(TAG, "JSON excedido; captura descartada");
            atomic_fetch_add(&descartadas, 1);
            tiene_pendiente = false;
            continue;
        }
        esp_http_client_config_t conf = {
            .url = RED_SERVIDOR_URL, .method = HTTP_METHOD_POST,
            .timeout_ms = RED_TIMEOUT_MS, .disable_auto_redirect = true,
        };
        esp_http_client_handle_t http = esp_http_client_init(&conf);
        esp_err_t err = ESP_FAIL;
        int estado = 0;
        if (http) {
            err = esp_http_client_set_header(http, "Content-Type", "application/json");
            if (err == ESP_OK) err = esp_http_client_set_post_field(http, json, (int)strlen(json));
            if (err == ESP_OK) err = esp_http_client_perform(http);
            estado = esp_http_client_get_status_code(http);
            esp_http_client_cleanup(http);
        }
        if (err == ESP_OK && estado >= 200 && estado < 300) {
            ESP_LOGI(TAG, "Captura %lu recibida; %d muestras; cola=%u; descartadas=%u",
                     (unsigned long)pendiente.ciclo_id, pendiente.cantidad,
                     (unsigned)uxQueueMessagesWaiting(cola), atomic_load(&descartadas));
            tiene_pendiente = false;
        } else if (err == ESP_OK && estado >= 400 && estado < 500 && estado != 408 && estado != 429) {
            ESP_LOGE(TAG, "HTTP %d: revisar URL/formato; se descarta captura %lu",
                     estado, (unsigned long)pendiente.ciclo_id);
            atomic_fetch_add(&descartadas, 1);
            tiene_pendiente = false;
        } else {
            ESP_LOGW(TAG, "Envio pendiente (HTTP %d, %s); reintento en %d ms",
                     estado, esp_err_to_name(err), RED_REINTENTO_MS);
            vTaskDelay(pdMS_TO_TICKS(RED_REINTENTO_MS));
        }
    }
}

void red_iniciar(void)
{
    ESP_LOGI(TAG, "Red: diagnostico v2; configuracion desde main/configuracion_red.h");
    _Static_assert(sizeof(RED_WIFI_SSID) <= 33, "SSID demasiado largo");
    _Static_assert(sizeof(RED_WIFI_CLAVE) <= 65, "Clave Wi-Fi demasiado larga");
    if (!strlen(RED_WIFI_SSID)) {
        ESP_LOGE(TAG, "Wi-Fi deshabilitado: completar RED_WIFI_SSID en main/configuracion_red.h.");
        return;
    }
    atomic_store(&estado_red, RED_INICIANDO);
    // Receptor HTTP de la red local del laboratorio.
    if (strncmp(RED_SERVIDOR_URL, "http://", 7) != 0) {
        atomic_store(&estado_red, RED_ERROR);
        ESP_LOGE(TAG, "Usar la URL http://IP_LOCAL:8000/api/capturas del servidor de laboratorio");
        return;
    }
    uint8_t mac[6];
    esp_err_t mac_err = esp_read_mac(mac, ESP_MAC_WIFI_STA);
    if (mac_err != ESP_OK) {
        atomic_store(&estado_red, RED_ERROR);
        ESP_LOGE(TAG, "No se pudo leer MAC Wi-Fi: %s", esp_err_to_name(mac_err));
        return;
    }
    snprintf(dispositivo, sizeof(dispositivo), "%02x%02x%02x%02x%02x%02x",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    snprintf(arranque, sizeof(arranque), "%08lx%08lx", (unsigned long)esp_random(), (unsigned long)esp_random());
    const char *ruta = strstr(RED_SERVIDOR_URL + 7, "/");
    if (ruta && (size_t)(ruta - RED_SERVIDOR_URL) + sizeof("/api/ensayos/sondeo") <= sizeof(url_ensayo)) {
        snprintf(url_ensayo, sizeof(url_ensayo), "%.*s/api/ensayos/sondeo", (int)(ruta - RED_SERVIDOR_URL), RED_SERVIDOR_URL);
    } else {
        ESP_LOGW(TAG, "URL sin base valida para ensayos manuales");
    }
    eventos = xEventGroupCreate();
    cola = xQueueCreate(RED_COLA_CAPTURAS, sizeof(captura_t));
    ordenes = xQueueCreate(1, sizeof(ensayo_orden_t));
    if (!eventos || !cola || !ordenes || xTaskCreatePinnedToCore(tarea_red, "telemetria", 8192, NULL, 1, NULL, 0) != pdPASS) {
        if (cola) vQueueDelete(cola);
        if (ordenes) vQueueDelete(ordenes);
        if (eventos) vEventGroupDelete(eventos);
        cola = NULL;
        ordenes = NULL;
        eventos = NULL;
        atomic_store(&estado_red, RED_ERROR);
        ESP_LOGE(TAG, "Sin memoria para red; marcha remota deshabilitada");
    } else {
        ESP_LOGI(TAG, "Cola de red: %u bytes; buffer JSON: %u bytes; pila: 8192 bytes",
                 (unsigned)(RED_COLA_CAPTURAS * sizeof(captura_t)), (unsigned)sizeof(json));
    }
}

bool red_encolar(const captura_t *captura)
{
    if (!cola) return false;
    if (xQueueSend(cola, captura, 0) == pdTRUE) return true;
    atomic_fetch_add(&descartadas, 1);
    ESP_LOGW(TAG, "Cola llena: se descarta captura %lu, sin frenar cinta", (unsigned long)captura->ciclo_id);
    return false;
}


bool red_lista(void) { return atomic_load(&estado_red)==RED_CONECTADA; }
const char *red_device_id(void) { return dispositivo; }
const char *red_boot_id(void) { return arranque; }
const char *red_gemelo_uri(void)
{
    static char uri[256];
    // Reutilizar la IP configurada del servidor de capturas; no duplicar credenciales.
    const char *host=strstr(RED_SERVIDOR_URL,"://");
    host=host?host+3:RED_SERVIDOR_URL;
    size_t n=strcspn(host,":/");
    if (!n || n>200) return "ws://127.0.0.1:8001/ws/device";
    snprintf(uri,sizeof(uri),"ws://%.*s:8001/ws/device",(int)n,host);
    return uri;
}
