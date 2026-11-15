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

el('title').textContent=replay?'Truss replay':'Board inspection';
document.title=el('title').textContent+' · BridgeLab';
if(replay) {
  el('switch').href='?mode=camera';
  el('switch').textContent='Try live camera ↗';
  el('board').hidden=true;
  el('start').textContent='Play replay';
  hint.textContent='Synthetic camera sequence · 8 m truss';
}

function setState(title,state,message) {
  if(status.textContent!==title)status.textContent=title;
  status.dataset.state=state;
  if(hint.textContent!==message)hint.textContent=message;
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
  el('start').textContent=replay?'Play replay':'Start camera';
  el('export').disabled=!session?.processedFrames;
  setState(failed?'Unavailable':'Stopped','idle',reason);
}
async function start() {
  if(running)return;
  running=true;const token=++generation;
  clockStart=performance.now();frameCount=0;videoTime=-1;lastFrameAt=clockStart;session=null;reference=null;resetTracking();
  el('export').disabled=true;el('stats').textContent='No frames yet.';
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
        setState(active.length?'Deviation detected':'Tracking',active.length?'alert':'tracking',active.length?
          'Target offset '+active[0].px.toFixed(1)+' px · trigger '+limitPx+' px':replay?'Synthetic camera sequence · 8 m truss':'Board aligned · image-plane measurement');
      }else loseLock(replay?'Matching the reference view.':'Keep all six board markers in view.');
      el('stats').textContent=session.verifiedFrames+' verified '+(session.verifiedFrames===1?'frame':'frames')+' · '+session.alerts+' '+(session.alerts===1?'alert':'alerts');
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
