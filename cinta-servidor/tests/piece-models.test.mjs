import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Box3,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createPieceModels,piecePosition,ULTRASONIC_FACE_Z} from '../app/piece-models.ts';
import {alignClassifierModel} from '../app/servo-paddle.ts';

async function model(name){
  const b=await readFile(new URL('../public/models/'+name+'.glb',import.meta.url));
  return (await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;
}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
async function fixture(){
  const [belt,lata,caja]=await Promise.all(['correa','lata_01','caja_01'].map(model));
  const bounds=new Box3().setFromObject(belt),models={lata,caja};
  return {bounds,models,piece:createPieceModels(bounds,models)};
}
test('STEP reales: escala en metros, modelos centrados y apoyados sin offsets de Fusion',async()=>{
  const {bounds,piece,models}=await fixture();
  for(const kind of ['lata','caja']){
    piece.setPosition(22.5,0,kind);piece.mesh.updateMatrixWorld(true);
    const box=new Box3().setFromObject(models[kind]),size=box.getSize(new Vector3());
    close(box.max.y,bounds.min.y-.0001);
    close(box.getCenter(new Vector3()).x,(bounds.min.x+bounds.max.x)/2);
    close(box.min.z-ULTRASONIC_FACE_Z,.225);
    assert.ok(size.x<bounds.max.x-bounds.min.x);
    assert.ok(kind==='lata'?size.y>.128&&size.y<.130:size.y>.099&&size.y<.101);
    assert.equal(piece.mesh.children.filter(c=>c.visible).length,1);
  }
});
test('distancia directa, corrección y ausencia no crean piezas con eco inválido',()=>{
  close(piecePosition(8.6),8.6);close(piecePosition(47.5),47.5);
  close(piecePosition(20,1),21);
  for(const cm of [null,undefined,NaN,Infinity,114,0,-5])assert.equal(piecePosition(cm),null);
  close(piecePosition(50),50);close(piecePosition(8),8);
  assert.equal(piecePosition(8.6,NaN),null);
});
test('solo la variante detectada aparece; suavizado no recrea ni escala geometría',async()=>{
  const {piece,models}=await fixture();
  piece.setPosition(8.6,0,'lata');assert.equal(piece.mesh.visible,true);
  const start=piece.mesh.position.z;
  const geometry=[];models.lata.traverse(n=>{if(n.isMesh)geometry.push(n.geometry);});
  piece.setPosition(45,100,'lata');piece.update(200);
  assert.ok(piece.mesh.position.z>start&&piece.mesh.position.z<start+(45-8.6)/100);
  piece.setPosition(null,250,'lata');assert.equal(piece.mesh.visible,false);
  piece.setPosition(10,300,'lata');close(piece.mesh.position.z,start+(10-8.6)/100);
  piece.setPosition(10,310,'caja');assert.equal(piece.mesh.children[0].visible,false);
  assert.equal(piece.mesh.children[1].visible,true);
  piece.setPosition(10,320,null);assert.equal(piece.mesh.visible,false);
  const after=[];models.lata.traverse(n=>{if(n.isMesh)after.push(n.geometry);});
  assert.deepEqual(after,geometry);
  close(models.lata.scale.x,1);close(models.caja.scale.x,1);
});
test('8,6 cm separan la cara CAD del HC-SR04 de la superficie de cada pieza',async()=>{
  const supports=alignClassifierModel(await model('Soportes_fusion'));
  supports.updateMatrixWorld(true);
  let faces=0;
  supports.traverse(n=>{
    if(n.name.startsWith('HC_SR04_gitter_')&&!n.parent?.name.startsWith('HC_SR04_gitter_')){
      close(new Box3().setFromObject(n).max.z,ULTRASONIC_FACE_Z);faces++;
    }
  });
  assert.equal(faces,2,'Las dos rejillas definen la referencia del sensor');
  const {piece,models}=await fixture();
  for(const kind of ['lata','caja']){
    piece.setPosition(8.6,0,kind);piece.mesh.updateMatrixWorld(true);
    const front=new Box3().setFromObject(models[kind]).min.z;
    close(front-ULTRASONIC_FACE_Z,.086);
    piece.setPosition(null,1,kind);piece.setPosition(9.6,2,kind);piece.mesh.updateMatrixWorld(true);
    close(new Box3().setFromObject(models[kind]).min.z-front,.01);
  }
});
