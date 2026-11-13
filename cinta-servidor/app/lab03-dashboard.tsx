import {useEffect,useState} from 'react';
import ConveyorViewer from './viewer';
import DirectSpeed from './direct-speed';
import {stoppedMotion} from './lab03-motion';
import {piecePosition} from './piece-models';
import {useLab03} from './use-lab03';
import type {Point,Report} from './use-lab03';
import './lab03-dashboard.css';

const fmt=(n:number|null|undefined,d=1)=>n==null||!Number.isFinite(n)?'—':n.toFixed(d);
const alarmNames:Record<string,string>={divergencia_rpm_ts:'El encoder y el modelo TS divergen',divergencia_posicion:'La posición real y estimada divergen',
  periodo_control_excedido:'Se excedió el periodo de control',traza_incompleta:'Se perdieron eventos de la traza',salto_secuencia:'Faltan mensajes en la secuencia',
  telemetria_vencida:'Telemetría vencida',tres_dudosos_consecutivos:'Tres resultados dudosos consecutivos',tasa_dudosos_alta:'Más de 10 % de dudosos en las últimas 20 pruebas',
  ia_dudosa:'Tiny IA: resultado dudoso',ia_sin_inferencia:'Captura sin inferencia válida',senal_intermitente:'Tiny IA: señal intermitente',senal_anomala:'Tiny IA: señal anómala',
  parada_enclavada:'Parada enclavada; requiere rearme',eco_perdido_antes_salida:'Se perdió el eco antes de confirmar la zona de salida'};
const eventNames:Record<string,string>={objeto:'Objeto detectado',decision_a:'Decisión: metálico',decision_b:'Decisión: no metálico',dudoso:'Clasificación cancelada',
  servo_orden:'Orden al servo',motor_orden_parar:'Orden de parada',fin_ciclo:'Fin de transporte',falla:'Falla',alarma:'Alarma',rearme:'Rearme'};
function download(data:unknown,name:string){
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),500);
}
function Plot({points,now,distance=false}:{points:Point[];now:number;distance?:boolean}){
  const max=Math.max(distance?60:100,...points.map(p=>distance?p.cm??0:Math.max(p.rpm??0,p.ts)))*1.08;
  const x=(at:number)=>45+(at-now+60000)/60000*530,y=(n:number)=>170-150*n/max;
  const line=(key:'cm'|'rpm'|'ts')=>{
    let previous=0;return points.filter(p=>now-p.at<=60000).map(p=>{
      const value=p[key];if(value===null){previous=0;return '';}
      const cmd=previous&&p.at-previous<1200?'L':'M';previous=p.at;return `${cmd}${x(p.at).toFixed(1)},${y(value).toFixed(1)}`;
    }).join(' ');
  };
  return <div className="trend"><div className="trend-legend"><span>{distance?'Ultrasonido · cm':'Encoder · RPM motor'}</span>{!distance&&<span className="reference-key">TS orden 1</span>}</div>
    <svg viewBox="0 0 600 205" role="img" aria-label={distance?'Distancia ultrasónica durante el último minuto':'RPM medidas y modelo TS durante el último minuto'}>
      {[0,1,2,3].map(i=><g key={i}><line className="chart-grid" x1="45" x2="575" y1={y(max*i/3)} y2={y(max*i/3)}/><text x="38" y={y(max*i/3)+4} textAnchor="end">{fmt(max*i/3,0)}</text></g>)}
      {[-60,-40,-20,0].map(s=><text key={s} x={x(now+s*1000)} y="194" textAnchor="middle">{s} s</text>)}
      {!distance&&<path className="chart-reference" d={line('ts')}/>}<path className="chart-measured" d={line(distance?'cm':'rpm')}/>
      {!points.length&&<text x="300" y="100" textAnchor="middle">Esperando datos</text>}
    </svg></div>;
}

