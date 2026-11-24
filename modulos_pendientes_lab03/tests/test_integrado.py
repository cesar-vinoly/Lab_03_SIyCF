import asyncio
import json
from pathlib import Path
import tempfile
import time
import unittest
from websockets.asyncio.server import serve
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed
from servidor.integrado import Gemelo, calcular, validar_snapshot
from herramientas.simular import mensajes
from herramientas.analizar import leer


def snapshot(seq=1, boot='b1'):
    m = next(m for m in mensajes() if m['kind'] == 'snapshot')
    m.update(seq=seq, boot_id=boot, t_us=seq*100000)
    m['data'].update(automatico=False, manual=True, emergencia=False, ensayo=False,
                     capturando=False, direccion=0, porcentaje=50, servo_grados=0,
                     encoder_rechazados=0, objeto=0)
    return m


async def esperar(ws, tipo, predicate=lambda m: True, timeout=2):
    async with asyncio.timeout(timeout):
        while True:
            m = json.loads(await ws.recv())
            if m.get('type') == tipo and predicate(m): return m


class IntegracionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = Gemelo(Path(self.tmp.name)/'traza.sqlite3')
        self.server = await serve(self.app.atender, '127.0.0.1', 0)
        self.url = f'ws://127.0.0.1:{self.server.sockets[0].getsockname()[1]}'
        self.ui = await connect(self.url+'/ws/ui')
        await esperar(self.ui, 'welcome')
        self.esp = await connect(self.url+'/ws/device')
        self.tasks = []
        await self.esp.send(json.dumps(snapshot()))
        await esperar(self.esp, 'ack')
        await esperar(self.ui, 'telemetry')

    async def asyncTearDown(self):
        for t in self.tasks: t.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        await self.ui.close(); await self.esp.close()
        self.server.close(); await self.server.wait_closed()
        self.tmp.cleanup()

    async def orden(self, accion, request='r1', valor=0):
        await self.ui.send(json.dumps(dict(type='command', request_id=request, action=accion, value=valor)))

    async def test_pieza_metal_memorizada_compartida_y_boot(self):
        m = snapshot(2)
        m['data'].update(dist_cm=9.3, metal=True)
        await self.esp.send(json.dumps(m)); await esperar(self.esp, 'ack')
        self.assertEqual((await esperar(self.ui, 'telemetry'))['pieza'], 'lata')
        m = snapshot(3)
        m['data'].update(dist_cm=30, metal=False)
        await self.esp.send(json.dumps(m)); await esperar(self.esp, 'ack')
        visual = await esperar(self.ui, 'telemetry')
        self.assertEqual(visual['pieza'], 'lata')
        self.assertFalse(visual['message']['data']['metal'])
        async with connect(self.url+'/ws/ui') as segunda:
            self.assertEqual((await esperar(segunda, 'welcome'))['pieza'], 'lata')
        m = snapshot(4); m['data'].update(dist_cm=38, metal=False, servo_grados=60)
        await self.esp.send(json.dumps(m)); await esperar(self.esp, 'ack')
        self.assertIsNone((await esperar(self.ui, 'telemetry'))['pieza'])
        async with connect(self.url+'/ws/ui') as durante_empuje:
            self.assertIsNone((await esperar(durante_empuje, 'welcome'))['pieza'])
        self.assertNotIn('pieza', leer(self.app.registro.ruta)[-1], 'Metadato visual fuera del registro crudo')
        await self.esp.close()
        await esperar(self.ui, 'link', lambda m: not m['connected'])
        self.esp = await connect(self.url+'/ws/device')
        m = snapshot(1, 'b2'); m['data'].update(dist_cm=9.3, metal=False)
        await self.esp.send(json.dumps(m)); await esperar(self.esp, 'ack')
        self.assertEqual((await esperar(self.ui, 'telemetry'))['pieza'], 'caja')

    async def test_solo_ack_esp_confirma_y_registro_no_se_mezcla(self):
        await self.orden('AUTO', valor=1)
        cmd = await esperar(self.esp, 'command')
        self.assertEqual(cmd['action'], 'AUTO')
        self.assertEqual(len(self.app.pendientes), 1)
        await self.esp.send(json.dumps(dict(type='command_ack', id=cmd['id'], applied=True, reason='aplicada')))
        result = await esperar(self.ui, 'command_result')
        self.assertTrue(result['applied']); self.assertEqual(result['request_id'], 'r1')
        self.assertEqual(len(leer(self.app.registro.ruta)), 1)
        self.assertFalse(self.app.snapshot['data']['automatico'], 'ACK no inventa snapshot')

    async def test_rechazo_control_y_parada_prioritaria(self):
        await self.orden('F')
        first = await esperar(self.esp, 'command')
        await self.orden('R', 'r2')
        result = await esperar(self.ui, 'command_result')
        self.assertFalse(result['applied']); self.assertIn('pendiente', result['reason'])
        await self.orden('S', 'r3')
        stop = await esperar(self.esp, 'command')
        self.assertEqual(stop['action'], 'S'); self.assertGreater(stop['id'], first['id'])
        await self.esp.send(json.dumps(dict(type='command_ack', id=first['id'], applied=False, reason='ensayo activo')))
        self.assertFalse((await esperar(self.ui, 'command_result'))['applied'])

    async def test_desconexion_no_reenvia_ordenes(self):
        await self.orden('F'); await esperar(self.esp, 'command')
        await self.esp.close()
        self.assertFalse((await esperar(self.ui, 'command_result'))['applied'])
        self.esp = await connect(self.url+'/ws/device')
        await self.esp.send(json.dumps(snapshot(2)))
        await esperar(self.esp, 'ack')
        self.assertEqual(self.app.pendientes, {})
        await self.orden('R', 'nueva')
        self.assertEqual((await esperar(self.esp, 'command'))['action'], 'R')

    async def test_latido_requiere_panel_y_snapshot_recientes(self):
        self.tasks.append(asyncio.create_task(self.app.latidos()))
        await esperar(self.esp, 'lease')
        for ws in self.app.ui: self.app.ui[ws] = -100
        # Drenar cualquier mensaje ya programado; no debe haber nuevos leases.
        with self.assertRaises(TimeoutError): await esperar(self.esp, 'lease', timeout=.6)
        self.app.reciente = -100
        await self.orden('F')
        self.assertFalse((await esperar(self.ui, 'command_result'))['applied'])

    async def test_timeout_de_orden_cierra_dispositivo(self):
        await self.orden('F'); cmd = await esperar(self.esp, 'command')
        ws, req, _, action = self.app.pendientes[cmd['id']]
        self.app.pendientes[cmd['id']] = (ws, req, time.monotonic()-2, action)
        self.tasks.append(asyncio.create_task(self.app.latidos()))
        self.assertFalse((await esperar(self.ui, 'command_result'))['applied'])
        await asyncio.wait_for(self.esp.wait_closed(), 2)

    async def test_ia_alarma_informe_y_calculo(self):
        m = dict(v=1, device_id=snapshot()['device_id'], boot_id='b1', seq=2, t_us=10000000,
                 kind='ia', data=dict(object_id=1, input_t_us=100000, inferencia_us=30,
                                     activa=True, dudosa=False, clase=1, voto=.9, manual=False))
        await self.esp.send(json.dumps(m)); await esperar(self.esp, 'ack')
        self.assertEqual((await esperar(self.ui, 'alarm'))['codigo'], 'senal_intermitente')
        await self.ui.send(json.dumps({'type': 'report'}))
        self.assertEqual((await esperar(self.ui, 'report'))['data']['mensajes'], 2)
        await self.ui.send(json.dumps(dict(type='calculate', calculo='sincronizacion', rpm_motor=80,
                       radio_rodillo_m=.02, distancia_m=.3, servo_s=1, margen_s=.2)))
        r = await esperar(self.ui, 'calculation')
        self.assertTrue(r['data']['viable'])

    async def test_reinicio_borra_ia_y_rechaza_duplicado_activo(self):
        other = await connect(self.url+'/ws/device')
        with self.assertRaises(ConnectionClosed): await other.recv()
        self.app.ia = {'antigua': True}
        await self.esp.close(); await self.esp.wait_closed()
        await esperar(self.ui, 'link', lambda m: not m['connected'])
        self.esp = await connect(self.url+'/ws/device')
        await self.esp.send(json.dumps(snapshot(1, 'nuevo'))); await esperar(self.esp, 'ack')
        self.assertIsNone(self.app.ia)


class ValidacionTests(unittest.TestCase):
    def test_snapshot_y_metricas_no_admiten_valores_incoherentes(self):
        s = snapshot()['data']; validar_snapshot(s)
        s['automatico'] = True
        with self.assertRaises(ValueError): validar_snapshot(s)
        with self.assertRaises(ValueError): calcular(dict(calculo='oee',total=10,buenos=12,planificado_s=60,operativo_s=60,ciclo_ideal_s=1))
        with self.assertRaises(ValueError): calcular(dict(calculo='sincronizacion',rpm_motor=0,radio_rodillo_m=.01,distancia_m=.3,servo_s=1,margen_s=.1))


if __name__ == '__main__': unittest.main()
