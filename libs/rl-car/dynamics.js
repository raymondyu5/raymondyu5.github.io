// Kinematic bicycle + helpers for the browser sim
export function clamp(x, lo, hi){ return Math.min(hi, Math.max(lo, x)); }
export function wrapAngle(a){ while(a>Math.PI)a-=2*Math.PI; while(a<-Math.PI)a+=2*Math.PI; return a; }
export function lerp(a,b,t){ return a + (b-a)*t; }

export class Car {
  constructor(opts={}){
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.yaw = opts.yaw ?? 0;
    this.v = opts.v ?? 0;
    this.L = opts.L ?? 48;
    this.delta = 0;
  }
  step(deltaCmd, accelCmd, dt, params){
    const maxSteer = params.maxSteer;
    const maxAccel = params.maxAccel;
    const maxDecel = 600;
    const drag = 0.995;

    const delta = clamp(deltaCmd, -maxSteer, maxSteer);
    const a = clamp(accelCmd, -maxDecel, maxAccel);
    this.delta = delta;

    this.x += this.v * Math.cos(this.yaw) * dt;
    this.y += this.v * Math.sin(this.yaw) * dt;
    this.yaw += (this.v / this.L) * Math.tan(delta) * dt;
    this.yaw = wrapAngle(this.yaw);
    this.v += a * dt;
    this.v *= drag;
  }
}