const calcFields:Record<string,[string,string][]>={
  sincronizacion:[['rpm_motor','RPM motor medidas'],['radio_rodillo_m','Radio del rodillo (m)'],['distancia_m','Distancia hasta el servo (m)'],['servo_s','Tiempo medido del servo (s)'],['margen_s','Margen (s)']],
  oee:[['total','Piezas procesadas'],['buenos','Piezas correctamente clasificadas'],['planificado_s','Tiempo planificado (s)'],['operativo_s','Tiempo operativo (s)'],['ciclo_ideal_s','Ciclo ideal medido (s)']],
  perdidas:[['objetos_h','Piezas por hora'],['fraccion_reproceso','Fracción de reproceso (0–1)'],['costo_objeto','Costo por pieza'],['horas_dia','Horas por día'],['dias_anio','Días por año']]};
const resultNames:Record<string,string>={velocidad_m_s:'Velocidad de banda (m/s)',vuelo_s:'Tiempo de llegada (s)',comandar_despues_s:'Espera antes de ordenar (s)',viable:'Margen de actuación suficiente',
  velocidad_limite_m_s:'Límite de velocidad (m/s)',disponibilidad:'Disponibilidad',rendimiento:'Rendimiento',calidad:'Calidad',oee:'OEE',revisar_ciclo_ideal:'Revisar el ciclo ideal',perdida_anual:'Pérdida anual estimada'};
