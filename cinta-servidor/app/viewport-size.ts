import {MathUtils} from 'three';
import type {PerspectiveCamera} from 'three';

/** Mantener el campo horizontal: si el panel crece de alto, mostrar más escena
 * vertical sin acercar la cámara ni cambiar la escala a igual ancho. */
export function createViewportSizer(camera:PerspectiveCamera){
  let initialized=false;
  return (width:number,height:number)=>{
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return false;
    const aspect=width/height;
    if(initialized)camera.fov=MathUtils.radToDeg(2*Math.atan(Math.tan(MathUtils.degToRad(camera.fov/2))*camera.aspect/aspect));
    camera.aspect=aspect;camera.updateProjectionMatrix();initialized=true;return true;
  };
}
