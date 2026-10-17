import {Container,Graphics} from 'pixi.js';
import type {EatingWorker} from './needs';
import {renderedPosition} from './movement.ts';
export class BleedingEffects {
  readonly view=new Container();
  private clocks=new WeakMap<EatingWorker,number>();
  private particles:{view:Graphics;age:number;vx:number}[]=[];
  private readonly tileSize:number;
  constructor(tileSize:number){this.tileSize=tileSize;this.view.eventMode='none';}
  update(actors:readonly EatingWorker[],seconds:number):void {
    const elapsed=Math.max(0,seconds);
    for(let i=this.particles.length-1;i>=0;i--){
      const p=this.particles[i];p.age+=elapsed;
      if(p.age>=1){p.view.destroy();this.particles.splice(i,1);continue;}
      p.view.x+=p.vx*elapsed;p.view.y+=8*elapsed;p.view.alpha=1-p.age;
    }
    for(const actor of actors){
      if(actor.dead||actor.consumed||!actor.conditions?.some(c=>c.kind==='bleeding'&&c.seconds>0)){this.clocks.delete(actor);continue;}
      let clock=(this.clocks.get(actor)??0)+elapsed;
      if(clock>=.6){
        clock%=.6;const position=renderedPosition(actor.movement);
        for(let i=0;i<3;i++){
          const particle=new Graphics().rect(0,0,1.4,1.4).fill(i===1?0xcc2435:0x9f1526);
          particle.position.set((position.column+.5)*this.tileSize+(i-1)*2,(position.row+.5)*this.tileSize+5);
          this.view.addChild(particle);this.particles.push({view:particle,age:0,vx:(i-1)*3});
        }
      }
      this.clocks.set(actor,clock);
    }
  }
}
