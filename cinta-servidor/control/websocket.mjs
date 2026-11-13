/**
 * Coordinador de comunicación y actuación. /ws/esp32 admite un dispositivo;
 * /ws/ui distribuye el mismo estado a todos los navegadores. Cada telemetría
 * válida pasa por calibración, observación del controlador, CSV y difusión.
 * Las órdenes F/R/S/E/V/M conservan el protocolo ASCII del firmware.
 * Los ACK, caducidades y sesiones impiden reintentos de movimiento obsoletos.
 */
import {FaultSimulation} from './faults.mjs';
import {ConveyorObserver} from './motion.mjs';
import {calibrateTelemetry} from './telemetry.mjs';
import {performance} from 'node:perf_hooks';
import {randomUUID} from 'node:crypto';
import {WebSocketServer, WebSocket} from '../vendor/ws/wrapper.mjs';
import {CONTROL, parseTelemetry, normalizeCommand, canChangeMicrostep, matchReply} from '../shared/control-protocol.mjs';

// Additive transport: attaches only upgrade handling to the existing HTTP server.
/* Adjunta WebSocket al servidor HTTP existente. options permite inyectar
 * un reloj y un registrador CSV en pruebas sin cambiar el protocolo de la ESP. */
export function attachControlSocket(server, options={}) {
  const clock=options.clock??(()=>performance.now());
  const controller=new ConveyorObserver();
  const faults=new FaultSimulation();
  let manualBase=null,manualSent=null,manualBlocked=false,manualStopped=false;
  const timeoutMs=options.commandTimeoutMs??CONTROL.commandTimeoutMs;
  const deviceServer=new WebSocketServer({noServer:true,maxPayload:16384,perMessageDeflate:false});
  const uiServer=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});
  let device=null, last=null, lastAt=0, session=null, lastMotionAt=-Infinity;
  let motionPollUntil=-Infinity,statusPollAt=-Infinity,statusPollPending=false;
  /* Solicita una ventana breve de consultas STATUS rápidas después de un mando
   * o cambio nativo; reduce la latencia visual sin cambiar el muestreo del encoder. */
  const followMotion=()=>{
    const now=clock();
    if(now>=motionPollUntil)statusPollAt=now; // Let the native 20 ms motor task run first.
    motionPollUntil=now+2*CONTROL.encoderSampleMs+250;
  };
  /* Limita consultas de estado y evita acumular solicitudes simultáneas. */
  const pollMotion=()=>{
    const now=clock();
    if(!device||device.readyState!==WebSocket.OPEN||now>=motionPollUntil||
      now-statusPollAt<CONTROL.motionPollMs||statusPollPending&&now-statusPollAt<250)return;
    // Read-only query already supported by the ESP. At most one outstanding
    // poll, bounded rate, no command/ACK record, no motion replay on reconnect.
    statusPollAt=now;statusPollPending=true;device.send('STATUS\n');
  };
  let pending=[];
  const recentReplies=[];
  const events=[];
  /* Evita que un cliente web lento acumule memoria indefinidamente. */
  const send=(socket,value)=>{
    if (socket.readyState!==WebSocket.OPEN) return;
    if (socket.bufferedAmount>256*1024) {socket.terminate();return;}
    socket.send(JSON.stringify(value));
  };
  const broadcast=value=>{for (const socket of uiServer.clients) send(socket,value);};
  const event=(text,kind='info')=>{
    const record={id:randomUUID(),at:Date.now(),text,kind};
    events.push(record);if(events.length>80)events.shift();
    broadcast({type:'event',event:record});
  };
  const publishFaults=()=>broadcast({type:'faults',state:faults.snapshot()});
  const link=()=>({type:'link',connected:Boolean(device),session});
  /* Difunde el ciclo de vida del comando y conserva respuestas recientes
   * para no interpretar ACK tardíos como mandos locales nuevos. */
  const result=(entry,status,response,latencyMs=null)=>{
    if(status!=='sent'){
      recentReplies.push({command:entry.command,at:clock()});
      while(recentReplies.length>64||recentReplies[0]&&clock()-recentReplies[0].at>2*timeoutMs)recentReplies.shift();
    }
    broadcast({type:'command',id:entry.id,command:entry.command,status,response,latencyMs,source:entry.source??'web'});
    if(status!=='sent') event(response,status==='ack'?'resp':status==='cancelled'?'info':'alarma');
  };
  const cancelPending=reason=>{for(const entry of pending)result(entry,'cancelled',reason+' · '+entry.command);pending=[];};
  const publishController=()=>broadcast({type:'controller',state:controller.snapshot()});
  /* Punto común de envío y validación. Aplica reducciones físicas en modo manual,
   * respeta la parada prioritaria y registra el comando real que viaja a la ESP. */
  const issueCommand=(command,id,source='web',requester=null)=>{
    const original=command;
    if(source==='web'&&/^V\d+$/.test(command))command='V'+faults.command(Number(command.slice(1)),clock());
    const entry={id,command,sentAt:clock(),source};
    const reject=reason=>{
      if(requester)send(requester,{type:'command',id,command,status:'rejected',response:reason,latencyMs:null,source});
      event(reason,'alarma');return false;
    };
    if(!device||device.readyState!==WebSocket.OPEN)return reject('Sin conexión: '+command+' no se envió');
    if(pending.some(item=>item.id===id))return reject('La orden ya está pendiente');
    if(command.startsWith('M')&&(!canChangeMicrostep(last,clock()-lastAt)||lastAt<lastMotionAt||pending.some(item=>['F','R'].includes(item.command))))return reject('El micropaso solo cambia con telemetría reciente y el motor detenido.');
    if(command==='E'||command==='S'){
      manualBlocked=true;manualStopped=true;
      cancelPending('Orden sustituida por '+command);
    }
    if(pending.length>=32)return reject('Hay demasiadas órdenes sin confirmar.');
    if(source==='web'){
      if(/^V\d+$/.test(original)){manualBase=Number(original.slice(1));manualBlocked=false;if(manualBase===0)manualStopped=true;}
      if(command==='F'||command==='R'){
        manualBlocked=false;manualStopped=false;manualBase??=last?.v??50;
        const value=faults.command(manualBase,clock());
        if(value!==(manualSent??last?.v)&&!issueCommand('V'+value,randomUUID(),'fault',requester))return false;
      }
    }
    if(/^V\d+$/.test(command))manualSent=Number(command.slice(1));
    pending.push(entry);
    if(['F','R','S','E'].includes(command))lastMotionAt=entry.sentAt;
    if((source==='web'||source==='fault')&&command!=='STATUS'&&/^[FRSEV]/.test(command)){
      controller.manual(command,clock());publishController();
    }
    result(entry,'sent','Enviado '+command+'; esperando respuesta');
    device.send(command+'\n',error=>{
      if(!error)return;
      pending=pending.filter(item=>item!==entry);result(entry,'rejected','No se pudo enviar '+command);
      if(source==='fault')manualBlocked=true;
    });
    if(/^[FRSEV]/.test(command))followMotion();
    event('Enviado '+command,'cmd');
    return true;
  };
  /* Aplica unicamente las reducciones de fallas solicitadas por el usuario. */
  const pump=()=>{
    if(!manualBlocked&&!manualStopped&&device&&last&&clock()-lastAt<=CONTROL.staleMs&&
      last.dir!=='STOP'&&last.rpm_m>0&&manualBase!==null&&!pending.some(entry=>entry.command!=='STATUS')){
      const value=faults.command(manualBase,clock());
      if(value!==(manualSent??last.v))issueCommand('V'+value,randomUUID(),'fault');
    }
  };
  const rejectUpgrade=(socket,status,text)=>{socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);};
  /* Acepta exclusivamente las rutas WebSocket previstas, verifica el origen
   * cuando está presente y rechaza una segunda ESP32 simultánea. */
  const upgrade=(request,socket,head)=>{
    let url;
    try {url=new URL(request.url,'http://localhost');} catch {rejectUpgrade(socket,400,'Bad Request');return;}
    if (request.headers.origin) {
      try {if(new URL(request.headers.origin).host!==request.headers.host)throw Error();}
      catch {rejectUpgrade(socket,403,'Forbidden');return;}
    }
    if (url.pathname==='/ws/esp32') {
      if(device){rejectUpgrade(socket,409,'Device Already Connected');return;}
      deviceServer.handleUpgrade(request,socket,head,ws=>deviceServer.emit('connection',ws));
    } else if (url.pathname==='/ws/ui') {
      uiServer.handleUpgrade(request,socket,head,ws=>uiServer.emit('connection',ws));
    } else rejectUpgrade(socket,404,'Not Found');
  };
  server.on('upgrade',upgrade);

  /* Inicia una nueva sesión de dispositivo y consulta STATUS sin reproducir
   * órdenes guardadas. Cada línea recibida es telemetría, respuesta o diagnóstico. */
  deviceServer.on('connection',socket=>{
    device=socket;last=null;lastAt=0;lastMotionAt=-Infinity;session=randomUUID();
    motionPollUntil=-Infinity;statusPollAt=-Infinity;statusPollPending=false;
    controller.reset(clock());manualBase=null;manualSent=null;manualBlocked=false;manualStopped=false;faults.reset();publishFaults();
    recentReplies.length=0;
    socket.isAlive=true;socket.on('pong',()=>{socket.isAlive=true;});
    broadcast(link());publishController();event('ESP32 conectada','ok');
    // Consultar el estado sin reproducir comandos de una sesion anterior.
    socket.send('STATUS\n');
    socket.on('message',(bytes,binary)=>{
      if(binary){event('La ESP32 envió una trama binaria; se espera texto.','alarma');return;}
      for(const line of bytes.toString('utf8').split(/\r?\n/).map(line=>line.trim()).filter(Boolean)) {
        const telemetry=calibrateTelemetry(parseTelemetry(line));
        /* Secuencia de adquisición: calibración ya aplicada, observación del controlador,
         * registro CSV y difusión del mismo par medición/modelo; después se evalúa actuar. */
        if(telemetry){
          statusPollPending=false;
          if(telemetry.state==='RAMP'||last&&(telemetry.dir!==last.dir||telemetry.rpm_m!==last.rpm_m))followMotion();
          {
            manualBase??=telemetry.v;
            if(clock()-controller.motion.commandAt>=500&&!pending.some(entry=>entry.command!=='STATUS')&&telemetry.state!=='RAMP')manualStopped=telemetry.dir==='STOP';
            if(clock()-controller.motion.commandAt>=500&&!pending.some(entry=>entry.command!=='STATUS')&&telemetry.v!==manualSent){
              manualBase=telemetry.v;manualSent=telemetry.v;
            }
          }
          last=telemetry;lastAt=clock();
          controller.observe(telemetry,lastAt);
          const frame={type:'telemetry',data:telemetry,controller:controller.snapshot(),at:Date.now(),timeMs:lastAt,session};
          options.speedCsv?.record(frame);
          broadcast(frame);
          const requests=pending.filter(entry=>entry.command==='STATUS');
          pending=pending.filter(entry=>entry.command!=='STATUS');
          // A streaming telemetry frame has no request ID, so it cannot give
          // an unambiguous STATUS round-trip latency. Do not invent one.
          for(const entry of requests)result(entry,'ack','Estado recibido');
          pump();continue;
        }
        const index=pending.findIndex(entry=>matchReply(entry.command,line)!==null);
        if(index!==-1){
          const [entry]=pending.splice(index,1);
          const status=matchReply(entry.command,line);
          result(entry,status,'ESP32: '+line,clock()-entry.sentAt);
          if(entry.source==='fault'&&status==='rejected')manualBlocked=true;
        } else if(recentReplies.some(entry=>clock()-entry.at<=2*timeoutMs&&matchReply(entry.command,line)!==null)){
          // Native replies have no IDs. Ignore late/duplicate acknowledgments
          // instead of interpreting them as a new local hardware command.
        }
        else if(line.startsWith('DIR=') || line.startsWith('{'))event('Telemetría inválida descartada','alarma');
        else if(/error|invalido|inválido/i.test(line))event('ESP32: '+line.slice(0,300),'alarma');
      }
    });
    socket.on('error',error=>event('Error del enlace ESP32: '+error.message,'alarma'));
    socket.on('close',()=>{
      if(device!==socket)return;
      device=null;last=null;lastAt=0;
      controller.reset(clock());manualBase=null;manualSent=null;manualBlocked=false;manualStopped=false;faults.reset();publishFaults();
      cancelPending('Enlace cerrado, orden sin confirmar');
      broadcast(link());publishController();event('ESP32 desconectada','alarma');
    });
  });

  /* Entrega snapshot a clientes nuevos y recibe solicitudes de mando y fallas.
   * La simulación es compartida por el servidor, no un estado aislado por pestaña. */
  uiServer.on('connection',socket=>{
    socket.isAlive=true;socket.on('pong',()=>{socket.isAlive=true;});
    controller.advance(clock());
    send(socket,{type:'snapshot',link:link(),events,clockMs:clock(),faults:faults.snapshot(),controller:controller.snapshot(),last:last?{data:last,timeMs:lastAt,ageMs:clock()-lastAt,session}:null});
    socket.on('message',(bytes,binary)=>{
      let message;
      try {message=JSON.parse(bytes.toString('utf8'));} catch {return;}
      if(binary||!message||typeof message.id!=='string'||!(/^[\w-]{1,80}$/).test(message.id))return;
      if(message.type==='fault'){
        try{
          if(!device||!last||clock()-lastAt>CONTROL.staleMs)throw Error('La simulación requiere telemetría reciente.');
          faults.set(message.key,message.enabled,clock());manualBlocked=false;
          publishFaults();pump();
          send(socket,{type:'fault-result',id:message.id,status:'ack',response:'Simulación actualizada.'});
        }catch(error){send(socket,{type:'fault-result',id:message.id,status:'rejected',response:error.message});}
        return;
      }
      if(message.type!=='command')return;
      const command=normalizeCommand(message.command);
      if(!command){send(socket,{type:'command',id:message.id,command:String(message.command).slice(0,24),status:'rejected',response:'Comando inválido',latencyMs:null});return;}
      issueCommand(command,message.id,'web',socket);
    });
    socket.on('error',()=>{});
  });

  /* Ciclo de servicio de 25 ms: caducidades de comandos, control y consultas
   * de movimiento. No se calcula una salida automatica en el servidor. */
  const timer=setInterval(()=>{
    const expired=pending.filter(entry=>clock()-entry.sentAt>=timeoutMs);
    pending=pending.filter(entry=>clock()-entry.sentAt<timeoutMs);
    for(const entry of expired){
      result(entry,'timeout','Sin respuesta para '+entry.command+'; no se reenvía');
      if(entry.source==='fault')manualBlocked=true;
    }
    pump();pollMotion();
  },25);
  /* Verifica vida de ambos canales mediante ping/pong y cierra enlaces caídos. */
  const heartbeat=setInterval(()=>{
    for(const socket of [...deviceServer.clients,...uiServer.clients]){
      if(!socket.isAlive){socket.terminate();continue;}
      socket.isAlive=false;socket.ping();
    }
  },15000);
  timer.unref();heartbeat.unref();
  return {
    close(){
      clearInterval(timer);clearInterval(heartbeat);server.off('upgrade',upgrade);
      for(const socket of [...deviceServer.clients,...uiServer.clients])socket.terminate();
      deviceServer.close();uiServer.close();
    },
  };
}
