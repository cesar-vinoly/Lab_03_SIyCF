/**
 * Estado de presentación desacoplado del transporte y del renderizador.
 * raw conserva la telemetría recibida; latest permite una copia de posición
 * para deslizamiento. history almacena las curvas con tiempo común.
 * Los mandos provisionales actualizan controles, pero el giro del gemelo
 * se obtiene de la realimentación del servidor y del estado nativo de la ESP32.
 */
import {CONTROL, FAULTS, canChangeMicrostep, validEncoder} from '../shared/control-protocol.mjs';
import type {Telemetry,MotionState} from '../shared/control-protocol.mjs';
import {MotorMotion} from '../shared/motor-motion.mjs';
import {OUTPUT_RATIO} from './transmission.ts';
import type {Motion} from './transmission.ts';

export type Fault = keyof typeof FAULTS;
export type Sample = {at:number; speed:number|null; reference:number|null; position:number|null; simulatedSpeed:number|null; simulatedPosition:number|null; divergence:boolean; simulated:boolean};
export type DisplayTelemetry = Telemetry & {simulated:boolean};
export type CommandResult = {type:'command'; id:string; command:string; status:string; response:string; latencyMs:number|null;source?:'web'|'fault'};
type ControlValues = Pick<Telemetry,'dir'|'v'|'m'>;
type ControlOverrides = {[K in keyof ControlValues]?:{id:string; value:ControlValues[K]; until:number}};
export type SharedControl = Motion & Omit<ControlValues,'dir'> & {
  dir:Telemetry['dir']|null;
  source:'telemetry'|'command'|'unavailable';
};

export class LabState {
  raw:Telemetry|null=null;
  controller:MotionState|null=null;
  private motion=new MotorMotion();
  private confirmedMotion:MotionState['motion']|null=null;
  latest:DisplayTelemetry|null=null;
  lastAt:number|null=null;
  connected=false;
  bridge=false;
  session:string|null=null;
  history:Sample[]=[];
  latencies:number[]=[];
  response='Esperando conexión con la ESP32.';
  pending=new Set<string>();
  faults:Partial<Record<Fault,number>>={};
  divergence=false;
  private stableSince:number|null=null;
  private errorSince:number|null=null;
  private slipAnchor:number|null=null;
  private lastMotionAt=-Infinity;
  private controlOverrides:ControlOverrides={};
  private clock:()=>number;
  constructor(clock=()=>performance.now()){this.clock=clock;}

