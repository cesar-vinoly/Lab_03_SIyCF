# Revisión de etiquetas de capturas.jsonl

Archivo revisado: `C:/Users/cesar/Downloads/capturas.jsonl`.
Fecha: 2026-11-10. Se analizaron las 80 capturas completas. No se modificaron datos ni etiquetas y no se entrenó un modelo.

## Integridad y cobertura

- Las 80 capturas pasan la validación del servidor y la extracción de características actual: 100 muestras, versión compatible e intervalos aceptados.
- No hay identidades de captura repetidas ni vectores de entrada exactamente iguales entre capturas. Por tanto, no se encontraron entradas idénticas con etiquetas contradictorias.
- `lata_01` siempre figura como `metalico` y `caja_01` como `no_metalico`.
- Las 60 pruebas manuales tienen STEP=0 durante toda la captura y comparten configuración. Hay 10 pruebas por pieza y clase: 20 normales, 20 intermitentes y 20 anómalas.
- Las otras 20 pruebas son normales automáticas, con otra configuración. Deben conservarse separadas del lote manual para entrenar y evaluar.
- Ninguna captura tiene notas sobre la intervención realizada. Esto limita la verificación de la causa de los cambios.

## Hallazgos por grupo

| IDs | Etiqueta actual | Evidencia y valoración |
|---|---|---|
| 232–241 | Normal, lata, manual | Coherentes: inductivo activo en las 100 lecturas; distancia estable, aproximadamente 8,7–10,0 cm en el conjunto. |
| 242–251 | Normal, caja, manual | Coherentes: inductivo inactivo en las 100 lecturas; distancia aproximadamente 8,4–9,6 cm. El inductivo inactivo es normal para la caja. |
| 88–92 | Intermitente, lata, manual | Patrón compatible con la etiqueta: 9–26 cambios de nivel inductivo por prueba, con ultrasonido estable entre 6,8 y 7,8 cm en el conjunto. No permite atribuir esos cambios a una falla si se provocaron moviendo la lata fuera del campo inductivo; sí registra la intermitencia inducida. |
| 83–87 | Intermitente, lata, manual | Revisar definición: inductivo siempre activo; el ultrasonido alterna entre aproximadamente 6–7 cm y un fondo de 121–122 cm. Hay eco válido en las 100 lecturas de cada prueba, no ausencia de eco. |
| 93–102 | Intermitente, caja, manual | Revisar definición: inductivo siempre inactivo; el ultrasonido alterna entre la caja cercana y un fondo de aproximadamente 121–123 cm. También hay eco válido en las 100 lecturas. |
| 103–122 | Anómala, manual | Hay variaciones amplias; 19 de las 20 pruebas alcanzan un fondo de más de 120 cm. Algunas incluyen lecturas menores de 2 cm, que la entrada de la IA considera fuera del rango válido. Los patrones son compatibles con alteraciones, pero sin conocer el movimiento real no se puede confirmar que todas sean anomalías. |
| 114 | Anómala, caja, manual | Revisión particular: no alcanza el fondo de 120 cm. Tiene 8 lecturas menores de 2 cm y otras distancias hasta 41,1 cm. Si la caja realmente se acercó y alejó siguiendo ese recorrido, la variación por sí sola no demuestra señal anómala. |
| 156, 170, 173, 181, 185, 187, 190, 199, 200, 208 | Normal, lata, automática | La aparición del fondo al final puede corresponder a la salida de la lata. No corresponde convertir automáticamente estas capturas a anómalas por ese cambio. Algunas alternan entre distancia cercana y fondo alrededor de la salida; su coherencia depende de lo que ocurrió durante la expulsión. |
| 221, 222, 223, 224, 226, 227–231 | Normal, caja, automática | En general, distancia creciente seguida de ausencia de eco, compatible con avance y caída. En la 226 reaparece una lectura válida aislada a los 9,5 s, después de la pérdida de eco a los 7,2 s; conviene revisar ese punto, sin asumir que implica una falla. |

## Principal ambigüedad: intermitencia frente a anomalía

Las **15 capturas 83–87 y 93–102** merecen revisión prioritaria. El protocolo actual describe los saltos a un fondo ajeno como ejemplo de señal anómala, pero estas capturas están etiquetadas como intermitentes. Ese mismo tipo de salto también aparece entre las anómalas. No son vectores idénticos, aunque sí hay solapamiento entre los criterios usados para etiquetar.

Por ejemplo, en la captura 83 el objeto cercano aparece entre 0,0–2,5 s, 4,0–7,0 s y 9,2–9,9 s. Entre esos intervalos se mide el fondo. En la 93 se producen cuatro intervalos de fondo intercalados con la caja cercana.

Esto admite interpretaciones diferentes:

- Si al levantar la pieza se dejó libre el haz ultrasónico, medir el fondo puede ser una respuesta correcta del sensor a la intervención. Puede representar una pérdida inducida de seguimiento del objeto, pero no prueba una falla del sensor.
- Si la pieza seguía interceptando el haz y la distancia al fondo no correspondía a la escena, la etiqueta anómala es más consistente con la definición actual.

No se recomienda cambiar las 15 etiquetas en bloque sin resolver esa distinción. Si se decide llamar intermitente a la alternancia objeto/fondo inducida, hay que documentarlo y aplicar el mismo criterio a las anómalas; cambiar el criterio únicamente para completar cantidades introduciría incoherencia.

## Qué se puede concluir

Las nuevas normales manuales están bien respaldadas por los datos y ya no falta esa clase. La integridad del archivo y la identidad de las piezas son coherentes. La separación conceptual entre intermitencia y anomalía requiere revisión; la estructura válida y el balance de clases no garantizan etiquetas correctas.

Una lectura ausente, fuera de rango o de fondo no determina por sí sola la etiqueta: importa si había una pieza interceptando el sensor y si la variación correspondía al movimiento observado. Tampoco una transición del inductivo al alejar la lata implica automáticamente una anomalía.

Mantener las dos piezas físicas originales y sus IDs. Para el alcance de piezas fijas no hace falta inventar otras identidades. Después de resolver las etiquetas ambiguas, entrenar únicamente el lote manual con el perfil de piezas fijas; la evaluación en movimiento queda como comprobación posterior independiente.
