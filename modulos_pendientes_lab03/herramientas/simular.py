"""Generador de trafico SINTETICO para pruebas. No es un gemelo digital ni un dataset de IA."""
import argparse
import asyncio
import json
from pathlib import Path
import uuid
from websockets.asyncio.client import connect


def mensajes(escenario='normal'):
    boot=uuid.uuid4().hex
    seq=0
    def m(t,kind,data):
        nonlocal seq
        seq+=1
        return dict(v=1,device_id='SIMULADO_NO_ES_ESP32',boot_id=boot,seq=seq,t_us=t,kind=kind,data=data)
    def evento(t,nombre,plazo=None):
        return m(t,'event',dict(name=nombre,object_id=1,value=None,deadline_us=plazo))
    yield evento(0,'objeto')
    yield evento(80000 if escenario=='decision_lenta' else 40000,'decision_a',1000000)
    for i in range(1,16):
        t=i*100000
        yield m(t,'snapshot',dict(estado='TRANSPORTANDO',rpm_motor=20 if escenario=='deslizamiento' else 80,
            rpm_ts=80,setpoint_rpm=80,dist_cm=9+i,encoder_valido=True,pos_m=None,pos_real_m=None,
            manual=False,metal=True,step_hz=2133,servo_us=1500,control_exec_us=2000,control_late_us=10,
            control_missed=0,heap_min=100000,stack_min=3000,dropped_ia=0,dropped_events=0,coalesced=0))
        if i==2: yield evento(t+1000,'servo_orden')
        if i==6 and escenario!='servo_sin_feedback': yield evento(t+1000,'servo_confirmado')
    yield evento(1600000,'fin_ciclo')
    if escenario=='falla_parada_lenta':
        yield evento(1700000,'falla')
        yield evento(1720000,'motor_orden_parar')
        yield evento(1730000,'alarma')
        yield evento(2000000,'motor_detenido')


async def enviar(uri, datos):
    async with connect(uri,proxy=None) as ws:
        previo=0
        for m in datos:
            await asyncio.sleep(max(0,(m['t_us']-previo)/1e6))
            previo=m['t_us']
            await ws.send(json.dumps(m))
            ack=json.loads(await ws.recv())
            if ack.get('seq')!=m['seq']: raise RuntimeError('ACK no coincide')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--escenario',choices=['normal','decision_lenta','deslizamiento','servo_sin_feedback','falla_parada_lenta'],default='normal')
    p.add_argument('--salida',type=Path,default=Path('salida/simulada.jsonl'))
    p.add_argument('--ws',help='Opcional: ws://127.0.0.1:8765/ws/device; usar una base de pruebas')
    a=p.parse_args(); datos=list(mensajes(a.escenario))
    a.salida.parent.mkdir(parents=True,exist_ok=True)
    a.salida.write_text(''.join(json.dumps(m)+'\n' for m in datos),encoding='utf-8')
    if a.ws: asyncio.run(enviar(a.ws,datos))
    print(f'Traza SINTETICA: {a.salida.resolve()}')


if __name__=='__main__': main()
