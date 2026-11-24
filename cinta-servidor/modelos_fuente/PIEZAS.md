# Piezas del clasificador

## Actualizacion del montaje — 23/11/2026

Se reemplazaron `Soportes.step` y se incorporo `Pala.step` con las versiones
entregadas por el usuario. Los GLB publicados son `Soportes_fusion.glb` y
`Pala_servo.glb`, exportados con el mismo conversor y conservando escala,
colores y ubicaciones del ensamble. Los archivos anteriores se preservaron
en `respaldo_20261123`.

El eje del acople de la pala se midio en las caras cilindricas de `Pala.step`:
X = 8,728097961 mm, Y = 328 mm, Z = 171 mm. En las coordenadas del visor es
(0,008728097961; -0,171; 0,328) m. `app/servo-paddle.ts` usa este punto para
el barrido de 0 a 60 grados. El motor y el ultrasonido mantienen sus ubicaciones.
La textura gris sigue aplicada a la estructura; se conservan las ocho
exclusiones, incluidos el MG996R y el sensor inductivo.

Se agrego `Canaleta.step`, publicada como `Canaleta.glb`, con sus tres componentes,
colores y ubicacion original en Fusion. Se incorpora como pieza fija del ensamble,
junto a la salida lateral de la pala, con la misma conversion de ejes de los soportes.

La posicion de lata y caja incluye por defecto **+1,25 cm** para alejarlas del
sensor y corregir el desfase observado en el montaje real. El panel permite
ajustar ese valor o volver a cero. La medicion mostrada y enviada por la ESP32
permanece intacta. La configuracion visual usa `lab03-distance-offset-v3`:
el +2,5 anterior y el cero predeterminado de v1 migran a +1,25 cm. Otros ajustes
manuales se conservan, incluido un cero elegido explicitamente desde v2.
El campo de calibracion acepta centesimas de centimetro para guardar 1,25 sin redondear.

Conversion reproducible desde `cinta-servidor`:

```powershell
.\.venv-cad\Scripts\python.exe scripts/convertir_soportes_step.py modelos_fuente/Soportes.step public/models/Soportes_fusion.glb --metadata modelos_fuente/Soportes_fusion.conversion.json
.\.venv-cad\Scripts\python.exe scripts/convertir_soportes_step.py modelos_fuente/Pala.step public/models/Pala_servo.glb --metadata modelos_fuente/Pala_servo.conversion.json
.\.venv-cad\Scripts\python.exe scripts/convertir_soportes_step.py modelos_fuente/Canaleta.step public/models/Canaleta.glb --metadata modelos_fuente/Canaleta.conversion.json
```

## Modelos de objetos

`lata_01.step` y `caja_01.step` son copias de los archivos suministrados por el usuario. Se convirtieron con el mismo exportador OpenCascade utilizado para los soportes, preservando los colores XCAF, unidades en metros y el eje vertical Z.

Desde `cinta-servidor`:

```powershell
.\.venv-cad\Scripts\python.exe scripts/convertir_soportes_step.py modelos_fuente/lata_01.step public/models/lata_01.glb --metadata modelos_fuente/lata_01.conversion.json
.\.venv-cad\Scripts\python.exe scripts/convertir_soportes_step.py modelos_fuente/caja_01.step public/models/caja_01.glb --metadata modelos_fuente/caja_01.conversion.json
```

Las huellas SHA-256 y las tolerancias están en los archivos `.conversion.json`. El exportador conserva la colocación original: la lata tenía una traslación de aproximadamente un metro en Fusion. `app/piece-models.ts` compensa esa colocación al centrar y apoyar la pieza, sin escalar sus dimensiones. La rotación X de +90° adapta Z vertical a −Y vertical del ensamble.

OpenCascade informó que `04_Junta_solapada_longitudinal` de la caja no contiene geometría exportable. Se omitió ese nodo vacío; los paneles y tapas se exportaron. Se revisaron renders de ambos GLB y se verificaron sus dimensiones y apoyo sobre la banda con Three.js.
