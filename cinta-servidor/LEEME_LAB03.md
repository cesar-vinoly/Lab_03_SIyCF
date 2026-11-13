# Gemelo digital del clasificador

Abrir `run.bat`: inicia la página y el backend Python del laboratorio. La ESP32 usa la misma IP del servidor de capturas, pero el puerto **8001** y la ruta `/ws/device`.

La aplicación inicia con **mando directo** y la cinta detenida. El check **Clasificación automática** habilita la clasificación. La página muestra las confirmaciones de la ESP32, el encoder, el TS de orden 1, la Tiny IA y las métricas de los módulos preparados.

La pieza detectada aparece como **lata** si se activa el inductivo, o como **caja** si solo hay presencia ultrasónica. El tipo metálico queda memorizado durante el transporte. Los modelos GLB están en `public/models`; los STEP originales y las huellas de conversión, en `modelos_fuente`. La distancia visual se mide desde la cara del sensor hasta la superficie de la pieza, considerando su tamaño: 8,6 cm en el sensor representan 8,6 cm de separación. **Calibrar la posición del objeto en el gemelo** permite aplicar una corrección visual opcional; inicialmente es cero. La antigua escala por extremos ya no se utiliza.

Para aplicar esta actualización, cerrar y volver a abrir `run.bat` y recargar la página con Ctrl+F5. Incluye cambios en el backend Python; no requiere recompilar ni cargar la ESP32.

Consultar [la guía de integración](../INTEGRACION_GEMELO_LAB03.md) para compilación del firmware, puesta en marcha, operación, calibración visual, trazas y pruebas. La web ya tiene `dist` actualizado; no requiere recompilarla para abrirla.

`PROTOCOLO_ESP32.md`, `GUIA_CODIGO.md` y los módulos de `control/websocket.mjs` corresponden al primer laboratorio y se conservan como referencia. El servidor activo usa `control/lab03-bridge.mjs`, `app/lab03-dashboard.tsx` y `modulos_pendientes_lab03/servidor/integrado.py`.
