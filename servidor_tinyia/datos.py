"""Validacion y almacenamiento SQLite. Los reintentos no duplican objetos."""
import datetime as dt
import json
import math
import re
import sqlite3
from pathlib import Path
from contextlib import contextmanager
from features import CLASES, extraer
from sesiones import unir_en_db

# Rango de uso del encoder en este montaje (ENCODER_MAX_MOTOR_RPM del firmware).
# Se advierte fuera de este rango; no se descarta la captura de otros sensores.
RPM_MOTOR_MAX_OPERACION = 180.0


def entero(valor, minimo, maximo, nombre):
    if type(valor) is not int or not minimo <= valor <= maximo:
        raise ValueError(f"{nombre}: entero fuera de rango")


def numero(valor, minimo, maximo, nombre, nullable=False):
    if valor is None and nullable:
        return
    if type(valor) not in (int, float) or not math.isfinite(valor) or not minimo <= valor <= maximo:
        raise ValueError(f"{nombre}: numero no valido ({valor!r})")


def validar_captura(p):
    if not isinstance(p, dict):
        raise ValueError("Se esperaba un objeto JSON")
    if type(p.get('schema_version')) is not int or p['schema_version'] != 1:
        raise ValueError('schema_version incompatible')
    if type(p.get('feature_version')) is not int or p['feature_version'] not in (1, 2):
        raise ValueError('feature_version incompatible')
    for k in ("device_id", "boot_id"):
        if not isinstance(p.get(k), str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,64}", p[k]):
            raise ValueError(f"{k} no valido")
    entero(p.get("cycle_id"), 1, 2**32-1, "cycle_id")
    entero(p.get("period_ms"), 100, 100, "period_ms")
    entero(p.get("pretrigger"), 0, 2, "pretrigger")
    if p.get("origen", "automatica") not in ("automatica", "manual"):
        raise ValueError("Origen de captura no valido")
    if p.get("origen") == "manual":
        entero(p.get("orden_manual"), 1, 2**31-1, "orden_manual")
    if "bloque_manual" in p or "bloques_manual" in p:
        if p.get("origen") == "manual":
            entero(p.get("bloques_manual"), 1, 30, "bloques_manual")
            entero(p.get("bloque_manual"), 1, p["bloques_manual"], "bloque_manual")
        else:
            entero(p.get("bloques_manual"), 0, 0, "bloques_manual")
            entero(p.get("bloque_manual"), 0, 0, "bloque_manual")
    if not isinstance(p.get("firmware"), str) or not 1 <= len(p["firmware"]) <= 80:
        raise ValueError("firmware no valido")
    for k in ("metal", "cancelada"):
        if type(p.get(k)) is not bool:
            raise ValueError(f"{k}: se esperaba booleano")
    samples = p.get("samples")
    limite = 100 if p['feature_version'] == 2 else 10
    if not isinstance(samples, list) or not 1 <= len(samples) <= limite:
        raise ValueError(f"samples debe contener entre 1 y {limite} muestras")
    if p['feature_version'] == 2 and (p['pretrigger'] != 0 or p.get('bloque_manual') or p.get('bloques_manual')):
        raise ValueError('Version 2: prueba completa sin pretrigger ni bloques')
    previo = -1
    for s in samples:
        if not isinstance(s, dict):
            raise ValueError("Muestra no valida")
        entero(s.get("t_ms"), 0, 2**53-1, "t_ms")
        if s["t_ms"] <= previo:
            raise ValueError("Tiempos no crecientes")
        previo = s["t_ms"]
        numero(s.get("dist_cm"), 0, 1000, "dist_cm", nullable=True)
        # La lectura cruda puede incluir pulsos espurios. Conservar cualquier
        # valor finito no negativo; su plausibilidad se informa por separado.
        numero(s.get("rpm_motor"), 0, math.inf, "rpm_motor", nullable=True)
        numero(s.get("rpm_ts"), -10000, 10000, "rpm_ts")
        entero(s.get("step_hz"), 0, 100000, "step_hz")
        entero(s.get("servo_us"), 0, 20000, "servo_us")
        entero(s.get("estado"), 0, 4, "estado")
        for k in ("inductivo", "flanco", "empuje"):
            if type(s.get(k)) is not bool:
                raise ValueError(f"{k}: se esperaba booleano")
    return p


