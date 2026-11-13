import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createInterface} from 'node:readline';
import WebSocket, {WebSocketServer} from '../vendor/ws/wrapper.mjs';

/* Un solo puerto publico. Python conserva los modulos y SQLite; Node sirve el visor. */
export async function startLab03Backend({db, python, cwd}={}) {
  cwd ??= fileURLToPath(new URL('../../modulos_pendientes_lab03/', import.meta.url));
  const local=resolve(cwd,process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
  python ??= process.env.CINTA_PYTHON || (existsSync(local)?local:'python');
  db ??= fileURLToPath(new URL('../datos/gemelo.sqlite3', import.meta.url));
  const child=spawn(python,['-u','-m','servidor.integrado','--port','0','--db',db,'--parent-stdin'],
    {cwd,stdio:['pipe','pipe','pipe'],windowsHide:true});
  let stderr='';
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);process.stderr.write(chunk);});
  const port=await new Promise((yes,no)=>{
    const lines=createInterface({input:child.stdout});
    const timer=setTimeout(()=>{child.kill();no(Error('El backend Lab03 no inicio en 15 s. '+stderr));},15000);
    const fail=e=>{clearTimeout(timer);no(e);};
    child.once('error',fail);
    child.once('exit',code=>fail(Error(`Backend Lab03 termino (${code}). ${stderr}`)));
    lines.on('line',line=>{
      try {
        const m=JSON.parse(line);
        if(m.ready&&Number.isInteger(m.port)&&m.port>0&&m.port<=65535){clearTimeout(timer);yes(m.port);}
      } catch {console.log('[Lab03]',line);}
    });
  });
  return {port, child, close(){child.stdin.end();child.kill();}};
}

export function attachLab03Bridge(server, backendPort) {
  const wss=new WebSocketServer({noServer:true,maxPayload:16384,perMessageDeflate:false});
  const pairs=new Map();
  server.on('upgrade',(req,socket,head)=>{
    const path=(req.url||'').split('?')[0];
    if(!['/ws/device','/ws/ui','/ws/observer'].includes(path))return socket.destroy();
    // El panel debe proceder del mismo sitio; el firmware no envia Origin.
    if(path==='/ws/ui'){
      try {if(new URL(req.headers.origin).host!==req.headers.host)return socket.destroy();}
      catch{return socket.destroy();}
    }
    wss.handleUpgrade(req,socket,head,down=>{
      const up=new WebSocket(`ws://127.0.0.1:${backendPort}${path}`,{perMessageDeflate:false,maxPayload:1048576});
      pairs.set(down,up);
      let ready=false;const waiting=[];
      const shutdown=()=>{down.terminate();up.terminate();pairs.delete(down);};
      const forward=(to,data,binary)=>{
        if(binary||to.readyState!==WebSocket.OPEN||to.bufferedAmount>1048576)return shutdown();
        to.send(data,{binary:false},error=>{if(error)shutdown();});
      };
      down.on('message',(data,binary)=>{
        if(!ready){if(waiting.length>=8||binary)return shutdown();waiting.push(data);return;}
        forward(up,data,binary);
      });
      up.on('open',()=>{ready=true;for(const data of waiting)forward(up,data,false);waiting.length=0;});
      up.on('message',(data,binary)=>forward(down,data,binary));
      down.on('error',shutdown);up.on('error',shutdown);
      down.on('close',()=>{up.close();pairs.delete(down);});
      up.on('close',(code,reason)=>{down.close(code===1006?1011:code,reason);pairs.delete(down);});
    });
  });
  return {close(){for(const [a,b] of pairs){a.terminate();b.terminate();}pairs.clear();wss.close();}};
}
