# Requisitos, estado y evidencia pendiente

Fuente: `C:/Users/cesar/Downloads/Laboratorio-03-Clasificador.pdf`, versión septiembre 2026. Los componentes, métodos y deadlines del enunciado son orientativos donde así se indica. Se conserva la clasificación inductiva + ultrasónica elegida por el equipo.

| Sección | Requisito | Preparado / existente | Pendiente real |
|---|---|---|---|
| 3–5 | Estrategia, autómata híbrido y control | Firmware actual, TS de planta, PI, servo a 30 cm | Diagramas, justificación inductiva y calibración |
| 5.3 | STR / STA / STD | Runtime STR preparado; análisis Python STD | STA y gemelo digital se harán luego |
| 6.1 | Sensores y control ≤100 ms sugerido | Planificador 20/100 ms, métricas de ejecución/retraso/periodos omitidos | Medición bajo carga en MCU; ejecución a periodo no implica deadline garantizado |
| 6.1 | Decisión ≤50 ms sugerido | Verificador parametrizable conserva 50 ms como referencia | El muestreo actual de 100 ms y espera de 1000 ms requieren rediseño de decisión o justificación de otro plazo; separar decisión de espera de colocación |
| 6.1–6.2 | Desviador antes de llegada | Eventos separados de orden/confirmación y cálculo de vuelo | Tiempo de servo real, distancia desde clasificación al punto de actuación, geometría y margen |
| 6.1 | Parada ante falla ≤200 ms | Latch determinista y verificación de falla -> parada confirmada + alarma | Entrada de emergencia/interlock físico, diagnóstico de falla, feedback y medición real |
| 6.3 | Propiedades temporales | Verificador de respuestas acotadas en trazas | No es model checking; documentar cobertura, evidencia incompleta y ensayos de fallas |
| 7 opcional | Tiny IA y métricas | Captura/entrenamiento existentes; adaptador a tarea independiente | Completar lote, entrenar, evaluar, desplegar y medir memoria/inferencia |
| 8 opcional | TSK de riesgo y reducción de velocidad | Separado conceptualmente del TS de planta | No implementado ni activado; definir entradas válidas y validar política si el equipo decide incluirlo |
| 9.1 | Gemelo: velocidad, posición, autómata, señales, IA, contadores | Contrato WS + observador, contadores diferidos | Visualización y simulación acelerada posteriores; sincronización de relojes |
| 9.2 | Desviador no actúa | Falta de confirmación se reporta SIN_EVIDENCIA | Hace falta sensor/observación física; no afirmar falla solo por la orden |
| 9.2 | Sensor fuera de rango | Validación de mensajes, null para ausencia de lectura | Rangos físicos calibrados y diagnóstico que diferencie pieza ausente de sensor averiado |
| 9.2 | Decisión tardía / divergencia posición / dudosos | Análisis de deadlines, comparador de posiciones si existen ambas, tasa por objeto | Calibración de posición real y umbrales; evaluación independiente |
| 10 | Mín./máx., ciclo, cuello de botella, OEE y pérdidas | Scripts de métricas y funciones operativas | Medir dimensiones, corriente si se agrega sensor, tiempos nominales, calidad y costes reales |
| 12 | Informe, video, ≥3 fotos, fuente/dataset/modelo, ZIP | Código organizado y guía de evidencia | Redacción final, fotos, video ≤5 min y empaquetado cuando esté validado |

## Instrumentación que falta definir

- Radio efectivo del rodillo y transmisión medida para pasar de RPM de motor a m/s. La relación configurada es 19/40; verificar montaje.
- Geometría del HC-SR04 para convertir distancia en posición. No suponer que `dist_cm/100` es la coordenada de la lata.
- Feedback del servo; una interpolación de pulso a ángulo no es medición de posición.
- Confirmación física de motor detenido. El código actual devuelve lectura inválida cuando no recibe pulsos.
- Corriente de motor: no hay un sensor de corriente en el firmware revisado. Debe quedar sin medir hasta incorporarlo o documentar una alternativa.
- Timestamps de inicio de decisión, orden de servo, confirmación, falla, parada y alarma, correlacionados por episodio.
- Ground truth: material real y depósito real para medir clasificación/contaminación. Las clases decididas no son esa verdad de terreno.

## Interpretación de los verificadores

`objeto -> decisión A/B/dudoso`: 50 ms por defecto; cambiar con `--decision-ms` solo si se justifica el nuevo requisito.

`decisión A -> servo confirmado`: usa `deadline_us` del evento de decisión. Si no está el plazo o no hay feedback, resultado SIN_EVIDENCIA.

`falla -> motor detenido y alarma`: 200 ms como referencia. `motor_orden_parar` se registra pero no sustituye `motor_detenido`.

`CUMPLE_EN_TRAZA` significa que se observaron los eventos dentro del plazo; una pérdida de secuencia o eventos descartados invalida esa conclusión. Un resultado tardío observable se reporta VIOLADA. Una obligación sin respuesta al cerrar la traza queda SIN_EVIDENCIA, no se considera éxito. No se combinan relojes de distintos arranques.

## Observaciones sobre el enunciado

- El ejemplo de pérdidas de la página 10 contiene una discrepancia aritmética: `5000 × 0,02 × 0,10 × 8 × 250 = 20000`, no 2000. La función calcula el producto con los parámetros reales, sin copiar el resultado impreso.
- El cuadro 6 separa riesgo `r` (R1–R3) y reducción `dr` (R4). El ejemplo 0,61 del anexo mezcla ambas salidas en un promedio. Si se incorpora TSK, acordar y documentar esa interpretación, no combinar magnitudes silenciosamente. La magnitud analógica `I` tampoco está disponible en el inductivo digital actual.
- Las tres clases de calidad elegidas para los sensores actuales evitan confundir no metálico normal con metálico no detectado. Justificar esta adaptación y no afirmar detección de ausencia total de contacto con las mismas señales.

## Evidencias recomendadas para completar luego

Guardar: versión/hash de firmware y modelo, parámetros, tipo de ensayo, objeto físico/material/destino observado, traza cruda, medición externa de tiempos, métricas calculadas, fotos del cableado e interlock, video con gemelo sincronizado. Separar las trazas sintéticas de pruebas de las mediciones reales y los datasets Tiny IA.
