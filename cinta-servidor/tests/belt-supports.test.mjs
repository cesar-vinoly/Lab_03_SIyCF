/**
 * Pruebas automatizadas de superficies de correa y protección de subensambles.
 * Los relojes/dispositivos simulados permiten reproducir transiciones sin hardware.
 * Estas verificaciones no sustituyen un ensayo físico de la cinta.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {applyBeltMaterials, BELT_TILE_LENGTH} from '../app/belt.ts';
import {createTransmission} from '../app/transmission.ts';
import {applySupportMaterial, inspectSupports} from '../app/support-materials.ts';

async function readGLB(file) {
  const buffer=await readFile(new URL('../public/models/'+file,import.meta.url));
  return {buffer, json:JSON.parse(buffer.subarray(20,20+buffer.readUInt32LE(12)).toString())};
}
async function beltFixture() {
  const {buffer}=await readGLB('correa.glb');
  const gltf=await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),'');
  const finishes=Object.fromEntries(['abrasive','backing'].map(name=>{
    const map=new THREE.Texture({width:1920,height:1280});
    map.name=name;
    return [name,new THREE.MeshStandardMaterial({map,bumpMap:map.clone()})];
  }));
  const transmission=createTransmission();
  return {root:gltf.scene, finishes, transmission};
}
function snapshot(root) {
  const nodes=[];
  root.traverse(node=>nodes.push({node,parent:node.parent,children:[...node.children],
    transform:[...node.position,...node.quaternion,...node.scale],
    geometry:node.geometry,
    attributes:node.geometry?Object.fromEntries(Object.entries(node.geometry.attributes).map(([name,attribute])=>
      [name,{attribute,array:attribute.array.slice()}])):null,
    index:node.geometry?.index?.array.slice(),
  }));
  return nodes;
}
function assertGeometryUnchanged(nodes) {
  for (const before of nodes) {
    assert.equal(before.node.parent,before.parent);
    assert.deepEqual(before.node.children,before.children);
    assert.deepEqual([...before.node.position,...before.node.quaternion,...before.node.scale],before.transform);
    assert.equal(before.node.geometry,before.geometry);
    if (!before.geometry) continue;
    for (const [key,{attribute,array}] of Object.entries(before.attributes)) {
      assert.equal(before.geometry.attributes[key],attribute);
      assert.deepEqual(attribute.array,array);
    }
    assert.deepEqual(before.geometry.index?.array,before.index);
  }
}
// Mirrored-repeat samplers repeat every two tiles, not every single tile.
const wrappedDistance=(a,b)=>Math.abs((a-b)-2*Math.round((a-b)/2));
function textureUV(mesh, index) {
  const uv=new THREE.Vector2().fromBufferAttribute(mesh.geometry.attributes.uv,index);
  mesh.material.map.updateMatrix();
  return uv.applyMatrix3(mesh.material.map.matrix);
}

test('correa real: 10 caras interiores, 6 exteriores, 2 cantos; ninguna geometría ni UV se modifica',async()=>{
  const {root,finishes,transmission}=await beltFixture();
  const before=snapshot(root);
  const belt=applyBeltMaterials(root,finishes,transmission);
  assert.deepEqual(belt.surfaces.map(face=>face.surface),[
    ...Array(10).fill('inside'),...Array(2).fill('edge'),...Array(6).fill('outside'),
  ]);
  for (const {mesh,surface} of belt.surfaces) {
    if (surface==='edge') {assert.equal(mesh.material.map,null);continue;}
    assert.equal(mesh.material.map.source,(surface==='outside'?finishes.abrasive:finishes.backing).map.source);
    assert.equal(mesh.material.map.repeat.x,mesh.material.bumpMap.repeat.x);
    assert.equal(mesh.material.map.wrapS,THREE.MirroredRepeatWrapping);
    assert.ok(mesh.material.map.offset.equals(mesh.material.bumpMap.offset));
  }
  transmission.setDirection(1,0);transmission.update(130000);
  transmission.setDirection(-1,130000);transmission.update(131000);
  assertGeometryUnchanged(before);
  belt.dispose();
});

test('islas UV nativas: las uniones de ambas superficies conservan continuidad de textura',async()=>{
  const {root,finishes,transmission}=await beltFixture();
  const belt=applyBeltMaterials(root,finishes,transmission);
  for (const time of [0,1500,120100]) {
    if (!time) transmission.setDirection(1,0); else transmission.update(time);
    const joints=new Map(); let compared=0;
    for (const {mesh,surface} of belt.surfaces) {
      if (surface==='edge') continue;
      const positions=mesh.geometry.attributes.position;
      for (let i=0;i<positions.count;i++) {
        const key=surface+':'+[positions.getX(i),positions.getY(i),positions.getZ(i)].map(n=>n.toFixed(7)).join(',');
        const uv=textureUV(mesh,i);
        if (joints.has(key)) {
          const previous=joints.get(key);
          assert.ok(wrappedDistance(uv.x,previous.x)<.00002,'costura longitudinal '+key);
          assert.ok(wrappedDistance(uv.y,previous.y)<.00002,'costura transversal '+key);
          compared++;
        } else joints.set(key,uv);
      }
    }
    assert.ok(compared>=24,'se comprobaron las uniones del modelo real');
  }
});

test('el patrón avanza hacia -Z arriba y +Z abajo con giro positivo del rodillo',async()=>{
  const {root,finishes,transmission}=await beltFixture();
  const belt=applyBeltMaterials(root,finishes,transmission);
  // Independently measured flat primitives from the actual GLB: outer upper,
  // outer return, inner upper and inner return (not dependent on runtime tags).
  for (const [index,expectedSign] of [[12,-1],[15,1],[3,-1],[8,1]]) {
    const mesh=belt.surfaces[index].mesh;
    const p=mesh.geometry.attributes.position;
    let lo=0,hi=0;
    for (let i=1;i<p.count;i++) {if(p.getZ(i)<p.getZ(lo))lo=i;if(p.getZ(i)>p.getZ(hi))hi=i;}
    const slope=(textureUV(mesh,hi).x-textureUV(mesh,lo).x)/(p.getZ(hi)-p.getZ(lo));
    assert.equal(Math.sign(slope),expectedSign);
    assert.ok(Math.abs(Math.abs(slope)-1/BELT_TILE_LENGTH)<.0001,'escala longitudinal física');
  }
});

test('avance sin deslizamiento a distintas FPS, sin salto al envolver la fase de los engranajes',async()=>{
  for (const fps of [15,30,60,144]) {
    const {root,finishes,transmission}=await beltFixture();
    const belt=applyBeltMaterials(root,finishes,transmission);
    const maps=belt.surfaces.filter(face=>face.surface!=='edge').map(face=>face.mesh.material.map);
    const offsets=maps.map(map=>map.offset.x);
    transmission.setDirection(1,0);
    const duration=120.13;
    for(let frame=1;frame/fps<duration;frame++)transmission.update(frame*1000/fps);
    transmission.update(duration*1000);
    // 20 rpm, 19/40 reduction, measured 35 mm diameter of the driving roller.
    const travel=duration*(20*2*Math.PI/60)*(19/40)*(.035/2)/BELT_TILE_LENGTH;
    maps.forEach((map,i)=>assert.ok(wrappedDistance(map.offset.x,offsets[i]-travel)<1e-10));
    belt.dispose();
  }
});

test('parada, inversión entre cuadros, pestaña oculta y limpieza detienen o invierten todas las texturas',async()=>{
  const {root,finishes,transmission}=await beltFixture();
  const belt=applyBeltMaterials(root,finishes,transmission);
  const maps=belt.surfaces.filter(face=>face.surface!=='edge').flatMap(face=>[face.mesh.material.map,face.mesh.material.bumpMap]);
  const initial=maps.map(map=>map.offset.x);
  transmission.setDirection(1,0);transmission.update(500);
  transmission.setDirection(-1,1000);transmission.update(2000);
  maps.forEach((map,i)=>assert.ok(wrappedDistance(map.offset.x,initial[i])<1e-12));
  transmission.setDirection(0,2200); const stopped=maps.map(map=>map.offset.x);
  transmission.update(92000);
  maps.forEach((map,i)=>assert.equal(map.offset.x,stopped[i]));
  transmission.setDirection(1,92000);transmission.resetClock();transmission.update(192000);
  maps.forEach((map,i)=>assert.equal(map.offset.x,stopped[i]));
  belt.dispose();transmission.update(193000);
  maps.forEach((map,i)=>assert.equal(map.offset.x,stopped[i]));
});

test('GLB actualizado: estructura gris, electronica y servo conservan materiales',async()=>{
  const {buffer}=await readGLB('Soportes_fusion.glb');
  const root=(await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),'')).scene;
  const before=snapshot(root),inspection=inspectSupports(root);
  assert.ok(inspection.structural.length>=9);
  const originals=[...inspection.protectedNodes].map(mesh=>[mesh,mesh.material]);
  let hasServo=false;root.traverse(node=>{if(node.userData.name==='servo mg996R:1')hasServo=true;});
  assert.ok(hasServo);
  const texture=new THREE.Texture();texture.name='gris.jpg';
  const gray=new THREE.MeshStandardMaterial({map:texture,bumpMap:texture.clone()});
  applySupportMaterial(root,gray);
  for(const [mesh,material] of originals)assert.equal(mesh.material,material);
  for(const mesh of inspection.structural)assert.equal(mesh.material,gray);
  assertGeometryUnchanged(before.filter(record=>!inspection.structural.includes(record.node)));
  for(const mesh of inspection.structural){
    const original=before.find(record=>record.node===mesh).geometry;
    const expected=original.index?original.toNonIndexed():original;
    assert.deepEqual(mesh.geometry.attributes.position.array,expected.attributes.position.array);
    const uv=mesh.geometry.getAttribute('uv'),normal=mesh.geometry.getAttribute('normal');
    assert.equal(uv.count,normal.count);
    assert.ok([...uv.array,...normal.array].every(Number.isFinite));
    const p=mesh.geometry.getAttribute('position');
    for(let i=0;i<p.count;i+=3){
      const a=new THREE.Vector3().fromBufferAttribute(p,i),b=new THREE.Vector3().fromBufferAttribute(p,i+1),c=new THREE.Vector3().fromBufferAttribute(p,i+2);
      if(b.sub(a).cross(c.sub(a)).lengthSq()<1e-24)continue;
      const area=(uv.getX(i+1)-uv.getX(i))*(uv.getY(i+2)-uv.getY(i))-(uv.getY(i+1)-uv.getY(i))*(uv.getX(i+2)-uv.getX(i));
      assert.ok(Math.abs(area)>1e-14,'cada cara no degenerada tiene superficie UV: '+mesh.name);
    }
  }
});
test('si faltan ramas excluidas se rechaza la aplicación antes de modificar materiales',()=>{
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({color:0x123456}));
  mesh.name='sensor_nuevo';const original=mesh.material;
  assert.throws(()=>applySupportMaterial(mesh,new THREE.MeshStandardMaterial()),/exclusiones de textura/);
  assert.equal(mesh.material,original);
});

test('soportes reales: los triángulos coplanares no cambian de proyección UV en las uniones',async()=>{
  const {buffer}=await readGLB('Soportes_fusion.glb');
  const root=(await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),'')).scene;
  const {structural}=applySupportMaterial(root,new THREE.MeshStandardMaterial());
  let checked=0;
  for(const mesh of structural){
    const {position:p,uv}=mesh.geometry.attributes,vertices=new Map();
    for(let i=0;i<p.count;i+=3){
      const a=new THREE.Vector3().fromBufferAttribute(p,i),b=new THREE.Vector3().fromBufferAttribute(p,i+1),c=new THREE.Vector3().fromBufferAttribute(p,i+2);
      const n=b.sub(a).cross(c.sub(a)).normalize();
      for(let k=i;k<i+3;k++){
        const key=[p.getX(k),p.getY(k),p.getZ(k)].map(v=>v.toFixed(7)).join(',');
        const previous=vertices.get(key)??[];
        for(const vertex of previous){
          if(vertex.n.dot(n)>.999999){
            checked++;
            assert.ok(Math.hypot(vertex.u-uv.getX(k),vertex.v-uv.getY(k))<1e-4,'costura coplanar en '+mesh.name);
          }
        }
        previous.push({n,u:uv.getX(k),v:uv.getY(k)});vertices.set(key,previous);
      }
    }
  }
  assert.ok(checked>10000,'verificar suficientes uniones del modelo real');
});

test('textura original: seis exclusiones anteriores más inductivo y MG996R, incluidos sus descendientes',async()=>{
  const {buffer}=await readGLB('Soportes_fusion.glb');
  const root=(await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),'')).scene;
  const excluded=['Nema17:1','HC-020K:1','switch:1','Display_OLED:1','hc-sr04:1','base con driver y fan:1','servo mg996R:1','sensor_inductivo_punta_amarilla:1'];
  const protectedMeshes=new Map();
  for(const name of excluded){
    let branch;root.traverse(node=>{if(node.userData.name===name)branch=node;});
    assert.ok(branch,name);
    branch.traverse(node=>{if(node.isMesh)protectedMeshes.set(node,{material:node.material,geometry:node.geometry});});
  }
  const gray=new THREE.MeshStandardMaterial({map:new THREE.Texture()});
  applySupportMaterial(root,gray);
  root.traverse(node=>{
    if(!node.isMesh)return;
    const saved=protectedMeshes.get(node);
    if(saved){assert.equal(node.material,saved.material);assert.equal(node.geometry,saved.geometry);}
    else assert.equal(node.material,gray);
  });
  // Los soportes mecánicos de ambos dispositivos sí reciben la textura.
  for(const name of ['Soporte_Servo_Cinta_simplificado:1','soporte_con_agujeros:1']){
    let support;root.traverse(node=>{if(node.userData.name===name)support=node;});
    assert.ok(support,name);
    support.traverse(node=>{if(node.isMesh)assert.equal(node.material,gray);});
  }
});
