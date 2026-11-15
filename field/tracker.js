// Absolute, section-specific image references anchor the short-range optical flow.
// Only control points fit the planar transform; CHECK and TARGET are observations.
import {matchAppearance,matchAppearanceNear,sampleAppearance} from '../ar/auto.js';
import {grayFrame,trackPoint} from '../ar/vision.js';
import {projectAnchors} from './metric.js';

export const landmarkIds=['C1','C2','C3','C4','CHECK','TARGET'];
const radius=11;
const checkTolerance=3;
const maxFlowTime=800;
const validPoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
const distance=(p,q)=>Math.hypot(p[0]-q[0],p[1]-q[1]);
const failure=reason=>({ok:false,reason});
function gray(image) {
  if(!Number.isInteger(image?.width)||!Number.isInteger(image?.height)||
     Math.min(image.width,image.height)<32||Math.max(image.width,image.height)>1024||
     ![image.width*image.height,image.width*image.height*4].includes(image.data?.length))return null;
  return image.levels?image:grayFrame(image);
}
function inside(points,p) {
  const turns=points.map(([x,y],i)=>{
    const [u,v]=points[(i+1)%points.length];
    return (u-x)*(p[1]-y)-(v-y)*(p[0]-x);
  });
  return turns.every(v=>v>=-.00001)||turns.every(v=>v<=.00001);
}
function tooClose(points,minSpan) {
  return points.some((p,i)=>p&&points.slice(0,i).some(q=>q&&Math.max(Math.abs(p[0]-q[0]),Math.abs(p[1]-q[1]))<minSpan));
}
function inImage(p,width,height) {
  return validPoint(p)&&p[0]>=radius&&p[1]>=radius&&p[0]<width-radius&&p[1]<height-radius;
}
function overlapValid(link,id) {
  if(!link)return true;
  const controls=landmarkIds.slice(0,4);
  return typeof link.sectionId==='string'&&link.sectionId!==id&&Array.isArray(link.pairs)&&
    link.pairs.length>=2&&link.pairs.length<=4&&link.pairs.every(pair=>Array.isArray(pair)&&pair.length===2&&pair.every(p=>controls.includes(p)))&&
    [0,1].every(k=>new Set(link.pairs.map(pair=>pair[k])).size===link.pairs.length);
}
export function createBaseline({id,name,frame,points,image='',bridgeId='',revision=1,overlap=null,calibration=null}={}) {
  const raster=gray(frame);
  if(!raster||typeof id!=='string'||!id||!Array.isArray(points)||points.length!==6||
    !points.every(p=>inImage(p,raster.width,raster.height)))return failure('points');
  if(tooClose(points,22))return failure('spacing');
  if(!projectAnchors(points,points)||!inside(points.slice(0,4),points[4])||
     !inside(points.slice(0,4),points[5]))return failure('geometry');
  if(!overlapValid(overlap,id))return failure('overlap');
  const patches=points.map(([x,y],i)=>sampleAppearance(raster,landmarkIds[i],x,y));
  if(patches.some(p=>!p))return failure('texture');
  const reference={format:'bridgelab-appearance-v1',modelId:bridgeId||id,revision,sectionId:id,
    width:raster.width,height:raster.height,points:patches};
  const self=matchAppearance(raster,reference);
  if(!points.every((p,i)=>{
    const q=self.get(landmarkIds[i]);return q&&distance(p,[q.x,q.y])<2.5;
  }))return failure('repetitive');
  const baseline={format:'bridgelab-field-view-v1',id,name:name||id,bridgeId,revision,
    width:raster.width,height:raster.height,points:points.map(p=>p.slice()),image,reference,overlap,calibration};
  return {ok:true,baseline};
}

