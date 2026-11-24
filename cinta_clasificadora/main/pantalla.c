#include "pantalla.h"
#include "pantalla_modelo.h"
#include "pantalla_fuente.h"
#include "red.h"
#include <stdio.h>
#include <string.h>
#include "driver/i2c_master.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

static const char *TAG = "pantalla";
typedef struct { lab_snapshot_t estado; int64_t t_us; } pantalla_muestra_t;
/* La cola se crea antes del control y nunca se destruye mientras este corre. */
static QueueHandle_t ultima_muestra;
/* Bus, framebuffer y temporizador de aviso: exclusivos de tarea_pantalla. */
static i2c_master_bus_handle_t bus;
static i2c_master_dev_handle_t oled;
static uint8_t frame[1 + 128 * 64 / 8];
static int64_t regimen_desde_us;

static void texto(int x, int y, const char *cadena)
{
    /* Recortar al borde: una linea larga nunca invade el renglon siguiente. */
    for (; *cadena && x >= 0 && x + 5 <= 128; ++cadena, x += 6) {
        unsigned char c = (unsigned char)*cadena;
        if (c < 32 || c > 126) c = '?';
        for (int col = 0; col < 5; ++col) for (int fila = 0; fila < 8; ++fila) {
            int py = y + fila;
            if (py >= 0 && py < 64 && (font5x7[c - 32][col] & (1U << fila)))
                frame[1 + (py / 8) * 128 + x + col] |= (uint8_t)(1U << (py % 8));
        }
    }
}

static esp_err_t enviar_frame(void)
{
    const uint8_t area[] = {0x00, 0x21, 0, 127, 0x22, 0, 7};
    esp_err_t err = i2c_master_transmit(oled, area, sizeof(area), 50);
    if (err == ESP_OK) err = i2c_master_transmit(oled, frame, sizeof(frame), 50);
    return err;
}

static esp_err_t iniciar_oled(void)
{
    /* Reutilizar el bus al recuperar la OLED; no acumular dispositivos/tareas. */
    esp_err_t err;
    if (!bus) {
        i2c_master_bus_config_t config = {
            .i2c_port = I2C_NUM_0, .sda_io_num = PIN_OLED_SDA, .scl_io_num = PIN_OLED_SCL,
            .clk_source = I2C_CLK_SRC_DEFAULT, .glitch_ignore_cnt = 7,
            .flags.enable_internal_pullup = true,
        };
        err = i2c_new_master_bus(&config, &bus);
        if (err != ESP_OK) return err;
    }
    err = i2c_master_probe(bus, OLED_DIRECCION, 50);
    if (err != ESP_OK) return err;
    if (!oled) {
        i2c_device_config_t config = {.dev_addr_length = I2C_ADDR_BIT_LEN_7,
            .device_address = OLED_DIRECCION, .scl_speed_hz = OLED_I2C_HZ};
        err = i2c_master_bus_add_device(bus, &config, &oled);
        if (err != ESP_OK) return err;
    }
    /* Misma orientacion, direccionado horizontal y contraste del Lab 1. */
    const uint8_t init[] = {0x00,0xAE,0xD5,0x80,0xA8,0x3F,0xD3,0x00,0x40,
        0x8D,0x14,0x20,0x00,0xA1,0xC8,0xDA,0x12,0x81,0xCF,0xD9,0xF1,
        0xDB,0x40,0xA4,0xA6,0x2E,0xAF};
    return i2c_master_transmit(oled, init, sizeof(init), 100);
}

