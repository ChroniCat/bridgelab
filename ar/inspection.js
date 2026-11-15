import {grayFrame,trackPoint,project} from './vision.js';
import {registerFrame,captureReference} from './auto.js';
import {replayModel,replaySize,replayK,replaySeeds,drawReplay} from './replay.js';
import {compare,assessAlert,limitPx,tolerancePx} from './measure.js';

const el=id=>document.getElementById(id);
const video=el('camera'),view=el('view'),ctx=view.getContext('2d',{alpha:false});
const raw=document.createElement('canvas'),camera=raw.getContext('2d',{willReadFrequently:true,alpha:false});
const query=new URLSearchParams(location.search);
const replay=query.get('mode')==='replay'||query.get('replay')==='1';
const status=el('status'),hint=el('hint');
let generation=0,running=false,raf=0,stream=null,model,K,session=null;
let prior=null,previous=null,tracked=new Map(),alertHistory=new Map(),reference=null;
let lastScan=-Infinity,lastFrameAt=0,videoTime=-1,clockStart=0,hasLock=false,frameCount=0;

const messages={
  'Ready':'就绪','Unavailable':'暂不可用','Stopped':'已结束','Loading replay':'正在加载回放',
  'Opening camera':'正在打开相机','Locating':'正在定位','Tracking':'跟踪中','Deviation detected':'发现偏差',
  'Synthetic camera sequence.':'合成视频序列。','Synthetic camera sequence · 8 m truss':'合成视频 · 8 米桁架',
  'Allow access to the rear camera.':'请允许使用后置摄像头。','Matching the reference view.':'正在匹配参考画面。',
  'Keep all six board markers in view.':'请让测试板上的六个标记都出现在画面中。',
  'Board aligned · image-plane measurement':'测试板已对齐 · 图像平面测量',
  'Inspection stopped':'巡检已结束','Waiting for a fresh frame.':'正在等待新画面。',
  'Waiting for a fresh camera frame.':'正在等待新的相机画面。',
  'The replay reference could not be initialized.':'回放参考画面加载失败。',
  'Open this page in a browser with HTTPS camera access.':'请使用支持相机访问的浏览器，通过 HTTPS 打开此页。',
  'The camera closed. Start it again to resume.':'相机已关闭，请重新开启以继续。',
  'Could not load the test board model.':'测试板模型加载失败。',
  'Allow camera access in your browser, then select Start camera.':'请在浏览器中允许使用相机，再点“开启相机”。',
  'No camera was found. You can watch the replay instead.':'未检测到相机，你可以观看回放。',
  'The camera is in use. Close the other camera app and retry.':'相机被占用，请关闭其他正在使用相机的应用后重试。',
  'The video frame could not be processed. Restart to try again.':'当前画面处理失败，请重新开始。',
  'Could not start the inspection. Please try again.':'巡检启动失败，请重试。',
};
const text=(en,zh)=>window.BridgePrefs.text(en,zh);
const translate=msg=>text(msg,messages[msg]);
let displayState={title:'Ready',kind:'idle',message:replay?'Synthetic camera sequence · 8 m truss':'Keep all six board markers in view.',offset:null};
function paintState(){
  const {title,kind,message,offset}=displayState;
  const nextStatus=translate(title);
  const nextHint=offset===null?translate(message):text(
    `Target offset ${offset} px · trigger ${limitPx} px`,
    `目标偏差 ${offset} px · 阈值 ${limitPx} px`);
  if(status.textContent!==nextStatus)status.textContent=nextStatus;
  status.dataset.state=kind;
  if(hint.textContent!==nextHint)hint.textContent=nextHint;
}
function paintStats(){
  const frames=session?.verifiedFrames||0,alerts=session?.alerts||0;
  el('stats').textContent=session?.processedFrames
    ?text(`${frames} verified ${frames===1?'frame':'frames'} · ${alerts} ${alerts===1?'alert':'alerts'}`,`已核验 ${frames} 帧 · ${alerts} 次提醒`)
    :text('No frames yet.','暂无画面记录。');
}
function renderLanguage(){
  const title=replay?text('Truss replay','桁架回放'):text('Board inspection','测试板巡检');
  el('title').textContent=title;
  document.title=title+' · BridgeLab';
  el('switch-label').textContent=replay?text('Try live camera','试用相机'):text('Watch replay','观看回放');
  el('start').textContent=replay?text('Play replay','播放回放'):text('Start camera','开启相机');
  paintState();paintStats();
}
if(replay){el('switch').href='?mode=camera';el('board').hidden=true}
document.addEventListener('bridgelab:preferences',renderLanguage);
renderLanguage();

