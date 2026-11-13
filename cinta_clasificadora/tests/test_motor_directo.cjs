// Ejecuta funciones C normalizadas a JS con periféricos simulados. No compila ni flashea.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const main=path.join(__dirname,'../main');
const config=fs.readFileSync(path.join(main,'configuracion.h'),'utf8');
const hardware=fs.readFileSync(path.join(main,'hardware.c'),'utf8');
const velocidad=fs.readFileSync(path.join(main,'velocidad.c'),'utf8');
const calls=[];
const ctx=vm.createContext({fminf:Math.min,fmaxf:Math.max,lroundf:Math.round,NULL:null,
  step_timer:1,timer_en_marcha:false,step_habilitado:false,step_alto:false,ultimo_mando_hz:0,frecuencia_step:0,
  gpio_set_level:(p,v)=>calls.push(['gpio',p,Number(v)]),esp_rom_delay_us:t=>calls.push(['delay',t]),
  gptimer_set_alarm_action:(timer,alarm)=>calls.push(['alarm',alarm.alarm_count]),
  gptimer_set_raw_count:(timer,v)=>calls.push(['counter',v]),
  gptimer_start:()=>calls.push(['start']),gptimer_stop:()=>calls.push(['stop']),
  ESP_ERROR_CHECK:v=>v});
const suffix=s=>s.replace(/(\d)(?:f|ULL|LL|U)\b/g,'$1');
for(const name of ['MOTOR_PASOS_VUELTA','MOTOR_MICROPASOS','DIRECTO_MAX_RPM','DIRECTO_ACEL_RPM_S','DIRECTO_FRENO_RPM_S',
  'ACTUADORES_PERIODO_MS','STEP_MIN_HZ','STEP_MAX_HZ','PIN_STEP','PIN_DIR','PIN_EN',
  'SERVO_CENTRO_GRADOS','SERVO_AJUSTE_GRADOS','SERVO_DESVIO_GRADOS','SERVO_INVERTIR','SERVO_PULSO_MIN_US','SERVO_PULSO_MAX_US','STEP_RELOJ_HZ']){
  const line=(config+'\n'+hardware).match(new RegExp('^#define\\s+'+name+'\\s+(.+)$','m'));
  ctx[name]=vm.runInContext(suffix(line[1].split('/*')[0]),ctx);
}
function fn(src,name){
  const start=src.indexOf(name+'('),brace=src.indexOf('{',start);assert.ok(start>=0,name);
  let end=brace+1,depth=1;
  while(depth){if(src[end]==='{')depth++;if(src[end]==='}')depth--;end++;}
  return 'function '+src.slice(start,end)
    .replace(/^(\w+)\(void\)/,'$1()')
    .replace(/\b(?:const )?(?:float|unsigned|bool|gptimer_handle_t|void)\s*\*?\s*(?=\w+[,)])/g,'')
    .replace(/const gptimer_alarm_event_data_t \*evento/g,'evento')
    .replace(/velocidad_t \*v/g,'v')
    .replace(/\(void\)\w+;/g,'')
    .replace(/port(?:ENTER|EXIT)_CRITICAL(?:_ISR)?\(&step_mutex\);/g,'')
    .replace(/gptimer_alarm_config_t alarma = \{([\s\S]*?)\};/,(_,x)=>'const alarma = {'+x.replace(/\.flags\.auto_reload_on_alarm/g,'auto_reload_on_alarm').replace(/\.(\w+)\s*=/g,'$1:').replace('auto_reload_on_alarm =','auto_reload_on_alarm:')+'};')
    .replace(/\b(?:const )?(?:float|unsigned|uint64_t)\s+(\w+)\s*=/g,'let $1 =')
    .replace(/\((?:unsigned|float)\)/g,'').replace('&alarma','alarma').replaceAll('->','.');
}
for(const [src,names] of [[velocidad,['limitar','velocidad_directa']],[hardware,['pulso_servo','step_alarma','detener_step','motor_aplicar','motor_direccion']]]){
  for(const name of names){
    let code=suffix(fn(src,name));
    // Preservar la división entera del temporizador en esta simulación JS.
    code=code.replace('STEP_RELOJ_HZ / (2 * hz)','Math.floor(STEP_RELOJ_HZ / (2 * hz))');
    vm.runInContext(code,ctx);
  }
}
const v={rampa_hz:0};
for(const [percent,expected] of [[25,1000],[50,2000],[100,4000],[10,400]]){
  let rate;
  for(let i=0;i<100;i++)rate=ctx.velocidad_directa(v,percent,.02);
  assert.equal(rate,expected,`${percent}% llega a ${expected} Hz`);
  const before=calls.filter(c=>c[0]==='start').length;
  assert.ok(Math.abs(ctx.motor_aplicar(rate)-expected)<=1);
  if(before)assert.equal(calls.filter(c=>c[0]==='start').length,before,'No reiniciar GPTimer al cambiar velocidad');
}
assert.equal(ctx.velocidad_directa(v,0,.02),0);
const ramp={rampa_hz:0};
assert.equal(ctx.velocidad_directa(ramp,100,10),64,'Un retraso no salta la rampa');
assert.equal(ctx.velocidad_directa(ramp,100,.02),128);
ctx.step_alarma(null,null,null);assert.equal(ctx.step_alto,true);
calls.length=0;ctx.motor_direccion(false);
assert.deepEqual(calls.slice(0,4),[['gpio',ctx.PIN_STEP,0],['stop'],['gpio',ctx.PIN_DIR,0],['delay',10]],'STEP se detiene antes de DIR');
assert.equal(ctx.step_habilitado,false);
const n=calls.length;ctx.step_alarma(null,null,null);assert.equal(calls.length,n,'Una ISR tardía no genera un pulso');
assert.ok(!calls.some(c=>c[0]==='gpio'&&c[1]===ctx.PIN_EN),'No apagar y reencender TMC2208 al invertir');
ctx.motor_aplicar(1000);assert.equal(ctx.timer_en_marcha,true);
assert.equal(ctx.motor_aplicar(0),0);assert.equal(ctx.timer_en_marcha,false);
ctx.motor_direccion(true);assert.deepEqual(calls.at(-2),['gpio',ctx.PIN_DIR,1]);
assert.equal(Math.round(ctx.pulso_servo(ctx.SERVO_CENTRO_GRADOS)),1444);
assert.equal(Math.round(ctx.pulso_servo(ctx.SERVO_CENTRO_GRADOS-ctx.SERVO_DESVIO_GRADOS)),778);
console.log('OK: porcentajes 10/25/50/100, rampa, cambio de frecuencia sin reinicio, parada, DIR, ISR tardía y ajuste del servo.');
