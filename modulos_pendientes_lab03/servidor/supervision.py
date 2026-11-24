"""Alarmas advisory; no controla motores ni certifica propiedades de seguridad."""
from collections import deque


class Supervisor:
    def __init__(self, error_rpm=15.0, persistencia_us=500000, error_pos_m=0.05,
                 ventana=20, tasa_duda=0.10):
        self.error_rpm, self.persistencia_us = error_rpm, persistencia_us
        self.error_pos_m, self.ventana, self.tasa_duda = error_pos_m, ventana, tasa_duda
        self.estado = {}

    def procesar(self, m):
        clave = (m['device_id'], m['boot_id'])
        s = self.estado.setdefault(clave, {'desde': None, 'ultimo': -1,
                                          'dudas': deque(maxlen=self.ventana), 'vistos': set(), 'racha': 0})
        d, t, alarmas = m['data'], m['t_us'], []
        if m['kind'] == 'snapshot':
            if t <= s['ultimo']:
                return []
            s['ultimo'] = t
            # No diagnosticar atasco usando solamente ausencia de pulsos o sin eco.
            if d['estado'] == 'TRANSPORTANDO' and d['encoder_valido'] and d['rpm_motor'] is not None:
                if abs(d['rpm_motor']-d['rpm_ts']) > self.error_rpm:
                    if s['desde'] is None: s['desde'] = t
                    if t-s['desde'] >= self.persistencia_us: alarmas.append('divergencia_rpm_ts')
                else: s['desde'] = None
            else: s['desde'] = None
            if d.get('pos_m') is not None and d.get('pos_real_m') is not None:
                if abs(d['pos_m']-d['pos_real_m']) > self.error_pos_m:
                    alarmas.append('divergencia_posicion')
            if d['control_exec_us'] > 20000 or d['control_late_us'] > 20000:
                alarmas.append('periodo_control_excedido')
            if d['dropped_events']:
                alarmas.append('traza_incompleta')
        elif m['kind'] == 'ia' and d['activa'] and d['object_id'] not in s['vistos']:
            s['vistos'].add(d['object_id'])
            # Acotar memoria: la ventana y la deduplicacion solo cubren resultados recientes.
            if len(s['vistos']) > 4096: s['vistos'] = {d['object_id']}
            s['dudas'].append(d['dudosa'])
            s['racha'] = s['racha']+1 if d['dudosa'] else 0
            if s['racha'] >= 3: alarmas.append('tres_dudosos_consecutivos')
            if len(s['dudas']) == self.ventana and sum(s['dudas'])/self.ventana > self.tasa_duda:
                alarmas.append('tasa_dudosos_alta')
        return alarmas
