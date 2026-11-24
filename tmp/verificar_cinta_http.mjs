import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const origin='http://127.0.0.1:8001';
const page=await fetch(origin);assert.equal(page.status,200);
const html=await page.text();
const js=html.match(/src="([^"]+\.js)"/)[1];
const bundle=await fetch(origin+js);assert.equal(bundle.status,200);
const code=await bundle.text();
assert.ok(code.includes('/models/Soportes_fusion.glb'));
assert.ok(code.includes('/models/Pala_servo.glb'));
assert.ok(!code.includes('PID de aproximación'));
assert.ok(!code.includes('Modelo G(s)'));
for(const name of ['Soportes_fusion.glb','Pala_servo.glb']){
  const response=await fetch(origin+'/models/'+name);
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/model\/gltf-binary/);
  const bytes=Buffer.from(await response.arrayBuffer());
  const expected=await readFile(new URL('../cinta-servidor/public/models/'+name,import.meta.url));
  assert.ok(bytes.equals(expected));
  console.log(name+': HTTP 200, archivo actualizado verificado ('+bytes.length+' bytes)');
}
console.log('OK: pagina y bundle disponibles en 8001, modelos exactos y sin panel PID/G(s).');
