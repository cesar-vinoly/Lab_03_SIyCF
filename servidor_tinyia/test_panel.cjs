// Prueba la logica real del panel con DOM y fetch simulados, sin navegador ni red.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, 'panel.html'), 'utf8');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
const source = html.split('<script>')[1].split('</script>')[0]
  .replace('actualizar();setInterval(actualizar,3000);', '')
  .replace('iniciarSondeoEnsayos();', '');

function nodo() {
  return {textContent:'',className:'',hidden:true,value:'',children:[],
    append(...items){this.children.push(...items)},
    replaceChildren(...items){this.children=items},setAttribute(){}};
}
function entorno(protocol='http:') {
  const elementos = Object.fromEntries(ids.map(id => [id,nodo()]));
  const context = vm.createContext({
    document:{getElementById:id=>{assert.ok(id in elementos, 'ID inexistente: '+id);return elementos[id]},
      createElement:nodo,createElementNS:nodo},
    location:{protocol,origin:'http://127.0.0.1:8000'},
    AbortController,setTimeout,clearTimeout,setInterval(){},URL,confirm:()=>false,
    fetch:async()=>{throw new TypeError('Failed to fetch')}
  });
  vm.runInContext(source,context);
  return {context,elementos};
}

(async()=>{
  const {context,elementos}=entorno();
  await context.actualizar();
  assert.match(elementos.status.textContent,/No se pudo conectar/);
  assert.equal(elementos.status.className,'error');
  assert.equal(elementos.ayudaConexion.hidden,false);
  // Al regresar el servidor, el proximo refresco recupera el panel.
  context.fetch=async(ruta,options)=>{
    assert.equal(options.cache,'no-store');
    return {ok:true,json:async()=>ruta==='/api/resumen'
      ?{total:1,clases:{'':1},ultima:'2026-11-08T00:00:00Z'}
      :[{id:1,cycle_id:7,recibida:'2026-11-08T00:00:00Z',etiqueta:'',pieza_id:'',no_apta:'',payload:{metal:false,samples:Array(10).fill({})}}]};
  };
  await context.actualizar();
  assert.equal(elementos.status.className,'');
  assert.equal(elementos.ayudaConexion.hidden,true);
  assert.equal(elementos.filas.children.length,1);
  console.log('OK: desconexion, ayuda visible y recuperacion con capturas.');

  const local=entorno('file:');
  let peticiones=0;
  local.context.fetch=async()=>{peticiones++;throw Error('No deberia pedir un archivo local')};
  await local.context.actualizar();
  assert.equal(peticiones,0);
  assert.match(local.elementos.status.textContent,/archivo HTML directamente/);
  console.log('OK: HTML abierto como archivo indica la URL correcta.');

  context.fetch=async()=>({ok:false,status:503,json:async()=>({error:'Servicio no disponible'})});
  await assert.rejects(()=>context.api('/api/resumen'),/Servicio no disponible/);
  console.log('OK: errores HTTP conservan el mensaje del servidor.');

  const timeout=entorno();
  timeout.context.setTimeout=fn=>{queueMicrotask(fn);return 1};
  timeout.context.clearTimeout=()=>{};
  timeout.context.fetch=async(_,options)=>new Promise((resolve,reject)=>{
    options.signal.addEventListener('abort',()=>{const e=Error();e.name='AbortError';reject(e)});
  });
  await assert.rejects(()=>timeout.context.api('/api/resumen'),/no respondió en 8 segundos/);
  console.log('OK: una peticion sin respuesta vence y permite reintentar.');

  const borrado=entorno();
  vm.runInContext('actual={id:7,cycle_id:23};seleccion=7;',borrado.context);
  borrado.elementos.detalle.hidden=false;
  const solicitudes=[];
  borrado.context.fetch=async(ruta,options)=>{
    solicitudes.push([ruta,options.method||'GET']);
    return {ok:true,json:async()=>ruta==='/api/resumen'?{total:0,clases:{},ultima:null}:[]};
  };
  await borrado.context.eliminarSeleccionada();
  assert.equal(solicitudes.length,0);
  assert.equal(borrado.elementos.detalle.hidden,false);
  borrado.context.confirm=mensaje=>{assert.match(mensaje,/captura 7 \(ciclo 23\)/);return true};
  await borrado.context.eliminarSeleccionada();
  assert.deepEqual(solicitudes.filter(([,method])=>method==='DELETE'),[['/api/capturas/7','DELETE']]);
  assert.equal(borrado.elementos.detalle.hidden,true);
  assert.equal(borrado.elementos.eliminar.disabled,false);
  assert.match(borrado.elementos.status.textContent,/Captura 7 eliminada/);
  const fallo=entorno();
  vm.runInContext('actual={id:8,cycle_id:24};seleccion=8;',fallo.context);
  fallo.elementos.detalle.hidden=false;
  fallo.context.confirm=()=>true;
  await fallo.context.eliminarSeleccionada();
  assert.equal(fallo.elementos.detalle.hidden,false);
  assert.equal(fallo.elementos.eliminar.disabled,false);
  assert.match(fallo.elementos.status.textContent,/No se pudo conectar/);
  assert.equal(vm.runInContext('seleccion',fallo.context),8);
  console.log('OK: cancelar no borra; confirmar elimina solo la elegida; fallos conservan la seleccion.');

  const ensayo=entorno();
  let placa={device_id:'esp1',boot_id:'boot1',conectada:true,deseado:false,manual:false,
    lista:false,ocupada:false,pendiente:false,orden:0,restante_ms:0,registro_total_ms:10000,registro_restante_ms:0};
  const ordenes=[];
  ensayo.context.fetch=async(ruta,options)=>{
    if(ruta==='/health')return {ok:true,json:async()=>({ok:true,ensayo_max_preparacion_ms:60000,ensayo_bloques_version:1,feature_version:2,muestras_por_prueba:100})};
    if(options.method==='POST')ordenes.push(JSON.parse(options.body));
    return {ok:true,json:async()=>options.method==='POST'?{ok:true}:[placa]};
  };
  await ensayo.context.actualizarEnsayos();
  assert.equal(ensayo.elementos.modoManual.disabled,false);
  assert.equal(ensayo.elementos.iniciarEnsayo.disabled,true);
  placa={...placa,deseado:true};
  await ensayo.context.actualizarEnsayos();
  assert.equal(ensayo.elementos.iniciarEnsayo.disabled,true);
  assert.match(ensayo.elementos.estadoEnsayo.textContent,/Esperando confirmación/);
  placa={...placa,manual:true,lista:true};
  await ensayo.context.actualizarEnsayos();
  assert.equal(ensayo.elementos.iniciarEnsayo.disabled,false);
  await ensayo.context.ordenarEnsayo('capturar');
  assert.deepEqual(ordenes,[{device_id:'esp1',boot_id:'boot1',accion:'capturar'}]);
  placa={...placa,ocupada:true,lista:false,restante_ms:9300,orden:1};
  await ensayo.context.actualizarEnsayos();
  assert.equal(ensayo.elementos.iniciarEnsayo.disabled,true);
  assert.equal(ensayo.elementos.modoAutomatico.disabled,true);
  assert.match(ensayo.elementos.estadoEnsayo.textContent,/9.3 s/);
  placa={...placa,restante_ms:0,registro_restante_ms:7000};
  await ensayo.context.actualizarEnsayos();
  assert.match(ensayo.elementos.estadoEnsayo.textContent,/Registrando: quedan 7.0 s de 10 s/);
  assert.equal(ensayo.elementos.iniciarEnsayo.disabled,true);
  placa={...placa,conectada:false};
  await ensayo.context.actualizarEnsayos();
  assert.equal(ensayo.elementos.iniciarEnsayo.disabled,true);
  assert.match(ensayo.elementos.estadoEnsayo.textContent,/sin conexión reciente/);
  console.log('OK: ensayo espera confirmacion, dirige orden a la placa y bloquea captura ocupada/desconectada.');

  const antiguo=entorno();
  antiguo.context.fetch=async()=>({ok:true,json:async()=>({ok:true,schema_version:1})});
  await antiguo.context.actualizarEnsayos();
  assert.match(antiguo.elementos.estadoEnsayo.textContent,/versión anterior/);
  assert.equal(antiguo.elementos.iniciarEnsayo.disabled,true);
  antiguo.context.fetch=async(ruta)=>({ok:true,json:async()=>ruta==='/health'
    ?{ok:true,ensayo_max_preparacion_ms:60000,ensayo_bloques_version:1,feature_version:2,muestras_por_prueba:100}
    :[{...placa,conectada:true,ocupada:false,lista:true,restante_ms:0}]});
  await antiguo.context.actualizarEnsayos();
  assert.equal(antiguo.elementos.iniciarEnsayo.disabled,false);
  console.log('OK: servidor antiguo se identifica y el panel recupera al reiniciarlo.');

  placa={...placa,conectada:true,ocupada:false,lista:true,registro_total_ms:0};
  await ensayo.context.actualizarEnsayos();
  assert.equal(ensayo.elementos.iniciarEnsayo.disabled,true);
  assert.match(ensayo.elementos.estadoEnsayo.textContent,/firmware de captura corta/);
  const sesion=entorno();
  let prueba={id:1,cycle_id:1,no_apta:'',etiqueta:'',pieza_id:'',material:'',notas:'',
    payload:{device_id:'esp1',boot_id:'boot1',firmware:'cinta-ia-3',feature_version:2,origen:'manual',orden_manual:1,cancelada:false,
      samples:Array.from({length:100},(_,j)=>({t_ms:10000+j*100,dist_cm:j<50?5:null,inductivo:true}))}};
  sesion.context.fetch=async()=>({ok:true,json:async()=>[prueba]});
  await sesion.context.verPruebaCompleta('esp1','boot1',1);
  assert.equal(sesion.elementos.detalle.hidden,false);
  assert.match(sesion.elementos.contexto.textContent,/100 muestras \/ 10 s \/ una etiqueta/);
  assert.equal(sesion.elementos.guardar.disabled,false);
  assert.equal(vm.runInContext('actual.payload.samples.length',sesion.context),100);
  sesion.context.mostrar({...prueba,advertencias:['Encoder: 2 lecturas superan 180 RPM.']});
  assert.equal(sesion.elementos.advertencias.hidden,false);
  assert.match(sesion.elementos.advertencias.textContent,/Encoder/);
  assert.equal(sesion.elementos.guardar.disabled,false);
  assert.equal(sesion.elementos.etiqueta.value,'');
  sesion.context.mostrar(prueba);
  assert.equal(sesion.elementos.advertencias.hidden,true);
  sesion.context.fetch=async()=>({ok:true,json:async()=>[{...prueba,payload:{...prueba.payload,feature_version:1,samples:prueba.payload.samples.slice(0,10)}}]});
  await sesion.context.verPruebaCompleta('esp1','boot1',1);
  assert.match(sesion.elementos.status.textContent,/todavía no llegó/);
  console.log('OK: una prueba de cien muestras se abre en un solo formulario de etiqueta; no acepta un bloque corto como prueba.');
})().catch(error=>{console.error(error);process.exitCode=1});
