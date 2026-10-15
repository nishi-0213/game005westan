// Diagnose the existing hunger slowdown without changing simulation behavior.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const fs=require('node:fs');
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});try{
 const page=await browser.newPage();await page.addInitScript(()=>{let seed=42;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}});
 await page.goto('http://localhost:4175/?pawns=50&benchmark=1');await page.waitForFunction(()=>!!window.__stressTest);
 await page.evaluate(start=>{window.__stressTest.configure('free',1);window.__stressTest.simulate(start)},Number(process.env.PROFILE_START||79));
 const cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});await cdp.send('Profiler.start');await page.evaluate(()=>{if(window.__hungerDiagnostics)window.__hungerDiagnostics.enabled=true});
 const measurement=await page.evaluate(seconds=>{const start=performance.now();window.__stressTest.simulate(seconds);return {wallMs:performance.now()-start,state:window.__stressTest.state(),...(window.__hungerDiagnostics?{counters:window.__hungerDiagnostics}:{})}},Number(process.env.PROFILE_SECONDS||3));
 const {profile}=await cdp.send('Profiler.stop');fs.writeFileSync(process.env.PROFILE_RAW||'/workspace/scratch/hunger-50.cpuprofile',JSON.stringify(profile));
 const nodes=new Map(profile.nodes.map(n=>[n.id,n])),parents=new Map();for(const n of profile.nodes)for(const child of n.children||[])parents.set(child,n.id);
 const own=new Map(),inclusive=new Map();for(let i=0;i<profile.samples.length;i++){let id=profile.samples[i],dt=profile.timeDeltas[i];own.set(id,(own.get(id)||0)+dt);while(id){inclusive.set(id,(inclusive.get(id)||0)+dt);id=parents.get(id)}}
 const rows=map=>[...map].sort((a,b)=>b[1]-a[1]).slice(0,30).map(([id,time])=>{const n=nodes.get(id);return {function:n.callFrame.functionName||'(anonymous)',url:n.callFrame.url.split('/').pop(),line:n.callFrame.lineNumber+1,ms:time/1000,parent: nodes.get(parents.get(id))?.callFrame.functionName}});
 const report={measurement,totalSampleMs:profile.timeDeltas.reduce((a,b)=>a+b,0)/1000,self:rows(own),inclusive:rows(inclusive)};fs.writeFileSync(process.env.PROFILE_OUTPUT||'docs/performance/50-pawns-hunger-profile.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
