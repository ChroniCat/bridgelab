import {loadWalkMesh} from '../models/mesh-renderer.js?v=wb5';
import {fixedLandmarks,measurementLandmarks} from './walk-landmarks.js?v=wb5';

export const walkRoute = Object.freeze({start:14,end:90.356,length:104.356,speed:2.15});
export const homeCamera = Object.freeze({station:walkRoute.start,yaw:-.18,pitch:.19,zoom:1});
const frameWidth=44;
const steelSpacing=52.178/11;
const amplitude=[.75,.42,1,.58];
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));

export function walkProjection(camera,width=1040,height=550) {
  const {station,yaw,pitch,zoom}=camera;
  const sy=Math.sin(yaw),cy=Math.cos(yaw),sp=Math.sin(pitch),cp=Math.cos(pitch);
  const scale=width*zoom/frameWidth;
  const origin=[station,3,6.096];
  const right=[cy,0,-sy], up=[-sp*sy,cp,-sp*cy], depth=[sy*cp,sp,cp*cy];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const row=(axis,factor)=>[...axis.map(c=>c*factor),-dot(axis,origin)*factor];
  const X=row(right,2*scale/width),Y=row(up,2*scale/height),Z=row(depth,-1/145);
  const matrix=new Float32Array([X[0],Y[0],Z[0],0,X[1],Y[1],Z[1],0,X[2],Y[2],Z[2],0,X[3],Y[3],Z[3],1]);
  function project(x,y,z) {
    const v=[x-origin[0],y-origin[1],z-origin[2]];
    return [width/2+scale*dot(right,v),height/2-scale*dot(up,v)];
  }
  return {matrix,project,scale};
}

// Smooth sag with zero slope at its boundaries. Nearby fixed fasteners sit at
// least one panel away. The top chord, back of the bridge and supports stay fixed.
function displacementWeight(x,y,z) {
  if(y<=-1.47||y>=8.8)return 0;
  let influence=0;
  for(let i=0;i<measurementLandmarks.length;i++) {
    const t=Math.abs(x-measurementLandmarks[i].xyz[0])/steelSpacing;
    if(t<1)influence+=(amplitude[i]??.6)*(.5+.5*Math.cos(Math.PI*t));
  }
  const across=clamp((z+5.9)/11.9,0,1);
  return influence*across*(1-clamp((y-.3)/8.5,0,1));
}

// Long asphalt and footway faces in the static model need intermediate vertices
// for a local displacement to follow the truss. Clip at panel quarter-stations.
function subdivideLongFaces(part) {
  const pos=[],norm=[],inds=[],slice=steelSpacing/4;
  const point=i=>[...part.positions.subarray(3*i,3*i+3),...part.normals.subarray(3*i,3*i+3)];
  function clip(poly,x,side) {
    if(!poly.length)return [];
    let a=poly.at(-1);const out=[];
    for(const b of poly) {
      const av=(a[0]-x)*side>=0,bv=(b[0]-x)*side>=0;
      if(av!==bv){const t=(x-a[0])/(b[0]-a[0]);out.push(a.map((v,k)=>v+(b[k]-v)*t));}
      if(bv)out.push(b);a=b;
    }
    return out;
  }
  function emit(poly) {
    const base=pos.length/3;
    for(const p of poly){pos.push(p[0],p[1],p[2]);norm.push(p[3],p[4],p[5]);}
    for(let k=1;k+1<poly.length;k++)inds.push(base,base+k,base+k+1);
  }
  // Retain the existing indexed mesh on already-finely-tessellated groups.
  let needs=false;
  for(let i=0;i<part.indices.length&&!needs;i+=3){
    const xs=[0,1,2].map(k=>part.positions[3*part.indices[i+k]]);
    needs=Math.max(...xs)-Math.min(...xs)>3*slice;
  }
  if(!needs)return {...part,positions:part.positions.slice()};
  for(let i=0;i<part.indices.length;i+=3){
    const tri=[point(part.indices[i]),point(part.indices[i+1]),point(part.indices[i+2])];
    const xs=tri.map(p=>p[0]),lo=Math.min(...xs),hi=Math.max(...xs);
    if(hi-lo<slice*1.2){emit(tri);continue;}
    for(let k=Math.floor(lo/slice);k<=Math.floor(hi/slice);k++){
      const poly=clip(clip(tri,k*slice,1),(k+1)*slice,-1);
      if(poly.length>2)emit(poly);
    }
  }
  const Index=pos.length/3>65535?Uint32Array:Uint16Array;
  return {...part,positions:new Float32Array(pos),normals:new Float32Array(norm),indices:new Index(inds)};
}

