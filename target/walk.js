import {createWalkScene,homeCamera,walkRoute} from './walk-scene.js?v=wb5';

const get=id=>document.getElementById(id);
const {text}=window.BridgePrefs;
const canvas=get('board'),view=get('board-view'),play=get('walk-play'),slider=get('walk-position');
const expand=get('expand-board'),dialog=get('pair-dialog'),phone=get('phone-camera'),link=get('pair-url'),code=get('pair-code');
const camera={...homeCamera};
const total=walkRoute.end-walkRoute.start;
let scene,playing=false,expanded=false,copied=false,timer,failed=false,lastTime=0,raf=0;
let level=Number(get('walk-level').value),shownLevel=level,drag=null;

function labels() {
  play.textContent=playing?text('Pause','暂停移动'):camera.station>=walkRoute.end-.02?text('Replay walk','重新走查'):text('Play walk','自动沿桥移动');
  play.setAttribute('aria-pressed',String(playing));
  expand.textContent=expanded?text('Exit enlarged view','收起画面'):text('Enlarge view','放大画面');
  get('copy-link').textContent=copied?text('Copied','已复制'):text('Copy link','复制链接');
  if(failed)get('loading').textContent=text('Model unavailable. Reload to try again.','桥模未能载入，请重新打开此页。');
}
function requestDraw() {if(scene&&!raf)raf=requestAnimationFrame(render);}
function render(now) {
  raf=0;
  const dt=lastTime?Math.min(.12,(now-lastTime)/1000):0;lastTime=now;
  if(playing){
    camera.station=Math.min(walkRoute.end,camera.station+walkRoute.speed*dt);
    if(camera.station===walkRoute.end){playing=false;labels();}
  }
  // Ease each state change. Pausing the walk keeps the camera fixed.
  shownLevel+=Math.sign(level-shownLevel)*Math.min(Math.abs(level-shownLevel),dt*.42);
  const d=camera.station-walkRoute.start;
  slider.value=String(d);get('walk-distance').textContent=d.toFixed(1)+' / '+total.toFixed(1)+' m';
  scene.draw(camera,shownLevel);
  if(playing||shownLevel!==level)requestDraw();else lastTime=0;
}
play.addEventListener('click',()=>{
  if(!scene)return;
  if(!playing&&camera.station>=walkRoute.end-.02)camera.station=walkRoute.start;
  playing=!playing;lastTime=0;labels();requestDraw();
});
slider.addEventListener('input',()=>{playing=false;camera.station=walkRoute.start+Number(slider.value);labels();requestDraw();});
get('walk-level').addEventListener('change',()=>{level=Number(get('walk-level').value);requestDraw();});
function resetView(){Object.assign(camera,{yaw:homeCamera.yaw,pitch:homeCamera.pitch,zoom:homeCamera.zoom});requestDraw();}
get('reset-view').addEventListener('click',resetView);
function turn(dx,dy){
  camera.yaw=Math.max(-1.38,Math.min(1.38,camera.yaw-dx));
  camera.pitch=Math.max(-.05,Math.min(.96,camera.pitch+dy));
  requestDraw();
}
canvas.addEventListener('pointerdown',e=>{if(drag)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{
  if(!drag||drag.id!==e.pointerId)return;
  turn((e.clientX-drag.x)*.005,(e.clientY-drag.y)*.006);
  Object.assign(drag,{x:e.clientX,y:e.clientY});
});
for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,e=>{if(drag?.id===e.pointerId)drag=null;});
canvas.addEventListener('wheel',e=>{e.preventDefault();camera.zoom=Math.max(.65,Math.min(1.65,camera.zoom*Math.exp(-e.deltaY*.0015)));requestDraw();},{passive:false});
canvas.addEventListener('keydown',e=>{
  const keys={ArrowLeft:[-.09,0],ArrowRight:[.09,0],ArrowUp:[0,.055],ArrowDown:[0,-.055]};
  if(keys[e.key]){e.preventDefault();turn(...keys[e.key]);}else if(e.key==='Home')resetView();
});
function setExpanded(on) {
  expanded=on;view.classList.toggle('expanded',on);
  for(const el of document.querySelectorAll('.site-head,.introduction,.joint-lab footer'))el.inert=on;
  expand.setAttribute('aria-pressed',String(on));labels();expand.focus();
}
expand.addEventListener('click',()=>setExpanded(!expanded));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&expanded)setExpanded(false);});
document.addEventListener('visibilitychange',()=>{lastTime=0;});
function openPhoneLink() {
  copied = false;
  labels();
  if (dialog.showModal) dialog.showModal();
  else dialog.setAttribute('open','');
}
get('pair-open').addEventListener('click',openPhoneLink);
function closePhoneLink() { if (dialog.close) dialog.close(); else dialog.removeAttribute('open'); }
get('pair-close').addEventListener('click',closePhoneLink);
get('pair-dismiss').addEventListener('click',closePhoneLink);
get('copy-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(link.value);
    copied = true;
    clearTimeout(timer);
    labels();
    timer = setTimeout(() => { copied = false; labels(); }, 1600);
  } catch { link.focus(); link.select(); }
});
code.addEventListener('error', () => { code.hidden = true; });
document.addEventListener('bridgelab:preferences',labels);

async function start(){
  const url=new URL(location.href);
  if(['bridge','model'].some(key=>url.searchParams.get(key)==='training-span')){
    location.replace(new URL('./markers.html?bridge=training-span&v=wb4',url));return;
  }
  link.value=phone.href;
  const address=new URL(phone.href);
  if(address.origin==='https://chronicat.github.io'&&address.pathname==='/bridgelab/target/mobile.html'){
    code.src=code.dataset.src||'./phone-bridge-walk-wb5.png';code.hidden=false;
  }
  try{
    scene=await createWalkScene(canvas);
    slider.max=String(total);play.disabled=slider.disabled=false;
    get('loading').hidden=true;
    labels();requestDraw();
  }catch{failed=true;labels();}
}
start();
