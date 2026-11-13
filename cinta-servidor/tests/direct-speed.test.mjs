import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

test('el deslizador envía V al soltar mouse/touch o teclado y respeta el bloqueo del mando',async()=>{
  const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{middlewareMode:true,hmr:false},logLevel:'error'});
  try{
    const {default:DirectSpeed}=await vite.ssrLoadModule('/app/direct-speed.tsx');
    let value=50,confirmed=50,disabled=false;
    const sent=[];
    const render=()=>{
      const element=DirectSpeed({value,confirmed,disabled,onChange:v=>value=v,onCommit:v=>sent.push(['V',v])});
      const children=element.props.children;
      return {input:children.find(e=>e.type==='input').props,button:children.find(e=>e.type==='button').props};
    };
    let captured=null;
    render().input.onPointerDown({pointerId:7,currentTarget:{setPointerCapture:id=>captured=id}});
    assert.equal(captured,7, 'Recibir la suelta aunque el puntero salga del deslizador');
    render().input.onChange({target:{value:'25'}});
    assert.equal(value,25);assert.deepEqual(sent,[], 'No inundar la cola durante el arrastre');
    render().input.onPointerUp({currentTarget:{value:'25'}});
    assert.deepEqual(sent,[['V',25]]);
    confirmed=25;
    render().input.onPointerUp({currentTarget:{value:'25'}});
    assert.equal(sent.length,1, 'No reenviar una velocidad ya confirmada');
    render().input.onChange({target:{value:'30'}});
    render().input.onKeyUp({key:'ArrowRight',currentTarget:{value:'30'}});
    assert.deepEqual(sent.at(-1),['V',30]);
    disabled=true;
    render().input.onPointerUp({currentTarget:{value:'90'}});render().button.onClick();
    assert.equal(sent.length,2, 'No enviar con emergencia, ensayo, desconexión o ACK pendiente');
    disabled=false;value=65;render().button.onClick();
    assert.deepEqual(sent.at(-1),['V',65]);
    render().input.onPointerCancel();assert.equal(value,confirmed);
    render().input.onKeyUp({key:'Tab',currentTarget:{value:'99'}});
    assert.equal(sent.length,3);
  }finally{await vite.close();}
});