function ReportView({report}:{report:Report}){
  return <><div className="lab03-stat-grid">
    <div><span>Transportes finalizados</span><strong>{report.ciclos_finalizados??0}</strong></div>
    <div><span>Objetos/min en ventana observada</span><strong>{fmt(report.tasas_por_arranque?.[0]?.objetos_min,2)}</strong></div>
    <div><span>Ciclo mínimo / máximo</span><strong>{fmt(report.ciclo_s?.min,2)} / {fmt(report.ciclo_s?.max,2)} s</strong></div>
    <div><span>Decisiones metal / no metal</span><strong>{report.decisiones?.decision_a??0} / {report.decisiones?.decision_b??0}</strong></div>
  </div><p className="ayuda">Un fin de transporte no confirma que la pieza cayó en el recipiente correcto. El límite de decisión analizado es 50 ms; la espera actual de colocación puede excederlo.</p>
  <div className="table-scroll lab03-report"><table className="tabla"><thead><tr><th>Objeto / propiedad</th><th>Latencia</th><th>Evidencia</th></tr></thead><tbody>
    {report.propiedades?.map((p,i)=><tr key={i}><th>#{p.object_id} · {eventNames[p.propiedad]||p.propiedad}</th><td>{fmt(p.latencia_us==null?null:p.latencia_us/1000)} ms</td><td>{p.resultado.replaceAll('_',' ')}</td></tr>)}
  </tbody></table></div><p className="ayuda">Se muestran hasta 200 propiedades recientes de este arranque. Sin feedback del servo o de parada física, el resultado es «SIN EVIDENCIA».</p></>;
}

export default function Lab03Dashboard(){
  const lab=useLab03();const s=lab.snapshot?.data;const live=lab.fresh?s:null;const ia=lab.ia?.data;
  const [theme,setTheme]=useState('claro'),[speed,setSpeed]=useState(50),[calc,setCalc]=useState('sincronizacion');
  const [offsetInput,setOffsetInput]=useState('0'),[distanceOffset,setDistanceOffset]=useState(0);
  const [calNotice,setCalNotice]=useState('');
  useEffect(()=>{if(s)setSpeed(s.porcentaje);},[s?.porcentaje]);
  useEffect(()=>{try{const c=JSON.parse(localStorage.getItem('lab03-distance-offset-v1')||'0');
    if(typeof c==='number'&&Number.isFinite(c)&&Math.abs(c)<=10){setDistanceOffset(c);setOffsetInput(String(c));}
  }catch{/* Sin calibración guardada. */}},[]);
  const can=lab.fresh&&!lab.pending&&!s?.emergencia&&!s?.ensayo;
  const direct=can&&!s?.automatico;
  const pos=live?piecePosition(live.dist_cm,distanceOffset):null;
  const iaLabel=!ia?'Esperando una prueba completa':!ia.activa?'Sin inferencia':ia.dudosa?'Resultado dudoso':['Señal normal','Señal intermitente','Señal anómala'][ia.clase]||'Sin clase';
  const iaKind=ia?.activa?(ia.dudosa?'aviso':ia.clase===0?'normal':'alarma'):'inactivo';
  return <main className="instrumentation" data-theme={theme}><div className="pagina lab03">
    <header className="cabecera"><div className="brand"><span className="brand-symbol"><span/><span/></span><div><p className="eyebrow">LABORATORIO 03 · SISTEMAS INTELIGENTES Y CIBERFÍSICOS</p><h1>Cinta clasificadora</h1></div></div>
      <div className="cabecera-der"><span className={'con '+(lab.fresh?'ok':'error')}>{lab.fresh?'ESP32 conectada':lab.server?'Esperando ESP32':'Servidor desconectado'}</span><button className="btn-tema" onClick={()=>setTheme(t=>t==='claro'?'oscuro':'claro')}>Tema {theme==='claro'?'oscuro':'claro'}</button></div></header>
    <section className="panel resumen" aria-label="Estado recibido de la ESP32">
      {[['Modo',live?(live.ensayo?'Ensayo detenido':live.automatico?'Clasificación automática':'Mando directo'):'Sin datos actuales'],['Estado',live?.estado??'—'],['Dirección',live?live.direccion===1?'Adelante':live.direccion===-1?'Reversa':'Orden de parada':'—'],['STEP',live?`${live.step_hz} Hz`:'—'],['Captura',live?.capturando?'Registrando firma de 10 s':live?'En espera':'—']].map(([k,v])=><div className="dato" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>)}
    </section>
    {s?.emergencia&&<div className="lab03-banner" role="alert">Parada enclavada. Revisá el montaje y pulsá Rearmar; la marcha requiere una nueva orden.</div>}
    <div className="workspace-grid">
      <ConveyorViewer live servoAngle={s?.servo_grados??null} objectPosition={pos} objectKind={live?lab.piece:null} motion={live?lab.motion:stoppedMotion()}/>
      <section className="panel mando-panel"><h2>Mando de la cinta</h2>
        <label className="lab03-auto"><input type="checkbox" checked={s?.automatico??false} disabled={!can} onChange={e=>lab.command('AUTO',e.target.checked?1:0)}/><span>Clasificación automática<small>Inductivo, ultrasonido y expulsión con servo</small></span></label>
        <div className="botonera"><button className="btn" disabled={!direct} onClick={()=>lab.command('F')}>Adelante</button><button className="btn" disabled={!lab.fresh} onClick={()=>lab.command('S')}>Detener</button><button className="btn" disabled={!direct} onClick={()=>lab.command('R')}>Reversa</button>
          <button className="btn btn-paro" disabled={!lab.fresh} onClick={()=>lab.command('E')}>Paro y enclavamiento</button></div>
        <DirectSpeed value={speed} confirmed={live?.porcentaje??null} disabled={!direct} onChange={setSpeed} onCommit={v=>lab.command('V',v)}/>
        <p className="ayuda" role="status">Movimiento del gemelo: {!live?'sin telemetría reciente':lab.motion.source==='encoder'?'según el encoder':lab.motion.source==='startup'?'estimación de arranque por STEP; esperando encoder':lab.motion.source==='missing'?'visor detenido por falta de lectura válida del encoder':'detenido'}.</p>
        <button className="btn" disabled={!lab.fresh||!s?.emergencia||lab.pending>0} onClick={()=>lab.command('RESET')}>Rearmar</button>
        {s?.ensayo&&<p className="ayuda">El panel de captura mantiene la cinta detenida. Salí del ensayo allí para habilitar el mando.</p>}
        <p className="respuesta" role="status" aria-live="polite">{lab.notice}</p>
      </section>
    </div>
    <div className="detail-grid"><section className="panel"><h2>Sensores y modelo TS de orden 1</h2><div className="lab03-stat-grid">
      <div><span>Encoder · RPM motor</span><strong>{fmt(live?.rpm_motor)}</strong><small>{live?.encoder_valido?'Lectura válida':'Sin lectura válida'}</small></div>
      <div><span>TS · RPM motor</span><strong>{fmt(live?.rpm_ts)}</strong><small>Predicción de la ESP32</small></div>
      <div><span>Ultrasonido</span><strong>{fmt(live?.dist_cm)} cm</strong><small>{live&&live.servo_grados>.1?'Puede ser eco de la pala':live&&live.dist_cm===null?'Sin eco':'Distancia al reflector'}</small></div>
      <div><span>Inductivo</span><strong>{live?live.metal?'Activo':'Inactivo':'—'}</strong><small>Estado actual, sin memoria</small></div></div>
      <Plot points={lab.history} now={lab.now}/><Plot points={lab.history} now={lab.now} distance/>
    </section><section className="panel"><div className="panel-heading"><h2>Tiny IA · calidad de señal</h2><span className={'estado '+iaKind}>{iaLabel}</span></div>
      {ia&&<><p className="lab03-ia-vote">{ia.activa?fmt(ia.voto*100,1)+' %':'—'}<small>votos del bosque · no es exactitud en vivo</small></p>
        <dl className="lab03-values"><dt>Prueba</dt><dd>#{ia.object_id} · {ia.manual?'manual':'automática'}</dd><dt>Inferencia</dt><dd>{fmt(ia.inferencia_us/1000,3)} ms</dd><dt>Último resultado completo</dt><dd>A {(lab.ia!.t_us/1000000).toFixed(1)} s del arranque</dd></dl></>}
      <p className="ayuda">Una inferencia por firma completa de 10 segundos. Modelo entrenado en modo manual con las dos piezas del montaje; los resultados en movimiento aún requieren validación. Un aviso de calidad no cambia la decisión metal/no metal.</p>
      <h3>Avisos recientes</h3><ul className="lab03-alerts" aria-live="polite">{lab.alarms.length?lab.alarms.slice(0,10).map((a,i)=><li key={i}><time>{new Date(a.at).toLocaleTimeString()}</time><span>{alarmNames[a.codigo]||a.codigo}{a.object_id?` · #${a.object_id}`:''}</span></li>):<li>Sin avisos registrados en este arranque.</li>}</ul>
    </section></div>
    <div className="fila2"><section className="panel"><h2>Tiempo real y recursos</h2><dl className="lab03-values">
      {[['Ejecución del control (µs)',live?.control_exec_us],['Retraso del control (µs)',live?.control_late_us],['Periodos omitidos',live?.control_missed],['Heap libre mínimo (bytes)',live?.heap_min],['Pila libre mínima CPU1 (bytes)',live?.stack_min],['Inferencias descartadas',live?.dropped_ia],['Eventos descartados',live?.dropped_events],['Snapshots reemplazados',live?.coalesced],['Flancos de encoder rechazados (ciclo)',live?.encoder_rechazados]].map(([k,v])=><div key={String(k)}><dt>{k}</dt><dd>{typeof v==='number'?fmt(v,0):'—'}</dd></div>)}
      </dl><p className="ayuda">Control y TS en CPU1; Tiny IA, Wi-Fi y envío en CPU0. Control cada 20 ms; sensores y TS cada 100 ms. Los snapshots reemplazados reflejan la cola de «último estado».</p></section>
      <section className="panel"><h2>Eventos por objeto</h2><ul className="lab03-alerts">{lab.events.map((e,i)=><li key={i}><time>{new Date(e.at).toLocaleTimeString()}</time><span>#{e.object_id} · {eventNames[e.name]||e.name}</span></li>)}{!lab.events.length&&<li>Esperando un ciclo automático.</li>}</ul></section></div>
    <section className="panel"><div className="panel-heading"><h2>Informe del arranque actual</h2><div className="lab03-actions"><button className="btn" disabled={!lab.server} onClick={()=>lab.request({type:'report'})}>Actualizar informe</button><button className="btn" disabled={!lab.report} onClick={()=>download(lab.report,'informe-lab03.json')}>Descargar JSON</button></div></div>
      {lab.report?<ReportView report={lab.report}/>:<p className="ayuda">Analiza las trazas guardadas: decisiones, tiempos de ciclo, tasa de producción y propiedades temporales.</p>}</section>
    <section className="panel"><h2>Cálculos del laboratorio</h2><p className="ayuda">Ingresá mediciones del montaje. Estos cálculos ayudan a evaluar la operación; no envían órdenes al motor ni alteran el punto de empuje de 30 cm.</p>
      <label className="etiqueta" htmlFor="calculation">Cálculo</label><select id="calculation" value={calc} onChange={e=>setCalc(e.target.value)}><option value="sincronizacion">Llegada al servo y margen de actuación</option><option value="oee">Disponibilidad, rendimiento, calidad y OEE</option><option value="perdidas">Pérdidas anuales por reproceso</option></select>
      <form className="lab03-form" key={calc} onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);lab.request({type:'calculate',calculo:calc,...Object.fromEntries([...data].map(([k,v])=>[k,Number(v)]))});}}>
        {calcFields[calc].map(([k,label])=><label key={k}>{label}<input name={k} type="number" required min="0" step={k==='total'||k==='buenos'?'1':'any'}/></label>)}<button className="btn" disabled={!lab.server}>Calcular</button></form>
      {lab.calculation?.calculo===calc&&<dl className="lab03-values lab03-results">{Object.entries(lab.calculation.data).map(([k,v])=><div key={k}><dt>{resultNames[k]||k}</dt><dd>{typeof v==='boolean'?v?'Sí':'No':fmt(v,4)}</dd></div>)}</dl>}
    </section>
    <details className="panel"><summary>Calibrar la posición del objeto en el gemelo</summary><p className="ayuda">La distancia se representa desde la cara del ultrasonido hasta la superficie de la pieza, considerando el radio de la lata o la profundidad de la caja. Por ejemplo, 8,6 cm dejan 8,6 cm de separación. La lata conserva su identificación metálica durante el recorrido; ambas piezas se ocultan al perder el eco o la conexión.</p>
      <form className="lab03-form" onSubmit={e=>{e.preventDefault();const offset=Number(offsetInput);if(!Number.isFinite(offset)||Math.abs(offset)>10){setCalNotice('Usá una corrección entre −10 y 10 cm.');return;}setDistanceOffset(offset);try{localStorage.setItem('lab03-distance-offset-v1',JSON.stringify(offset));}catch{}setCalNotice('Corrección visual aplicada.');}}>
        <label>Corrección de distancia (cm)<input type="number" required min="-10" max="10" step="0.1" value={offsetInput} onChange={e=>setOffsetInput(e.target.value)}/></label><button className="btn">Aplicar corrección visual</button><button type="button" className="btn" onClick={()=>{setDistanceOffset(0);setOffsetInput('0');try{localStorage.removeItem('lab03-distance-offset-v1');}catch{}setCalNotice('Distancia directa del sensor restaurada.');}}>Usar distancia del sensor</button></form>
      <p className="ayuda">{calNotice||'Distancia directa del sensor; corrección inicial: 0 cm.'} Ajustá la corrección solo si la ubicación física del sensor difiere del modelo. No cambia la medición ni el control de la ESP32.</p>
    </details>
  </div></main>;
}
