/** Acabado para exportaciones CAD que solo traen COLOR_0, sin materiales glTF. */
import {DoubleSide, Mesh, MeshStandardMaterial} from 'three';
import type {Object3D} from 'three';

export function prepareCadMaterials(root:Object3D, hasExportedMaterials:boolean) {
  if (hasExportedMaterials) return;
  // GLTFLoader usa metalness=1 por defecto. Sin un entorno reflectante los
  // colores quedan casi negros. La versión original del CAD usaba metalness=0.
  const replacements=new Map<MeshStandardMaterial,MeshStandardMaterial>();
  root.traverse(object=>{
    if (!(object instanceof Mesh)) return;
    const convert=(material:MeshStandardMaterial)=>{
      if (!(material instanceof MeshStandardMaterial)) return material;
      let replacement=replacements.get(material);
      if (!replacement) {
        replacement=material.clone();
        replacement.metalness=0;
        replacement.roughness=.82;
        replacement.side=DoubleSide;
        replacements.set(material,replacement);
      }
      return replacement;
    };
    object.material=Array.isArray(object.material)?object.material.map(convert):convert(object.material);
  });
  replacements.forEach((_replacement,original)=>original.dispose());
}
