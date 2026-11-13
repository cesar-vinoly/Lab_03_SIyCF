import copy
import io
import unittest
from contextlib import redirect_stdout
from entrenar import filtrar_origen, mostrar_lotes, preparar
from test_servidor import captura


class LotesTests(unittest.TestCase):
    def registros(self):
        a, b, c = captura(1), captura(2), captura(3)
        a.update(origen='manual', orden_manual=1)
        c.update(origen='manual', orden_manual=2, config={'espera_ms': 200})
        return [dict(payload=p, etiqueta='senal_normal', pieza_id='caja_01', material='no_metalico') for p in (a,b,c)]

    def test_filtrar_conserva_datos_y_no_mezcla_configuraciones(self):
        rs = self.registros(); original = copy.deepcopy(rs)
        manuales = filtrar_origen(rs, 'manual')
        self.assertEqual(len(manuales), 2)
        self.assertEqual(len(filtrar_origen(rs, 'automatica')), 1)
        self.assertEqual(filtrar_origen(rs, None), rs)
        self.assertEqual(rs, original)
        with self.assertRaisesRegex(ValueError, 'configuraciones'):
            preparar(manuales)

    def test_resumen_no_cuenta_repeticiones_como_piezas_ni_incompletas(self):
        rs = self.registros()
        rs.append(copy.deepcopy(rs[0]))  # Reenvio duplicado.
        mala = copy.deepcopy(rs[0]); mala['payload']['cycle_id'] = 4
        mala['payload']['samples'].pop(); rs.append(mala)
        texto = io.StringIO()
        with redirect_stdout(texto): mostrar_lotes(rs)
        self.assertIn('senal_normal: 1 pruebas, 1 piezas', texto.getvalue())
        self.assertIn('senal_intermitente: 0 pruebas, 0 piezas', texto.getvalue())
        self.assertIn('Excluidas del recuento: 2', texto.getvalue())


if __name__ == '__main__': unittest.main()
