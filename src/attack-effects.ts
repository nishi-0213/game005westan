import { Container, Graphics } from 'pixi.js';
import type { AttackEvent } from './combat';

interface Effect { view: Graphics; age: number; duration: number; vx: number; vy: number }

/** Short-lived views, drawn once and released after the simulation-time animation. */
export class AttackEffects {
  readonly view = new Container();
  private effects: Effect[] = [];
  private tileSize: number;
  constructor(tileSize: number) { this.tileSize = tileSize; this.view.eventMode = 'none'; }

  private add(view: Graphics, duration: number, vx = 0, vy = 0): void {
    this.view.addChild(view); this.effects.push({ view, duration, age: 0, vx, vy });
  }

  show(event: AttackEvent): void {
    const from = { x: (event.from.column + .5) * this.tileSize, y: (event.from.row + .5) * this.tileSize };
    const target = { x: (event.to.column + .5) * this.tileSize, y: (event.to.row + .5) * this.tileSize };
    if (event.weapon === 'rifle') {
      const angle = Math.atan2(target.y - from.y, target.x - from.x);
      const muzzle = { x: from.x + Math.cos(angle) * 9, y: from.y + Math.sin(angle) * 9 };
      const flash = new Graphics().poly([0, -3, 8, -5, 5, 0, 8, 5, 0, 3]).fill(0xffbd46)
        .poly([0, -2, 5, 0, 0, 2]).fill(0xfff4bd);
      flash.position.set(muzzle.x, muzzle.y); flash.rotation = angle;
      this.add(flash, .12);
      const end = { ...target };
      if (!event.hit) {
        const missAngle = Math.random() * Math.PI * 2, offset = (.6 + Math.random() * .9) * this.tileSize;
        end.x += Math.cos(missAngle) * offset; end.y += Math.sin(missAngle) * offset;
      }
      const tracer = new Graphics().moveTo(muzzle.x, muzzle.y).lineTo(end.x, end.y).stroke({ color: 0xffedba, width: 1.2 });
      this.add(tracer, .18);
    }
    if(event.hit&&event.target.structure){
      for(let index=0;index<5;index++){
        const star=new Graphics().poly([0,-4,1,-1,4,0,1,1,0,4,-1,1,-4,0,-1,-1]).fill(0xffdf52);
        star.position.set(target.x,target.y);const angle=index*Math.PI*2/5;
        this.add(star,.45,Math.cos(angle)*22,Math.sin(angle)*22);
      }
    }
    if (event.hit&&!event.target.structure) for (let index = 0; index < 10; index++) {
      const angle = Math.random() * Math.PI * 2, speed = 14 + Math.random() * 28;
      const particle = new Graphics().circle(0, 0, 1 + Math.random()).fill(0xdc3548);
      particle.position.set(target.x, target.y);
      this.add(particle, .45 + Math.random() * .2, Math.cos(angle) * speed, Math.sin(angle) * speed);
    }
  }

  update(seconds: number): void {
    for (let index = this.effects.length - 1; index >= 0; index--) {
      const effect = this.effects[index];
      effect.age += seconds;
      if (effect.age >= effect.duration) { effect.view.destroy(); this.effects.splice(index, 1); continue; }
      effect.view.x += effect.vx * seconds; effect.view.y += effect.vy * seconds;
      effect.view.alpha = 1 - effect.age / effect.duration;
    }
  }
}
