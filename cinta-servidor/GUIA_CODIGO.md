# Guía del gemelo digital — Lab 03

## Ejecutar

Desde `cinta-servidor`, ejecutar `npm start` y abrir http://127.0.0.1:8001/.
`run.bat` abre el navegador y permite acceso por la red local, como en el proyecto original.
La instancia de verificación escucha solo en 127.0.0.1:8001. Para detenerla, identificar
su proceso `node server.mjs --port 8001`; no cerrar el servidor Python del puerto 8000.

Después de editar la web: `npm run build`. El servidor sirve `dist/`, no `app/`.
Desarrollo: `npm run dev`, con el backend en el puerto 8001; Vite publica el visor en 5173.
Pruebas: `node --test tests/*.test.mjs`.

## Modelos

- `public/models/Soportes_fusion.glb`: ensamble convertido directamente del STEP de Fusion,
  con 42 materiales, colores por cara, normales y jerarquía de componentes.
- `modelos_fuente/Soportes.step`: copia del STEP recibido; su procedencia, SHA-256 y
  parámetros de conversión están en `Soportes_fusion.conversion.json`.
- `public/models/Soportes.glb`: exportación anterior conservada; el visor ya no la carga.
- `public/models/Pala_servo.glb`: pala y acople independientes del soporte.
- El soporte convertido y la pala usan Z vertical. `app/servo-paddle.ts` los convierte al
  sistema CAD original con rotación de +90° sobre X, sin alterar los archivos.
- El pivote del servo en coordenadas CAD es `(0.0145, -0.171, 0.3025)` metros.
  Solo la pala gira alrededor del eje Y; su reposo conserva las coordenadas exportadas.
- El control de vista previa permite 0–60° con velocidad de 60°/s y retorno al reposo.
  No manda órdenes a la ESP32. Al ocultar la pestaña se pausa el reloj de animación.
- `app/support-materials.ts` aplica la textura original `public/textures/gris.jpg`
  a todas las mallas fuera de las ramas excluidas: Nema17, HC-020K, switch,
  Display_OLED, hc-sr04, base con driver y fan, servo mg996R y
  sensor_inductivo_punta_amarilla. Cada exclusión protege también sus descendientes.
  Los soportes mecánicos del servo y del inductivo sí reciben la textura.
  Si una exportación pierde alguna de esas ramas, la aplicación se detiene antes
  de cambiar materiales, para evitar cubrir la electrónica con la textura gris.
  Genera normales y UV por cara cuando faltan, con textura repetida cada 100 mm
  y repetición reflejada para unir los bordes de la fotografía gris sin saltos de tono.
  Las costuras UV separan vértices sin cambiar la forma o posición de los triángulos.
- `app/cad-materials.ts` adapta las exportaciones sin materiales (solo `COLOR_0`):
  conserva los colores de vértices y usa acabado difuso y doble cara. Evita el
  `metalness=1` predeterminado de GLTFLoader, que oscurecía la electrónica.
- Se retiró la tabla de colores aproximada del primer laboratorio. Los materiales
  del nuevo GLB salen de los estilos XCAF del STEP, con RGB lineal para glTF;
  no se les vuelve a aplicar conversión sRGB ni recoloreado por proximidad.
  Se declara `metallicFactor=0` y rugosidad 0,82 porque STEP no aporta un acabado
  PBR completo. Los soportes conservan la textura gris del visor.
- La etiqueta magenta del MG996R y la punta amarilla del inductivo están presentes
  en el STEP original; no son colores inventados por el visor.
- `app/viewer.tsx` carga todas las piezas bajo el mismo ensamble y conserva un solo bucle gráfico.
- `app/transmission.ts`, `belt.ts` y `detected-object.ts` mantienen engranajes, banda y objeto.

## Regenerar el GLB desde Fusion

La conversión se ejecuta una sola vez en Python. El navegador recibe únicamente el GLB.
Desde `cinta-servidor`, con el entorno CAD preparado:

```powershell
.\.venv-cad\Scripts\python.exe scripts\convertir_soportes_step.py modelos_fuente\Soportes.step public\models\Soportes_fusion.glb --metadata modelos_fuente\Soportes_fusion.conversion.json
npm run build
```

Para preparar ese entorno en otra computadora: `python -m venv .venv-cad` y
`.\.venv-cad\Scripts\python.exe -m pip install -r scripts\requirements-cad.txt`.
El conversor usa OpenCascade a través de `cadquery-ocp`, conserva posiciones y escala
en metros y triangula con tolerancia de 0,05 mm. El STEP permite recuperar colores
por cara, pero no reproduce necesariamente la iluminación ni todos los acabados de Fusion.

## Datos y controles

`control/websocket.mjs` gestiona sesiones, órdenes, ACK, tiempos de espera y simulación
manual de fallas. `control/motion.mjs` comparte la observación de movimiento, sin regularlo.
`app/lab-state.ts` conserva mediciones, frescura, divergencias e historial. `use-lab.ts`
conecta React al servidor. `control-dashboard.tsx` presenta mando, medición y gráficas.

Se retiraron el módulo PID, su configuración, la función de transferencia y las curvas
calculadas por ese modelo. El CSV nuevo conserva tiempo, sesión, encoder y referencia
ESP32. Los archivos históricos de datos no se modificaron.

## Alcance de esta actualización

Esta etapa actualiza la página y el montaje 3D. La ESP32 del Lab 03 sigue enviando
capturas al servidor Python del puerto 8000; aún falta adaptar la telemetría continua
WebSocket y sincronizar la pala con el servo real. Los mandos y las constantes de
calibración heredadas se documentan en `PROTOCOLO_ESP32.md` para revisarlos en esa etapa.
La prueba de la pala funciona aunque la pantalla indique «Esperando ESP32».

## Verificación

Se comprueba TypeScript y la compilación web; pruebas de alineación de ejes con los GLB
reales, conservación de geometría/materiales, pivote fijo, barrido y retorno, transmisión,
telemetría, mandos, desconexión, CSV e interfaz sin PID. Las conexiones de las pruebas usan
dispositivos simulados y no controlan el montaje físico.

La regresión de materiales comprueba UV y normales finitos, superficies UV no colapsadas,
los 42 colores contra las entidades `COLOUR_RGB` del STEP, los SHA-256 de origen y salida,
la paleta por componente y la conservación de triángulos al aplicar textura estructural.

El GLB convertido se revisó con un render independiente. Esto verifica su geometría y
materiales; no sustituye una inspección interactiva de la iluminación de la página.
