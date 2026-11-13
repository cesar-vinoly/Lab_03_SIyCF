# Cinta clasificadora · Lab 03 SIyCF

ESP32-WROOM-32D, ESP-IDF 6.0.1, TMC2208, encoder de rodillo, HC-SR04, inductivo activo en bajo y servo MG996R posicional. El firmware funciona en la ESP32 de forma autónoma. Se clasifica una pieza por ciclo; la clasificación queda fijada durante el transporte.

La versión actual agrega una espera de colocación de 1 s, Wi-Fi y capturas para la Tiny IA supervisora. Configurá SSID, clave e IP de la PC únicamente en `main/configuracion_red.h`. El receptor, el panel de etiquetado y el entrenamiento están en [servidor_tinyia](../servidor_tinyia/README.md). Sin SSID o sin servidor, el modo automático sigue operando; la red nunca bloquea el bucle de control.

El panel permite **Activar modo manual**, detener la cinta y centrar el servo. **Iniciar prueba** da 10 s de preparación (`ENSAYO_PREPARACION_MS`) y luego registra una sola prueba de 10 s: 100 muestras a 100 ms (9,9 s entre primera y última), un envío y una etiqueta. Perder eco no cancela el ensayo. La Tiny IA usa las 400 entradas de la ventana completa; requiere reentrenar modelos anteriores de 40 entradas. `ENSAYO_BLOQUES` ya no se usa. La cinta queda detenida durante y entre pruebas. Retirá la pieza antes de **Volver a automático**. Una desconexión mantiene el modo manual; reiniciar la ESP32 vuelve al automático. Se necesita compilar/cargar esta versión; no se compiló ni flasheó como parte de esta implementación.

En automático también se registran 100 muestras desde la confirmación de entrada. Si comienza otro ciclo antes de completar la ventana, la captura anterior queda cancelada; esperá su recepción para tomar datos de otra pieza. La captura activa, la pendiente HTTP y el vector de IA usan memoria estática; la cola de red guarda dos pruebas completas. El servidor reúne las sesiones anteriores de diez bloques completos con respaldo y conserva sus originales y etiquetas para revisión.

El monitor muestra `Red: diagnostico v2`, los intentos de conexión, el motivo de desconexión y la IP obtenida; además, cada registro de la cinta incluye `wifi=...`. El envío HTTP funciona sin token. El mensaje `Captura ... recibida` confirma el servidor; `Wi-Fi conectado` confirma la conexión al router y la IP.

## Tiny IA instalada

Se incorporó el modelo de `servidor_tinyia/salida_manual`, huella `f3521a61bf83…`: 16 árboles, 400 entradas y tres clases (`senal_normal`, `senal_intermitente`, `senal_anomala`). El umbral de duda es 0,60 de acuerdo entre árboles; no es una probabilidad calibrada. `main/modelo_calidad.h` conserva exactamente la exportación y `main/modelo_calidad_info.h` identifica su procedencia. El componente CMake ya incluye `tiny_ia.cpp`.

El control de sensores, TS y actuadores sigue en la tarea principal del núcleo 0 (prioridad 5), y Wi-Fi/HTTP en su tarea del núcleo 0 (prioridad 1). La nueva tarea `tiny_ia` trabaja en el núcleo 1 (prioridad 2), con pila de 4096 bytes. En una configuración de un solo núcleo se usa el núcleo 0. La captura completa se copia a una cola de una posición, sin espera; el trabajador mantiene su propia copia estática y el vector de 1600 bytes. Después de inferir, envía la captura a la cola HTTP. Ningún resultado de IA interviene sobre motor, servo, PI ni clasificación del material.

Al arrancar debe aparecer `tiny_ia: Modelo cargado: f3521a61bf83; 16 arboles, 400 entradas; umbral=0.60; nucleo=1`. Al completar una ventana de 100 muestras (~10 s), aparece `ciclo=... modo=... clase=senal_... voto=... dudosa=... inferencia=... us pila_libre_min=...`. La inferencia funciona sin Internet, incluso si la cola de telemetría termina llena. Si no se puede crear la tarea IA o se llena su cola, se conserva el control y se intenta enviar la captura con `ia.activa=false`, `ia.clase=-1`, con aviso en el monitor. Las ventanas canceladas o con tiempos inválidos no se evalúan.

