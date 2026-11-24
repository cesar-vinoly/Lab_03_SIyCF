from pathlib import Path
import re
B=Path('cinta-servidor')
def edit(name,fn):
 p=B/name;s=p.read_text(encoding='utf-8');p.write_text(fn(s),encoding='utf-8')
def between(s,start,end,new=''):
 a=s.index(start);b=s.index(end,a);return s[:a]+new+s[b:]

def ws(s):
 s=s.replace("import {ConveyorController} from './pid.mjs';","import {ConveyorObserver} from './motion.mjs';")
 s=s.replace('new ConveyorController()','new ConveyorObserver()').replace('  let pidDrive=null;\n','')
 s=s.replace("&&(entry.source!=='pid'||!['ack','cancelled'].includes(status))",'')
 s=s.replace('&&!controller.enabled','').replace('!controller.enabled&&','')
 s='\n'.join(l for l in s.split('\n') if not ('if(source===\'web\'&&controller.enabled&&![' in l))
 s=between(s,"    if(source==='web'&&controller.enabled&&['F','R'].includes(command)){",'    pending.push(entry);')
 s=s.replace('controller.manual(command,clock());if(controller.enabled)pidDrive=null;publishController();','controller.manual(command,clock());publishController();')
 s=s.replace("      if(source==='pid')failPid('No se pudo enviar el comando PID.');\n",'').replace("if(source!=='pid')event(",'event(')
 s=between(s,'  /* Pausa una salida no confiable','  const pump=()=>{','  /* Aplica unicamente las reducciones de fallas solicitadas por el usuario. */\n')
 s=s.replace('    controller.setSpeedLimit(faults.command(100,clock()));\n','')
 s=between(s,'    const next=controller.tick(', '  const rejectUpgrade=', '  };\n')
 s=s.replace('controller.reset(clock());pidDrive=null;','controller.reset(clock());')
 s=s.replace("    // Read first. An enabled PID resumes only from the new session's feedback;\n    // commands queued in the old connection are never replayed.","    // Consultar el estado sin reproducir comandos de una sesion anterior.")
 s=s.replace('          if(!controller.enabled){','          {')
 s=between(s,'          // A local change takes priority.',"          const frame=")
 s=s.replace('model:controller.lastModel,','')
 s=s.replace("          if(entry.source==='pid'&&status==='rejected')failPid('La ESP32 rechazó el comando PID.');\n",'')
 s=between(s,"        } else if(controller.enabled&&/",'        else if(line.startsWith', '        }\n')
 s=s.replace('mando, PID y fallas','mando y fallas')
 s=s.replace("      if(message.type==='pid'){handlePid(socket,message);return;}\n",'')
 s=s.replace('   * de movimiento. El PID conserva su propio período de muestreo configurable. */','   * de movimiento. No se calcula una salida automatica en el servidor. */')
 s=between(s,"      if(entry.source==='pid'){",'    }\n    pump();pollMotion();')
 s=s.replace("      if(controller.enabled&&device?.readyState===WebSocket.OPEN)device.send('E\\n');\n",'')
 return s
edit('control/websocket.mjs',ws)

def protocol(s):
 s=s.replace('// A zero speed is valid feedback: it must allow starting the PID from rest.','// El encoder detenido es una medicion valida.')
 s=s[:s.index('export const PID_GAINS')]+'''export const GEAR_RATIO=19/40;
export const ROLLER_CM_PER_REV=Math.PI*2.95;
export const MAX_BELT_CM_S=CONTROL.maxMotorRpm*GEAR_RATIO*ROLLER_CM_PER_REV/60;
/** @typedef {{commandPercent:number,
 * motion:{rpm:number,targetRpm:number,requestedDirection:number,timeMs:number},
 * feedback?:{driveRpm:number}}} MotionState */
'''
 return s
edit('shared/control-protocol.mjs',protocol)

def state(s):
 s=s.replace('Telemetry,ControllerState,ModelSample','Telemetry,MotionState').replace('ControllerState','MotionState')
 s=s.replace("|'pid'",'').replace('modelSpeed:number|null;speedError:number|null;','').replace('modelSpeed:number|null; speedError:number|null; ','')
 s=between(s,'// A server-produced sample,','export class LabState')
 s=s.replace('  model:Readonly<ModelOutput>=EMPTY_MODEL;\n','').replace('this.model=EMPTY_MODEL;','')
 s=s.replace('    // Telemetry belongs to the device session; PID selection belongs to the\n    // user/server. Keep selection across reconnects until the server updates it.','    // Invalidate presentation when the device session changes.')
 s=s.replace('modelSpeed:null,speedError:null,','')
 s=s.replace("if(result.source!=='pid')this.previewCommand",'this.previewCommand')
 s=s.replace('    if(value.enabled&&!this.controller?.enabled)this.controlOverrides={};\n','').replace("||value.status==='fault'",'')
 s=s.replace("    if(this.controller?.enabled&&!['F','R','S','E'].includes(command))return;\n",'')
 s=s.replace("    const automatic=this.controller?.enabled||this.controller?.status==='fault';\n",'')
 s=s.replace('independently of G(s) and PID.','without generating physical measurements.')
 s=s.replace('automatic?Math.abs(target)/CONTROL.maxMotorRpm*100:','').replace("automatic?'pid':",'')
 s=s.replace('ingest(raw:Telemetry,at=this.clock(),model:ModelOutput|null=null)','ingest(raw:Telemetry,at=this.clock())').replace('    this.model=model??EMPTY_MODEL;\n','')
 s=s.replace('      modelSpeed:this.model.speedCmS,speedError:this.model.errorCmS,\n','')
 s=s.replace('controller:this.controller,model:fresh?this.model:EMPTY_MODEL,','controller:this.controller,')
 s=s.replace('!this.controller?.enabled&&','')
 return s
