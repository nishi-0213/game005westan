// CPU diagnosis only: production game, deterministic seed, no gameplay changes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const fs=require('node:fs');
function summarize(profile){
 const nodes=new Map(profile.nodes.map(n=>[n.id,n])),parents=new Map();for(const n of profile.nodes)for(const c of n.children||[])parents.set(c,n.id);
 const self=new Map(),inclusive=new Map(),frames=new Map();const key=id=>{const f=nodes.get(id).callFrame,k=`${f.url}:${f.lineNumber}:${f.functionName}`;frames.set(k,{function:f.functionName||'(anonymous)',file:f.url.split('/').pop(),line:f.lineNumber+1});return k;};
 for(let i=0;i<profile.samples.length;i++){let id=profile.samples[i],dt=profile.timeDeltas[i],k=key(id);self.set(k,(self.get(k)||0)+dt);const seen=new Set();while(id){k=key(id);if(!seen.has(k)){inclusive.set(k,(inclusive.get(k)||0)+dt);seen.add(k)}id=parents.get(id)}}
 const total=profile.timeDeltas.reduce((a,b)=>a+b,0)/1000;
 const rows=map=>[...map].sort((a,b)=>b[1]-a[1]).slice(0,50).map(([k,t])=>({...frames.get(k),ms:t/1000,percent:t/1000/total*100}));
 return{totalSampleMs:total,self:rows(self),inclusive:rows(inclusive)};
}
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});const results=[];try{
 for(const [scenario,speed,render]of [['free',3,false],['harvesting',1,false],['free',3,true]]){
  const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{let seed=42;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}});
  await page.goto('http://localhost:4175/?pawns=100&benchmark=1');await page.waitForFunction(()=>!!window.__stressTest);await page.evaluate(([s,speed])=>window.__stressTest.configure(s,speed),[scenario,speed]);
  if(render)await page.waitForTimeout(5000);else await page.evaluate(()=>window.__stressTest.simulate(5));
  const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});await cdp.send('Profiler.start');
  let measurement;if(render){const start=await page.evaluate(()=>({now:performance.now(),state:window.__stressTest.state()}));await page.waitForTimeout(10000);const end=await page.evaluate(()=>({now:performance.now(),state:window.__stressTest.state()}));measurement={wallMs:end.now-start.now,simulationSeconds:end.state.simulationSeconds-start.state.simulationSeconds,state:end.state};}else measurement=await page.evaluate(()=>{const before=window.__stressTest.state(),start=performance.now();window.__stressTest.simulate(10);const state=window.__stressTest.state();return{wallMs:performance.now()-start,simulationSeconds:state.simulationSeconds-before.simulationSeconds,state}});
  const {profile}=await cdp.send('Profiler.stop');fs.writeFileSync(`/workspace/scratch/load-${scenario}-${speed}-${render?'render':'simulation'}.cpuprofile`,JSON.stringify(profile));const result={scenario,speed,render,measurement,...summarize(profile),errors};results.push(result);console.log(JSON.stringify(result));if(errors.length)throw Error(errors.join('\n'));await page.close();fs.writeFileSync('docs/performance/remaining-load-profiles.json',JSON.stringify(results,null,2)+'\n');
 }
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