El servidor recibe el resultado en `payload.ia`, incluida la huella del modelo, alcance, origen de entrenamiento y `fuera_procedimiento`. Este último es `true` para capturas automáticas con el modelo manual actual. No asigna etiquetas de entrenamiento automáticamente.

**Alcance actual:** entrenado con las dos piezas conocidas, cinta detenida. La salida revisada el 10/11/2026 usa 48 capturas de entrenamiento y 12 de evaluación: exactitud 1,000, macro-F1 1,000 y dudosos 0,000. El encabezado exportado es idéntico al instalado anteriormente (misma huella `f3521a61bf83…`); en la evaluación actual las capturas 252 y 253 sustituyen a las 121 y 122. El cambio respecto al 0,833 anterior corresponde a un conjunto de evaluación diferente, no a un cambio en los árboles. Esas métricas no son directamente comparables como mejora del modelo. Las predicciones en movimiento siguen necesitando evaluación independiente. El resultado llega al finalizar la ventana y no es una alarma inmediata ante cada lectura.

Pruebas sin compilar: `node cinta_clasificadora/tests/test_tiny_ia.cjs` desde la raíz compara el encabezado instalado y sus 12 vectores de prueba, las entradas de las 80 capturas con `features.py`, ventanas inválidas y el envío sin espera. Es interpretación/simulación, no ejecución de C++ ni de FreeRTOS. Quedan pendientes compilación, tiempos, pila y memoria real en la ESP32.

## Compilar y cargar

Desde una terminal de ESP-IDF 6.0.1, dentro de la carpeta que contiene el CMakeLists.txt principal:

```powershell
idf.py set-target esp32
idf.py build
idf.py -p COM7 flash monitor
```

Sustituí COM7 por el puerto de tu ESP32. El monitor usa 115200 baudios. Para salir presioná Ctrl+].

## Secuencia por pieza

| Etapa | Cinta | Servo |
|---|---|---|
| Espera | Parada, EN en alto | Centro |
| Dos ecos cercanos consecutivos | Parada; espera 1000 ms para terminar de colocar la pieza y confirmar el material | Centro |
| Termina la clasificación con la pieza presente | POSICIONANDO espera solo si falta terminar el centrado/asentamiento | Asegura el centro para ambos materiales |
| Termina el centrado y hay un eco en zona | Arranca con rampa hacia 80 RPM del motor | Permanece centrado |
| Pieza metálica alcanza o supera 32 cm dentro del tramo | Continúa en marcha | Inicia un único barrido de 60° para empujar la lata |
| Pieza no metálica pasa por 30 cm | Continúa hasta la salida | Permanece centrado |
| El ultrasonido sigue detectando presencia | Sigue en marcha, aunque hayan pasado más de 10 s | Retorna al centro al completar los 1200 ms desde el empuje, aunque siga habiendo eco |
| Cinco ausencias con pieza metálica, o con no metálica ya observada en zona de salida | Se detiene y pasa a REARME | Completa el empuje si sigue en curso; luego regresa al centro |
| Una caja pierde el eco antes de observarse en zona de salida | Continúa hasta recuperar eco o agotar 5 s desde el último eco en el tramo | Centro |
| Termina el empuje y el ultrasonido sigue libre durante 5 muestras consecutivas | Vuelve a ESPERA, aunque el inductivo siga activo | Regresa al centro |
| Durante REARME reaparecen dos ecos consecutivos en zona, una vez terminado el empuje | Reinicia la clasificación y el centrado; después arranca | Centro hasta un nuevo disparo por distancia |

El HC-SR04 se dispara cada 100 ms. Se confirma la entrada con dos lecturas entre 2 y 12 cm. Una vez detectada la pieza, **las distancias desde 2 cm hasta menos de 60 cm mantienen la presencia**. Este límite incluye el punto de empuje a 32 cm y los 44,6–47,5 cm medidos en la caída de no metálicos, con margen. El eco de la silla a 114 cm queda fuera del tramo y cuenta como ausencia. No hay un tiempo total fijo de marcha.

