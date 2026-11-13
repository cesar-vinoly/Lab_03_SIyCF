// Interpreta el modelo exportado y normaliza la funcion C++ a JS. No compila C++.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),main=path.join(root,'cinta_clasificadora/main');
const modelo=fs.readFileSync(path.join(main,'modelo_calidad.h'),'utf8');
const info=fs.readFileSync(path.join(main,'modelo_calidad_info.h'),'utf8');
const metricas=JSON.parse(fs.readFileSync(path.join(root,'servidor_tinyia/salida_manual/metricas.json'),'utf8'));
assert.equal(crypto.createHash('sha256').update(modelo.replaceAll('\r\n','\n')).digest('hex'),metricas.modelo_sha256);
assert.ok(info.includes(metricas.modelo_sha256));
assert.equal(modelo,fs.readFileSync(path.join(root,'servidor_tinyia/salida_manual/modelo_calidad.h'),'utf8'));
const arboles=[...modelo.matchAll(/int predict\(float \*x\) \{([\s\S]*?)\n\s*}\s*\n\s*protected:/g)]
 .map(m=>new Function('x',m[1]));
const n=Number(modelo.match(/#define TINY_N_ARBOLES (\d+)/)[1]);
const umbral=Math.fround(Number(modelo.match(/#define TINY_UMBRAL_VOTO ([\d.]+)f/)[1]));
assert.equal(arboles.length,n);
// Interpretar tambien la votacion del encabezado instalado, no la de sklearn.
let votar=modelo.split('class ModeloCalidad {')[1].split('int predict(float *x, float *acuerdo) {')[1];
votar=votar.replace(/}\s*};\s*$/,'').replace('unsigned votos[TINY_N_CLASSES] = {0};','const votos=[0,0,0];')
 .replace(/Eloquent::ML::Port::ArbolCalidad(\d+) a\d+; \+\+votos\[a\d+\.predict\(x\)\];/g,'++votos[arboles[$1](x)];')
 .replaceAll('int ','let ').replaceAll('TINY_N_CLASSES','3').replaceAll('TINY_N_ARBOLES',String(n))
 .replace('*acuerdo = (float)votos[mejor] / '+n+';','const acuerdo=votos[mejor]/'+n+';')
 .replace('return mejor;','return [mejor,acuerdo];');
const predecir=new Function('x','arboles',votar);
const vectores=fs.readFileSync(path.join(root,'servidor_tinyia/salida_manual/vectores_prueba.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
for(const v of vectores) assert.deepEqual(predecir(v.x,arboles),[v.predicha,v.voto]);

const fuente=fs.readFileSync(path.join(main,'tiny_ia.cpp'),'utf8');
let evaluar=fuente.split('static tiny_resultado_t tiny_evaluar(const captura_t *c)')[1].split('static void tarea_ia')[0];
evaluar=evaluar.replace('tiny_resultado_t r = {};','let r={activa:false,dudosa:false,voto:0,inferencia_us:0};')
 .replace('int64_t inicio','let inicio').replace('static float x[FIRMA_FEATURES];','const x=new Float32Array(FIRMA_FEATURES);')
 .replace('int i = 0','let i = 0').replace('const muestra_t *s = &c->muestras[i];','const s=c.muestras[i];')
 .replaceAll('->','.').replace('bool eco','const eco').replace('std::isfinite','Number.isFinite')
 .replace(/(\d+\.\d+)f/g,'$1').replace('ModeloCalidad modelo;','')
 .replace('r.clase = modelo.predict(x, &r.voto);','[r.clase,r.voto]=predict(x);');
let features;
const ctx=vm.createContext({FIRMA_MUESTRAS:100,FIRMA_PREVIAS:0,FIRMA_FEATURES:400,TINY_UMBRAL_VOTO:umbral,
 esp_timer_get_time:()=>100,predict:x=>{features=Array.from(x);return predecir(x,arboles)}});
vm.runInContext('function evaluar(c)'+evaluar,ctx);
// Comparar las features reales con features.py (eco, flancos y float32).
const py=spawnSync(path.join(root,'servidor_tinyia/.venv/Scripts/python.exe'),['-c',
 "import json,sys;sys.path.insert(0,'servidor_tinyia');from features import extraer;rs=[json.loads(l) for l in open('servidor_tinyia/capturas.jsonl',encoding='utf-8-sig') if l.strip()];print(json.dumps([{'p':r['payload'],'x':extraer(r['payload'])} for r in rs]))"],
 {cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});
assert.equal(py.status,0,py.stderr);
const capturas=JSON.parse(py.stdout);
for(const {p,x} of capturas){
 const c={cantidad:p.samples.length,previas:p.pretrigger,cancelada:p.cancelada,
  muestras:p.samples.map(s=>({...s,dist_cm:s.dist_cm===null?NaN:Math.fround(s.dist_cm)}))};
 const r=ctx.evaluar(c);
 assert.equal(r.activa,true);assert.deepEqual(features,x);
 const [clase,voto]=predecir(x,arboles);
 assert.equal(r.clase,clase);assert.equal(r.voto,voto);assert.equal(r.dudosa,voto<umbral);
}
const base={cantidad:100,previas:0,cancelada:false,muestras:Array.from({length:100},(_,i)=>({t_ms:i*100,dist_cm:9,inductivo:true,flanco:false}))};
for(const modificacion of [{cantidad:99},{cantidad:101},{previas:1},{cancelada:true}]){
 const r=ctx.evaluar({...base,...modificacion});assert.equal(r.activa,false);assert.equal(r.clase,-1);
}
for(const intervalo of [0,69,161]){
 const c=structuredClone(base);c.muestras[1].t_ms=intervalo;
 assert.equal(ctx.evaluar(c).activa,false);
}
const limites=structuredClone(base);
[NaN,Infinity,1.99,2,200,200.01].forEach((d,i)=>limites.muestras[i].dist_cm=d);
ctx.evaluar(limites);
assert.deepEqual([0,1,2,3,4,5].map(i=>features[4*i+2]),[0,0,0,1,1,0]);

// Ejecutar el envio no bloqueante real con colas simuladas: copia, saturacion y fallo.
let enviar=fuente.split('extern "C" void tiny_encolar(const captura_t *c)')[1];
enviar=enviar.replaceAll('->','.').replace('(unsigned long)','');
const cola=[],red=[],logs=[];
let descartesIA=0;
const ctxCola=vm.createContext({cola,pdTRUE:1,
 lab03_descarte_ia:()=>descartesIA++,
 xQueueSend:(q,c,espera)=>{assert.equal(espera,0);if(q.length)return 0;q.push(structuredClone(c));return 1},
 red_encolar:c=>red.push(structuredClone(c)),ESP_LOGW:(...x)=>logs.push(x)});
vm.runInContext('function enviar(c)'+enviar,ctxCola);
const c={ciclo_id:1,ia:{activa:false,clase:-1},muestras:[{dist_cm:9}]};
ctxCola.enviar(c);c.muestras[0].dist_cm=33;
assert.equal(cola[0].muestras[0].dist_cm,9);assert.equal(red.length,0);
ctxCola.enviar({...c,ciclo_id:2});assert.equal(red[0].ia.clase,-1);
ctxCola.cola=null;ctxCola.enviar({...c,ciclo_id:3});assert.equal(red.length,2);
assert.equal(descartesIA,2);
console.log(`OK: modelo instalado, ${vectores.length} vectores, ${capturas.length} capturas/contrato float32, ventanas invalidas y cola IA sin espera.`);
