import {createWalkSession} from './walk-session.js?v=wb5';
import {coverRect,recordVideo,lastTake} from './walk-video.js?v=wb5';
import {bridgeHudState,bridgeHudLabel,drawBridgeHud} from './bridge-hud.js?v=wb6';

const get=id=>document.getElementById(id);
const t=(en,zh)=>window.BridgePrefs.text(en,zh);
const params=new URL(location.href).searchParams,field=params.has('site'),site=params.get('site')||'waibaidu';
const fieldLink='../field/?bridge='+encodeURIComponent(site),archiveKey=field?'site:'+site:'desktop';
const shell=get('camera-shell'),video=get('camera'),overlay=get('joint-overlay'),pen=overlay.getContext('2d');
const sampled=document.createElement('canvas'),input=sampled.getContext('2d',{willReadFrequently:true});
const options=get('options'),shutter=get('shutter'),checkbox=get('use-gps');
let stream,tracker,loadingTracker,frameRequest,recording,session,preview,watch=null;
let state='off',sourceEpoch=0,lastScan=-Infinity,lastVideoTime=-1,lastGood=false;
let lastResult=null,overlayOn=true,toast=null,resultTake=null,filmURL=null,started=0,archiveIssue=false;
let screenSize=null,displayTimer='',lastKnownStation=null,navAnnounced='';
let sessionMode='idle';
const clock=seconds=>{
  const s=Math.max(0,Math.floor(seconds||0));return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
};
const place=m=>t(m.labelEn||m.id,m.labelZh||m.id);
const px=n=>Number(n).toLocaleString(window.BridgePrefs.language,{maximumFractionDigits:1});
const meters=n=>Number.isFinite(n)?px(n)+' m':'—';
const text=(id,value)=>{const el=get(id);if(el.textContent!==value)el.textContent=value};

function refreshObservation() {
  const live=!!stream&&state==='live',locked=live&&lastResult?.ok;
  const measures=locked?(lastResult.measurements||[]):[];
  const largest=measures.reduce((a,b)=>!a||Math.abs(b.displacementPx)>Math.abs(a.displacementPx)?b:a,null);
  const alertNow=!!toast&&performance.now()<toast.until&&locked;
  const observation=get('observation'),nextState=alertNow?'alert':locked?'tracked':live?'locating':state;
  if(observation.dataset.state!==nextState)observation.dataset.state=nextState;
  const looking=field?t('Face a saved bridge section','对准已存基准的桥段'):t('Aim at the bridge model','对准电脑上的桥模');
  text('tracking-state',locked?(field?(lastResult?.modelAligned?t('Model aligned','模型已配准'):t('Section recognized','桥段已识别')):t('Model aligned','模型已对齐')):
    live?(lastGood?t('Reacquiring bridge','重新识别中'):looking):t('Inspection camera','巡检相机'));
  text('reading',largest?place(largest)+' · '+px(Math.abs(largest.displacementPx))+' px':'');
  text('guidance',live&&!locked?(field?t('Keep its fixed features in frame.','把桥段的固定特征拍入画面。'):
    t('Keep the coloured joints and nearby truss in view.','让彩色节点和周围桁架同时入镜。')):'');
  const banner=get('alert-toast');
  if(banner.hidden!==!alertNow)banner.hidden=!alertNow;
  if(alertNow){text('alert-title',t('Displacement detected','检测到形变'));text('alert-detail',place(toast)+' · '+px(toast.maxPx)+' px')}
}

