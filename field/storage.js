// Local field notebooks. A run always points at the exact site revision it used.
const DB_NAME = 'bridgelab-field-records-v1';
const bundleFormat = 'bridgelab-field-bundle-v1';
let connection;

function fault(code) {
  return Object.assign(new Error(code), {code});
}
function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function db() {
  if (!connection) connection = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(fault('storage-unavailable')); return; }
    const open = indexedDB.open(DB_NAME, 3);
    open.onupgradeneeded = () => {
      const store=(name,keyPath)=>{
        if (!open.result.objectStoreNames.contains(name)) open.result.createObjectStore(name,{keyPath});
      };
      store('sites',['id','revision']); store('heads','id'); store('runs','id'); store('events',['runId','id']); store('labels',['runId','index']);
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      database.onversionchange = () => { database.close(); connection = null; };
      resolve(database);
    };
  }).catch(e => { connection = null; throw e; });
  return connection;
}
async function transaction(stores, mode, fn) {
  const database = await db(), tx = database.transaction(stores,mode);
  const done = new Promise((resolve,reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || fault('transaction-aborted'));
    tx.onerror = () => { /* onabort owns transaction failure */ };
  });
  try {
    const value = await fn(tx);
    await done;
    return value;
  } catch (error) {
    try { tx.abort(); } catch { /* already settled */ }
    await done.catch(() => {});
    throw error;
  }
}
function validId(v) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= 256 && !['__proto__','constructor','prototype'].includes(v);
}
function isRecord(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function validSite(site) {
  if (!isRecord(site) || !validId(site.id) || typeof site.name !== 'string' || !Array.isArray(site.sections)) return false;
  return new Set(site.sections.map(s=>s?.id)).size === site.sections.length && site.sections.every(s=>validId(s?.id));
}
function revision(v) { return Number.isSafeInteger(v) && v > 0; }
const finite = n => typeof n === 'number' && Number.isFinite(n);
const copy = value => JSON.parse(JSON.stringify(value));
export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36)+'-'+Array.from(crypto.getRandomValues(new Uint32Array(3)),i=>i.toString(36)).join('');
}
export function saveSite(site) {
  if (!validSite(site)) throw fault('invalid-site');
  const draft = copy(site);
  return transaction(['sites','heads'],'readwrite', async tx => {
    const heads=tx.objectStore('heads'), sites=tx.objectStore('sites');
    const head=await request(heads.get(draft.id));
    if ((head?.revision ?? 0)!==(draft.revision ?? 0)) throw fault('site-changed');
    const value={...draft,revision:(head?.revision ?? 0)+1,updatedAt:Date.now()};
    await request(sites.add(value));
    await request(heads.put({id:value.id,revision:value.revision}));
    return value;
  });
}
export function listSites() {
  return transaction(['sites','heads'],'readonly',async tx => {
    const heads=await request(tx.objectStore('heads').getAll()), sites=tx.objectStore('sites');
    const values=await Promise.all(heads.map(h=>request(sites.get([h.id,h.revision]))));
    return values.sort((a,b)=>b.updatedAt-a.updatedAt);
  });
}
export function getSite(id, version) {
  return transaction(['sites','heads'],'readonly',async tx=>{
    const v=version ?? (await request(tx.objectStore('heads').get(id)))?.revision;
    return v ? request(tx.objectStore('sites').get([id,v])) : undefined;
  });
}
function makeCoverage(section) {
  return {id:section.id,name:section.name||section.id,frames:0,validFrames:0,seenMs:0,validMs:0,visits:0,maxCheckPx:null};
}
export function createRun(site, options={}) {
  if (!validSite(site) || !revision(site.revision)) throw fault('invalid-site');
  const time=Date.now();
  return {format:'bridgelab-field-run-v1',...copy(options),id:newId(),siteId:site.id,
    siteName:site.name,siteRevision:site.revision,startedAt:time,updatedAt:time,status:'open',
    elapsedMs:0,processedFrames:0,validFrames:0,validMs:0,unlocatedFrames:0,unattributedMs:0,
    coverage:Object.fromEntries(site.sections.map(s=>[s.id,makeCoverage(s)])),
    incidents:[],rejections:{},previous:null,sequence:0};
}
export function observeRun(run,{t,sectionId=null,valid=false,checkPx=null,reason=null}) {
  if (run.status!=='open' || !finite(t) || t < run.elapsedMs || t < 0) return;
  const current = Object.hasOwn(run.coverage,sectionId) ? run.coverage[sectionId] : null;
  const prev = run.previous;
  // Credit time only when both bounding frames support that interval. Gaps and
  // handoffs stay in the whole-run denominator, never in verified coverage.
  const dt=t-run.elapsedMs;
  if (prev && prev.sectionId===current?.id && dt<=1500 && current) {
    current.seenMs+=dt;
    if (valid && prev.valid) { current.validMs+=dt; run.validMs+=dt; }
  } else { run.unattributedMs+=dt; }
  run.elapsedMs=t;
  run.processedFrames++;
  if (current) {
    current.frames++;
    if (prev?.sectionId!==current.id) current.visits++;
    if (valid) { current.validFrames++; run.validFrames++; }
    if (finite(checkPx)) current.maxCheckPx=Math.max(current.maxCheckPx??0,checkPx);
  } else run.unlocatedFrames++;
  if (reason && validId(reason) && !valid) run.rejections[reason]=(Object.hasOwn(run.rejections,reason)?run.rejections[reason]:0)+1;
  run.previous={sectionId:current?.id??null,valid:!!current&&!!valid};
  run.sequence++;
  run.updatedAt=Date.now();
}
export function recordIncident(run,event) {
  if (run.status!=='open' || !isRecord(event) || !Object.hasOwn(run.coverage,event.sectionId) || !finite(event.t)) throw fault('invalid-event');
  const item={...copy(event),id:newId()};
  run.incidents.push(item); run.sequence++; run.updatedAt=Date.now(); return item;
}
export function completeRun(run,t=run.elapsedMs) {
  if (run.status!=='open') return run;
  if (finite(t) && t>run.elapsedMs) { run.unattributedMs+=t-run.elapsedMs; run.elapsedMs=t; }
  run.status='complete'; run.previous=null; run.endedAt=run.updatedAt=Date.now(); run.sequence++; return run;
}
function validRun(run) {
  if (!isRecord(run) || run.format!=='bridgelab-field-run-v1' || !validId(run.id) || !validId(run.siteId)
      || !revision(run.siteRevision) || !['open','complete'].includes(run.status)
      || !Number.isSafeInteger(run.sequence) || run.sequence < 0 || !finite(run.startedAt) || !finite(run.updatedAt)
      || !isRecord(run.coverage) || !Array.isArray(run.incidents) ||
      (run.handoffs!==undefined && (!Array.isArray(run.handoffs)||run.handoffs.some(h=>!isRecord(h)||!finite(h.t)||h.t<0||!Object.hasOwn(run.coverage,h.to))))) return false;
  const counts=['elapsedMs','processedFrames','validFrames','validMs','unlocatedFrames','unattributedMs'];
  if (counts.some(k=>!finite(run[k])||run[k]<0)) return false;
  for (const [id,c] of Object.entries(run.coverage)) {
    if (!validId(id)||!isRecord(c)||c.id!==id||typeof c.name!=='string'||['frames','validFrames','seenMs','validMs','visits'].some(k=>!finite(c[k])||c[k]<0)) return false;
  }
  return new Set(run.incidents.map(e=>e?.id)).size===run.incidents.length && run.incidents.every(e=>isRecord(e)&&validId(e.id)&&!e.id.startsWith('@handoff:')&&finite(e.t)&&Object.hasOwn(run.coverage,e.sectionId));
}
// Persist frames once. Frequent checkpoints update counters without rewriting
// all prior JPEGs; events and their ordered index commit in the same transaction.
function parts(run) {
  const {incidents,handoffs,reviewLabels,...metadata}=run;
  const handoffInfo=handoffs?handoffs.map(({frame,...details})=>copy(details)):null;
  return {metadata:{...copy(metadata),handoffInfo,incidentIds:incidents.map(e=>e.id)},events:incidents.slice(),handoffs:handoffs?.slice()||[]};
}
async function writeParts(tx,snapshot,prior) {
  const {metadata,events,handoffs}=snapshot;
  const known=new Set(prior?.incidentIds||[]);
  const store=tx.objectStore('events');
  for (const e of events) {
    if (!known.has(e.id)) await request(store.add({runId:metadata.id,id:e.id,value:e}));
  }
  for (let i=prior?.handoffInfo?.length||0;i<handoffs.length;i++) {
    await request(store.add({runId:metadata.id,id:'@handoff:'+i,value:handoffs[i]}));
  }
  await request(tx.objectStore('runs').put(metadata));
}
async function readFull(tx,row) {
  if (!row || !Array.isArray(row.incidentIds)) return row;
  const {incidentIds,handoffInfo,...metadata}=row,store=tx.objectStore('events');
  const rows=await Promise.all(incidentIds.map(id=>request(store.get([row.id,id]))));
  if (rows.some(v=>!v)) throw fault('missing-event');
  const result={...metadata,incidents:rows.map(v=>v.value)};
  if (Array.isArray(handoffInfo)) {
    const ids=handoffInfo.map((_,i)=>[row.id,i]);
    const [moves,labels]=await Promise.all([
      Promise.all(ids.map(([rid,i])=>request(store.get([rid,'@handoff:'+i])))),
      Promise.all(ids.map(key=>request(tx.objectStore('labels').get(key))))
    ]);
    if (moves.some(v=>!v)) throw fault('missing-event');
    result.handoffs=moves.map((v,i)=>({...v.value,...handoffInfo[i]}));
    if (labels.some(Boolean)) result.reviewLabels=labels.filter(Boolean);
  }
  return result;
}
export function saveRun(run) {
  if (!validRun(run)) throw fault('invalid-run');
  const snapshot=parts(run), checkpoint=snapshot.metadata;
  return transaction(['sites','runs','events'],'readwrite',async tx=>{
    const runs=tx.objectStore('runs'), sites=tx.objectStore('sites');
    if (!await request(sites.count([checkpoint.siteId,checkpoint.siteRevision]))) throw fault('missing-site');
    const prior=await request(runs.get(checkpoint.id));
    if (prior && (prior.status==='complete' || prior.sequence>=checkpoint.sequence)) return;
    await writeParts(tx,snapshot,prior);
  });
}
export function getRun(id) {
  return transaction(['runs','events','labels'],'readonly',async tx=>readFull(tx,await request(tx.objectStore('runs').get(id))));
}
export function listRunSummaries() {
  return transaction(['runs'],'readonly',async tx=>{
    const list=(await request(tx.objectStore('runs').getAll())).sort((a,b)=>b.startedAt-a.startedAt);
    return list.map(({id,siteId,siteName,siteRevision,startedAt,status})=>({id,siteId,siteName,siteRevision,startedAt,status}));
  });
}
export function listRuns() {
  return transaction(['runs','events','labels'],'readonly',async tx=>{
    const rows=(await request(tx.objectStore('runs').getAll())).sort((a,b)=>b.startedAt-a.startedAt);
    return Promise.all(rows.map(row=>readFull(tx,row)));
  });
}
export function bundleFor(run,site) {
  if (!validSite(site)||!revision(site.revision)|| (run&&(!validRun(run)||run.siteId!==site.id||run.siteRevision!==site.revision))) throw fault('invalid-bundle');
  const {reviewLabels,...rawRun}=run||{};
  return {format:bundleFormat,version:1,sites:[site],runs:run?[rawRun]:[],reviews:reviewLabels||[]};
}
export function downloadJson(bundle,filename) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(bundle)],{type:'application/json'}));
  const a=document.createElement('a'); a.href=url; a.download=filename; document.body.append(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
export function exportRunFile(run,site) { downloadJson(bundleFor(run,site),'BridgeLab-'+(run?.id||site.id)+'.json'); }
function canonical(o) {
  if (Array.isArray(o)) return o.map(canonical);
  if (!isRecord(o)) return o;
  return Object.fromEntries(Object.keys(o).sort().map(k=>[k,canonical(o[k])]));
}
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export async function importBundle(bundle) {
  if (bundle?.format!==bundleFormat || bundle.version!==1 || !Array.isArray(bundle.sites)||!Array.isArray(bundle.runs)||!bundle.sites.length||
      (bundle.reviews!==undefined && !Array.isArray(bundle.reviews))||!bundle.sites.every(s=>validSite(s)&&revision(s.revision))||!bundle.runs.every(validRun)) throw fault('invalid-bundle');
  const belongs=(s,r)=>s.id===r.siteId && s.revision===r.siteRevision && Object.keys(r.coverage).length===s.sections.length &&
    s.sections.every(v=>Object.hasOwn(r.coverage,v.id));
  if (bundle.runs.some(r=>!bundle.sites.some(s=>belongs(s,r)))) throw fault('missing-site');
  return transaction(['sites','heads','runs','events','labels'],'readwrite',async tx=>{
    const sites=tx.objectStore('sites'),heads=tx.objectStore('heads'),runs=tx.objectStore('runs');
    let siteCount=0,runCount=0;
    // Immutable archives. A collision aborts the whole transaction so no existing field
    // record gets silently replaced by an import with the same IDs and different bytes.
    for (const site of bundle.sites) {
      const current=await request(sites.get([site.id,site.revision]));
      if (current && !same(current,site)) throw fault('import-conflict');
      if (!current) { await request(sites.add(site)); siteCount++; }
      const h=await request(heads.get(site.id));
      if (!h||h.revision<site.revision) await request(heads.put({id:site.id,revision:site.revision}));
    }
    for (const run of bundle.runs) {
      const current=await readFull(tx,await request(runs.get(run.id)));
      const {reviewLabels,...raw}=current||{};
      if (current && !same(raw,run)) throw fault('import-conflict');
      if (!current) { await writeParts(tx,parts(run),null); runCount++; }
    }
    for (const label of bundle.reviews||[]) {
      const run=bundle.runs.find(r=>r.id===label?.runId);
      if (!validLabel(label,run)) throw fault('invalid-bundle');
      const labels=tx.objectStore('labels'), prior=await request(labels.get([label.runId,label.index]));
      if (prior && !same(prior,label)) throw fault('import-conflict');
      if (!prior) await request(labels.add(label));
    }
    return {sites:siteCount,runs:runCount,siteId:bundle.sites[0].id,runId:bundle.runs[0]?.id};
  });
}

function validLabel(label,run) {
  const h=run?.handoffs?.[label?.index];
  return isRecord(label)&&run?.id===label.runId&&Number.isInteger(label.index)&&!!h&&
    h.t===label.t&&h.to===label.predicted&&finite(label.updatedAt)&&
    (label.actual===null || (typeof label.actual==='string'&&Object.hasOwn(run.coverage,label.actual)));
}
export function saveHandoffLabel(run,index,actual,priorLabel=null) {
  const move=run.handoffs?.[index];
  if (!move) throw fault('invalid-event');
  return transaction(['labels','runs','events'],'readwrite',async tx=>{
    const store=tx.objectStore('labels'), key=[run.id,index];
    const [record,savedMove,current]=await Promise.all([
      request(tx.objectStore('runs').get(run.id)), request(tx.objectStore('events').get([run.id,'@handoff:'+index])), request(store.get(key))
    ]);
    if (!record||!savedMove||savedMove.value.t!==move.t||savedMove.value.to!==move.to||!same(current??null,priorLabel)) throw fault('label-changed');
    if (actual===undefined) { await request(store.delete(key)); return null; }
    const label={runId:run.id,index,t:move.t,predicted:move.to,actual,updatedAt:Date.now()};
    if(!validLabel(label,run)) throw fault('invalid-event');
    await request(store.put(label)); return label;
  });
}
