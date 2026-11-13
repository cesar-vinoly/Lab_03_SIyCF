import type {Snapshot} from './use-lab03';

type Input=Pick<Snapshot,'step_hz'|'direccion'|'encoder_valido'|'rpm_motor'|'setpoint_rpm'|'emergencia'|'ensayo'>;
export type LiveMotion={direction:-1|0|1;driveRpm:number;source:'stopped'|'encoder'|'startup'|'missing'};
export const stoppedMotion=():LiveMotion=>({direction:0,driveRpm:0,source:'stopped'});
// El avance físico (DIR=1, también en automático) va hacia Z creciente en
// el CAD. Su superficie superior avanza así al girar alrededor de -X.
// Convertir solo en el visor: órdenes y telemetría conservan su sentido real.
const CAD_FORWARD=-1;

/** El STEP confirma pulsos ordenados, no movimiento físico. Solo cubre el
 * arranque mientras el encoder reúne periodos, como en el primer laboratorio. */
export class Lab03Motion {
  private direction=0;
  private deadline=0;
  private measured=false;
  reset(){this.direction=0;this.deadline=0;this.measured=false;}
  observe(s:Input,now:number):LiveMotion {
    if(s.emergencia||s.ensayo||!s.direccion||!Number.isFinite(s.step_hz)||s.step_hz<=0){
      this.reset();return stoppedMotion();
    }
    // Configuración física fija: 200 pasos/vuelta y TMC2208 a 1/8 (MS1=MS2=0).
    const rpmSteps=s.step_hz*60/(200*8);
    const visualDirection=(s.direccion*CAD_FORWARD) as -1|1;
    if(this.direction!==s.direccion){
      this.direction=s.direccion;this.measured=false;
      const target=Math.max(rpmSteps,Number.isFinite(s.setpoint_rpm)?s.setpoint_rpm:0,1);
      // Hasta cinco pulsos del disco de 20 ranuras, relación 19/40.
      this.deadline=now+Math.min(6000,Math.max(2500,5*60000/(target*19/40*20)));
    }
    if(s.encoder_valido&&s.rpm_motor!==null&&Number.isFinite(s.rpm_motor)&&s.rpm_motor>=0){
      this.measured=true;
      return {direction:s.rpm_motor>0?visualDirection:0,driveRpm:s.rpm_motor,source:'encoder'};
    }
    if(!this.measured&&now<this.deadline)return {direction:visualDirection,driveRpm:rpmSteps,source:'startup'};
    return {direction:0,driveRpm:0,source:'missing'};
  }
}
