import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Box3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {alignClassifierModel} from '../app/servo-paddle.ts';
import {prepareCadMaterials} from '../app/cad-materials.ts';

async function load(name){
  const bytes=await readFile(new URL('../public/models/'+name,import.meta.url));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  return {bytes,...gltf};
}

test('canaleta STEP: tres componentes, colores y escala conservados, salida junto a la banda',async()=>{
  const {bytes,scene,parser}=await load('Canaleta.glb');
  const step=await readFile(new URL('../modelos_fuente/Canaleta.step',import.meta.url));
  const meta=JSON.parse(await readFile(new URL('../modelos_fuente/Canaleta.conversion.json',import.meta.url),'utf8'));
  assert.equal(createHash('sha256').update(step).digest('hex'),meta.source_sha256);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),meta.output_sha256);
  assert.equal(parser.json.meshes.length,3);
  assert.equal(parser.json.materials.length,1);
  const original=[];scene.traverse(n=>{if(n.isMesh)original.push([n,n.geometry,n.material]);});
  prepareCadMaterials(scene,true);
  const aligned=alignClassifierModel(scene),box=new Box3().setFromObject(aligned);
  const belt=new Box3().setFromObject((await load('correa.glb')).scene);
  // El STEP ubica la canaleta en la salida lateral del empujador, sin centrarla en el origen.
  assert.ok(box.min.x<belt.max.x&&box.max.x>belt.max.x+.08);
  assert.ok(box.min.z>belt.min.z&&box.max.z<belt.max.z);
  assert.ok(box.min.y<belt.min.y&&box.max.y>belt.max.y);
  assert.ok(Math.abs((box.max.z-box.min.z)-.12)<1e-6);
  assert.ok(Math.abs(box.min.x-.174773417)<1e-6);
  for(const [mesh,geometry,material] of original){
    assert.equal(mesh.geometry,geometry);assert.equal(mesh.material,material);
    assert.ok(mesh.geometry.getAttribute('normal').array.every(Number.isFinite));
    assert.equal(material.metalness,0);
  }
});