function river(ctx,w,h,project) {
  const gradient=ctx.createLinearGradient(0,0,0,h);
  gradient.addColorStop(0,'#dce9ea');gradient.addColorStop(.68,'#dae9e6');gradient.addColorStop(1,'#bed4d2');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
  const poly=(points,fill)=>{
    ctx.fillStyle=fill;ctx.beginPath();
    points.forEach((p,i)=>{const [x,y]=project(...p);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});
    ctx.closePath();ctx.fill();
  };
  // Shore walls at the abutments give the moving viewpoint an external reference.
  for(const [edge,direction] of [[-1.25,-1],[walkRoute.length+1.25,1]]){
    const outer=edge+direction*300;
    poly([[outer,-2.0,-220],[outer,-2,220],[edge,-2,220],[edge,-2,-220]],'#d5d3c6');
    poly([[edge,-4.6,-220],[edge,-4.6,220],[edge,-2.0,220],[edge,-2.0,-220]],'#acb4aa');
  }
  poly([[.8,-4.59,-7.7],[103.7,-4.59,-7.7],[103.7,-4.59,11],[.8,-4.59,11]],'#b4cbc6');
}

export async function createWalkScene(canvas) {
  const ctx=canvas.getContext('2d');
  const surface=document.createElement('canvas');
  const shaped=[];
  const renderer=await loadWalkMesh(surface,primitives=>primitives.map(source=>{
    const part=subdivideLongFaces(source);
    const original=new Float32Array(part.positions.length/3);
    const weights=new Float32Array(original.length);
    for(let i=0;i<original.length;i++){
      const k=i*3;original[i]=part.positions[k+1];
      weights[i]=displacementWeight(part.positions[k],original[i],part.positions[k+2]);
    }
    shaped.push({part,original,weights});return part;
  }));
  let magnitude=-1;
  function draw(camera,level) {
    if(magnitude!==level){
      magnitude=level;
      for(const {part,original,weights} of shaped){
        for(let i=0;i<original.length;i++)part.positions[3*i+1]=original[i]-level*weights[i];
      }
      renderer.updatePositions();
    }
    const w=canvas.width,h=canvas.height;
    if(surface.width!==w)surface.width=w;if(surface.height!==h)surface.height=h;
    const {matrix,project,scale}=walkProjection(camera,w,h);
    river(ctx,w,h,project);
    renderer.render(matrix);ctx.drawImage(renderer.source,0,0,w,h);
    // Survey paint on the exposed faces. The central colour stays flat under
    // changing view angles so the camera can identify the same physical joint.
    for(const mark of [...fixedLandmarks,...measurementLandmarks]){
      const [x,y,z]=mark.xyz;
      const shifted=measurementLandmarks.includes(mark)?level*displacementWeight(x,y,z):0;
      const [px,py]=project(x,y-shifted,z);
      const radius=.263*scale;
      if(px< -radius||px>w+radius||py< -radius||py>h+radius)continue;
      ctx.beginPath();ctx.ellipse(px,py,radius*Math.cos(camera.yaw),radius*Math.cos(camera.pitch),0,0,Math.PI*2);
      ctx.fillStyle=mark.color;ctx.fill();ctx.lineWidth=Math.max(1,scale*.045);ctx.strokeStyle='rgba(48,65,66,.72)';ctx.stroke();
    }
    canvas.dataset.renderMode=renderer.mode;
  }
  return {draw,destroy(){renderer.destroy()}};
}
