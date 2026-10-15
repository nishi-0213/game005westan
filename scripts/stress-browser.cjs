// Load-test branch only. Run against `npm run preview -- --port4175` after a build.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const fs=require('node:fs'),os=require('node:os'),assert=require('node:assert/strict');
const url=process.env.PERF_URL||'http://localhost:4175';
const sampleMs=Number(process.env.PERF_SAMPLE_MS||10000);
const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]??0;};
const summarize=values=>({mean:values.reduce((a,b)=>a+b,0)/Math.max(1,values.length),p95:percentile(values,.95),max:Math.max(0,...values)});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--enable-precise-memory-info']});
 const report={timestamp:new Date().toISOString(),environment:{node:process.version,browser:browser.version(),cpu:os.cpus()[0].model,availableCpus:os.availableParallelism(),renderer:'SwiftShader software WebGL',viewport:'1280x720 DPR1',build:'production'},sampleMs,results:[]};
 try{
  for(const [scenario,speed]of [['free',1],['harvesting',1],['free',3]])for(const count of [3,100]){
   const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{let seed=42;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};});
   await page.goto(`${url}/?pawns=${count}&benchmark=1`);await page.waitForFunction(()=>!!window.__stressTest);
   const initial=await page.evaluate(()=>window.__stressTest.state());assert.equal(initial.pawns,count);assert.equal(initial.alive,count);assert.equal(initial.uniqueTiles,count);
   await page.evaluate(([scenario,speed])=>{window.__stressTest.configure(scenario,speed);window.__frames=[];window.__longTasks=[];window.__record=false;let last=performance.now();function frame(now){if(window.__record)window.__frames.push(now-last);last=now;requestAnimationFrame(frame)}requestAnimationFrame(frame);new PerformanceObserver(list=>{if(window.__record)window.__longTasks.push(...list.getEntries().map(e=>e.duration))}).observe({type:'longtask'});},[scenario,speed]);
   await page.waitForTimeout(5000);
   const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('HeapProfiler.collectGarbage');await page.waitForTimeout(500);
   const heap=async()=>{const r=await cdp.send('Performance.getMetrics');return r.metrics.find(m=>m.name==='JSHeapUsedSize').value/1024/1024;};
   const heapStart=await heap();const start=await page.evaluate(()=>{window.__stressTest.updates=[];window.__stressTest.recording=true;window.__record=true;return {now:performance.now(),state:window.__stressTest.state()}});
   await page.waitForTimeout(sampleMs);
   const end=await page.evaluate(()=>{window.__stressTest.recording=false;window.__record=false;return {now:performance.now(),state:window.__stressTest.state(),updates:window.__stressTest.updates,frames:window.__frames,longTasks:window.__longTasks}});
   await cdp.send('HeapProfiler.collectGarbage');const heapEnd=await heap();const duration=end.now-start.now;
   const result={scenario,speed,pawns:count,actualDurationMs:duration,fps:end.frames.length*1000/duration,frameMs:summarize(end.frames),updateMs:summarize(end.updates),longTasks:end.longTasks.length,longestTaskMs:Math.max(0,...end.longTasks),heapStartMB:heapStart,heapEndMB:heapEnd,simulatedSeconds:end.state.simulationSeconds-start.state.simulationSeconds,expectedSimulatedSeconds:duration/1000*speed,harvestedDuringSample:end.state.harvested-start.state.harvested,alive:end.state.alive,errors};
   report.results.push(result);console.log(JSON.stringify(result));assert.equal(end.state.alive,count);assert.deepEqual(errors,[]);
   if(count===100&&scenario==='harvesting')await page.screenshot({path:'/workspace/scratch/100-pawns-harvest.png'});
   await page.close();fs.writeFileSync('docs/performance/100-pawns-results.json',JSON.stringify(report,null,2)+'\n');
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
