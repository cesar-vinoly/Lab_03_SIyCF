"""Pruebas con capturas sinteticas aisladas; no son datos de entrenamiento del laboratorio."""
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from datos import Almacen, Conflicto, validar_captura
from features import CLASES, extraer
from servidor import crear_handler

BASE = Path(__file__).resolve().parent


def captura(ciclo=1, clase=0, repeticion=0):
    samples = []
    for i in range(100):
        activo = (i < 6) if clase == 0 else (i % 2 == 0) if clase == 1 else False
        distancia = 9.0 + i * 0.7 + repeticion * 0.01
        if clase == 2 and i % 2:
            distancia = 85.0 + repeticion * 0.01
        samples.append({"t_ms": 10000 + i*100, "dist_cm": distancia, "inductivo": activo,
                        "flanco": (clase == 1 and i % 2 == 0) or (clase == 0 and i == 0),
                        "step_hz": 1000 if i > 5 else 0, "rpm_motor": None,
                        "rpm_ts": 0.0, "servo_us": 1500, "estado": 3 if i > 5 else 1,
                        "empuje": False})
    return {"schema_version": 1, "feature_version": 2, "device_id": "sintetico",
            "boot_id": "solo-pruebas", "cycle_id": ciclo, "period_ms": 100, "pretrigger": 0,
            "firmware": "test-no-usar-en-laboratorio", "metal": clase < 2, "cancelada": False,
            "samples": samples}


class DatosTests(unittest.TestCase):
    def setUp(self):
        (BASE / ".pruebas").mkdir(exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=BASE / ".pruebas")
        self.addCleanup(self.tmp.cleanup)
        self.db = Almacen(Path(self.tmp.name) / "test.sqlite3")

    def test_reintentos_no_duplican_ni_borran_etiquetas(self):
        p = captura()
        uid, nueva = self.db.insertar(p)
        self.assertTrue(nueva)
        self.db.etiquetar(uid, {"etiqueta": "senal_normal", "pieza_id": "lata1", "material": "metalico"})
        p["heap_free"] = 100000
        self.assertEqual(self.db.insertar(p), (uid, False))
        self.assertEqual(self.db.resumen()["total"], 1)
        self.assertEqual(self.db.obtener(uid)["etiqueta"], "senal_normal")
        p["samples"][0]["dist_cm"] = 99.0
        with self.assertRaises(Conflicto):
            self.db.insertar(p)

    def test_reinicio_esp32_crea_otro_objeto(self):
        p = captura()
        self.db.insertar(p)
        p["boot_id"] = "otro-arranque"
        self.assertTrue(self.db.insertar(p)[1])
        self.assertEqual(self.db.resumen()["total"], 2)

    def test_eliminar_solo_elegida_sin_reaparicion_ni_reutilizar_id(self):
        conservada, _ = self.db.insertar(captura(1))
        eliminada, _ = self.db.insertar(captura(2))
        self.db.etiquetar(eliminada, {"etiqueta": "senal_normal", "pieza_id": "lata2", "material": "metalico"})
        self.db.eliminar(eliminada)
        self.assertIsNone(self.db.obtener(eliminada))
        self.assertEqual([r["id"] for r in self.db.listar()], [conservada])
        self.assertEqual([r["id"] for r in self.db.exportar()], [conservada])
        self.assertEqual(self.db.resumen()["clases"], {"": 1})
        with self.assertRaises(KeyError): self.db.eliminar(eliminada)
        # Abrir otra conexion como despues de reiniciar el servidor.
        self.db = Almacen(self.db.ruta)
        self.assertEqual(self.db.insertar(captura(2)), (eliminada, False))
        self.assertIsNone(self.db.obtener(eliminada))
        nueva, _ = self.db.insertar(captura(3))
        self.assertGreater(nueva, eliminada)
        self.assertEqual(self.db.resumen()["total"], 2)

    def test_features_mismos_400_valores_y_sin_etiqueta_incorporada(self):
        p = captura()
        p["samples"][0]["dist_cm"] = None
        x = extraer(p)
        self.assertEqual(len(x), 400)
        self.assertEqual(x[:4], [1.0, 1.0, 0.0, 0.0])
        p["metal"] = not p["metal"]
        self.assertEqual(x, extraer(p))

    def test_incompletas_y_saltos_se_guardan_pero_no_entrenan(self):
        for modo in ("incompleta", "cancelada", "salto"):
            p = captura()
            if modo == "incompleta": p["samples"].pop()
            if modo == "cancelada": p["cancelada"] = True
            if modo == "salto": p["samples"][-1]["t_ms"] += 100
            validar_captura(p)
            with self.assertRaises(ValueError): extraer(p)

    def test_ventana_100_rechaza_pretrigger_y_bloques(self):
        for cambios in ({'pretrigger': 1}, {'origen': 'manual', 'orden_manual': 1,
                         'bloque_manual': 1, 'bloques_manual': 10}):
            p = captura()
            p.update(cambios)
            with self.assertRaises(ValueError): validar_captura(p)

    def test_rechaza_muestras_malformadas(self):
        for key, value in (("dist_cm", float("nan")), ("inductivo", 1), ("t_ms", -1), ("estado", 5)):
            p = captura()
            p["samples"][0][key] = value
            with self.assertRaises(ValueError): validar_captura(p)
        p = captura()
        p["samples"] *= 2
        with self.assertRaises(ValueError): validar_captura(p)

    def test_etiquetado_requiere_pieza_y_material(self):
        uid, _ = self.db.insertar(captura())
        with self.assertRaises(ValueError): self.db.etiquetar(uid, {"etiqueta": "senal_normal"})
        with self.assertRaises(ValueError): self.db.etiquetar(uid, {"etiqueta": "inventada"})
        self.db.etiquetar(uid, {"etiqueta": "descartar", "notas": "Ensayo interrumpido"})

    def test_no_metalico_sin_inductivo_puede_ser_normal(self):
        p = captura()
        p["metal"] = False
        for s in p["samples"]:
            s["inductivo"] = s["flanco"] = False
        uid, _ = self.db.insertar(p)
        self.db.etiquetar(uid, {"etiqueta": "senal_normal", "pieza_id": "plastico1", "material": "no_metalico"})
        self.assertEqual(self.db.obtener(uid)["etiqueta"], "senal_normal")
        with self.assertRaises(ValueError):
            self.db.etiquetar(uid, {"etiqueta": "sin_contacto", "pieza_id": "plastico1", "material": "no_metalico"})


