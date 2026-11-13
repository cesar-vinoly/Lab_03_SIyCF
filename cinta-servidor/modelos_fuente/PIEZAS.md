# Piezas del clasificador

`lata_01.step` y `caja_01.step` son copias de los archivos suministrados por el usuario. Se convirtieron con el mismo exportador OpenCascade utilizado para los soportes, preservando los colores XCAF, unidades en metros y el eje vertical Z.

Desde `cinta-servidor`:

```powershell
.\.venv-cad\Scripts\python.exe scripts/convertir_soportes_step.py modelos_fuente/lata_01.step public/models/lata_01.glb --metadata modelos_fuente/lata_01.conversion.json
.\.venv-cad\Scripts\python.exe scripts/convertir_soportes_step.py modelos_fuente/caja_01.step public/models/caja_01.glb --metadata modelos_fuente/caja_01.conversion.json
```

Las huellas SHA-256 y las tolerancias están en los archivos `.conversion.json`. El exportador conserva la colocación original: la lata tenía una traslación de aproximadamente un metro en Fusion. `app/piece-models.ts` compensa esa colocación al centrar y apoyar la pieza, sin escalar sus dimensiones. La rotación X de +90° adapta Z vertical a −Y vertical del ensamble.

OpenCascade informó que `04_Junta_solapada_longitudinal` de la caja no contiene geometría exportable. Se omitió ese nodo vacío; los paneles y tapas se exportaron. Se revisaron renders de ambos GLB y se verificaron sus dimensiones y apoyo sobre la banda con Three.js.
