import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Lab03Motion} from '../app/lab03-motion.ts';
import {createTransmission,ROTORS} from '../app/transmission.ts';

const sample=(extra={})=>({direccion:1,step_hz:2000,setpoint_rpm:75,encoder_valido:false,rpm_motor:null,emergencia:false,ensayo:false,...extra});
test('arranque estimado, transición a encoder y pérdida de señal sin inventar RPM medidas',()=>{
  const observer=new Lab03Motion();
  assert.deepEqual(observer.observe(sample(),0),{direction:-1,driveRpm:75,source:'startup'});
  assert.equal(observer.observe(sample({step_hz:1000}),100).driveRpm,37.5);
  assert.equal(observer.observe(sample(),2499).source,'startup');
  assert.deepEqual(observer.observe(sample(),2500),{direction:0,driveRpm:0,source:'missing'});
  assert.equal(observer.observe(sample({encoder_valido:true,rpm_motor:72}),3000).driveRpm,72);
  assert.equal(observer.observe(sample(),3100).source,'missing');
  observer.reset(); // Desconexión o nuevo boot.
  assert.equal(observer.observe(sample(),3200).source,'startup');
  assert.deepEqual(observer.observe(sample({encoder_valido:true,rpm_motor:0}),3300),{direction:0,driveRpm:0,source:'encoder'});
  assert.equal(observer.observe(sample(),3400).source,'missing', 'Cero real cancela la estimación de arranque');
});
test('parada, emergencia y ensayo congelan; una nueva marcha habilita otro arranque acotado',()=>{
  for(const stop of [{step_hz:0},{direccion:0},{emergencia:true},{ensayo:true}]){
    const observer=new Lab03Motion();observer.observe(sample(),0);
    assert.deepEqual(observer.observe(sample(stop),100),{direction:0,driveRpm:0,source:'stopped'});
    assert.deepEqual(observer.observe(sample({direccion:-1,step_hz:4000}),200),{direction:1,driveRpm:150,source:'startup'});
  }
  const slow=new Lab03Motion();
  const s=sample({step_hz:200,setpoint_rpm:7.5});
  assert.equal(slow.observe(s,0).driveRpm,7.5);
  assert.equal(slow.observe(s,4000).source,'startup');
  assert.equal(slow.observe(s,4300).source,'missing');
});
test('la telemetría Lab03 mueve engranajes, rodillos, encoder y fase de correa en ambos sentidos',()=>{
  for(const direction of [1,-1]){
    const observer=new Lab03Motion(),transmission=createTransmission();
    const rotors=ROTORS.map(spec=>({spec,pivot:transmission.add(new THREE.Group(),spec)}));
    let beltAngle=0;
    transmission.onRotate('gear1',delta=>{beltAngle+=delta;});
    const s=sample({direccion:direction,encoder_valido:true,rpm_motor:75});
    transmission.setMotion(observer.observe(s,0),0);transmission.update(100);
    const angle=-direction*75*Math.PI*2/60*.1;
    assert.ok(Math.abs(beltAngle-angle)<1e-9);
    for(const {spec,pivot} of rotors){
      const expected=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),angle*spec.ratio);
      assert.ok(1-Math.abs(expected.dot(pivot.quaternion))<1e-12,spec.id);
    }
    transmission.setMotion(observer.observe(sample({step_hz:0}),110),110);
    const frozen=transmission.getState().phase;transmission.update(5000);
    assert.equal(transmission.getState().phase,frozen);
  }
});
test('avance automático y directo llevan la superficie superior hacia la salida del CAD',()=>{
  for(const automatico of [true,false])for(const encoder_valido of [true,false]){
    const observer=new Lab03Motion();
    const motion=observer.observe(sample({automatico,encoder_valido,rpm_motor:75}),0);
    // Radio hacia arriba en CAD = -Y; velocidad tangencial = omega x radio.
    const omega=new THREE.Vector3(motion.direction*motion.driveRpm,0,0);
    const tangent=omega.cross(new THREE.Vector3(0,-.0175,0));
    assert.ok(tangent.z>0, 'Avance desde el sensor hacia la salida, Z creciente');
    const reverse=observer.observe(sample({automatico:false,direccion:-1,encoder_valido,rpm_motor:75}),100);
    assert.equal(reverse.direction,-motion.direction,'Reversa mantiene la correspondencia física');
  }
});
