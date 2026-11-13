"""Control de ensayos por placa y arranque; las ordenes no sobreviven al servidor."""
import re
import threading
import time
from datos import Conflicto, entero

MAX_PREPARACION_MS = 60000


class Ensayos:
    def __init__(self, reloj=time.monotonic):
        self.reloj = reloj
        self.lock = threading.Lock()
        self.placas = {}

    def sondeo(self, p):
        for k in ("device_id", "boot_id"):
            if not isinstance(p.get(k), str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,64}", p[k]):
                raise ValueError(f"{k} no valido")
        for k in ("manual", "lista", "ocupada"):
            if type(p.get(k)) is not bool:
                raise ValueError(f"{k} debe ser booleano")
        entero(p.get("orden"), 0, 2**31-1, "orden")
        entero(p.get("restante_ms"), 0, MAX_PREPARACION_MS, "restante_ms")
        entero(p.get("registro_total_ms", 0), 0, 30000, "registro_total_ms")
        entero(p.get('feature_version', 1), 1, 2, 'feature_version')
        entero(p.get("registro_restante_ms", 0), 0, p.get("registro_total_ms", 0), "registro_restante_ms")
        with self.lock:
            d = self.placas.get(p["device_id"])
            if not d or d["boot_id"] != p["boot_id"]:
                d = {"deseado": p["manual"], "secuencia": p["orden"], "vence": 0}
                self.placas[p["device_id"]] = d
            d.update({k: p[k] for k in ("device_id", "boot_id", "manual", "lista", "ocupada", "orden", "restante_ms")})
            d.update({k: p.get(k, 0) for k in ("registro_total_ms", "registro_restante_ms")})
            d['feature_version'] = p.get('feature_version', 1)
            d["visto"] = self.reloj()
            d["secuencia"] = max(d["secuencia"], p["orden"])
            orden = d["secuencia"] if d["deseado"] and self.reloj() < d["vence"] else p["orden"]
            return f"{int(d['deseado'])} {orden}\n"

    def listar(self):
        with self.lock:
            return [{**d, "conectada": self.reloj()-d["visto"] < 5,
                     "pendiente": d["secuencia"] > d["orden"] and self.reloj() < d["vence"]}
                    for d in self.placas.values()]

    def ordenar(self, p):
        with self.lock:
            d = self.placas.get(p.get("device_id"))
            if not d or d["boot_id"] != p.get("boot_id") or self.reloj()-d["visto"] >= 5:
                raise Conflicto("ESP32 sin conexion reciente; esperar a que aparezca conectada")
            accion = p.get("accion")
            if accion == "manual":
                d["deseado"] = True
            elif accion == "automatico":
                if d["ocupada"]:
                    raise Conflicto("Esperar a que termine la captura antes de volver al automatico")
                d["deseado"] = False
                d["vence"] = 0
            elif accion == "capturar":
                if not d["deseado"] or not d["manual"] or not d["lista"] or d["ocupada"]:
                    raise Conflicto("Activar modo manual y esperar: cinta detenida y lista")
                if d["secuencia"] > d["orden"] and self.reloj() < d["vence"]:
                    raise Conflicto("Ya hay una captura solicitada")
                if d["secuencia"] >= 2**31-1:
                    raise Conflicto("Limite de ordenes alcanzado; reiniciar la ESP32")
                d["secuencia"] += 1
                d["vence"] = self.reloj()+5
            else:
                raise ValueError("Accion desconocida")
            return {"ok": True, "orden": d["secuencia"]}
