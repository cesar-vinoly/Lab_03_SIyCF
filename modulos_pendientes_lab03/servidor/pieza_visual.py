"""Memoria visual de una pieza. No modifica clasificación, órdenes ni trazas."""
class PiezaVisual:
    def __init__(self):
        self.tipo = None
        self.identidad = None
        self.objeto = 0
        self.ultimo_eco = -10_000_000
        self.ultimo_metal = -10_000_000
        self.eco_bloqueado = False
        self.centro_desde = None

    @property
    def representacion(self):
        return None if self.eco_bloqueado else self.tipo

    def observar(self, m):
        identidad = m['device_id'], m['boot_id']
        if identidad != self.identidad:
            self.__init__()
            self.identidad = identidad
        d, t = m['data'], m['t_us']
        if m['kind'] == 'event':
            name = d['name']
            if name == 'objeto':
                self.objeto = d['object_id']
                self.tipo = 'lata' if t-self.ultimo_metal <= 2_000_000 else 'caja'
            elif name in ('decision_a', 'decision_b'):
                self.objeto = d['object_id']
                self.tipo = 'lata' if name == 'decision_a' else 'caja'
            elif name in ('fin_ciclo', 'dudoso'):
                self.tipo = None
                self.ultimo_metal = -10_000_000
        elif m['kind'] == 'snapshot':
            if d.get('servo_grados', 0) > .1:
                self.eco_bloqueado = True
                self.centro_desde = None
                return None  # El eco puede pertenecer a la pala: conservar solo la identidad.
            if self.eco_bloqueado:
                if self.centro_desde is None: self.centro_desde = t
                if t-self.centro_desde < 300_000: return None
                self.eco_bloqueado = False
            if d.get('metal'): self.ultimo_metal = t
            cm = d.get('dist_cm')
            presente = isinstance(cm, (int, float)) and 2 <= cm <= 60
            if presente:
                if d.get('metal') or (self.tipo is None and t-self.ultimo_metal <= 2_000_000):
                    self.tipo = 'lata'
                elif self.tipo is None: self.tipo = 'caja'
                self.ultimo_eco = t
            elif t-self.ultimo_eco > (5_000_000 if d.get('automatico') else 500_000):
                if self.tipo is not None: self.ultimo_metal = -10_000_000
                self.tipo = None
        return self.representacion