class HttpTests(unittest.TestCase):
    def setUp(self):
        DatosTests.setUp(self)
        handler = crear_handler(self.db)
        handler.log_message = lambda *args: None
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        self.addCleanup(self.cerrar)

    def cerrar(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, path, body=None, origin=None, method=None):
        headers = {}
        if origin: headers["Origin"] = origin
        if body is not None:
            headers["Content-Type"] = "application/json"
            body = json.dumps(body).encode()
        req = urllib.request.Request(self.url + path, body, headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as r:
            with r:
                return r.code, r.read()

    def test_http_recepcion_etiquetado_exportacion(self):
        status, body = self.request("/api/capturas", captura())
        self.assertEqual(status, 201)
        uid = json.loads(body)["id"]
        self.assertEqual(self.request("/api/capturas", captura())[0], 200)
        self.assertEqual(self.request(f"/api/capturas/{uid}/etiqueta", {"etiqueta": "senal_normal", "pieza_id": "lata1", "material": "metalico"})[0], 200)
        status, body = self.request("/api/exportar.jsonl")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["pieza_id"], "lata1")
        status, body = self.request("/api/exportar.csv")
        self.assertEqual(status, 200)
        self.assertIn(b"inductivo_0", body)
        self.assertEqual(self.request("/")[0], 200)

    def test_http_origen_y_json_invalido(self):
        self.assertEqual(self.request("/api/capturas", captura(), origin="http://otro-sitio")[0], 403)
        p = captura()
        p["samples"][0]["dist_cm"] = float("nan")
        self.assertEqual(self.request("/api/capturas", p)[0], 400)
        self.assertEqual(self.request("/api/capturas/900")[0], 404)

    def test_rechazo_conserva_envio_y_motivo_fuera_del_dataset(self):
        p = captura()
        p['samples'][25]['rpm_motor'] = -1
        status, body = self.request('/api/capturas', p)
        self.assertEqual(status, 400)
        self.assertIn('rpm_motor', json.loads(body)['error'])
        rechazadas = list((self.db.ruta.parent / 'rechazadas').glob('*.json'))
        self.assertEqual(len(rechazadas), 1)
        guardado = json.loads(rechazadas[0].read_text(encoding='utf-8'))
        self.assertEqual(json.loads(guardado['cuerpo']), p)
        self.assertEqual(guardado['motivo'], json.loads(body)['error'])
        self.assertEqual(self.db.resumen()['total'], 0)

    def test_automatico_guarda_picos_encoder_sin_perder_sensores_ni_cambiar_features(self):
        p = captura()
        p.update(firmware='cinta-ia-3', origen='automatica', orden_manual=0)
        features_antes = extraer(p)
        # Valor recibido en la pasada real que antes producia HTTP 400.
        p['samples'][26]['rpm_motor'] = 12481.7969
        p['samples'][27]['rpm_motor'] = 12581.2549
        status, body = self.request('/api/capturas', p)
        self.assertEqual(status, 201)
        uid = json.loads(body)['id']
        guardada = json.loads(self.request(f'/api/capturas/{uid}')[1])
        self.assertEqual(guardada['payload'], p)
        self.assertEqual(guardada['no_apta'], '')
        self.assertEqual(guardada['etiqueta'], '')
        self.assertIn('2 lecturas', guardada['advertencias'][0])
        self.assertIn('12581.3', guardada['advertencias'][0])
        self.assertEqual(extraer(guardada['payload']), features_antes)
        self.assertEqual(self.request('/api/capturas', p)[0], 200)
        self.assertEqual(self.db.resumen()['total'], 1)
        exportada = json.loads(self.request('/api/exportar.jsonl')[1])
        self.assertEqual(exportada['payload'], p)
        self.assertEqual(exportada['advertencias'], guardada['advertencias'])

    def test_http_ensayo_y_captura_manual_sin_eco(self):
        status, salud = self.request('/health')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(salud)['ensayo_max_preparacion_ms'], 60000)
        self.assertEqual(json.loads(salud)['feature_version'], 2)
        self.assertEqual(json.loads(salud)['muestras_por_prueba'], 100)
        p = dict(device_id="placa1", boot_id="boot1", manual=False, lista=False,
                 ocupada=False, restante_ms=0, orden=0)
        self.assertEqual(self.request("/api/ensayos/sondeo", p), (200, b"0 0\n"))
        accion = dict(device_id="placa1", boot_id="boot1", accion="manual")
        self.assertEqual(self.request("/api/ensayos", accion, origin="http://ajeno")[0], 403)
        self.assertEqual(self.request("/api/ensayos", accion)[0], 200)
        self.assertEqual(self.request("/api/ensayos/sondeo", p), (200, b"1 0\n"))
        p.update(manual=True, lista=True)
        self.request("/api/ensayos/sondeo", p)
        accion["accion"] = "capturar"
        self.assertEqual(self.request("/api/ensayos", accion)[0], 200)
        self.assertEqual(self.request("/api/ensayos/sondeo", p), (200, b"1 1\n"))
        p.update(orden=1, ocupada=True, lista=False, restante_ms=10000)
        self.assertEqual(self.request("/api/ensayos/sondeo", p), (200, b"1 1\n"))
        estado = json.loads(self.request('/api/ensayos')[1])[0]
        self.assertTrue(estado['conectada'])
        self.assertEqual(estado['restante_ms'], 10000)
        c = captura()
        c.update(origen="manual", orden_manual=1)
        for s in c["samples"]: s["dist_cm"] = None
        codigo, body = self.request("/api/capturas", c)
        self.assertEqual(codigo, 201)
        r = self.db.obtener(json.loads(body)["id"])
        self.assertEqual(r["no_apta"], "")
        self.assertEqual(r["payload"]["origen"], "manual")
        status, prueba = self.request('/api/ensayos/capturas?device_id=sintetico&boot_id=solo-pruebas&orden_manual=1')
        self.assertEqual(status, 200)
        filas = json.loads(prueba)
        self.assertEqual(len(filas), 1)
        self.assertEqual(len(filas[0]['payload']['samples']), 100)
        uid = filas[0]['id']
        etiqueta = {'etiqueta': 'senal_intermitente', 'pieza_id': 'M01', 'material': 'metalico'}
        self.assertEqual(self.request(f'/api/capturas/{uid}/etiqueta', etiqueta)[0], 200)
        exportada = json.loads(self.request('/api/exportar.jsonl')[1])
        self.assertEqual(exportada['etiqueta'], 'senal_intermitente')
        self.assertEqual(len(extraer(exportada['payload'])), 400)
        self.assertEqual(self.request('/api/ensayos/capturas')[0], 400)

    def test_http_eliminar_concreta_y_confirmar_reintento(self):
        _, body = self.request("/api/capturas", captura())
        uid = json.loads(body)["id"]
        ruta = f"/api/capturas/{uid}"
        self.assertEqual(self.request(ruta, origin="http://otro-sitio", method="DELETE")[0], 403)
        self.assertEqual(self.request("/api/capturas", method="DELETE")[0], 404)
        self.assertEqual(self.request(ruta)[0], 200)
        status, body = self.request(ruta, origin=self.url, method="DELETE")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"ok": True, "id": uid})
        self.assertEqual(self.request(ruta)[0], 404)
        self.assertEqual(self.request(ruta, method="DELETE")[0], 404)
        status, body = self.request("/api/capturas", captura())
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"id": uid, "nueva": False})
        self.assertEqual(self.request("/api/exportar.jsonl")[1], b"")


