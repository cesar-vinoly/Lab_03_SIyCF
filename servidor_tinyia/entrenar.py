"""Entrenar supervisor Random Forest, evaluar por piezas y exportar C++ con micromlgen."""
import argparse
from collections import Counter
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import re
from datos import Almacen, validar_captura
from features import CLASES, ETIQUETAS_VERSION, FEATURE_NAMES, VERSION, extraer, f32

BASE = Path(__file__).resolve().parent


def clave_lote(p):
    # Solo esta conversion de bloques antiguos fue auditada como equivalente.
    firmware = p['firmware']
    if firmware in ('cinta-ia-3', 'union-bloques/cinta-ia-2'):
        firmware = 'ventana100-v2'
    return json.dumps([firmware, p.get('config'), p.get('origen', 'automatica')], sort_keys=True)


def filtrar_origen(registros, origen):
    return [r for r in registros if origen is None or r['payload'].get('origen', 'automatica') == origen]


def mostrar_lotes(registros, piezas_fijas=False):
    """Diagnostico previo, sin entrenar, relabelar ni modificar registros."""
    lotes = {}
    for r in registros:
        p = r['payload']
        lote = lotes.setdefault(clave_lote(p), {'total': 0, 'excluidas': 0,
            'clases': {c: {'n': 0, 'piezas': set(), 'por_pieza': Counter()} for c in CLASES}, 'vistos': set()})
        lote['total'] += 1
        try:
            validar_captura(p)
            extraer(p)
        except (ValueError, KeyError, TypeError):
            lote['excluidas'] += 1
            continue
        etiqueta = r.get('etiqueta')
        identidad = (p['device_id'], p['boot_id'], p['cycle_id'])
        if (etiqueta not in CLASES or not r.get('pieza_id') or
            r.get('material') not in ('metalico', 'no_metalico') or identidad in lote['vistos']):
            lote['excluidas'] += 1
            continue
        lote['vistos'].add(identidad)
        lote['clases'][etiqueta]['n'] += 1
        lote['clases'][etiqueta]['piezas'].add(r['pieza_id'])
        lote['clases'][etiqueta]['por_pieza'][r['pieza_id']] += 1
    if not lotes:
        print('No hay capturas para el origen elegido.')
    for numero, (clave, lote) in enumerate(sorted(lotes.items()), 1):
        firmware, config, origen = json.loads(clave)
        print(f"Lote {numero}: {origen} | {firmware} | {lote['total']} registros")
        print('  Configuracion: ' + json.dumps(config, ensure_ascii=False, sort_keys=True))
        conocidas = set().union(*(d['piezas'] for d in lote['clases'].values()))
        for clase, datos in lote['clases'].items():
            n, g = datos['n'], len(datos['piezas'])
            if piezas_fijas:
                faltas = {p: max(0, 5-datos['por_pieza'][p]) for p in sorted(conocidas)}
                estado = 'faltan al menos '+str(max(0,10-n))+' pruebas en total; por pieza conocida: '+str(faltas)
            else:
                estado = 'minimo cumplido' if n >= 10 and g >= 5 else f'faltan al menos {max(0,10-n)} pruebas y {max(0,5-g)} piezas'
            print(f'  {clase}: {n} pruebas, {g} piezas; {estado}')
        print(f"  Excluidas del recuento: {lote['excluidas']}")
    if piezas_fijas:
        print('Piezas fijas: 10 pruebas por clase y al menos 5 pasadas por cada pieza conocida en cada clase. No se exigen piezas nuevas.')
    else:
        print('Minimos por clase: 10 pruebas y 5 piezas FISICAS distintas. No cambiar IDs para simular piezas nuevas.')
    print('Cumplir los minimos no garantiza una particion valida ni buen desempeno.')


def votos_bosque(modelo, x):
    """Voto mayoritario de los arboles, como el codigo de micromlgen; no predict_proba."""
    import numpy as np
    votos = np.zeros((len(x), len(CLASES)), dtype=int)
    for arbol in modelo.estimators_:
        pred = arbol.predict(x).astype(int)
        votos[np.arange(len(x)), pred] += 1
    return votos.argmax(axis=1), votos.max(axis=1) / len(modelo.estimators_)