function refreshControls() {
  refreshObservation();
  const live=!!stream&&state==='live';
  shell.dataset.capture=sessionMode;
  get('prompt').hidden=live||sessionMode==='finalizing';
  const info={
    off:[t('Camera is off','相机已关闭'),t('Open the rear camera to frame the bridge.','打开后置相机，对准桥梁。')],
    opening:[t('Opening camera','正在打开相机'),t('Allow access to the rear camera.','请允许网页访问后置相机。')],
    permission:[t('Camera access is off','没有相机权限'),t('Allow camera access in the browser settings, then tap to retry.','在浏览器设置中允许访问相机，再点下方重试。')],
    camera:[t('Camera unavailable','相机暂不可用'),t('Close other camera apps, then try again.','关闭其他占用相机的应用，再点下方重试。')],
    asset:[t('Bridge reference unavailable','参考模型未能载入'),t('Check your connection and tap to retry.','检查网络连接，再点下方重试。')],
    baseline:[t('Set a field baseline first','先建立现场基准'),t('Save a reference photo of this bridge section to align the model and observe changes.','保存这段桥的基准照片后，就可以对齐模型并观测形变。')],
    unsupported:[t('Video recording unavailable','当前浏览器无法录制视频'),t('Open this link in a browser supporting video recording.','请在支持视频录制的系统浏览器中打开此页。')]
  };
  if(!get('prompt').hidden){const values=info[state]||info.off;text('prompt-title',values[0]);text('prompt-body',values[1])}
  const title=sessionMode==='finalizing'?t('Finishing…','正在生成总结…'):sessionMode==='recording'?t('Finish recording','结束录制'):
    live?t('Record','开始录制'):state==='baseline'?t('Set baseline','设置基准'):state==='opening'?t('Opening…','正在打开…'):t('Open camera','打开相机');
  text('shutter-label',title);shutter.setAttribute('aria-label',title);
  shutter.disabled=state==='opening'||sessionMode==='finalizing';
  get('overlay-toggle').setAttribute('aria-pressed',String(overlayOn));
  get('last-review').hidden=!resultTake||sessionMode!=='idle';
  get('leave').href=field?fieldLink:'./index.html?v=wb5';
  get('leave').setAttribute('aria-label',field?t('Field inspection','现场巡检'):t('Desktop experiment','桌面实验'));
  get('mode-link').href=field?'./mobile.html?v=wb5':'./mobile.html?site=waibaidu&v=wb5';
  text('mode-link',field?t('Use the desktop model camera','切换到桌面模型相机'):t('Use a field baseline','切换到实桥巡检'));
  get('baseline-link').hidden=!field;get('baseline-link').href=fieldLink;
}

function paintModel(ctx,w,h,now,film=false) {
  if(lastResult?.ok&&sampled.width&&overlayOn){
    const sx=w/sampled.width,sy=h/sampled.height;
    ctx.beginPath();
    for(const [x1,y1,x2,y2] of lastResult.segments||[]){ctx.moveTo(x1*sx,y1*sy);ctx.lineTo(x2*sx,y2*sy)}
    ctx.lineJoin='round';ctx.lineWidth=Math.max(1,Math.min(w,h)*.0024);
    ctx.strokeStyle='rgba(107,252,218,.76)';ctx.stroke();
    for(const m of lastResult.measurements||[]){
      if(!m.point)continue;
      const alarm=!!toast&&now<toast.until&&toast.id===m.id;
      const [x,y]=m.point;ctx.lineWidth=Math.max(1.4,Math.min(w,h)*.004);
      ctx.beginPath();ctx.arc(x*sx,y*sy,Math.max(6,Math.min(w,h)*.015),0,2*Math.PI);
      ctx.strokeStyle=alarm?'#ffab56':'#b9ffee';ctx.stroke();
      if(alarm&&m.expected){ctx.beginPath();ctx.moveTo(m.expected[0]*sx,m.expected[1]*sy);ctx.lineTo(x*sx,y*sy);ctx.stroke()}
    }
  }
  // Keep the bridge reference and its position indicator visible throughout
  // recording. An unregistered thumbnail is not projected into the scenery.
  if(overlayOn&&stream&&(site==='waibaidu'||!field)){
    const guide=bridgeHudState(lastResult,lastKnownStation,field);
    drawBridgeHud(ctx,w,h,guide,t);
  }
  if(film&&toast&&now<toast.until){
    const size=Math.max(16,Math.round(w*.024));
    const caption=t('Displacement detected','检测到形变')+' · '+place(toast)+'  '+px(toast.maxPx)+' px';
    ctx.font='600 '+size+'px system-ui,sans-serif';
    const tw=ctx.measureText(caption).width;
    ctx.fillStyle='#30251ce8';ctx.fillRect(14,16,tw+22,size*1.7);ctx.fillStyle='#ffcd9c';
    ctx.fillText(caption,24,16+size*1.21);
  }
}

