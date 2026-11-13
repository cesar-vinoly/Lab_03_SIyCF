import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import WebSocket from '../vendor/ws/wrapper.mjs';
import {startLab03Backend,attachLab03Bridge} from '../control/lab03-bridge.mjs';

function inbox(ws){
  const messages=[],waiters=[];
  ws.on('message',data=>{
    const m=JSON.parse(data.toString());const i=waiters.findIndex(w=>w.match(m));
    if(i<0)messages.push(m);else{const w=waiters.splice(i,1)[0];clearTimeout(w.timer);w.resolve(m);}
  });
  return (type,predicate=()=>true)=>new Promise((resolve,reject)=>{
    const match=m=>m.type===type&&predicate(m);const i=messages.findIndex(match);
    if(i>=0){resolve(messages.splice(i,1)[0]);return;}
    const w={match,resolve,timer:setTimeout(()=>reject(Error(`Falta ${type}`)),4000)};waiters.push(w);
  });
}
const sample={v:1,device_id:'PRUEBA_SOFTWARE',boot_id:'boot',seq:1,t_us:100000,kind:'snapshot',data:{
  estado:'ESPERA',rpm_motor:null,rpm_ts:0,setpoint_rpm:0,dist_cm:9.3,pos_m:null,pos_real_m:null,
  manual:true,metal:false,encoder_valido:false,step_hz:0,servo_us:1489,control_exec_us:20,control_late_us:10,
  control_missed:0,heap_min:100000,stack_min:2048,dropped_ia:0,dropped_events:0,coalesced:0,
  automatico:false,emergencia:false,ensayo:false,capturando:false,direccion:0,porcentaje:50,servo_grados:0,encoder_rechazados:0,objeto:0}};

test('Lab03: Node y Python, telemetría, orden confirmada, alarmas, informe y origen', {timeout:20000},async()=>{
  const temp=await mkdtemp(join(tmpdir(),'lab03-bridge-'));
  let backend,bridge,esp,ui,server;
  try{
    backend=await startLab03Backend({db:join(temp,'traza.sqlite3')});
    server=http.createServer();bridge=attachLab03Bridge(server,backend.port);
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const host=`127.0.0.1:${server.address().port}`;
    ui=new WebSocket(`ws://${host}/ws/ui`,{origin:`http://${host}`});const readUI=inbox(ui);
    await once(ui,'open');await readUI('welcome');
    ui.send(JSON.stringify({type:'heartbeat'}));
    esp=new WebSocket(`ws://${host}/ws/device`);const readESP=inbox(esp);
    await once(esp,'open');esp.send(JSON.stringify(sample));
    await readESP('ack');const telem=await readUI('telemetry');
    assert.equal(telem.message.data.rpm_motor,null);
    ui.send(JSON.stringify({type:'command',action:'AUTO',value:1,request_id:'test-auto'}));
    const cmd=await readESP('command');assert.equal(cmd.action,'AUTO');assert.equal(cmd.value,1);
    esp.send(JSON.stringify({type:'command_ack',id:cmd.id,applied:true,reason:'aplicada por control'}));
    const ack=await readUI('command_result');assert.equal(ack.request_id,'test-auto');assert.equal(ack.applied,true);
    esp.send(JSON.stringify({...sample,seq:2,t_us:200000,kind:'ia',data:{object_id:1,input_t_us:1000,inferencia_us:120,
      activa:true,clase:2,voto:.88,dudosa:false,manual:false}}));
    assert.equal((await readUI('alarm',m=>m.codigo==='senal_anomala')).codigo,'senal_anomala');
    ui.send(JSON.stringify({type:'report'}));assert.equal((await readUI('report')).data.mensajes,2);
    const invalid=new WebSocket(`ws://${host}/ws/ui`,{origin:'http://sitio-ajeno.test'});
    await assert.rejects(once(invalid,'open'));
    esp.close();await once(esp,'close');await readUI('link',m=>m.connected===false);
  }finally{
    ui?.terminate();esp?.terminate();bridge?.close();
    if(server)await new Promise(resolve=>server.close(resolve));
    if(backend){const ended=once(backend.child,'exit');backend.close();await ended;}
    assert.equal(dirname(resolve(temp)),resolve(tmpdir()));
    assert.ok(temp.startsWith(join(tmpdir(),'lab03-bridge-')));
    await rm(temp,{recursive:true,force:true});
  }
});
