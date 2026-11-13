type Props={value:number;confirmed:number|null;disabled:boolean;onChange:(value:number)=>void;onCommit:(value:number)=>void};

export default function DirectSpeed({value,confirmed,disabled,onChange,onCommit}:Props){
  const commit=(n:number)=>{if(!disabled&&Number.isFinite(n)&&n>=0&&n<=100&&n!==confirmed)onCommit(n);};
  return <>
    <div className="setpoint-heading"><label className="etiqueta" htmlFor="manual-speed">Velocidad directa</label><output>{value}%</output></div>
    <input id="manual-speed" type="range" min="0" max="100" step="5" value={value} disabled={disabled}
      onChange={e=>onChange(Number(e.target.value))}
      onPointerDown={e=>{if(!disabled)e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerUp={e=>commit(Number(e.currentTarget.value))}
      onPointerCancel={()=>onChange(confirmed??value)}
      onKeyUp={e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key))commit(Number(e.currentTarget.value));}}/>
    <button className="btn" disabled={disabled} onClick={()=>commit(value)}>Aplicar velocidad</button>
    <p className="ayuda">Se envía al soltar el deslizador. Confirmada por la ESP32: {confirmed===null?'—':`${confirmed} %`}. 50 % = 75 RPM nominales; 100 % = 150 RPM. En automático: 80 RPM. Detené la cinta antes de invertir el sentido.</p>
  </>;
}
