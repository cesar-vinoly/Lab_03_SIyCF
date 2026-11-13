/**
 * Selección de materiales estructurales respetando los nombres del GLB.
 * Aplica el acabado original fuera de los subensambles excluidos.
 * La sustitución de referencias evita recolorear materiales compartidos con
 * electrónica protegida; solo se liberan recursos que ya no tienen usuarios.
 */
import {Float32BufferAttribute, Material, Mesh, Texture, Vector3} from 'three';
import type {BufferGeometry, Object3D} from 'three';

// Las seis exclusiones del Lab 1 más el servo y el sensor inductivo.
// Se protegen ramas completas, incluidos materiales compartidos y sus texturas.
export const PROTECTED_SUPPORTS = [
  'Nema17', 'HC-020K', 'switch', 'Display_OLED', 'hc-sr04',
  'base con driver y fan', 'servo mg996R', 'sensor_inductivo_punta_amarilla',
] as const;
function originalName(object:Object3D):string {
  return String(object.userData.name??object.name).replace(/:\d+$/, '').replace(/ \(\d+\)$/, '');
}
export function inspectSupports(root:Object3D){
  const structural:Mesh[]=[];
  const protectedNodes=new Set<Object3D>();
  const found=new Set<string>();
  const visit=(object:Object3D,inherited=false)=>{
    const name=originalName(object);
    const match=PROTECTED_SUPPORTS.some(target=>name===target);
    if(match)found.add(name);
    const isProtected=inherited||match;
    if(object instanceof Mesh){
      if(isProtected)protectedNodes.add(object);
      else structural.push(object);
    }
    for(const child of object.children)visit(child,isProtected);
  };
  visit(root);
  const missing=PROTECTED_SUPPORTS.filter(name=>!found.has(name));
  // Inspeccionar antes de modificar: una exportación sin estas ramas no debe
  // terminar pintando electrónica por haber perdido los nombres o la jerarquía.
  if(missing.length)throw new Error('No se identificaron las exclusiones de textura: '+missing.join(', '));
  return {structural,protectedNodes,found};
}

const SUPPORT_TILE_METRES=.1;

/* Proyección por cara, con una repetición cada 100 mm. Separar los vértices de
 * cada triángulo permite costuras UV sin deformar ni desplazar ninguna cara. */
function prepareStructureGeometry(mesh:Mesh) {
  const original=mesh.geometry;
  if (original.hasAttribute('uv') && original.hasAttribute('normal')) return;
  const geometry=original.index?original.toNonIndexed():original.clone();
  if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
  if (!geometry.hasAttribute('uv')) {
    const positions=geometry.getAttribute('position');
    const uv=new Float32Array(positions.count*2);
    const a=new Vector3(),b=new Vector3(),c=new Vector3(),normal=new Vector3(),edge=new Vector3();
    for (let i=0;i<positions.count;i+=3) {
      a.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(positions,i+1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(positions,i+2).applyMatrix4(mesh.matrixWorld);
      normal.subVectors(b,a).cross(edge.subVectors(c,a)).normalize();
      // Estabiliza los empates en planos a 45 grados: el redondeo del CAD no
      // debe cambiar el eje de proyección entre triángulos de una misma cara.
      const x=Math.abs(normal.x),y=Math.abs(normal.y),z=Math.abs(normal.z);
      const dominant=Math.max(x,y,z),tieTolerance=1e-3;
      for (const [corner,point] of [a,b,c].entries()) {
        const dropX=x>=dominant-tieTolerance,dropY=!dropX&&y>=dominant-tieTolerance;
        const u=dropX?point.y:point.x;
        const v=dropX||dropY?point.z:point.y;
        uv[(i+corner)*2]=u/SUPPORT_TILE_METRES;uv[(i+corner)*2+1]=v/SUPPORT_TILE_METRES;
      }
    }
    geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));
  }
  mesh.geometry=geometry;
  return original;
}

/* Aplica la textura gris a todas las mallas fuera de las ramas excluidas. */
export function applySupportMaterial(root: Object3D, gray: Material) {
  root.updateMatrixWorld(true);
  const inspection = inspectSupports(root);
  const replaced = new Set<Material>();
  const retiredGeometry=new Set<BufferGeometry>();
  for (const mesh of inspection.structural) {
    const original=prepareStructureGeometry(mesh);
    if (original) retiredGeometry.add(original);
    for (const old of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) replaced.add(old);
    // Replace only these references. Imported materials can also be shared by
    // protected children; mutating a shared material would recolor those too.
    mesh.material = gray;
  }
  root.traverse(object=>{if(object instanceof Mesh)retiredGeometry.delete(object.geometry);});
  retiredGeometry.forEach(geometry=>geometry.dispose());
  disposeUnreferencedMaterials(root, replaced);
  return inspection;
}

// Dispose only detached resources; never dispose a material or texture still
// used by a protected component (even through a different material instance).
/* Libera candidatos retirados solo si ninguna malla conserva su material
 * o textura, incluyendo los subcomponentes electrónicos. */
export function disposeUnreferencedMaterials(root: Object3D, candidates: Set<Material>) {
  const usedMaterials = new Set<Material>();
  const usedTextures = new Set<Texture>();
  root.traverse(object=>{
    if (!(object instanceof Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      usedMaterials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) usedTextures.add(value);
    }
  });
  const retiredTextures = new Set<Texture>();
  for (const material of candidates) {
    if (usedMaterials.has(material)) continue;
    for (const value of Object.values(material)) {
      if (value instanceof Texture && !usedTextures.has(value)) retiredTextures.add(value);
    }
    material.dispose();
  }
  retiredTextures.forEach(texture=>texture.dispose());
}
