// A field recording uses the site's saved photographs and the existing optical
// tracker. Only an explicitly model-bound panel can place steelwork in the video.
import {getSite} from '../field/storage.js';
import {createTracker} from '../field/tracker.js';
import {projectAnchors} from '../field/metric.js';
import {projectFieldModel,readGeometry} from '../field/model-overlay.js?v=wb3';
import {loadBridgeGeometry} from '../models/bridge-assets.js?v=wb3';
import {project} from '../ar/vision.js';

function referenceKey(binding) {
  return JSON.stringify([binding.modelId,binding.revision,binding.assetKey]);
}

export async function createFieldWalkTracker(siteId) {
  const site=await getSite(siteId);
  if(!site?.sections?.length)throw new Error('missing-baseline');
  const models=new Map(),bindings=new Map();
  for(const section of site.sections){
    const binding=section.modelBinding;
    if(binding)bindings.set(referenceKey(binding),binding);
  }
  await Promise.all(Array.from(bindings,async ([key,binding])=>{
    try {
      const custom=site.geometry;
      const geometry=custom && custom.id===binding.modelId && custom.revision===binding.revision && custom.assetKey===binding.assetKey
        ?custom:binding.assetKey==null?await loadBridgeGeometry(binding.modelId,binding.revision):null;
      if(geometry)models.set(key,readGeometry(geometry));
    }catch{ /* The photo baseline is sufficient to measure this section. */ }
  }));
  const tracker=createTracker(),small=document.createElement('canvas'),source=document.createElement('canvas');
  const buffer=small.getContext('2d',{willReadFrequently:true}), src=source.getContext('2d');
  function observe(frame){
    const scale=Math.min(1,480/Math.max(frame.width,frame.height));
    const w=Math.max(1,Math.round(frame.width*scale)),h=Math.max(1,Math.round(frame.height*scale));
    let work=frame;
    if(w!==frame.width || h!==frame.height){
      if(source.width!==frame.width || source.height!==frame.height){source.width=frame.width;source.height=frame.height}
      if(small.width!==w || small.height!==h){small.width=w;small.height=h}
      src.putImageData(frame,0,0);buffer.drawImage(source,0,0,w,h);work=buffer.getImageData(0,0,w,h);
    }
    const hit=tracker.observe(work,site.sections,performance.now());
    if(!hit.ok)return {ok:false,reason:hit.reason,segments:[],measurements:[]};
    const base=hit.baseline;
    // Bring the observed target back into the coordinates of its saved photo
    // so changing the video resolution does not change its reported units.
    const inverse=projectAnchors(hit.observed,base.points),target=inverse?.project(hit.observedTarget);
    if(!target)return {ok:false,reason:'geometry',segments:[],measurements:[]};
    const [x,y]=base.points[5];
    const sx=frame.width/w, sy=frame.height/h;
    const full=p=>[p[0]*sx,p[1]*sy];
    const binding=base.modelBinding,model=binding?models.get(referenceKey(binding)):null;
    const pose=model?projectFieldModel(model,binding,hit,w,h):null;
    const segments=[];
    if(pose)for(const [a,b] of model.edges){
      const p=project(pose.pose,pose.K,a),q=project(pose.pose,pose.K,b);
      if(p&&q)segments.push([...full(p),...full(q)]);
    }
    return {ok:true,stationM:null,segments,measurements:[{
      id:base.id,labelZh:base.name||base.id,labelEn:base.name||base.id,point:full(hit.observedTarget),expected:full(hit.predicted),
      displacementPx:Math.hypot(target[0]-x,target[1]-y),thresholdPx:7
    }]};
  }
  return {observe,reset:()=>tracker.reset()};
}
