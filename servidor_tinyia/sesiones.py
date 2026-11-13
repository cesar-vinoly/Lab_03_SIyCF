"""Union transaccional de diez bloques antiguos; originales y etiquetas se archivan."""
import datetime as dt
import json
import sqlite3
from features import extraer


def unir_en_db(db, dispositivo, arranque, orden):
    filas = list(db.execute("SELECT * FROM capturas WHERE device_id=? AND boot_id=? "
        "AND json_extract(payload,'$.origen')='manual' AND json_extract(payload,'$.orden_manual')=? "
        "ORDER BY json_extract(payload,'$.bloque_manual')", (dispositivo, arranque, orden)))
    if len(filas) != 10: return None
    ps = [json.loads(r['payload']) for r in filas]
    if any(p.get('feature_version') != 1 or p.get('firmware') != 'cinta-ia-2' or
           p.get('bloque_manual') != i+1 or p.get('bloques_manual') != 10 or
           len(p['samples']) != 10 or p['cancelada'] or p.get('pretrigger') != 2 or
           p.get('period_ms') != 100 or p.get('config') != ps[0].get('config')
           for i,p in enumerate(ps)): return None
    p = dict(ps[0])
    p.update(feature_version=2, pretrigger=0, firmware='union-bloques/cinta-ia-2',
             samples=[s for bloque in ps for s in bloque['samples']],
             metal=any(b['metal'] for b in ps), ia={'activa': False, 'clase': -1},
             fuente_bloques_ids=[r['id'] for r in filas])
    p.pop('bloque_manual', None); p.pop('bloques_manual', None)
    try: extraer(p)
    except ValueError: return None # Nunca rellenar huecos, repetir o inventar samples.
    principal = filas[0]['id']
    for r in filas:
        db.execute('INSERT INTO bloques_archivados VALUES (?,?,?,?,?,?)',
            (r['id'], r['device_id'], r['boot_id'], r['cycle_id'], principal, json.dumps(dict(r))))
    def comun(campo):
        valores={r[campo] for r in filas}
        return valores.pop() if len(valores)==1 else ''
    db.execute("UPDATE capturas SET payload=?,etiqueta='',pieza_id=?,material=?,notas=? WHERE id=?",
        (json.dumps(p,ensure_ascii=False,allow_nan=False),comun('pieza_id'),comun('material'),
         'Prueba reunida de 10 bloques. Revisar y asignar una etiqueta global; originales conservados en bloques_archivados.',principal))
    db.executemany('DELETE FROM capturas WHERE id=?', [(r['id'],) for r in filas[1:]])
    return principal


def migrar_con_respaldo(almacen):
    with almacen.conexion() as db:
        grupos=list(db.execute("SELECT device_id,boot_id,json_extract(payload,'$.orden_manual') FROM capturas "
            "WHERE json_extract(payload,'$.feature_version')=1 AND json_extract(payload,'$.bloques_manual')=10 "
            "GROUP BY device_id,boot_id,json_extract(payload,'$.orden_manual') HAVING COUNT(*)=10"))
    if not grupos: return {'unidas': 0, 'respaldo': None}
    respaldo=almacen.ruta.with_name('respaldo-antes-ventana100-'+dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f')+'.sqlite3')
    fuente=sqlite3.connect(almacen.ruta); destino=sqlite3.connect(respaldo)
    try: fuente.backup(destino)
    finally: fuente.close(); destino.close()
    n=0
    with almacen.conexion() as db:
        db.execute('BEGIN IMMEDIATE')
        for g in grupos:
            if unir_en_db(db,*g) is not None: n+=1
    return {'unidas': n, 'respaldo': str(respaldo)}
