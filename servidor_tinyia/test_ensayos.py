"""Ordenes manuales con reloj simulado, sin conectar con la ESP32 real."""
import unittest
from ensayos import Ensayos
from datos import Conflicto


class EnsayoTests(unittest.TestCase):
    def setUp(self):
        self.t = 0
        self.e = Ensayos(lambda: self.t)
        self.p = dict(device_id="placa1", boot_id="arranque1", manual=False,
                      lista=False, ocupada=False, orden=0, restante_ms=0)

    def orden(self, accion):
        return self.e.ordenar({**self.p, "accion": accion})

    def lista(self):
        self.e.sondeo(self.p)
        self.orden("manual")
        self.p.update(manual=True, lista=True)
        self.e.sondeo(self.p)

    def test_confirmacion_modo_y_deduplicacion(self):
        with self.assertRaises(Conflicto): self.orden("manual")
        self.assertEqual(self.e.sondeo(self.p), "0 0\n")
        self.orden("manual")
        with self.assertRaises(Conflicto): self.orden("capturar")
        self.assertEqual(self.e.sondeo(self.p), "1 0\n")
        self.p.update(manual=True, lista=True)
        self.e.sondeo(self.p)
        self.assertEqual(self.orden("capturar")["orden"], 1)
        with self.assertRaises(Conflicto): self.orden("capturar")
        self.assertEqual(self.e.sondeo(self.p), "1 1\n")
        self.assertEqual(self.e.sondeo(self.p), "1 1\n")
        self.p.update(orden=1, ocupada=True, lista=False, restante_ms=10000)
        self.e.sondeo(self.p)
        with self.assertRaises(Conflicto): self.orden("capturar")
        with self.assertRaises(Conflicto): self.orden("automatico")
        self.t += 6  # La orden ya aceptada sigue ocupada aunque venza el plazo de entrega.
        self.p["restante_ms"] = 4000
        self.assertEqual(self.e.sondeo(self.p), "1 1\n")
        with self.assertRaises(Conflicto): self.orden("capturar")
        self.p.update(ocupada=False, lista=True, restante_ms=0)
        self.e.sondeo(self.p)
        self.assertEqual(self.orden("capturar")["orden"], 2)

    def test_orden_expira_sin_arrancar_tarde_y_desconexion_no_libera_motor(self):
        self.lista()
        self.orden("capturar")
        self.t += 6
        self.assertFalse(self.e.listar()[0]["conectada"])
        with self.assertRaises(Conflicto): self.orden("capturar")
        self.assertEqual(self.e.sondeo(self.p), "1 0\n")
        self.assertEqual(self.orden("capturar")["orden"], 2)

    def test_reinicio_servidor_conserva_modo_confirmado_y_secuencia(self):
        self.p.update(manual=True, lista=True, orden=12)
        self.assertEqual(self.e.sondeo(self.p), "1 12\n")
        self.assertEqual(self.orden("capturar")["orden"], 13)
        self.e = Ensayos(lambda: self.t)
        self.assertEqual(self.e.sondeo(self.p), "1 12\n")
        self.assertEqual(self.orden("capturar")["orden"], 13)

    def test_otra_placa_o_arranque_no_recibe_orden_antigua(self):
        self.lista()
        self.orden("capturar")
        otra = {**self.p, "device_id": "placa2", "manual": False, "lista": False}
        self.assertEqual(self.e.sondeo(otra), "0 0\n")
        nuevo = {**otra, "device_id": "placa1", "boot_id": "arranque2"}
        self.assertEqual(self.e.sondeo(nuevo), "0 0\n")
        with self.assertRaises(Conflicto): self.orden("capturar")

    def test_datos_invalidos_no_aceptados(self):
        for k, v in (("manual", 1), ("orden", -1), ("restante_ms", 60001), ("device_id", "")):
            with self.assertRaises(ValueError): self.e.sondeo({**self.p, k: v})

    def test_registro_continuo_sigue_ocupado_hasta_final(self):
        self.lista()
        self.orden('capturar')
        self.p.update(orden=1, ocupada=True, lista=False, registro_total_ms=10000, registro_restante_ms=10000)
        for restante in (10000, 8000, 3000, 100):
            self.p['registro_restante_ms'] = restante
            self.e.sondeo(self.p)
            self.assertEqual(self.e.listar()[0]['registro_restante_ms'], restante)
            with self.assertRaises(Conflicto): self.orden('automatico')
            with self.assertRaises(Conflicto): self.orden('capturar')
            self.t += 1
        self.p.update(ocupada=False, lista=True, registro_restante_ms=0)
        self.e.sondeo(self.p)
        self.assertEqual(self.orden('capturar')['orden'], 2)


if __name__ == "__main__":
    unittest.main()
