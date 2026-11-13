idf_component_register(SRCS "tiny_ia.cpp" "red.c" "captura.c" "main.c" "hardware.c" "clasificacion.c" "velocidad.c"
                       INCLUDE_DIRS "."
                       PRIV_REQUIRES lab03_runtime esp_driver_gpio esp_driver_gptimer esp_driver_mcpwm esp_timer esp_rom
                                     esp_wifi esp_event esp_netif esp_http_client nvs_flash esp_system esp_hw_support)
