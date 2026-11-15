import {grayFrame,trackPoint,project} from './vision.js';
import {registerFrame,captureReference,detectBoard} from './auto.js';
import {replayModel,replaySize,replayK,replaySeeds,drawReplay} from './replay.js';
import {compare,assessAlert,limitPx,tolerancePx} from './measure.js';
import {placeBridge,boardClipMatrix,drawMiniature,locateBoard} from './board-model.js?v=wb3';
import {sketch} from '../models/viewer.js?v=wb3';
import {loadBridgeGeometry} from '../models/bridge-assets.js?v=wb3';
import {drawBoardSample,boardSampleSize,boardSampleK} from './board-sample.js';

const el=id=>document.getElementById(id);
const video=el('camera'),view=el('view'),ctx=view.getContext('2d',{alpha:false});
const raw=document.createElement('canvas'),camera=raw.getContext('2d',{willReadFrequently:true,alpha:false});
const query=new URLSearchParams(location.search);
const replay=query.get('mode')==='replay'||query.get('replay')==='1';
const sample=!replay&&query.get('mode')==='board-demo',hasCamera=!replay&&!sample;
const status=el('status'),hint=el('hint');
const choice=el('model-choice'),preview=el('model-preview'),previewToggle=el('preview-toggle');
let selectedModel=null,miniature=null,viewer=null,modelRequest=0,loadingModel=false,currentBoard=null;
let meshLayer=null;
let storedBridge;try{storedBridge=localStorage.getItem('bridgelab.tabletop.bridge')}catch{}
const safeBridge=id=>['waibaidu','training-span'].includes(id);
const requested=query.get('bridge')||query.get('model');
const initialBridge=safeBridge(requested)?requested:(safeBridge(storedBridge)?storedBridge:'waibaidu');
let generation=0,running=false,raf=0,stream=null,model,K,session=null;
let prior=null,previous=null,tracked=new Map(),alertHistory=new Map(),reference=null;
let lastScan=-Infinity,lastFrameAt=0,videoTime=-1,clockStart=0,hasLock=false,frameCount=0;

