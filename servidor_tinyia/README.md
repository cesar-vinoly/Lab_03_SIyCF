# Servidor de capturas · Tiny IA supervisora

Alternativa 1 del laboratorio: calidad de contacto/señal, usando **el inductivo y el HC-SR04 actuales**. El clasificador de material sigue siendo determinista. La IA supervisa las señales y registra una clase y un indicador de duda; no acciona el motor ni cambia el desvío.

El receptor y el panel funcionan con Python 3.11 o posterior, **sin instalar dependencias**. Las bibliotecas de `requirements-entrenamiento.txt` se usan solamente al entrenar. Se creó `.venv` con esas bibliotecas para las pruebas de este equipo.

Las versiones exactas probadas con Python 3.14 están en `requirements-probados-py314.txt`; las versiones también quedan registradas en cada informe de entrenamiento.

## Puesta en marcha

1. Abrí una terminal en esta carpeta y ejecutá:

   ```powershell
   cd C:\Users\cesar\Desktop\Lab_03_SIyCF\servidor_tinyia
   python servidor.py
   ```

   También podés usar `./iniciar.ps1`. Para detenerlo: Ctrl+C. Los datos permanecen en `datos/capturas.sqlite3`.

2. Abrí [el panel local](http://127.0.0.1:8000). El servidor escucha en el puerto 8000. Si Windows pide acceso a la red, habilitá la red privada que usás para el laboratorio.

3. Con `ipconfig` buscá la IPv4 del adaptador conectado al mismo router que usará la ESP32. Editá `../cinta_clasificadora/main/configuracion_red.h`:

   ```c
   #define RED_WIFI_SSID    "nombre_de_tu_wifi"
   #define RED_WIFI_CLAVE   "clave_de_tu_wifi"
   #define RED_SERVIDOR_URL "http://IP_DE_LA_PC:8000/api/capturas"
   ```

   **La única configuración de red está en `configuracion_red.h`.** En este equipo contiene los datos ya ingresados y la URL `http://192.168.1.150:8000/api/capturas`, la IPv4 observada en la PC; revisala con `ipconfig` si cambia la red. Desde la ESP32, `127.0.0.1` apunta a la ESP32 y no a la PC. La placa usa Wi-Fi de **2,4 GHz**. Una red de invitados con aislamiento puede impedir la comunicación con la PC.

4. Compilá/cargá el firmware por tu procedimiento habitual. Con el servidor abierto, el monitor debe mostrar `Wi-Fi conectado; IP ...` y, después de pasar una pieza, `Captura ... recibida`. La captura aparecerá en el panel.

La conexión se hace al router por Wi-Fi; este servidor funciona **en la red local**, sin depender de salida a Internet. El servidor y el panel no requieren token. No se modificaron las reglas de firewall. Las credenciales están solo en `configuracion_red.h`, excluido de Git.

## Si la página indica que no puede conectarse

La página necesita que `servidor.py` continúe en ejecución. Una pestaña puede seguir mostrando el panel aunque Python se haya cerrado. Abrí `http://127.0.0.1:8000/health`: debe responder `ok: true`. Si no responde, iniciá el servidor con el comando anterior y mantené esa terminal abierta. Si ya hay un servidor en el puerto 8000, usá esa instancia.

Abrí el panel desde `http://127.0.0.1:8000/`, no mediante el archivo HTML. El panel muestra instrucciones si se abre como archivo, corta una petición sin respuesta tras 8 s y reintenta la actualización automáticamente. Después de modificar la página, recargá con Ctrl+F5. El error de conexión entre navegador y Python es independiente del estado de Wi-Fi de la ESP32.

Durante la corrección se dejó una instancia en segundo plano en el puerto 8000. Sus registros están en `datos/servidor-stdout.log` y `datos/servidor-stderr.log`; no se borraron capturas. Al reiniciar Windows habrá que volver a iniciar el servidor.

Si la cuenta de 10 s muestra «ESP32 sin conexión reciente» al principio y solo aparecen los últimos 3 s, verificá que Python se haya reiniciado tras actualizarlo. La versión anterior rechazaba los sondeos con más de 3000 ms restantes. El panel verifica `/health`: debe informar `ensayo_max_preparacion_ms: 60000`; si falta, muestra un aviso de versión anterior. El HTML se lee del disco en cada visita, pero los módulos Python se cargan al iniciar el proceso, por lo que Ctrl+F5 solo no actualiza el servidor.

## Diagnóstico de conexión en el monitor

Después de recompilar y cargar, el arranque debe mostrar `Red: diagnostico v2; configuracion desde main/configuracion_red.h`. Abrí el monitor y pulsá EN/RESET si querés ver toda la secuencia desde el inicio. Las etapas son:

```text
Iniciando Wi-Fi; SSID="..."; configuracion_red.h
Wi-Fi iniciado en modo estacion; preparando conexion
Intento Wi-Fi 1; conectando al router...
Enlace Wi-Fi establecido; esperando direccion IP por DHCP
Wi-Fi conectado; IP ...
```

El log de la cinta incluye `wifi=sin_config`, `iniciando`, `conectando`, `esperando_ip`, `conectado` o `error` cada segundo. No se imprime la clave. Un SSID vacío produce un error explícito; una desconexión muestra su código y una orientación para revisar nombre de red, autenticación o señal. El código orienta el diagnóstico, no identifica de forma concluyente una única causa.

`Wi-Fi conectado` confirma el enlace y la IP de la ESP32. La recepción del servidor se confirma por separado con `Captura ... recibida` después de pasar una pieza. Si hay IP pero el envío falla, revisá que el servidor esté abierto, la IP/puerto de la PC y el acceso por la red local. El modo `PRUEBA_SOLO_SERVO=1` no inicia Wi-Fi y lo indica al arrancar.

## Ensayo manual: 10 s de preparación + 10 s de registro

Recompilá y cargá el firmware actualizado de `cinta_clasificadora`, reiniciá este servidor y recargá el panel con Ctrl+F5. El contrato de entrada ahora es `feature_version=2`: una prueba completa de 100 muestras. `/health` informa `feature_version: 2` y `muestras_por_prueba: 100`.

1. Con la cinta vacía, elegí tu ESP32 y pulsá **Activar modo manual**. Esperá **Modo manual listo · cinta detenida** y colocá la pieza.
2. Pulsá **Iniciar prueba**. La cuenta de **Preparación** dura 10 s desde que la ESP32 acepta la orden. Este tiempo sirve para acomodarte.
3. Cuando aparezca **Registrando**, disponés de otros **10 s** para provocar y observar la condición. Se toman **100 muestras consecutivas a 100 ms**, con 9,9 s entre primera y última. La primera muestra pertenece al registro posterior a la cuenta, no a la preparación. Perder el eco no cancela el registro. La cinta permanece detenida.
4. Al terminar, pulsá **Ver última prueba completa**. Verás una sola fila y una gráfica con las 100 lecturas. Guardá **una etiqueta global**, material, notas e ID de pieza. La etiqueta depende de lo observado durante toda la prueba: provocar una condición no garantiza que aparezca en los datos.
5. Retirá la pieza antes de **Volver a automático**, porque la detección vuelve a poder arrancar la cinta.

La preparación se define con `ENSAYO_PREPARACION_MS` (10000 por defecto, entre 1000 y 60000 ms). El registro está fijado por el contrato del modelo: 100 muestras a 100 ms. Ya no se usa `ENSAYO_BLOQUES`. Cambiar el tamaño o el periodo requiere adaptar firmware, servidor y entrenamiento, y reentrenar. El panel diferencia preparación y registro.

El firmware `cinta-ia-3` envía una captura al terminar, con la `orden_manual` y las 100 muestras, sin bloques ni muestras previas a la cuenta. No se reduce la resolución: cada lectura aporta cuatro valores, para **400 entradas** de IA. Una prueba representa un ejemplo de entrenamiento, no cien.

La IA evalúa una sola vez la evolución completa de esos 10 s. Así puede aprender pérdidas y recuperaciones que ocurran en distintos segundos. **Los modelos anteriores de 40 entradas no sirven para este contrato y deben reentrenarse.** Las pérdidas mientras la pieza sigue presente son distintas de retirarla completamente; documentá lo que hiciste y observaste.

Recolectá las tres clases con el mismo procedimiento. El entrenamiento agrupa por `pieza_id`, para mantener todas las repeticiones de una pieza en la misma partición. Variá piezas y condiciones; no llenes una clase con repeticiones casi idénticas de una sola pieza.

Una pérdida de conexión no saca a la placa del modo manual; el registro continúa localmente y usa la cola de envío. La cola es finita y sus descartes se contabilizan. Al reiniciar el servidor se adopta el modo informado por la ESP32. Reiniciar la ESP32 interrumpe el ensayo y vuelve al automático. El estado del servo es el de su orden, no una medición física de posición.

### Pruebas anteriores guardadas en diez bloques

Al iniciar, el servidor respalda SQLite en `datos/respaldo-antes-ventana100-*.sqlite3` antes de unir sesiones completas del firmware `cinta-ia-2`. Exige la misma placa, arranque, orden y configuración, los bloques 1 a 10 y 100 lecturas consecutivas sin saltos fuera de 70–160 ms. Conserva el ID del primer bloque y archiva los diez registros originales, incluidas sus etiquetas y notas, en `bloques_archivados`. La etiqueta global queda **pendiente de revisión**; no se deduce de las etiquetas de los bloques.

Si la ESP32 todavía envía bloques, el servidor también los reúne cuando llegan los diez completos y conserva sus originales. Los grupos incompletos y las firmas antiguas cortas permanecen visibles, pero no entran al entrenamiento nuevo. No se rellenan ni repiten lecturas. Una prueba reunida y una captura nueva son compatibles para entrenar si comparten configuración y procedimiento. Actualizá igualmente la ESP32 para que la captura y la inferencia local trabajen con las 100 muestras.

## Qué se captura

En automático se toma **una firma de 100 muestras por ciclo**, a intervalos nominales de 100 ms (9,9 s entre primera y última), comenzando al confirmar la entrada. En manual comienza al terminar la preparación. Ninguna incluye historial previo. Los flancos inductivos se registran entre lecturas.

La ventana automática incluye la espera inicial y los siguientes segundos de transporte; puede incluir cinta vacía si la pieza sale antes. El control no espera a que termine el registro. Esperá la recepción de la captura y el fin del ciclo antes de colocar otra pieza: si comienza otro ciclo antes de las 100 muestras, la captura anterior se marca cancelada y no se mezcla con la nueva. No mezcles configuraciones ni ensayos manuales y automáticos en un entrenamiento. Un modelo entrenado con cinta detenida requiere evaluación posterior en movimiento para comprobar su utilidad en operación.

Cada muestra contiene tiempo desde el arranque de la ESP32, distancia o `null` si no hubo eco, nivel lógico del inductivo (true = activo en bajo), presencia de al menos un flanco de bajada desde la muestra anterior, STEP aplicado hasta ese instante, RPM medidas o `null`, predicción TS, pulso del servo, estado y orden de empuje. No se mide amplitud analógica ni fuerza de contacto.

Las RPM se conservan tal como las envía la ESP32: si superan el rango operativo configurado de 180 RPM, el panel muestra una advertencia. Los registros anteriores contienen el último periodo crudo; el firmware actualizado usa una media de hasta cuatro periodos válidos y envía `null` cuando no tiene una lectura fiable. Un problema del encoder no descarta las 100 lecturas de inductivo/ultrasonido ni asigna una etiqueta de calidad. La IA actual no usa RPM como entrada; la advertencia del servidor no modifica el motor.

Las capturas automáticas nuevas incluyen `config.control_revision=2`, el margen de recuperación de eco de las cajas y la ventana del encoder. El entrenamiento detecta la diferencia de configuración respecto de capturas automáticas anteriores. El protocolo y configuración manual se mantienen: las pruebas manuales ya recogidas de 100 muestras siguen siendo utilizables, sin convertir ni editar sus lecturas.

Se corrigió un rechazo de capturas automáticas por picos superiores a 10000 RPM: ahora se admite cualquier lectura de RPM finita y no negativa como diagnóstico. Si otro dato impide validar un envío, el servidor registra el motivo y conserva el cuerpo original en `datos/rechazadas/`, fuera del conjunto de entrenamiento, para poder investigarlo y recuperarlo cuando corresponda. Los JSONL exportados incluyen `advertencias`; el CSV contiene las entradas de IA.

Cada objeto lleva `device_id`, `boot_id` y `cycle_id`; los reintentos de la misma captura no crean duplicados ni borran etiquetas. Al reiniciar la placa cambia `boot_id`. La hora de recepción la agrega la PC; `t_ms` es tiempo monotónico de la ESP32, no hora UTC. La ventana es fija: no garantiza cubrir un recorrido que dure más de 10 s.

La cola conserva hasta dos capturas completas en RAM, más una pendiente de envío. Se redujo su capacidad al ampliar cada captura a 100 muestras. Reintenta Wi-Fi/HTTP cada 5 s; el timeout HTTP es 2,5 s y ocurre en otra tarea. Si la cola se llena, se descartan capturas nuevas y se informa `descartadas`. Un reinicio pierde esa cola. La clasificación y el movimiento siguen funcionando sin servidor. Con SSID vacío, la red queda deshabilitada.

Se guardan también capturas parciales/canceladas para diagnóstico. Se excluyen del entrenamiento si no cumplen versión 2, 100 muestras sin historial, no canceladas e intervalos de 70–160 ms. Esto impide tratar una captura interrumpida como una señal normal.

## Etiquetas y protocolo de ensayo

En el panel elegí **Revisar**, observá la firma, asigná clase, material real e ID de la pieza física. El material memorizado por el firmware es solo diagnóstico. Repeticiones de una misma lata deben conservar el mismo ID, incluso en distintas sesiones.

Estas definiciones operativas adaptan la palabra «contacto» del enunciado a sensores sin contacto físico:

| Clase | Evidencia que debe observar el operador |
|---|---|
| `senal_normal` | Evolución esperada durante el paso: distancia coherente y transiciones naturales al entrar/salir del campo. Incluye no metálicos con inductivo inactivo. |
| `senal_intermitente` | Pérdidas y recuperaciones repetidas de detección mientras la pieza continúa en la zona observada. Una activación y desactivación normales al pasar no cuentan como intermitencia. |
| `senal_anomala` | Saltos de distancia o activaciones espurias incompatibles con el movimiento observado. Si también hay intermitencia, esta clase tiene prioridad. |
| `descartar` | Ensayo ambiguo, varias piezas juntas, intervención manual o error de preparación. No entra al entrenamiento. |

Se eliminó `sin_contacto`: un no metálico correcto y un metálico no detectado pueden producir la misma firma. El supervisor evalúa alteraciones temporales observables; no determina por sí solo si una inactividad estable del inductivo es correcta. `senal_normal` no certifica el material ni garantiza que todos los sensores estén sanos. Si el ultrasonido nunca confirma la entrada, no se dispara una captura automática; el modo manual permite registrar ese caso, aunque la ausencia constante de eco por sí sola no distingue sensor averiado de falta de objeto.

Ensayá una pieza por vez e incluí ambos materiales en cada condición. Anotá la posición, orientación y repetición. **No deduzcas la etiqueta de calidad a partir de `metal=0` ni del material conocido.** Si cambiaste la orientación pero la firma sigue normal, la etiqueta sigue siendo normal. No uses la clasificación del propio modelo como verdad para evaluarlo. Los tests generan datos sintéticos aislados; no llenan la base real ni producen un modelo desplegado.

El [protocolo de toma de datos](PROTOCOLO_DATOS.md) propone un primer lote balanceado de 60 pruebas completas: 10 metálicas y 10 no metálicas por cada una de las tres clases, siempre que esas condiciones se observen realmente. Las etiquetas antiguas `contacto_bueno`, `contacto_parcial` y `sin_contacto` se excluyen del entrenamiento; revisalas manualmente. Las firmas cortas de versión 1 también quedan excluidas, aunque tengan etiquetas válidas.

## Eliminar capturas guardadas

En el panel, pulsá **Revisar** en la fila que querés quitar, luego **Eliminar captura** y confirmá el número de captura/ciclo. Se eliminan sus muestras y su etiqueta de la base activa, del listado y de las futuras exportaciones. Las otras capturas se conservan. La eliminación no se puede deshacer desde el panel; si necesitás un respaldo, descargá antes el JSONL. Los archivos exportados y modelos ya entrenados no se modifican.

Si solo querés excluir una captura completa del entrenamiento y conservarla para revisarla, asigná la etiqueta **descartar** y guardala. Una tabla auxiliar de identificadores impide que un reintento restaure una captura eliminada. Los respaldos y originales archivados de sesiones reunidas permanecen fuera del dataset activo, incluso al eliminar la prueba reunida.

Si acabás de actualizar el código, reiniciá `servidor.py` y recargá el panel con **Ctrl+F5** para habilitar el botón y su ruta HTTP.

## Entrenar y exportar

### Montaje limitado a la misma lata y la misma caja

Para evaluar nuevas pasadas de esas dos piezas, usar `--piezas-fijas`. No exige cinco objetos distintos. Mantiene las tres clases de calidad y al menos 10 pruebas por clase, con 5 pasadas de cada pieza en cada clase. Usa una ventana completa por ejemplo y reserva el último 20 % de las pasadas de cada pieza/clase para prueba. No separa lecturas de una misma captura, rechaza ventanas solapadas entre entrenamiento/prueba y sigue exigiendo un mismo procedimiento/configuración.

```powershell
.\.venv\Scripts\python.exe entrenar.py --jsonl .\capturas.jsonl --origen manual --piezas-fijas --listar-lotes
.\.venv\Scripts\python.exe entrenar.py --jsonl .\capturas.jsonl --origen manual --piezas-fijas --salida .\salida_manual
```

Para este montaje se mantienen los IDs reales `lata_01` y `caja_01`. El informe declara `evaluacion.alcance=piezas_fijas`: las mismas piezas aparecen en ambos conjuntos, pero sus pasadas están separadas. Las métricas describen repetición con esas piezas; no demuestran funcionamiento con piezas nuevas ni en automático si se entrenó con cinta detenida. Un ensayo posterior independiente en operación sigue siendo necesario.

La clasificación metal/no metal continúa siendo determinista por el inductivo. Este modelo clasifica calidad de señal, no material. Si el lote manual contiene solo intermitentes y anómalas, completar normales manuales: 5 ensayos de la lata y 5 de la caja. Los normales automáticos no se convierten a manuales modificando sus metadatos.

### Evaluación con piezas no vistas

El mínimo exigido por el script es 10 pruebas completas y 5 piezas físicas diferentes **por cada una de las tres clases: 30 pruebas en total**. Cada prueba tiene 100 lecturas; esas lecturas no cuentan como 100 ejemplos. Es un mínimo técnico, no una garantía de calidad. El lote de 60 del protocolo incluye ambos materiales. Si una misma pieza aparece en varias clases, siempre se mantiene entera en un solo grupo de entrenamiento o prueba.

```powershell
cd C:\Users\cesar\Desktop\Lab_03_SIyCF\servidor_tinyia
# El entorno ya está creado en este equipo. Para recrearlo en otro:
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-entrenamiento.txt
.\.venv\Scripts\python.exe entrenar.py
```

También acepta un JSONL descargado del panel: `entrenar.py --jsonl capturas.jsonl`. El CSV sirve para inspección; el JSONL conserva la captura completa, las etiquetas y los grupos necesarios para entrenar. No se mezclan firmware/configuraciones diferentes en un entrenamiento; filtrá una sola configuración si cambiaste tiempos o geometría.

Para diagnosticar un archivo mezclado sin entrenar:

```powershell
.\.venv\Scripts\python.exe entrenar.py --jsonl .\capturas.jsonl --listar-lotes
```

Muestra cada configuración/origen con pruebas utilizables y piezas físicas por clase. `--origen manual` o `--origen automatica` seleccionan un procedimiento sin modificar las muestras. Por ejemplo, una vez completo el lote manual:

```powershell
.\.venv\Scripts\python.exe entrenar.py --jsonl .\capturas.jsonl --origen manual --salida .\salida_manual
```

El filtro no completa clases ausentes ni une configuraciones diferentes del mismo modo. Cada lote debe contener las tres clases y al menos 10 pruebas de 5 piezas físicas por clase. Repetir la misma lata no crea piezas nuevas. No cambiar IDs, etiquetas ni el campo de origen para eludir la validación. Un lote con normales solo en automático y alteraciones solo en manual confunde el procedimiento con la calidad de señal; requiere completar las clases dentro del procedimiento elegido.

Entrena un Random Forest de 16 árboles y profundidad máxima 4. Usa 400 entradas: por cada una de las cien muestras, `inductivo`, `flanco`, `eco_valido`, `distancia/200`. Un eco no válido se representa con indicador 0 y distancia normalizada 0. La clasificación determinista, el material observado, la etiqueta y el ID de pieza **no son entradas**. `features.py` y `tiny_ia.cpp` comparten orden y conversión float32.

Separa las piezas con `StratifiedGroupKFold` en cinco particiones, elige una división con las tres clases presentes y reserva aproximadamente 20 % para prueba. El modelo exportado se entrena solo con el conjunto de entrenamiento. No se reajusta con los datos de prueba después de medir. Las firmas exactamente iguales con etiquetas distintas se rechazan para revisar esa contradicción; este chequeo no garantiza que todas las clases restantes sean distinguibles.

En `salida/` genera:

- `modelo_calidad.h`: árboles C++ exportados mediante micromlgen, con voto mayoritario y acuerdo entre árboles.
- `metricas.json`: exactitud global, macro-F1, matriz de confusión (filas reales, columnas predichas), métricas por clase, tasa de dudosos, cobertura, grupos, versiones, huella del modelo y tamaños estimados.
- `vectores_prueba.jsonl`: entradas y resultados esperados para comparar con el MCU.

`metricas.json` incluye `por_material`: cantidad de ejemplos normales de prueba, falsas alarmas sobre ellos y proporción de dudosos, por separado para metálicos y no metálicos. Una falsa alarma aquí significa predecir intermitente/anómala cuando el ensayo fue etiquetado normal. Si no hubo normales de ese material en la partición de prueba, la tasa es `null`, no cero; necesitás más ensayos para evaluar ese caso. El material es solo metadato de evaluación y sigue sin ser entrada de la IA.

Un caso es dudoso si menos del 60 % de árboles coincide con la clase ganadora (`--umbral-duda` cambia ese valor). Es **acuerdo de votos, no una probabilidad calibrada**. Las métricas globales incluyen todos los casos, también los dudosos; adicionalmente se informa exactitud y cobertura de los no dudosos. La votación coincide con el modelo exportado; puede diferir del promedio de probabilidades que usa `RandomForestClassifier.predict()`.

## Incorporarlo a la ESP32

Ya está instalado el modelo de `salida_manual`, entrenado con las dos piezas fijas. Para instalar una nueva exportación después de revisar sus métricas, desde esta carpeta:

```powershell
.\.venv\Scripts\python.exe instalar_modelo.py --salida .\salida_manual --origen manual
```

El instalador verifica la huella del encabezado contra `metricas.json` y el contrato de entrada. Copia `modelo_calidad.h` y genera `modelo_calidad_info.h` con la huella, el origen declarado y el alcance. Indicá el mismo origen que usaste para entrenar. No reemplaces únicamente uno de los dos encabezados. No entrena, compila ni carga la placa. El firmware requiere ambos archivos compatibles al compilar: `TINY_FEATURE_VERSION=2`, `TINY_N_FEATURES=400`, `TINY_CLASS_VERSION=2` y tres clases.

Compilá y cargá vos el firmware. Al arrancar informa `Modelo cargado`, huella, árboles, entradas y núcleo. Evalúa una vez al completar las 100 muestras **localmente, incluso sin Wi-Fi**, en una tarea del núcleo 1 y prioridad 2. El control sigue en el núcleo 0 con prioridad 5 y HTTP con prioridad 1. La cola copia la captura sin esperar; la IA usa su propia captura y vector estáticos. El resultado pasa luego a la cola de red. Si no hay memoria para crear la tarea o se llena su cola, intenta enviar sin inferencia (`activa=false`, `clase=-1`) y avisa. No detiene la cinta para esperar a la IA.

Registra `clase`, `voto`, `dudosa`, `inferencia_us`, `stack_free_min`, `modelo_sha256`, `origen_entrenamiento`, `alcance` y `fuera_procedimiento` dentro de `payload.ia`. Los códigos son 0 = normal, 1 = intermitente y 2 = anómala. La supervisión no cambia la clasificación determinista, motor, servo ni etiquetas manuales. El modelo actual fue evaluado con cinta detenida y piezas fijas; en automático se marca `fuera_procedimiento=true`. Sus métricas manuales no demuestran desempeño en movimiento. Se recibe un resultado al finalizar la ventana de ~10 s, no una alarma inmediata.

## Memoria y validación del laboratorio

El tamaño del `.h` **no equivale** al consumo de Flash. El informe deja `flash_mcu_bytes` y `ram_total_mcu_bytes` sin medir hasta la compilación y ensayo reales. Documentá:

1. `idf.py size` / `idf.py size-components` y mapa `.map`, comparando con la compilación anterior de captura usando las mismas opciones. La versión actual requiere los encabezados del modelo para compilar.
2. RAM de entrada: 400 floats = 1600 bytes, en un buffer estático usado solo por la tarea IA. Se suman tres contadores `unsigned` = 12 bytes, objetos del modelo, pila IA de 4096 bytes, una captura estática de trabajo y una posición de cola del tamaño de `captura_t`. La captura activa y la pendiente de red también son estáticas. La cola HTTP de dos capturas, el buffer JSON de 32768 bytes y la pila de red de 8192 bytes son costes de telemetría, separados del modelo. Medir el total en el MCU; estos tamaños no sustituyen la medición.
3. Campos de ejecución `heap_free`, `heap_min`, `control_stack_free_min` (bytes libres mínimos de la pila de control), `ia.stack_free_min` (pila IA) e `ia.inferencia_us`. `ia.buffer_bytes` informa captura + vector, no toda la RAM utilizada.

Se amplió la partición de aplicación a la opción ESP-IDF de 1500 KiB dentro de los 2 MiB configurados. NVS y el inicio de la aplicación conservan sus offsets. No se compiló ni flasheó la ESP32 como parte de este trabajo.

Pruebas de software:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s . -p "test_*.py" -v
```

Comprueban recepción HTTP y etiquetado sin credenciales, datos inválidos, duplicados, reinicios, exportaciones, separación de piezas y correspondencia entre los árboles de Python y los `if/return` generados, interpretados sin compilar C++. No sustituyen la prueba de Wi-Fi, sensores, tiempos y movimiento en el montaje.

Para verificar el manejo de desconexiones del panel sin navegador: `node test_panel.cjs`. Usa DOM y respuestas simuladas; no cambia la base de capturas.

Las pruebas también verifican confirmación del modo manual, órdenes por placa/arranque, caducidad sin conexión, duplicados, captura manual sin eco y botones durante cuenta regresiva. `node test_captura.cjs` simula la lógica de `captura.c` normalizada a JavaScript: un único envío/inferencia al completar 100 muestras y cancelación de parciales. No compila C ni ejecuta periféricos. Python comprueba la unión de bloques, respaldo, archivo de originales y exclusión de ventanas cortas. Las pruebas usan bases temporales y no envían órdenes al montaje real.

Antes de recolectar: verificá la espera de colocación (arranque en unos 1,2–1,3 s con centro ya asentado), metálico a 30 cm con barrido de 60°, paso de no metálicos por 47,5 cm y rechazo del fondo a 114 cm. Apagá el servidor durante una prueba y confirmá que la cinta sigue operando y que las capturas pendientes llegan al reabrirlo.

## Referencias de implementación

- [ESP-IDF 6.0.1: cliente HTTP](https://docs.espressif.com/projects/esp-idf/en/v6.0.1/esp32/api-reference/protocols/esp_http_client.html): la petición bloquea la tarea que la ejecuta; por eso se usa una tarea separada del control.
- [micromlgen](https://github.com/eloquentarduino/micromlgen): exportación de clasificadores a C++. Se fija la versión 1.1.28 y se verifica la salida generada.
- [StratifiedGroupKFold](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.StratifiedGroupKFold.html) y [classification_report](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.classification_report.html): partición por grupos y métricas de clasificación.

