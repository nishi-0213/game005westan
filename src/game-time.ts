export const GAME_MINUTES_PER_SECOND=30;
export class GameTime {
  private milliseconds:number;
  constructor(){const start=new Date(0);start.setUTCFullYear(1,0,1);start.setUTCHours(8,0,0,0);this.milliseconds=start.getTime();}
  advance(seconds:number):void {this.milliseconds+=Math.max(0,seconds)*GAME_MINUTES_PER_SECOND*60000;}
  get date():Date{return new Date(this.milliseconds);}
  get hour():number {const d=this.date;return d.getUTCHours()+d.getUTCMinutes()/60+d.getUTCSeconds()/3600+d.getUTCMilliseconds()/3600000;}
  get label():string {const d=this.date;return `${d.getUTCFullYear()}年${d.getUTCMonth()+1}月${d.getUTCDate()}日 ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;}
}
export function daylight(hour:number):{red:number;green:number;blue:number;shadowX:number;shadowY:number;shadowAlpha:number} {
  const h=((hour%24)+24)%24;
  const night=[.18,.25,.60],sunset=[1,.66,.56],day=[1,1,1];
  let a=day,b=day,t=0;
  if(h<5||h>=20){a=night;b=night;}
  else if(h<6){a=night;b=sunset;t=h-5;}
  else if(h<7){a=sunset;b=day;t=h-6;}
  else if(h>=16&&h<18){a=day;b=sunset;t=(h-16)/2;}
  else if(h>=18){a=sunset;b=night;t=(h-18)/2;}
  const lit=h>6&&h<18,angle=(h-6)/12*Math.PI;
  return {red:a[0]+(b[0]-a[0])*t,green:a[1]+(b[1]-a[1])*t,blue:a[2]+(b[2]-a[2])*t,
    shadowX:lit?-Math.cos(angle)*3:0,shadowY:lit?.2+.15*Math.abs(Math.cos(angle)):0,
    shadowAlpha:lit?.3*Math.min(1,h-6,18-h):0};
}
