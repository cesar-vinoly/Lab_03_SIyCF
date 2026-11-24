import asyncio
import json
import math
from pathlib import Path
import tempfile
import unittest
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed
from servidor.app import Aplicacion, Registro
from servidor.protocolo import cargar, validar
from servidor.supervision import Supervisor
from herramientas.simular import mensajes
from herramientas.analizar import analizar, leer
from herramientas.operacion import velocidad_banda, sincronizacion, oee, perdida_anual


class DatosTests(unittest.TestCase):
    def test_validacion_y_unidades(self):
        datos=list(mensajes())
        for m in datos: validar(m)
        s=next(m for m in datos if m['kind']=='snapshot')
        s['data']['rpm_motor']=math.nan
        with self.assertRaises(ValueError): cargar(json.dumps(s))
        s['data']['rpm_motor']=0
        s['data']['encoder_valido']=False
        with self.assertRaises(ValueError): validar(s)
        s['data']['rpm_motor']=None
        validar(s)
        with self.assertRaises(ValueError): cargar(b'no texto')
        with self.assertRaises(ValueError): cargar('x'*17000)

    def test_sqlite_deduplicacion_conflicto_y_exportacion(self):
        with tempfile.TemporaryDirectory() as d:
            ruta=Path(d)/'datos.sqlite3'; r=Registro(ruta)
            m=next(mensajes())
            self.assertTrue(r.guardar(m)); self.assertFalse(r.guardar(m))
            otro={**m,'t_us':99}
            with self.assertRaises(ValueError): r.guardar(otro)
            self.assertEqual(leer(ruta),[m])

    def test_propiedades_y_falta_feedback(self):
        normal=analizar(list(mensajes()))
        self.assertTrue(all(p['resultado']=='CUMPLE_EN_TRAZA' for p in normal['propiedades']))
        self.assertEqual(normal['ciclos_finalizados'],1)
        self.assertEqual(normal['ciclo_s']['max'],1.6)
        lenta=analizar(list(mensajes('decision_lenta')))
        self.assertEqual(lenta['propiedades'][0]['resultado'],'VIOLADA')
        sinservo=analizar(list(mensajes('servo_sin_feedback')))
        servo=next(p for p in sinservo['propiedades'] if p['propiedad']=='decision_a')
        self.assertEqual(servo['resultado'],'SIN_EVIDENCIA')
        parada=analizar(list(mensajes('falla_parada_lenta')))
        self.assertEqual(parada['propiedades'][-1]['resultado'],'VIOLADA')

    def test_no_ocultar_perdida_de_traza_ni_contar_duplicados(self):
        datos=list(mensajes()); r=analizar(datos+datos)
        self.assertEqual(r['ciclos_finalizados'],1)
        del datos[3]
        r=analizar(datos)
        self.assertTrue(all(p['resultado']=='TRAZA_INCOMPLETA' for p in r['propiedades']))

    def test_supervision_ts_no_confunde_sin_pulsos_con_atasco(self):
        s=Supervisor(); avisos=[]
        for m in mensajes('deslizamiento'): avisos+=s.procesar(m)
        self.assertIn('divergencia_rpm_ts',avisos)
        s=Supervisor()
        for m in mensajes('deslizamiento'):
            if m['kind']=='snapshot': m['data'].update(encoder_valido=False,rpm_motor=None)
            self.assertNotIn('divergencia_rpm_ts',s.procesar(m))

    def test_dudas_por_objeto_no_por_muestra(self):
        s=Supervisor(ventana=3)
        for i in range(3):
            m=dict(v=1,device_id='test',boot_id='boot',seq=i+1,t_us=i*1000,kind='ia',
                   data=dict(object_id=i+1,input_t_us=i*1000,inferencia_us=20,activa=True,clase=1,voto=.5,dudosa=True))
            validar(m); avisos=s.procesar(m)
            self.assertEqual(s.procesar(m),[])
        self.assertIn('tres_dudosos_consecutivos',avisos)
        self.assertIn('tasa_dudosos_alta',avisos)

    def test_calculos_y_limites_sin_inventar_medidas(self):
        self.assertAlmostEqual(velocidad_banda(60,.02),.95*math.pi*.02)
        self.assertFalse(sincronizacion(.1,.2,1,.1)['viable'])
        self.assertTrue(sincronizacion(.4,.1,1,.1)['viable'])
        self.assertAlmostEqual(oee(100,90,200,150,1)['oee'],.45)
        self.assertTrue(oee(100,90,200,100,2)['revisar_ciclo_ideal'])
        self.assertEqual(perdida_anual(5000,.02,.1,8,250),20000)
        with self.assertRaises(ValueError): sincronizacion(.1,0,1,0)
        with self.assertRaises(ValueError): oee(10,11,20,10,1)


class WebSocketTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.app=Aplicacion(Path(self.tmp.name)/'ws.sqlite3')
        self.server=await serve(self.app.atender,'127.0.0.1',0,compression=None,max_size=16384)
        self.url=f'ws://127.0.0.1:{self.server.sockets[0].getsockname()[1]}'

    async def asyncTearDown(self):
        self.server.close(); await self.server.wait_closed(); self.tmp.cleanup()

    async def test_productor_observador_persistencia_y_reconexion(self):
        m=next(mensajes())
        async with connect(self.url+'/ws/observer',proxy=None) as observador:
            async with connect(self.url+'/ws/device',proxy=None) as placa:
                await placa.send(json.dumps(m))
                self.assertEqual(json.loads(await placa.recv())['seq'],1)
                recibido=json.loads(await asyncio.wait_for(observador.recv(),2))
                self.assertEqual(recibido['message'],m)
            async with connect(self.url+'/ws/device',proxy=None) as placa:
                await placa.send(json.dumps(m))
                self.assertEqual(json.loads(await placa.recv())['seq'],1)
        self.assertEqual(len(leer(self.app.registro.ruta)),1)

    async def test_ruta_invalida_y_contenido_malformado(self):
        async with connect(self.url+'/no-existe',proxy=None) as ws:
            with self.assertRaises(ConnectionClosed): await ws.recv()
        async with connect(self.url+'/ws/device',proxy=None) as ws:
            await ws.send('{"v":1}')
            with self.assertRaises(ConnectionClosed): await ws.recv()

    async def test_observador_lento_no_bloquea_y_alarma_sin_telemetria(self):
        q=asyncio.Queue(maxsize=1); self.app.observadores.add(q)
        self.app.difundir({'a':1}); self.app.difundir({'a':2})
        self.assertIsNone(q.get_nowait()); self.assertNotIn(q,self.app.observadores)
        m=next(mensajes()); await self.app.recibir(m)
        q=asyncio.Queue(maxsize=10); self.app.observadores.add(q)
        tarea=asyncio.create_task(self.app.vigilar())
        try:
            alarma=json.loads(await asyncio.wait_for(q.get(),2))
            self.assertEqual(alarma['codigo'],'telemetria_vencida')
        finally:
            tarea.cancel(); await asyncio.gather(tarea,return_exceptions=True)


if __name__=='__main__': unittest.main()
