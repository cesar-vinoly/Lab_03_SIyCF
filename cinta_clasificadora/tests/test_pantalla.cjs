// Verifica conversiones y renglones del C interpretado en JS, sin compilar ni usar hardware.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'../main');
const config=fs.readFileSync(path.join(root,'configuracion.h'),'utf8');
const modelo=fs.readFileSync(path.join(root,'pantalla_modelo.h'),'utf8');
const pantalla=fs.readFileSync(path.join(root,'pantalla.c'),'utf8');
let now=100000, wifi=true, ws=true, lines={};
const ctx=vm.createContext({NAN:NaN,isfinite:Number.isFinite,fabsf:Math.abs,fminf:Math.min,fmaxf:Math.max,lroundf:Math.round,
  esp_timer_get_time:()=>now,red_lista:()=>wifi,lab03_enlace_vigente:()=>ws,
  frame:new Uint8Array(1025),regimen_desde_us:0,texto:(x,y,text)=>{lines[y]=text;},
  format:(fmt,...args)=>{let i=0;return fmt.replace(/%%|%s|%u|%d|%\.1f/g,t=>t==='%'+'%'?'%':t==='%.1f'?Number(args[i++]).toFixed(1):String(args[i++]));}});
for(const name of ['OLED_DATOS_VENCIDOS_MS','OLED_DIAMETRO_RODILLO_MM','OLED_OFFSET_HC_CM',
  'OLED_LONGITUD_BANDA_CM','OLED_ERROR_LIMITE_PCT','OLED_REGIMEN_MS','MOTOR_PASOS_VUELTA',
  'MOTOR_MICROPASOS','DIENTES_MOTOR','DIENTES_RODILLO','ENCODER_MAX_MOTOR_RPM','DIRECTO_MAX_RPM']){
  const v=config.match(new RegExp('^#define\\s+'+name+'\\s+([^/\\r\\n]+)','m'));
  ctx[name]=Number(v[1].trim().replace(/f$/,''));
}
function extract(source,name){
  const start=source.indexOf(name+'('),begin=source.indexOf('{',start);
  assert.ok(start>=0,name);let end=begin+1,depth=1;
  while(depth){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;}
  return source.slice(start,end);
}
function translate(s){return s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\((?:int64_t|unsigned|double)\)/g,'')
  .replace(/"[^"]*"|(\d)f\b/g,(match,digit)=>digit??match).replace(/&m->estado/g,'m->estado').replaceAll('->','.')
  .replace(/pantalla_vista_t v = \{0\};/,'let v = {};')
  .replace(/\bconst lab_snapshot_t \*s\b/g,'const s').replace(/\bconst char \*(\w+)/g,'const $1')
  .replace(/\b(?:pantalla_vista_t|int64_t|float|bool) (\w+) =/g,'let $1 =');}
let calc=extract(modelo,'pantalla_calcular').replace(/\(const lab_snapshot_t \*s,[\s\S]*?ahora_us\)/,'(s,muestra_us,ahora_us)');
vm.runInContext('function '+translate(calc),ctx);
let draw=extract(pantalla,'dibujar').replace('(const pantalla_muestra_t *m)','(m)')
  .replace('char linea[48];','let linea;').replace('memset(frame, 0, sizeof(frame));','frame.fill(0);')
  .replace(/snprintf\(linea, sizeof\(linea\),([\s\S]*?)\);/g,'linea = format($1);');
vm.runInContext('function '+translate(draw),ctx);
const sample={step_hz:2000,direccion:1,emergencia:false,ensayo:false,automatico:false,
  encoder_valido:true,rpm_motor:75,setpoint_rpm:75,dist_cm:8.6,porcentaje:50};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
let v=ctx.pantalla_calcular(sample,now,now);
close(v.rpm_teoricas,35.625);close(v.rpm_reales,35.625);close(v.cm_s_reales,5.5026958823);
close(v.posicion_cm,4.6);close(v.error_pct,0);
function render(s=sample,t=now){lines={};ctx.dibujar({estado:s,t_us:t});for(const l of Object.values(lines)){
  assert.ok(l.length<=21,`Renglon desbordado: ${l}`);assert.match(l,/^[\x20-\x7e]*$/);
}return lines;}
render();assert.equal(lines[0],'FWD V:50% M:8');assert.equal(lines[11],'RPM T:35.6 R:35.6');
assert.equal(lines[22],'cm/s T:5.5 R:5.5');assert.equal(lines[33],'Pos:4.6cm');
assert.equal(lines[55],'HC:OK WF:OK WS:OK');
render({...sample,direccion:-1});assert.match(lines[0],/^REV/);
render({...sample,automatico:true,setpoint_rpm:80,step_hz:2133,porcentaje:10});assert.match(lines[0],/V:53%/);
render({...sample,encoder_valido:false,rpm_motor:NaN,dist_cm:NaN});assert.match(lines[11],/R:--\.-/);
assert.equal(lines[33],'Pos:--.-cm');assert.match(lines[44],/S\/ENC/);assert.match(lines[55],/HC:--/);
render({...sample,encoder_valido:true,rpm_motor:NaN});assert.match(lines[44],/S\/ENC/);
render({...sample,dist_cm:114});assert.equal(lines[33],'Pos:--.-cm');
render({...sample,step_hz:0,direccion:0,encoder_valido:false});assert.match(lines[0],/^STOP/);
render({...sample,emergencia:true});assert.match(lines[44],/FALLA/);assert.match(lines[0],/^STOP/);
render({...sample,ensayo:true});assert.match(lines[44],/ENSAYO/);
render({...sample,step_hz:1000});assert.match(lines[44],/RAMP/);
render({...sample,rpm_motor:40});now+=1600000;render({...sample,rpm_motor:40});assert.match(lines[44],/DIVERG/);
render();assert.match(lines[44],/OK$/);
render(sample,now-1100000);assert.equal(lines[33],'DATOS VENCIDOS');assert.ok(!lines[11].includes('RPM'));
wifi=false;ws=false;render();assert.equal(lines[55],'HC:OK WF:-- WS:--');
for(const hz of [0,40,4000])for(const rpm of [0,180,NaN])for(const cm of [2,49,200,NaN]){
  render({...sample,step_hz:hz,rpm_motor:rpm,dist_cm:cm,porcentaje:100});
}
const font=fs.readFileSync(path.join(root,'pantalla_fuente.h'),'utf8');
assert.equal((font.match(/\{0x[0-9A-Fa-f, x]+\}/g)||[]).length,95,'95 glifos ASCII con cinco columnas');
console.log('OK OLED: unidades de rodillo, posicion, automatico/directo, reversa, sin eco/encoder, parada, divergencia, datos vencidos y limites de texto. Sin compilacion de firmware.');
