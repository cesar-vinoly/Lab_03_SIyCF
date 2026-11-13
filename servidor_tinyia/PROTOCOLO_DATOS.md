# Toma de datos: calidad de señal

Se evalúa la evolución temporal del inductivo y el ultrasonido. Para provocar intermitencia sin depender de la detección de entrada, usá el ensayo manual con cinta detenida descrito abajo. La IA no recibe el material real como entrada ni puede saber si una señal inductiva siempre inactiva corresponde a un no metálico o a un metálico que no fue detectado. Por eso se usan tres clases observables y se retiró `sin_contacto`.

## Procedimiento manual: registro de 10 segundos con cinta detenida

1. Cargá el firmware actualizado, ejecutá el servidor y recargá el panel. Elegí la ESP32 y **Activar modo manual** con la cinta vacía. Esperá **Modo manual listo · cinta detenida**; recién entonces colocá la pieza.
2. Pulsá **Iniciar prueba**. Primero hay **10 s de preparación**. Cuando aparezca **Registrando**, comienzan **10 s de registro continuo**: provocá y observá la condición durante ese tiempo, manteniendo la cinta detenida.
3. Para normal, mantené una condición estable y coherente. Para intermitente, buscá pérdidas y recuperaciones de detección mientras la pieza sigue en la zona. Para anómala, buscá alteraciones incompatibles con lo observado. Retirar normalmente la pieza no demuestra falla del sensor. No desconectes sensores ni edites las muestras.
4. Pulsá **Ver última prueba completa**. Verás una sola captura con 100 lecturas a 100 ms (9,9 s entre primera y última). Asigná **una etiqueta para toda la prueba**, según la gráfica y lo observado. Si no hay evidencia suficiente, dejala sin etiqueta o descartala. No hace falta que el patrón aparezca en cada segundo: importa su evolución en la ventana completa.
5. Guardá material e ID físico de la pieza. Conservá el mismo ID en todas sus repeticiones. Repetí con distintas piezas y condiciones. **Una prueba de 10 s es un ejemplo de entrenamiento**; sus 100 lecturas no son ejemplos independientes. El entrenamiento mantiene cada pieza completa en una sola partición.
6. Retirá la pieza antes de **Volver a automático**. Una desconexión mantiene el modo manual; reiniciar la ESP32 vuelve al automático e interrumpe cualquier ensayo.

La captura manual no exige eco y no se cancela al perderlo. El modelo usa las 100 lecturas completas: 400 entradas con `feature_version=2`. Así recibe también pérdidas y recuperaciones separadas por varios segundos. Hay que reentrenar los modelos anteriores de 40 entradas. Las pruebas antiguas con diez bloques completos y consecutivos se reúnen con respaldo y archivo de originales; su etiqueta global queda pendiente de revisión. Los grupos incompletos y las firmas cortas no sirven para este entrenamiento.

Usá el mismo procedimiento para las tres clases. Una intervención controlada propia de este protocolo se documenta; no se descarta por el solo hecho de ser manual. No confundas movimiento normal de la pieza con una alteración del sensor. Las instrucciones automáticas siguientes son una alternativa, no pasos adicionales al ensayo manual.

## Preparación para captura automática (alternativa)

1. Prepará cinco piezas metálicas y cinco no metálicas diferentes. Identificalas como `M01` a `M05` y `N01` a `N05`. Cada pieza conserva su ID en todas las repeticiones y condiciones.
2. Usá la misma velocidad, umbrales y montaje de sensores durante el lote. Variá la posición/orientación de las piezas, anotando cada cambio. No cambies firmware ni parámetros entre clases.
3. Iniciá el servidor en una terminal:

   ```powershell
   cd C:\Users\cesar\Desktop\Lab_03_SIyCF\servidor_tinyia
   python servidor.py
   ```

