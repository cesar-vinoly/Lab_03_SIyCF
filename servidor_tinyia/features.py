"""Contrato de entrada compartido con main/tiny_ia.cpp; sin dependencias externas."""
import math
import struct

VERSION = 2
N_MUESTRAS = 100
ETIQUETAS_VERSION = 2
# Se supervisan patrones observables, sin deducir el material a partir de un cero.
CLASES = ("senal_normal", "senal_intermitente", "senal_anomala")
FEATURE_NAMES = [f"{nombre}_{i}" for i in range(N_MUESTRAS)
                 for nombre in ("inductivo", "flanco", "eco_valido", "distancia_norm")]


def f32(value):
    return struct.unpack("f", struct.pack("f", value))[0]


def extraer(payload):
    """Una fila por objeto, nunca una fila independiente por muestra temporal."""
    if payload.get("feature_version") != VERSION or payload.get("period_ms") != 100:
        raise ValueError("Version o periodo de captura incompatible")
    if payload.get("pretrigger") != 0:
        raise ValueError("La ventana completa debe comenzar en el inicio del registro")
    samples = payload["samples"]
    if len(samples) != N_MUESTRAS or payload.get("cancelada"):
        raise ValueError("Se necesitan 100 muestras de una prueba no cancelada")
    salida = []
    for i, muestra in enumerate(samples):
        if i and not 70 <= muestra["t_ms"] - samples[i-1]["t_ms"] <= 160:
            raise ValueError("Intervalo de muestreo fuera de 70..160 ms")
        d = muestra["dist_cm"]
        # Reproducir float32 del MCU antes de la division, incluida la cuantizacion.
        d = f32(d) if d is not None else None
        valido = d is not None and math.isfinite(d) and 2.0 <= d <= 200.0
        salida.extend((float(muestra["inductivo"]), float(muestra["flanco"]),
                       float(valido), f32(d / 200.0) if valido else 0.0))
    return salida