static void dibujar(const pantalla_muestra_t *m)
{
    int64_t ahora = esp_timer_get_time();
    const lab_snapshot_t *s = &m->estado;
    pantalla_vista_t v = pantalla_calcular(s, m->t_us, ahora);
    char linea[48];
    memset(frame, 0, sizeof(frame));
    frame[0] = 0x40;
    if (!v.vigente) {
        regimen_desde_us = 0;
        texto(0, 0, "CINTA TRANSPORTADORA");
        texto(0, 11, "ESP32 + TMC2208");
        texto(0, 33, m->t_us ? "DATOS VENCIDOS" : "Iniciando...");
        snprintf(linea, sizeof(linea), "WiFi:%s WS:%s", red_lista() ? "OK" : "---",
                 lab03_enlace_vigente() ? "OK" : "---");
        texto(0, 55, linea);
        return;
    }
    const char *sentido = v.moviendo ? (s->direccion > 0 ? "FWD" : "REV") : "STOP";
    snprintf(linea, sizeof(linea), "%s V:%u%% M:%d", sentido, v.porcentaje, MOTOR_MICROPASOS);
    texto(0, 0, linea);
    if (v.encoder_valido)
        snprintf(linea, sizeof(linea), "RPM T:%.1f R:%.1f", (double)v.rpm_teoricas, (double)v.rpm_reales);
    else snprintf(linea, sizeof(linea), "RPM T:%.1f R:--.-", (double)v.rpm_teoricas);
    texto(0, 11, linea);
    if (v.encoder_valido)
        snprintf(linea, sizeof(linea), "cm/s T:%.1f R:%.1f", (double)v.cm_s_teoricos, (double)v.cm_s_reales);
    else snprintf(linea, sizeof(linea), "cm/s T:%.1f R:--.-", (double)v.cm_s_teoricos);
    texto(0, 22, linea);
    if (isfinite(v.posicion_cm)) snprintf(linea, sizeof(linea), "Pos:%.1fcm", (double)v.posicion_cm);
    else snprintf(linea, sizeof(linea), "Pos:--.-cm");
    texto(0, 33, linea);

    if (!v.en_regimen) regimen_desde_us = 0;
    else if (!regimen_desde_us) regimen_desde_us = ahora;
    bool divergencia = v.encoder_valido && v.rpm_teoricas > 5.0f && regimen_desde_us &&
        ahora - regimen_desde_us >= (int64_t)OLED_REGIMEN_MS * 1000 &&
        v.error_pct > OLED_ERROR_LIMITE_PCT;
    const char *estado = s->emergencia ? "FALLA" : s->ensayo ? "ENSAYO" :
        !v.encoder_valido ? "S/ENC" : divergencia ? "DIVERG" :
        v.moviendo && !v.en_regimen ? "RAMP" : "OK";
    if (isfinite(v.error_pct)) snprintf(linea, sizeof(linea), "Err:%.1f%% %s", (double)v.error_pct, estado);
    else snprintf(linea, sizeof(linea), "Err:--.-%% %s", estado);
    texto(0, 44, linea);
    /* Sustituye BT:CINTA_UTEC: este firmware comunica por Wi-Fi/WebSocket. */
    snprintf(linea, sizeof(linea), "HC:%s WF:%s WS:%s", v.eco_valido ? "OK" : "--",
             red_lista() ? "OK" : "--", lab03_enlace_vigente() ? "OK" : "--");
    texto(0, 55, linea);
}

static void tarea_pantalla(void *arg)
{
    (void)arg;
    bool lista = false, aviso = false;
    TickType_t despertar = xTaskGetTickCount();
    for (;;) {
        esp_err_t err = ESP_OK;
        if (!lista) {
            err = iniciar_oled();
            lista = err == ESP_OK;
        }
        if (lista) {
            pantalla_muestra_t muestra = {0};
            (void)xQueuePeek(ultima_muestra, &muestra, 0);
            dibujar(&muestra);
            err = enviar_frame();
        }
        if (err != ESP_OK) {
            lista = false;
            regimen_desde_us = 0;
            if (!aviso) ESP_LOGW(TAG, "OLED no disponible: %s; reintento en %d ms. Control sigue activo.",
                                esp_err_to_name(err), OLED_REINTENTO_MS);
            aviso = true;
            if (bus) (void)i2c_master_bus_reset(bus);
            vTaskDelay(pdMS_TO_TICKS(OLED_REINTENTO_MS));
            despertar = xTaskGetTickCount();
            continue;
        }
        if (aviso) ESP_LOGI(TAG, "OLED recuperada");
        aviso = false;
        xTaskDelayUntil(&despertar, pdMS_TO_TICKS(OLED_PERIODO_MS));
    }
}

void pantalla_iniciar(void)
{
    if (ultima_muestra) return;
    ultima_muestra = xQueueCreate(1, sizeof(pantalla_muestra_t));
    if (!ultima_muestra ||
        xTaskCreatePinnedToCore(tarea_pantalla, "oled", 4096, NULL, 1, NULL, 0) != pdPASS) {
        if (ultima_muestra) vQueueDelete(ultima_muestra);
        ultima_muestra = NULL;
        ESP_LOGW(TAG, "Sin memoria para OLED; control sigue activo");
        return;
    }
    ESP_LOGI(TAG, "SSD1306 128x64, SDA=%d SCL=%d direccion=0x%02X; CPU0 cada %d ms",
             PIN_OLED_SDA, PIN_OLED_SCL, OLED_DIRECCION, OLED_PERIODO_MS);
}

void pantalla_publicar(const lab_snapshot_t *estado, int64_t t_us)
{
    if (!ultima_muestra || !estado) return;
    pantalla_muestra_t muestra = {.estado = *estado, .t_us = t_us};
    (void)xQueueOverwrite(ultima_muestra, &muestra);
}
