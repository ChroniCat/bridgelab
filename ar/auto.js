// A model projection alone is never an observation. Both acquisition paths identify
// visible marks/textures first, fit controls second, and hold back all check points.
import '../lab/board-vision.js';
import {fitPose,verifyChecks} from './vision.js';

const patchRadius=10,patchSide=21,patchLength=441,maxPoints=32;
const codes=['C1','C2','C3','C4','CHECK','TARGET'];
const builtinCodes=Object.fromEntries(codes.map(id=>[id,id]));
const roleOrder=['control','check','target'];
const validRaster=f=>Number.isSafeInteger(f?.width)&&Number.isSafeInteger(f?.height)&&f.width>20&&f.height>20&&f.width<=1024&&f.height<=1024;
const failure=(sectionId,reason)=>({ok:false,tracks:new Map(),pose:null,method:null,sectionId,reason});
const eligible=(model,sectionId)=>{
 const section=model.sections?.find(s=>s.id===sectionId);
 if(model.sections?.length&&!section)return [];
 const ids=section?new Set(section.nodeIds):null;
 return model.nodes.filter(n=>roleOrder.includes(n.role)&&(!ids||ids.has(n.id)));
};
function audited(points,nodes,K){
 const groups={control:[],check:[],target:[]};
 for(const node of nodes){const t=points.get(node.id);if(t)groups[node.role].push({id:node.id,xyz:node.xyz,uv:[t.x,t.y]})}
 if(groups.control.length<4||!groups.check.length||!groups.target.length)return null;
 // Exclude coordinates that have collapsed onto the same visible feature, across roles too.
 const ps=[...groups.control,...groups.check,...groups.target];
 for(let i=1;i<ps.length;i++)for(let j=0;j<i;j++)if(Math.hypot(ps[i].uv[0]-ps[j].uv[0],ps[i].uv[1]-ps[j].uv[1])<5)return null;
 const fit=fitPose(groups.control,K),limit=Number.isFinite(K.controlTolerancePx)?Math.min(3,K.controlTolerancePx):3;
 if(!fit.ok||fit.rms>limit||!verifyChecks(groups.check,fit.pose,K,limit).ok)return null;
 const tracks=new Map([...fit.inliers.map(i=>groups.control[i]),...groups.check,...groups.target].map(p=>[p.id,points.get(p.id)]));
 return {tracks,pose:fit.pose};
}
function centerPatch(frame,point){
 if(!Number.isFinite(point?.x)||!Number.isFinite(point?.y))return null;
 const x=Math.round(point.x),y=Math.round(point.y);
 if(point.x<11||point.y<11||point.x>frame.width-12||point.y>frame.height-12)return null;
 const patch=new Uint8Array(patchLength);let k=0;
 for(let dy=-patchRadius;dy<=patchRadius;dy++)for(let dx=-patchRadius;dx<=patchRadius;dx++)patch[k++]=frame.data[(y+dy)*frame.width+x+dx];
 return patch;
}
function textured(data){
 let mx=0,mxx=0,a=0,b=0,c=0;
 for(let y=1;y<20;y++)for(let x=1;x<20;x++){
  const i=y*patchSide+x,v=data[i],dx=data[i+1]-data[i-1],dy=data[i+patchSide]-data[i-patchSide];
  mx+=v;mxx+=v*v;a+=dx*dx;b+=dx*dy;c+=dy*dy;
 }
 return mxx-mx*mx/361>361*36&&a*c-b*b>.004*(a+c)**2;
}
// Raw image descriptors for image-plane field baselines, which have no 3D pose.
export function sampleAppearance(frame, id, x, y) {
 const patch=centerPatch(frame,{x,y});
 if(!patch||!textured(patch))return null;
 return {id,x,y,patch:btoa(String.fromCharCode(...patch))};
}
// Returns null unless the independent check and repeatable image texture support a reusable view.
// One record is one optical viewpoint; only small local patches leave the device if saved.
export function captureReference({frame,model,K,tracks,sectionId='all'}={}){
 if(!validRaster(frame)||frame.data?.length!==frame.width*frame.height||!model?.nodes||!K||!(tracks instanceof Map))return null;
 const scope=eligible(model,sectionId),records=new Map();
 // Round-robin role groups so controls cannot crowd out independent checks and targets.
 const perRole=roleOrder.map(role=>scope.filter(n=>n.role===role&&tracks.has(n.id)));
 const pool=[];for(let i=0;i<Math.max(...perRole.map(g=>g.length));i++)for(const group of perRole)if(group[i])pool.push(group[i]);
 for(const node of pool){
  const track=tracks.get(node.id),patch=centerPatch(frame,track);if(!patch||!textured(patch))continue;
  records.set(node.id,{id:node.id,x:track.x,y:track.y,patch:btoa(String.fromCharCode(...patch))});
  if(records.size===maxPoints)break;
 }
 const fit=audited(records,scope,K);if(!fit)return null;
 return {format:'bridgelab-appearance-v1',modelId:model.id,revision:model.revision,sectionId,width:frame.width,height:frame.height,points:[...fit.tracks.values()]};
}