Tres lecturas seguidas sin detección en el tramo durante la colocación cancelan ese ciclo. En POSICIONANDO se espera que la consigna del servo llegue al centro y transcurran 200 ms de asentamiento; si ya estaba centrado no se repite una espera completa de 1200 ms. El MG996R no devuelve posición: se comprueban la rampa de mando y su tiempo, no una medición física. Solo al encender se reserva también la preparación inicial de 1200 ms. Con el centro ya asentado, la marcha comienza aproximadamente 1,2–1,3 s después de colocar la pieza, seguida de la rampa de velocidad.

Mientras el servo se centra, el motor queda parado y no se acumulan ausencias. Después se exige un eco actual dentro del tramo para arrancar; tres ausencias consecutivas desde el final de la preparación cancelan el ciclo. Para metálicos, durante el transporte siguen bastando **cinco ausencias consecutivas** (aproximadamente 0,5 s). Ausencia significa sin eco, lectura inválida o distancia de 60 cm o más. El inductivo determina el material y no bloquea el rearme.

Para no metálicos se distinguen dos situaciones. Si ya hubo dos lecturas consecutivas desde 45 cm hasta menos de 60 cm, se considera observada la **zona de salida** y se detiene tras cinco ausencias. Si se pierde antes el eco, se permite continuar hasta **5000 ms desde el último eco dentro del tramo**, para recuperar la caja o permitir que avance por una zona donde el haz no la ve. Un eco del fondo a 118 cm no renueva ese plazo. Si vuelve un eco en zona, se retoma el seguimiento normal; si vence el plazo, se detiene e informa pérdida de seguimiento, sin afirmar que la caja cayó. La zona de salida no es un sensor físico de caída.

Este cambio responde a las capturas del montaje: una caja pasó de unos 31 cm a ecos del fondo de 118–120 cm y el código anterior la detuvo a los 0,5 s. El margen debe verificarse en el banco. Si el eco se pierde persistentemente, revisar altura y orientación del HC-SR04 respecto de la cara de la caja; prolongar el plazo no recupera una medición que el sensor no está produciendo.

Para una pieza clasificada como metálica, el empuje se activa con la primera lectura válida de `dist_cm >= DISTANCIA_EMPUJE_METAL_CM` mientras TRANSPORTANDO y dentro del límite de seguimiento. Se compara «mayor o igual», porque una muestra puede pasar de 31,8 a 32,4 cm. El disparo queda memorizado: una oscilación posterior por debajo de 32 cm no retrae la pala ni repite el movimiento. Se usa la clasificación guardada al entrar, aunque el inductivo ya esté libre. La cinta continúa moviéndose durante el barrido. Una pieza no metálica no activa el empuje.

Los 32 cm indican cuándo **empieza** el movimiento del servo, medidos desde el transductor; no representan la distancia recorrida desde el punto de entrada. Con los ajustes actuales el barrido tarda aproximadamente 1 s y se reservan otros 200 ms para asentamiento. A los 1200 ms desde el disparo se ordena siempre el retorno, independientemente del eco: la pala desplegada puede reflejar el ultrasonido y no debe impedir su propio retorno. Si se habían confirmado cinco ausencias antes, la cinta ya estará detenida; en caso contrario continúa transportando durante el retorno. Se descartan del contador de salida las lecturas tomadas mientras regresa. Con el centro asentado se vuelven a exigir cinco ausencias; una pieza aún presente sigue siendo transportada, sin repetir el empuje durante ese ciclo.

En REARME se completa primero cualquier empuje en curso y se espera el retorno al centro y su asentamiento, sin acumular presencias del eco de la pala. Después, cinco ausencias ultrasónicas dentro del tramo llevan a ESPERA, o dos ecos consecutivos entre 2 y menos de 60 cm inician una nueva clasificación sin tener que retirar la pieza, aunque esté lejos de la entrada. Al entrar en REARME se descarta la clasificación anterior, conservando solo la orden y el tiempo necesarios para terminar el empuje; se capturan nuevamente el nivel y los pulsos del inductivo. Una sola lectura de presencia no reinicia la marcha.

