import {BufferImageSource,Texture,GlProgram,Filter,UniformGroup} from 'pixi.js';
import type {Walls} from './walls';
import {buildTorchLight} from './torch-light.ts';
import {daylight} from './game-time.ts';
const vertex=`
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vLightCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
uniform vec4 uMapTransform;
void main(){
  vec2 screen=aPosition*uOutputFrame.zw+uOutputFrame.xy;
  vLightCoord=(screen-uMapTransform.xy)/(uMapTransform.z*uMapTransform.w);
  vec2 position=screen;
  position.x=position.x*(2.0/uOutputTexture.x)-1.0;
  position.y=position.y*(2.0*uOutputTexture.z/uOutputTexture.y)-uOutputTexture.z;
  gl_Position=vec4(position,0.0,1.0);
  vTextureCoord=aPosition*(uOutputFrame.zw*uInputSize.zw);
}`;
const fragment=`
in vec2 vTextureCoord;
in vec2 vLightCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uLightMap;
uniform vec3 uAmbient;
void main(){
  vec4 color=texture(uTexture,vTextureCoord);
  float inside=step(0.0,vLightCoord.x)*step(0.0,vLightCoord.y)*step(vLightCoord.x,1.0)*step(vLightCoord.y,1.0);
  float strength=texture(uLightMap,vLightCoord).r*inside;
  vec3 multiplier=mix(uAmbient,vec3(1.15,1.0,0.78),strength);
  finalColor=vec4(color.rgb*multiplier,color.a);
}`;
export class WorldLighting {
  readonly filter:Filter;
  readonly uniforms:UniformGroup;
  readonly ambient=new Float32Array([1,1,1]);
  readonly mapTransform=new Float32Array(4);
  private source:BufferImageSource;
  private walls:Walls;
  private revision=-1;
  private torches=false;
  constructor(walls:Walls){
    this.walls=walls;
    this.source=new BufferImageSource({resource:new Uint8Array(walls.mapSize*8*walls.mapSize*8*4),width:walls.mapSize*8,height:walls.mapSize*8,format:'rgba8unorm',scaleMode:'linear'});
    this.uniforms=new UniformGroup({uAmbient:{value:this.ambient,type:'vec3<f32>'},uMapTransform:{value:this.mapTransform,type:'vec4<f32>'}});
    this.filter=new Filter({glProgram:GlProgram.from({vertex,fragment,name:'world-daylight-and-torches'}),resources:{lighting:this.uniforms,uLightMap:new Texture({source:this.source}).source},resolution:'inherit'});
  }
  update(hour:number,x:number,y:number,scale:number,tileSize:number):void {
    if(this.revision!==this.walls.revision){this.revision=this.walls.revision;this.source.resource=buildTorchLight(this.walls);this.source.update();this.torches=[...this.walls.items.values()].some(s=>s.kind==='torch'&&s.state==='completed');}
    const light=daylight(hour);
    this.ambient.set([light.red,light.green,light.blue]);
    this.mapTransform.set([x,y,scale,this.walls.mapSize*tileSize]);
    this.filter.enabled=this.torches||light.red!==1||light.green!==1||light.blue!==1;
  }
}