// Coarse, contrast-normalized image descriptors are shared by every candidate viewpoint in this frame.
// The grid covers the entire camera image, allowing recovery after a large translation.
const proposalCache=new WeakMap(),compiledCache=new WeakMap(),boardCache=new WeakMap();
const gridOffsets=[-8,-4,0,4,8];
function integral(data,width,height){
 const stride=width+1,table=new Int32Array(stride*(height+1));
 for(let y=0;y<height;y++){let sum=0;for(let x=0;x<width;x++){
  sum+=data[y*width+x];table[(y+1)*stride+x+1]=table[y*stride+x+1]+sum;
 }}return table;
}
function box(table,stride,x,y){
 const i=(y-2)*stride+x-2;
 return table[i+5*stride+5]+table[i]-table[i+5]-table[i+5*stride];
}
function coarseVector(table,stride,x,y,out,offset){
 let sum=0,energy=0,k=offset;
 for(const dy of gridOffsets)for(const dx of gridOffsets){const v=box(table,stride,x+dx,y+dy);out[k++]=v;sum+=v;energy+=v*v}
 const den=Math.sqrt(Math.max(0,energy-sum*sum/25));
 if(den<15*25)return false;
 for(let i=offset;i<k;i++)out[i]=(out[i]-sum/25)/den;
 return true;
}
function proposals(frame){
 if(proposalCache.has(frame))return proposalCache.get(frame);
 const {width,height,data}=frame,table=integral(data,width,height),stride=width+1;
 const n=Math.ceil(width/3)*Math.ceil(height/3),vectors=new Float32Array(n*25),positions=new Int32Array(n);
 let count=0;
 for(let y=12;y<height-11;y+=3)for(let x=12;x<width-11;x+=3){
  if(!coarseVector(table,stride,x,y,vectors,count*25))continue;
  positions[count++]=y*width+x;
 }
 const index={count,vectors,positions};proposalCache.set(frame,index);return index;
}
const fineOffsets=[];for(let y=-8;y<=8;y+=2)for(let x=-8;x<=8;x+=2)fineOffsets.push([x,y]);
function compiled(ref){
 if(compiledCache.has(ref))return compiledCache.get(ref);
 const out=[];
 for(const p of ref.points){
  if(typeof p?.id!=='string'||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<11||p.y<11||p.x>ref.width-12||p.y>ref.height-12||typeof p.patch!=='string'||!/^[A-Za-z0-9+/]{588}$/.test(p.patch))return [];
  const data=Uint8Array.from(atob(p.patch),s=>s.charCodeAt(0));if(!textured(data))continue;
  const coarse=new Float32Array(25),table=integral(data,patchSide,patchSide);
  if(!coarseVector(table,patchSide+1,10,10,coarse,0))continue;
  const values=fineOffsets.map(([x,y])=>data[(10+y)*patchSide+x+10]);
  const mean=values.reduce((s,v)=>s+v,0)/values.length,energy=Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0));
  if(energy<5*Math.sqrt(values.length))continue;
  out.push({...p,coarse,weights:Float32Array.from(values,v=>(v-mean)/energy)});
 }
 compiledCache.set(ref,out);return out;
}
const peakLimit=9;
function promisingCenters(pattern,index,width){
 const peaks=[],{count,vectors,positions}=index;
 for(let i=0;i<count;i++){
  let score=0;for(let j=0;j<25;j++)score+=pattern[j]*vectors[i*25+j];
  if(score<.35||peaks.length>=peakLimit&&score<=peaks[peaks.length-1].score)continue;
  const x=positions[i]%width,y=(positions[i]-x)/width;
  const near=peaks.findIndex(p=>Math.abs(p.x-x)<=5&&Math.abs(p.y-y)<=5);
  if(near>=0){if(peaks[near].score>=score)continue;peaks.splice(near,1)}
  let n=peaks.length;while(n>0&&peaks[n-1].score<score)n--;
  peaks.splice(n,0,{x,y,score});if(peaks.length>peakLimit)peaks.pop();
 }
 return peaks;
}
function viewOffsets(w,scale,rotation){
 const c=Math.cos(rotation)*scale,s=Math.sin(rotation)*scale;
 return fineOffsets.map(([x,y])=>Math.round(x*c-y*s)+Math.round(x*s+y*c)*w);
}
function correlate(frame,at,offsets,pattern){
 let cov=0,sum=0,ss=0;const d=frame.data;
 for(let i=0;i<offsets.length;i++){const v=d[at+offsets[i]];sum+=v;ss+=v*v;cov+=v*pattern.weights[i]}
 return cov/Math.sqrt(Math.max(1,ss-sum*sum/offsets.length));
}
function matchPattern(frame,index,pattern,offsets){
 const peaks=promisingCenters(pattern.coarse,index,frame.width),matches=[];
 for(const p of peaks){
  let best=null;
  for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
   const x=p.x+dx,y=p.y+dy;if(x<11||x>frame.width-12||y<11||y>frame.height-12)continue;
   const at=y*frame.width+x,score=correlate(frame,at,offsets[0],pattern);
   if(!best||score>best.score)best={x,y,score};
  }
  if(!best)continue;
  // Small rotation and scale changes are common between repeat visits. Refine only plausible peaks.
  if(best.score>.34&&best.score<.985){const base=best;
   for(let j=1;j<offsets.length;j++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const x=base.x+dx,y=base.y+dy;if(x<12||x>frame.width-13||y<12||y>frame.height-13)continue;
    const score=correlate(frame,y*frame.width+x,offsets[j],pattern);if(score>best.score)best={x,y,score};
   }
  }
  matches.push(best);
 }
 matches.sort((a,b)=>b.score-a.score);const best=matches[0];if(!best||best.score<.77)return null;
 const second=matches.find(p=>Math.hypot(best.x-p.x,best.y-p.y)>5);
 if(second&&best.score-second.score<.08)return null;
 return {x:best.x+(pattern.x-Math.round(pattern.x)),y:best.y+(pattern.y-Math.round(pattern.y)),score:Math.min(1,best.score)};
}
function fromBoard(image,model,nodes,K,sectionId){
 if(!validRaster(image)||image.data?.length!==image.width*image.height*4)return failure(sectionId,'no_image');
 let decoded=boardCache.get(image);
 if(!decoded){decoded=globalThis.BoardVision.detect(image);boardCache.set(image,decoded)}
 const mapping=model.id==='ar-test-board'?builtinCodes:model.markerMap;
 const points=new Map(decoded.points.filter(p=>mapping[p.id]).map(p=>[mapping[p.id],{x:p.xy[0]*image.width-.5,y:p.xy[1]*image.height-.5,score:1}]));
 const result=audited(points,nodes,K);return result?{ok:true,...result,sectionId,method:'coded',reason:''}:failure(sectionId,'unverified_codes');
}
// One candidate reference/viewpoint per call. The caller can test neighboring sections against
// the same immutable frame, then reject mutually inconsistent successful section hypotheses.
export function registerFrame({image,frame,model,K,reference,sectionId=reference?.sectionId??model?.sections?.[0]?.id??'all'}={}){
 const fail=reason=>failure(sectionId,reason);
 if(!model?.nodes||!K)return fail('no_model');
 const nodes=eligible(model,sectionId);if(!nodes.length)return fail('unknown_section');
 if(!reference&&(model.id==='ar-test-board'||model.markerMap))return fromBoard(image,model,nodes,K,sectionId);
 if(!reference)return fail('no_reference');
 if(reference.format!=='bridgelab-appearance-v1'||reference.modelId!==model.id||reference.revision!==model.revision||reference.sectionId!==sectionId)return fail('reference_scope');
 if(!validRaster(reference)||!validRaster(frame)||frame.data?.length!==frame.width*frame.height||!Array.isArray(reference.points)||reference.points.length<6||reference.points.length>maxPoints)return fail('invalid_reference');
 const ids=new Set(reference.points.map(p=>p?.id));if(ids.size!==reference.points.length||![...ids].every(id=>nodes.some(n=>n.id===id)))return fail('reference_scope');
 const observations=matchAppearance(frame,reference);
 const result=audited(observations,nodes,K);
 return result?{ok:true,...result,sectionId,method:'appearance',reason:''}:fail('unverified_appearance');
}

