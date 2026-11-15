import {createTracker} from './tracker.js';
import {measurePlane,captureTrialFrame,fieldCondition,qualityGate,trialStatus} from './metric.js';
import {createRun,observeRun,recordIncident,completeRun,saveRun,listSites,getSite,saveSite,exportRunFile} from './storage.js';
import {manageBaselines,workingSize,referenceFrame} from './baselines.js';
import {fieldModels,projectFieldModel,drawFieldModel} from './model-overlay.js?v=wb3';
import {makeWalk,demoId} from './walk.js';

const el=id=>document.getElementById(id),text=(en,zh)=>window.BridgePrefs.text(en,zh);
const video=el('video'),view=el('live-view'),display=view.getContext('2d');
const raw=document.createElement('canvas'),ctx=raw.getContext('2d',{willReadFrequently:true});
const tracker=createTracker(),params=new URLSearchParams(location.search);
let schematicVisible=false;
let site,sites=[],active=null,pending=false,last=null,cameraStream=null,fileUrl=null;
let notice=['',''],status=['Ready','就绪'],tone='',savedMessage=['',''],reading='',sectionName='',lastHit=null,ready=false,raf=0,epoch=0,hasFrame=false;
const initialId=params.get('bridge')||'waibaidu';
const defaultSites=[{id:'waibaidu',name:'Waibaidu Bridge',sections:[],revision:0},{id:'training-span',name:'Teaching truss',sections:[],revision:0}];
function chosenName(s){return s.id==='waibaidu'?text('Waibaidu Bridge','外白渡桥'):s.id==='training-span'?text('Teaching truss','教学桁架桥'):s.name}
function notify(en,zh){notice=[en,zh];el('notice').textContent=text(en,zh)}
function setState(en,zh,newTone=''){status=[en,zh];tone=newTone}
function render(){
  el('state').textContent=text(...status);el('state').dataset.tone=tone;
  el('notice').textContent=text(...notice);el('save-status').textContent=text(...savedMessage);
  el('empty').hidden=!!active&&hasFrame;
  el('ready-message').textContent=site?.sections.length?text('Ready for a section walk','可以开始桥段走查'):text('Create the first section reference to start a field walk.','建立第一个桥段基准，即可开始现场走查。');
  el('start').hidden=!!active;el('finish').hidden=!active;
  el('finish').textContent=active?.preview?text('Close camera','关闭相机'):text('Finish and save','结束并保存');
  el('freeze').textContent=active?.preview?text('Freeze reference frame','定格基准画面'):text('Capture a reference with the camera','用相机采集基准');
  el('freeze').disabled=pending||!!active&&!hasFrame;
  el('demo').disabled=!!active||pending||!ready;
  el('video-label').hidden=!!active;el('video-file').disabled=pending||!ready;el('start').disabled=pending||!ready;el('bridge').disabled=!!active||pending||!ready;
  const synthetic=active?.source==='synthetic',blind=active?.blind;
  el('source-type').textContent=active?(synthetic?text('Synthetic','合成演示'):active.source==='video'?text('Recorded video','实拍视频'):text('Live camera','实时相机')):'';
  el('section-name').textContent=sectionName+(schematicVisible?text(' · 3D overlay',' · 三维示意叠加'):'');el('reading').textContent=reading;
  el('count').textContent=active?.run&&!blind?text('Verified frames ','已核验帧 ')+active.run.validFrames+' / '+active.run.processedFrames:'';
  el('setup').hidden=!!active&&(active.source!=='camera'||!!active.run||blind);
  el('field-model-box').hidden=!site||!!active;
  el('tabletop-link').hidden=!!active&&!active.preview;
  if(site){el('tabletop-link').href=site.id==='training-span'?'../ar/index.html?mode=camera&bridge=training-span&v=wb4':'../target/mobile.html?v=wb4';const s=active?.blind?site.sections.find(b=>b.id===active.trial?.sectionId):lastHit?.baseline||site.sections.find(b=>b.id===params.get('section'))||site.sections.find(b=>b.calibration)||site.sections[0];
    const p=new URLSearchParams({bridge:site.id});if(s)p.set('section',s.id);
    el('validation-link').href='./validation.html?'+p;
  }
  el('last-run').hidden=!!active||!last?.saved;el('export-run').hidden=!!active||!last||last.saved;
}
function syncChooser(){
  const selected=site.id;el('bridge').replaceChildren();
  for(const s of [...defaultSites.filter(s=>!sites.some(x=>x.id===s.id)),...sites].filter(s=>s.id!==demoId))el('bridge').add(new Option(chosenName(s),s.id));
  el('bridge').value=selected;models.select(site);editor.list();
}
async function useSite(stored){
  if(active)await stop();
  sites=sites.filter(s=>s.id!==stored.id);sites.push(stored);site=stored;
  const url=new URL(location.href);url.searchParams.set('bridge',site.id);url.searchParams.delete('section');history.replaceState(null,'',url);
  lastHit=null;syncChooser();render();
}
const models=fieldModels({updated:()=>{editor.renderForm();render()}});
const editor=manageBaselines({models,getSite:()=>site,onSite:useSite,cameraFrame:()=>active?.preview&&hasFrame?referenceFrame(raw):null,openPreview:()=>start('camera',null,true),notify});
el('bridge').onchange=()=>{editor.cancel();lastHit=null;const id=el('bridge').value;site=sites.find(s=>s.id===id)||defaultSites.find(s=>s.id===id);const u=new URL(location.href);u.searchParams.set('bridge',site.id);u.searchParams.delete('section');history.replaceState(null,'',u);syncChooser();notify('','');render()};
function stopMedia(){
  if(cameraStream)cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null;video.pause();video.srcObject=null;
  if(fileUrl){video.removeAttribute('src');video.load();URL.revokeObjectURL(fileUrl);fileUrl=null}
}
function writeCheckpoint(a){
  if(!a.run)return Promise.resolve(false);
  const writing=saveRun(a.run).then(()=>true).catch(()=>{
    savedMessage=['Could not save on this device. Export the run after you finish.','设备写入失败，结束后可直接导出本次巡检。'];render();return false;
  });
  return writing;
}
async function stop(why=null){
  const a=active;if(!a)return;epoch++;active=null;cancelAnimationFrame(raf);stopMedia();
  hasFrame=false;schematicVisible=false;display.clearRect(0,0,view.width,view.height);tracker.reset();
  sectionName=reading='';lastHit=null;setState('Finished','已结束');if(why)notify(...why);
  if(a.run){
    completeRun(a.run,a.elapsed);last={run:a.run,site:a.site,saved:false};
    const record=last;el('last-run').href='./review.html?run='+encodeURIComponent(a.run.id);
    render();record.saved=await writeCheckpoint(a);
  }
  render();
}
el('finish').onclick=()=>stop();el('export-run').onclick=()=>{if(last)exportRunFile(last.run,last.site)};
async function start(source,file=null,previewRequested=false){
  if(active||pending||!ready)return;pending=true;const seq=++epoch;const startingSite=site;let walk=null,runSite=site;
  try{
    notify('','');savedMessage=['',''];setState('Opening…','正在开启…');render();editor.cancel();tracker.reset();lastHit=null;sectionName=reading='';
    const trial=trialStatus();const blind=source==='camera'&&trial?.bridgeId===site.id&&['armed','capturing','sealed'].includes(trial.status);
    if(blind&&!site.sections.some(b=>b.id===trial.sectionId&&b.calibration)){throw Error('trial-baseline')}
    if(source==='synthetic'){
      walk=makeWalk();runSite=await getSite(demoId);
      if(!runSite){try{runSite=await saveSite({...walk.site,revision:0})}catch(e){if(e.code!=='site-changed')throw e;runSite=await getSite(demoId)}}
      raw.width=walk.width;raw.height=walk.height;
    }else{
      if(source==='video'&&!site.sections.length)throw Error('no-baseline');
      if(source==='camera'){
        if(!navigator.mediaDevices?.getUserMedia)throw Error('camera-unavailable');
        cameraStream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});video.srcObject=cameraStream;
      }else{fileUrl=URL.createObjectURL(file);video.src=fileUrl;}
      await video.play();
      if(!video.videoWidth)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('video-timeout')),5000);video.addEventListener('loadeddata',()=>{clearTimeout(timer);resolve()},{once:true})});
      [raw.width,raw.height]=workingSize(video.videoWidth,video.videoHeight);
    }
    if(seq!==epoch||startingSite!==site){stopMedia();return}
    view.width=raw.width;view.height=raw.height;
    const settings=cameraStream?.getVideoTracks()[0]?.getSettings()||{};
    const preview=source==='camera'&&!blind&&(previewRequested||!runSite.sections.length);
    const run=runSite.sections.length&&!blind&&!preview?createRun(runSite,{source,frameWidth:raw.width,frameHeight:raw.height,
      camera:{width:settings.width??null,height:settings.height??null,facingMode:settings.facingMode??null,zoom:settings.zoom??null},handoffs:[]}):null;
    active={source,site:runSite,walk,run,settings,preview,blind,trial,started:performance.now(),elapsed:0,lastTime:-1,lastVideo:-1,lastCheckpoint:0,
      alerts:new Map(),conditions:new Map(),previousSection:null,lastSeen:-1,missingFrom:null,lastFrameAt:performance.now(),stalled:false};
    last=null;hasFrame=false;el('setup').open=source==='camera'&&!run&&!blind;setState('Locating','正在定位');
    if(run)await writeCheckpoint(active);
    if(blind&&trial.status==='sealed'){setState('Trial sealed','盲测已封存');notify('Open Blind test to enter the independent measurement.','请打开“盲测”录入独立实测值。')}
    if(source==='camera')cameraStream?.getVideoTracks()[0]?.addEventListener('ended',()=>{if(active?.source==='camera')stop(['The camera closed.','相机已关闭。'])},{once:true});
    raf=requestAnimationFrame(tick);
  }catch(e){
    stopMedia();setState('Ready','就绪');
    if(e.message==='trial-baseline'){notify('Choose a measured section in Blind test first.','请先在“盲测”中选择有实测尺寸的桥段。')}
    else if(e.message==='no-baseline'){el('setup').open=true;notify('Create a reference from a photo or from the camera first.','请先用照片或相机画面建立基准。')}
    else if(e.name==='NotAllowedError')notify('Camera access was denied. Allow it in your browser or open a local video.','浏览器未获相机权限。可在浏览器中允许相机，或导入本地视频。');
    else if(source==='camera')notify('The camera could not open. Check permissions and close other camera apps.','相机未能开启，请检查权限并关闭占用相机的应用。');
    else notify('Could not open this session. Check the video format or device storage.','无法开启本次巡检，请检查视频格式或设备存储。');
  }finally{pending=false;render()}
}
el('start').onclick=()=>start('camera');el('demo').onclick=()=>start('synthetic');
el('video-file').onchange=e=>{const f=e.target.files[0];e.target.value='';if(f)start('video',f)};
video.addEventListener('ended',()=>{if(active?.source==='video')stop()});
function conditionFor(a,b){
  if(a.source!=='camera'||!b)return '';
  const settings=cameraStream?.getVideoTracks()[0]?.getSettings()||{};
  const key=JSON.stringify([b.id,b.revision,settings.deviceId,settings.facingMode,settings.resizeMode,settings.zoom,settings.width,settings.height,raw.width,raw.height]);
  if(!a.conditions.has(key))a.conditions.set(key,fieldCondition({bridgeId:a.site.id,sectionId:b.id,revision:b.revision,settings,frameWidth:raw.width,frameHeight:raw.height}));
  return a.conditions.get(key);
}
function drawOverlay(hit,highlight){
  const poly=hit.observed.slice(0,4);
  display.lineWidth=1.3;display.strokeStyle='#81c6ec';display.setLineDash([5,4]);display.beginPath();
  poly.forEach(([x,y],i)=>i?display.lineTo(x,y):display.moveTo(x,y));display.closePath();display.stroke();display.setLineDash([]);
  const [x,y]=hit.predicted,[u,v]=hit.observedTarget;display.strokeStyle='#f5f5ff';display.strokeRect(x-4,y-4,8,8);
  display.strokeStyle=highlight?'#ff825f':'#59edbc';display.beginPath();display.moveTo(x,y);display.lineTo(u,v);display.stroke();
  display.beginPath();display.arc(u,v,5,0,2*Math.PI);display.stroke();
}
function sustained(a,section,kind,above,t){
  const key=section+'|'+kind;const prior=a.alerts.get(key);
  if(!above){a.alerts.delete(key);return {active:false,fresh:false}}
  const next=prior&&t-prior.last<=600?{...prior,count:prior.count+1,last:t}:{since:t,count:1,last:t,active:false};
  const old=next.active;next.active=next.count>=3&&t-next.since>=420||old;a.alerts.set(key,next);
  return {active:next.active,fresh:next.active&&!old};
}
function measure(a,hit){
  if(!hit?.ok||!hit.baseline.calibration)return null;
  return measurePlane({baseline:hit.baseline.points,observed:hit.observed,...hit.baseline.calibration});
}
function processFrame(a,stamp){
  schematicVisible=false;
  const image=ctx.getImageData(0,0,raw.width,raw.height);
  display.drawImage(raw,0,0);
  if(a.preview){setState('Camera ready','相机已就绪');return}
  const hit=tracker.observe(image,a.site.sections,stamp),m=measure(a,hit);lastHit=hit.ok?hit:null;
  if(!a.blind&&a.source==='camera'){
    const next=trialStatus();if(next?.bridgeId===a.site.id&&['armed','capturing','sealed'].includes(next.status)){stop(['A blind trial is ready. Open the camera again to collect it.','盲测已就绪，请重新开启相机开始采集。']);return}
  }
  if(a.blind){
    const expected=a.site.sections.find(s=>s.id===a.trial.sectionId);
    const step=captureTrialFrame({bridgeId:a.site.id,sectionId:a.trial.sectionId,expectedSectionId:a.trial.sectionId,
      source:'camera',measurement:hit.ok&&hit.sectionId===a.trial.sectionId?m:null,condition:conditionFor(a,expected),elapsedMs:performance.now()});
    if(!step.blind){stop(['Trial closed. The field camera can be started again.','盲测已结束，可以重新开启现场相机。']);return}
    if(step?.status==='sealed'){setState('Trial sealed','盲测已封存');notify('Open Blind test to enter the independently measured shift.','请打开“盲测”，录入独立测得的位移。')}
    else setState('Blind capture','盲测采集中');
    return;
  }
  const run=a.run,t=a.elapsed;
  observeRun(run,{t,sectionId:hit.ok?hit.sectionId:null,valid:hit.ok,checkPx:hit.ok?hit.checkPx:null,reason:hit.ok?null:hit.reason});
  if(!hit.ok){
    if(a.missingFrom===null)a.missingFrom=t;
    sectionName=reading='';a.alerts.clear();
    if(hit.reason==='ambiguous')setState('Section ambiguous','区段不唯一');
    else if(hit.reason==='target-missing')setState('Target out of view','目标不可见');
    else setState('Locating','正在定位');
    return;
  }
  const change=a.previousSection!==hit.sectionId||a.missingFrom!==null;
  if(change){
    a.alerts.clear();run.handoffs.push({t,from:a.previousSection,to:hit.sectionId,frame:raw.toDataURL('image/jpeg',.72),reacquiredAfterMs:a.missingFrom===null?null:t-a.missingFrom,overlapVerified:!!hit.overlapVerified});
    a.previousSection=hit.sectionId;a.missingFrom=null;
  }
  if(hit.overlapVerified){const h=run.handoffs.at(-1);if(h&&h.to===hit.sectionId){h.overlapVerified=true;h.overlapWith=hit.overlapWith}}
  a.lastSeen=t;sectionName=hit.baseline.name;
  const thresholdMm=hit.baseline.calibration?.limitMm;
  const condition=conditionFor(a,hit.baseline);
  const gate=m?.ok&&condition?qualityGate(m,condition,thresholdMm):null;
  const metric=!!gate?.eligible,kind=metric?'metric':'pixel',above=metric?gate.exceeds:hit.offsetPx>7;
  a.alerts.delete(hit.sectionId+'|'+(metric?'pixel':'metric'));
  const alert=sustained(a,hit.sectionId,kind,above,t);
  if(a.source!=='synthetic'&&hit.baseline.modelBinding){
    const binding=hit.baseline.modelBinding,model=models.forBinding(binding);
    const projection=projectFieldModel(model,binding,hit,raw.width,raw.height);
    if(projection){drawFieldModel(display,model,projection);schematicVisible=true}
  }
  drawOverlay(hit,alert.active);
  if(alert.active){if(metric)setState('Planar shift for review','平面位移待复核','alert');else setState('Image shift for review','图像偏移待复核','alert')}
  else setState('Tracking','跟踪中','good');
  reading=metric?m.magnitudeMm.toFixed(1)+' mm · P95 '+gate.error95Mm.toFixed(1)+' mm':hit.offsetPx.toFixed(1)+' px';
  if(alert.fresh){
    recordIncident(run,{t,kind,sectionId:hit.sectionId,targetId:'TARGET',baselineRevision:hit.baseline.revision,
      baselineFrame:hit.baseline.image,currentFrame:raw.toDataURL('image/jpeg',.85),overlayFrame:view.toDataURL('image/jpeg',.85),
      observed:hit.observedTarget,predicted:hit.predicted,width:raw.width,height:raw.height,checkPx:hit.checkPx,offsetPx:hit.offsetPx,
      dxMm:metric?m.dxMm:null,dyMm:metric?m.dyMm:null,uncertaintyMm:metric?gate.error95Mm:null,limitMm:metric?thresholdMm:null,
      limitPx:metric?null:7,method:hit.method});
  }
  if(change||alert.fresh){writeCheckpoint(a);a.lastCheckpoint=t}
}
const walkDuration=a=>a.walk.duration*1000;
function tick(now){
  const a=active;if(!a)return;
  a.elapsed=a.source==='video'?Math.max(0,video.currentTime*1000):Math.max(0,now-a.started);
  try{
    if(!document.hidden&&a.elapsed-a.lastTime>=100&&
       (a.source==='synthetic'||video.readyState>=2&&video.currentTime!==a.lastVideo)){
      if(a.source==='synthetic'){if(a.elapsed>walkDuration(a)){stop();return}a.walk.draw(ctx,a.elapsed/1000)}
      else{const [w,h]=workingSize(video.videoWidth,video.videoHeight);if(raw.width!==w||raw.height!==h){raw.width=view.width=w;raw.height=view.height=h;tracker.reset()}ctx.drawImage(video,0,0,raw.width,raw.height);a.lastVideo=video.currentTime}
      hasFrame=true;a.lastTime=a.elapsed;a.lastFrameAt=now;a.stalled=false;processFrame(a,a.elapsed);render();
    }else if(!document.hidden&&a.source!=='synthetic'&&!a.stalled&&now-a.lastFrameAt>1500){
      a.stalled=true;schematicVisible=false;tracker.reset();a.alerts.clear();sectionName=reading='';lastHit=null;setState('Waiting for video','等待新画面');display.clearRect(0,0,view.width,view.height);
      if(a.run){observeRun(a.run,{t:a.elapsed,reason:'stalled'});a.missingFrom=a.elapsed}render();
    }
    if(a.run&&a.elapsed-a.lastCheckpoint>=1500){a.lastCheckpoint=a.elapsed;writeCheckpoint(a)}
  }catch(e){console.error('Field inspection stopped',e);stop(['Processing paused after an error. Review the saved portion.','画面处理遇到错误，已停止；可复核已记录部分。']);return}
  raf=requestAnimationFrame(tick);
}
function interrupt(){
  const a=active;if(!a)return;schematicVisible=false;tracker.reset();a.alerts.clear();lastHit=null;sectionName=reading='';
  if(a.run){observeRun(a.run,{t:a.elapsed,reason:'interrupted'});a.missingFrom=a.elapsed;writeCheckpoint(a)}
  display.clearRect(0,0,view.width,view.height);setState('Waiting for video','等待新画面');render();
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)interrupt()});
window.addEventListener('pagehide',()=>{interrupt();cancelAnimationFrame(raf);stopMedia();active=null;epoch++});
window.addEventListener('pageshow',e=>{if(e.persisted){setState('Ready','就绪');render()}});
document.addEventListener('bridgelab:preferences',()=>{if(site){syncChooser();models.refresh();editor.renderForm()}render()});
async function initialize(){
  try{sites=await listSites()}catch{savedMessage=['Device storage is unavailable. Allow site data to save references and runs.','设备存储不可用，请允许网站保存数据后再建档。']}
  site=sites.find(s=>s.id===initialId&&s.id!==demoId)||defaultSites.find(s=>s.id===initialId)||defaultSites[0];ready=true;syncChooser();render();
}
initialize();