function paintOverlay(now) {
  const w=Math.round(shell.clientWidth*Math.min(2,devicePixelRatio||1));
  const h=Math.round(shell.clientHeight*Math.min(2,devicePixelRatio||1));
  if(overlay.width!==w||overlay.height!==h){overlay.width=w;overlay.height=h}
  pen.clearRect(0,0,w,h);
  paintModel(pen,w,h,now);
}
function scan(now) {
  const sw=video.videoWidth,sh=video.videoHeight,vw=shell.clientWidth,vh=shell.clientHeight;
  if(!sw||!sh||!vw||!vh||!tracker)return;
  const crop=coverRect(sw,sh,vw,vh),factor=Math.min(1,(tracker.maxFrameSide??1100)/Math.max(crop[2],crop[3]));
  const w=Math.max(2,Math.round(crop[2]*factor)),h=Math.max(2,Math.round(crop[3]*factor));
  if(sampled.width!==w||sampled.height!==h){sampled.width=w;sampled.height=h;tracker.reset?.()}
  input.drawImage(video,...crop,0,0,w,h);
  let result;
  try {result=tracker.observe(input.getImageData(0,0,w,h))}
  catch {result={ok:false}}
  lastResult=result;lastGood||=result.ok;
  if(result.ok&&Number.isFinite(result.stationM))lastKnownStation=result.stationM;
  const guide=bridgeHudState(result,lastKnownStation,field);
  const marker=guide.kind+'/'+(guide.displayStationM===null?'':Math.floor(guide.displayStationM/5))+'/'+guide.section;
  if(marker!==navAnnounced){navAnnounced=marker;text('model-location-status',bridgeHudLabel(guide,t))}
  const events=(session||preview)?.addObservation(result,now)||[];
  if(!result.ok)toast=null;
  if(events.length){const e=events.reduce((a,b)=>a.maxPx>b.maxPx?a:b);toast={...e,until:now+2900}}
  screenSize=[vw,vh];
  paintOverlay(now);refreshObservation();
}
function tick(now) {
  if(!stream)return;
  if(video.readyState>=2){
    if(screenSize&&(screenSize[0]!==shell.clientWidth||screenSize[1]!==shell.clientHeight)){lastResult=null;toast=null;lastScan=-Infinity;paintOverlay(now)}
    if(video.currentTime!==lastVideoTime&&now-lastScan>=125){
      lastVideoTime=video.currentTime;lastScan=now;scan(now);
    }
    recording?.draw(now);
  }
  if(toast&&now>=toast.until){toast=null;refreshObservation();paintOverlay(now)}
  const stamp=clock(sessionMode==='recording'?(now-started)/1000:0);
  if(displayTimer!==stamp){displayTimer=stamp;text('timer',stamp)}
  frameRequest=requestAnimationFrame(tick);
}
async function detector() {
  if(!loadingTracker)loadingTracker=(field?
    import('./field-walk-tracker.js?v=wb7').then(m=>m.createFieldWalkTracker(site)):
    import('./walk-tracker.js?v=wb5').then(m=>m.createWalkTracker())
  ).catch(e=>{loadingTracker=null;throw e});
  return loadingTracker;
}
function releaseCamera() {
  ++sourceEpoch;
  cancelAnimationFrame(frameRequest);
  stream?.getTracks().forEach(track=>track.stop());stream=null;video.srcObject=null;
  tracker?.reset?.();preview=null;lastGood=false;lastResult=null;lastKnownStation=null;navAnnounced='';toast=null;screenSize=null;
  lastScan=-Infinity;lastVideoTime=-1;
  pen.clearRect(0,0,overlay.width,overlay.height);
}
async function openCamera() {
  if(!get('review').hidden||state==='opening'||sessionMode!=='idle')return;
  releaseCamera();const token=sourceEpoch;
  state='opening';refreshControls();let pending;
  try{
    pending=await detector();
  }catch(e){
    if(token!==sourceEpoch)return;
    state=(e?.message==='missing-baseline'||e?.code==='missing-baseline')?'baseline':'asset';
    refreshControls();return;
  }
  if(token!==sourceEpoch)return;
  tracker=pending;
  try {
    const ratio=shell.clientWidth/shell.clientHeight,portrait=ratio<1;
    const opened=await navigator.mediaDevices.getUserMedia({audio:false,video:{
      facingMode:{ideal:'environment'},width:{ideal:portrait?1080:1920},height:{ideal:portrait?1920:1080},aspectRatio:{ideal:ratio}
    }});
    if(token!==sourceEpoch){opened.getTracks().forEach(tr=>tr.stop());return}
    stream=opened;video.srcObject=opened;await video.play();
    if(token!==sourceEpoch)return;
    stream.getVideoTracks()[0].addEventListener('ended',()=>{if(token===sourceEpoch)void interrupted()});
    state='live';preview=createWalkSession(performance.now());refreshControls();frameRequest=requestAnimationFrame(tick);
  }catch(e){
    if(token!==sourceEpoch)return;
    releaseCamera();state=e?.name==='NotAllowedError'?'permission':'camera';refreshControls();
  }
}

