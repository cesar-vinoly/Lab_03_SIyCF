# Módulos preparados para completar el Laboratorio 03

Estado actualizado: **integrado con el firmware y el gemelo digital**. Ver [INTEGRACION_GEMELO_LAB03.md](../INTEGRACION_GEMELO_LAB03.md) para iniciar y operar. `cinta-servidor/run.bat` inicia `servidor.integrado` y usa sus módulos de registro, supervisión y análisis. El runtime activo adaptado está en `cinta_clasificadora/components/lab03_runtime`; la copia `firmware/` de esta carpeta se conserva como referencia.

Lo que sigue documenta la preparación original y el uso aislado para pruebas; no describe el procedimiento de arranque integrado actual.

## Contenido

| Ruta | Qué está preparado | Qué queda por hacer |
|---|---|---|
| `firmware/components/lab03_runtime` | Componente ESP-IDF: tareas fijadas a núcleos, colas acotadas, medición de tiempos, cliente WebSocket | Adaptar el bucle actual a los callbacks, compilar y probar en la ESP32 |
| `firmware/adaptador_ia.h` | Conversión de la captura actual de 100 muestras a las mismas 400 entradas (versión 2) | Sustituir la inferencia síncrona por el envío a la cola en la futura integración |
| `firmware/inferencia_modelo.cpp` | Inferencia del modelo entrenado, ejecutada en la tarea IA | Incorporar `modelo_calidad.h` real; sin modelo informa inactivo |
| `seguridad.h`, `sincronizacion.h` dentro del componente | Enclavamiento lógico determinista y cálculo del margen de llegada al servo | Definir entradas de falla, medir geometría/tiempos y verificar el enclavamiento físico |
| `servidor/` | Recepción WebSocket, SQLite, difusión a observadores, alarmas advisory | Conectar la ESP32 y luego el gemelo digital |
| `herramientas/analizar.py` | Análisis temporal por objeto, mínimos/máximos, ciclos y tasas | Recoger trazas reales completas y feedback físico |
| `herramientas/operacion.py` | Velocidad lineal, viabilidad del servo, OEE y pérdidas | Introducir mediciones y resultados reales de clasificación |
| `herramientas/simular.py` | Tráfico sintético para probar el protocolo y las alarmas | La simulación acelerada del gemelo se hará después |
| `tests/` | Pruebas aisladas de protocolo, WebSocket y análisis | Medir desempeño y memoria en el montaje |
| `docs/` | Matriz de requisitos, contrato de datos e instrucciones de integración | Completar evidencias del informe, fotos y video |

El modelo TS de orden 1 existente es el **modelo dinámico de la planta STEP -> RPM**, con periodo de 100 ms. El TSK de riesgo de la sección 8 es otra función, opcional. No se reemplaza ni se reidentifica el modelo de la cinta y no se añade una política de reducción de velocidad sin validarla.

## Reparto de los dos núcleos

| Tarea | Núcleo | Prioridad propuesta | Responsabilidad |
|---|---:|---:|---|
| `lab_control` | 1 | 5 | Dueño único de hardware, autómata y estado TS/PI. Actuadores a 20 ms; sensores/TS/PI a 100 ms |
| `lab_ia` | 0 | 3 | Una inferencia por prueba completa de 10 s; copia independiente de 400 floats |
| `lab_tx` | 0 | 2 | Serializa y envía telemetría sin bloquear el control |
| Cliente WebSocket interno | 0 | 2 | Conexión, recepción y reconexión |
| Wi-Fi / sistema | Según ESP-IDF; Wi-Fi en 0 | Prioridades del SDK | Se conservan; no se elevan las tareas de usuario sobre la radio |

La inferencia corre en paralelo al control. TS y PI permanecen juntos porque comparten estado y son pequeños; dividir sus operaciones entre núcleos introduciría sincronización y jitter. Tener dos núcleos no duplica automáticamente el rendimiento. Hay que medir ejecución, retraso, periodos omitidos, colas, heap y pilas bajo tráfico real.

