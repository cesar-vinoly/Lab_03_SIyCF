import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Box3,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createPieceModels,piecePosition,ULTRASONIC_FACE_Z,loadDistanceOffset,DISTANCE_OFFSET_STORAGE_KEY} from '../app/piece-models.ts';
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
test('correccion inicial +1,25 cm y ausencia no crean piezas con eco invalido',()=>{
  close(piecePosition(8.6),9.85);close(piecePosition(47.5),48.75);
  close(piecePosition(20,1),21);
  for(const cm of [null,undefined,NaN,Infinity,114,0,-5])assert.equal(piecePosition(cm),null);
  close(piecePosition(50),51.25);close(piecePosition(8),9.25);
  close(piecePosition(8.6,0),8.6);
  assert.equal(piecePosition(8.6,NaN),null);
});

test('calibracion guardada: migrar +2,5 y cero v1, conservar ajustes y cero explicito nuevo',()=>{
  const storage=(values={})=>({getItem:key=>values[key]??null});
  close(loadDistanceOffset(storage()),1.25);
  close(loadDistanceOffset(storage({'lab03-distance-offset-v1':'0'})),1.25);
  close(loadDistanceOffset(storage({'lab03-distance-offset-v1':'2.5'})),1.25);
  close(loadDistanceOffset(storage({'lab03-distance-offset-v2':'2.5'})),1.25);
  close(loadDistanceOffset(storage({'lab03-distance-offset-v2':'0'})),0);
  close(loadDistanceOffset(storage({'lab03-distance-offset-v2':'1.5'})),1.5);
  close(loadDistanceOffset(storage({[DISTANCE_OFFSET_STORAGE_KEY]:'2.5','lab03-distance-offset-v2':'0'})),2.5);
  close(loadDistanceOffset(storage({'lab03-distance-offset-v1':'1.2'})),1.2);
  close(loadDistanceOffset(storage({[DISTANCE_OFFSET_STORAGE_KEY]:'0','lab03-distance-offset-v1':'2.5'})),0);
  close(loadDistanceOffset(storage({[DISTANCE_OFFSET_STORAGE_KEY]:'-1'})),-1);
  for(const value of ['bad','null','"2.5"','20'])close(loadDistanceOffset(storage({[DISTANCE_OFFSET_STORAGE_KEY]:value})),1.25);
  close(loadDistanceOffset({getItem(){throw Error('Almacenamiento bloqueado');}}),1.25);
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
test('8,6 cm mas la correccion de 1,25 cm separan sensor y superficie de lata y caja',async()=>{
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
    piece.setPosition(piecePosition(8.6),0,kind);piece.mesh.updateMatrixWorld(true);
    const front=new Box3().setFromObject(models[kind]).min.z;
    close(front-ULTRASONIC_FACE_Z,.0985);
    piece.setPosition(null,1,kind);piece.setPosition(piecePosition(9.6),2,kind);piece.mesh.updateMatrixWorld(true);
    close(new Box3().setFromObject(models[kind]).min.z-front,.01);
  }
});
