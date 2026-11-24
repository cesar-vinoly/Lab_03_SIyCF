"""Backend del gemelo: protocolo v1, mando confirmado, trazas y supervision."""
import argparse
import asyncio
from collections import deque
from contextlib import closing
import json
from pathlib import Path
import time
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed
from .app import Aplicacion
from .pieza_visual import PiezaVisual
from .protocolo import validar, numero, entero, booleano
from herramientas.analizar import analizar
from herramientas.operacion import velocidad_banda, sincronizacion, oee, perdida_anual


def mensaje(texto):
    if not isinstance(texto, str) or len(texto.encode()) > 16384:
        raise ValueError('Se requiere JSON de hasta 16 KiB')
    def rechazar(_): raise ValueError('Numero JSON no finito')
    m = json.loads(texto, parse_constant=rechazar)
    if not isinstance(m, dict): raise ValueError('Se requiere objeto JSON')
    return m


def validar_snapshot(d):
    for k in ('automatico', 'emergencia', 'ensayo', 'capturando'): booleano(d.get(k), k)
    if type(d.get('direccion')) is not int or d['direccion'] not in (-1, 0, 1):
        raise ValueError('Direccion invalida')
    entero(d.get('porcentaje'), 'porcentaje'); numero(d['porcentaje'], 'porcentaje', 0, 100)
    numero(d.get('servo_grados'), 'servo_grados', 0, 180)
    for k in ('encoder_rechazados', 'objeto'): entero(d.get(k), k)
    if d['manual'] == d['automatico']: raise ValueError('Modo inconsistente')


def calcular(d):
    # Listas de argumentos exactas: no ejecutar nombres enviados por el navegador.
    tipo = d.get('calculo')
    campos = {
        'sincronizacion': ('rpm_motor', 'radio_rodillo_m', 'distancia_m', 'servo_s', 'margen_s'),
        'oee': ('total', 'buenos', 'planificado_s', 'operativo_s', 'ciclo_ideal_s'),
        'perdidas': ('objetos_h', 'fraccion_reproceso', 'costo_objeto', 'horas_dia', 'dias_anio')}
    if tipo not in campos: raise ValueError('Calculo desconocido')
    valores = [d.get(k) for k in campos[tipo]]
    for k, v in zip(campos[tipo], valores): numero(v, k, 0, 1e9)
    if tipo == 'sincronizacion':
        rpm, radio, distancia, servo, margen = valores
        v = velocidad_banda(rpm, radio)
        return {'velocidad_m_s': v, **sincronizacion(distancia, v, servo, margen)}
    if tipo == 'oee': return oee(*valores)
    return {'perdida_anual': perdida_anual(*valores)}


