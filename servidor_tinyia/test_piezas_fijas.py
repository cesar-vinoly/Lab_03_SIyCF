import copy
import tempfile
import unittest
from pathlib import Path
from entrenar import entrenar, preparar, separar_pasadas
from features import CLASES
from test_servidor import captura, BASE


def datos():
    rs=[]
    for clase in range(3):
        for pieza in ('lata_01', 'caja_01'):
            for repeticion in range(5):
                ciclo=len(rs)+1
                p=captura(ciclo,clase,repeticion)
                p.update(origen='manual',orden_manual=ciclo)
                for s in p['samples']: s['t_ms']+=ciclo*11000
                rs.append(dict(payload=p,etiqueta=CLASES[clase],pieza_id=pieza,
                               material='metalico' if pieza=='lata_01' else 'no_metalico'))
    return rs


class PiezasFijasTests(unittest.TestCase):
    def test_entrena_dos_piezas_con_pasadas_completas_reservadas(self):
        rs=datos(); original=copy.deepcopy(rs)
        (BASE/'.pruebas').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=BASE/'.pruebas') as d:
            r=entrenar(rs,Path(d),piezas_fijas=True)
            self.assertEqual(r['evaluacion']['alcance'],'piezas_fijas')
            self.assertEqual(r['capturas_train'],24)
            self.assertEqual(r['capturas_test'],6)
            self.assertEqual(r['piezas_train'],r['piezas_test'])
            self.assertFalse(set(r['ids_train']) & set(r['ids_test']))
            self.assertEqual({int(i.rsplit(':',1)[1]) for i in r['ids_test']},{5,10,15,20,25,30})
            self.assertTrue((Path(d)/'modelo_calidad.h').exists())
            self.assertEqual(rs,original)

    def test_no_acepta_ventanas_solapadas_ni_pieza_sin_clase(self):
        rs=datos()
        rs[4]['payload']['samples']=copy.deepcopy(rs[3]['payload']['samples'])
        _,y,g,ids,_,_=preparar(rs)
        with self.assertRaisesRegex(ValueError,'solapadas'):
            separar_pasadas(y,g,ids,rs)
        rs=datos()[1:]
        _,y,g,ids,_,_=preparar(rs)
        with self.assertRaisesRegex(ValueError,'lata_01 / senal_normal'):
            separar_pasadas(y,g,ids,rs)

    def test_sigue_rechazando_clase_ausente(self):
        rs=[r for r in datos() if r['etiqueta']!='senal_normal']
        with self.assertRaisesRegex(ValueError,'senal_normal: hay 0'):
            entrenar(rs,BASE/'.pruebas'/'no_crear_fijas',piezas_fijas=True)


if __name__=='__main__':unittest.main()
