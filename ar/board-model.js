// X and Z span the test board. The camera sees its front (negative Y).
import {fitPose,project} from './vision.js';
import {projectAnchors} from '../field/metric.js';

const ids=['C1','C2','C3','C4','CHECK','TARGET'];
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const tolerance=3;

export function placeBridge(bridge) {
  const nodes=new Map(bridge.nodes.map(n=>[n.id,n.xyz]));
  const members=bridge.members.filter(m=>nodes.has(m.a)&&nodes.has(m.b));
  if(!members.length)throw Error('Missing bridge geometry');
  const used=[...new Set(members.flatMap(m=>[m.a,m.b]))];
  const xyz=used.map(id=>nodes.get(id));
  const bounds=bridge.displayBounds??[0,1,2].map(k=>[
    Math.min(...xyz.map(p=>p[k])),Math.max(...xyz.map(p=>p[k]))
  ]);
  const scale=.143/(bounds[0][1]-bounds[0][0]);
  if(!Number.isFinite(scale)||scale<=0)throw Error('Invalid bridge span');
  // Tilt the whole model toward the camera. Full mesh bounds include the footways and pier feet.
  const tilt=bridge.kind==='visual-reconstruction'?1.21:.76;
  const yaw=.16,c=Math.cos(tilt),s=Math.sin(tilt);
  const lift=.002+(bounds[1][1]-bounds[1][0])*.5*s*scale;
  function place([x,y,z]){
    x=scale*(x-(bounds[0][0]+bounds[0][1])/2);
    y=scale*(y-(bounds[1][0]+bounds[1][1])/2);
    z=scale*(z-bounds[2][0]);
    const v=y*c+z*s;
    return [.08+x*Math.cos(yaw)-v*Math.sin(yaw),-lift+y*s-z*c,.05+x*Math.sin(yaw)+v*Math.cos(yaw)];
  }
  return {points:new Map(used.map(id=>[id,place(nodes.get(id))])),members,place};
}

// The same affine placement maps glTF's X-right, Y-up, Z-back into the board's
// local frame. Compute clip coordinates with w = positive camera depth, just
// like the pinhole projection used for the detected points.
export function boardClipMatrix(miniature,pose,K,width,height){
  const origin=miniature.place([0,0,0]);
  const bases=[[1,0,0],[0,0,1],[0,-1,0]].map(p=>
    miniature.place(p).map((v,i)=>v-origin[i]));
  const near=.005,far=50;
  const out=new Float32Array(16);
  [...bases,origin].forEach((v,col)=>{
    const translation=col===3;
    const [x,y,z]=pose.R.map((row,i)=>row[0]*v[0]+row[1]*v[1]+row[2]*v[2]+(translation?pose.t[i]:0));
    out.set([
      2*K.fx/width*x+(2*K.cx/width-1)*z,
      -2*K.fy/height*y+(1-2*K.cy/height)*z,
      (far+near)/(far-near)*z-(translation?2*far*near/(far-near):0),
      z
    ],4*col);
  });
  return out;
}

export function drawMiniature(ctx,miniature,pose,K){
  const projected=new Map();
  for(const [id,xyz] of miniature.points){
    const xy=project(pose,K,xyz);
    if(xy)projected.set(id,{xy,depth:pose.t[2]+pose.R[2].reduce((sum,v,i)=>sum+v*xyz[i],0)});
  }
  const edges=miniature.members.map(m=>[projected.get(m.a),projected.get(m.b)])
    .filter(([a,b])=>a&&b).sort(([a,b],[c,d])=>c.depth+d.depth-a.depth-b.depth);
  if(!edges.length)return;
  const far=edges[0][0].depth+edges[0][1].depth,near=edges.at(-1)[0].depth+edges.at(-1)[1].depth;
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
  for(const [a,b] of edges){
    const t=(far-a.depth-b.depth)/Math.max(1e-8,far-near);
    ctx.beginPath();ctx.moveTo(...a.xy);ctx.lineTo(...b.xy);
    ctx.strokeStyle='rgba(23,30,59,.87)';ctx.lineWidth=2.2+t*.7;ctx.stroke();
    ctx.strokeStyle=t>.5?'#aae9ff':'#a4a9ef';ctx.lineWidth=.9+t*.48;ctx.stroke();
  }
  ctx.restore();
}

