"""Instala un modelo ya entrenado y su procedencia; no compila ni carga la ESP32."""
import argparse
import hashlib
import json
from pathlib import Path
import re


def instalar(salida, destino, origen):
    salida, destino = Path(salida), Path(destino)
    contenido = (salida / 'modelo_calidad.h').read_bytes()
    # entrenar.py calcula la huella antes de la conversion LF -> CRLF de Windows.
    texto = contenido.decode('utf-8').replace('\r\n', '\n')
    metricas = json.loads((salida / 'metricas.json').read_text(encoding='utf-8'))
    huella = hashlib.sha256(texto.encode('utf-8')).hexdigest()
    if huella != metricas.get('modelo_sha256'):
        raise ValueError('El encabezado no corresponde a metricas.json')
    for nombre, valor in {'TINY_FEATURE_VERSION': 2, 'TINY_N_FEATURES': 400,
                          'TINY_CLASS_VERSION': 2, 'TINY_N_CLASSES': 3}.items():
        if not re.search(rf'^#define {nombre} {valor}$', texto, re.M):
            raise ValueError(f'Contrato incompatible: {nombre}')
    if metricas.get('clases') != {'0': 'senal_normal', '1': 'senal_intermitente', '2': 'senal_anomala'}:
        raise ValueError('Orden de clases incompatible')
    alcance = metricas.get('evaluacion', {}).get('alcance', 'piezas_separadas')
    if not re.fullmatch(r'[a-z_]+', alcance) or origen not in ('manual', 'automatica'):
        raise ValueError('Procedencia no valida')
    info = '\n'.join([
        '#pragma once', '// Generado por instalar_modelo.py junto con modelo_calidad.h.',
        f'#define TINY_MODELO_SHA256 "{huella}"',
        f'#define TINY_ORIGEN_ENTRENAMIENTO "{origen}"',
        f'#define TINY_ENTRENADO_MANUAL {int(origen == "manual")}',
        f'#define TINY_ALCANCE_MODELO "{alcance}"', '',
    ])
    destino.mkdir(parents=True, exist_ok=True)
    (destino / 'modelo_calidad.h').write_bytes(contenido)
    (destino / 'modelo_calidad_info.h').write_text(info, encoding='utf-8')
    return huella


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--salida', type=Path, required=True, help='Carpeta del entrenamiento')
    parser.add_argument('--origen', choices=['manual', 'automatica'], required=True,
                        help='Mismo origen usado al entrenar; se declara explicitamente')
    args = parser.parse_args()
    destino = Path(__file__).resolve().parent.parent / 'cinta_clasificadora' / 'main'
    try:
        huella = instalar(args.salida, destino, args.origen)
    except (OSError, ValueError) as exc:
        parser.exit(1, f'No se instalo: {exc}\n')
    print(f'Modelo instalado: {huella[:12]} en {destino}. Compilacion/carga pendientes.')
