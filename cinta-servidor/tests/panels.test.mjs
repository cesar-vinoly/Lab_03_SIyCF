/**
 * Pruebas automatizadas de estructura de interfaz y mando único.
 * Los relojes/dispositivos simulados permiten reproducir transiciones sin hardware.
 * Estas verificaciones no sustituyen un ensayo físico de la cinta.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {LabState} from '../app/lab-state.ts';
import {parseTelemetry} from '../shared/control-protocol.mjs';

const button=(html,label)=>html.match(new RegExp('<button[^>]*>'+label+'</button>'))?.[0]??'';

test('una sola interfaz, un mando, visor y todos los paneles; sin lateral heredado',async()=>{
  // Render component markup only, with no browser, HTTP listener or WebGL.
  const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{middlewareMode:true,hmr:false},logLevel:'error'});
  try{
    const module=await vite.ssrLoadModule('/app/control-dashboard.tsx');
    const html=renderToStaticMarkup(createElement(module.default));
    for(const name of ['Gemelo digital','Mando de la cinta','Sensores y modelo TS de orden 1','Tiny IA · calidad de señal','Tiempo real y recursos','Eventos por objeto','Informe del arranque actual','Cálculos del laboratorio'])assert.ok(html.includes('>'+name+'<'),name);
    for(const name of ['Adelante','Reversa','Detener','Paro y enclavamiento']){
      assert.equal((html.match(new RegExp('>'+name+'</button>','g'))||[]).length,1,name);
      assert.match(button(html,name),/disabled=""/);
    }
    assert.equal((html.match(/<main /g)||[]).length,1);
    assert.equal((html.match(/<h1>/g)||[]).length,1);
    assert.equal((html.match(/id="visor"/g)||[]).length,1);
    assert.match(html,/Clasificación automática/);
    assert.match(html,/<input type="checkbox" disabled=""/); // No habilitar marcha sin ESP32.
    assert.doesNotMatch(html,/<aside|Material de la base|Medidas de la base|Componentes|Sentido 1|Sentido 2|animación local|Volver al 3D/);
    assert.doesNotMatch(html,/PID|G\(s\)|plant-equation|modelo-title/);
    assert.doesNotMatch(html,/Probar empuje|Solo mueve el modelo 3D/);
    assert.match(html,/ángulo ordenado por la ESP32/);
    assert.ok(html.indexOf('>Adelante</button>')<html.indexOf('>Detener</button>'));
    assert.ok(html.indexOf('>Detener</button>')<html.indexOf('>Reversa</button>'));
    assert.doesNotMatch(html,/Velocidad inicial \(%\)|Velocidad mínima \(%\)|Velocidad máxima \(%\)/);
    assert.match(html,/TS orden 1/);
    assert.doesNotMatch(html,/Registro de eventos|Conexión WebSocket de la ESP32|websocket-help|class="registro"|Consultar estado|IP_DE_TU_PC/);
    assert.match(html,/Distancia directa del sensor; corrección inicial: 0 cm/);
    assert.equal((html.match(/class="trend"/g)||[]).length,2);
    assert.equal((html.match(/type="checkbox"/g)||[]).length,2); // Clasificación y cuadrícula.
    for(const label of ['Acercar','Alejar','Encuadrar conjunto','Restablecer vista','Mostrar cuadrícula'])assert.ok(html.includes('aria-label="'+label+'"'),label);

    const state=new LabState(()=>0);state.setBridge(true);state.setLink(true,'device');
    const render=()=>renderToStaticMarkup(createElement(module.Dashboard,{state:state.snapshot(),send:()=>{},setFault:()=>{}}));
    state.ingest(parseTelemetry('DIR=REV,V=65,M=16,RPM_M=97.5,RPM_R=46.3,VEL_R=7.2,STATE=OK'));
    const moving=render();
    assert.match(button(moving,'Reversa'),/aria-pressed="true"/);
    assert.match(button(moving,'Adelante'),/aria-pressed="false"/);
    assert.match(moving,/<input[^>]*id="lab-velocity"[^>]*value="65"/);
    assert.match(moving,/<option value="16" selected="">1\/16/);
    assert.match(moving,/<select[^>]*id="lab-micro"[^>]*disabled=""/);
    state.command({type:'command',id:'stop',command:'E',status:'queued',response:'E',latencyMs:null});
    assert.match(button(render(),'Detener'),/aria-pressed="true"/);
    state.ingest(parseTelemetry('DIR=STOP,V=25,M=4,RPM_M=0,RPM_R=0,VEL_R=0,STATE=OK'));
    state.command({type:'command',id:'stop',command:'E',status:'ack',response:'E',latencyMs:null});
    const stopped=render();
    assert.match(button(stopped,'Detener'),/aria-pressed="true"/);
    assert.match(stopped,/<input[^>]*id="lab-velocity"[^>]*value="25"/);
    assert.match(stopped,/<option value="4" selected="">1\/4/);
    assert.doesNotMatch(stopped,/<select[^>]*disabled=""/);
    state.setLink(false,null);
    const offline=render();
    for(const name of ['Adelante','Reversa','Detener'])assert.match(button(offline,name),/aria-pressed="false"/);

  }finally{await vite.close();}
});