// Four known rectangular control positions constrain focal length in oblique views
// if pixels are square and principal point is near the raster centre. Writing the
// two homography columns in board units gives orthogonality and equal-length equations.
function focalEstimate(uv,world,K){
  const [a,b,c,d]=uv;
  const u=b[0]-c[0],v=d[0]-c[0],r=b[1]-c[1],s=d[1]-c[1];
  const x=a[0]-b[0]+c[0]-d[0],y=a[1]-b[1]+c[1]-d[1],det=u*s-v*r;
  if(Math.abs(det)<1)return null;
  const g=(x*s-y*v)/det,h=(u*y-r*x)/det;
  const width=Math.hypot(...world[0].map((k,i)=>k-world[1][i]));
  const height=Math.hypot(...world[0].map((k,i)=>k-world[3][i]));
  const column=(p,k,size)=>[((1+k)*(p[0]-K.cx)-(a[0]-K.cx))/(K.fx*size),((1+k)*(p[1]-K.cy)-(a[1]-K.cy))/(K.fy*size),k/size];
  const [ax,ay,az]=column(b,g,width),[bx,by,bz]=column(d,h,height);
  const t=az*bz,w=az*az-bz*bz,den=t*t+w*w;
  if(den<1e-6)return null;
  const f=Math.sqrt(-(t*(ax*bx+ay*by)+w*(ax*ax+ay*ay-bx*bx-by*by))/den)*K.fx;
  return f>K.fx*.46&&f<K.fx*2.6?{...K,fx:f,fy:f}:null;
}

export function locateBoard(detection,board,K,width,height,prior=null) {
  const observed=new Map(detection.points.map(p=>[p.id,[p.xy[0]*width-.5,p.xy[1]*height-.5]]));
  const rejected=reason=>({pose:null,K:null,rows:[],reason,observed,checkMaxPx:null,verified:false});
  if(detection.duplicates?.some(id=>ids.includes(id)))return rejected('duplicate');
  if(!ids.slice(0,4).every(id=>observed.has(id)))return rejected('missing-controls');
  const byId=new Map(board.nodes.map(n=>[n.id,n.xyz]));
  const baseline=ids.map(id=>{const [x,,z]=byId.get(id);return [x*1000,-z*1000]});
  const uv=ids.slice(0,4).map(id=>observed.get(id));
  const plane=projectAnchors(baseline,uv);
  if(!plane)return rejected('geometry');
  const check=observed.get('CHECK'),target=observed.get('TARGET');
  const checkMaxPx=check?dist(plane.predictedCheck,check):null;
  if(check&&checkMaxPx>tolerance)return {...rejected('check-failed'),checkMaxPx};
  const pairs=ids.slice(0,4).map(id=>({xyz:byId.get(id),uv:observed.get(id)}));
  function fit(intrinsics,initial) {
    const f=fitPose(pairs,intrinsics,initial);
    return f.ok&&f.inliers.length===4?{...f,K:intrinsics}:null;
  }
  let best=fit(K,prior);
  if(!best||best.maxPx>1){
    const refined=focalEstimate(uv,pairs.map(p=>p.xyz),K);
    if(refined){
      const alternate=fit(refined);
      if(alternate&&(!best||alternate.rms+.12<best.rms))best=alternate;
    }
  }
  // Independent verification of pose for rendering and planar check for readings.
  const projectedCheck=best&&project(best.pose,best.K,byId.get('CHECK'));
  const cameraSide=best&&-best.pose.R.reduce((sum,row,i)=>sum+row[1]*best.pose.t[i],0);
  const pose=best&&best.maxPx<=tolerance&&cameraSide<0&&(!check||projectedCheck&&dist(projectedCheck,check)<=tolerance)?best.pose:null;
  // Reject target readings outside the area enclosed by the four observed controls.
  const enclosed=target&&uv.every(([x,y],i)=>{
    const [nx,ny]=uv[(i+1)%4];return (nx-x)*(target[1]-y)-(ny-y)*(target[0]-x)>=0;
  });
  const rows=check&&enclosed?[{id:'TARGET',predicted:plane.predictedTarget,observed:target,px:dist(target,plane.predictedTarget)}]:[];
  const reason=!pose?'pose-uncertain':!check?'missing-check':!target?'missing-target':!enclosed?'outside':'ready';
  return {pose,K:pose?best.K:null,rows,reason,observed,checkMaxPx,verified:rows.length>0};
}