class Gemelo(Aplicacion):
    def __init__(self, ruta):
        super().__init__(ruta)
        self.device = None
        self.identidad = None
        self.snapshot = None
        self.ia = None
        self.reciente = 0
        self.ui = {}  # WebSocket -> ultimo latido del navegador
        self.pendientes = {}
        self.id_orden = 0
        self.avisos = deque(maxlen=40)
        self.ultimo_aviso = {}
        self.pieza_visual = PiezaVisual()

    def difundir(self, m):
        if m['type'] == 'telemetry':
            m = {**m, 'pieza': self.pieza_visual.observar(m['message'])}
        if m['type'] == 'alarm':
            key = (m.get('boot_id'), m['codigo'])
            ahora = time.monotonic()
            if ahora-self.ultimo_aviso.get(key, -10) < 5: return
            self.ultimo_aviso[key] = ahora
            self.avisos.append({**m, 'recibida': time.time()})
        super().difundir(m)

    def vivo(self):
        return self.device is not None and time.monotonic()-self.reciente < 1

    async def enviar(self, ws, m):
        await asyncio.wait_for(ws.send(json.dumps(m, allow_nan=False)), 1)

    def informe(self):
        if not self.identidad: return {'mensajes': 0}
        with closing(self.registro.conexion()) as db:
            filas = db.execute('SELECT json FROM mensajes WHERE device=? AND boot=? ORDER BY seq', self.identidad)
            return analizar([json.loads(row[0]) for row in filas])

    async def comando(self, ws, m):
        request_id = m.get('request_id')
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 64:
            raise ValueError('request_id invalido')
        accion, valor = m.get('action'), m.get('value', 0)
        if accion not in ('F', 'R', 'S', 'E', 'V', 'AUTO', 'RESET'): raise ValueError('Orden desconocida')
        if accion in ('V', 'AUTO'):
            entero(valor, 'value'); numero(valor, 'value', 0, 100 if accion == 'V' else 1)
        def rechazo(razon):
            return self.enviar(ws, {'type': 'command_result', 'request_id': request_id,
                                  'applied': False, 'reason': razon})
        if not self.vivo(): return await rechazo('ESP32 sin telemetria reciente')
        if self.pendientes and accion not in ('S', 'E'): return await rechazo('Hay una orden pendiente')
        self.id_orden = self.id_orden % 2147483647 + 1
        ident = self.id_orden
        self.pendientes[ident] = (ws, request_id, time.monotonic(), accion)
        try:
            self.ui[ws] = time.monotonic()
            await self.enviar(self.device, {'type': 'lease'})
            await self.enviar(self.device, {'type': 'command', 'id': ident, 'action': accion, 'value': valor})
        except (ConnectionClosed, TimeoutError):
            self.pendientes.pop(ident, None)
            await rechazo('No se pudo entregar a la ESP32')

    async def latidos(self):
        while True:
            await asyncio.sleep(.25)
            ahora = time.monotonic()
            if self.vivo() and any(ahora-t < 1.5 for t in self.ui.values()):
                try: await self.enviar(self.device, {'type': 'lease'})
                except (ConnectionClosed, TimeoutError): pass
            vencidas = [i for i, p in self.pendientes.items() if ahora-p[2] > 1.5]
            for i in vencidas:
                _, req, _, accion = self.pendientes.pop(i)
                self.difundir({'type': 'command_result', 'request_id': req, 'action': accion,
                               'applied': False, 'reason': 'Sin confirmacion; enlace cerrado para detener'})
            if vencidas and self.device: await self.device.close(1011, 'Orden sin confirmacion')
            self.difundir({'type': 'link', 'connected': self.vivo()})

    async def cliente(self, ws):
        q = asyncio.Queue(maxsize=64)
        self.observadores.add(q); self.ui[ws] = time.monotonic()
        async def escribir():
            while True:
                texto = await q.get()
                if texto is None:
                    await ws.close(1013, 'Cliente lento'); return
                await asyncio.wait_for(ws.send(texto), 1)
        tx = asyncio.create_task(escribir())
        try:
            await self.enviar(ws, {'type': 'welcome', 'connected': self.vivo(), 'snapshot': self.snapshot,
                                  'ia': self.ia, 'alarms': list(self.avisos), 'pieza': self.pieza_visual.representacion})
            async for texto in ws:
                try:
                    m = mensaje(texto)
                    if m.get('type') == 'heartbeat': self.ui[ws] = time.monotonic()
                    elif m.get('type') == 'command': await self.comando(ws, m)
                    elif m.get('type') == 'report':
                        r = await asyncio.to_thread(self.informe)
                        # Resultados completos en disco; respuesta de la HMI acotada.
                        props = r.get('propiedades', [])
                        r['propiedades_total'] = len(props)
                        r['propiedades'] = props[-200:]
                        await self.enviar(ws, {'type': 'report', 'data': r})
                    elif m.get('type') == 'calculate':
                        await self.enviar(ws, {'type': 'calculation', 'calculo': m.get('calculo'), 'data': calcular(m)})
                    else: raise ValueError('Solicitud desconocida')
                except (ValueError, TypeError, KeyError) as e:
                    await self.enviar(ws, {'type': 'error', 'message': str(e)[:160]})
        except (ConnectionClosed, TimeoutError): pass
        finally:
            self.ui.pop(ws, None); self.observadores.discard(q)
            tx.cancel(); await asyncio.gather(tx, return_exceptions=True)

    async def atender(self, ws):
        if ws.request.path == '/ws/ui': return await self.cliente(ws)
        if ws.request.path == '/ws/observer': return await super().atender(ws)
        if ws.request.path != '/ws/device': return await ws.close(1008, 'Ruta desconocida')
        if self.device is not None: return await ws.close(1008, 'Ya hay una ESP32 conectada')
        self.device = ws
        identidad = None
        try:
            async for texto in ws:
                m = mensaje(texto)
                if m.get('type') == 'command_ack':
                    entero(m.get('id'), 'id', 1); booleano(m.get('applied'), 'applied')
                    if not isinstance(m.get('reason'), str) or len(m['reason']) > 160: raise ValueError('ACK invalido')
                    pendiente = self.pendientes.pop(m['id'], None)
                    if pendiente:
                        _, req, _, accion = pendiente
                        self.difundir({'type': 'command_result', 'request_id': req, 'action': accion,
                                       'applied': m['applied'], 'reason': m['reason']})
                    continue
                validar(m)
                if m['kind'] == 'snapshot': validar_snapshot(m['data'])
                if m['kind'] == 'ia': booleano(m['data'].get('manual'), 'manual')
                k = m['device_id'], m['boot_id']
                if identidad is None:
                    identidad = k
                    if k != self.identidad:
                        self.snapshot = self.ia = None; self.avisos.clear(); self.ultimo_aviso.clear()
                        self.pieza_visual = PiezaVisual()
                    self.identidad = k
                if identidad != k: raise ValueError('Cambio de identidad')
                nuevo = m['seq'] > self.max_seq.get(k, 0)
                await self.recibir(m)
                if nuevo:
                    if m['kind'] == 'snapshot': self.snapshot = m; self.reciente = time.monotonic()
                    elif m['kind'] == 'ia':
                        self.ia = m
                        d = m['data']
                        codigo = 'ia_sin_inferencia' if not d['activa'] else (
                            'ia_dudosa' if d['dudosa'] else ('senal_intermitente' if d['clase'] == 1 else 'senal_anomala' if d['clase'] == 2 else None))
                        if codigo: self.difundir({'type': 'alarm', 'codigo': codigo, 'object_id': d['object_id'], 'boot_id': k[1]})
                    elif m['kind'] == 'event' and m['data']['name'] in ('falla', 'alarma'):
                        self.difundir({'type': 'alarm', 'codigo': 'parada_enclavada' if m['data']['value'] != 2 else 'eco_perdido_antes_salida', 'boot_id': k[1]})
                await self.enviar(ws, {'type': 'ack', 'seq': m['seq']})
        except (ValueError, TypeError, KeyError) as e: await ws.close(1008, str(e)[:100])
        except (ConnectionClosed, TimeoutError): pass
        finally:
            if self.device is ws:
                self.device = None; self.reciente = 0
                for _, req, _, accion in self.pendientes.values():
                    self.difundir({'type': 'command_result', 'request_id': req, 'action': accion,
                                   'applied': False, 'reason': 'ESP32 desconectada; no se reenvia'})
                self.pendientes.clear()
                self.difundir({'type': 'link', 'connected': False})


async def ejecutar(args):
    app = Gemelo(args.db)
    tareas = [asyncio.create_task(app.vigilar()), asyncio.create_task(app.latidos())]
    try:
        async with serve(app.atender, '127.0.0.1', args.port, max_size=16384, max_queue=16,
                         compression=None, ping_interval=5, ping_timeout=5) as servidor:
            print(json.dumps({'ready': True, 'port': servidor.sockets[0].getsockname()[1]}), flush=True)
            await asyncio.Future()
    finally:
        for t in tareas: t.cancel()
        await asyncio.gather(*tareas, return_exceptions=True)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--port', type=int, default=0)
    p.add_argument('--parent-stdin', action='store_true')
    p.add_argument('--db', default=str(Path(__file__).resolve().parents[1]/'datos'/'gemelo.sqlite3'))
    args = p.parse_args()
    if args.parent_stdin:
        import os
        import sys
        import threading
        # Evitar un Python huerfano si Node termina abruptamente en Windows.
        def padre():
            sys.stdin.buffer.read()
            os._exit(0)
        threading.Thread(target=padre, daemon=True).start()
    try: asyncio.run(ejecutar(args))
    except KeyboardInterrupt: pass
