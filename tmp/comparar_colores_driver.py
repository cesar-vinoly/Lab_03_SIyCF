import json,struct,hashlib
from pathlib import Path
import numpy as np
from scipy.spatial import cKDTree

data=Path('cinta-servidor/public/models/Soportes.glb').read_bytes()
length=struct.unpack_from('<I',data,12)[0]
j=json.loads(data[20:20+length]);binary=data[28+length:]
def attribute(index):
 a=j['accessors'][index];v=j['bufferViews'][a['bufferView']]
 dtype={5126:'<f4',5121:'u1',5123:'<u2',5125:'<u4'}[a['componentType']]
 cols={'VEC3':3,'VEC4':4,'SCALAR':1}[a['type']]
 return np.ndarray((a['count'],cols),dtype=dtype,buffer=binary,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',np.dtype(dtype).itemsize*cols),np.dtype(dtype).itemsize))
manifest=json.loads(Path('tmp/lab1-colores.json').read_text())
result={}
for n in j['nodes']:
 name=n.get('name');oldname='BTT TMC2208' if name=='COMPOUND' else name
 if oldname not in manifest:continue
 prim=j['meshes'][n['mesh']]['primitives'][0]
 xyz=attribute(prim['attributes']['POSITION']).astype(float)
 matrix=np.array(n.get('matrix',np.eye(4).T.reshape(-1))).reshape(4,4).T
 xyz=(np.column_stack((xyz,np.ones(len(xyz))))@matrix.T)[:,:3]
 xyz=xyz[:,[0,2,1]];xyz[:,1]*=-1
 old=np.fromfile(manifest[oldname],dtype='<f4').reshape(-1,9)
 indices=attribute(prim['indices']).reshape(-1)
 points=xyz[indices].reshape(-1,3,3)
 cross=np.cross(points[:,1]-points[:,0],points[:,2]-points[:,0])
 normals=np.zeros_like(xyz)
 for corner in range(3):np.add.at(normals,indices.reshape(-1,3)[:,corner],cross)
 normals/=np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-20)
 distances,neighbours=cKDTree(old[:,:3]).query(xyz,k=24)
 dots=np.sum(old[neighbours,6:]*normals[:,None,:],axis=2)
 scores=distances+np.where(dots>.8,0,.01)
 best=np.argmin(scores,axis=1)
 nearest=neighbours[np.arange(len(xyz)),best];distance=distances[np.arange(len(xyz)),best]
 rgb=old[nearest,3:6]
 indices=attribute(prim['indices']).reshape(-1)
 triangles=rgb[indices].reshape(-1,3,3)
 mixed=np.any(triangles!=triangles[:,:1,:],axis=(1,2))
 print('  mixed triangles',int(mixed.sum()),'/',len(mixed))
 print(name,'distance_mm percentiles',np.percentile(distance*1000,[50,95,99,100]).round(5),'colors',len(np.unique(rgb,axis=0)))
 palette,inverse=np.unique(rgb,axis=0,return_inverse=True)
 mode='vertices'
 if mixed.any():
  mode='triangles'
  inverse=np.array([np.bincount(t,minlength=len(palette)).argmax() for t in inverse[indices].reshape(-1,3)])
 runs=[]
 for i,p in enumerate(inverse):
  if runs and runs[-1][1]==int(p):runs[-1][0]=i+1
  else:runs.append([i+1,int(p)])
 fingerprint=2166136261
 for value in attribute(prim['attributes']['POSITION']).tobytes()+attribute(prim['indices']).tobytes():fingerprint=((fingerprint^value)*16777619)&0xffffffff
 result[name]={'vertices':len(xyz),'indices':len(indices),'fingerprint':format(fingerprint,'08x'),'mode':mode,'palette':palette.tolist(),'runs':runs}
 print('  runs',len(runs))
Path('tmp/comparacion_colores.json').write_text(json.dumps(result,indent=2))
output={'source':'https://github.com/cesar-vinoly/Lab-1-Sistemas-inteligentes-y-ciber-f-sicos/blob/main/cinta-servidor/public/models/soportes.glb','sourceSha256':hashlib.sha256(Path('tmp/soportes_lab1.glb').read_bytes()).hexdigest(),'targetSha256':hashlib.sha256(data).hexdigest(),'parts':result}
Path('cinta-servidor/app/support-colors.generated.json').write_text(json.dumps(output,separators=(',',':'))+'\n',encoding='utf-8')
