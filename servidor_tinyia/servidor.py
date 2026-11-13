"""Receptor HTTP para la red privada del laboratorio. Solo biblioteca estandar."""
import argparse
import csv
import datetime as dt
import io
import json
import re
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from datos import Almacen, Conflicto
from features import FEATURE_NAMES, extraer
from ensayos import Ensayos, MAX_PREPARACION_MS
from sesiones import migrar_con_respaldo

BASE = Path(__file__).resolve().parent
MAX_BODY = 65536


def rechazar_constante(valor):
    raise ValueError(f"JSON no permite {valor}; usar null para ausencia de eco")


def crear_handler(almacen):
    ensayos = Ensayos()
    class Handler(BaseHTTPRequestHandler):
        server_version = "CintaTinyIA/1"

        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def enviar(self, codigo, body, tipo="application/json; charset=utf-8", archivo=None):
            if isinstance(body, (dict, list)):
                body = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
            elif isinstance(body, str):
                body = body.encode("utf-8")
            self.send_response(codigo)
            self.send_header("Content-Type", tipo)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if archivo:
                self.send_header("Content-Disposition", f'attachment; filename="{archivo}"')
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            ruta = urlsplit(self.path)
            if ruta.path == "/":
                self.enviar(200, (BASE / "panel.html").read_bytes(), "text/html; charset=utf-8")
                return
            if ruta.path == "/health":
                self.enviar(200, {"ok": True, "schema_version": 1, "eliminar_capturas": True,
                                  "ensayo_max_preparacion_ms": MAX_PREPARACION_MS, "ensayo_bloques_version": 1,
                                  "feature_version": 2, "muestras_por_prueba": 100})
                return
            try:
                if ruta.path == "/api/ensayos/capturas":
                    q = parse_qs(ruta.query)
                    self.enviar(200, almacen.listar_ensayo(q.get("device_id", [""])[0],
                        q.get("boot_id", [""])[0], int(q.get("orden_manual", ["0"])[0])))
                elif ruta.path == "/api/ensayos":
                    self.enviar(200, ensayos.listar())
                elif ruta.path == "/api/resumen":
                    self.enviar(200, almacen.resumen())
                elif ruta.path == "/api/capturas":
                    q = parse_qs(ruta.query)
                    limite = min(200, max(1, int(q.get("limit", [100])[0])))
                    offset = max(0, int(q.get("offset", [0])[0]))
                    self.enviar(200, almacen.listar(limite, offset))
                elif re.fullmatch(r"/api/capturas/\d+", ruta.path):
                    registro = almacen.obtener(int(ruta.path.rsplit("/", 1)[-1]))
                    self.enviar(200 if registro else 404, registro or {"error": "Captura inexistente"})
                elif ruta.path in ("/api/exportar.jsonl", "/api/exportar.csv"):
                    self.exportar(ruta.path.endswith("csv"))
                else:
                    self.enviar(404, {"error": "Ruta inexistente"})
            except ValueError as e:
                self.enviar(400, {"error": str(e)})

        def do_POST(self):
            # Las escrituras del panel son del mismo origen; la ESP32 no envia Origin.
            origen = self.headers.get("Origin")
            if origen and urlsplit(origen).netloc != self.headers.get("Host"):
                self.enviar(403, {"error": "Origen no permitido"})
                return
            contenido = b""
            ruta = urlsplit(self.path).path
            try:
                if self.headers.get_content_type() != "application/json":
                    self.enviar(415, {"error": "Usar Content-Type: application/json"})
                    return
                n = int(self.headers.get("Content-Length", "0"))
                if not 0 < n <= MAX_BODY:
                    self.enviar(413, {"error": "Cuerpo vacio o mayor de 64 KiB"})
                    return
                contenido = self.rfile.read(n)
                p = json.loads(contenido.decode("utf-8"), parse_constant=rechazar_constante)
                if not isinstance(p, dict):
                    raise ValueError("Se esperaba un objeto JSON")
                ruta = urlsplit(self.path).path
                if ruta == "/api/ensayos/sondeo":
                    self.enviar(200, ensayos.sondeo(p), "text/plain; charset=utf-8")
                elif ruta == "/api/ensayos":
                    self.enviar(200, ensayos.ordenar(p))
                elif ruta == "/api/capturas":
                    identificador, nueva = almacen.insertar(p)
                    self.enviar(201 if nueva else 200, {"id": identificador, "nueva": nueva})
                elif re.fullmatch(r"/api/capturas/\d+/etiqueta", ruta):
                    identificador = int(ruta.split("/")[3])
                    almacen.etiquetar(identificador, p)
                    self.enviar(200, {"ok": True})
                else:
                    self.enviar(404, {"error": "Ruta inexistente"})
            except Conflicto as e:
                self.enviar(409, {"error": str(e)})
            except KeyError:
                self.enviar(404, {"error": "Captura inexistente"})
            except (ValueError, TypeError, UnicodeDecodeError) as e:
                if ruta == "/api/capturas":
                    # Conservar el envio rechazado para diagnosticarlo y recuperarlo;
                    # no incorporarlo a entrenamiento sin validar su contenido.
                    self.log_error("Captura rechazada: %s", str(e))
                    if contenido:
                        try:
                            carpeta = almacen.ruta.parent / "rechazadas"
                            carpeta.mkdir(exist_ok=True)
                            ruta_rechazo = carpeta / (uuid.uuid4().hex + ".json")
                            ruta_rechazo.write_text(json.dumps({
                                "recibida": dt.datetime.now(dt.timezone.utc).isoformat(),
                                "motivo": str(e), "cuerpo": contenido.decode("utf-8", errors="replace")
                            }, ensure_ascii=False), encoding="utf-8")
                            self.log_error("Envio original conservado en %s", ruta_rechazo)
                        except OSError as archivo_error:
                            self.log_error("No se pudo conservar el rechazo: %s", str(archivo_error))
                self.enviar(400, {"error": str(e)})

        def do_DELETE(self):
            origen = self.headers.get("Origin")
            if origen and urlsplit(origen).netloc != self.headers.get("Host"):
                self.enviar(403, {"error": "Origen no permitido"})
                return
            ruta = urlsplit(self.path).path
            if not re.fullmatch(r"/api/capturas/\d+", ruta):
                self.enviar(404, {"error": "Elegir una captura concreta para eliminar"})
                return
            try:
                identificador = int(ruta.rsplit("/", 1)[-1])
                almacen.eliminar(identificador)
                self.enviar(200, {"ok": True, "id": identificador})
            except KeyError:
                self.enviar(404, {"error": "Captura inexistente o ya eliminada"})
            except ValueError as e:
                self.enviar(400, {"error": str(e)})

        def exportar(self, como_csv):
            # HTTP/1.0 cierra al terminar: permite descargar por streaming sin Content-Length.
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8" if como_csv else "application/x-ndjson; charset=utf-8")
            nombre = "capturas.csv" if como_csv else "capturas.jsonl"
            self.send_header("Content-Disposition", f'attachment; filename="{nombre}"')
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            buffer = io.StringIO()
            writer = csv.writer(buffer)
            if como_csv:
                writer.writerow(["id", "device_id", "boot_id", "cycle_id", "recibida", "etiqueta",
                                 "pieza_id", "material", "no_apta", *FEATURE_NAMES])
                self.wfile.write(buffer.getvalue().encode("utf-8-sig"))
            for r in almacen.exportar():
                if como_csv:
                    buffer.seek(0)
                    buffer.truncate()
                    try:
                        x = extraer(r["payload"])
                    except ValueError:
                        x = [""] * len(FEATURE_NAMES)
                    fila = [r[k] for k in ("id", "device_id", "boot_id", "cycle_id", "recibida",
                                          "etiqueta", "pieza_id", "material", "no_apta")]
                    # Evitar interpretar identificadores ingresados por el operador como formulas.
                    fila = ["'" + v if isinstance(v, str) and v.startswith(("=", "+", "-", "@")) else v for v in fila]
                    writer.writerow([*fila, *x])
                    self.wfile.write(buffer.getvalue().encode("utf-8"))
                else:
                    self.wfile.write((json.dumps(r, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8"))

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--db", type=Path, default=BASE / "datos" / "capturas.sqlite3")
    args = parser.parse_args()
    almacen = Almacen(args.db)
    migracion = migrar_con_respaldo(almacen)
    print(f"Ventana 100 muestras: {migracion['unidas']} pruebas reunidas; respaldo={migracion['respaldo']}", flush=True)
    server = ThreadingHTTPServer((args.host, args.port), crear_handler(almacen))
    print(f"Panel: http://127.0.0.1:{args.port} | Base: {args.db.resolve()}", flush=True)
    print(f"ESP32: http://IP_DE_ESTA_PC:{args.port}/api/capturas", flush=True)
    print(f"Ensayos manuales: preparacion admitida hasta {MAX_PREPARACION_MS // 1000} s; cuenta definida por la ESP32", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

