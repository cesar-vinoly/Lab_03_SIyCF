import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,Vector3} from 'three';
import {createViewportSizer} from '../app/viewport-size.ts';

test('igualar la altura del mando mantiene escala, orientación y zoom elegido',()=>{
  const camera=new PerspectiveCamera(36,1,.002,30);
  camera.position.set(.7,.6,.5);camera.lookAt(0,.1,0);camera.zoom=1.4;camera.updateMatrixWorld();
  const resize=createViewportSizer(camera);resize(900,400);
  const position=camera.position.clone(),rotation=camera.quaternion.clone();
  const pixels=(width,height)=>{
    const p=new Vector3(.1,.2,.1).project(camera);return [p.x*width/2,p.y*height/2];
  };
  const original=pixels(900,400);
  for(const h of [650,710,690,400,800,400]){
    resize(900,h);const actual=pixels(900,h);
    for(let i=0;i<2;i++)assert.ok(Math.abs(actual[i]-original[i])<1e-9);
    assert.ok(camera.position.equals(position));assert.ok(camera.quaternion.equals(rotation));
    assert.equal(camera.zoom,1.4);
  }
  resize(450,650);const narrow=pixels(450,650);
  for(let i=0;i<2;i++)assert.ok(Math.abs(narrow[i]-original[i]/2)<1e-9);
  const projection=camera.projectionMatrix.clone();
  assert.equal(resize(0,0),false);assert.equal(resize(NaN,100),false);
  assert.ok(camera.projectionMatrix.equals(projection));
});
