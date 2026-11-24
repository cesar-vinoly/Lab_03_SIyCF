# Integración posterior, cuando termine la captura de datos

## 1. Crear una copia de trabajo del firmware

Conservar el firmware probado y los datasets antes de migrar. Agregar `firmware/components/lab03_runtime` como componente local del proyecto futuro. Su manifiesto instalará el cliente WebSocket 1.8.0 con ESP-IDF Component Manager cuando el usuario compile. No agregarlo al firmware activo durante esta etapa de captura.

El componente no tiene `app_main`: necesita los callbacks del montaje. Agregar `lab03_runtime` a `REQUIRES` del futuro `main`. Copiar `adaptador_ia.h` e `inferencia_modelo.cpp` al `main` de esa copia e incorporar el `.cpp` a sus fuentes. Las rutas de inclusión del componente no dependen del `main`; el adaptador sí usa el contrato `captura_t` actual.

## 2. Conservar un único dueño del hardware

Extraer el contenido actual del bucle de `main.c` a un módulo de control con estado privado. Sus funciones serán:

```c
esp_err_t iniciar_control(void);
void paso_control(int64_t ahora_us, float dt_s, bool muestrear100, lab_snapshot_t *salida);
void parar_control(void);
```

- `iniciar_control` inicializa `hardware_iniciar`, `ciclo_iniciar` y `velocidad_iniciar` en CPU1. Instalar los ISR desde esa tarea deja su afinidad asociada al núcleo de control. Auditar el uso de IRAM según las rutinas concretas.
- `paso_control` realiza un solo paso; no tiene `for(;;)` ni `vTaskDelay`. El runtime ya planifica cada 20 ms. Conservar el modo manual, la cola de órdenes de ensayo y sus protecciones.
- Usar `muestrear100` para leer/rearmar ultrasonido, capturar inductivo, actualizar autómata, captura y PI. Conservar el cálculo TS con la media de STEP aplicada en el intervalo durante la rampa. **No llamar al TS a 20 ms ni desde IA/red.**
- Copiar cada paso el estado persistente a `salida`, incluso cuando no se muestrea. `estado` conserva el mismo orden ESPERA..REARME; FALLA es un estado adicional reservado. Las posiciones no calibradas se dejan en `NAN`, que se serializa como `null`.
- Ante falla confirmada, el callback consulta el latch de `seguridad.h` antes de aplicar movimiento. Mientras esté enclavado manda `motor_aplicar(0)` y emite la alarma, sin esperar ninguna cola. El rearme requiere una acción explícita y la desaparición de la falla. Una lectura `sin_eco` aislada no debe disparar ese diagnóstico.
- `parar_control` debe poder detener las salidas conocidas aun si la inicialización quedó a medias. Esta función es una orden, no confirmación de que el motor ya se detuvo físicamente.

No colocar hardware, modelo mutable, escritura de NVS, HTTP, JSON ni inferencia en un mutex compartido entre tareas. Pasar copias acotadas por las colas. `lab03_evento` y `lab03_encolar_firma` no esperan espacio.

## 3. Mover la inferencia sin duplicarla

En la finalización de `captura_actualizar`, reemplazar la llamada síncrona `tiny_evaluar(&actual)` por `lab_encolar_captura(&actual)` en la copia futura. Conservar la captura original para su registro/etiquetado. No encolar firmas parciales/canceladas ni modificar las 400 features de las 100 lecturas (versión 2). Usar un encabezado reentrenado para este contrato; los modelos de 40 entradas no son compatibles.

El resultado se publica después como mensaje `ia`, con el mismo `object_id=ciclo_id` y timestamp de la firma. No modificar retrospectivamente un `captura_t` ya enviado a otra tarea. El JSON HTTP de captura no contendrá de inmediato ese resultado: si más adelante se desea unirlo, hacerlo en el servidor por placa/arranque/objeto. **El adaptador WS y el HTTP actual generan hoy identificadores de arranque independientes**: antes de unir ambas fuentes, extraer la creación de `device_id/boot_id` a un único módulo compartido. Mientras tanto, mantener los datasets independientes.

`inferir_modelo` se pasa como callback `inferir`; el objeto del modelo solo se usa en CPU0. Sin encabezado entrenado devuelve `activa=false, clase=-1`. El nombre de las tres clases y el umbral de voto se conservan. La señal de duda es acuerdo entre árboles, no probabilidad calibrada.

## 4. Conectar la red una sola vez