def exportar_modelo(modelo, umbral):
    from micromlgen import port
    partes = ["#pragma once", "// Generado por entrenar.py. No editar las features por separado.",
              f"#define TINY_FEATURE_VERSION {VERSION}", f"#define TINY_N_FEATURES {len(FEATURE_NAMES)}",
              f"#define TINY_CLASS_VERSION {ETIQUETAS_VERSION}", f"#define TINY_N_CLASSES {len(CLASES)}",
              f"#define TINY_UMBRAL_VOTO {umbral:.9f}f", f"#define TINY_N_ARBOLES {len(modelo.estimators_)}"]
    # Exportar cada arbol permite exponer el acuerdo entre votos, ademas de la clase.
    for i, arbol in enumerate(modelo.estimators_):
        partes.append(port(arbol, classname=f"ArbolCalidad{i}"))
    partes.extend(["class ModeloCalidad {", "public:", "int predict(float *x, float *acuerdo) {", "unsigned votos[TINY_N_CLASSES] = {0};"])
    for i in range(len(modelo.estimators_)):
        partes.append(f"Eloquent::ML::Port::ArbolCalidad{i} a{i}; ++votos[a{i}.predict(x)];")
    partes.extend(["int mejor = 0;", "for (int i=1; i<TINY_N_CLASSES; ++i) if (votos[i] > votos[mejor]) mejor=i;",
                   "*acuerdo = (float)votos[mejor] / TINY_N_ARBOLES;", "return mejor;", "}", "};", ""])
    return "\n".join(partes)


def verificar_exportacion(texto, modelo, x):
    """Interpretar los if/return exportados; verifica valores y orden sin compilar C++."""
    import numpy as np
    from micromlgen import port
    for i, arbol in enumerate(modelo.estimators_):
        fuente = port(arbol, classname=f"ArbolCalidad{i}")
        cuerpo = fuente.split("int predict(float *x) {", 1)[1].split("protected:", 1)[0]
        tokens = re.findall(r"if\s*\(x\[(\d+)\]\s*<=\s*([-+\d.eE]+)\)|\b(return)\s+(\d+)\s*;|\b(else)\b|([{}])", cuerpo)
        def parsear(pos):
            while pos < len(tokens) and tokens[pos][5] == "{":
                pos += 1
            t = tokens[pos]
            if t[2]:
                return ("leaf", int(t[3])), pos + 1
            if not t[0]:
                raise ValueError("Exportacion micromlgen inesperada")
            izquierda, pos = parsear(pos + 1)
            while pos < len(tokens) and tokens[pos][5] == "}":
                pos += 1
            if not tokens[pos][4]:
                raise ValueError("Falta else en exportacion")
            derecha, pos = parsear(pos + 1)
            return (int(t[0]), float(t[1]), izquierda, derecha), pos
        raiz, _ = parsear(0)
        def evaluar(nodo, fila):
            while nodo[0] != "leaf":
                nodo = nodo[2] if float(fila[nodo[0]]) <= nodo[1] else nodo[3]
            return nodo[1]
        generado = np.array([evaluar(raiz, fila) for fila in x])
        if not np.array_equal(generado, arbol.predict(x).astype(int)):
            raise ValueError(f"La exportacion del arbol {i} no coincide con Python")
        if fuente not in texto:
            raise ValueError("Modelo final no contiene el arbol verificado")


