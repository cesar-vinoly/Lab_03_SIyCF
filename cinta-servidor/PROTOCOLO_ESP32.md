# Comunicación del gemelo digital

Esta página conserva por ahora el transporte WebSocket del primer laboratorio.
El firmware actual de `cinta_clasificadora` envía capturas HTTP al servidor Python;
no implementa todavía este canal de telemetría continua ni estos mandos.
La adaptación del protocolo del Lab 03, TS, Tiny IA y servo queda para la siguiente etapa.

## Conexión

- Página local: `http://127.0.0.1:8001/`.
- Navegadores: `/ws/ui` en el mismo servidor.
- Dispositivo compatible: `ws://IP_DE_LA_PC:8001/ws/esp32`.
- Para habilitar la red local: `node server.mjs --host 0.0.0.0 --port 8001`.
- El puerto 8000 queda reservado para `servidor_tinyia`.

Al conectar se consulta STATUS. No se reproducen órdenes de sesiones anteriores.
El servidor admite un dispositivo y varios navegadores; los datos caducan a los 3 s.

## Mandos del servidor a la ESP32

Cada comando se envía como un **mensaje de texto WebSocket**, terminado en `\n`.

| Mensaje | Acción | Respuesta de texto esperada |
| --- | --- | --- |
| `F` | Adelante | `Direccion: ADELANTE` |
| `R` | Reversa | `Direccion: REVERSA` |
| `S` | Detención normal | `STOP` |
| `E` | Paro inmediato | `STOP INMEDIATO` |
| `V0` … `V100` | Porcentaje de la velocidad máxima del motor | `Velocidad: 50%` para `V50` |
| `M2`, `M4`, `M8`, `M16` | Micropaso | `Microstep: 1/8` para `M8` |
| `STATUS` | Solicitar telemetría | Una trama de telemetría válida |

Se conserva el límite de 150 RPM del mando de referencia: `V50` solicita el
50 % de esa consigna. Las rampas, los pasos y la ejecución del motor pertenecen
al dispositivo. El visor integra el ángulo a partir del encoder y el estado
nativo recibido, sin generar pasos ni anticipar el movimiento desde un mando.

El micropaso solo se habilita con telemetría reciente, `DIR=STOP` y `RPM_M=0`.
Tras un mando de movimiento se espera una nueva medición de parada.
La respuesta `Detener (S) antes de cambiar M` se registra como rechazo.

Las órdenes se distinguen entre enviadas, confirmadas, rechazadas y sin
respuesta. El límite de respuesta es 2 s, sin reenvío automático.
`S` y `E` se transmiten inmediatamente y cancelan la espera de confirmación
de órdenes previas. La latencia se mide solo con respuestas reconocidas;
`STATUS` no produce una latencia porque la telemetría periódica no lleva ID.

## Telemetría de la ESP32 al servidor

Formato compatible con el servidor antiguo, en una sola línea por mensaje:

```text
DIR=FWD,V=50,M=8,RPM_M=75.0,RPM_T=35.6,RPM_R=35.5,VEL_T=5.50,VEL_R=5.48,DIST=14.0,POS=10.0,ERR=0.3,STATE=OK
```

Estos valores son un ejemplo de formato, no una calibración de la cinta.

| Campo | Significado |
| --- | --- |
| `DIR` | `FWD`, `REV` o `STOP` |
| `V` | Consigna de velocidad, 0–100 % |
| `M` | Micropaso: 2, 4, 8 o 16 |
| `RPM_M` | RPM comandadas al motor, reportadas por la ESP32 |
| `RPM_R` | RPM medidas del rodillo |
| `VEL_R` | Velocidad medida de la banda, cm/s |
| `DIST` | Distancia bruta del HC-SR04, cm; puede retener la última lectura cuando falla el eco |
| `POS` | Posición medida del objeto, cm; `NA` si no hay objeto |
| `STATE` | `OK`, `RAMP` o `DIVERG` |
| `RPM_T` | Referencia de giro enviada por la ESP32, opcional |
| `VEL_T` | Referencia de velocidad enviada por la ESP32, opcional |
| `ERR` | Error de velocidad en porcentaje reportado por la ESP32, opcional |

`DIST` y `POS` también pueden omitirse. Las referencias ausentes se muestran
como `—`. No se estiman a partir del porcentaje del mando, el diámetro ni los
engranajes. Se mantiene la escala de posición 0–45 cm de los paneles antiguos;
no se altera ninguna dimensión del modelo 3D.

El servidor calibra `POS` una sola vez al recibirla: `pos = POS_ESP + 3.7 cm`,
según la referencia física 6,3 → 10 cm. `control/telemetry.mjs` contiene el
offset. La trama ESP conserva su formato; los mensajes a la web y las
instantáneas ya contienen la posición calibrada. React no vuelve a sumarlo.
No se cambian `DIST`, encoder ni referencias de velocidad. `NA`, null y
ausencia permanecen null. No se limita POS a 45 para fabricar detecciones;
las posiciones calibradas fuera de 0–45 cm no muestran el cubo. La pantalla de la ESP conserva su referencia original:
este cambio modifica el servidor, no el firmware.

También se admite un mensaje JSON compacto, con los mismos campos en minúscula
o mayúscula, directamente o dentro de `{"type":"telemetry","data":{...}}`.
Usar `null` para posiciones o referencias ausentes. Enviar normalmente una
trama cada 200–300 ms; después de 3 s sin telemetría válida los indicadores
pasan a “Sin datos”. Las líneas incompletas o no numéricas se descartan.

## Presentación y movimiento

Las gráficas muestran encoder/ultrasonido y las referencias recibidas de la ESP32.
Se retiraron la función de transferencia, su curva, su columna CSV y el PID del servidor.
`control/motion.mjs` solo conserva la observación compartida de movimiento.
Los mensajes `controller` transportan `commandPercent`, `motion` y `feedback`;
no contienen parámetros ni salidas de un regulador.

Se mantienen las fallas manuales heredadas: pérdida y sobrecarga reducen el mando;
deslizamiento modifica solamente la representación de posición. No se envían órdenes
sin un dispositivo conectado. Los CSV nuevos tienen cinco columnas; los anteriores
se conservan como registros históricos.

## Pala del servo

El control «Pala del servo · vista previa» actúa solo sobre `Pala_servo.glb`.
No utiliza WebSocket ni controla el servo físico. El barrido de 0 a 60 grados
representa reposo a empuje; no son grados absolutos del MG996R. La animación se
realiza a 60 grados por segundo. La sincronización con `servo_us` y el estado
real de empuje requiere la próxima adaptación del protocolo.
