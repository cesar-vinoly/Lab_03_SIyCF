// Simula las funciones C normalizadas a JS; no compila ni acciona hardware.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const main = path.join(__dirname, '../main');
const cfg = fs.readFileSync(path.join(main, 'configuracion.h'), 'utf8');
const context = vm.createContext({NAN: NaN, isfinite: Number.isFinite, Math});
const names = ['DISTANCIA_ENTRADA_CM','DISTANCIA_SEGUIMIENTO_MAX_CM','DISTANCIA_EMPUJE_METAL_CM',
  'MUESTRAS_PRESENCIA','MUESTRAS_AUSENCIA','MUESTRAS_FIN_TRANSPORTE','MUESTRAS_REARME',
  'MEMORIA_METAL_MS','METAL_INMEDIATO','ESPERA_CLASIFICACION_MS','SERVO_DESVIO_GRADOS',
  'SERVO_VELOCIDAD_GRADOS_S','SERVO_ESTABILIZACION_MS','SERVO_PREPARACION_MS',
  'RECUPERACION_ECO_NO_METAL_MS','DISTANCIA_SALIDA_NO_METAL_CM','MUESTRAS_ZONA_SALIDA',
  'ENCODER_VENTANA_PERIODOS','ENCODER_MIN_PERIODOS','ENCODER_REINICIO_US','ENCODER_PULSO_MIN_US',
  'ENCODER_PULSOS_VUELTA','DIENTES_MOTOR','DIENTES_RODILLO','ENCODER_MAX_MOTOR_RPM'];
function sinSufijos(s) { return s.replace(/(\d)(?:f|LL)\b/g, '$1'); }
for (const n of names) {
  const line = cfg.match(new RegExp('^#define\\s+' + n + '\\s+(.+)$','m'));
  assert.ok(line, 'Falta constante ' + n);
  context[n] = vm.runInContext(sinSufijos(line[1].split('/*')[0]), context);
}
context.ENCODER_PERIODO_MIN_US = Math.floor(60000000 * context.DIENTES_RODILLO /
  (context.ENCODER_PULSOS_VUELTA * context.DIENTES_MOTOR * context.ENCODER_MAX_MOTOR_RPM)) + 1;
Object.assign(context,{ESPERA:0,CLASIFICANDO:1,POSICIONANDO:2,TRANSPORTANDO:3,REARME:4});

function normalizar(src) {
  return sinSufijos(src.replace(/^#.*$/gm,'')
    .replace(/(?:static inline |static )?(?:void|float) (\w+)\(([^)]*)\)/g,(_,n,args)=>
      'function '+n+'('+args.replace(/(?:const )?(?:encoder_medicion_t|ciclo_t) \*/g,'')
        .replace(/\b(?:int64_t|float|bool) /g,'')+')')
    .replace(/\b(?:const )?(?:int64_t|int|bool|float|unsigned)\s+(\w+)\s*=/g,'let $1 =')
    .replace(/\(float\)/g,'').replaceAll('->','.'));
}
let encoder = fs.readFileSync(path.join(main,'encoder_medicion.h'),'utf8');
encoder = encoder.replace(/typedef struct \{[\s\S]*?\} encoder_medicion_t;/,'')
  .replace('memset(e, 0, sizeof(*e));',
    'Object.assign(e,{ultimo_flanco_us:0,subida_us:0,bajada_us:0,suma_us:0,periodos:Array(ENCODER_VENTANA_PERIODOS).fill(0),cantidad:0,indice:0,rechazados:0});');
vm.runInContext(normalizar(encoder), context);
const enc = {};
const reset = () => context.encoder_medicion_reiniciar(enc);
const edge = t => context.encoder_medicion_flanco(enc,t);
const rpm = t => context.encoder_medicion_rpm(enc,t);
const periodo80 = Math.round(60000000 * context.DIENTES_RODILLO /
  (context.ENCODER_PULSOS_VUELTA * context.DIENTES_MOTOR * 80));
