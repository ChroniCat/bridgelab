import {listSites,listRunSummaries,getRun,getSite,exportRunFile,importBundle,saveHandoffLabel} from './storage.js';

const $ = id=>document.getElementById(id), l=(en,zh)=>window.BridgePrefs.text(en,zh);
const content=$('content'), picker=$('record'), notice=$('notice'), liveLink=$('field-link');
const query=new URL(location.href).searchParams;
let sites=[],runs=[],active=null,site=null,run=null,loadSerial=0,noticeState=null;
function elem(tag,text,cl) {
  const n=document.createElement(tag);
  if (text!==undefined && text!==null) n.textContent=text;
  if (cl) n.className=cl; return n;
}
function numeric(value,places=1) {
  return typeof value==='number' && Number.isFinite(value)?value.toLocaleString(document.documentElement.lang,{maximumFractionDigits:places}):'—';
}
function seconds(ms) { return numeric(ms/1000)+' s'; }
function percent(n,total) { return total>0 ? numeric(100*n/total)+'%' : '—'; }
function timeAt(ms) { const s=Math.floor(ms/1000); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }
function date(ms) { return new Date(ms).toLocaleString(document.documentElement.lang,{dateStyle:'medium',timeStyle:'short'}); }
function message(en,zh) { noticeState=[en,zh]; notice.textContent=l(en,zh); }
function failure(err) {
  if (err?.code==='label-changed') return message('A review changed in another tab. Reload before editing.','另一标签页已更新这项复核，请刷新后再编辑。');
  if (err?.code==='import-conflict') return message('This file conflicts with an existing record. Import cancelled.','文件与本机记录冲突，已取消导入。');
  if (err?.code==='invalid-bundle'||err?.code==='missing-site'||err instanceof SyntaxError) return message('Choose a BridgeLab field record exported as JSON.','请选择由 BridgeLab 导出的现场记录 JSON 文件。');
  if (err?.name==='QuotaExceededError') return message('Device storage is full. The file could not be saved.','设备存储空间不足，未能保存文件。');
  message('Local records could not be opened. Check browser storage and retry.','无法读取本机记录，请检查浏览器存储并重试。');
}
const meta = (parent,values) => { const row=elem('div',null,'details');values.forEach(v=>row.append(elem('span',v)));parent.append(row); };
function metrics(parent,rows) {
  const dl=elem('dl');
  for(const [label,value] of rows) if(value!==null && value!==undefined) dl.append(elem('dt',label),elem('dd',value));
  parent.append(dl);
}
const nodeLabel=x=>({TARGET:l('Target','测点'),CHECK:l('Check point','检查点')}[x]||x||l('Target','测点'));
const isImage = src=>typeof src==='string'&&/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src);
const xy = v=>Array.isArray(v)&&v.length===2&&v.every(Number.isFinite);
const ns='http://www.w3.org/2000/svg';
function svgNode(tag,attrs) {const el=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);return el;}
function photo(src,label,dims,observed,predicted) {
  const fig=elem('figure'),media=elem('div',null,'media');
  if (isImage(src)) {
    const img=elem('img');img.alt=label;img.loading='lazy';img.src=src; media.append(img);
    if (dims?.every(n=>Number.isFinite(n)&&n>0) && (xy(observed)||xy(predicted))) {
      const [w,h]=dims,svg=svgNode('svg',{viewBox:'0 0 '+w+' '+h,preserveAspectRatio:'none','aria-hidden':'true'});
      const weight=Math.max(1.6,w/200);
      if(xy(observed)&&xy(predicted))svg.append(svgNode('line',{x1:predicted[0],y1:predicted[1],x2:observed[0],y2:observed[1],stroke:'#fff','stroke-width':weight}));
      if(xy(predicted))svg.append(svgNode('circle',{cx:predicted[0],cy:predicted[1],r:weight*3,fill:'none',stroke:'#59daff','stroke-width':weight}));
      if(xy(observed)){const [x,y]=observed,r=weight*3;svg.append(svgNode('path',{d:'M'+(x-r)+' '+(y-r)+'l'+2*r+' '+2*r+'M'+(x-r)+' '+(y+r)+'l'+2*r+' '+(-2*r),fill:'none',stroke:'#ffb75c','stroke-width':weight}));}
      media.append(svg);
    }
  } else media.append(elem('p',l('Frame unavailable','没有保存该帧'),'empty'));
  fig.append(media,elem('figcaption',label));return fig;
}
function incidentDetails(event,view) {
  const item=elem('details'),summary=elem('summary',timeAt(event.t)+' · '+(view?.name||event.sectionId)+' · '+nodeLabel(event.targetId));
  item.dataset.eventId=event.id;item.append(summary);
  const gallery=elem('div',null,'gallery');
  gallery.append(photo(event.baselineFrame||view?.image,l('Baseline · reference target','基准画面 · 参考测点'),[view?.width,view?.height],null,view?.points?.[5]),
    photo(event.currentFrame,l('Inspection · predicted ○ / observed ×','巡检画面 · 预测位置 ○ / 实测位置 ×'),[event.width,event.height],event.observed,event.predicted));
  if (isImage(event.overlayFrame)) gallery.append(photo(event.overlayFrame,l('Recorded overlay','巡检时的叠加画面')));
  item.append(gallery);
  const mm=n=>Number.isFinite(n)?numeric(n,2)+' mm':null,px=n=>Number.isFinite(n)?numeric(n,2)+' px':null;
  metrics(item,[
    [l('Section ID','桥段编号'),event.sectionId],[l('Target ID','测点编号'),event.targetId||'TARGET'],
    [l('Observation','观测类型'),event.kind==='metric'?l('Planar displacement','平面内位移'):l('Image offset','画面偏差')],
    [l('Image offset','画面偏差'),px(event.offsetPx)],[l('Plane X / Y','平面 X / Y'),mm(event.dxMm)&&mm(event.dyMm)?mm(event.dxMm)+' / '+mm(event.dyMm):null],
    [l('Independent check','独立检查点'),px(event.checkPx)],[l('Control fit','控制点拟合误差'),px(event.controlPx)],
    [l('Threshold','触发阈值'),event.kind==='metric'?mm(event.limitMm):px(event.limitPx)],
    [l('95th percentile error','误差第 95 百分位'),mm(event.uncertaintyMm)]
  ]);
  return item;
}
function coverageSection(r) {
  const block=elem('section');block.append(elem('h3',l('Coverage','覆盖情况')));
  meta(block,[l('Verified time ','有效时间 ')+seconds(r.validMs)+' / '+seconds(r.elapsedMs)+' ('+percent(r.validMs,r.elapsedMs)+')',
    l('Unassigned time ','未归属时间 ')+seconds(r.unattributedMs),
    l('Verified frames ','有效帧 ')+r.validFrames+' / '+r.processedFrames]);
  const scroller=elem('div',null,'scroll'),table=elem('table'),head=elem('thead'),body=elem('tbody'),thead=elem('tr');
  for(const h of [l('Planned section','计划桥段'),l('Seen / verified','可见 / 有效'),l('Verified frames','有效帧'),l('Worst check','最大检查点误差')]){const th=elem('th',h);th.scope='col';thead.append(th);}
  head.append(thead);
  for(const c of Object.values(r.coverage)) {
    const row=elem('tr');row.append(elem('td',c.name),elem('td',c.frames?seconds(c.seenMs)+' / '+seconds(c.validMs):l('Unseen','未拍到')),
      elem('td',c.validFrames+' / '+c.frames),elem('td',c.maxCheckPx===null?'—':numeric(c.maxCheckPx,2)+' px'));body.append(row);
  }
  table.append(head,body);scroller.append(table);block.append(scroller);return block;
}
function handoffSection(r,s,open) {
  const block=elem('section'), moves=r.handoffs;
  if(!Array.isArray(moves)||!moves.length)return null;
  const name=id=>s.sections.find(v=>v.id===id)?.name || id;
  block.append(elem('h3',l('Section recognition','桥段识别')+' · '+moves.length));
  const labels=new Map((r.reviewLabels||[]).map(v=>[v.index,v]));
  const correct=[...labels.values()].filter(v=>v.actual===v.predicted).length;
  meta(block,[l('Confirmed ','复核正确 ')+correct,l('Wrong section ','复核错误 ')+(labels.size-correct),l('Unreviewed ','待复核 ')+(moves.length-labels.size)]);
  for(const [i,h] of moves.entries()){
    const d=elem('details'), pred=s.sections.find(v=>v.id===h.to), saved=labels.get(i);
    const id='handoff-'+i;d.dataset.eventId=id;d.open=open.has(id);
    d.append(elem('summary',timeAt(h.t)+' · '+(h.from?name(h.from)+' → ':'')+name(h.to)));
    if(isImage(h.frame)){
      const gallery=elem('div',null,'gallery');
      if(pred)gallery.append(photo(pred.image,l('Predicted section · baseline','预测桥段 · 基准图')));
      gallery.append(photo(h.frame,l('Recorded frame','识别时的画面')));d.append(gallery);
    }
    metrics(d,[[l('Predicted section','预测桥段'),name(h.to)],[l('Reacquisition','重新定位耗时'),Number.isFinite(h.reacquiredAfterMs)?seconds(h.reacquiredAfterMs):null],
      [l('Verified overlap','确认共用边'),h.overlapVerified?name(h.overlapWith):null]]);
    const label=elem('label',null,'label-choice'), actual=elem('select');
    label.append(elem('span',l('Actual section (independent review)','实际桥段（独立复核）')),actual);
    const add=(k,v)=>{const o=elem('option',v);o.value=k;actual.append(o);};
    add('pending',l('Unreviewed','未核实')); add('none',l('None of the planned sections','非计划桥段'));
    for(const v of s.sections)add('s:'+v.id,v.name||v.id);
    actual.value=saved?(saved.actual===null?'none':'s:'+saved.actual):'pending';
    actual.addEventListener('change',async()=>{
      const pick=actual.value;actual.disabled=true;
      try {
        const next=await saveHandoffLabel(r,i,pick==='pending'?undefined:pick==='none'?null:pick.slice(2),saved||null);
        r.reviewLabels=(r.reviewLabels||[]).filter(v=>v.index!==i);
        if(next)r.reviewLabels.push(next);
        if(run===r)render();
      }catch(err){failure(err);actual.value=saved?(saved.actual===null?'none':'s:'+saved.actual):'pending';}
      finally{actual.disabled=false;}
    });
    d.append(label);block.append(d);
  }
  return block;
}
function baselineContent(s) {
  content.append(elem('h2',s.name),elem('p',l('Baseline revision ','基准版本 ')+s.revision,'muted'));
  const part=elem('section'),gallery=elem('div',null,'gallery');part.append(elem('h3',l('Reference views','基准画面')));
  for(const v of s.sections)gallery.append(photo(v.image,v.name||v.id,[v.width,v.height],null,v.points?.[5]));
  part.append(gallery);content.append(part);
}
function render() {
  const open=new Set([...content.querySelectorAll('details[open]')].map(d=>d.dataset.eventId));
  content.replaceChildren();picker.replaceChildren();
  const runGroup=elem('optgroup');runGroup.label=l('Inspections','巡检');
  const siteGroup=elem('optgroup');siteGroup.label=l('Latest baselines','最新基准');
  for(const r of runs){const o=elem('option',(r.siteName||r.siteId)+' · '+date(r.startedAt));o.value='r:'+r.id;runGroup.append(o);}
  for(const s of sites){const o=elem('option',s.name+' · v'+s.revision);o.value='s:'+s.id;siteGroup.append(o);}
  if(runs.length)picker.append(runGroup);if(sites.length)picker.append(siteGroup);
  $('switcher').hidden=!picker.options.length;picker.value=active||'';$('export').hidden=!site;
  if(noticeState)notice.textContent=l(...noticeState);
  liveLink.href=site?'./?bridge='+encodeURIComponent(site.id):'./';
  if (!site) {
    content.append(elem('p',l('Completed inspections and saved baselines appear here on this device.','本机保存的巡检记录和基准会显示在这里。'),'empty'));
    const start=elem('a',l('Open field inspection','打开现场巡检'),'link');start.href='./';content.append(start);return;
  }
  if (!run) { baselineContent(site);return; }
  const title=elem('div',null,'run-heading');title.append(elem('h2',run.siteName||site.name));
  title.append(elem('span',run.status==='complete'?l('Completed','已完成'):l('Open checkpoint','未结束的记录'),'muted'));
  content.append(title);
  const source=({camera:l('Live camera','现场相机'),video:l('Video file','视频文件'),synthetic:l('Synthetic input','合成输入')})[run.source];
  meta(content,[date(run.startedAt),l('Baseline v','基准 v')+run.siteRevision,...(source?[source]:[])]);
  content.append(coverageSection(run));
  const handoffs=handoffSection(run,site,open);if(handoffs)content.append(handoffs);
  const block=elem('section');block.append(elem('h3',l('Alerts','提醒')+' · '+run.incidents.length));
  if(!run.incidents.length)block.append(elem('p',l('No alerts recorded.','本次没有记录提醒。'),'muted'));
  for(const e of run.incidents){const d=incidentDetails(e,site.sections.find(s=>s.id===e.sectionId));d.open=open.has(e.id);block.append(d);}
  content.append(block);
}
async function select(value,updateUrl=true) {
  const stamp=++loadSerial;
  try {
    const record=value?.startsWith('r:')?await getRun(value.slice(2)):null;
    const base=record?await getSite(record.siteId,record.siteRevision):value?.startsWith('s:')?await getSite(value.slice(2)):null;
    if(stamp!==loadSerial)return;
    active=value;run=record;site=base;render();content.setAttribute('aria-busy','false');
    if(updateUrl){const u=new URL(location.href);u.searchParams.delete('run');u.searchParams.delete('site');
      if(site)u.searchParams.set(run?'run':'site',run?.id||site.id);history.replaceState(null,'',u);}
  } catch(err){if(stamp===loadSerial){site=null;run=null;active=null;render();content.setAttribute('aria-busy','false');failure(err);}}
}
async function load(preferred=null) {
  try {
    [sites,runs]=await Promise.all([listSites(),listRunSummaries()]);
    let key=preferred;
    if (!key) key=runs[0]?'r:'+runs[0].id:sites[0]?'s:'+sites[0].id:null;
    if (key && !(key.startsWith('r:')?runs:sites).some(v=>v.id===key.slice(2))) {
      message('This record is not on this device. Import its JSON file to review it.','本机没有该记录，可导入对应的 JSON 文件查看。');key=null;
    }
    await select(key,false);
  } catch(err){render();content.setAttribute('aria-busy','false');failure(err);}
}
picker.addEventListener('change',()=>select(picker.value));
$('export').addEventListener('click',()=>{if(site)exportRunFile(run,site);});
$('import').addEventListener('click',()=>$('file').click());
$('file').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;e.target.value='';$('import').disabled=true;
  try {
    const result=await importBundle(JSON.parse(await file.text()));
    message('Opened '+result.sites+' new baseline revision(s) and '+result.runs+' new run(s).','已导入 '+result.sites+' 个新基准版本、'+result.runs+' 条新巡检记录。');
    await load(result.runId?'r:'+result.runId:'s:'+result.siteId);await select(active);
  } catch(err){failure(err);} finally{$('import').disabled=false;}
});
document.addEventListener('bridgelab:preferences',render);
load(query.has('run')?'r:'+query.get('run'):query.has('site')?'s:'+query.get('site'):null);