def preparar(registros):
    x, y, grupos, ids, materiales = [], [], [], [], []
    excluidas = Counter()
    vistos = set()
    configuraciones = set()
    etiquetas_por_firma = {}
    for r in registros:
        etiqueta = r.get("etiqueta", "")
        if etiqueta not in CLASES:
            motivo = "sin_etiqueta_o_descartada" if etiqueta in ("", "descartar") else "etiqueta_antigua_o_desconocida_revisar"
            excluidas[motivo] += 1
            continue
        p = r["payload"]
        validar_captura(p)
        clave = (p["device_id"], p["boot_id"], p["cycle_id"])
        if clave in vistos:
            excluidas["duplicada"] += 1
            continue
        vistos.add(clave)
        if not r.get("pieza_id") or r.get("material") not in ("metalico", "no_metalico"):
            excluidas["falta_pieza_o_material"] += 1
            continue
        try:
            fila = extraer(p)
        except ValueError as e:
            excluidas[str(e)] += 1
            continue
        firma = tuple(fila)
        if firma in etiquetas_por_firma and etiquetas_por_firma[firma] != etiqueta:
            raise ValueError("Hay firmas identicas con etiquetas distintas. Revisar los ensayos: el modelo no puede distinguir entradas iguales.")
        etiquetas_por_firma[firma] = etiqueta
        # Conversion auditada: 10 bloques contiguos del firmware 2 equivalen a la
        # ventana nueva. Se conserva el firmware original en el registro convertido.
        configuraciones.add(clave_lote(p))
        x.append(fila)
        y.append(CLASES.index(etiqueta))
        grupos.append(r["pieza_id"])
        materiales.append(r["material"])
        ids.append(":".join(map(str, clave)))
    if len(configuraciones) > 1:
        raise ValueError("Hay diferentes firmware/configuraciones u origen manual/automatico. Usar --listar-lotes para ver el detalle y --origen manual o --origen automatica para seleccionar el procedimiento. Cada lote necesita las tres clases y piezas distintas.")
    return x, y, grupos, ids, materiales, excluidas


