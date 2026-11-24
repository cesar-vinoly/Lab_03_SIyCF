import copy
import unittest
from servidor.pieza_visual import PiezaVisual


class PiezaTests(unittest.TestCase):
    def setUp(self):
        self.p = PiezaVisual()
        self.t = 0

    def snap(self, cm, metal=False, automatico=True, dt=100_000, boot='b1', servo=0):
        self.t += dt
        m = dict(device_id='d', boot_id=boot, t_us=self.t, kind='snapshot',
                 data=dict(dist_cm=cm, metal=metal, automatico=automatico, servo_grados=servo))
        original = copy.deepcopy(m)
        r = self.p.observar(m)
        self.assertEqual(m, original, 'No alterar telemetría ni datos de entrenamiento')
        return r

    def evento(self, name, objeto):
        return self.p.observar(dict(device_id='d', boot_id='b1', t_us=self.t, kind='event',
                                    data=dict(name=name, object_id=objeto)))

    def test_lata_permanece_al_alejarse_del_inductivo(self):
        self.assertEqual(self.snap(9, True), 'lata')
        self.evento('objeto', 1)
        for cm in (12, 20, 30, 35): self.assertEqual(self.snap(cm), 'lata')
        self.assertEqual(self.snap(None), 'lata', 'Conservar identidad durante un eco perdido')
        self.assertEqual(self.snap(35), 'lata')
        self.evento('fin_ciclo', 1)
        self.evento('objeto', 2)
        self.assertEqual(self.snap(9), 'caja', 'La siguiente pieza no hereda metal')

    def test_decision_memoria_previa_y_reinicio(self):
        self.snap(None, True)
        self.assertEqual(self.snap(9), 'lata')
        self.evento('decision_b', 2)
        self.assertEqual(self.snap(25), 'caja')
        self.evento('decision_a', 2)
        self.assertEqual(self.snap(30), 'lata')
        self.assertEqual(self.snap(9, boot='b2'), 'caja')

    def test_directo_ausencia_y_fondo(self):
        self.assertIsNone(self.snap(114))
        self.assertEqual(self.snap(10, True, automatico=False), 'lata')
        self.assertIsNone(self.snap(114, automatico=False, dt=2_100_000))
        self.assertEqual(self.snap(12, automatico=False), 'caja')
        self.assertIsNone(self.snap(None, dt=5_100_000))

    def test_eco_de_pala_no_se_dibuja_como_pieza(self):
        self.assertEqual(self.snap(9, True), 'lata')
        for angle in (1.2, 30, 60, 60, 45, 10):
            self.assertIsNone(self.snap(38, servo=angle))
            self.assertEqual(self.p.tipo, 'lata', 'Conservar identidad sin atribuir el eco a la lata')
            self.assertIsNone(self.p.representacion, 'Una pestaña nueva tampoco muestra el falso objeto')
        self.assertIsNone(self.evento('servo_orden', 1), 'Un evento no debe hacer reaparecer el modelo')
        for _ in range(3): self.assertIsNone(self.snap(38, servo=0))
        self.assertEqual(self.snap(38, servo=0), 'lata', 'Si aún hay eco tras centrar, puede seguir la pieza')
        self.evento('fin_ciclo', 1)
        self.assertIsNone(self.snap(None))

    def test_retornar_otra_vez_y_nuevo_boot_reinician_espera_visual(self):
        self.snap(9, True)
        self.snap(38, servo=60)
        self.snap(38, servo=0)
        self.assertIsNone(self.snap(38, servo=60))
        for _ in range(3): self.assertIsNone(self.snap(38, servo=0))
        self.assertEqual(self.snap(9, boot='b2'), 'caja')
