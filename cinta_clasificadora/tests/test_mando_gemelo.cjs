// Interpreta las funciones de mando C sin compilar ni acceder a la ESP32.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'main/main.c'),'utf8');
const events=[],acks=[];let link=true,center=true;
const ctx=vm.createContext({NAN:NaN,NULL:null,true:true,false:false,
  ciclo:{},velocidad:{},seguridad:{enclavada:false},objeto:0,episodio:0x40000000,
  hz:0,direccion:0,automatico:false,ensayo_manual:false,porcentaje:50,integral_step:0,intervalo:0,ensayo_inicio_ms:0,
  motor_aplicar:v=>v,ciclo_iniciar:()=>{},velocidad_iniciar:()=>{},captura_reiniciar:()=>{},servo_posicionar:()=>{},
  motor_direccion:()=>{},encoder_reiniciar:()=>{},servo_centro_listo:()=>center,lab03_enlace_vigente:()=>link,
  lab03_evento:(...v)=>events.push(v),lab03_responder:(o,ok,reason)=>acks.push({id:o.id,ok,reason})});
['F','R','S','E','V','AUTO','RESET'].forEach((a,i)=>ctx['LAB_'+a]=i);
['FALLA_EVENTO','MOTOR_ORDEN_PARAR','ALARMA','EVENTO_REARME'].forEach(a=>ctx['LAB_'+a]=a);
let safety=fs.readFileSync(path.join(root,'components/lab03_runtime/include/seguridad.h'),'utf8').split('static inline bool lab_seguridad_paso')[1];
safety='function lab_seguridad_paso'+safety.replace(/lab_seguridad_t \*s, bool falla, bool rearme_operador, int64_t ahora/,'s,falla,rearme_operador,ahora').replaceAll('->','.');
vm.runInContext(safety,ctx);
let code=src.slice(src.indexOf('static void evento('),src.indexOf('static esp_err_t iniciar_control'));
code=code.replace(/static void (\w+)\(([^)]*)\)/g,(_,n,args)=>'function '+n+'('+args.replace(/const lab_orden_t \*|lab_evento_t |int64_t |float |void/g,'')+')')
 .replace(/const char \*error/g,'let error').replace(/const int nueva/g,'const nueva').replaceAll('->','.').replace(/&(?=seguridad|ciclo|velocidad)/g,'');
vm.runInContext(code,ctx);
let id=0;const send=(name,value=0)=>{ctx.aplicar_orden({id:++id,accion:ctx['LAB_'+name],valor:value},id*20000);return acks.at(-1);};
assert.equal(ctx.automatico,false);assert.equal(ctx.direccion,0);
assert.ok(send('F').ok);assert.equal(ctx.direccion,1);
assert.equal(send('R').ok,false,'No invertir mientras hay orden de marcha');assert.equal(ctx.direccion,1);
assert.ok(send('S').ok);assert.equal(ctx.direccion,0);
assert.ok(send('R').ok);assert.equal(ctx.direccion,-1);
assert.ok(send('V',0).ok);assert.equal(ctx.direccion,0);assert.equal(send('F').ok,false);
send('V',50);center=false;assert.equal(send('F').ok,false);center=true;
assert.ok(send('AUTO',1).ok);assert.equal(ctx.automatico,true);assert.equal(send('F').ok,false);
assert.ok(send('S').ok);assert.equal(ctx.automatico,false);
send('F');send('E');assert.equal(ctx.seguridad.enclavada,true);assert.equal(ctx.direccion,0);
assert.equal(send('AUTO',1).ok,false);assert.equal(send('F').ok,false);
link=false;assert.equal(send('RESET').ok,false);assert.equal(ctx.seguridad.enclavada,true);
link=true;assert.ok(send('RESET').ok);assert.equal(ctx.seguridad.enclavada,false);assert.equal(ctx.automatico,false);assert.equal(ctx.direccion,0);
ctx.ensayo_manual=true;assert.equal(send('F').ok,false);assert.equal(send('AUTO',1).ok,false);
ctx.ensayo_manual=false;link=false;assert.equal(send('F').ok,false);assert.ok(send('S').ok);
assert.ok(events.some(e=>e[0]==='FALLA_EVENTO'));assert.ok(events.some(e=>e[0]==='ALARMA'));
console.log('OK: mando directo inicial, inversion, velocidad cero, automatico, ensayo, paro enclavado y rearme sin rearranque.');
