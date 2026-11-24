# Protocolo WebSocket v1

Servidor independiente: puerto 8765. Productor ESP32 en `/ws/device`; futuro gemelo como observador de solo lectura en `/ws/observer`. JSON texto hasta 16 KiB, sin compresión. Se rechazan binarios, versiones desconocidas y números NaN/Infinity. `null` expresa ausencia de medición, no cero.

Envolvente obligatoria:

```json
{"v":1,"device_id":"aabbccddeeff","boot_id":"a1b2c3d4","seq":1,"t_us":100000,"kind":"event","data":{"name":"objeto","object_id":1,"value":null,"deadline_us":null}}
```

- `device_id`: MAC/identificador, sin credenciales. `boot_id`: nuevo en cada arranque del productor.
- `seq`: contador de transmisión creciente, comienza en 1. Se conserva al reconectar el mismo arranque. El servidor deduplica por placa/arranque/secuencia y rechaza un mismo ID con contenido distinto.
- `t_us`: reloj monotónico MCU, no UTC del servidor. En IA es el fin de inferencia; `input_t_us` conserva el tiempo de la firma. Eventos y snapshots pueden llegar con timestamps desordenados por las colas; el análisis temporal los ordena por fuente, no por recepción.
- `kind`: `snapshot`, `event` o `ia`. El validador ejecutable está en `servidor/protocolo.py`.

## Snapshot (10 Hz nominales)

Campos: `estado`, `manual`, `metal`, `encoder_valido`, `rpm_motor`, `rpm_ts`, `setpoint_rpm`, `dist_cm`, `pos_m`, `pos_real_m`, `step_hz`, `servo_us`, `control_exec_us`, `control_late_us`, `control_missed`, `heap_min`, `stack_min`, `dropped_ia`, `dropped_events`, `coalesced`.

Las RPM son del **motor**, no del rodillo. Posiciones en metros y solo si fueron calibradas. `pos_real_m` requiere una medición independiente de la estimación. `control_exec_us` y `control_late_us` son máximos de los pasos desde la última instantánea; `control_missed` es acumulativo. `heap_min` y `stack_min` están en bytes según ESP-IDF. `coalesced` cuenta reemplazos aproximados de snapshots pendientes (es diagnóstico, no una medida de eventos perdidos).

## Event

`name` usa los valores enumerados por `lab_evento_t` y `EVENTOS`. `object_id` identifica un objeto o episodio de falla. `value` es opcional; documentar su semántica según evento. `deadline_us` representa el plazo **relativo a ese evento**, no una fecha absoluta. Ejemplo: deadline de llegada al servo desde `decision_a`.

## IA

`object_id`, `input_t_us`, `inferencia_us`, `activa`, `clase`, `voto`, `dudosa`. Clases: -1 inactivo, 0 normal, 1 intermitente, 2 anómala. `voto` es acuerdo de árboles. Resultado advisory sin acceso al motor. No contiene las 100 muestras originales; la captura Tiny IA mantiene su propio esquema de dataset.

## Servidor y observadores

Después de persistir, el productor recibe `{"type":"ack","seq":1}`. El cliente C preparado no usa este ACK para retransmitir: el flujo es best effort. El ACK demuestra recepción en el servidor, nunca actuación física. Las desconexiones/colas pueden perder eventos y el informe lo debe reflejar.

El observador recibe `{"type":"telemetry","message":{...}}` y `{"type":"alarm","device_id":"...","boot_id":"...","codigo":"..."}`. La recepción puede producir alarmas advisory de divergencia RPM/TS, posición, carga, dudas, secuencia o telemetría vencida. Los umbrales iniciales son ejemplos a calibrar. Un observador lento se desconecta sin frenar la recepción.

La suscripción es en vivo; no envía automáticamente todo el historial. El histórico está en SQLite y se exporta con `herramientas.analizar`. Las alarmas derivadas se difunden en vivo; el dato original queda persistido y se puede volver a analizar. No hay órdenes de motor, reinicio o actualización de firmware en este protocolo.

El plazo de alarma visible de la futura HMI se medirá de extremo a extremo. No restar directamente UTC del servidor menos `t_us` del MCU para afirmar latencia de red. Hacen falta sincronización de relojes o una medición de ida/vuelta e incertidumbre.
