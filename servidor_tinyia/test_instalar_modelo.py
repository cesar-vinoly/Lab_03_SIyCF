import copy
import json
from pathlib import Path
import tempfile
import unittest

from datos import Almacen
from instalar_modelo import instalar

BASE = Path(__file__).resolve().parent


class InstalacionTinyIA(unittest.TestCase):
    def test_instala_exportacion_y_procedencia_sin_cambiar_arboles(self):
        with tempfile.TemporaryDirectory() as temporal:
            destino = Path(temporal) / 'main'
            huella = instalar(BASE / 'salida_manual', destino, 'manual')
            self.assertEqual((destino / 'modelo_calidad.h').read_bytes(),
                             (BASE / 'salida_manual/modelo_calidad.h').read_bytes())
            info = (destino / 'modelo_calidad_info.h').read_text()
            self.assertIn(huella, info)
            self.assertIn('#define TINY_ENTRENADO_MANUAL 1', info)

    def test_rechaza_modelo_alterado_sin_reemplazar_instalado(self):
        with tempfile.TemporaryDirectory() as temporal:
            temporal = Path(temporal)
            fuente, destino = temporal / 'salida', temporal / 'main'
            fuente.mkdir()
            for nombre in ('metricas.json', 'modelo_calidad.h'):
                (fuente / nombre).write_bytes((BASE / 'salida_manual' / nombre).read_bytes())
            instalar(fuente, destino, 'manual')
            original = {p.name: p.read_bytes() for p in destino.iterdir()}
            with (fuente / 'modelo_calidad.h').open('a') as f:
                f.write('\n// cambio ajeno al entrenamiento\n')
            with self.assertRaisesRegex(ValueError, 'no corresponde'):
                instalar(fuente, destino, 'manual')
            self.assertEqual(original, {p.name: p.read_bytes() for p in destino.iterdir()})

    def test_servidor_conserva_resultado_sin_etiquetar(self):
        with (BASE / 'capturas.jsonl').open(encoding='utf-8-sig') as f:
            captura = json.loads(next(f))['payload']
        captura = copy.deepcopy(captura)
        captura['ia'] = {
            'activa': True, 'clase': 1, 'voto': 0.5625, 'dudosa': True,
            'inferencia_us': 100, 'stack_free_min': 2500,
            'modelo_sha256': json.loads((BASE / 'salida_manual/metricas.json').read_text())['modelo_sha256'],
            'origen_entrenamiento': 'manual', 'alcance': 'piezas_fijas',
            'fuera_procedimiento': captura['origen'] != 'manual',
        }
        with tempfile.TemporaryDirectory() as temporal:
            db = Almacen(Path(temporal) / 'prueba.sqlite3')
            identificador, creada = db.insertar(captura)
            self.assertTrue(creada)
            registro = db.obtener(identificador)
            self.assertEqual(registro['payload']['ia'], captura['ia'])
            self.assertEqual(registro['etiqueta'], '')
            self.assertFalse(db.insertar(captura)[1])


if __name__ == '__main__':
    unittest.main()
