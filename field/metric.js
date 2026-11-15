// Plane coordinates use C1 as origin, C1 → C2 as +x and C1 → C4 as +y.
// CHECK and TARGET are never used to estimate the reference transformation.
const roles = ['C1','C2','C3','C4','CHECK','TARGET'];
const asPoints = input => Array.isArray(input) ? input : roles.map(id => input?.[id]);
const pair = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const dist = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
const turn = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const unitSquare = [[0,0],[1,0],[1,1],[0,1]];

function winding(q) {
  if (q.length !== 4 || !q.every(pair)) return 0;
  const edges = q.map((p,i) => dist(p,q[(i+1)%4]));
  const span = Math.max(dist(q[0],q[2]),dist(q[1],q[3]),...edges);
  const turns = q.map((p,i) => turn(p,q[(i+1)%4],q[(i+2)%4]));
  const direction = Math.sign(turns[0]);
  if (Math.min(...edges) < 12 || !direction || turns.some(t => t*direction < span*span*.012)) return 0;
  return direction;
}
function inside(q,p,dir) {
  return pair(p) && q.every((a,i) => dir*turn(a,q[(i+1)%4],p) >= -1e-6);
}
// Solve four point correspondences after centering and scaling both coordinate systems.
function fitMap(src,dst) {
  function normalize(points) {
    const x = points.reduce((s,p)=>s+p[0],0)/4, y = points.reduce((s,p)=>s+p[1],0)/4;
    const scale = Math.max(...points.map(p=>Math.hypot(p[0]-x,p[1]-y)));
    return {x,y,scale,points: points.map(p=>[(p[0]-x)/scale,(p[1]-y)/scale])};
  }
  const a=normalize(src), b=normalize(dst);
  const rows=[];
  a.points.forEach(([x,y],i)=>{
    const [u,v]=b.points[i];
    rows.push([x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]);
  });
  for(let k=0;k<8;k++){
    let pivot=k;
    for(let j=k+1;j<8;j++)if(Math.abs(rows[j][k])>Math.abs(rows[pivot][k]))pivot=j;
    if(Math.abs(rows[pivot][k])<1e-9)return null;
    [rows[k],rows[pivot]]=[rows[pivot],rows[k]];
    const value=rows[k][k];
    for(let j=k;j<9;j++)rows[k][j]/=value;
    for(let i=0;i<8;i++)if(i!==k){
      const factor=rows[i][k];
      for(let j=k;j<9;j++)rows[i][j]-=factor*rows[k][j];
    }
  }
  const h=rows.map(row=>row[8]).concat(1);
  for(let i=0;i<9;i+=3){
    h[i]/=a.scale; h[i+1]/=a.scale;
    h[i+2]-=h[i]*a.x+h[i+1]*a.y;
  }
  for(let i=0;i<3;i++){
    h[i]=b.scale*h[i]+b.x*h[6+i];
    h[3+i]=b.scale*h[3+i]+b.y*h[6+i];
  }
  return p=>{
    if(!pair(p))return null;
    const [x,y]=p,w=h[6]*x+h[7]*y+h[8];
    if(!Number.isFinite(w)||Math.abs(w)<1e-8)return null;
    const r=[(h[0]*x+h[1]*y+h[2])/w,(h[3]*x+h[4]*y+h[5])/w];
    return pair(r)?r:null;
  };
}
export function projectAnchors(baseline,observed) {
  const before=asPoints(baseline), now=asPoints(observed);
  const a=before.slice(0,4), b=now.slice(0,4), dir=winding(a);
  if(!dir||winding(b)!==dir||!inside(a,before[4],dir)||!inside(a,before[5],dir)||dist(before[4],before[5])<6)return null;
  const project=fitMap(a,b);
  if(!project)return null;
  const predictedCheck=project(before[4]), predictedTarget=project(before[5]);
  if(!predictedCheck||!predictedTarget)return null;
  return {predictedCheck,predictedTarget,project};
}
export function measurePlane({baseline,observed,widthMm,heightMm,checkTolerancePx=3}) {
  const before=asPoints(baseline), now=asPoints(observed), quad=now.slice(0,4);
  const fail=reason=>({ok:false,reason});
  if(![widthMm,heightMm,checkTolerancePx].every(v=>Number.isFinite(v)&&v>0))return fail('missing_scale');
  const pose=projectAnchors(before,now), dir=winding(quad);
  if(!pose||!inside(quad,now[4],dir)||!inside(quad,now[5],dir)||dist(now[4],now[5])<5)return fail('geometry');
  const checkPx=dist(now[4],pose.predictedCheck);
  if(checkPx>Math.min(3,checkTolerancePx))return {ok:false,reason:'held_out_check',checkPx};
  const box=unitSquare.map(([u,v])=>[u*widthMm,v*heightMm]);
  const map=fitMap(quad,box);
  if(!map)return fail('geometry');
  const ref=map(pose.predictedTarget), target=map(now[5]), check=map(now[4]), checkRef=map(pose.predictedCheck);
  // Local largest scale and anisotropy quantify image magnification and foreshortening.
  const [x,y]=now[5], px=map([x+1,y]), py=map([x,y+1]);
  if(![ref,target,check,checkRef,px,py].every(pair))return fail('geometry');
  const ax=px[0]-target[0],ay=px[1]-target[1],bx=py[0]-target[0],by=py[1]-target[1];
  const sum=ax*ax+ay*ay+bx*bx+by*by,det=ax*by-ay*bx;
  const hi=Math.sqrt((sum+Math.sqrt(Math.max(0,sum*sum-4*det*det)))/2);
  const shape=Math.abs(det)/(hi*hi);
  if(!Number.isFinite(hi)||hi<=0||!Number.isFinite(shape)||shape<.15)return fail('oblique_view');
  const dxMm=target[0]-ref[0],dyMm=target[1]-ref[1];
  return {ok:true,dxMm,dyMm,magnitudeMm:Math.hypot(dxMm,dyMm),checkPx,checkMm:dist(check,checkRef),mmPerPx:hi,shape};
}