def separar_pasadas(y, grupos, ids, registros):
    """Reserva el ultimo 20% de ensayos completos de cada pieza/clase conocida."""
    por_id = {':'.join(map(str, (r['payload']['device_id'], r['payload']['boot_id'], r['payload']['cycle_id']))): r for r in registros}
    train, test = [], []
    for pieza in sorted(set(grupos)):
        for clase, nombre in enumerate(CLASES):
            indices = [i for i in range(len(y)) if grupos[i] == pieza and y[i] == clase]
            if len(indices) < 5:
                raise ValueError(f'{pieza} / {nombre}: hay {len(indices)} pasadas; se requieren 5 de esta misma pieza para evaluar pasadas nuevas.')
            def orden(i):
                r = por_id[ids[i]]; p = r['payload']
                return (r.get('recibida', ''), p['boot_id'], p['samples'][0]['t_ms'], p['cycle_id'])
            indices.sort(key=orden)
            n_test = max(1, (len(indices)+4)//5)
            train.extend(indices[:-n_test]); test.extend(indices[-n_test:])
    # No separar lecturas de una prueba ni ventanas que se solapen entre grupos.
    for a in train:
        pa = por_id[ids[a]]['payload']
        for b in test:
            pb = por_id[ids[b]]['payload']
            if (pa['device_id'], pa['boot_id']) == (pb['device_id'], pb['boot_id']):
                if max(pa['samples'][0]['t_ms'],pb['samples'][0]['t_ms']) <= min(pa['samples'][-1]['t_ms'],pb['samples'][-1]['t_ms']):
                    raise ValueError('Hay ventanas solapadas entre entrenamiento y prueba. Usar pasadas completas independientes.')
    return train, test


def entrenar(registros, salida, umbral=0.60, seed=42, piezas_fijas=False):
    import numpy as np
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
    from sklearn.model_selection import StratifiedGroupKFold
    if not 0 < umbral <= 1:
        raise ValueError("El umbral de duda debe estar en (0,1]")
    umbral = f32(umbral)
    x, y, grupos, ids, materiales, excluidas = preparar(registros)
    x, y, grupos = np.asarray(x, dtype=np.float32), np.asarray(y, dtype=int), np.asarray(grupos)
    materiales = np.asarray(materiales)
    etiquetas = list(range(len(CLASES)))
    for i, nombre in enumerate(CLASES):
        n, g = int((y == i).sum()), len(set(grupos[y == i]))
        if n < 10 or (not piezas_fijas and g < 5):
            requisito = '10 capturas por clase de las piezas conocidas' if piezas_fijas else '10 capturas y 5 piezas distintas por clase'
            raise ValueError(f"{nombre}: hay {n} capturas y {g} piezas; se requieren al menos {requisito}.")
    if piezas_fijas:
        train, test = separar_pasadas(y, grupos, ids, registros)
        train, test = np.asarray(train, dtype=int), np.asarray(test, dtype=int)
    else:
        division = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=seed)
        elegida = None
        for train, test in division.split(x, y, grupos):
            if len(set(y[train])) == len(CLASES) and len(set(y[test])) == len(CLASES):
                elegida = train, test
                break
        if elegida is None:
            raise ValueError("No se logro una particion con todas las clases. Agregar piezas/ensayos, sin dividir repeticiones de una pieza.")
        train, test = elegida
        assert not set(grupos[train]) & set(grupos[test])
    assert not {ids[i] for i in train} & {ids[i] for i in test}
    modelo = RandomForestClassifier(n_estimators=16, max_depth=4, min_samples_leaf=2,
                                   class_weight="balanced", random_state=seed, n_jobs=1)
    modelo.fit(x[train], y[train])
    pred, acuerdo = votos_bosque(modelo, x[test])
    dudosa = acuerdo < umbral
    # El material es metadato para auditar errores, nunca una entrada del modelo.
    por_material = {}
    for material in ("metalico", "no_metalico"):
        mascara = materiales[test] == material
        normales = mascara & (y[test] == CLASES.index("senal_normal"))
        falsas_alarmas = normales & (pred != CLASES.index("senal_normal"))
        por_material[material] = {
            "capturas_test": int(mascara.sum()),
            "normales_test": int(normales.sum()),
            "falsas_alarmas_sobre_normales": int(falsas_alarmas.sum()),
            "tasa_falsas_alarmas_sobre_normales": float(falsas_alarmas.sum() / normales.sum()) if normales.any() else None,
            "tasa_dudosos_sobre_normales": float(dudosa[normales].mean()) if normales.any() else None,
            "matriz_confusion": confusion_matrix(y[test][mascara], pred[mascara], labels=etiquetas).tolist() if mascara.any() else None,
        }
    texto = exportar_modelo(modelo, umbral)
    verificar_exportacion(texto, modelo, x)
    salida = Path(salida)
    salida.mkdir(parents=True, exist_ok=True)
    (salida / "modelo_calidad.h").write_text(texto, encoding="utf-8")
    huella = hashlib.sha256(texto.encode()).hexdigest()
    reporte = {
        "modelo_sha256": huella, "seed": seed, "clases": dict(enumerate(CLASES)),
        "feature_version": VERSION, "etiquetas_version": ETIQUETAS_VERSION,
        "features": FEATURE_NAMES, "excluidas": dict(excluidas), "por_material": por_material,
        "capturas_train": len(train), "capturas_test": len(test),
        "piezas_train": sorted(set(grupos[train])), "piezas_test": sorted(set(grupos[test])),
        "evaluacion": {
            "alcance": "piezas_fijas" if piezas_fijas else "piezas_no_vistas",
            "division": "ultimas_pasadas_por_pieza_y_clase" if piezas_fijas else "StratifiedGroupKFold_por_pieza",
            "limitacion": "Evalua pasadas reservadas de las mismas piezas; no demuestra generalizacion a objetos nuevos ni a otro modo de operacion." if piezas_fijas else "Las piezas de prueba no aparecen en entrenamiento.",
        },
        "ids_train": [ids[i] for i in train], "ids_test": [ids[i] for i in test],
        "exactitud_global": float(accuracy_score(y[test], pred)),
        "macro_f1": float(f1_score(y[test], pred, labels=etiquetas, average="macro", zero_division=0)),
        "matriz_confusion_filas_reales_columnas_predichas": confusion_matrix(y[test], pred, labels=etiquetas).tolist(),
        "reporte_clases": classification_report(y[test], pred, labels=etiquetas, target_names=CLASES, output_dict=True, zero_division=0),
        "tasa_dudosos": float(dudosa.mean()), "umbral_voto": umbral,
        "exactitud_no_dudosos": float(accuracy_score(y[test][~dudosa], pred[~dudosa])) if (~dudosa).any() else None,
        "cobertura_no_dudosos": float((~dudosa).mean()),
        "decision": "voto mayoritario por arbol; empate favorece indice menor; acuerdo no es probabilidad calibrada",
        "diferencias_con_sklearn_soft_vote": int((pred != modelo.predict(x[test])).sum()),
        "tamano_header_bytes": len(texto.encode()), "arboles": 16, "profundidad_maxima": 4,
        "nodos": int(sum(t.tree_.node_count for t in modelo.estimators_)),
        "ram_features_bytes": len(FEATURE_NAMES) * 4, "ram_votos_bytes": len(CLASES) * 4,
        "flash_mcu_bytes": None, "ram_total_mcu_bytes": None,
        "medicion_mcu_pendiente": "Medir size-components y mapa de enlace antes/despues; heap_min y stack libres en ejecucion. El tamano del .h no es Flash.",
        "validacion_exportacion": "if/return generados interpretados en Python; no se compilo C++",
        "versiones": {p: version(p) for p in ("numpy", "scikit-learn", "micromlgen")},
        "nota": "El modelo exportado se entreno solo con train. No se reajusto con las muestras de prueba.",
    }
    (salida / "metricas.json").write_text(json.dumps(reporte, indent=2, ensure_ascii=False), encoding="utf-8")
    with (salida / "vectores_prueba.jsonl").open("w", encoding="utf-8") as f:
        for j, i in enumerate(test):
            f.write(json.dumps({"id": ids[i], "x": x[i].tolist(), "real": int(y[i]), "predicha": int(pred[j]), "voto": float(acuerdo[j])}) + "\n")
    return reporte


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    grupo = parser.add_mutually_exclusive_group()
    grupo.add_argument("--db", type=Path, default=BASE / "datos" / "capturas.sqlite3")
    grupo.add_argument("--jsonl", type=Path)
    parser.add_argument("--salida", type=Path, default=BASE / "salida")
    parser.add_argument("--umbral-duda", type=float, default=0.60)
    parser.add_argument('--origen', choices=('manual', 'automatica'), help='Seleccionar el procedimiento sin modificar datos')
    parser.add_argument('--listar-lotes', action='store_true', help='Mostrar clases y piezas por configuracion, sin entrenar')
    parser.add_argument('--piezas-fijas', action='store_true', help='Evaluar nuevas pasadas de las mismas piezas, sin exigir cinco objetos distintos')
    args = parser.parse_args()
    try:
        if args.jsonl:
            with args.jsonl.open(encoding="utf-8-sig") as f:
                registros = [json.loads(linea) for linea in f if linea.strip()]
        else:
            if not args.db.exists():
                raise ValueError("No hay base de capturas: iniciar el servidor y recolectar datos reales primero")
            registros = list(Almacen(args.db).exportar())
        registros = filtrar_origen(registros, args.origen)
        if args.listar_lotes:
            mostrar_lotes(registros, args.piezas_fijas)
            return
        r = entrenar(registros, args.salida, args.umbral_duda, piezas_fijas=args.piezas_fijas)
        print('Alcance: ' + r['evaluacion']['alcance'])
        print(f"Exactitud: {r['exactitud_global']:.3f} | macro-F1: {r['macro_f1']:.3f} | dudosos: {r['tasa_dudosos']:.3f}")
        print(f"Modelo y metricas en: {args.salida.resolve()}")
    except (ValueError, KeyError, OSError, ImportError) as e:
        parser.exit(1, f"No se entreno: {e}\n")


if __name__ == "__main__":
    main()

