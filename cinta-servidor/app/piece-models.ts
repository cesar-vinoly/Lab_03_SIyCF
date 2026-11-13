import {Box3,Group,Mesh,Vector3} from 'three';
import type {Object3D} from 'three';

export type PieceKind='lata'|'caja';
// Cara frontal de las rejillas HC_SR04_gitter_001/002 en Soportes_fusion.glb,
// después de adaptar Z vertical de Fusion a -Y vertical del ensamble.
export const ULTRASONIC_FACE_Z=.00828000004768419;
export function piecePosition(cm:number|null|undefined,offsetCm=0):number|null{
  if(cm==null||!Number.isFinite(cm)||cm<2||cm>60)return null;
  if(!Number.isFinite(offsetCm)||Math.abs(offsetCm)>10||cm+offsetCm<0)return null;
  return cm+offsetCm;
}

export function createPieceModels(bounds:Box3,models:Record<PieceKind,Object3D>){
  const mesh=new Group();mesh.name='Pieza detectada';mesh.visible=false;
  mesh.position.set((bounds.min.x+bounds.max.x)/2,bounds.min.y-.0001,0);
  const variants={} as Record<PieceKind,Group>;
  const halfDepth={} as Record<PieceKind,number>;
  for(const kind of ['lata','caja'] as const){
    // STEP convertido a metros y Z vertical. No reducir ni estirar las piezas.
    const model=models[kind],box=new Box3().setFromObject(model),center=box.getCenter(new Vector3());
    halfDepth[kind]=(box.max.y-box.min.y)/2; // Y de Fusion pasa a Z longitudinal.
    model.traverse(node=>{if(node instanceof Mesh){node.castShadow=true;node.receiveShadow=true;}});
    const offset=new Group();offset.position.set(-center.x,-center.y,-box.min.z);offset.add(model);
    const aligned=new Group();aligned.rotation.x=Math.PI/2;aligned.add(offset);
    aligned.visible=false;mesh.add(aligned);variants[kind]=aligned;
  }
  let targetZ=0,lastTime:number|null=null,current:PieceKind|null=null;
  const update=(now:number)=>{
    const dt=lastTime===null?0:Math.max(0,(now-lastTime)/1000);lastTime=now;
    if(!mesh.visible||!dt||mesh.position.z===targetZ)return false;
    const next=targetZ+(mesh.position.z-targetZ)*Math.exp(-dt/.12);
    mesh.position.z=Math.abs(next-targetZ)<1e-7?targetZ:next;return true;
  };
  return {mesh,update,resetClock(){lastTime=null;},
    setPosition(distanceCm:unknown,now:number,kind:PieceKind|null){
      update(now);
      if(typeof distanceCm!=='number'||!Number.isFinite(distanceCm)||distanceCm<0||distanceCm>70||kind===null){mesh.visible=false;lastTime=null;return;}
      // El eco mide hasta la superficie cercana, no hasta el centro de la pieza.
      const next=ULTRASONIC_FACE_Z+distanceCm/100+halfDepth[kind];
      if(!mesh.visible||kind!==current)mesh.position.z=next;
      current=kind;targetZ=next;mesh.visible=true;lastTime=now;
      variants.lata.visible=kind==='lata';variants.caja.visible=kind==='caja';
    },
  };
}