// Recover independently observed image coordinates. Geometry and point roles
// are checked by the caller using the appropriate 3D or planar reference.
export function matchAppearance(frame,reference) {
 const observations=new Map();
 if(!validRaster(frame)||!validRaster(reference)||!Array.isArray(reference.points)
   ||reference.points.length<6||reference.points.length>maxPoints)return observations;
 const patterns=compiled(reference);
 if(patterns.length<6)return observations;
 const index=proposals(frame),w=frame.width;
 const offsets=[[1,0],[.9,0],[1.1,0],[1,.13],[1,-.13]].map(([s,r])=>viewOffsets(w,s,r));
 for(const pattern of patterns){
   const match=matchPattern(frame,index,pattern,offsets);
   if(match)observations.set(pattern.id,match);
 }
 return observations;
}

// Test a proposed field landmark against the rest of its actual image.
// This rejects repeated bolts and tiles before the operator saves the view.
export function uniqueLandmark(frame,x,y){
 const record=sampleAppearance(frame,'candidate',x,y);
 if(!record)return false;
 const reference={width:frame.width,height:frame.height,points:[record]};
 const pattern=compiled(reference)[0];if(!pattern)return false;
 const offsets=[[1,0],[.9,0],[1.1,0],[1,.13],[1,-.13]].map(([s,r])=>viewOffsets(frame.width,s,r));
 const match=matchPattern(frame,proposals(frame),pattern,offsets);
 return !!match&&Math.hypot(match.x-x,match.y-y)<=1.4;
}