El GPIO del inductivo genera una interrupción por flanco de bajada. Se memoriza el pulso, aunque termine entre dos lecturas del ultrasonido. También se comprueba el nivel actual. Se acepta el metal detectado desde 2 s antes de confirmar la presencia ultrasónica y durante toda la espera de clasificación. Un pulso inductivo solo deja la cinta detenida. La clasificación queda fijada al entrar en POSICIONANDO y se utiliza más adelante para decidir el empuje a 32 cm.

El alcance previsto del sensor cubre el tramo, pero las capturas muestran pérdidas con algunas cajas antes de la salida. `DISTANCIA_SEGUIMIENTO_MAX_CM=60` separa el recorrido del fondo observado a 114–120 cm. Si cambia el montaje, el límite debe quedar por encima de la distancia máxima de la pieza antes de caer y por debajo de los objetos del fondo. El valor 0 desactiva este filtro y volvería a aceptar la silla como presencia. Varias piezas pueden prolongar la marcha, pero este programa no distingue ni clasifica por separado piezas metálicas y no metálicas que estén juntas.

## Pines

| Señal | GPIO | Montaje |
|---|---:|---|
| TMC2208 STEP / DIR / EN | 25 / 26 / 27 | Sentido de avance del Lab 1. EN activo en bajo. |
| TMC2208 MS1 / MS2 | 32 / 33 | Bajo / bajo, como en el ensayo a 1/8 de paso. |
| Encoder del rodillo | 23 | 20 pulsos por vuelta, flanco de subida. |
| HC-SR04 TRIG / ECHO | 18 / 19 | Conservar el acondicionamiento de ECHO a 3,3 V del montaje. |
| Señal del servo | 16 | MCPWM de 50 Hz. Alimentación adecuada al servo, con masa común a la ESP32. |
| Salida acondicionada del inductivo | 34 | Pull-up externo a 3,3 V. Alto en reposo, bajo al detectar. |

Se requiere la versión **posicional** del MG996R. Una versión de rotación continua interpreta el ancho de pulso como sentido y velocidad, no como posición.

## Ajustes de banco

Editá **main/configuracion.h** y volvé a compilar y cargar.

