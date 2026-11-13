import {useCallback,useEffect,useRef,useState} from 'react';
import {clientId} from './client-id';
import {Lab03Motion,stoppedMotion} from './lab03-motion';
import type {PieceKind} from './piece-models';

export type Snapshot={estado:string;automatico:boolean;emergencia:boolean;ensayo:boolean;capturando:boolean;
  rpm_motor:number|null;rpm_ts:number;setpoint_rpm:number;dist_cm:number|null;pos_m:number|null;
  step_hz:number;servo_us:number;servo_grados:number;direccion:-1|0|1;porcentaje:number;metal:boolean;
  encoder_valido:boolean;encoder_rechazados:number;objeto:number;control_exec_us:number;control_late_us:number;
  control_missed:number;heap_min:number;stack_min:number;dropped_ia:number;dropped_events:number;coalesced:number};
export type IA={object_id:number;activa:boolean;clase:number;voto:number;dudosa:boolean;inferencia_us:number;manual:boolean};
export type Envelope<T>={v:number;device_id:string;boot_id:string;seq:number;t_us:number;kind:string;data:T};
export type Point={at:number;rpm:number|null;ts:number;cm:number|null};
export type Alarm={codigo:string;object_id?:number;at:number};
export type Report={mensajes:number;ciclos_finalizados?:number;ciclo_s?:{min:number|null;max:number|null;media:number|null};
  decisiones?:Record<string,number>;tasas_por_arranque?:{objetos_min:number|null}[];
  propiedades?:{object_id:number;propiedad:string;latencia_us:number|null;deadline_us:number|null;resultado:string}[];
  propiedades_total?:number;limitacion?:string};

