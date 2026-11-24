import {readFile} from 'node:fs/promises';
import {GLTFLoader} from '../cinta-servidor/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {MeshStandardMaterial,Vector3} from '../cinta-servidor/node_modules/three/build/three.module.js';
import {applySupportMaterial} from '../cinta-servidor/app/support-materials.ts';
const b=await readFile('cinta-servidor/public/models/Soportes_fusion.glb');
const root=(await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;
const {structural}=applySupportMaterial(root,new MeshStandardMaterial());
for(const mesh of structural){
 const {position:p,uv}=mesh.geometry.attributes;const vertices=new Map();let same=0,seams=0;
 for(let i=0;i<p.count;i+=3){
  const a=new Vector3().fromBufferAttribute(p,i),b=new Vector3().fromBufferAttribute(p,i+1),c=new Vector3().fromBufferAttribute(p,i+2);
  const n=b.sub(a).cross(c.sub(a)).normalize();
  for(let k=i;k<i+3;k++){
   const key=[p.getX(k),p.getY(k),p.getZ(k)].map(x=>x.toFixed(7)).join(',');
   for(const prev of vertices.get(key)??[]){if(prev.n.dot(n)>.999999){same++;if(Math.hypot(prev.u-uv.getX(k),prev.v-uv.getY(k))>1e-4)seams++;}}
   const list=vertices.get(key)??[];list.push({n,u:uv.getX(k),v:uv.getY(k)});vertices.set(key,list);
  }
 }
 if(seams)console.log(mesh.name,{same,seams});
}
