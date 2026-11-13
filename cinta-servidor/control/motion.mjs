/** Observación de movimiento para compartir entre navegadores. No regula el motor. */
import {MotorMotion} from '../shared/motor-motion.mjs';
import {EncoderMotion} from '../shared/encoder-motion.mjs';

export class ConveyorObserver {
  motion=new MotorMotion();
  feedback=new EncoderMotion();
  manualPercent=50;
  direction=0;
  now=0;
  advance(now){this.now=now;this.motion.advance(now);}
  reset(now){
    this.motion=new MotorMotion();this.feedback=new EncoderMotion();
    this.manualPercent=50;this.direction=0;this.now=now;
  }
  manual(command,now){
    if(command==='F')this.direction=1;
    if(command==='R')this.direction=-1;
    if(command==='S'||command==='E')this.direction=0;
    if(command.startsWith('V')){this.manualPercent=Number(command.slice(1));if(!this.manualPercent)this.direction=0;}
    this.now=now;this.motion.target(this.direction*this.manualPercent,now,command==='E',this.direction);
  }
  observe(raw,now){
    this.advance(now);this.feedback.observe(raw,now);
    this.motion.observe(raw,now,raw.state==='RAMP');
    if(now-this.motion.commandAt>=500){
      this.manualPercent=raw.v;this.direction=raw.dir==='FWD'?1:raw.dir==='REV'?-1:0;
    }
  }
  snapshot(){return {commandPercent:this.manualPercent,feedback:{driveRpm:this.feedback.driveRpm},motion:this.motion.snapshot(this.now)};}
}
