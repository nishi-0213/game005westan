// One to two in-game days (15 game minutes per simulation second).
export class Recruitment {
  remainingSeconds:number;
  private random:()=>number;
  constructor(random:()=>number=Math.random){this.random=random;this.remainingSeconds=this.interval();}
  private interval():number{return 96+this.random()*96;}
  get pending():boolean{return this.remainingSeconds===0;}
  update(seconds:number,livingPlayers:number):void {
    if(livingPlayers>5)return;
    this.remainingSeconds=Math.max(0,this.remainingSeconds-Math.max(0,seconds));
  }
  resolve():void {this.remainingSeconds=this.interval();}
  saveState():{remainingSeconds:number}{return {remainingSeconds:this.remainingSeconds};}
  restoreState(state:{remainingSeconds:number}):void{this.remainingSeconds=state.remainingSeconds;}
}
