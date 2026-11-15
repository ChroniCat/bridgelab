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
 if(failed)status.textContent=text('Cannot load this model. Check your connection and reload.','模型加载失败，请检查网络后刷新。');
 else if(activeLength===null)status.textContent=text('Loading example model…','正在加载示例模型…');
 else if(picker.value==='waibaidu')status.textContent=text('Exterior reconstruction · two 52.178 m spans','实桥外观重建 · 两跨各 52.178 米');
 else status.textContent=text('Schematic model · '+activeLength+' m','示意模型 · '+activeLength+' 米');
}
document.addEventListener('bridgelab:preferences',()=>{renderStatus();viewer?.draw?.()});
async function load(){
 const bridge=encodeURIComponent(picker.value);
 document.getElementById('field-entry').href='./field/?bridge='+bridge;
 document.getElementById('board-entry').href='./target/?bridge='+bridge+'&v=wb3';
 document.getElementById('phone-entry').href='./ar/index.html?mode=camera&bridge='+bridge+'&v=wb3';
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