function setState(title,kind,message,offset=null) {
  displayState={title,kind,message,offset};
  paintState();
}
function resetTracking() {
  prior=null;previous=null;tracked.clear();alertHistory.clear();hasLock=false;lastScan=-Infinity;
}
function record(type,details={}) {
  if(!session)return;
  if(session.events.length>=2000){session.omittedEvents++;return;}
  session.events.push({timeMs:Math.round(performance.now()-clockStart),type,...details});
}
function size(width,height) {
  const ratio=Math.min(1,640/Math.max(width,height));
  raw.width=view.width=Math.max(1,Math.round(width*ratio));
  raw.height=view.height=Math.max(1,Math.round(height*ratio));
  K=replay?replayK:{fx:.95*Math.max(raw.width,raw.height),fy:.95*Math.max(raw.width,raw.height),cx:raw.width/2,cy:raw.height/2};
  if(session)session.processingSize=[raw.width,raw.height];
}
function setupReplay() {
  size(...replaySize);
  const baseline=drawReplay(camera,0),seeds=new Map();
  for(const id of replaySeeds) {
    const [x,y]=baseline.get(id);
    seeds.set(id,{x:Math.round(x),y:Math.round(y),score:1});
  }
  // Only the reference capture uses the synthetic fixture labels.
  reference=captureReference({frame:grayFrame(camera.getImageData(0,0,raw.width,raw.height)),model,K,tracks:seeds,sectionId:'all'});
  if(!reference)throw Error('The replay reference could not be initialized.');
}
function stop(reason='Inspection stopped',failed=false) {
  ++generation;running=false;cancelAnimationFrame(raf);
  if(stream){for(const t of stream.getTracks()){t.onended=null;t.stop()}stream=null}
  video.pause();video.srcObject=null;
  if(session&&!session.endedAt){record('stop',{reason});session.endedAt=new Date().toISOString()}
  resetTracking();el('stop').hidden=true;el('idle').hidden=false;el('start').disabled=false;
  el('stage').dataset.active='false';
  el('stage').dataset.ended=String(!failed&&!!session?.processedFrames);
  el('export').disabled=!session?.processedFrames;
  setState(failed?'Unavailable':'Stopped','idle',Object.hasOwn(messages,reason)?reason:'Could not start the inspection. Please try again.');
}
async function start() {
  if(running)return;
  running=true;const token=++generation;
  clockStart=performance.now();frameCount=0;videoTime=-1;lastFrameAt=clockStart;session=null;reference=null;resetTracking();
  el('export').disabled=true;paintStats();
  el('start').disabled=true;el('idle').hidden=true;el('stop').hidden=false;el('stage').dataset.ended='false';el('stage').dataset.active='false';
  setState(replay?'Loading replay':'Opening camera','search',replay?'Synthetic camera sequence.':'Allow access to the rear camera.');
  try{
    if(replay)model=replayModel;
    else{
      if(!navigator.mediaDevices?.getUserMedia)throw Error('Open this page in a browser with HTTPS camera access.');
      const media=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
      if(generation!==token){media.getTracks().forEach(t=>t.stop());return;}
      stream=media;const track=media.getVideoTracks()[0];
      track.onended=()=>stop('The camera closed. Start it again to resume.',true);
      video.srcObject=media;await video.play();if(generation!==token)return;
      const response=await fetch(new URL('../models/ar-test-board.json',import.meta.url));
      if(!response.ok)throw Error('Could not load the test board model.');
      model=await response.json();if(generation!==token)return;
    }
    session={format:'bridgelab-public-run-v1',mode:replay?'synthetic-replay':'board-camera',model:model.id,revision:model.revision,
      startedAt:new Date().toISOString(),thresholdPx:limitPx,checkTolerancePx:tolerancePx,persistenceMs:420,minimumFrames:3,
      processedFrames:0,verifiedFrames:0,alerts:0,omittedEvents:0,events:[]};
    if(replay)setupReplay();else size(video.videoWidth||640,video.videoHeight||360);
    clockStart=performance.now();lastFrameAt=clockStart;
    el('stage').dataset.active='true';record('start');
    setState('Locating','search',replay?'Matching the reference view.':'Keep all six board markers in view.');
    raf=requestAnimationFrame(loop);
  }catch(error){
    if(token!==generation)return;
    const friendly={NotAllowedError:'Allow camera access in your browser, then select Start camera.',NotFoundError:'No camera was found. You can watch the replay instead.',NotReadableError:'The camera is in use. Close the other camera app and retry.'};
    stop(friendly[error.name]||error.message,true);
  }
}
function loseLock(msg) {
  if(hasLock)record('check-lost');
  hasLock=false;prior=null;alertHistory.clear();
  setState('Locating','search',msg);
}
function observe(image,now) {
  let tracks;
  if(replay) {
    const frame=grayFrame(image);
    tracks=new Map();
    if(previous&&tracked.size)for(const [id,t] of tracked){
      const v=trackPoint(previous,frame,t);
      if(v.ok)tracks.set(id,v);
    }
    let result=compare(model,K,tracks,prior,raw.width,raw.height);
    if(!result&&now-lastScan>=500) {
      lastScan=now;
      const match=registerFrame({image,frame,model,K,reference,sectionId:'all'});
      if(match.ok){tracks=match.tracks;result=compare(model,K,tracks,match.pose,raw.width,raw.height)}
    }
    previous=frame;tracked=tracks;return result;
  }
  // Decode each camera frame independently; never measure from a stale pose.
  const match=registerFrame({image,model,K,sectionId:model.sections[0].id});
  return match.ok?compare(model,K,match.tracks,match.pose,raw.width,raw.height):null;
}
function overlay(result,activeRows) {
  const xy=new Map(model.nodes.map(n=>[n.id,project(result.pose,K,n.xyz)]));
  ctx.strokeStyle='#abadff';ctx.lineWidth=1.6;ctx.beginPath();
  for(const e of model.members){
    const a=xy.get(e.a),b=xy.get(e.b);
    if(a&&b){ctx.moveTo(...a);ctx.lineTo(...b)}
  }
  ctx.stroke();
  for(const r of activeRows){
    ctx.strokeStyle='#ff717b';ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(...r.predicted);ctx.lineTo(...r.observed);ctx.stroke();
    ctx.beginPath();ctx.arc(...r.observed,9,0,Math.PI*2);ctx.stroke();
    const title=r.px.toFixed(1)+' px';ctx.font='bold 12px sans-serif';
    const width=ctx.measureText(title).width;
    const x=Math.max(3,Math.min(view.width-width-9,r.observed[0]+13)),y=Math.max(17,r.observed[1]-6);
    ctx.fillStyle='#7c2c37';ctx.fillRect(x-3,y-13,width+8,17);
    ctx.fillStyle='white';ctx.fillText(title,x,y);
  }
}
function loop(now) {
  if(!running)return;
  try{
    const fresh=replay||(video.readyState>=2&&video.currentTime!==videoTime);
    if(!document.hidden&&fresh&&now-lastFrameAt>=85){
      const gap=now-lastFrameAt;lastFrameAt=now;
      if(!replay&&gap>1000)resetTracking();
      if(replay)drawReplay(camera,frameCount/10);
      else{
        if(!video.videoWidth||!video.videoHeight){raf=requestAnimationFrame(loop);return}
        if(Math.abs(raw.width/raw.height-video.videoWidth/video.videoHeight)>.01){size(video.videoWidth,video.videoHeight);resetTracking()}
        videoTime=video.currentTime;camera.drawImage(video,0,0,raw.width,raw.height);
      }
      const image=camera.getImageData(0,0,raw.width,raw.height);
      const result=observe(image,now);frameCount++;session.processedFrames++;
      ctx.drawImage(raw,0,0);
      if(result){
        prior=result.pose;
        if(!hasLock)record('aligned',{independentCheckPx:result.checkMaxPx});
        hasLock=true;session.verifiedFrames++;
        const active=[];
        for(const r of result.rows){
          const old=alertHistory.get(r.id),next=assessAlert(old,r.px,now);alertHistory.set(r.id,next);
          if(next.active)active.push(r);
          if(next.active&&!old?.active){session.alerts++;record('deviation',{point:r.id,observedPx:r.observed,predictedPx:r.predicted,residualPx:r.px,independentCheckPx:result.checkMaxPx})}
          if(!next.active&&old?.active)record('cleared',{point:r.id});
        }
        overlay(result,active);
        setState(active.length?'Deviation detected':'Tracking',active.length?'alert':'tracking',replay?'Synthetic camera sequence · 8 m truss':'Board aligned · image-plane measurement',active.length?active[0].px.toFixed(1):null);
      }else loseLock(replay?'Matching the reference view.':'Keep all six board markers in view.');
      paintStats();
      el('export').disabled=false;
    }else if(!replay&&now-lastFrameAt>1200) {
      loseLock('Waiting for a fresh camera frame.');
      ctx.clearRect(0,0,view.width,view.height);
    }
  }catch{
    stop('The video frame could not be processed. Restart to try again.',true);return;
  }
  raf=requestAnimationFrame(loop);
}
el('start').onclick=start;
el('stop').onclick=()=>stop();
el('export').onclick=()=>{
  if(!session)return;
  const data={...session,exportedAt:new Date().toISOString()};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');
  a.href=url;a.download='BridgeLab-'+session.mode+'-'+session.startedAt.replace(/[:.]/g,'-')+'.json';
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&running){loseLock('Waiting for a fresh frame.');resetTracking();ctx.clearRect(0,0,view.width,view.height)}});
window.addEventListener('pagehide',()=>{if(running)stop()});
if(replay||query.get('mode')==='camera'||query.get('start')==='1')start();
