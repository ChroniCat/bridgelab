import {sketch} from './models/viewer.js?v=wb3';
import {loadBridgeGeometry} from './models/bridge-assets.js?v=wb3';
export {sketch};

const picker=document.querySelector('#model');
const canvas=document.querySelector('#geometry');
const status=document.querySelector('#model-status');
const reset=document.querySelector('#reset');
const {text}=window.BridgePrefs;
let viewer,sequence=0,activeLength=null,failed=false;
function renderStatus(){
 const training=picker.value==='training-span';
 document.getElementById('simulate-desc').textContent=training?
   text('Use the six-marker calibration board for a screen-based displacement test; no site visit needed.','电脑显示六标记校验板，手机拍屏测试位移；无需去现场。'):
   text('Move along the virtual bridge and film it with a phone to check displacement; no site visit needed.','电脑模拟桥梁移动和形变，手机拍屏检测；无需去现场。');
 document.getElementById('experiment-info').textContent=training?
   text('Show the marker board on your computer and use your phone to measure the movable target.','电脑显示六标记校验板，用手机测量左侧方块的移动。'):
   text('Move along the 3D bridge on a computer and record your inspection on a phone.','电脑沿三维桥梁移动，手机拍屏巡检并记录出现位移的位置。');
 if(failed)status.textContent=text('Cannot load this model. Check your connection and reload.','模型加载失败，请检查网络后刷新。');
 else if(activeLength===null)status.textContent=text('Loading example model…','正在加载示例模型…');
 else if(picker.value==='waibaidu')status.textContent=text('Exterior reconstruction · two 52.178 m spans','实桥外观重建 · 两跨各 52.178 米');
 else status.textContent=text('Schematic model · '+activeLength+' m','示意模型 · '+activeLength+' 米');
}
document.addEventListener('bridgelab:preferences',()=>{renderStatus();viewer?.draw?.()});
async function load(){
 const bridge=encodeURIComponent(picker.value);
 document.getElementById('field-entry').href='./field/?bridge='+bridge;
 const training=picker.value==='training-span';
 const simulationUrl=training?'./target/markers.html?bridge=training-span&v=wb4':'./target/index.html?v=wb5';
 document.getElementById('simulate-entry').href=simulationUrl;
 document.getElementById('board-entry').href=simulationUrl;
 document.getElementById('phone-entry').href=training?'./ar/index.html?mode=camera&bridge=training-span&v=wb4':'./target/mobile.html?v=wb5';
 document.getElementById('mesh-entry').style.display=picker.value==='waibaidu'?'':'none';
 const seq=++sequence;reset.disabled=true;activeLength=null;failed=false;renderStatus();
 try{
  const model=await loadBridgeGeometry(picker.value);if(seq!==sequence)return;
  viewer?.destroy();viewer=sketch(canvas,model);activeLength=model.lengthM;renderStatus();
  reset.disabled=false;
 }catch{if(seq===sequence){viewer?.destroy();viewer=null;canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);failed=true;renderStatus()}}
}
reset.addEventListener('click',()=>viewer?.reset());
picker.addEventListener('change',load);
load();