// Recover an unmatched landmark in a bounded neighborhood predicted by other
// observed controls. The returned point is a unique image-correlation peak.
export function matchAppearanceNear(frame,reference,id,center,scale=1,angle=0,range=12) {
 const pattern=compiled(reference).find(p=>p.id===id);
 if(!pattern||!Array.isArray(center)||!center.every(Number.isFinite)||
    !Number.isFinite(scale)||scale<.65||scale>1.5||!Number.isFinite(angle))return null;
 const w=frame.width,h=frame.height,limit=Math.ceil(12*scale)+3;
 const offsets=viewOffsets(w,scale,angle),cx=Math.round(center[0]),cy=Math.round(center[1]);
 let bx=0,by=0,best=-2;
 const scores=[];
 for(let y=Math.max(limit,cy-range);y<=Math.min(h-limit-1,cy+range);y++){
   for(let x=Math.max(limit,cx-range);x<=Math.min(w-limit-1,cx+range);x++){
     const score=correlate(frame,y*w+x,offsets,pattern);
     scores.push([x,y,score]);
     if(score>best){bx=x;by=y;best=score;}
   }
 }
 if(best<.80)return null;
 if(scores.some(([x,y,s])=>Math.max(Math.abs(x-bx),Math.abs(y-by))>3&&best-s<.065))return null;
 return {x:bx+pattern.x-Math.round(pattern.x),y:by+pattern.y-Math.round(pattern.y),score:best};
}