reset(); assert.ok(Number.isNaN(rpm(0)));
let t = 1000; edge(t);
for (let i=0; i<2; i++) { t+=periodo80; edge(t); assert.ok(Number.isNaN(rpm(t))); }
t+=periodo80; edge(t); assert.ok(Math.abs(rpm(t)-80)<0.01);
for (let i=0; i<20; i++) { t+=periodo80+(i%2 ? 1000 : -1000); edge(t); }
assert.ok(Math.abs(rpm(t)-80)<0.01, 'La media usa varios periodos reales');
assert.ok(Number.isNaN(rpm(t+250000)), 'La ultima velocidad no se conserva sin pulsos');
// Ruido de 500 us: no convertir por tiempo muerto una rafaga en RPM plausibles.
for (let i=0; i<1000; i++) { t+=500; edge(t); assert.ok(Number.isNaN(rpm(t))); }
assert.equal(enc.rechazados,1000);
for (let i=0; i<3; i++) { t+=periodo80; edge(t); }
assert.ok(Math.abs(rpm(t)-80)<0.01, 'Recuperacion tras tres periodos limpios');
t+=3000000; edge(t); assert.ok(Number.isNaN(rpm(t)), 'Reinicio tras parada');
reset(); edge(1000); edge(1000+context.ENCODER_PERIODO_MIN_US-1);
assert.equal(enc.cantidad,0);
reset(); edge(1000);
for (let i=1; i<=4; i++) edge(1000+i*context.ENCODER_PERIODO_MIN_US);
assert.ok(rpm(1000+4*context.ENCODER_PERIODO_MIN_US)<=180);
console.log('OK: encoder, media temporal, ruido sostenido, recuperacion, limites y lectura vencida.');

// Probar la entrada usada por la ISR con ambos flancos (no solo el estimador).
const signal=(time,high)=>context.encoder_medicion_senal(enc,time,high);
for(const target of [7.5,75,80,150]){
  reset();
  const period=Math.round(60000000*40/(20*19*target));
  for(let i=0;i<14;i++){
    const at=1000+i*period;
    signal(at,true);
    signal(at+2000,false);signal(at+2100,true); // Rebote bajo durante el pulso real.
    signal(at+Math.floor(period/2),false);
    signal(at+Math.floor(period*.75),true);signal(at+Math.floor(period*.75)+100,false); // Glitch alto.
    if(i>=5)assert.ok(Math.abs(rpm(at+period-1)-target)<.01,`RPM estables con rebotes a ${target}`);
  }
  assert.ok(enc.rechazados>=28);
  assert.ok(Number.isNaN(rpm(1000+16*period+200000)), 'Sin pulsos no mantener la velocidad');
}
reset();
for(let i=0;i<5000;i++){signal(1000+i*200,true);signal(1100+i*200,false);}
assert.ok(Number.isNaN(rpm(1001000)), 'Ruido de alta frecuencia no crea una velocidad');
reset();
for(let i=0;i<100;i++){signal(1000+i*2000,true);signal(2000+i*2000,false);}
assert.ok(Number.isNaN(rpm(201000)), 'Pulsos anchos demasiado rápidos siguen inválidos');
console.log('OK: ISR del encoder filtra rebotes altos/bajos a 7.5–150 RPM sin crear medidas con ruido.');

let cls = fs.readFileSync(path.join(main,'clasificacion.c'),'utf8');
cls = cls.replace(/\*c = \(ciclo_t\)\{([\s\S]*?)\};/g,(_,fields)=>
  'Object.assign(c,{estado:0,metal:false,desviar_servo:false,cerca:0,libre:0,inicio_ms:0,'+
  'ultimo_metal_ms:0,inicio_empuje_ms:0,ultimo_eco_ms:0,ultimo_eco_cm:0,muestras_salida:0,'+
  'recuperando_eco:false,parada_por_perdida:false},{'+fields.replace(/\.(\w+)\s*=/g,'$1:')+'});');