const protocol='plane-v1';
const archiveKey='bridgelab.field.blind.runs.v1', activeKey='bridgelab.field.blind.active.v1';
const duration=8000, sampleGap=90, maxGap=600;
const windowId=globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2);
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const put=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
const textId=s=>typeof s==='string'&&s.length>0&&s.length<=180;
const positive=n=>Number.isFinite(n)&&n>0;
const percentile95=values=>values.length?values.slice().sort((a,b)=>a-b)[Math.ceil(.95*values.length)-1]:null;
const median=values=>{const list=values.slice().sort((a,b)=>a-b),k=list.length>>1;return list.length%2?list[k]:(list[k-1]+list[k])/2;};
export function fieldCondition({bridgeId,sectionId,revision,settings={},frameWidth,frameHeight}) {
  if(!textId(bridgeId)||!textId(sectionId)||revision===undefined||revision===null||!String(revision)||
     !textId(settings.deviceId)||![settings.width,settings.height,frameWidth,frameHeight].every(positive))return '';
  // Keep the browser camera ID private to this origin. Exports reference this opaque condition.
  const parts=[protocol,bridgeId,sectionId,String(revision),settings.deviceId,settings.facingMode||'',
    settings.width,settings.height,settings.zoom??'unknown',settings.resizeMode||'',frameWidth,frameHeight];
  let hash=14695981039346656037n;
  for(const c of new TextEncoder().encode(JSON.stringify(parts)))hash=BigInt.asUintN(64,(hash^BigInt(c))*1099511628211n);
  return protocol+'-'+hash.toString(16).padStart(16,'0');
}
export const trialRecords=()=>read(archiveKey,[]);
export function startTrial({bridgeId,sectionId,thresholdMm,physical}){
  if(trialStatus())throw Error('active');
  if(!textId(bridgeId)||!textId(sectionId)||!positive(thresholdMm)||physical!==true)throw Error('invalid_setup');
  const id=globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  const trial={id,bridgeId,sectionId,thresholdMm,protocol,source:'physical-camera',status:'armed',
    createdAt:new Date().toISOString(),samples:[],attempts:0,valid:0,condition:'',owner:'',durationMs:duration};
  put(activeKey,trial);
  return id;
}
function publicTrial(t) {
  if(!t)return null;
  return {id:t.id,status:t.status,bridgeId:t.bridgeId,sectionId:t.sectionId,thresholdMm:t.thresholdMm,
    phase:t.phase||'',startedMs:t.startedMs,percent:t.status==='sealed'?100:t.startedMs?Math.min(100,Math.max(0,(Date.now()-t.startedMs)/duration*100)):0};
}
function timedTrial(now=Date.now()){
  const t=read(activeKey,null);
  if(t?.status==='capturing'&&now-t.startedMs>=duration){
    // Choose the trial's view group while still blind to its independent displacement.
    // Additional distances/angles can build their own calibration without changing a frozen group.
    const votes=new Map();
    for(const s of samplesIn(t)){
      const cell=viewCell(s[3],s[4]);votes.set(cell,(votes.get(cell)||0)+1);
    }
    const primary=[...votes].sort((a,b)=>b[1]-a[1])[0]?.[0];
    if(primary)t.phase=Object.hasOwn(t.envelope,primary)?'holdout':'calibration';
    t.viewCell=primary||null;t.status='sealed';put(activeKey,t);
  }
  return t;
}
export const trialStatus=()=>publicTrial(timedTrial());
export function cancelTrial(){
  const t=timedTrial();
  if(!t||t.status!=='armed')throw Error('in_progress');
  localStorage.removeItem(activeKey);
}
function groupTrial(t,condition,threshold){
  return t.protocol===protocol&&t.source==='physical-camera'&&t.condition===condition&&t.thresholdMm===threshold;
}
function validSample(m){
  return m?.ok===true&&[m.dxMm,m.dyMm,m.mmPerPx,m.shape,m.checkMm].every(Number.isFinite)&&
    m.mmPerPx>0&&m.shape>0&&m.shape<=1.000001&&m.checkMm>=0;
}
function viewCell(s,shape){return Math.floor(Math.log(s)/Math.log(1.35))+':'+Math.min(3,Math.floor(shape*4));}
function samplesIn(t,cell){
  return t.samples.filter(s=>s.length===6&&(!cell||viewCell(s[3],s[4])===cell));
}
const isZero=t=>Math.hypot(t.truth.dxMm,t.truth.dyMm)===0;
const isPositive=t=>Math.hypot(t.truth.dxMm,t.truth.dyMm)>t.thresholdMm;
function supportMs(samples,predicate=()=>true) {
  let total=0;
  for(let i=1;i<samples.length;i++){
    const elapsed=samples[i][0]-samples[i-1][0];
    if(elapsed>0&&elapsed<=maxGap&&predicate(samples[i-1])&&predicate(samples[i]))total+=elapsed;
  }
  return total;
}
function cohort(runs,cell){
  const errors=[],amps=new Set();
  let minScale=Infinity,maxScale=0,minShape=Infinity,maxShape=0;
  let zero=0,positiveCount=0,worstCheck=0,largestReading=0;
  for(const t of runs){
    const valid=samplesIn(t,cell);
    if(valid.length<4||supportMs(t.samples,s=>s.length===6&&(!cell||viewCell(s[3],s[4])===cell))<duration*.4)continue;
    errors.push(percentile95(valid.map(s=>Math.hypot(s[1]-t.truth.dxMm,s[2]-t.truth.dyMm))));
    for(const s of valid){
      minScale=Math.min(minScale,s[3]);maxScale=Math.max(maxScale,s[3]);
      minShape=Math.min(minShape,s[4]);maxShape=Math.max(maxShape,s[4]);
      worstCheck=Math.max(worstCheck,s[5]);largestReading=Math.max(largestReading,Math.hypot(s[1],s[2]));
    }
    if(isZero(t))zero++;
    if(isPositive(t))positiveCount++;
    if(!isZero(t))amps.add(Math.hypot(t.truth.dxMm,t.truth.dyMm).toFixed(1));
  }
  return {ready:errors.length>=10&&zero>=3&&positiveCount>=3&&amps.size>=2,error95Mm:percentile95(errors),
    minScale,maxScale,minShape,maxShape,worstCheck,largestReading};
}
// Each cell uses errors of separate trials, including changed viewpoints and independent truth.
// Freeze the estimate at the start of the first holdout, before any holdout truth is revealed.
function makeEnvelope(records) {
  const cells=new Set();
  for(const t of records)for(const s of samplesIn(t))cells.add(viewCell(s[3],s[4]));
  return Object.fromEntries([...cells].map(cell=>[cell,cohort(records,cell)]).filter(([,v])=>v.ready));
}
function envelopeFor(sample,profile){
  if(sample.length!==6)return null;
  const cell=viewCell(sample[3],sample[4]),p=profile[cell];
  if(!p||sample[3]<p.minScale-1e-9||sample[3]>p.maxScale+1e-9||
     sample[4]<p.minShape-1e-9||sample[4]>p.maxShape+1e-9||sample[5]>p.worstCheck+.001||Math.hypot(sample[1],sample[2])>p.largestReading+1e-9)return null;
  return p;
}
function sampleEvaluation(samples,profile,threshold){
  let alerts=0,streak=0,since=0,last=-Infinity,active=false;
  const eligible=s=>{const p=envelopeFor(s,profile); return p&&p.error95Mm<threshold;};
  for(const s of samples){
    const p=envelopeFor(s,profile),t=s[0],candidate=p&&p.error95Mm<threshold&&Math.hypot(s[1],s[2])-p.error95Mm>threshold;
    if(!candidate||t-last>maxGap){streak=0;active=false;}
    if(candidate){if(!streak)since=t;streak++; if(!active&&streak>=3&&t-since>=420){active=true;alerts++;}}
    last=t;
  }
  return {alerts,eligibleMs:supportMs(samples,eligible)};
}
export function captureTrialFrame({condition,source,measurement,sectionId,bridgeId,expectedSectionId,now=Date.now()}){
  const t=timedTrial(now);
  if(!t||source!=='camera'||t.bridgeId!==bridgeId)return {blind:false,status:null};
  if(t.status==='sealed')return {blind:true,status:t.status,percent:100};
  if((expectedSectionId||sectionId)!==t.sectionId)return {blind:true,status:t.status,percent:0};
  if(t.status==='armed'){
    const runs=trialRecords().filter(v=>groupTrial(v,condition,t.thresholdMm));
    const held=runs.filter(v=>v.phase==='holdout');
    const profile=makeEnvelope(runs.filter(v=>v.phase==='calibration'));
    // First tested estimate stays frozen for each view group.
    for(const t of held.slice().reverse())Object.assign(profile,t.envelope);
    Object.assign(t,{owner:windowId,condition:condition||'',phase:Object.keys(profile).length?'holdout':'calibration',
      envelope:profile,status:'capturing',startedMs:now});
  }
  // Only the first tab's stream may write samples. A lens change remains an attempted frame.
  if(t.owner!==windowId)return {blind:true,status:t.status,percent:publicTrial(t).percent};
  const time=Math.max(0,now-t.startedMs),m=measurement;
  const valid=condition===t.condition&&sectionId===t.sectionId&&validSample(m);
  t.attempts++; if(valid)t.valid++;
  if(!t.samples.length||time-t.samples.at(-1)[0]>=sampleGap){
    t.samples.push(valid?[time,m.dxMm,m.dyMm,m.mmPerPx,m.shape,m.checkMm]:[time]);
  }
  put(activeKey,t);
  return {blind:true,status:t.status,percent:Math.min(100,time/duration*100)};
}
export function revealTrial({dxMm,dyMm,sourceNote}){
  const t=timedTrial();
  if(!t||t.status!=='sealed'||![dxMm,dyMm].every(Number.isFinite)||typeof sourceNote!=='string'||
    !sourceNote.trim()||sourceNote.length>160)throw Error('truth_required');
  t.truth={dxMm,dyMm,sourceNote:sourceNote.trim()};t.status='scored';delete t.owner;
  const runs=trialRecords();
  if(!runs.some(v=>v.id===t.id)){runs.push(t);put(archiveKey,runs);}
  localStorage.removeItem(activeKey);
  return t;
}
export function reportTrials(runs){
  let attempts=0,valid=0,allValidMs=0,zeroMs=0,falseEvents=0,detected=0,positives=0,coveredHoldoutMs=0;
  let biasX=0,biasY=0;const errors=[];
  for(const t of runs){
    attempts+=t.attempts;valid+=t.valid;
    allValidMs+=supportMs(t.samples,s=>s.length===6);
    const samples=samplesIn(t);
    if(samples.length){
      const dx=median(samples.map(s=>s[1]))-t.truth.dxMm,dy=median(samples.map(s=>s[2]))-t.truth.dyMm;
      biasX+=dx;biasY+=dy;
      errors.push(percentile95(samples.map(s=>Math.hypot(s[1]-t.truth.dxMm,s[2]-t.truth.dyMm))));
    }
    if(t.phase==='holdout'){
      const result=sampleEvaluation(t.samples,t.envelope,t.thresholdMm);
      coveredHoldoutMs+=result.eligibleMs;
      if(isZero(t)){zeroMs+=duration;falseEvents+=result.alerts;}
      if(isPositive(t)){positives++;if(result.alerts)detected++;}
    }
  }
  const durationMs=duration*runs.length,holdoutMs=runs.filter(t=>t.phase==='holdout').length*duration;
  return {trials:runs.length,validTrials:errors.length,attempts,valid,error95Mm:percentile95(errors),
    biasX:errors.length?biasX/errors.length:null,biasY:errors.length?biasY/errors.length:null,
    frameCoverage:attempts?valid/attempts:0,timeCoverage:durationMs?allValidMs/durationMs:0,
    holdoutCoverage:holdoutMs?coveredHoldoutMs/holdoutMs:0,positives,detected,misses:positives-detected,
    zeroMs,falseEvents,falsePerMin:zeroMs?falseEvents*60000/zeroMs:null};
}
function qualifiesOnHoldout(runs,cell,profile,threshold){
  const subset=[];
  for(const t of runs){
    // A trial with no usable frame has no known view cell and counts against every cell.
    if(!Object.hasOwn(t.envelope,cell))continue;
    const seen=samplesIn(t);
    if(seen.length&&!seen.some(s=>viewCell(s[3],s[4])===cell))continue;
    subset.push({...t,envelope:{[cell]:profile},samples:t.samples.map(s=>
      s.length===6&&viewCell(s[3],s[4])===cell?s:[s[0]])});
  }
  const report=reportTrials(subset),zeros=subset.filter(isZero);
  const eachZeroCovered=zeros.every(t=>sampleEvaluation(t.samples,t.envelope,t.thresholdMm).eligibleMs>=.7*duration);
  return subset.length>=6&&zeros.length>=3&&eachZeroCovered&&report.positives>=3&&report.misses===0&&
    report.falseEvents===0&&report.holdoutCoverage>=.7&&report.error95Mm!==null&&
    report.error95Mm<threshold&&profile.error95Mm<threshold;
}
const gates=new Map();
export function qualityGate(measurement,condition,thresholdMm) {
  const reject=reason=>({eligible:false,exceeds:false,error95Mm:null,reason});
  if(!validSample(measurement)||!positive(thresholdMm))return reject('invalid_measurement');
  if(!condition)return reject('unknown_camera');
  const key=condition+'/'+thresholdMm,stamp=Date.now();
  let cached=gates.get(key);
  if(!cached||stamp-cached.stamp>1500){
    const held=trialRecords().filter(v=>groupTrial(v,condition,thresholdMm)&&v.phase==='holdout');
    const profile=Object.assign({},...held.slice().reverse().map(t=>t.envelope));
    // Validate each view cell independently. Data from another cell cannot qualify this one.
    const cells={};
    for(const cell of Object.keys(profile)){
      if(qualifiesOnHoldout(held,cell,profile[cell],thresholdMm))cells[cell]=profile[cell];
    }
    cached={stamp,cells,hasHeld:held.length>0};gates.set(key,cached);
  }
  if(!cached.hasHeld||!Object.keys(cached.cells).length)return reject('needs_blind_trials');
  const m=measurement,p=envelopeFor([0,m.dxMm,m.dyMm,m.mmPerPx,m.shape,m.checkMm],cached.cells);
  if(!p)return reject('outside_tested_view');
  return {eligible:true,exceeds:Math.hypot(m.dxMm,m.dyMm)-p.error95Mm>thresholdMm,error95Mm:p.error95Mm,reason:''};
}
