"""Receptor WebSocket y registro SQLite. No contiene HMI ni gemelo digital."""
import argparse
import asyncio
import json
from pathlib import Path
import sqlite3
import time
from contextlib import closing
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed
from .protocolo import cargar
from .supervision import Supervisor


class Registro:
    def __init__(self, ruta):
        self.ruta = Path(ruta)
        self.ruta.parent.mkdir(parents=True, exist_ok=True)
        with closing(self.conexion()) as db:
            with db:
                db.execute('PRAGMA journal_mode=WAL')
                db.execute('CREATE TABLE IF NOT EXISTS mensajes (device TEXT, boot TEXT, seq INTEGER, recibida REAL, json TEXT, PRIMARY KEY(device,boot,seq))')

    def conexion(self):
        return sqlite3.connect(self.ruta, timeout=5)

    def guardar(self, m):
        texto = json.dumps(m, sort_keys=True, separators=(',', ':'), allow_nan=False)
        clave = m['device_id'], m['boot_id'], m['seq']
        db = self.conexion()
        try:
            with db:
                anterior = db.execute('SELECT json FROM mensajes WHERE device=? AND boot=? AND seq=?', clave).fetchone()
                if anterior:
                    if anterior[0] != texto: raise ValueError('Secuencia repetida con otro contenido')
                    return False
                db.execute('INSERT INTO mensajes VALUES (?,?,?,?,?)', (*clave, time.time(), texto))
            return True
        finally:
            db.close()


class Aplicacion:
    def __init__(self, ruta):
        self.registro = Registro(ruta)
        self.supervisor = Supervisor()
        self.observadores = set()
        self.ultimos = {}
        self.productores = {}
        self.max_seq = {}
        self.serial = asyncio.Lock()

    def difundir(self, mensaje):
        texto = json.dumps(mensaje, allow_nan=False)
        for q in tuple(self.observadores):
            if q.full():
                # Un observador lento se desconecta; no retiene la adquisicion.
                self.observadores.discard(q)
                while not q.empty(): q.get_nowait()
                q.put_nowait(None)
            else: q.put_nowait(texto)

    async def recibir(self, m):
        async with self.serial:
            nueva = await asyncio.to_thread(self.registro.guardar, m)
            if not nueva: return
            k = m['device_id'], m['boot_id']
            previo = self.max_seq.get(k)
            if previo is not None and m['seq'] <= previo:
                # Se conserva en disco para analizar reordenamientos, sin alterar estado vivo.
                return
            if previo is not None and m['seq'] != previo+1:
                self.difundir({'type': 'alarm', 'device_id': k[0], 'boot_id': k[1], 'codigo': 'salto_secuencia'})
            self.max_seq[k] = m['seq']
            self.ultimos[k] = (time.monotonic(), False)
            self.difundir({'type': 'telemetry', 'message': m})
            for codigo in self.supervisor.procesar(m):
                self.difundir({'type': 'alarm', 'device_id': k[0], 'boot_id': k[1], 'codigo': codigo, 't_us': m['t_us']})

    async def vigilar(self):
        while True:
            await asyncio.sleep(0.25)
            for k, (t, avisada) in list(self.ultimos.items()):
                if not avisada and time.monotonic()-t >= 1:
                    self.ultimos[k] = (t, True)
                    self.difundir({'type': 'alarm', 'device_id': k[0], 'boot_id': k[1], 'codigo': 'telemetria_vencida'})

    async def atender(self, ws):
        ruta = ws.request.path
        if ruta == '/ws/observer':
            q = asyncio.Queue(maxsize=64)
            self.observadores.add(q)
            try:
                while True:
                    # Detectar cierre del cliente aunque no haya nuevas muestras.
                    try: texto = await asyncio.wait_for(q.get(), 1)
                    except TimeoutError:
                        if ws.close_code is not None: break
                        continue
                    if texto is None:
                        await ws.close(1013, 'Observador lento; reconectar')
                        break
                    await asyncio.wait_for(ws.send(texto), 1)
            except (ConnectionClosed, TimeoutError):
                pass
            finally: self.observadores.discard(q)
            return
        if ruta != '/ws/device':
            await ws.close(1008, 'Ruta inexistente')
            return
        identidad = None
        try:
            async for texto in ws:
                m = cargar(texto)
                nueva_identidad = (m['device_id'], m['boot_id'])
                if identidad is None:
                    identidad = nueva_identidad
                    if identidad in self.productores:
                        raise ValueError('Ya existe un productor para esta placa y arranque')
                    self.productores[identidad] = ws
                if identidad != nueva_identidad: raise ValueError('Identidad cambiada dentro de una conexion')
                await self.recibir(m)
                await ws.send(json.dumps({'type': 'ack', 'seq': m['seq']}))
        except (ValueError, TypeError, KeyError) as e:
            await ws.close(1008, str(e)[:100])
        except ConnectionClosed:
            pass
        finally:
            if identidad and self.productores.get(identidad) is ws:
                self.productores.pop(identidad, None)


async def ejecutar(args):
    app = Aplicacion(args.db)
    tarea = asyncio.create_task(app.vigilar())
    try:
        async with serve(app.atender, args.host, args.port, max_size=16384, max_queue=16,
                         compression=None, ping_interval=10, ping_timeout=10):
            print(f'WebSocket: ws://{args.host}:{args.port}/ws/device (sin HMI)', flush=True)
            await asyncio.Future()
    finally:
        tarea.cancel()
        await asyncio.gather(tarea, return_exceptions=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--host', default='127.0.0.1')
    p.add_argument('--port', type=int, default=8765)
    p.add_argument('--db', default=str(Path(__file__).resolve().parents[1]/'datos'/'telemetria.sqlite3'))
    try: asyncio.run(ejecutar(p.parse_args()))
    except KeyboardInterrupt: pass


if __name__ == '__main__': main()
