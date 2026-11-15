import {experimentScene} from './bridge-experiment.js?v=wb4';
import {createJointDetector} from './joint-detector.js?v=wb4';

const byId=id=>document.getElementById(id);
const video=byId('camera'), overlay=byId('joint-overlay'), screen=overlay.getContext('2d');
const capture=document.createElement('canvas'), camera=capture.getContext('2d',{willReadFrequently:true});
const status=byId('observation'),start=byId('camera-start'),stop=byId('camera-stop');
const messages={
  idle:['Camera is off','相机已关闭','Start the camera when the model is visible on the computer.','先在电脑上显示模型，再打开相机。'],
  locating:['Looking for the left span','正在识别左跨','Hold the phone level. Move closer until the left span fills the view, keeping both piers visible.','手机尽量正对屏幕。靠近一些，让左跨铺满画面，同时保留两端支承。'],
  reference:['Joint at its starting position','节点位于初始位置','Keep filming. On the computer, lower the joint to see the reading change.','保持取景，在电脑上让节点下移，观察读数变化。'],
  moved:['Downward movement detected','检测到节点下移','Restore the joint on the computer and check the reading again.','在电脑上让节点归位，再看读数。'],
  raised:['Upward movement detected','检测到节点上移','Keep the joint and the supports in frame.','保持节点和桥墩都在画面内。'],
  lost:['Looking for the bridge again','正在重新识别','Keep the orange joint and both ends of the span clear. The reading resumes when they match.','让橙色节点和桥跨两端清晰入镜，识别后会恢复读数。'],
  permission:['Camera access is off','尚未获得相机权限','Allow camera access in your browser settings, then open the camera again.','在浏览器设置中允许使用相机，再点打开。'],
  camera:['Camera unavailable','相机暂不可用','Check camera access and close other apps using it, then try again.','请检查相机权限，关闭其他占用相机的应用后重试。'],
  asset:['Bridge reference unavailable','参考模型未能加载','Check the network connection, then try again.','请检查网络后重新打开相机。']
};
let stream=null,detector=null,session=0,request=0,lastTime=0,lastVideoTime=-1,state='idle',reading=null,pending=[],locked=false;
function show(next,number=null){
  state=next;reading=number;
  const [a,b,c,d]=messages[state];
  status.dataset.state=['permission','camera','asset'].includes(state)?'error':state;
  byId('tracking-state').textContent=BridgePrefs.text(a,b);
  byId('guidance').textContent=BridgePrefs.text(c,d);
  byId('reading').textContent=number===null?'—':(number>0?'+':'')+number;
}
document.addEventListener('bridgelab:preferences',()=>show(state,reading));
function clear(){screen.clearRect(0,0,overlay.width,overlay.height)}
function showJoint(result,w,h) {
  overlay.width=w;overlay.height=h;
  const [x,y]=result.observed,[a,b]=result.expected;
  screen.strokeStyle='#ee7033';screen.lineWidth=Math.max(2,w/240);
  screen.beginPath();screen.arc(x,y,Math.max(7,w*.017),0,Math.PI*2);screen.stroke();
  if(Math.abs(result.displacement)>6){
    screen.strokeStyle='#e4fff0';screen.lineWidth=2;screen.beginPath();screen.moveTo(a-5,b);screen.lineTo(a+5,b);screen.stroke();
  }
}
function readFrame(){
  const factor=Math.min(1,760/Math.max(video.videoWidth,video.videoHeight));
  const w=Math.round(video.videoWidth*factor),h=Math.round(video.videoHeight*factor);
  if(!w||!h)return;
  if(capture.width!==w||capture.height!==h){capture.width=w;capture.height=h}
  camera.drawImage(video,0,0,w,h);
  const result=detector.observe(camera.getImageData(0,0,w,h));
  if(!result.ok){pending=[];clear();show(locked?'lost':'locating');return}
  const n=Math.round(result.displacement);
  if(pending.length&&Math.abs(pending.at(-1)-n)>5)pending=[];
  pending.push(n);if(pending.length>3)pending.shift();
  if(pending.length<2){clear();show('locating');return}
  locked=true;
  const dx=[...pending].sort((a,b)=>a-b)[Math.floor(pending.length/2)];
  showJoint(result,w,h);
  show(dx>6?'moved':dx< -6?'raised':'reference',dx);
}
function loop(now){
  if(!stream)return;
  if(video.readyState>=2&&now-lastTime>=135&&video.currentTime!==lastVideoTime){
    lastTime=now;lastVideoTime=video.currentTime;readFrame();
  }
  request=requestAnimationFrame(loop);
}
function end(next='idle') {
  ++session;cancelAnimationFrame(request);stream?.getTracks().forEach(t=>t.stop());
  video.srcObject=null;stream=null;detector?.reset();clear();pending=[];locked=false;lastVideoTime=-1;
  start.hidden=false;start.disabled=false;stop.hidden=true;show(next);
}
async function loadDetector() {
  const img=new Image();img.src=experimentScene.referenceURL;await img.decode();
  const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;
  const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
  return createJointDetector(ctx.getImageData(0,0,c.width,c.height),experimentScene);
}
async function begin() {
  const token=++session;start.disabled=true;show('locating');
  let opened;
  try {
    if(!navigator.mediaDevices?.getUserMedia)throw Error('unavailable');
    opened=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
    if(session!==token){opened.getTracks().forEach(t=>t.stop());return}
    stream=opened;video.srcObject=stream;
    await video.play();
    if(session!==token)return;
    try{detector??=await loadDetector()}catch(e){if(session===token)end('asset');return}
    if(session!==token)return;
    start.hidden=true;stop.hidden=false;
    stream.getVideoTracks()[0].addEventListener('ended',()=>{if(session===token)end('camera')});
    request=requestAnimationFrame(loop);
  }catch(e){if(session===token)end(e?.name==='NotAllowedError'?'permission':'camera')}
}
start.addEventListener('click',begin);stop.addEventListener('click',()=>end());
window.addEventListener('pagehide',()=>end());
show('idle');