function stopGPS(){if(watch!==null){navigator.geolocation?.clearWatch(watch);watch=null}}
function syncGPS() {
  stopGPS();if(!session)return;
  if(!checkbox.checked){session.setLocationStatus('off');return}
  if(!navigator.geolocation){session.setLocationStatus('unavailable');return}
  session.setLocationStatus('waiting');
  const target=session;
  watch=navigator.geolocation.watchPosition(p=>{if(session===target)session.addPosition(p,performance.now())},e=>{
    if(session!==target)return;
    session.setLocationStatus(e.code===1?'denied':'unavailable');
  },{enableHighAccuracy:true,maximumAge:0,timeout:14000});
}
async function interrupted() {
  if(sessionMode==='recording'){await finish();return}
  if(sessionMode==='finalizing')return;
  releaseCamera();state='camera';refreshControls();
}
function startTake() {
  if(!stream||state!=='live'||sessionMode!=='idle')return;
  const at=performance.now();let next;
  try{next=recordVideo(video,stream,shell,(ctx,w,h,now)=>paintModel(ctx,w,h,now,true),()=>{if(sessionMode==='recording')void finish()})}
  catch {releaseCamera();state='unsupported';refreshControls();return}
  started=at;session=createWalkSession(at);recording=next;sessionMode='recording';toast=null;
  syncGPS();refreshControls();text('timer','00:00');
}
async function finish() {
  if(sessionMode!=='recording')return;
  sessionMode='finalizing';stopGPS();const stats=session.finish(performance.now());session=null;
  const capture=recording;recording=null;refreshControls();
  const media=await capture.stop();releaseCamera();state='off';sessionMode='idle';
  if(filmURL){URL.revokeObjectURL(filmURL);filmURL=null}
  resultTake={stats,...media,created:Date.now()};archiveIssue=false;
  void lastTake(archiveKey,resultTake).catch(()=>{archiveIssue=true;if(!get('review').hidden)renderReview()});
  showReview();
}
async function leavePage(e) {
  if(sessionMode==='finalizing'){e.preventDefault();return}
  if(sessionMode==='recording'){e.preventDefault();await finish()}
}
function showReview() {
  if(!resultTake||sessionMode!=='idle')return;
  if(options.open)options.close();
  releaseCamera();state='off';shell.hidden=true;get('review').hidden=false;
  document.body.style.overflow='auto';renderReview();get('review').scrollIntoView();
}
function renderReview() {
  const row=(title,value)=>{const el=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=title;dd.textContent=value;el.append(dt,dd);return el};
  const {stats:s,blob,created,annotated,error}=resultTake;
  text('review-date',new Date(created).toLocaleString(BridgePrefs.language==='zh'?'zh-CN':'en'));
  const unavailable={off:t('GPS off','GPS 未开启'),waiting:t('No fix','无可靠定位'),tracking:'—',poor:t('Weak GPS','信号不足'),unavailable:t('No location','定位不可用'),denied:t('No permission','未授权定位')};
  const values=[
    row(t('Recording duration','拍摄时长'),clock(s.durationS)),
    row(t('Walking distance · GPS','实走距离 · GPS'),Number.isFinite(s.realDistanceM)?meters(s.realDistanceM):unavailable[s.locationStatus]||'—')
  ];
  if(!field)values.push(row(t('Model route covered','模型巡检覆盖'),meters(s.modelDistanceM)));
  values.push(row(t('Confirmed changes','形变事件'),String(s.episodes.length)),row(t('Sites with changes','出现形变的位置'),String(s.locations.filter(i=>i.episodes>0).length)));
  if(field)values.push(row(t('Observed sites','已观测位置'),String(s.observedLocations)));
  get('summary-stats').replaceChildren(...values);
  const top=s.maxLocation;
  text('peak-description',top?place(top)+' · '+px(top.maxPx)+' px · '+clock(top.atS):
    s.observedLocations?t('No change exceeded the confirmation threshold.','已观测位置的位移均未达到确认阈值。'):
    t('No site was observed clearly enough to assess displacement.','没有取得可判断形变的清晰观测。'));
  const details=s.locations.filter(i=>i.episodes>0).map(i=>{
    const li=document.createElement('li'),name=document.createElement('strong'),v=document.createElement('span');
    name.textContent=place(i);v.textContent=px(i.maxPx)+' px · '+i.episodes+t(' events',' 次');li.append(name,v);return li;
  });
  get('locations-list').replaceChildren(...details);
  const play=get('playback'),save=get('save-film'),share=get('share-film');
  if(blob?.size){
    if(!filmURL){filmURL=URL.createObjectURL(blob);play.src=filmURL}
    play.hidden=false;save.hidden=false;save.href=filmURL;save.download=fileName();
    share.hidden=!canShare();
  }else{play.hidden=true;play.removeAttribute('src');save.hidden=true;share.hidden=true}
  const note=error?t('The camera interrupted this video.','相机中断了本次录像。'):annotated?
    t('The recording includes the visible model overlay.','录像已包含拍摄时显示的模型叠加。'):
    t('The recording contains the original camera view.','录像保存的是摄像头原始画面。');
  text('film-note',archiveIssue?note+' '+t('Save it before closing this tab.','请在关闭页面前保存视频。'):note);
}
function fileName(){const ext=resultTake.blob.type.includes('mp4')?'mp4':'webm';return 'BridgeLab-'+new Date(resultTake.created).toISOString().replace(/[:.]/g,'-')+'.'+ext}
function takeFile(){return new File([resultTake.blob],fileName(),{type:resultTake.blob.type.split(';')[0]})}
function canShare(){try{return !!(navigator.canShare&&navigator.canShare({files:[takeFile()]}))}catch{return false}}

