"""Convierte un ensamble STEP a GLB conservando colores de caras y componentes.

Uso: .venv-cad/Scripts/python.exe scripts/convertir_soportes_step.py origen.step salida.glb
Dependencia de conversión: cadquery-ocp==7.9.3.1.1 (no se ejecuta en el navegador).
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.IFSelect import IFSelect_RetDone
from OCP.Interface import Interface_Static
from OCP.Message import Message_ProgressRange
from OCP.RWGltf import RWGltf_CafWriter
from OCP.RWMesh import RWMesh_CoordinateSystem_Zup
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TCollection import TCollection_AsciiString, TCollection_ExtendedString
from OCP.TColStd import TColStd_IndexedDataMapOfStringString
from OCP.TDF import TDF_LabelSequence
from OCP.TDocStd import TDocStd_Document
from OCP.XCAFDoc import XCAFDoc_DocumentTool


def convert(source: Path, destination: Path, metadata_path: Path | None = None):
    reader = STEPCAFControl_Reader()
    reader.SetColorMode(True)
    reader.SetNameMode(True)
    reader.SetMatMode(True)
    Interface_Static.SetCVal_s('xstep.cascade.unit', 'MM')
    document = TDocStd_Document(TCollection_ExtendedString('BinXCAF'))
    print('Leyendo STEP y estilos XCAF...', flush=True)
    if reader.ReadFile(str(source)) != IFSelect_RetDone or not reader.Transfer(document):
        raise RuntimeError('No se pudo leer el STEP completo.')
    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(document.Main())
    labels = TDF_LabelSequence()
    shape_tool.GetFreeShapes(labels)
    if not labels.Length():
        raise RuntimeError('El STEP no contiene formas.')
    print('Triangulando superficies con tolerancia de 0,05 mm...', flush=True)
    for i in range(1, labels.Length() + 1):
        mesher = BRepMesh_IncrementalMesh(shape_tool.GetShape_s(labels.Value(i)), .05, False, .25, True)
        if not mesher.IsDone():
            raise RuntimeError('No se pudo triangular el ensamble.')
    destination.parent.mkdir(parents=True, exist_ok=True)
    writer = RWGltf_CafWriter(TCollection_AsciiString(str(destination)), True)
    writer.SetMergeFaces(True)
    writer.SetSplitIndices16(True)
    converter = writer.ChangeCoordinateSystemConverter()
    # Mantener el Z vertical del CAD. El visor aplica la misma conversión que a la pala.
    converter.SetInputCoordinateSystem(RWMesh_CoordinateSystem_Zup)
    converter.SetOutputCoordinateSystem(RWMesh_CoordinateSystem_Zup)
    converter.SetInputLengthUnit(.001)
    converter.SetOutputLengthUnit(1.)
    print('Exportando materiales por cara y jerarquía del ensamble...', flush=True)
    if not writer.Perform(document, TColStd_IndexedDataMapOfStringString(), Message_ProgressRange()):
        raise RuntimeError('No se pudo escribir el GLB.')
    # STEP aporta RGB y jerarquía de estilos, pero no un material PBR completo.
    # Escribir los parámetros evita el metalness=1 implícito de glTF.
    raw = destination.read_bytes()
    json_length = struct.unpack_from('<I', raw, 12)[0]
    gltf = json.loads(raw[20:20 + json_length])
    for material in gltf['materials']:
        pbr = material.setdefault('pbrMetallicRoughness', {})
        pbr.setdefault('metallicFactor', 0.)
        pbr.setdefault('roughnessFactor', .82)
    gltf['asset']['extras'] = {'source': source.name, 'upAxis': 'Z', 'colorSource': 'STEP XCAF',
                              'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest()}
    encoded = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    encoded += b' ' * (-len(encoded) % 4)
    rest = raw[20 + json_length:]
    destination.write_bytes(struct.pack('<III', 0x46546C67, 2, 20 + len(encoded) + len(rest)) +
                            struct.pack('<II', len(encoded), 0x4E4F534A) + encoded + rest)
    metadata = {
        'source': source.name,
        'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'output_sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
        'converter': 'OpenCascade / cadquery-ocp 7.9.3.1.1',
        'linear_deflection_mm': .05, 'angular_deflection_rad': .25,
        'coordinates': 'Z up; meters; preserve assembly placements',
        'colors': 'XCAF surface/part colors, linear RGB in glTF; no Lab 1 palette overrides',
    }
    (metadata_path or destination.with_suffix('.conversion.json')).write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
    print(f'GLB creado: {destination.name} ({destination.stat().st_size:,} bytes)', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--metadata', type=Path)
    args = parser.parse_args()
    convert(args.source.resolve(strict=True), args.destination.resolve(), args.metadata)
