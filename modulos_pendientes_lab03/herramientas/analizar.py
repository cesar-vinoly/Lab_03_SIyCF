"""Exportar SQLite o analizar JSONL del protocolo v1. Evidencia experimental, no model checking."""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import sqlite3
from servidor.protocolo import validar


def leer(ruta):
    ruta = Path(ruta)
    if ruta.suffix == '.jsonl':
        with ruta.open(encoding='utf-8') as f:
            return [validar(json.loads(linea)) for linea in f if linea.strip()]
    db = sqlite3.connect(ruta.resolve().as_uri()+'?mode=ro', uri=True)
    try: return [validar(json.loads(r[0])) for r in db.execute('SELECT json FROM mensajes ORDER BY device,boot,seq')]
    finally: db.close()


def estadisticas(xs):
    if not xs: return {'n': 0, 'min': None, 'max': None, 'p95': None}
    xs = sorted(xs)
    return {'n': len(xs), 'min': xs[0], 'max': xs[-1], 'p95': xs[max(0, (95*len(xs)+99)//100-1)]}


def verificar(registros, decision_us=50000, parada_us=200000):
    grupos, sesiones = defaultdict(list), defaultdict(list)
    for m in registros:
        sesiones[m['device_id'], m['boot_id']].append(m)
        if m['kind'] == 'event':
            grupos[m['device_id'], m['boot_id'], m['data']['object_id']].append(m)
    incompletas = set()
    for k, ms in sesiones.items():
        seqs = sorted({m['seq'] for m in ms})
        if seqs and (seqs[0] != 1 or any(b != a+1 for a,b in zip(seqs,seqs[1:]))): incompletas.add(k)
        if any(m['kind']=='snapshot' and m['data']['dropped_events'] for m in ms): incompletas.add(k)
    salida=[]
    for k, ms in grupos.items():
        ms=sorted(ms,key=lambda m:m['t_us'])
        for inicio in ms:
            nombre=inicio['data']['name']
            if nombre=='objeto': requeridos=[{'decision_a','decision_b','dudoso'}]; plazo=decision_us
            elif nombre=='decision_a': requeridos=[{'servo_confirmado'}]; plazo=inicio['data'].get('deadline_us')
            elif nombre=='falla': requeridos=[{'motor_detenido'},{'alarma'}]; plazo=parada_us
            else: continue
            respuestas=[]
            for opciones in requeridos:
                r=next((m for m in ms if m['data']['name'] in opciones and m['t_us']>=inicio['t_us']),None)
                if r: respuestas.append(r['t_us']-inicio['t_us'])
            latencia=max(respuestas) if len(respuestas)==len(requeridos) else None
            # Ausencia de feedback NO demuestra que el servo o el motor no se movieran.
            estado='SIN_EVIDENCIA'
            if latencia is not None and plazo is not None:
                estado='VIOLADA' if latencia>plazo else 'CUMPLE_EN_TRAZA'
                if k[:2] in incompletas and estado=='CUMPLE_EN_TRAZA': estado='TRAZA_INCOMPLETA'
            salida.append({'device_id':k[0],'boot_id':k[1],'object_id':k[2],'propiedad':nombre,
                           'latencia_us':latencia,'deadline_us':plazo,'resultado':estado})
    return salida


def analizar(registros, decision_us=50000):
    # Duplicados exactos no cuentan dos veces; conflictos se rechazan.
    unicos={}
    for m in registros:
        validar(m)
        k=m['device_id'],m['boot_id'],m['seq']
        if k in unicos and unicos[k]!=m: raise ValueError('Secuencia conflictiva')
        unicos[k]=m
    registros=list(unicos.values())
    snapshots=[m['data'] for m in registros if m['kind']=='snapshot']
    finales={}
    clases=Counter()
    for m in registros:
        if m['kind']!='event': continue
        d=m['data']; k=(m['device_id'],m['boot_id'],d['object_id'])
        if d['name']=='fin_ciclo': finales[k]=m['t_us']
    decisiones={}
    for m in registros:
        if m['kind']=='event' and m['data']['name'] in ('decision_a','decision_b','dudoso'):
            k=(m['device_id'],m['boot_id'],m['data']['object_id'])
            decisiones.setdefault(k,m['data']['name'])
    clases.update(decisiones.values())
    ciclos=[]
    for k,t in finales.items():
        entradas=[m['t_us'] for m in registros if m['kind']=='event' and
                  (m['device_id'],m['boot_id'],m['data']['object_id'])==k and m['data']['name']=='objeto' and m['t_us']<=t]
        if entradas: ciclos.append((t-min(entradas))/1e6)
    # No sumar relojes de arranques diferentes para calcular la tasa.
    tasas=[]
    sesiones=defaultdict(list)
    for m in registros: sesiones[m['device_id'],m['boot_id']].append(m['t_us'])
    for k,ts in sesiones.items():
        duracion=(max(ts)-min(ts))/1e6
        n=sum(1 for f in finales if f[:2]==k)
        tasas.append({'device_id':k[0],'boot_id':k[1],'observacion_s':duracion,
                      'ciclos_finalizados':n,'objetos_min':60*n/duracion if duracion>0 else None})
    return {'mensajes':len(registros),'decisiones':dict(clases),'ciclos_finalizados':len(finales),
            'ciclo_s':estadisticas(ciclos),'tasas_por_arranque':tasas,
            'rpm_motor':estadisticas([d['rpm_motor'] for d in snapshots if d['encoder_valido'] and d['rpm_motor'] is not None]),
            'control_exec_us':estadisticas([d['control_exec_us'] for d in snapshots]),
            'control_late_us':estadisticas([d['control_late_us'] for d in snapshots]),
            'propiedades':verificar(registros,decision_us),
            'calidad_clasificacion':None,'oee':None,'corriente_motor_a':None,
            'limitacion':'Sin verdad de terreno, tiempos planificados ni sensor de corriente no se calculan esas metricas. Las tasas son sobre la ventana observada.'}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('entrada',type=Path)
    p.add_argument('--salida',type=Path,default=Path('salida/informe.json'))
    p.add_argument('--decision-ms',type=float,default=50)
    p.add_argument('--exportar-jsonl',type=Path)
    args=p.parse_args()
    if args.decision_ms<=0: p.error('decision-ms debe ser positivo')
    registros=leer(args.entrada)
    args.salida.parent.mkdir(parents=True,exist_ok=True)
    args.salida.write_text(json.dumps(analizar(registros,round(args.decision_ms*1000)),indent=2,ensure_ascii=False),encoding='utf-8')
    if args.exportar_jsonl:
        args.exportar_jsonl.parent.mkdir(parents=True,exist_ok=True)
        args.exportar_jsonl.write_text(''.join(json.dumps(m,allow_nan=False)+'\n' for m in registros),encoding='utf-8')
    print(args.salida.resolve())


if __name__=='__main__': main()