  /* Invalida mediciones de la sesión anterior y agrega discontinuidad al historial. */
  private resetMeasurement(){
    this.raw=null;this.latest=null;this.lastAt=null;this.stableSince=null;this.errorSince=null;
    this.divergence=false;this.slipAnchor=null;
    // Invalidate presentation when the device session changes.
    this.controlOverrides={};this.pending.clear();this.motion=new MotorMotion();this.confirmedMotion=null;
    this.history.push({at:this.clock(),speed:null,reference:null,position:null,simulatedSpeed:null,simulatedPosition:null,divergence:false,simulated:false});
  }
  /* Concilia presencia del dispositivo y su identificador de sesión. */
  setLink(connected:boolean,session:string|null){
    if(this.session!==session || this.connected!==connected){
      this.resetMeasurement();
      this.response=connected?'ESP32 conectada. Mandos disponibles.':'Esperando conexión con la ESP32.';
    }
    this.connected=connected;this.session=session;
    if(!connected)this.pending.clear();
  }
  /* Distingue perder el servidor de perder únicamente la ESP32. */
  setBridge(connected:boolean){
    this.bridge=connected;
    if(!connected){this.setLink(false,null);this.response='Servidor desconectado. Reintentando conexión.';}
  }
  /* Mantiene la selección confirmada por el servidor; reinicia el ancla visual
   * si cambia la simulación de deslizamiento. */
  setFault(key:Fault,enabled:boolean){
    if(enabled===(this.faults[key]!==undefined))return;
    if(enabled)this.faults[key]=this.clock();else delete this.faults[key];
    if(key==='deslizamiento')this.slipAnchor=null;
  }
  /* Asocia respuesta con id, administra pendientes y revierte previsiones
   * cuando la orden falla. La latencia se calcula solo para respuestas medibles. */
  command(result:CommandResult){
    this.response=result.response;
    const sending=result.status==='queued'||result.status==='sent';
    if(sending){
      // A local request and its server broadcast are the same order. Never
      // apply the broadcast twice or let a late ACK overwrite newer telemetry.
      if(!this.pending.has(result.id)){
        this.previewCommand(result.id,result.command);
        if(['F','R','S','E'].includes(result.command))this.lastMotionAt=this.clock();
      }
      this.pending.add(result.id);
    }else{
      this.pending.delete(result.id);
      if(result.status!=='ack'){
        for(const key of ['dir','v','m'] as const){
          if(this.controlOverrides[key]?.id===result.id){
            delete this.controlOverrides[key];if(key!=='m')this.restoreMotion();
          }
        }
      }
    }
    if(result.latencyMs!==null && Number.isFinite(result.latencyMs)){
      this.latencies.push(result.latencyMs);this.latencies=this.latencies.slice(-10);
    }
  }
  /* Carga el estado de control del backend y transforma sus tiempos al reloj local. */
  setController(value:MotionState,serverOffset=0){
    this.controller=value;
    if(value.motion){
      this.confirmedMotion={...value.motion,timeMs:value.motion.timeMs+serverOffset};
      const provisional=this.controlOverrides.dir||this.controlOverrides.v;
      if(!provisional||value.motion.targetRpm===this.motion.targetRpm){
        this.motion.load(this.confirmedMotion,this.clock());
      }
    }
  }
  /* Representa una orden pendiente en los controles, sin usarla para girar el CAD. */
  private previewCommand(id:string,command:string){
    const until=this.clock()+CONTROL.commandTimeoutMs;
    if(['F','R','S','E'].includes(command)){
      this.controlOverrides.dir={id,until,value:command==='F'?'FWD':command==='R'?'REV':'STOP'};
    }else if(/^V(?:100|[1-9]?\d)$/.test(command)){
      this.controlOverrides.v={id,until,value:Number(command.slice(1))};
    }else if(/^M(?:2|4|8|16)$/.test(command)){
      this.controlOverrides.m={id,until,value:Number(command.slice(1))};
    }
    if(command!=='STATUS'&&/^[FRSEV]/.test(command)){
      const dir=this.controlOverrides.dir?.value??(this.motion.requestedDirection>0?'FWD':this.motion.requestedDirection<0?'REV':'STOP');
      const v=this.controlOverrides.v?.value??this.controller?.commandPercent??this.raw?.v??50;
      const requested=command==='V0'?0:dir==='FWD'?1:dir==='REV'?-1:0;
      this.motion.target(requested*v,this.clock(),command==='E',requested);
    }
  }
  private restoreMotion(){
    this.motion=new MotorMotion();
    if(this.confirmedMotion)this.motion.load(this.confirmedMotion,this.clock());
    else if(this.raw)this.motion.observe(this.raw,this.clock());
  }
  /* Construye el mando único y la velocidad del visor. Datos vencidos congelan
   * el movimiento; el signo CAD corrige la orientación respecto de FWD/REV. */
  private sharedControl(fresh:boolean,now:number):SharedControl{
    for(const key of ['dir','v','m'] as const){
      if(this.controlOverrides[key] && now>=this.controlOverrides[key]!.until){
        delete this.controlOverrides[key];if(key!=='m')this.restoreMotion();
      }
    }
    if(!fresh || !this.raw){
      this.controlOverrides={};
      return {dir:null,direction:0,v:this.raw?.v??50,m:this.raw?.m??8,driveRpm:0,source:'unavailable'};
    }
    const changes=this.controlOverrides;
    const motion=this.motion.snapshot(now);
    const target=motion.targetRpm;
    const dir=motion.requestedDirection>0?'FWD':motion.requestedDirection<0?'REV':'STOP';
    // No command/ACK preview drives the geometry. The visual observer uses
    // received encoder + native motion state, without generating physical measurements.
    // One server observer also keeps late-joining browsers in the same state.
    const native=validEncoder(this.raw)&&this.raw.rpm_m>0&&this.raw.dir!=='STOP';
    const measuredRpm=this.raw.rpm_r>0&&this.raw.vel_r>0?this.raw.rpm_r/OUTPUT_RATIO:0;
    const driveRpm=native?(this.controller?.feedback?.driveRpm??measuredRpm):0;
    const measured=driveRpm>0;
    return {dir,v:changes.v?.value??this.controller?.commandPercent??this.raw.v,
      m:changes.m?.value??this.raw.m,
      direction:measured?(this.raw.dir==='FWD'?-1:1):0,driveRpm,
      source:Object.keys(changes).length?'command':'telemetry'};
  }