shutter.addEventListener('click',()=>{if(sessionMode==='recording')void finish();else if(state==='baseline')location.assign(fieldLink);else if(state==='live')startTake();else void openCamera()});
get('settings').addEventListener('click',()=>options.showModal());get('options-close').addEventListener('click',()=>options.close());
get('leave').addEventListener('click',leavePage);get('mode-link').addEventListener('click',leavePage);get('baseline-link').addEventListener('click',leavePage);
get('last-review').addEventListener('click',showReview);checkbox.addEventListener('change',syncGPS);
get('overlay-toggle').addEventListener('click',()=>{overlayOn=!overlayOn;paintOverlay(performance.now());refreshControls()});
get('new-take').addEventListener('click',()=>{get('playback').pause();get('review').hidden=true;shell.hidden=false;void openCamera()});
get('share-film').addEventListener('click',async()=>{try{await navigator.share({files:[takeFile()]})}catch(e){if(e.name!=='AbortError')text('film-note',t('Use Save video to store this recording.','请点“保存视频”下载录像。'))}});
document.addEventListener('bridgelab:preferences',()=>{refreshControls();if(!get('review').hidden)renderReview();if(stream)paintOverlay(performance.now())});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&sessionMode==='recording')void finish()});
window.addEventListener('pagehide',()=>{if(sessionMode==='recording')void finish();else if(sessionMode!=='finalizing')releaseCamera()});
window.addEventListener('pageshow',e=>{if(e.persisted&&get('review').hidden){state='off';void openCamera()}});
void lastTake(archiveKey).then(saved=>{if(saved&&!resultTake){resultTake=saved;refreshControls()}}).catch(()=>{});
refreshControls();void openCamera();
