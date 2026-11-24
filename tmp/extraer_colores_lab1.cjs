const fs=require('node:fs');
const vm=require('node:vm');
const THREE=require('../cinta-servidor/node_modules/three');
const file=fs.readFileSync('tmp/soportes_lab1.glb');
const length=file.readUInt32LE(12),json=JSON.parse(file.subarray(20,20+length));
const binary=file.subarray(28+length);
const moduleObject={exports:{}};
vm.runInNewContext(fs.readFileSync('cinta-servidor/public/draco/draco_wasm_wrapper.js','utf8'),{module:moduleObject,exports:moduleObject.exports,require,process,console,__dirname:process.cwd()});
(async()=>{
 const draco=await moduleObject.exports({wasmBinary:fs.readFileSync('cinta-servidor/public/draco/draco_decoder.wasm')});
 const groups=new Map();
 function visit(index,parent){
  const node=json.nodes[index];
  const local=node.matrix?new THREE.Matrix4().fromArray(node.matrix):new THREE.Matrix4().compose(new THREE.Vector3().fromArray(node.translation??[0,0,0]),new THREE.Quaternion().fromArray(node.rotation??[0,0,0,1]),new THREE.Vector3().fromArray(node.scale??[1,1,1]));
  const matrix=parent.clone().multiply(local);
  if(node.mesh!==undefined){
   const name=node.name.split('__')[0].replace(/:1$/,'');
   if(['40x60 pcb','8 Pin Header v0','8 Pin Header v0(Mirror)','PCB','BTT TMC2208','bottom'].includes(name)){
    const rows=groups.get(name)??[];groups.set(name,rows);
    for(const prim of json.meshes[node.mesh].primitives){
     const ext=prim.extensions.KHR_draco_mesh_compression,view=json.bufferViews[ext.bufferView];
     const bytes=new Int8Array(binary.buffer,binary.byteOffset+(view.byteOffset??0),view.byteLength);
     const decoder=new draco.Decoder(),mesh=new draco.Mesh();
     const status=decoder.DecodeArrayToMesh(bytes,bytes.length,mesh);if(!status.ok())throw Error(status.error_msg());
     const attribute=decoder.GetAttributeByUniqueId(mesh,ext.attributes.POSITION),count=mesh.num_points()*3,ptr=draco._malloc(count*4);
     decoder.GetAttributeDataArrayForAllPoints(mesh,attribute,draco.DT_FLOAT32,count*4,ptr);
     const positions=new Float32Array(draco.HEAPF32.buffer,ptr,count).slice();
     const normalAttribute=decoder.GetAttributeByUniqueId(mesh,ext.attributes.NORMAL);
     decoder.GetAttributeDataArrayForAllPoints(mesh,normalAttribute,draco.DT_FLOAT32,count*4,ptr);
     const normals=new Float32Array(draco.HEAPF32.buffer,ptr,count);
     const rgb=json.materials[prim.material].pbrMetallicRoughness.baseColorFactor??[1,1,1,1];
     const point=new THREE.Vector3(),normal=new THREE.Vector3(),normalMatrix=new THREE.Matrix3().getNormalMatrix(matrix);
     for(let i=0;i<count;i+=3){point.fromArray(positions,i).applyMatrix4(matrix);normal.fromArray(normals,i).applyNormalMatrix(normalMatrix);rows.push(point.x,point.y,point.z,...rgb.slice(0,3),...normal);}
     draco._free(ptr);draco.destroy(mesh);draco.destroy(decoder);
    }
   }
  }
  for(const child of node.children??[])visit(child,matrix);
 }
 for(const index of json.scenes[json.scene??0].nodes)visit(index,new THREE.Matrix4());
 const manifest={};let index=0;
 for(const [name,rows] of groups){const array=new Float32Array(rows),path=`tmp/lab1-colores-${index++}.bin`;fs.writeFileSync(path,Buffer.from(array.buffer));manifest[name]=path;console.log(name,rows.length/9);}
 fs.writeFileSync('tmp/lab1-colores.json',JSON.stringify(manifest));
})();