vm.runInContext(normalizar(cls), context);
const c = {}; let ms=0;
function paso(cm,metal=false,centro=true) { ms+=100; context.ciclo_actualizar(c,ms,cm,false,metal,centro); }
function comenzar(metal=false) {
  context.ciclo_iniciar(c);
  for (let i=0;i<13;i++) paso(9,metal);
  assert.equal(c.estado,context.TRANSPORTANDO);
}
comenzar(); paso(30);
const perdidoDesde=ms;
for(let i=0;i<5;i++) paso(118);
assert.equal(c.estado,context.TRANSPORTANDO); assert.ok(c.recuperando_eco);
assert.equal(c.ultimo_eco_ms,perdidoDesde, 'El fondo no renueva la presencia');
for(let i=0;i<20;i++) paso(NaN);
assert.equal(c.estado,context.TRANSPORTANDO);
paso(39); assert.equal(c.recuperando_eco,false);
paso(45.2); paso(47.1);
for(let i=0;i<4;i++) { paso(118); assert.equal(c.estado,context.TRANSPORTANDO); }
paso(NaN); assert.equal(c.estado,context.REARME); assert.equal(c.parada_por_perdida,false);
assert.equal(c.desviar_servo,false, 'Una caja nunca ordena el servo');
comenzar(); paso(30);
for(let i=1;i<50;i++) { paso(118); assert.equal(c.estado,context.TRANSPORTANDO); }
paso(118); assert.equal(c.estado,context.REARME); assert.equal(c.parada_por_perdida,true);
// Un eco aislado cerca de salida no elimina el margen de recuperacion.
comenzar(); paso(45.5); paso(NaN); paso(46);
for(let i=0;i<5;i++) paso(118);
assert.equal(c.estado,context.TRANSPORTANDO); assert.ok(c.recuperando_eco);
// El metal espera hasta 32 cm; ni el umbral anterior ni 31,5 cm disparan.
comenzar(true);
for(const distancia of [30,31.5,31.8,31.9]){paso(distancia);assert.equal(c.desviar_servo,false);}
paso(32); assert.equal(c.desviar_servo,true);
for(let i=0;i<5;i++) paso(118);
assert.equal(c.estado,context.REARME); assert.equal(c.desviar_servo,true);
assert.equal(c.recuperando_eco,false);
for(let i=0;i<13;i++) paso(NaN);
assert.equal(c.desviar_servo,false);
context.ciclo_iniciar(c);
for(let i=0;i<100;i++) paso(118);
assert.equal(c.estado,context.ESPERA, 'Una silla nunca inicia transporte');
// Los diez segundos de la captura no limitan el transporte con presencia.
comenzar(); for(let i=0;i<150;i++) paso(35);
assert.equal(c.estado,context.TRANSPORTANDO);
console.log('OK: caja a 30 cm, recuperacion de eco, salida, tiempo maximo, metal y rechazo del fondo.');

// Caso reportado: lata expulsada, eco permanente de la pala mientras está afuera.
comenzar(true);paso(32.4);const empuje=ms;
while(ms-empuje+100<context.SERVO_PREPARACION_MS){
  paso(38,false,false);assert.equal(c.desviar_servo,true);
}
paso(38,false,false);
assert.equal(c.desviar_servo,false,'Retornar aunque el ultrasonido siga viendo la pala');
assert.equal(c.estado,context.TRANSPORTANDO);
for(let i=0;i<15;i++){
  paso(i%2?38:NaN,false,false);
  assert.equal(c.libre,0,'No contar ausencias durante el retorno');
  assert.equal(c.estado,context.TRANSPORTANDO);assert.equal(c.desviar_servo,false);
}
// Pala centrada y asentada: exigir cinco muestras limpias de ausencia.
for(let i=0;i<4;i++){paso(NaN);assert.equal(c.estado,context.TRANSPORTANDO);}
paso(NaN);assert.equal(c.estado,context.REARME);
for(let i=0;i<5;i++)paso(NaN);
assert.equal(c.estado,context.ESPERA);
// Si queda una pieza real, transportarla sin repetir el barrido indefinidamente.
comenzar(true);paso(32.4);
for(let i=0;i<15;i++)paso(38,false,false);
for(let i=0;i<30;i++){paso(40);assert.equal(c.desviar_servo,false);assert.equal(c.estado,context.TRANSPORTANDO);}
// Una ausencia antes de completar el empuje puede parar el motor. El eco de la
// pala reaparecido en REARME no debe crear un objeto nuevo durante su retorno.
comenzar(true);paso(32.4);
for(let i=0;i<5;i++)paso(NaN,false,false);
assert.equal(c.estado,context.REARME);
for(let i=0;i<25;i++){paso(35,false,false);assert.equal(c.estado,context.REARME);assert.equal(c.cerca,0);}
for(let i=0;i<5;i++)paso(NaN);
assert.equal(c.estado,context.ESPERA);
console.log('OK: eco de pala persistente, retorno acotado, ausencia verificada, un empuje por ciclo y rearme sin objeto fantasma.');
