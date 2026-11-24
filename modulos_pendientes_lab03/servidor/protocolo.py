"""Contrato v1 ESP32 -> servidor -> futuro gemelo. JSON sin NaN ni infinitos."""
import json
import math
import re

EVENTOS = ('objeto', 'decision_a', 'decision_b', 'dudoso', 'servo_orden',
           'servo_confirmado', 'falla', 'motor_orden_parar', 'motor_detenido',
           'alarma', 'fin_ciclo', 'rearme')
ESTADOS = ('ESPERA', 'CLASIFICANDO', 'POSICIONANDO', 'TRANSPORTANDO', 'REARME', 'FALLA')


def entero(x, nombre, minimo=0):
    if type(x) is not int or not minimo <= x <= 2**53-1:
        raise ValueError(f'{nombre}: entero fuera de rango')


def numero(x, nombre, minimo, maximo, nulo=False):
    if x is None and nulo:
        return
    if type(x) not in (float, int) or not math.isfinite(x) or not minimo <= x <= maximo:
        raise ValueError(f'{nombre}: numero fuera de rango')


def booleano(x, nombre):
    if type(x) is not bool:
        raise ValueError(f'{nombre}: se esperaba booleano')


def validar(m):
    if not isinstance(m, dict) or type(m.get('v')) is not int or m['v'] != 1:
        raise ValueError('Version de protocolo incompatible')
    for k in ('device_id', 'boot_id'):
        if not isinstance(m.get(k), str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,64}', m[k]):
            raise ValueError(f'{k}: identificador invalido')
    entero(m.get('seq'), 'seq', 1)
    entero(m.get('t_us'), 't_us')
    d = m.get('data')
    if not isinstance(d, dict):
        raise ValueError('data debe ser un objeto')
    if m.get('kind') == 'snapshot':
        if d.get('estado') not in ESTADOS:
            raise ValueError('Estado desconocido')
        for k in ('manual', 'metal', 'encoder_valido'):
            booleano(d.get(k), k)
        for k in ('rpm_motor', 'rpm_ts', 'setpoint_rpm'):
            numero(d.get(k), k, -10000, 10000, k == 'rpm_motor')
        numero(d.get('dist_cm'), 'dist_cm', 0, 1000, True)
        for k in ('pos_m', 'pos_real_m'):
            numero(d.get(k), k, -1000, 1000, True)
        for k in ('step_hz', 'servo_us', 'control_exec_us', 'control_late_us', 'control_missed',
                  'heap_min', 'stack_min', 'dropped_ia', 'dropped_events', 'coalesced'):
            entero(d.get(k), k)
        if not d['encoder_valido'] and d['rpm_motor'] is not None:
            raise ValueError('Encoder sin lectura: usar rpm_motor=null, no cero')
    elif m.get('kind') == 'event':
        if d.get('name') not in EVENTOS:
            raise ValueError('Evento desconocido')
        entero(d.get('object_id'), 'object_id', 1)
        numero(d.get('value'), 'value', -1e9, 1e9, True)
        if d.get('deadline_us') is not None:
            entero(d['deadline_us'], 'deadline_us', 1)
    elif m.get('kind') == 'ia':
        entero(d.get('object_id'), 'object_id', 1)
        entero(d.get('input_t_us'), 'input_t_us')
        entero(d.get('inferencia_us'), 'inferencia_us')
        for k in ('activa', 'dudosa'):
            booleano(d.get(k), k)
        if type(d.get('clase')) is not int or d['clase'] not in (-1, 0, 1, 2):
            raise ValueError('Clase Tiny IA invalida')
        numero(d.get('voto'), 'voto', 0, 1)
        if (d['activa'] and d['clase'] == -1) or (not d['activa'] and d['clase'] != -1):
            raise ValueError('Clase incompatible con modelo activo/inactivo')
    else:
        raise ValueError('Tipo de mensaje desconocido')
    return m


def cargar(texto):
    if not isinstance(texto, str) or len(texto.encode('utf-8')) > 16384:
        raise ValueError('Se admite texto JSON de hasta 16 KiB')
    def constante(_):
        raise ValueError('JSON no permite NaN/Infinity; usar null')
    return validar(json.loads(texto, parse_constant=constante))
