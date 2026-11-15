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
 document.getElementById('experiment-info').textContent=training?
   text('Show the marker board on your computer and use your phone to measure the movable target.','电脑显示六标记校验板，用手机测量左侧方块的移动。'):
   text('Lower a joint in the bridge model and use your phone to measure its movement.','在电脑上模拟外白渡桥节点下移，用手机拍屏测量位移。');
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
 document.getElementById('board-entry').href=training?'./target/markers.html?bridge=training-span&v=wb4':'./target/index.html?v=wb4';
 document.getElementById('phone-entry').href=training?'./ar/index.html?mode=camera&bridge=training-span&v=wb4':'./target/mobile.html?v=wb4';
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