edit('app/lab-state.ts',state)

def hook(s):
 s=s.replace("import type {PidConfig} from '../shared/control-protocol.mjs';\n",'').replace('mando, fallas y PID','mando y fallas')
 s=s.replace(',message.last.model','').replace(',message.model','')
 s=s.replace("          else if(message.type==='pid-result')store.response=message.response;\n",'')
 s=between(s,'  /* Envía configuración o selección PID','  return {state,send,setFault,sendPid};')
 return s.replace('return {state,send,setFault,sendPid}','return {state,send,setFault}')
edit('app/use-lab.ts',hook)

def dashboard(s):
 s=s.replace('Interfaz de mando, medición, divergencias, PID, modelo y gráficas.','Interfaz de mando, medicion, divergencias y graficas.')
 s=s.replace('no calculan comandos PID ni reemplazan las mediciones del hardware.','conservan las mediciones del hardware.')
 s=s.replace('CONTROL,FAULTS,PID_DEFAULTS,validEncoder','CONTROL,FAULTS').replace("import type {PidConfig} from '../shared/control-protocol.mjs';\n",'')
 s=s.replace('Se conserva el ultrasónico. G(s) predice velocidad; no estima la posición del objeto.','Posición recibida del sensor ultrasónico.')
 s=between(s,'/* Mantiene un borrador de parámetros;', 'export default function ControlDashboard')
 s=s.replace('state,send,setFault,sendPid','state,send,setFault')
 s=s.replace('  const pid=state.controller;\n  const automatic=pid?.enabled??false;\n','')
 s=s.replace('!automatic&&','').replace('||automatic','').replace("automatic?'PID activo':",'')
 s='\n'.join(l for l in s.split('\n') if 'className="pid-toggle"' not in l and 'className="pid-command"' not in l)
 s=s.replace('{<><div className="setpoint-heading">','<><div className="setpoint-heading">').replace('</div></>}','</div></>')
 s=s.replace('Detener pausa la cinta; Adelante/Reversa reanudan. Solo desmarcar el PID lo desactiva. El micropaso se cambia con la cinta detenida y el PID desactivado.','Detener pausa la cinta; Adelante/Reversa reanudan. El micropaso se cambia con la cinta detenida.')
 s=s.replace('Ambas se combinan y actúan sobre el motor; el PID respeta el límite.','Ambas se combinan y actúan sobre el motor.')
 s=between(s,'        <section className="panel model-panel"','      </div>\n\n      <div className="fila2">')
 return s
edit('app/control-dashboard.tsx',dashboard)

def chart(s):
 s=s.replace(' ni calcula G(s)','').replace(',sample.modelSpeed??0','').replace("|'modelSpeed'",'')
 s=s.replace('{speed&&<span className="model-key">Modelo G(s)</span>}','')
 s=s.replace("      {speed&&<path className=\"chart-model\" d={path('modelSpeed')}/>}\n",'')
 s=s.replace('height={speed?80:42}','height={42}')
 s=re.sub(r",\n          \.\.\.\(speed\?\['Modelo: '.*?:\[\]\)",'',s)
 return s
edit('app/trend-chart.tsx',chart)
edit('control/speed-csv.mjs',lambda s:s.replace(' y modelo en cm/s',' en cm/s').replace('three chart values','chart values').replace(',modelo_gs_cm_s','').replace('number(frame.data.vel_t),\n        number(frame.model?.speedCmS)','number(frame.data.vel_t)'))
edit('server.mjs',lambda s:s.replace('control/websocket.mjs y control/pid.mjs','control/websocket.mjs').replace('pero no ejecuta el PID del sistema físico','sin calcular control automático').replace("process.env.CINTA_PORT || 8000","process.env.CINTA_PORT || 8001").replace('--port 8000','--port 8001'))

# Retirar implementacion y pruebas exclusivas de las funciones eliminadas.
for name in ['control/pid.mjs','tests/pid.test.mjs','tests/approach.test.mjs']:
 p=(B/name).resolve();assert p.is_relative_to(B.resolve());p.unlink()