4. Abrí [el panel](http://127.0.0.1:8000). Si ya estaba abierto antes de cambiar las clases, reiniciá el servidor y recargá la página. Deben aparecer `senal_normal`, `senal_intermitente` y `senal_anomala`.
5. Confirmá que llega una captura completa por pasada. Esperá a que se reciban sus 100 lecturas y termine el ciclo antes de colocar otra pieza; un nuevo ciclo anticipado cancela la ventana anterior. No se necesita historial previo.

## Primero, registrá el comportamiento normal

Pasá cada una de las diez piezas dos veces, colocándola antes del arranque y dejándola avanzar libremente. Son 20 pasadas iniciales.

Revisá cada captura y compará la gráfica con lo observado. Etiquetá `senal_normal` solo si la evolución corresponde al paso normal. El inductivo puede permanecer inactivo en todas las lecturas de un no metálico. En un metálico puede activarse al pasar por su campo y desactivarse al alejarse: esa transición por sí sola es normal. La ventana puede incluir cinta vacía después de que salga la pieza; esa ausencia tampoco es una falla.

Si un ensayo de esta primera tanda muestra una alteración real, registrala con la etiqueta correspondiente; no lo fuerces a normal para completar una cuota.

## Después, buscá condiciones alteradas reproducibles

Prepará cada posición/orientación con la cinta detenida y luego dejá pasar la pieza sin intervenir. Empezá por variaciones laterales o de orientación que sigan permitiendo detectar la entrada. Cambiar la posición no define automáticamente la etiqueta: importa lo que efectivamente ocurra en la ventana capturada.

| Etiqueta | Qué debe observarse |
|---|---|
| `senal_normal` | Evolución coherente con el paso; incluye las variaciones normales entre formas/materiales y las transiciones de entrada/salida de la zona sensible. |
| `senal_intermitente` | La detección se pierde y recupera repetidamente mientras la pieza sigue en la zona, con valores coherentes cuando sí hay detección. Por ejemplo, huecos repetidos en el eco durante el paso de una superficie difícil. |
| `senal_anomala` | Distancias que saltan a un fondo ajeno al recorrido o activaciones espurias incompatibles con lo observado. No basta con que un objeto produzca una distancia diferente a la de otro. |
| `descartar` | Situación ambigua, captura de otra pieza, intervención ajena al protocolo elegido, varias piezas juntas o evidencia insuficiente para decidir. |

Si hay tanto intermitencia como saltos/activaciones espurias, usá `senal_anomala`. Si no podés distinguirlas de un paso normal, descartá el ensayo. No desconectes sensores ni modifiques muestras en el archivo para fabricar ejemplos.

La firma automática tiene 100 muestras a intervalos de 100 ms desde la confirmación de entrada. Incluye la espera inicial y los siguientes segundos de movimiento, hasta completar la ventana. La condición a etiquetar debe aparecer en esos datos; no se garantiza cubrir un recorrido mayor de 10 s.

El control conserva la espera de colocación de 1000 ms y no espera la finalización del registro para mover la cinta. Para entrenar, usá un lote con la misma configuración y procedimiento. No mezcles ensayos manuales y automáticos. Un modelo entrenado con cinta detenida necesita evaluación posterior en movimiento; su desempeño en las pruebas manuales no demuestra el desempeño durante transporte.

Si el ultrasonido no detecta nunca la entrada, no se genera una captura automática. Si el ciclo se cancela o la captura queda incompleta, el servidor la guarda para diagnóstico pero el entrenamiento la excluye. El conjunto resultante evalúa ventanas válidas, no todas las fallas posibles del sistema.

## Lote inicial sugerido

| Condición observada | Metálicos | No metálicos | Total |
|---|---:|---:|---:|
| Normal | 10 pasadas | 10 pasadas | 20 |
| Intermitente | 10 pasadas | 10 pasadas | 20 |
| Anómala | 10 pasadas | 10 pasadas | 20 |
| **Total** | **30** | **30** | **60** |

Cada celda corresponde a cinco piezas por dos repeticiones completas en esa condición, si se logra observarla. En modo manual, cada «pasada» de la tabla es una prueba de 10 s con cinta detenida. Reutilizá los mismos diez objetos, conservando siempre sus IDs. Alterná materiales y el orden de las repeticiones. Es un plan inicial balanceado, no una garantía de desempeño ni una obligación de etiquetar casos ambiguos para llegar al número.

El mínimo técnico del script es menor: 10 capturas y cinco piezas diferentes por clase, es decir 30 capturas totales. Ese mínimo no asegura representación suficiente de ambos materiales. Si no conseguís ejemplos reales y distinguibles de alguna clase, hay que revisar la definición o el alcance del modelo antes de entrenar; no inventar etiquetas.

## Guardar cada ensayo en el panel

Seleccioná **Revisar**, completá etiqueta, ID físico, material observado y notas, y presioná **Guardar etiqueta**. Por ejemplo:

```text
Pieza: N03
Material: no_metalico
Etiqueta: senal_normal
Notas: repeticion 2; orientacion habitual; eco continuo; inductivo inactivo
```

Para una alteración, anotá la posición/orientación y qué pérdida o salto observaste. No uses el valor `metal=0` para asignar automáticamente una clase de calidad. Un metálico no detectado con una firma indistinguible de la de un no metálico se anota como limitación del sistema; no sirve como ejemplo separable de una nueva clase.

Las etiquetas anteriores `contacto_bueno`, `contacto_parcial` y `sin_contacto` necesitan revisión manual. No se convierten automáticamente. Solo las ventanas completas de versión 2 pueden entrenar el modelo nuevo; no estires ni repitas datos de una firma corta para completar 100 muestras.

## Entrenar y evaluar

Desde otra terminal, con el servidor abierto o cerrado:

```powershell
cd C:\Users\cesar\Desktop\Lab_03_SIyCF\servidor_tinyia
.\.venv\Scripts\python.exe entrenar.py
```

El script separa las piezas físicas entre entrenamiento y prueba. En `salida/metricas.json`, además de exactitud, macro-F1, matriz de confusión y tasa de dudosos, revisá:

- `por_material.no_metalico.normales_test`: cuántos no metálicos normales se evaluaron.
- `por_material.no_metalico.tasa_falsas_alarmas_sobre_normales`: fracción de esos ensayos que fueron predichos como intermitentes/anómalos.
- Las mismas medidas para `metalico` y la tasa de dudas de cada material.

Una tasa `null` significa que no había ejemplos normales de ese material en prueba; no significa cero errores. Más datos variados y ensayos posteriores con nuevas piezas permiten comprobar generalización. Quitar la etiqueta ambigua corrige el planteamiento, pero no garantiza que el modelo no tenga falsas alarmas.

La instalación del encabezado y la medición de memoria se describen en [README.md](README.md). La compilación y carga de la ESP32 quedan a cargo del usuario.