@unittest.skipUnless(importlib.util.find_spec("sklearn") and importlib.util.find_spec("micromlgen"), "Instalar requirements-entrenamiento.txt")
class EntrenamientoTests(unittest.TestCase):
    def test_pipeline_exportacion_y_separacion_por_pieza(self):
        from entrenar import entrenar
        registros = []
        for clase in range(len(CLASES)):
            for pieza in range(8):
                for repeticion in range(2):
                    registros.append({"payload": captura(len(registros)+1, clase, repeticion),
                                      "etiqueta": CLASES[clase], "pieza_id": f"pieza-{clase}-{pieza}", "material": "metalico"})
        (BASE / ".pruebas").mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=BASE / ".pruebas") as carpeta:
            r = entrenar(registros, carpeta)
            self.assertFalse(set(r["piezas_train"]) & set(r["piezas_test"]))
            self.assertTrue((Path(carpeta) / "modelo_calidad.h").is_file())
            self.assertEqual(len(r["matriz_confusion_filas_reales_columnas_predichas"]), 3)
            self.assertEqual(r["ram_votos_bytes"], 12)
            self.assertEqual(r["ram_features_bytes"], 1600)
            self.assertIsNone(r["por_material"]["no_metalico"]["tasa_falsas_alarmas_sobre_normales"])
            header = (Path(carpeta) / "modelo_calidad.h").read_text(encoding="utf-8")
            self.assertIn("#define TINY_N_CLASSES 3", header)
            self.assertIn("#define TINY_CLASS_VERSION 2", header)
            self.assertIn("#define TINY_FEATURE_VERSION 2", header)
            self.assertIn("#define TINY_N_FEATURES 400", header)
            self.assertIsNone(r["ram_total_mcu_bytes"])
            self.assertGreater(r["tamano_header_bytes"], 0)

    def test_no_inventa_modelo_sin_datos(self):
        from entrenar import entrenar
        with self.assertRaises(ValueError): entrenar([], BASE / ".pruebas" / "no_debe_crearse")

    def test_no_mezclar_origen_manual_y_automatico(self):
        from entrenar import preparar
        a, b = captura(1), captura(2, repeticion=1)
        b.update(origen="manual", orden_manual=1)
        registros = [{"payload": p, "etiqueta": "senal_normal", "pieza_id": f"pieza{i}", "material": "metalico"}
                     for i, p in enumerate((a, b))]
        with self.assertRaisesRegex(ValueError, "manual/automatico"):
            preparar(registros)

    def test_firmas_iguales_con_etiquetas_distintas_se_rechazan(self):
        from entrenar import preparar
        registros = [{"payload": captura(i+1), "etiqueta": CLASES[i], "pieza_id": f"pieza{i}", "material": "metalico"}
                     for i in range(2)]
        with self.assertRaisesRegex(ValueError, "firmas identicas"):
            preparar(registros)

    def test_etiquetas_antiguas_excluidas_sin_conversion_automatica(self):
        from entrenar import preparar
        registros = [{"payload": captura(), "etiqueta": "sin_contacto", "pieza_id": "lata1", "material": "metalico"}]
        x, _, _, _, _, excluidas = preparar(registros)
        self.assertEqual(x, [])
        self.assertEqual(excluidas["etiqueta_antigua_o_desconocida_revisar"], 1)


if __name__ == "__main__":
    unittest.main()