// A target is allowed to move or disappear. It must never disambiguate two bridge bays.
function recoverMissing(frame,baseline,found) {
  const visible=[0,1,2,3].filter(i=>found.has(landmarkIds[i]));
  if(visible.length<2||found.size===6)return;
  // A wide pair constrains a similarity approximation for the local search. Once
  // all four controls are observed the held-out points get a projective search center.
  let pair=null,span=0;
  for(let i=1;i<visible.length;i++)for(let j=0;j<i;j++){
    const a=visible[j],b=visible[i],d=distance(baseline.points[a],baseline.points[b]);
    if(d>span){span=d;pair=[a,b];}
  }
  const [a,b]=pair,pa=baseline.points[a],pb=baseline.points[b];
  const qa=found.get(landmarkIds[a]),qb=found.get(landmarkIds[b]);
  const dx=pb[0]-pa[0],dy=pb[1]-pa[1],ex=qb.x-qa.x,ey=qb.y-qa.y;
  const cos=(ex*dx+ey*dy)/(span*span),sin=(ey*dx-ex*dy)/(span*span);
  const scale=Math.hypot(cos,sin),angle=Math.atan2(sin,cos);
  if(scale<.65||scale>1.5||Math.abs(angle)>.6)return;
  const predict=([x,y])=>[qa.x+cos*(x-pa[0])-sin*(y-pa[1]),qa.y+sin*(x-pa[0])+cos*(y-pa[1])];
  for(const i of [0,1,2,3,4,5]){
    const id=landmarkIds[i];
    if(found.has(id))continue;
    let center=predict(baseline.points[i]);
    if(i>=4){
      const corners=landmarkIds.slice(0,4).map(k=>found.get(k));
      if(corners.every(Boolean)){
        const projected=projectAnchors(baseline.points,corners.map(p=>[p.x,p.y]));
        if(projected)center=i===4?projected.predictedCheck:projected.predictedTarget;
      }
    }
    const measured=matchAppearanceNear(frame,baseline.reference,id,center,scale,angle,i===5?18:12);
    if(measured)found.set(id,measured);
  }
}
function checkCandidate(baseline,found,width,height,method) {
  const coordinates=landmarkIds.map(id=>{
    const p=found.get(id);return p&&inImage([p.x,p.y],width,height)?[p.x,p.y]:null;
  });
  if(coordinates.slice(0,5).some(p=>!p)||tooClose(coordinates.slice(0,5),7))return null;
  const corners=coordinates.slice(0,4);
  if(!inside(corners,coordinates[4]))return null;
  const projection=projectAnchors(baseline.points,corners);
  if(!projection)return null;
  const checkPx=distance(projection.predictedCheck,coordinates[4]);
  if(checkPx>checkTolerance)return null;
  const observedTarget=coordinates[5],predicted=projection.predictedTarget;
  const observedOk=observedTarget&&inside(corners,observedTarget)&&!tooClose(coordinates,7);
  return {ok:!!observedOk,sectionId:baseline.id,baseline,observed:coordinates,predicted,observedTarget,
    checkPx,offsetPx:observedOk?distance(predicted,observedTarget):null,method};
}
function overlapAgreement(a,b) {
  let local=a,neighbor=b;
  if(local.baseline.overlap?.sectionId!==neighbor.sectionId)[local,neighbor]=[neighbor,local];
  const link=local.baseline.overlap;
  return link?.sectionId===neighbor.sectionId&&overlapValid(link,local.sectionId)&&link.pairs.every(([u,v])=>
    distance(local.observed[landmarkIds.indexOf(u)],neighbor.observed[landmarkIds.indexOf(v)])<=checkTolerance);
}
function centrality(hit,width,height) {
  const center=hit.observed.slice(0,4).reduce((p,q)=>[p[0]+q[0]/4,p[1]+q[1]/4],[0,0]);
  return distance(center,[width/2,height/2]);
}
function pick(hits,old,width,height) {
  if(!hits.length)return failure('locating');
  let hit=hits[0],overlapWith=null;
  if(hits.length>1){
    if(hits.length!==2||!overlapAgreement(hits[0],hits[1]))return failure('ambiguous');
    const previous=hits.find(x=>x.sectionId===old);
    // Keep a good lock through the overlap. Once its target leaves the hull the
    // adjacent independently verified section takes over.
    hit=previous?.ok?previous:hits.filter(x=>x.ok).sort((a,b)=>centrality(a,width,height)-centrality(b,width,height))[0]||hit;
    overlapWith=hits.find(x=>x!==hit).sectionId;
  }
  if(!hit.ok)return failure('target-missing');
  return {...hit,overlapVerified:overlapWith!==null,overlapWith};
}
export function createTracker() {
  let previous=null,last=null,pending=null,lastTime=-Infinity,lastGlobal=-Infinity;
  function reset() { previous=null;last=null;pending=null;lastTime=lastGlobal=-Infinity; }
  function observe(image,baselines,timeMs) {
    const frame=gray(image);
    if(!frame||!Number.isFinite(timeMs)) {reset();return failure('frame');}
    const views=Array.isArray(baselines)?baselines:[];
    if(!views.length) {reset();return failure('no-baseline');}
    if(views.some(v=>v?.format!=='bridgelab-field-view-v1'||!Array.isArray(v.points)||v.points.length!==6||
        !v.points.every(validPoint)||v.reference?.points?.length!==6)||
        new Set(views.map(s=>s.id)).size!==views.length){reset();return failure('baseline-format');}
    if(timeMs<=lastTime||timeMs-lastTime>1200||previous&&
        (frame.width!==previous.width||frame.height!==previous.height))reset();
    lastTime=timeMs;
    if(last&&previous&&views.includes(last.baseline)&&timeMs-lastGlobal<maxFlowTime) {
      const tracks=new Map();
      for(let i=0;i<6;i++){
        const [x,y]=last.observed[i];
        const match=trackPoint(previous,frame,{x,y});
        if(match.ok)tracks.set(landmarkIds[i],match);
      }
      const next=checkCandidate(last.baseline,tracks,frame.width,frame.height,'flow');
      if(next?.ok){
        previous=frame;last={...next,overlapVerified:false,overlapWith:null};return last;
      }
    }
    lastGlobal=timeMs;
    const hits=[];
    for(const baseline of views) {
      const found=matchAppearance(frame,baseline.reference);
      recoverMissing(frame,baseline,found);
      const candidate=checkCandidate(baseline,found,frame.width,frame.height,'reference');
      if(candidate)hits.push(candidate);
    }
    const value=pick(hits,last?.sectionId,frame.width,frame.height);
    if(!value.ok){last=null;pending=null;previous=null;return value;}
    if(last?.baseline!==value.baseline&&pending?.baseline!==value.baseline){
      pending={baseline:value.baseline};last=null;previous=null;return failure('confirming');
    }
    previous=frame;last=value;pending=null;return value;
  }
  return {observe,reset};
}
