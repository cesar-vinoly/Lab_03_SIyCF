import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3,Box3} from 'three';
import {Group} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createServoPaddle,alignClassifierModel,SERVO_PIVOT} from '../app/servo-paddle.ts';
async function load(name){
  const b=await readFile(new URL('../public/models/'+name,import.meta.url));
  return (await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;
}

test('pala en vivo: aplica la muestra sin sumar otra rampa, conserva el último ángulo',()=>{
  const p=createServoPaddle(new Group());
  p.synchronizeAngle(42);assert.equal(p.getAngle(),42);
  assert.equal(p.update(0),false);assert.equal(p.update(100),false);
  p.synchronizeAngle(NaN);assert.equal(p.getAngle(),42);
  p.synchronizeAngle(60);assert.equal(p.group.rotation.y,Math.PI/3);
  p.synchronizeAngle(0);assert.equal(p.getAngle(),0);
});
test('soportes nuevos: eje del motor coincide con la transmision CAD anterior',async()=>{
  const root=alignClassifierModel(await load('Soportes_fusion.glb'));
  root.updateMatrixWorld(true);
  let motor;root.traverse(o=>{if((o.userData.name??o.name)==='Nema17:1')motor=o;});
  const origin=motor.getWorldPosition(new Vector3());
  assert.ok(origin.distanceTo(new Vector3(.1998,-.05925,.04))<1e-6);
  const bounds=new Box3().setFromObject(root);
  assert.ok(bounds.max.z>.45&&bounds.min.y<-.15);
});
test('pala: reposo conserva ensamble, eje fijo y barrido reversible de 60 grados',async()=>{
  const root=await load('Pala_servo.glb');
  const original=new Box3().setFromObject(alignClassifierModel(root));
  const paddle=createServoPaddle(root);
  const rest=new Box3().setFromObject(paddle.group);
  assert.ok(rest.min.distanceTo(original.min)<1e-8);
  assert.ok(rest.max.distanceTo(original.max)<1e-8);
  paddle.setAngle(60);paddle.update(0);
  for(let t=100;t<=1000;t+=100)paddle.update(t);
  assert.equal(paddle.getAngle(),60);
  assert.ok(paddle.group.position.equals(SERVO_PIVOT));
  const pushed=new Box3().setFromObject(paddle.group);
  assert.ok(pushed.max.x>rest.max.x+.1,'el barrido entra hacia la correa');
  paddle.setAngle(0);
  for(let t=1100;t<=2000;t+=100)paddle.update(t);
  assert.equal(paddle.getAngle(),0);
  assert.ok(new Box3().setFromObject(paddle.group).min.distanceTo(rest.min)<1e-8);
  paddle.setAngle(1000);paddle.resetClock();paddle.update(100000);assert.equal(paddle.getAngle(),0);
  for(let t=100100;t<=101000;t+=100)paddle.update(t);
  assert.equal(paddle.getAngle(),60);
  paddle.setAngle(NaN);assert.equal(paddle.update(101100),false);
});