const messages={
  'Board registered':'测试板已定位','Model anchored':'模型已锚定','Board target shifted':'测试板目标已移动','Starting sample':'正在加载模拟画面','Ready':'就绪','Unavailable':'暂不可用','Stopped':'已结束','Loading replay':'正在加载回放',
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
function describeBoard() {
  const {found,fit}=currentBoard;
  const n=found.points.length,header=text(`Marks ${n}/6 · `,`已识别 ${n}/6 · `);
  if(found.duplicates?.length)return header+text('Frame a single board.','请只拍一块测试板。');
  if(fit.reason==='missing-controls'){
    if(!n)return header+(
      found.reason==='low_contrast'?text('Reduce glare and brighten the board.','请避开反光并调亮测试板。'):
      found.reason==='small_markers'?text('Move closer or enlarge the board.','请靠近或放大测试板。'):
      text('Aim at the six square codes on the second screen.','请对准另一块屏幕上的六个方形码。'));
    const positions={C1:text('upper left','左上'),C2:text('upper right','右上'),C3:text('lower right','右下'),C4:text('lower left','左下')};
    const missing=Object.keys(positions).filter(id=>!fit.observed.has(id)).map(id=>positions[id]).join(' / ');
    if(found.reason==='small_markers')return header+text('Enlarge the board or move closer. Missing: '+missing+'.','请放大测试板或靠近一些，缺少'+missing+'角码。');
    return header+text('Frame the missing corners: '+missing+'.','请拍入缺少的角码：'+missing+'。');
  }
  if(fit.reason==='check-failed')return header+text('Check point disagrees. Flatten the board and reduce the tilt.','检查点不一致。请放平测试板并减小拍摄倾角。');
  if(fit.reason==='geometry')return header+text('Face the front of the board and keep its four corners in frame.','请对准测试板正面并拍全四角。');
  if(fit.reason==='pose-uncertain')return header+text('3D pose uncertain. Move toward a front view.','三维姿态未通过核验，请转向更正面的视角。');
  if(fit.reason==='missing-check')return header+text('Show the center check to measure the target.','请拍入中央检查点以测量目标。');
  if(fit.reason==='missing-target'||fit.reason==='outside')return header+text('Show the movable target inside the corners.','让可移动目标出现在四角之间。');
  if(fit.rows.length)return header+text('Board target '+fit.rows[0].px.toFixed(1)+' px · trigger '+limitPx+' px','测试板目标偏差 '+fit.rows[0].px.toFixed(1)+' px · 阈值 '+limitPx+' px');
  return header+text('Keep the full board in view.','请拍全测试板。');
}
function paintState(){
  const {title,kind,message,offset}=displayState;
  const nextStatus=translate(title);
  const nextHint=currentBoard?describeBoard():offset===null?translate(message):text(
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
  const title=replay?text('Truss replay','桁架回放'):text('Tabletop bridge AR','桌面桥梁 AR');
  el('title').textContent=title;
  document.title=title+' · BridgeLab';
  el('switch-label').textContent=(replay||sample)?text('Try live camera','试用相机'):text('Watch replay','观看回放');
  el('start').textContent=replay?text('Play replay','播放回放'):sample?text('Play sample','播放桌面示例'):text('Start camera','开启相机');
  if(!replay){
    const kind=selectedModel?.kind==='visual-reconstruction'?text('Visual reconstruction','外观重建'):text('Schematic model','示意模型');
    el('model-state').textContent=loadingModel?text('Loading model…','正在加载模型…'):selectedModel?
      kind+' · '+selectedModel.lengthM+' m · '+text('scaled to the test board','缩放至测试板'):
      text('Bridge model unavailable.','桥梁模型未加载。');
    previewToggle.textContent=preview.hidden?text('View 3D model','查看三维模型'):text('Close preview','收起三维预览');
    viewer?.draw();
  }
  paintState();paintStats();
}
function updateLinks(){
  const id=choice.value||initialBridge;
  el('board').href='../target/markers.html?bridge='+id+'&v=wb4';
  el('switch').href='?mode='+(replay||sample?'camera':'replay')+'&bridge='+id+'&v=wb3';
  el('sample-link').href='?mode=board-demo&bridge='+id+'&v=wb3';
}
async function prepareMesh(seq){
  const canvas=document.createElement('canvas');
  try{
    const {loadBridgeRenderer}=await import('../models/mesh-renderer.js?v=wb3');
    if(seq!==modelRequest)return;
    const renderer=loadBridgeRenderer(canvas,selectedModel);
    if(seq!==modelRequest){renderer.destroy();return}
    meshLayer={canvas,renderer};
  }catch{
    // Model selection and board tracking remain independent.
  }
}
async function loadBridge(){
  const id=choice.value,seq=++modelRequest;
  meshLayer?.renderer.destroy();meshLayer=null;
  selectedModel=null;miniature=null;viewer?.destroy();viewer=null;
  const can=el('preview-canvas');can.getContext('2d').clearRect(0,0,can.width,can.height);
  loadingModel=true;el('model-retry').hidden=true;updateLinks();renderLanguage();
  try{
    const data=await loadBridgeGeometry(id);if(seq!==modelRequest)return;
    const prepared=placeBridge(data);
    viewer=sketch(can,data);miniature=prepared;selectedModel=data;
    if(id==='waibaidu'&&data.kind==='visual-reconstruction')void prepareMesh(seq);
    if(session){session.displayModel=id;record('display-model',{id})}
  }catch{if(seq===modelRequest)el('model-retry').hidden=false}
  finally{if(seq===modelRequest){loadingModel=false;renderLanguage()}}
}
if(replay){el('switch').href='?mode=camera&bridge='+initialBridge+'&v=wb3';el('board').hidden=true}
else {
  choice.value=initialBridge;
  el('model-panel').hidden=false;el('sample-badge').hidden=!sample;el('sample-link').hidden=sample;
  choice.onchange=()=>{
    try{localStorage.setItem('bridgelab.tabletop.bridge',choice.value)}catch{}
    const url=new URL(location.href);url.searchParams.set('bridge',choice.value);url.searchParams.delete('model');history.replaceState(null,'',url);
    loadBridge();
  };
  previewToggle.onclick=()=>{preview.hidden=!preview.hidden;previewToggle.setAttribute('aria-expanded',String(!preview.hidden));renderLanguage()};
  el('model-retry').onclick=loadBridge;
  loadBridge();
}
document.addEventListener('bridgelab:preferences',renderLanguage);
renderLanguage();

function setState(title,kind,message,offset=null) {
  displayState={title,kind,message,offset};
  paintState();
}
function resetTracking() {
  currentBoard=null;prior=null;previous=null;tracked.clear();alertHistory.clear();hasLock=false;lastScan=-Infinity;
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
  K=replay?replayK:sample?boardSampleK:{fx:.95*Math.max(raw.width,raw.height),fy:.95*Math.max(raw.width,raw.height),cx:raw.width/2,cy:raw.height/2};
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
  setState(replay?'Loading replay':sample?'Starting sample':'Opening camera','search',replay||sample?'Synthetic camera sequence.':'Allow access to the rear camera.');
  try{
    if(replay)model=replayModel;
    else{
      if(hasCamera){
        if(!navigator.mediaDevices?.getUserMedia)throw Error('Open this page in a browser with HTTPS camera access.');
        const media=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
        if(generation!==token){media.getTracks().forEach(t=>t.stop());return;}
        stream=media;const track=media.getVideoTracks()[0];
        track.onended=()=>stop('The camera closed. Start it again to resume.',true);
        video.srcObject=media;await video.play();if(generation!==token)return;
      }
      const response=await fetch(new URL('../models/ar-test-board.json',import.meta.url));
      if(!response.ok)throw Error('Could not load the test board model.');
      model=await response.json();if(generation!==token)return;
    }
    session={format:'bridgelab-public-run-v1',mode:replay?'synthetic-replay':sample?'synthetic-board':'board-camera',model:model.id,revision:model.revision,displayModel:replay?null:selectedModel?.id??null,
      startedAt:new Date().toISOString(),thresholdPx:limitPx,checkTolerancePx:tolerancePx,persistenceMs:420,minimumFrames:3,
      processedFrames:0,verifiedFrames:0,alerts:0,omittedEvents:0,events:[]};
    if(replay)setupReplay();else if(sample)size(...boardSampleSize);else size(video.videoWidth||640,video.videoHeight||360);
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
  currentBoard=null;hasLock=false;prior=null;alertHistory.clear();
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
  const found=detectBoard(image);
  const fit=locateBoard(found,model,K,raw.width,raw.height,prior);
  currentBoard={found,fit};
  return fit;
}
function renderBoardBridge(result){
  if(meshLayer){
    const {canvas,renderer}=meshLayer;
    try{
      if(canvas.width!==view.width)canvas.width=view.width;
      if(canvas.height!==view.height)canvas.height=view.height;
      const matrix=boardClipMatrix(miniature,result.pose,result.K,canvas.width,canvas.height);
      if(renderer.render(matrix)!==false){
        ctx.drawImage(renderer.source,0,0,canvas.width,canvas.height);
        return;
      }
    }catch{
      // Continue tracking when the display surface becomes unavailable.
    }
    renderer.destroy();meshLayer=null;
  }
  if(selectedModel?.id!=='waibaidu')drawMiniature(ctx,miniature,result.pose,result.K);
}
function overlay(result,activeRows) {
  if(!replay){
    if(result.pose&&miniature)renderBoardBridge(result);
    for(const [id,[x,y]] of result.observed){
      ctx.strokeStyle=id==='TARGET'?'#dc9246':'#3e917e';ctx.lineWidth=1.6;
      ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.stroke();
    }
  }else{
    const xy=new Map(model.nodes.map(n=>[n.id,project(result.pose,K,n.xyz)]));
    ctx.strokeStyle='#abadff';ctx.lineWidth=1.6;ctx.beginPath();
    for(const e of model.members){const a=xy.get(e.a),b=xy.get(e.b);if(a&&b){ctx.moveTo(...a);ctx.lineTo(...b)}}
    ctx.stroke();
  }
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
    const fresh=!hasCamera||(video.readyState>=2&&video.currentTime!==videoTime);
    if(!document.hidden&&fresh&&now-lastFrameAt>=85){
      const gap=now-lastFrameAt;lastFrameAt=now;
      if(!replay&&gap>1000)resetTracking();
      if(replay)drawReplay(camera,frameCount/10);
      else if(sample)drawBoardSample(camera,(now-clockStart)/1000);
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
        const verified=replay||result.verified;
        if(verified){
          if(!hasLock)record('aligned',{independentCheckPx:result.checkMaxPx});
          session.verifiedFrames++;
        }else{
          if(hasLock)record('check-lost');
          alertHistory.clear();
        }
        hasLock=verified;
        const active=[];
        for(const r of result.rows){
          const old=alertHistory.get(r.id),next=assessAlert(old,r.px,now);alertHistory.set(r.id,next);
          if(next.active)active.push(r);
          if(next.active&&!old?.active){session.alerts++;record('deviation',{point:r.id,observedPx:r.observed,predictedPx:r.predicted,residualPx:r.px,independentCheckPx:result.checkMaxPx})}
          if(!next.active&&old?.active)record('cleared',{point:r.id});
        }
        overlay(result,active);
        if(replay)setState(active.length?'Deviation detected':'Tracking',active.length?'alert':'tracking','Synthetic camera sequence · 8 m truss',active.length?active[0].px.toFixed(1):null);
        else{
          const anchored=!!(result.pose&&miniature);
          const heading=active.length?'Board target shifted':anchored?'Model anchored':result.verified?'Board registered':'Locating';
          setState(heading,active.length?'alert':anchored||result.verified?'tracking':'search','Board aligned · image-plane measurement');
        }
      }else loseLock(replay?'Matching the reference view.':'Keep all six board markers in view.');
      paintStats();
      el('export').disabled=false;
    }else if(hasCamera&&now-lastFrameAt>1200) {
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
if(replay||sample||query.get('mode')==='camera'||query.get('start')==='1')start();
