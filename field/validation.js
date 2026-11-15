import {startTrial,trialStatus,cancelTrial,revealTrial,reportTrials,trialRecords} from './metric.js';
import {listSites} from './storage.js';
const el=id=>document.getElementById(id);
const t=(en,zh)=>window.BridgePrefs.text(en,zh);
const query=new URLSearchParams(location.search);
let sites=[];
function measuredSections(site) {return site?.sections.filter(s=>s.calibration?.widthMm>0&&s.calibration?.heightMm>0)||[];}
function selectSections(selectedId){
  const site=sites.find(s=>s.id===el('bridge').value),rows=measuredSections(site);
  el('section').replaceChildren(...rows.map(s=>new Option(s.name,s.id)));
  if(rows.some(s=>s.id===selectedId))el('section').value=selectedId;
  selectLimit();
}
function selectLimit(){
  const site=sites.find(s=>s.id===el('bridge').value),s=measuredSections(site).find(v=>v.id===el('section').value);
  el('limit').value=s?.calibration.limitMm||5;
}
async function loadSites(){
  try{sites=(await listSites()).filter(s=>measuredSections(s).length);}
  catch{sites=[];note=t('Browser storage is unavailable.','浏览器存储暂不可用。');}
  el('bridge').replaceChildren(...sites.map(s=>new Option(s.name,s.id)));
  if(sites.some(s=>s.id===query.get('bridge')))el('bridge').value=query.get('bridge');
  selectSections(query.get('section'));render(true);
}
let filter='',lastRender='',note='';
const groups=rows=>Array.from(new Set(rows.map(groupId)));
const groupId=r=>JSON.stringify([r.bridgeId,r.sectionId,r.condition,r.thresholdMm]);
const count=n=>n===null?'—':Number(n.toFixed(2)).toLocaleString();
const percent=n=>Math.round(100*n)+'%';
function newEl(tag,content){const a=document.createElement(tag);a.textContent=content;return a;}
function route(bridgeId,sectionId){
  const u=new URL('./',location.href);
  if(bridgeId)u.searchParams.set('bridge',bridgeId);
  if(sectionId)u.searchParams.set('section',sectionId);
  return u.href;
}
function label(key){
  const [bridge,section,condition,limit]=JSON.parse(key);
  const site=sites.find(s=>s.id===bridge),member=site?.sections.find(v=>v.id===section);
  return [site?.name||bridge,member?.name||section,condition?condition.slice(-6):t('unidentified lens','未识别镜头'),limit+' mm'].join(' · ');
}
function render(force=false){
  const run=trialStatus(),all=trialRecords();
  const stamp=JSON.stringify([run?.status,Math.floor(run?.percent||0),all.length,filter,window.BridgePrefs.language,note]);
  if(!force&&lastRender===stamp)return;
  lastRender=stamp;
  el('start-pane').hidden=!!run;
  el('setup').hidden=!sites.length;el('needs-reference').hidden=sites.length>0;
  el('add-ref').href=route(query.get('bridge')||'', '');
  el('capture-pane').hidden=!run||run.status==='sealed';
  el('truth-pane').hidden=run?.status!=='sealed';
  const currentBridge=run?.bridgeId||el('bridge').value.trim(),currentSection=run?.sectionId||el('section').value.trim();
  el('field-link').href=el('go-camera').href=route(currentBridge,currentSection);
  if(run){
    el('capture-title').textContent=run.status==='armed'?t('Trial armed','等待相机'):t('Recording trial','正在采集');
    const trialSite=sites.find(v=>v.id===run.bridgeId),trialSection=trialSite?.sections.find(v=>v.id===run.sectionId);
    el('capture-note').textContent=(trialSite?.name||run.bridgeId)+' / '+(trialSection?.name||run.sectionId)+' · '+(run.status==='armed'?t('Start the field camera to record.','请打开现场相机开始采集。'):Math.round(run.percent)+'%');
    el('cancel').hidden=run.status!=='armed';
  }
  el('feedback').textContent=note;
  const filtered=all.filter(r=>(!currentBridge||r.bridgeId===currentBridge)&&(!currentSection||r.sectionId===currentSection));
  const keys=groups(filtered);
  if(!keys.includes(filter))filter=keys.at(-1)||'';
  const selector=el('group-filters');selector.replaceChildren();
  if(keys.length){
    const select=document.createElement('select');select.setAttribute('aria-label',t('Test condition','测试条件'));
    for(const key of keys){const opt=newEl('option',label(key));opt.value=key;opt.selected=key===filter;select.append(opt);}
    select.onchange=()=>{filter=select.value;render(true)};selector.append(select);
  }
  const data=filtered.filter(r=>groupId(r)===filter),cal=data.filter(r=>r.phase==='calibration'),held=data.filter(r=>r.phase==='holdout');
  const stats=el('stats'),records=el('records');
  stats.replaceChildren();records.replaceChildren();
  el('export').disabled=data.length===0||!!run;
  if(!data.length){el('scope').textContent=t('No scored physical trials for this section.','这一区段尚无已评分的实体试验。');return;}
  const m=reportTrials(held.length?held:cal);
  el('scope').textContent=t(cal.length+' calibration · '+held.length+' holdout',cal.length+' 次定标 · '+held.length+' 次独立留出')+
    ' · '+(held.length?t('Holdout results','留出集结果'):t('Calibration results','定标集结果'));
  const items=[
    [t('Error P95','误差 P95'),count(m.error95Mm)+' mm'],
    [t('Signed bias (X, Y)','有符号偏差 (X, Y)'),count(m.biasX)+', '+count(m.biasY)+' mm'],
    [t('Valid time','有效采集时长占比'),percent(m.timeCoverage)],
    [t('Valid frames','有效帧占比'),percent(m.frameCoverage)],
    [t('Holdout decision time','留出集有效判读时长占比'),held.length?percent(m.holdoutCoverage):'—'],
    [t('False alerts / zero minute','每分钟零位移误报'),count(m.falsePerMin)],
    [t('Detected / missed','检出 / 漏报'),held.length?m.detected+' / '+m.misses:'—'],
    [t('Trials with a reading','读出位移的试次'),m.validTrials+' / '+m.trials]
  ];
  for(const [name,value] of items){const card=document.createElement('div');card.className='stat';card.append(newEl('small',name),newEl('strong',value));stats.append(card);}
  for(const row of [...data].reverse()){
    const item=newEl('div',new Date(row.createdAt).toLocaleString()+' · '+(row.phase==='holdout'?t('Holdout','留出'):t('Calibration','定标'))+
      ' · '+t('Truth','真值')+' ('+count(row.truth.dxMm)+', '+count(row.truth.dyMm)+') mm · '+row.valid+'/'+row.attempts+' '+t('valid frames','有效帧'));
    item.className='record';records.append(item);
  }
}
el('setup').onsubmit=event=>{
  event.preventDefault();
  const bridgeId=el('bridge').value.trim(),sectionId=el('section').value.trim();
  try{
    startTrial({bridgeId,sectionId,thresholdMm:el('limit').valueAsNumber,physical:el('attest').checked});
    location.assign(route(bridgeId,sectionId));
  }catch{note=t('Could not arm the trial. Check the section, pending trial and browser storage.','无法建立试次，请检查区段、未结束试次及浏览器存储。');render(true);}
};
el('truth').onsubmit=event=>{
  event.preventDefault();
  try{
    const row=revealTrial({dxMm:el('true-x').valueAsNumber,dyMm:el('true-y').valueAsNumber,sourceNote:el('instrument').value.trim()});
    el('bridge').value=row.bridgeId;selectSections(row.sectionId);
    el('true-x').value='';el('true-y').value='';filter=groupId(row);note=t('Trial scored.','试次已评分。');
  }catch{note=t('Enter both displacements and a reference instrument. Browser storage must be writable.','请填写两个方向的位移与量具，并确认浏览器可保存数据。');}
  render(true);
};
el('cancel').onclick=()=>{try{cancelTrial();note='';}catch{note=t('The trial has already started.','试次已经开始。');}render(true);};
el('export').onclick=()=>{
  const runs=trialRecords().filter(v=>groupId(v)===filter);
  const body={format:'bridgelab-blind-trials-v1',source:'physical-camera',condition:JSON.parse(filter),
    calibration:reportTrials(runs.filter(t=>t.phase==='calibration')),holdout:reportTrials(runs.filter(t=>t.phase==='holdout')),runs};
  const url=URL.createObjectURL(new Blob([JSON.stringify(body,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='BridgeLab-blind-trials.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
el('bridge').addEventListener('change',()=>{selectSections();render(true);});
el('section').addEventListener('change',()=>{selectLimit();render(true);});
document.addEventListener('bridgelab:preferences',()=>render(true));window.addEventListener('storage',()=>render(true));
setInterval(()=>render(),600);render();void loadSites();