def aptitud(payload):
    try:
        extraer(payload)
        return ""
    except ValueError as e:
        return str(e)


class Conflicto(ValueError):
    pass


class Almacen:
    def __init__(self, ruta):
        self.ruta = Path(ruta)
        self.ruta.parent.mkdir(parents=True, exist_ok=True)
        with self.conexion() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS capturas (
                id INTEGER PRIMARY KEY, recibida TEXT NOT NULL,
                device_id TEXT NOT NULL, boot_id TEXT NOT NULL, cycle_id INTEGER NOT NULL,
                payload TEXT NOT NULL, etiqueta TEXT NOT NULL DEFAULT '',
                pieza_id TEXT NOT NULL DEFAULT '', material TEXT NOT NULL DEFAULT '',
                notas TEXT NOT NULL DEFAULT '',
                UNIQUE(device_id, boot_id, cycle_id))""")
            # Solo identificadores: impide que un reintento de la ESP32 restaure un borrado.
            db.execute("""CREATE TABLE IF NOT EXISTS capturas_eliminadas (
                id INTEGER PRIMARY KEY, device_id TEXT NOT NULL, boot_id TEXT NOT NULL,
                cycle_id INTEGER NOT NULL, UNIQUE(device_id, boot_id, cycle_id))""")
            db.execute('''CREATE TABLE IF NOT EXISTS bloques_archivados (
                id INTEGER PRIMARY KEY, device_id TEXT NOT NULL, boot_id TEXT NOT NULL,
                cycle_id INTEGER NOT NULL, captura_id INTEGER NOT NULL, original_json TEXT NOT NULL,
                UNIQUE(device_id,boot_id,cycle_id))''')

    @contextmanager
    def conexion(self):
        db = sqlite3.connect(self.ruta, timeout=5)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def insertar(self, p):
        validar_captura(p)
        texto = json.dumps(p, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
        clave = (p["device_id"], p["boot_id"], p["cycle_id"])
        with self.conexion() as db:
            db.execute("BEGIN IMMEDIATE")
            archivado = db.execute('SELECT captura_id,original_json FROM bloques_archivados WHERE device_id=? AND boot_id=? AND cycle_id=?', clave).fetchone()
            if archivado:
                anterior = json.loads(json.loads(archivado['original_json'])['payload'])
                if any(anterior.get(k) != p.get(k) for k in ('samples','feature_version','orden_manual','bloque_manual','bloques_manual','config','firmware','metal','cancelada','period_ms','pretrigger','origen')):
                    raise Conflicto('Bloque archivado reenviado con contenido distinto')
                return archivado['captura_id'], False
            eliminada = db.execute("SELECT id FROM capturas_eliminadas WHERE device_id=? AND boot_id=? AND cycle_id=?", clave).fetchone()
            if eliminada:
                return eliminada["id"], False
            siguiente = db.execute("SELECT COALESCE(MAX(id),0)+1 FROM (SELECT id FROM capturas UNION ALL SELECT id FROM capturas_eliminadas UNION ALL SELECT id FROM bloques_archivados)").fetchone()[0]
            cur = db.execute("INSERT OR IGNORE INTO capturas (id,recibida,device_id,boot_id,cycle_id,payload) VALUES (?,?,?,?,?,?)",
                             (siguiente, dt.datetime.now(dt.timezone.utc).isoformat(), *clave, texto))
            row = db.execute("SELECT id,payload FROM capturas WHERE device_id=? AND boot_id=? AND cycle_id=?", clave).fetchone()
            # Metricas de heap/descartes pueden cambiar en un reintento; muestras y config no.
            anterior = json.loads(row["payload"])
            campos = ("samples", "metal", "cancelada", "feature_version", "firmware", "config", "pretrigger", "period_ms", "origen", "orden_manual", "bloque_manual", "bloques_manual")
            if any(anterior.get(k) != p.get(k) for k in campos):
                raise Conflicto("Identificador repetido con otra captura")
            identificador = row['id']
            if p['feature_version'] == 1 and p.get('bloques_manual') == 10:
                identificador = unir_en_db(db,p['device_id'],p['boot_id'],p['orden_manual']) or identificador
            return identificador, cur.rowcount == 1

    @staticmethod
    def registro(row):
        r = dict(row)
        r["payload"] = json.loads(r["payload"])
        r["no_apta"] = aptitud(r["payload"])
        fuera_rango = [s['rpm_motor'] for s in r['payload']['samples']
                       if s.get('rpm_motor') is not None and s['rpm_motor'] > RPM_MOTOR_MAX_OPERACION]
        r['advertencias'] = []
        if fuera_rango:
            r['advertencias'].append(
                f"Encoder: {len(fuera_rango)} lecturas superan {RPM_MOTOR_MAX_OPERACION:g} RPM "
                f"(máxima {max(fuera_rango):.1f}). Se conservan como diagnóstico; "
                "no confirman la velocidad física ni determinan la etiqueta de los otros sensores.")
        return r

    def listar(self, limite=100, offset=0):
        with self.conexion() as db:
            return [self.registro(r) for r in db.execute("SELECT * FROM capturas ORDER BY id DESC LIMIT ? OFFSET ?", (limite, offset))]

    def obtener(self, identificador):
        with self.conexion() as db:
            row = db.execute("SELECT * FROM capturas WHERE id=?", (identificador,)).fetchone()
            return self.registro(row) if row else None

    def listar_ensayo(self, dispositivo, arranque, orden):
        for valor in (dispositivo, arranque):
            if not isinstance(valor, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,64}", valor):
                raise ValueError("Identificador de ensayo invalido")
        entero(orden, 1, 2**31-1, "orden_manual")
        with self.conexion() as db:
            return [self.registro(r) for r in db.execute(
                "SELECT * FROM capturas WHERE device_id=? AND boot_id=? "
                "AND json_extract(payload,'$.origen')='manual' AND json_extract(payload,'$.orden_manual')=? "
                "ORDER BY cycle_id LIMIT 30", (dispositivo, arranque, orden))]

    def eliminar(self, identificador):
        entero(identificador, 1, 2**63-1, "id")
        with self.conexion() as db:
            db.execute("BEGIN IMMEDIATE")
            r = db.execute("INSERT OR IGNORE INTO capturas_eliminadas (id,device_id,boot_id,cycle_id) SELECT id,device_id,boot_id,cycle_id FROM capturas WHERE id=?", (identificador,))
            if not r.rowcount:
                raise KeyError(identificador)
            db.execute("DELETE FROM capturas WHERE id=?", (identificador,))

    def etiquetar(self, identificador, p):
        if not isinstance(p, dict):
            raise ValueError("Etiqueta no valida")
        for k, limite in (("etiqueta", 40), ("pieza_id", 80), ("material", 20), ("notas", 1000)):
            if not isinstance(p.get(k, ""), str) or len(p.get(k, "")) > limite:
                raise ValueError(f"{k} no valido")
        etiqueta = p.get("etiqueta", "").strip()
        pieza = p.get("pieza_id", "").strip()
        material = p.get("material", "").strip()
        if etiqueta not in (*CLASES, "descartar", ""):
            raise ValueError("Clase desconocida")
        if etiqueta in CLASES and (not pieza or material not in ("metalico", "no_metalico")):
            raise ValueError("Indicar pieza fisica y material observado antes de etiquetar")
        if material not in ("", "metalico", "no_metalico"):
            raise ValueError("Material desconocido")
        with self.conexion() as db:
            r = db.execute("UPDATE capturas SET etiqueta=?,pieza_id=?,material=?,notas=? WHERE id=?",
                           (etiqueta, pieza, material, p.get("notas", ""), identificador))
            if not r.rowcount:
                raise KeyError(identificador)

    def resumen(self):
        with self.conexion() as db:
            total = db.execute("SELECT COUNT(*) FROM capturas").fetchone()[0]
            clases = dict(db.execute("SELECT etiqueta,COUNT(*) FROM capturas GROUP BY etiqueta"))
            ultima = db.execute("SELECT recibida FROM capturas ORDER BY id DESC LIMIT 1").fetchone()
        return {"total": total, "clases": clases, "ultima": ultima[0] if ultima else None}

    def exportar(self):
        # Cursor incremental, no cargar toda la base en RAM para exportar.
        with self.conexion() as db:
            for row in db.execute("SELECT * FROM capturas ORDER BY id"):
                yield self.registro(row)