| Parámetro | Inicial | Cuándo cambiarlo |
|---|---:|---|
| SERVO_INVERTIR | 1 | Desvía hacia el lado de menor pulso. Con 0 invierte el lado. |
| SERVO_CENTRO_GRADOS / SERVO_DESVIO_GRADOS / SERVO_AJUSTE_GRADOS | 90 / 60 / −5 | Centro lógico 90 con compensación física de −5°: ~1444 µs en reposo y ~778 µs en desvío. Verificar alineación en el montaje. |
| SERVO_PULSO_MIN_US / SERVO_PULSO_MAX_US | 500 / 2500 µs | Rango de conversión; el ángulo físico se calibra en el montaje. |
| SERVO_VELOCIDAD_GRADOS_S / SERVO_ESTABILIZACION_MS | 60 / 200 ms | Barrido nominal de 1 s más 200 ms de asentamiento; el tiempo se adapta al ángulo configurado. |
| PRUEBA_SOLO_SERVO | 0 | Con 1, prueba exclusivamente el servo y mantiene el motor deshabilitado. Volver a 0 para clasificar. |
| DISTANCIA_ENTRADA_CM | 12 cm | Umbral para iniciar un ciclo desde ESPERA; no limita el seguimiento de una pieza ya detectada. |
| DISTANCIA_SEGUIMIENTO_MAX_CM | 60 cm | Incluye la caída a 44,6–47,5 cm y excluye el fondo a 114 cm. Ajustar si cambia el montaje; 0 desactiva el filtro del fondo. |
| DISTANCIA_EMPUJE_METAL_CM | 32 cm | Distancia ultrasónica que dispara el barrido de una pieza metálica; debe quedar dentro del tramo de seguimiento. |
| ESPERA_CLASIFICACION_MS | 1000 ms | Tiempo para terminar de colocar la pieza antes de comenzar el movimiento. |
| MEMORIA_METAL_MS | 2000 ms | Memoria del pulso inductivo anterior a la entrada; independiente de la espera corta. |
| METAL_INMEDIATO | 0 | Con 1 omite la espera de clasificación al confirmar metal; conserva el centrado previo. El empuje sigue esperando a los 32 cm. |
| MUESTRAS_FIN_TRANSPORTE | 5 | Ausencias consecutivas necesarias para detener la cinta. Subir si hay pérdidas breves de eco. |
| CONSIGNA_MOTOR_RPM | 80 RPM | Consigna en las unidades del ensayo, dentro del rango alcanzable. |
| ACTUADORES_PERIODO_MS / RAMPA_HZ_S | 20 ms / 1600 Hz/s | Rampa automática: incrementos de hasta 32 Hz por actualización. |
| DIRECTO_MAX_RPM / MOTOR_MICROPASOS | 150 RPM / 8 | En mando directo, 100 % = 4000 Hz y 50 % = 2000 Hz. TMC2208 con MS1=MS2=0. |
| DIRECTO_ACEL_RPM_S / DIRECTO_FRENO_RPM_S | 120 / 300 RPM/s | Rampas del mando directo, como en Lab 1; parada inmediata al ordenar S/E o 0 %. |
| ENCODER_FILTRO_ALPHA / CONTROL_BANDA_RPM | 0,25 / 1 RPM | Suavizado y banda muerta del PI para reducir variaciones por ruido del encoder. |
| CONTROL_CORRECCION_MAX | 0,20 | Corrección máxima del PI: ±20 % de la frecuencia base calculada con el TS. |

## Modelo y velocidad medida

