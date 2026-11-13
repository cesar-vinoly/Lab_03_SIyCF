// Ejecuta captura.c normalizada a JS; no compila firmware ni ejecuta perifericos.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
let src=fs.readFileSync(path.join(__dirname,'../cinta_clasificadora/main/captura.c'),'utf8');
src=src.replace(/^#include.*$/gm,'')
 .replace('static captura_t actual;','let actual={};')
 .replace('static uint32_t secuencia;','let secuencia=0;')
 .replace('static bool activa;','let activa=false;')
 .replace('static uint32_t orden_manual;','let orden_manual=0;')
 .replace(/(?:void|bool|unsigned) (captura_\w+)\(([^)]*)\)/g,(_,name,args)=>'function '+name+'('+args.replace(/const muestra_t \*|uint32_t |bool /g,'').replace(/^void$/,'')+')')
 .replace('memset(&actual, 0, sizeof(actual));',
          'actual = {ciclo_id:0,previas:0,ia:{clase:0},cantidad:0,muestras:[],cancelada:false,metal:false};')
 .replaceAll('&actual','actual').replaceAll('*muestra','({...muestra})')
 .replace('(unsigned)uxTaskGetStackHighWaterMark(NULL)','0');
const enviadas=[],inferidas=[],colaIA=[];
const c=vm.createContext({FIRMA_MUESTRAS:100,
 red_encolar:x=>{enviadas.push(structuredClone(x));return true},
 tiny_encolar:x=>{colaIA.push(structuredClone(x))}});
function procesarIA(){
 const captura=colaIA.shift();
 if(!captura.cancelada)inferidas.push(structuredClone(captura));
 captura.ia={activa:!captura.cancelada,clase:captura.cancelada?-1:0};
 enviadas.push(captura);
}
vm.runInContext(src,c);
let tiempo=0;
function tick(nuevo=false,cancelada=false){tiempo+=100;c.captura_actualizar(nuevo,false,cancelada,{t_ms:tiempo,dist_cm:tiempo<5000?5:null})}
for(let i=0;i<20;i++)tick();
assert.equal(enviadas.length,0);
c.captura_manual(1);
assert.equal(c.captura_registro_restante_ms(),10000);
for(let i=0;i<99;i++){tick();assert.equal(enviadas.length,0);assert.ok(c.captura_ocupada())}
assert.equal(inferidas.length,0);
tick();
assert.equal(enviadas.length,0);assert.equal(inferidas.length,0);assert.equal(colaIA.length,1);
procesarIA();
assert.equal(enviadas.length,1);assert.equal(inferidas.length,1);
const p=enviadas[0];
assert.equal(p.cantidad,100);assert.equal(p.previas,0);assert.equal(p.orden_manual,1);
assert.equal(p.muestras[0].t_ms,2100);assert.equal(p.muestras.at(-1).t_ms-p.muestras[0].t_ms,9900);
assert.equal(new Set(p.muestras.map(s=>s.t_ms)).size,100);
assert.ok(!c.captura_ocupada());assert.equal(c.captura_registro_restante_ms(),0);
c.captura_manual(2);for(let i=0;i<20;i++)tick();c.captura_reiniciar();
assert.equal(enviadas.length,2);assert.equal(enviadas[1].cancelada,true);assert.equal(enviadas[1].cantidad,20);
assert.equal(inferidas.length,1); // Una parcial nunca se infiere.
tick(true);for(let i=0;i<99;i++)tick();
// El control inicia otro ciclo antes de que la IA consuma la copia anterior.
tick(true);
assert.equal(colaIA[0].cantidad,100);assert.equal(Boolean(colaIA[0].cancelada),false);
procesarIA();
assert.equal(enviadas.length,3);assert.equal(enviadas[2].manual,false);assert.equal(enviadas[2].cantidad,100);
tick();tick(true); // Otro objeto interrumpe el anterior, sin mezclar dos pruebas.
assert.equal(enviadas.at(-1).cancelada,true);assert.equal(enviadas.at(-1).cantidad,2);
console.log('OK: captura.c: cien muestras, cola IA por copia, inferencia diferida, cancelacion y separacion de ciclos.');