Mantener una única inicialización Wi-Fi/event loop/NVS. El runtime WebSocket presupone que existe una red inicializada y consulta `red_lista()`; no crea otra interfaz Wi-Fi. Se puede conservar temporalmente la tarea HTTP de captura/ensayos en CPU0, junto con WS, y medir la carga. Más adelante se podrá unificar el transporte sin mezclar el esquema de firmas con el de telemetría.

Ejemplo de arranque **después de implementar los callbacks**:

```c
extern lab_ia_t inferir_modelo(const float x[400]);
static bool red_lista(void) { return strcmp(red_estado_texto(), "conectado") == 0; }

void app_main(void) {
    red_iniciar();  // Inicializar una vez; conservar tareas HTTP si siguen siendo necesarias.
    static const lab_hooks_t hooks = {
        .iniciar_control = iniciar_control,
        .paso_control = paso_control,
        .parar = parar_control,
        .inferir = inferir_modelo,
        .red_lista = red_lista,
        .ws_uri = "ws://IP_DE_LA_PC:8765/ws/device",
    };
    esp_err_t err = lab03_iniciar(&hooks);
    // Gestionar err antes de habilitar movimiento. No continuar el main antiguo en paralelo.
}
```

Incluir `<string.h>`, `red.h` y `lab03_runtime.h` en el archivo real. Confirmar dual core (`CONFIG_FREERTOS_UNICORE` desactivado) y Wi-Fi en CPU0. El `app_main` actual está en CPU0: el componente crea explícitamente `lab_control` en CPU1, así que cambiar solo la prioridad del main no implementa esta migración.

## 5. Instrumentar eventos en sus puntos reales

Usar `lab03_evento(nombre, ciclo_id, esp_timer_get_time(), valor, deadline_us)`. `valor=NAN` y `deadline_us=0` significan sin dato. Para una falla fuera de ciclo, reservar un identificador de episodio único y usar el mismo en `falla`, `alarma` y `motor_detenido`.

| Evento | Momento de registro |
|---|---|
| `objeto` | Primera observación de entrada que se quiere usar como inicio del deadline; documentar si es cruda o filtrada |
| `decision_a`, `decision_b`, `dudoso` | Cuando la decisión está disponible; una sola decisión por objeto |
| `servo_orden` | Al cambiar efectivamente la consigna del servo |
| `servo_confirmado` | Solo ante realimentación física de posición o medición externa correlacionada |
| `falla` | Diagnóstico/entrada de falla confirmada, con tipo codificado en valor |
| `motor_orden_parar` | Al mandar STEP=0/disable |
| `motor_detenido` | Solo con confirmación física fiable; ausencia de pulsos inválidos no basta |
| `alarma` | Al activar la alarma local |
| `fin_ciclo` | Cuando termina realmente el episodio de transporte, sin contar muestras como objetos |

Para `decision_a`, pasar `deadline_us` calculado según distancia real, velocidad y estrategia del empuje. El helper `sincronizacion.h` implementa el cálculo de llegada bajo velocidad constante. El montaje actual empuja a 30 cm con el objeto desplazándose; esa geometría debe medirse y no reemplazarse automáticamente por el ejemplo de preposicionamiento del PDF.

## 6. Validar antes de adoptar la nueva versión

1. Compilación a cargo del usuario. Medir Flash (`idf.py size`) y comparar con/sin Tiny IA; el tamaño del `.h` no es Flash consumida.
2. Con servidor apagado, comprobar que el control local y el modo manual conservan su comportamiento.
3. Llenar colas en un ensayo controlado y verificar incremento de descartes, nunca espera del control.
4. Verificar el periodo de 20 ms, TS a 100 ms, duración máxima y jitter bajo inferencia + HTTP + WS. El campo `control_exec_us` representa el máximo de los pasos desde la última instantánea.
5. Medir las pilas de **cada** tarea y heap mínimo. El runtime publica la pila del control y heap mínimo; para documentar IA/red, añadir su mínimo con `uxTaskGetStackHighWaterMark` durante el ensayo. Las reservas iniciales (6/6/6 KiB más 4 KiB del cliente) son propuestas, no consumos medidos. La pila de IA se amplió para la firma y copia de trabajo de 400 floats cada una. La cola de cuatro firmas reserva al menos 6400 bytes de vectores, más metadatos y estructura FreeRTOS.
6. Ensayar parada física y tiempos del servo con instrumentos, sin inferirlos de los logs de orden. Revisar watchdog de tarea/ISR y su configuración con los deadlines reales; el watchdog de 5 s del proyecto actual no demuestra parada en 200 ms.
7. Conectar después la UI del gemelo a `/ws/observer`, medir retraso de alarma visible y agregar simulación acelerada separada del reloj del MCU.