La comparación con el [código del primer laboratorio](https://github.com/cesar-vinoly/Lab-1-Sistemas-inteligentes-y-ciber-f-sicos/blob/main/codigo_esp/Cinta%20trasportadora/main/main.c) mostró una diferencia: allí el encoder calcula RPM a partir de varios pulsos entre referencias, actualizado cada segundo; esta versión usaba únicamente el último periodo. Además, `RPM_M` en el Lab 1 representa el mando del motor, mientras `RPM_R` es el rodillo medido. Para comparar con `RPM_motor` de este proyecto, convertir `RPM_R` por 40/19.

Ahora `encoder_medicion.h` valida los anchos alto y bajo (mínimo 500 µs) con interrupciones en ambos flancos. Los rebotes más breves no borran la media. Cada pulso completo se confirma al comenzar el siguiente, agregando un periodo de latencia. Calcula RPM a partir de hasta cuatro periodos consecutivos, requiriendo un mínimo de tres. Con 20 pulsos por vuelta del rodillo y el rango de 180 RPM de motor, periodos menores de unos 35088 µs invalidan la ventana. Cada pulso calificado, incluso demasiado rápido, actualiza la referencia temporal: una ráfaga no se divide artificialmente para hacerla parecer una velocidad admisible. Tras tres periodos limpios vuelve la lectura. Si no hay suficientes periodos o vence la lectura, se envía `null`, nunca RPM del TS en lugar de una medición.

La conversión se hace fuera de la ISR; dentro solo se acumulan tiempos enteros. El encoder tiene su propio bloqueo, separado del eco/inductivo. El monitor añade `enc_rech_ciclo` (flancos descartados desde el inicio del transporte). Si crece continuamente, el filtro está detectando una señal incompatible con el rango; verificar la señal en GPIO23 durante la marcha. Tener el mismo cableado no permite concluir por software si los pulsos espurios vienen del sensor, de interferencia o de temporización. La media añade retardo a la lectura: comprobar el PI en el montaje, especialmente durante aceleración.

Se conservan `RECUPERACION_ECO_NO_METAL_MS=5000`, `DISTANCIA_SALIDA_NO_METAL_CM=45`, `MUESTRAS_ZONA_SALIDA=2`, `ENCODER_VENTANA_PERIODOS=4` y `ENCODER_MIN_PERIODOS=3`. La espera manual, las 100 lecturas de IA y los coeficientes del TS no cambian. Las capturas automáticas registran `config.control_revision=4`, el ajuste del servo y el mínimo de ancho del encoder; no mezclar automáticamente con lotes anteriores al entrenar. El contrato de las pruebas manuales se conserva.

Se incluye el encabezado original **main/modelo_ts1_economico.h**. Su entrada es frecuencia STEP en Hz y su salida es RPM del motor. El encoder está en el rodillo. El firmware de identificación convierte su lectura a RPM del motor multiplicando por 40/19. Por eso 80 RPM del motor equivalen a **38 RPM del rodillo** con esa transmisión.

Al iniciar cada transporte se busca la frecuencia de equilibrio resolviendo `F(80, u) = 80` con el modelo de cuatro reglas. El resultado es aproximadamente **2133 Hz**. Se conservan los coeficientes y el período de **100 ms del TS de orden 1**.

En automático la frecuencia parte de 40 Hz y sube con una rampa de 1600 Hz/s, actualizada cada **20 ms**. En directo se usa la escala y las rampas del Lab 1, independientes de la base TS de 80 RPM. STEP vuelve a generarse con GPTimer de 10 MHz y dos alarmas por pulso, como en el primer laboratorio. Variar la frecuencia no reinicia el temporizador. EN queda activo también en reposo, reteniendo el motor; antes de cambiar DIR se detiene STEP y se espera 10 µs. El servo usa MCPWM, un periférico independiente.

El PI se habilita después de alcanzar la base. Usa RPM filtradas, una banda muerta de 1 RPM, protección contra acumulación integral y una corrección limitada a ±20 % de la base (además del límite global de 4000 Hz). Lecturas inválidas o superiores a 180 RPM no alimentan el PI. Si faltan pulsos se conserva el último objetivo, evitando alternar entre dos órdenes distintas. Sin encoder desde el inicio, se llega a la base TS sin corrección; eso no confirma que la cinta esté girando físicamente.

Cada 100 ms se evalúa la predicción con la frecuencia media realmente aplicada durante ese intervalo. Es una aproximación durante la rampa, porque el modelo fue identificado con un período de 100 ms; en régimen la entrada es constante. El modelo sigue siendo una planta identificada, no un controlador por sí solo.

En el monitor, **RPM_motor** muestra la media medida por el encoder antes del filtro adicional del PI, y **RPM_TS** la predicción del intervalo recién terminado. **STEP** es la frecuencia aplicada y **servo_us** el ancho de pulso solicitado. **metal=1** indica el inductivo actualmente activo, no la clasificación memorizada. **empuje=1** indica que está ordenado el desvío; el inicio se registra una sola vez con `EMPUJE METALICO: dist_cm=...`. Si faltan periodos válidos o la lectura venció, aparece **sin_lectura**. `recuperando_eco=1` identifica el margen para una caja perdida antes de la salida. La estimación TS no sustituye la medición física.

## Revisar el MG996R que vibra

En el registro de diagnóstico, los diez intentos se cancelaban a los 420 ms de entrar en POSICIONANDO por `dist_cm=nan`, antes de completar los 700 ms de preparación. No hubo ninguna entrada a TRANSPORTANDO y STEP siempre fue cero.

La revisión del SDK instalado identificó un problema de software: en ESP32 con ESP-IDF 6.0.1, `ledc_update_duty()` entra en una sección crítica y `ledc_ll_set_duty_start()` espera a que termine la actualización anterior. La rampa del servo llamaba esa función cada 20 ms, precisamente el período del PWM de 50 Hz. Esa espera puede bloquear las interrupciones necesarias para capturar el eco; el timeout de captura es de 10 ms. Esto es compatible con las pérdidas durante el movimiento, aunque la confirmación requiere probar la placa.

El servo ahora usa **MCPWM a 1 MHz y un período de 20000 ticks**. El comparador programa el pulso en microsegundos y lo aplica al comienzo del siguiente período, sin esa espera de LEDC. Se incorporó la dependencia `esp_driver_mcpwm` al componente. Referencia: [MCPWM de ESP-IDF 6.0.1](https://docs.espressif.com/projects/esp-idf/en/v6.0.1/esp32/api-reference/peripherals/mcpwm.html). La versión actual se identifica al arrancar por `TMC2208 1/8 | directo 100%=150 RPM | STEP GPTimer | ajuste servo=-5 grados`.

Además, la secuencia permite terminar la preparación antes de evaluar la ausencia; así evita invertir el servo a mitad de movimiento por una pérdida transitoria de eco. Si el eco no se recupera después de la preparación, el motor sigue detenido. Se mantienen las comprobaciones físicas de alimentación, cableado y posición del sensor por si la pérdida persiste.

El servo recibe 50 Hz estables y cambia de posición gradualmente. El centro lógico de 90° incorpora `SERVO_AJUSTE_GRADOS=-5`, dando **1444 µs**. Se conserva `SERVO_DESVIO_GRADOS=60`: con la inversión actual, el destino lógico 30° se compensa a 25°, aproximadamente **778 µs**. El ángulo físico depende de la unidad y de la pala. La velocidad de 60 produce un barrido nominal de 1 s, con 200 ms adicionales de asentamiento. Ese tiempo se reserva al encender y para terminar un empuje antes de retornar. En los siguientes arranques se comprueba el centrado ya alcanzado, evitando repetir una espera fija.

Probá el recorrido primero sin lata. Si la pala encuentra un tope o el servo queda haciendo fuerza, reducí `SERVO_DESVIO_GRADOS`. Para afinarlo, cambiá ese parámetro de 5 en 5; no hace falta modificar el centro ni la inversión. El tiempo de preparación se adapta al nuevo recorrido.

En el montaje se informó alimentación propia para el servo, masa común y una fuente de 5 V/10 A. Los **4,80 V medidos** están en el límite inferior de operación publicado por [TowerPro para el MG996R](https://towerpro.com.tw/product/mg996R/). Si aparecen problemas eléctricos, medí en el conector durante el movimiento: la capacidad nominal de la fuente no mide la caída en cables y contactos. Esta comprobación complementa la corrección del bloqueo de interrupciones.

Para aislar el problema:

Una prueba sin recompilar permite separar la influencia del servo: apagá el montaje, desconectá los tres cables del MG996R y volvé a encender conservando motor y sensores conectados. Con una pieza frente al sensor, observá si ahora llega a TRANSPORTANDO y si la cinta se mueve. El programa no recibe confirmación física del servo, por lo que puede completar su espera aunque esté desconectado. Usá esta prueba solo para comprobar transporte; el desvío no estará funcionando. Si desaparece la pérdida de eco, revisá alimentación y cableado del servo, además de la posición de la pala respecto al ultrasonido. Si persiste, hace falta revisar la captura del eco y las conexiones del HC-SR04.

Para probar exclusivamente el servo:

1. Configurá `PRUEBA_SOLO_SERVO` en `1`. Tras compilar y cargar, alternará centro/desvío cada 3 s con el motor deshabilitado. Probalo inicialmente sin carga en la pala.
2. Medí la tensión **en el conector del servo mientras intenta moverse**. Si cae por debajo de 4,8 V, revisá la fuente y el cableado; un tester puede no registrar todos los picos breves.
3. Si vibra incluso sin carga y con alimentación estable, revisá el pulso de GPIO16 con osciloscopio/analizador, los conectores y el propio servo. La espera por software no confirma que el eje haya llegado a destino.
4. Volvé a `PRUEBA_SOLO_SERVO=0` para usar la cinta.

## Comprobaciones en el montaje

- Tanto una pieza metálica como una no metálica deben arrancar con el servo centrado. Una metálica debe iniciar el barrido al alcanzar o superar 32 cm dentro del tramo, aunque el inductivo ya marque 0. Una no metálica debe pasar por 30 cm sin activar el servo.
- Una lectura de 31,8 cm no debe disparar; una siguiente de 32,4 cm sí. Si luego oscila alrededor de 32 cm, no debe repetir el empuje ni retraer la pala. Sin eco o con la silla a 114 cm no debe disparar.
- Una pérdida de eco mientras el servo se está centrando no debe cancelar ese movimiento. Al completar la consigna central y el asentamiento, un eco en zona habilita el transporte; si sigue sin eco durante tres lecturas, debe cancelar sin arrancar, aunque `metal=1`.
- Si la lata desaparece del eco poco después de iniciar el empuje, la cinta debe parar tras cinco ausencias, mientras el servo completa los 1200 ms desde el disparo antes de retornar al centro.
- Mientras haya presencia ultrasónica, la cinta debe seguir más allá de los antiguos 10 s y de los antiguos 15 cm. Comprobar el paso por 19,4 cm y por más de 40 cm con una pieza no metálica. Una o dos pérdidas de eco no deben detenerla.
- Una pieza a 44,6–47,5 cm debe mantener el transporte. Después de dos ecos consecutivos a partir de 45 cm, su ausencia debe detener la cinta tras cinco lecturas fuera del tramo. Si no se pudo observar esa zona, se aplica el margen de 5 s desde el último eco en zona.
- Con una caja a 30 cm, cinco ecos del fondo o pérdidas no deben detenerla: debe verse `recuperando_eco=1`. Al recuperar la caja a 39 cm, continúa normalmente. Sin recuperar eco, a los 5 s debe parar con un aviso de pérdida, sin afirmar salida física.
- Al retirar una pieza metálica, debe detenerse tras cinco ausencias seguidas; una no metálica retirada antes de la zona de salida consume el margen anterior. Una vez terminado cualquier empuje en curso, vuelve a ESPERA tras cinco ausencias en REARME, independientemente del nivel del inductivo.
- Si la presencia reaparece durante REARME (por ejemplo, una pieza a 9,3 cm o a más de 40 cm), debe verse `Presencia recuperada`, después CLASIFICANDO, POSICIONANDO y TRANSPORTANDO. Sin eco, el inductivo por sí solo no debe arrancar la cinta.
- Cada entrada en REARME informa desde qué estado se detuvo y cuántas lecturas consecutivas sin presencia provocaron la parada. Si el ciclo se cancela repetidamente durante el movimiento del servo, estas trazas ayudan a investigar la pérdida de eco o la alimentación.
- En régimen, observá STEP y RPM_motor. Si STEP se mantiene estable pero la cinta aún da tirones, hace falta revisar alimentación, ajuste de corriente del TMC2208 y mecánica en el banco.

Los cambios se revisaron sin compilar ni cargar firmware. Las transiciones se comprobaron en una simulación de la lógica de clasificación normalizada a JavaScript, incluyendo la espera de colocación, memoria inductiva de 2 s, centrado, cruce de 32 cm, no metálicos, ecos inválidos y finalización del barrido tras perder presencia. La captura se simula con 100 muestras consecutivas, un único envío/inferencia y cancelación de ventanas interrumpidas. Esa simulación no ejecuta el firmware C ni los periféricos. Las pruebas del servidor/entrenamiento usan datos sintéticos aislados. El panel tiene pruebas de desconexión, recuperación, archivo local y timeout. La compilación y las comprobaciones físicas quedan pendientes en el montaje.

Referencia de cableado y adquisición: [primer laboratorio de cinta y gemelo digital](https://github.com/cesar-vinoly/Lab-1-Sistemas-inteligentes-y-ciber-f-sicos/tree/main/codigo_esp/Cinta%20trasportadora).

Prueba de regresión sin compilar: `node cinta_clasificadora/tests/test_sensores_control.cjs` desde la raíz del laboratorio. Ejecuta las funciones C normalizadas a JavaScript y comprueba media del encoder, ruido rápido sostenido, recuperación, caducidad, caja perdida a 30 cm, margen máximo, zona de salida, desvío metálico y rechazo del fondo. No ejecuta ISR reales ni reemplaza la prueba física.
