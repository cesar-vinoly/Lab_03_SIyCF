import json
import sqlite3
import unittest
from contextlib import closing
import test_servidor as fixtures
from test_servidor import captura
from datos import Conflicto
from features import extraer
from sesiones import migrar_con_respaldo


def bloques():
    salida=[]
    for i in range(10):
        p=captura(i+1)
        p.update(feature_version=1,pretrigger=2,firmware='cinta-ia-2',origen='manual',
                 orden_manual=7,bloque_manual=i+1,bloques_manual=10)
        p['samples']=p['samples'][:10]
        for s in p['samples']: s['t_ms']+=i*1000
        salida.append(p)
    return salida


class SesionesTests(unittest.TestCase):
    setUp=fixtures.DatosTests.setUp

    def guardar_legado(self, ps):
        with self.db.conexion() as db:
            for i,p in enumerate(ps):
                db.execute('INSERT INTO capturas(id,recibida,device_id,boot_id,cycle_id,payload,etiqueta,pieza_id,material,notas) VALUES (?,?,?,?,?,?,?,?,?,?)',
                    (i+1,'2026-11-08',p['device_id'],p['boot_id'],p['cycle_id'],json.dumps(p),'senal_normal','M01','metalico','nota original'))

    def test_unir_con_respaldo_originales_y_etiqueta_global_pendiente(self):
        ps=bloques(); self.guardar_legado(ps)
        r=migrar_con_respaldo(self.db)
        self.assertEqual(r['unidas'],1)
        with closing(sqlite3.connect(r['respaldo'])) as backup:
            self.assertEqual(backup.execute('SELECT COUNT(*) FROM capturas').fetchone()[0],10)
        filas=self.db.listar(); self.assertEqual(len(filas),1)
        fila=filas[0]
        self.assertEqual(fila['id'],1); self.assertEqual(fila['etiqueta'],'')
        self.assertEqual(fila['pieza_id'],'M01')
        self.assertEqual(len(fila['payload']['samples']),100)
        self.assertEqual(len(extraer(fila['payload'])),400)
        self.assertEqual(fila['payload']['samples'],[s for p in ps for s in p['samples']])
        with self.db.conexion() as db:
            originales=[json.loads(x[0]) for x in db.execute('SELECT original_json FROM bloques_archivados ORDER BY id')]
        self.assertEqual(len(originales),10)
        self.assertTrue(all(x['etiqueta']=='senal_normal' and x['notas']=='nota original' for x in originales))
        self.assertEqual(migrar_con_respaldo(self.db)['unidas'],0)
        self.assertEqual(self.db.insertar(ps[4]),(1,False))
        ps[4]['samples'][0]['dist_cm']=99
        with self.assertRaises(Conflicto): self.db.insertar(ps[4])

    def test_recepcion_legacy_une_una_vez_y_no_resucita_tras_borrado(self):
        ps=bloques()
        for p in ps: self.db.insertar(p)
        self.assertEqual(self.db.resumen()['total'],1)
        self.db.eliminar(1)
        for p in ps: self.assertEqual(self.db.insertar(p),(1,False))
        self.assertEqual(self.db.resumen()['total'],0)
        uid,_=self.db.insertar(captura(99))
        self.assertGreater(uid,10)

    def test_no_unir_incompletas_huecos_o_piezas_de_distintos_arranques(self):
        ps=bloques(); ps[4]['boot_id']='otro'
        for p in ps: self.db.insertar(p)
        self.assertEqual(self.db.resumen()['total'],10)
        self.assertEqual(migrar_con_respaldo(self.db)['unidas'],0)

    def test_no_unir_huecos_temporales(self):
        ps=bloques()
        for s in ps[-1]['samples']: s['t_ms']+=1000
        self.guardar_legado(ps)
        self.assertEqual(migrar_con_respaldo(self.db)['unidas'],0)
        self.assertEqual(self.db.resumen()['total'],10)

    def test_entrenamiento_no_reduce_ventana_y_excluye_cortas(self):
        a=captura(); b=captura()
        b['samples'][70]['dist_cm']=None
        xa,xb=extraer(a),extraer(b)
        self.assertNotEqual(xa,xb)
        self.assertEqual(xa[:280],xb[:280])
        with self.assertRaises(ValueError): extraer(bloques()[0])


if __name__=='__main__': unittest.main()