Colas: cuatro firmas, 32 novedades/eventos/resultados y una instantánea reemplazable. Los productores usan timeout cero. Al llenarse una cola se contabiliza el descarte; no se detiene el control para esperar al servidor. Los eventos llevan identificador de objeto y las sesiones identificador de arranque. El transporte preparado es **best effort**, con pérdidas detectables: no garantiza conservación de todos los eventos durante desconexiones prolongadas.

## Probar el servidor por separado

Desde esta carpeta:

```powershell
# El entorno local ya está preparado. Para recrearlo en otro equipo:
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

# Puerto distinto al 8000 usado por la captura actual. Base de PRUEBAS separada.
.\.venv\Scripts\python.exe -m servidor.app --port 8765 --db datos/pruebas_ws.sqlite3
```

En otra terminal, también en esta carpeta:

```powershell
.\.venv\Scripts\python.exe -m herramientas.simular --escenario decision_lenta --ws ws://127.0.0.1:8765/ws/device
.\.venv\Scripts\python.exe -m herramientas.analizar salida/simulada.jsonl --salida salida/informe_simulado.json
```

`simulada.jsonl` es evidencia de prueba de software, **no datos reales para entrenar la Tiny IA**. El generador escribe `device_id=SIMULADO_NO_ES_ESP32`. Otros escenarios: `normal`, `deslizamiento`, `servo_sin_feedback`, `falla_parada_lenta`.

Para recibir la ESP32 más adelante, ejecutar con `--host 0.0.0.0 --db datos/telemetria.sqlite3` y configurar `ws://IP_DE_LA_PC:8765/ws/device`. La conexión es de la red local y no requiere token. No se copian credenciales Wi-Fi a esta carpeta. El puerto WebSocket no sirve una página HTML. El futuro gemelo se suscribirá a `/ws/observer`; por ahora no hay HMI ni órdenes remotas de motor.

Analizar la base real cuando exista:

```powershell
.\.venv\Scripts\python.exe -m herramientas.analizar datos/telemetria.sqlite3 --salida salida/informe.json --exportar-jsonl salida/telemetria.jsonl
```

## Lo que todavía no se puede afirmar

- No se compiló ni cargó el componente ESP32; esa etapa queda a cargo del usuario.
- Los callbacks se deben integrar según [la guía](docs/INTEGRACION.md). Copiar el componente por sí solo no migra el firmware ni cambia las tareas actuales.
- Las alarmas de supervisión no accionan actuadores. La parada debe resolverse localmente y el interlock físico debe ser independiente de red, IA y TSK.
- Sin realimentación del desviador no se puede confirmar su posición. El pulso PWM representa una orden.
- El HC-SR04 mide distancia al reflector; no equivale directamente a posición longitudinal ni velocidad de banda sin calibrar geometría. Se usa `null` cuando no hay medición.
- Los deadlines del PDF son sugeridos. El actual muestreo de 100 ms y la espera de 1000 ms no demuestran decisión en 50 ms. No se alteran mientras se recolectan datos.
- `CUMPLE_EN_TRAZA` es evidencia de un ensayo, no una prueba formal ni garantía para todos los estados.
- El gemelo digital, la simulación acelerada, la UI y los controles que eventualmente se autoricen se desarrollarán luego.

## Validación de software

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Las pruebas utilizan puertos efímeros y bases temporales. Incluyen recepción/broadcast real por WebSocket, reconexión y deduplicación, errores de protocolo, observador lento, ausencia de feedback, propiedades temporales y cálculos operativos. No interactúan con la ESP32 ni con `servidor_tinyia`.

## Referencias

- Documento del laboratorio, secciones 5, 6, 9, 10 y 12. Revisión de cumplimiento: [REQUISITOS.md](docs/REQUISITOS.md).
- [WebSocket oficial de Espressif](https://docs.espressif.com/projects/esp-protocols/esp_websocket_client/docs/latest/index.html). Dependencia fijada a **1.8.0**; se verificaron `task_core_id_set`, `task_core_id` y reconexión tras cierre en el [header de esa versión](https://github.com/espressif/esp-protocols/blob/websocket-v1.8.0/components/esp_websocket_client/include/esp_websocket_client.h). Esos campos no están en 1.6.1.
- [Servidor asyncio de websockets 15.0.1](https://websockets.readthedocs.io/en/15.0.1/reference/asyncio/server.html). Dependencia Python fijada a esa versión.