  /* Añade una muestra real y su modelo al historial. La copia visual de
   * deslizamiento no altera raw, el controlador backend ni el CSV. */
  ingest(raw:Telemetry,at=this.clock()){
    if(this.lastAt!==null && at-this.lastAt>CONTROL.staleMs){this.stableSince=null;this.errorSince=null;}
    if(this.raw?.dir!==raw.dir){this.stableSince=null;this.errorSince=null;}
    this.raw={...raw};this.lastAt=at;
    if(!this.controller?.motion)this.motion.observe(raw,at,raw.state==='RAMP');
    // Native state reconciles the mando; the physical feedback observer drives
    // animation independently of command previews and simulated faults.
    this.controlOverrides={};
    const telemetry:DisplayTelemetry={...raw,simulated:this.faults.deslizamiento!==undefined};
    if(this.faults.deslizamiento!==undefined){
      if(telemetry.pos===null)this.slipAnchor=null;
      else {this.slipAnchor??=telemetry.pos;telemetry.pos=this.slipAnchor+.4*(telemetry.pos-this.slipAnchor);}
    }
    const running=telemetry.dir!=='STOP' && telemetry.state!=='RAMP';
    if(running)this.stableSince??=at;else this.stableSince=null;
    const stable=this.stableSince!==null && at-this.stableSince>=CONTROL.settlingMs;
    const condition=stable && telemetry.rpm_t!==null && telemetry.rpm_t>5 && telemetry.err!==null && telemetry.err>CONTROL.speedErrorPct;
    if(condition)this.errorSince??=at;else this.errorSince=null;
    const next=telemetry.state==='DIVERG' || (this.errorSince!==null && at-this.errorSince>=CONTROL.speedPersistenceMs);
    this.divergence=next;this.latest=telemetry;
    this.history.push({at,speed:raw.vel_r,reference:raw.vel_t,position:raw.pos,
      simulatedSpeed:null,simulatedPosition:telemetry.simulated?telemetry.pos:null,
      divergence:next,simulated:telemetry.simulated});
    this.prune(at);
  }
  private prune(now:number){this.history=this.history.filter(sample=>now-sample.at<=CONTROL.historyMs).slice(-CONTROL.historyMax);}
  /* Devuelve una vista del estado, calcula frescura y habilitación de controles
   * y recorta el historial al intervalo de visualización. */
  snapshot(){
    const now=this.clock();this.prune(now);
    const age=this.lastAt===null?null:Math.max(0,now-this.lastAt);
    const fresh=this.connected && age!==null && age<=CONTROL.staleMs;
    if(!fresh){
      this.stableSince=null;this.errorSince=null;
    }
    return {now,age,fresh,connected:this.connected,bridge:this.bridge,raw:this.raw,latest:this.latest,
      control:this.sharedControl(fresh,now),
      divergence:fresh&&this.divergence,settling:this.stableSince!==null&&now-this.stableSince<CONTROL.settlingMs,
      evaluatingSpeed:this.errorSince!==null&&!this.divergence,
      controller:this.controller,history:[...this.history],
      faults:{...this.faults},response:this.response,pending:this.pending.size,
      canMicro:fresh&&canChangeMicrostep(this.raw,age??Infinity)&&this.pending.size===0&&this.lastAt!==null&&this.lastAt>=this.lastMotionAt,
      latency:this.latencies.at(-1)??null,
      averageLatency:this.latencies.length?this.latencies.reduce((a,b)=>a+b,0)/this.latencies.length:null};
  }
}
export type LabSnapshot = ReturnType<LabState['snapshot']>;