export function useLab03(){
  const socket=useRef<WebSocket|null>(null);
  const [server,setServer]=useState(false),[device,setDevice]=useState(false);
  const [snapshot,setSnapshot]=useState<Envelope<Snapshot>|null>(null);
  const [motion,setMotion]=useState(stoppedMotion);
  const [piece,setPiece]=useState<PieceKind|null>(null);
  const [ia,setIA]=useState<Envelope<IA>|null>(null);
  const [received,setReceived]=useState(0),[now,setNow]=useState(Date.now());
  const [history,setHistory]=useState<Point[]>([]),[alarms,setAlarms]=useState<Alarm[]>([]);
  const [events,setEvents]=useState<{at:number;name:string;object_id:number}[]>([]);
  const [report,setReport]=useState<Report|null>(null);
  const [calculation,setCalculation]=useState<{calculo:string;data:Record<string,number|boolean|null>}|null>(null);
  const [pending,setPending]=useState(0),[notice,setNotice]=useState('Esperando conexión con el servidor.');
  const requests=useRef(new Map<string,number>());
  const fresh=server&&device&&received>0&&now-received<1200;

  useEffect(()=>{
    let active=true,retry:ReturnType<typeof setTimeout>;
    let current:WebSocket|null=null, session='',lastSeq=0;
    const observer=new Lab03Motion();
    const clearPending=()=>{requests.current.clear();setPending(0);};
    function accept(m:Envelope<Snapshot|IA|{name:string;object_id:number}>, bootstrap=false){
      if(m.v!==1||!m.data||!m.boot_id||!Number.isFinite(m.seq))return;
      const key=m.device_id+':'+m.boot_id;
      if(key!==session){session=key;lastSeq=0;observer.reset();setMotion(stoppedMotion());setHistory([]);setEvents([]);setAlarms([]);setIA(null);setSnapshot(null);setReport(null);}
      if(!bootstrap&&m.seq<=lastSeq)return;
      lastSeq=Math.max(lastSeq,m.seq);
      const at=Date.now();
      if(m.kind==='snapshot'){
        const e=m as Envelope<Snapshot>;setSnapshot(e);
        // Un estado de bienvenida puede ser antiguo: esperar una muestra viva.
        if(!bootstrap){setMotion(observer.observe(e.data,at));setReceived(at);setDevice(true);setHistory(h=>[...h.filter(p=>at-p.at<60000),
          {at,rpm:e.data.encoder_valido?e.data.rpm_motor:null,ts:e.data.rpm_ts,cm:e.data.dist_cm}].slice(-620));}
      }else if(m.kind==='ia')setIA(m as Envelope<IA>);
      else if(m.kind==='event'){
        const d=m.data as {name:string;object_id:number};setEvents(e=>[{...d,at},...e].slice(0,30));
      }
    }
    function connect(){
      if(!active)return;
      const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws/ui`);
      socket.current=current=ws;
      ws.onopen=()=>{if(!active)return;setServer(true);setNotice('Servidor conectado; esperando telemetría de la ESP32.');ws.send(JSON.stringify({type:'heartbeat'}));};
      ws.onmessage=event=>{
        if(!active)return;
        try{
          const m=JSON.parse(event.data);
          if(m.type==='welcome'){
            setDevice(Boolean(m.connected));if(m.snapshot)accept(m.snapshot,true);if(m.ia)accept(m.ia,true);
            setPiece(m.pieza==='lata'||m.pieza==='caja'?m.pieza:null);
            setAlarms((m.alarms||[]).map((a:Alarm)=>({...a,at:Date.now()})).reverse());
          }else if(m.type==='link'){
            setDevice(Boolean(m.connected));
            if(!m.connected){observer.reset();setMotion(stoppedMotion());setReceived(0);}
          }
          else if(m.type==='telemetry'){
            accept(m.message);setPiece(m.pieza==='lata'||m.pieza==='caja'?m.pieza:null);
          }
          else if(m.type==='alarm')setAlarms(a=>[{codigo:m.codigo,object_id:m.object_id,at:Date.now()},...a].slice(0,40));
          else if(m.type==='command_result'){
            requests.current.delete(m.request_id);setPending(requests.current.size);
            setNotice(`${m.applied?'ESP32 confirmó':'Orden no confirmada'}${m.action?' '+m.action:''}: ${m.reason}.`);
          }else if(m.type==='report')setReport(m.data);
          else if(m.type==='calculation')setCalculation(m);
          else if(m.type==='error')setNotice(m.message);
        }catch{setNotice('Se recibió un mensaje inválido.');}
      };
      ws.onerror=()=>ws.close();
      ws.onclose=()=>{if(!active)return;setServer(false);setDevice(false);setReceived(0);clearPending();
        observer.reset();setMotion(stoppedMotion());
        setNotice('Conexión perdida. Las órdenes pendientes no se reenvían.');retry=setTimeout(connect,1500);};
    }
    connect();
    const timer=setInterval(()=>{
      const t=Date.now();setNow(t);
      if(current?.readyState===WebSocket.OPEN)current.send(JSON.stringify({type:'heartbeat'}));
      if([...requests.current.values()].some(at=>t-at>3000)){
        clearPending();setNotice('La orden no recibió confirmación; reconectando.');current?.close();
      }
    },500);
    return()=>{active=false;clearTimeout(retry);clearInterval(timer);current?.close();socket.current=null;};
  },[]);
  const request=useCallback((m:object)=>{
    if(socket.current?.readyState!==WebSocket.OPEN){setNotice('Servidor desconectado.');return false;}
    socket.current.send(JSON.stringify(m));return true;
  },[]);
  const command=(action:string,value?:number)=>{
    if(!fresh){setNotice('Se necesita telemetría reciente para enviar órdenes.');return;}
    const id=clientId();
    if(request({type:'command',request_id:id,action,value})){
      requests.current.set(id,Date.now());setPending(requests.current.size);setNotice(`Orden ${action} enviada; esperando a la ESP32…`);
    }
  };
  return {server,fresh,snapshot,motion,piece,ia,history,alarms,events,now,pending,notice,report,calculation,command,request};
}
