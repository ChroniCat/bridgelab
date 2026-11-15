// Visual registration of a selected model panel. No projected model edge is
// used as an observation when computing a displacement.
import {fitPose,project} from '../ar/vision.js';
import {sketch} from '../models/viewer.js?v=wb3';
import {loadBridgeGeometry} from '../models/bridge-assets.js?v=wb3';

const builtins=new Set(['training-span','waibaidu']);
const finitePoint=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const subtract=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const nonempty=v=>typeof v==='string'&&v.trim().length>0&&v.length<=160;

export function readGeometry(data){
  if(!data||!nonempty(data.id)||!Array.isArray(data.nodes)||data.nodes.length<4||data.nodes.length>6000||
     !Array.isArray(data.members)||!data.members.length||data.members.length>12000)throw Error('model-format');
  const coords=new Map();
  for(const n of data.nodes){
    if(!nonempty(n?.id)||!finitePoint(n.xyz)||coords.has(n.id))throw Error('model-node');
    coords.set(n.id,n.xyz);
  }
  const edges=data.members.map(e=>{
    if(!coords.has(e?.a)||!coords.has(e?.b))throw Error('model-member');
    return [coords.get(e.a),coords.get(e.b)];
  });
  // Built-in trusses use named upright joints. Survey models can define named
  // fieldFaces with four coplanar model nodes ordered round a visible panel.
  let faces=data.fieldFaces;
  if(!faces&&builtins.has(data.id)&&!data.assetKey){
    faces=[];const nBay=data.nodes.filter(n=>/^N\d+-U$/.test(n.id)).length-1;
    for(let i=0;i<nBay;i++)for(const side of ['N','F']){
      faces.push({id:side+i,name:side+(i+1),corners:[side+i+'-U',side+(i+1)+'-U',side+(i+1)+'-B',side+i+'-B']});
    }
  }
  if(!Array.isArray(faces??[])||(faces?.length||0)>1000)throw Error('model-face');
  const panels=new Map();
  for(const f of faces||[]){
    if(!nonempty(f?.id)||panels.has(f.id)||!Array.isArray(f.corners)||new Set(f.corners).size!==4||f.corners.length!==4||!f.corners.every(id=>coords.has(id)))throw Error('model-face');
    const corners=f.corners.map(id=>coords.get(id)),p=corners[0],across=subtract(corners[1],p),down=subtract(corners[3],p),normal=cross(across,down);
    const span=Math.max(Math.hypot(...across),Math.hypot(...down)),n=Math.hypot(...normal);
    if(!span||n<span*span*.001||Math.abs(dot(normal,subtract(corners[2],p)))>n*span*1e-4)throw Error('model-face');
    for(let i=0;i<4;i++){
      const e1=subtract(corners[(i+1)%4],corners[i]),e2=subtract(corners[(i+2)%4],corners[(i+1)%4]);
      if(dot(cross(e1,e2),normal)<=0)throw Error('model-face');
    }
    panels.set(f.id,{id:f.id,name:nonempty(f.name)?f.name:f.id,ids:f.corners,xyz:corners});
  }
  return {data,edges,panels};
}
export function intrinsics(width,height){
  const f=.95*Math.max(width,height);
  return {fx:f,fy:f,cx:width/2,cy:height/2};
}
function matchesBinding(model,binding){
  return !!model&&!!binding&&binding.modelId===model.data.id&&binding.revision===(model.data.revision??1)&&binding.assetKey===(model.data.assetKey??null);
}
export function projectFieldModel(model,binding,hit,width,height){
  const panel=model?.panels.get(binding?.panelId);
  if(!panel||!matchesBinding(model,binding)||!hit?.ok||
     !Array.isArray(hit.observed)||!Number.isFinite(hit.checkPx)||hit.checkPx>3)return null;
  const corners=binding.reverse?[panel.xyz[1],panel.xyz[0],panel.xyz[3],panel.xyz[2]]:panel.xyz;
  const K=intrinsics(width,height);
  const fit=fitPose(corners.map((xyz,i)=>({xyz,uv:hit.observed[i]})),K);
  if(!fit.ok||fit.inliers.length!==4||fit.maxPx>3)return null;
  return {pose:fit.pose,K};
}
export function drawFieldModel(context,model,projection){
  const {pose,K}=projection;
  const key=new Map();
  function point(xyz){if(!key.has(xyz))key.set(xyz,project(pose,K,xyz));return key.get(xyz)}
  context.save();context.lineWidth=1.7;context.strokeStyle='#b5afff';context.beginPath();
  for(const [a,b] of model.edges){const v=point(a),w=point(b);if(v&&w){context.moveTo(...v);context.lineTo(...w)}}
  context.stroke();context.restore();
}
export function fieldModels({updated}){
  const canvas=document.getElementById('field-preview-canvas'),panelSelect=document.getElementById('model-panel'),summary=document.getElementById('field-model-status');
  const text=(en,zh)=>window.BridgePrefs.text(en,zh);
  let currentSite=null,model=null,archived=new Map(),loading=false,failed=false,token=0,viewer=null;
  function refresh(){
    document.getElementById('field-model-box').hidden=!currentSite;
    summary.textContent=loading?text('Loading model…','载入模型…'):failed?text('Could not load the model.','模型加载失败。'):model?
      text('3D model','三维模型')+' · '+(model.data.kind==='example'?text('schematic','示意'):model.data.name||model.data.id):
      text('Attach a bridge model','导入桥梁模型');
    document.getElementById('model-preview-row').hidden=!model;
    const choice=panelSelect.value;panelSelect.replaceChildren();
    if(model)for(const p of model.panels.values())panelSelect.add(new Option(p.name,p.id));
    if(choice&&model?.panels.has(choice))panelSelect.value=choice;
    document.getElementById('picker-mode').querySelector('[value="model"]').disabled=!model?.panels.size;
    viewer?.draw();
  }
  async function loadArchive(seq,revision){
    try{
      const data=await loadBridgeGeometry('waibaidu',revision);
      if(seq===token)archived.set(revision,readGeometry(data));
    }catch{
      // Section tracking and displacement readings work without the optional 3D overlay.
    }
  }
  async function select(site){
    if(currentSite===site)return;currentSite=site;const seq=++token;model=null;archived=new Map();failed=false;loading=!!site&&(!!site.geometry||builtins.has(site.id));
    viewer?.destroy();viewer=null;refresh();if(!loading)return;
    const revisions=new Set((site.sections||[]).map(section=>section.modelBinding)
      .filter(b=>site.id==='waibaidu' && b?.modelId==='waibaidu' && b.assetKey===null && [1,2].includes(b.revision))
      .map(b=>b.revision));
    const pendingArchive=Promise.all([...revisions].map(revision=>loadArchive(seq,revision)));
    try{
      const data=site.geometry??await loadBridgeGeometry(site.id);
      if(seq!==token)return;model=readGeometry(data);viewer=sketch(canvas,data);
    }catch{if(seq===token)failed=true}
    finally{if(seq===token){loading=false;refresh();updated?.()}}
    await pendingArchive;
  }
  return {select,refresh,get model(){return model},forBinding(binding){
    if(matchesBinding(model,binding))return model;
    const prior=archived.get(binding?.revision);
    return matchesBinding(prior,binding)?prior:null;
  },binding(){
    if(!model?.panels.has(panelSelect.value))return null;
    return {modelId:model.data.id,revision:model.data.revision??1,assetKey:model.data.assetKey??null,panelId:panelSelect.value,reverse:document.getElementById('model-reverse').checked};
  },cornerIds(){const p=model?.panels.get(panelSelect.value);if(!p)return [];const ids=p.ids;
    return document.getElementById('model-reverse').checked?[ids[1],ids[0],ids[3],ids[2]]:ids;}};
}
