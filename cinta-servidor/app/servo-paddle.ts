import {Group,MathUtils,Vector3} from 'three';
import type {Object3D} from 'three';

// Los GLB nuevos usan Z vertical. El resto del ensamble CAD usa -Y vertical.
export function alignClassifierModel(model:Object3D){
  const aligned=new Group();aligned.rotation.x=Math.PI/2;aligned.add(model);
  return aligned;
}
// Centro del eje MG996R medido en los GLB nuevos, convertido al sistema CAD.
export const SERVO_PIVOT = new Vector3(.0145,-.171,.3025);
export const SERVO_SWEEP_DEG = 60;
export function createServoPaddle(model:Object3D){
  const pivot=new Group();pivot.name='pivote_pala_servo';pivot.position.copy(SERVO_PIVOT);
  const offset=new Group();offset.position.copy(SERVO_PIVOT).negate();
  offset.add(alignClassifierModel(model));pivot.add(offset);
  let angle=0,target=0,last:number|null=null;
  return {
    group:pivot,
    setAngle(degrees:number){if(Number.isFinite(degrees))target=MathUtils.clamp(degrees,0,SERVO_SWEEP_DEG);},
    synchronizeAngle(degrees:number){
      if(!Number.isFinite(degrees))return;
      angle=target=MathUtils.clamp(degrees,0,SERVO_SWEEP_DEG);
      pivot.rotation.y=MathUtils.degToRad(angle);
    },
    resetClock(){last=null;},
    update(now:number){
      const dt=last===null?0:Math.min(.1,Math.max(0,(now-last)/1000));last=now;
      if(angle===target)return false;
      angle+=Math.sign(target-angle)*Math.min(Math.abs(target-angle),60*dt);
      pivot.rotation.y=MathUtils.degToRad(angle);
      return true;
    },
    getAngle(){return angle;},
  };
}
