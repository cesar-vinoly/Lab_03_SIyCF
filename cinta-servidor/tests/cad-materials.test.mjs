import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareCadMaterials} from '../app/cad-materials.ts';

async function load(file='Soportes.glb') {
  const bytes=await readFile(new URL('../public/models/'+file,import.meta.url));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  return {bytes,...gltf};
}
function meshes(root){const all=[];root.traverse(x=>{if(x.isMesh)all.push(x);});return all;}

test('soportes y pala sin materiales usan COLOR_0 difuso, con caras visibles y sombreado válido',async()=>{
  for(const file of ['Soportes.glb','Pala_servo.glb']){
    const {scene,parser}=await load(file);
    assert.ok(!parser.json.materials?.length);
    const original=meshes(scene).map(mesh=>[mesh,mesh.geometry,mesh.geometry.getAttribute('color').array.slice()]);
    prepareCadMaterials(scene,false);
    for(const [mesh,geometry,colors] of original){
      assert.equal(mesh.material.metalness,0);
      assert.equal(mesh.material.vertexColors,true);
      assert.equal(mesh.material.side,THREE.DoubleSide);
      assert.equal(mesh.material.flatShading,!geometry.hasAttribute('normal'));
      assert.equal(mesh.geometry,geometry);
      assert.deepEqual(mesh.geometry.getAttribute('color').array,colors);
    }
  }
});

test('un GLB con materiales explícitos conserva su acabado metálico',()=>{
  const material=new THREE.MeshStandardMaterial({metalness:.9,roughness:.3});
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(),material);
  prepareCadMaterials(mesh,true);
  assert.equal(mesh.material,material);assert.equal(material.metalness,.9);
});

test('los 42 materiales del GLB corresponden al STEP de Fusion, sin doble conversión de color',async()=>{
  const {scene,bytes,parser}=await load('Soportes_fusion.glb');
  const step=await readFile(new URL('../modelos_fuente/Soportes.step',import.meta.url));
  const metadata=JSON.parse(await readFile(new URL('../modelos_fuente/Soportes_fusion.conversion.json',import.meta.url),'utf8'));
  assert.equal(createHash('sha256').update(step).digest('hex'),metadata.source_sha256);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),metadata.output_sha256);
  const rgbSource=[...step.toString().matchAll(/COLOUR_RGB\('(?:[^']|'')*',\s*([\d.Ee+-]+),\s*([\d.Ee+-]+),\s*([\d.Ee+-]+)\s*\)/g)]
    .map(m=>new THREE.Color().setRGB(Number(m[1]),Number(m[2]),Number(m[3]),THREE.SRGBColorSpace));
  assert.ok(rgbSource.length>=42);
  assert.equal(parser.json.materials.length,42);
  for(const mat of parser.json.materials){
    const pbr=mat.pbrMetallicRoughness;
    assert.equal(pbr.metallicFactor,0);
    assert.equal(pbr.roughnessFactor,.82);
    assert.ok(rgbSource.some(color=>color.toArray().every((v,i)=>Math.abs(v-pbr.baseColorFactor[i])<1e-6)),'RGB lineal procede de un color del STEP');
  }
  for(const mesh of meshes(scene)){
    const normal=mesh.geometry.getAttribute('normal');
    assert.equal(normal.count,mesh.geometry.getAttribute('position').count);
    assert.ok(normal.array.every(Number.isFinite));
    const original=mesh.material;
    prepareCadMaterials(mesh,true);
    assert.equal(mesh.material,original);
  }
});

test('colores por cara conservados en motor, driver, sensores y servo del ensamble Fusion',async()=>{
  const {scene}=await load('Soportes_fusion.glb');
  function palette(name){
    let part;scene.traverse(node=>{if(node.userData.name===name)part=node;});
    assert.ok(part,name);
    return new Set(meshes(part).flatMap(mesh=>(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(mat=>mat.color.getHexString())));
  }
  assert.equal(palette('Nema17:1').size,9);
  assert.ok(palette('40x60 pcb:1').has('447766'));
  const driver=palette('BTT TMC2208:1');
  for(const hex of ['c43527','5995da','191919'])assert.ok(driver.has(hex),'driver '+hex);
  assert.ok(palette('conector de 2 vias:1').has('1450ff'));
  assert.ok(palette('Platine:1').has('2b527b'));
  assert.equal(palette('servo mg996R:1').size,8);
  assert.ok(palette('servo mg996R:1').has('ff00ff'),'el magenta existe en el STEP original');
  assert.ok(palette('SOLID (3):1').has('ffea00'));
});

test('visor usa el GLB derivado del STEP y no aplica la paleta anterior sobre sus materiales',async()=>{
  const viewer=await readFile(new URL('../app/viewer.tsx',import.meta.url),'utf8');
  assert.ok(viewer.includes('/models/Soportes_fusion.glb'));
  assert.ok(!viewer.includes('restoreDriverColors'));
});
