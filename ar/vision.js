// Pinhole projection; image observations and intrinsics refer to the same raster.
// R maps world to camera, t is expressed in the units of the input 3-D model.
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const scale=(a,s)=>a.map(v=>v*s);
const norm=a=>Math.hypot(...a);
const unit=a=>scale(a,1/norm(a));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const T=a=>a[0].map((_,j)=>a.map(row=>row[j]));
const mv=(a,b)=>a.map(row=>dot(row,b));
const mm=(a,b)=>{const cols=T(b);return a.map(row=>cols.map(v=>dot(row,v)))};
const vector=(a,n)=>Array.isArray(a)&&a.length===n&&a.every(Number.isFinite);
const validK=k=>!!k&&[k.fx,k.fy,k.cx,k.cy].every(Number.isFinite)&&k.fx>0&&k.fy>0;
const fail=reason=>({ok:false,reason,rms:null,maxPx:null,inliers:[]});

export function project(pose,K,xyz){
 if(!pose||!validK(K)||!vector(xyz,3))return null;
 const q=add(mv(pose.R,xyz),pose.t);if(q[2]<=1e-10||!q.every(Number.isFinite))return null;
 return [K.fx*q[0]/q[2]+K.cx,K.fy*q[1]/q[2]+K.cy];
}
function validPose(p){return p&&vector(p.t,3)&&Array.isArray(p.R)&&p.R.length===3&&p.R.every(r=>vector(r,3)&&Math.abs(dot(r,r)-1)<1e-4)&&Math.abs(dot(cross(p.R[0],p.R[1]),p.R[2])-1)<1e-4}
function pairsOK(ps){return Array.isArray(ps)&&ps.every(p=>p&&vector(p.xyz,3)&&vector(p.uv,2))}
function center(ps){return scale(ps.reduce((a,p)=>add(a,p.xyz),[0,0,0]),1/ps.length)}
function spread(ps){
 const x=ps.reduce((s,p)=>s+p.uv[0],0)/ps.length,y=ps.reduce((s,p)=>s+p.uv[1],0)/ps.length;
 let a=0,b=0,c=0;for(const p of ps){const u=p.uv[0]-x,v=p.uv[1]-y;a+=u*u;b+=u*v;c+=v*v}
 const high=(a+c+Math.hypot(a-c,2*b))/2;if(!high)return false;
 const low=(a*c-b*b)/high;return low/ps.length>=9 && low/high>=0.0009;
}
function frame(ps){
 const o=center(ps),v=ps.map(p=>sub(p.xyz,o));
 const a=v.reduce((best,w)=>norm(w)>norm(best)?w:best,[0,0,0]),sz=norm(a);
 if(sz<1e-10)return null;
 const x=unit(a),off=v.map(w=>sub(w,scale(x,dot(w,x))));
 const widest=off.reduce((best,w)=>norm(w)>norm(best)?w:best,[0,0,0]);if(norm(widest)<sz*.012)return null;
 const y=unit(widest),z=cross(x,y);return {o,sz,x,y,z,planar:Math.max(...v.map(w=>Math.abs(dot(w,z))))<sz*1e-4};
}
// Column-scaled normal equations with pivoted elimination. Pivot checks reject
// ill-conditioned hypotheses; a pose still has to pass physical/reprojection tests.
function solve(rows,rhs,damping=0){
 const n=rows[0].length,S=Array(n).fill(0);
 for(const row of rows)for(let j=0;j<n;j++)S[j]+=row[j]**2;
 if(S.some(v=>v<1e-22||!Number.isFinite(v)))return null;
 for(let j=0;j<n;j++)S[j]=Math.sqrt(S[j]);
 const A=Array.from({length:n},()=>Array(n+1).fill(0));
 for(let r=0;r<rows.length;r++){const w=rows[r].map((v,j)=>v/S[j]);
  for(let i=0;i<n;i++){for(let j=0;j<=i;j++)A[i][j]+=w[i]*w[j];A[i][n]+=w[i]*rhs[r]}}
 for(let i=0;i<n;i++){for(let j=i+1;j<n;j++)A[i][j]=A[j][i];A[i][i]+=damping}
 for(let k=0;k<n;k++){let pivot=k;for(let i=k+1;i<n;i++)if(Math.abs(A[i][k])>Math.abs(A[pivot][k]))pivot=i;
  if(Math.abs(A[pivot][k])<1e-10)return null;
  [A[k],A[pivot]]=[A[pivot],A[k]];const diag=A[k][k];
  for(let j=k;j<=n;j++)A[k][j]/=diag;
  for(let i=0;i<n;i++)if(i!==k){const f=A[i][k];for(let j=k;j<=n;j++)A[i][j]-=f*A[k][j]}}
 return A.map((row,j)=>row[n]/S[j]);
}
function initialize(ps,K){
 const basis=frame(ps);if(!basis)return null;const {o,sz,x,y,z,planar}=basis;if(!planar&&ps.length<6)return null;
 const rows=[],rhs=[];
 for(const pair of ps){const q=scale(sub(pair.xyz,o),1/sz),u=(pair.uv[0]-K.cx)/K.fx,v=(pair.uv[1]-K.cy)/K.fy;
  if(planar){const a=dot(q,x),b=dot(q,y);rows.push([a,b,1,0,0,0,-u*a,-u*b],[0,0,0,a,b,1,-v*a,-v*b])}
  else{const [a,b,c]=q;rows.push([a,b,c,1,0,0,0,0,-u*a,-u*b,-u*c],[0,0,0,0,a,b,c,1,-v*a,-v*b,-v*c])}
  rhs.push(u,v)}
 const h=solve(rows,rhs);if(!h)return null;let R,atOrigin;
 if(planar){
  const a=[h[0],h[3],h[6]],b=[h[1],h[4],h[7]],factor=2*sz/(norm(a)+norm(b));if(!Number.isFinite(factor))return null;
  const r1=unit(a),r2=unit(sub(b,scale(r1,dot(r1,b)))),r3=cross(r1,r2);
  R=mm(T([r1,r2,r3]),[x,y,z]);atOrigin=scale([h[2],h[5],1],factor);
 }else{
  const a=h.slice(0,3),b=h.slice(4,7),c=h.slice(8,11);if(dot(cross(a,b),c)<=0)return null;
  const r1=unit(a),r2=unit(sub(b,scale(r1,dot(b,r1))));R=[r1,r2,cross(r1,r2)];
  atOrigin=scale([h[3],h[7],1],3*sz/(norm(a)+norm(b)+norm(c)));
 }
 const pose={R,t:sub(atOrigin,mv(R,o))};return validPose(pose)?pose:null;
}
function rotation(v){
 const t=norm(v),[x,y,z]=v, A=t<1e-8?1:Math.sin(t)/t, B=t<1e-8?.5:2*(Math.sin(t/2)/t)**2;
 return [[1-B*(y*y+z*z),B*x*y-A*z,B*x*z+A*y],[B*x*y+A*z,1-B*(x*x+z*z),B*y*z-A*x],[B*z*x-A*y,B*y*z+A*x,1-B*(x*x+y*y)]];
}
function errorPx(pose,K,p){const uv=project(pose,K,p.xyz);return uv?norm(sub(uv,p.uv)):Infinity}
function refine(ps,K,start,limit){
 if(!start)return null;const o=center(ps),points=ps.map(p=>sub(p.xyz,o));
 // Rotate around the measured control centroid, even for survey grid coordinates in the millions.
 let R=start.R,t=add(mv(R,o),start.t),damping=.0001;
 const objective=(r,v)=>{let cost=0;for(let i=0;i<points.length;i++){const q=add(mv(r,points[i]),v);if(q[2]<=0)return Infinity;
  const e=Math.hypot(K.fx*q[0]/q[2]+K.cx-ps[i].uv[0],K.fy*q[1]/q[2]+K.cy-ps[i].uv[1]);cost+=e<=limit?e*e:limit*(2*e-limit)}return cost};
 let current=objective(R,t);if(!Number.isFinite(current))return null;
 for(let iter=0;iter<15;iter++){const rows=[],rhs=[];
  for(let i=0;i<points.length;i++){const r=mv(R,points[i]),[a,b,c]=r,q=add(r,t),u=q[0]/q[2],v=q[1]/q[2],sx=K.fx/q[2],sy=K.fy/q[2];
   const du=ps[i].uv[0]-(K.fx*u+K.cx),dv=ps[i].uv[1]-(K.fy*v+K.cy),weight=Math.min(1,Math.sqrt(limit/Math.max(.0001,Math.hypot(du,dv))));
   rows.push(scale([-u*b,c+u*a,-b,1,0,-u],sx*weight),scale([-c-v*b,v*a,a,0,1,-v],sy*weight));rhs.push(du*weight,dv*weight)}
  const delta=solve(rows,rhs,damping);if(!delta||norm(delta)<1e-10)break;
  const nextR=mm(rotation(delta.slice(0,3)),R),nextT=add(t,delta.slice(3)),next=objective(nextR,nextT);
  if(next<current){const improvement=current-next;R=nextR;t=nextT;current=next;damping=Math.max(1e-8,damping*.3);if(improvement<1e-7)break}
  else{damping*=10;if(damping>=1000)break}
 }
 return {R,t:sub(t,mv(R,o))};
}
export function fitPose(pairs,K,prior){
 if(!validK(K)||!pairsOK(pairs)||pairs.length<4||pairs.length>128)return fail('至少需要四个有效控制点与相机内参');
 for(let i=1;i<pairs.length;i++)for(let j=0;j<i;j++){
  if(norm(sub(pairs[i].xyz,pairs[j].xyz))<1e-8||norm(sub(pairs[i].uv,pairs[j].uv))<1)
   return fail('有控制点重复，请在不同的实物节点上标定');
 }
 if(!spread(pairs)||!frame(pairs))return fail('控制点过于集中或接近共线');
 const limit=Number.isFinite(K.controlTolerancePx)&&K.controlTolerancePx>0?K.controlTolerancePx:3.5;
 const need=Math.max(4,Math.ceil(pairs.length*.7));
 let best=null;
 function score(start,fitSet){
  const pose=refine(fitSet,K,start,limit);if(!pose)return;
  const errors=pairs.map(p=>errorPx(pose,K,p)),inliers=[];for(let i=0;i<errors.length;i++)if(errors[i]<=limit)inliers.push(i);
  if(inliers.length<need||!spread(inliers.map(i=>pairs[i]))||!frame(inliers.map(i=>pairs[i])))return;
  const sum=inliers.reduce((s,i)=>s+errors[i]**2,0),rms=Math.sqrt(sum/inliers.length);
  if(!best||inliers.length>best.inliers.length||(inliers.length===best.inliers.length&&rms<best.rms)){
   best={ok:true,pose,inliers,rms,maxPx:Math.max(...inliers.map(i=>errors[i])),errors,reason:''}}
 }
 const p=prior?.pose||prior;
 if(validPose(p)){score(p,pairs);if(best?.inliers.length===pairs.length)return best}
 score(initialize(pairs,K),pairs);
 if(best?.inliers.length!==pairs.length&&pairs.length>=5){
  // Bounded leave-one-out against an accidental bad click.
  const n=Math.min(pairs.length,12);
  for(let i=0;i<n;i++){const skip=Math.floor(i*pairs.length/n),set=pairs.filter((_,j)=>j!==skip);score(initialize(set,K),set)}
 }
 if(!best)return fail('控制点无法稳定配准，请重新选择分散的节点');
 if(best.inliers.length<pairs.length){const set=best.inliers.map(i=>pairs[i]);score(best.pose,set)}
 return best;
}
export function verifyChecks(checks,pose,K,tolerancePx=4){
 if(!validK(K)||!validPose(pose)||!pairsOK(checks)||!checks.length||!Number.isFinite(tolerancePx)||tolerancePx<=0)return {ok:false,rms:null,maxPx:null,reason:'缺少独立检查点'};
 const errors=checks.map(p=>errorPx(pose,K,p)),maxPx=Math.max(...errors);
 if(!Number.isFinite(maxPx))return {ok:false,rms:null,maxPx:null,reason:'检查点在镜头后方'};
 return {ok:maxPx<=tolerancePx,maxPx,rms:Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length),errors,reason:maxPx<=tolerancePx?'':'独立检查点偏差超限'};
}

// Area-average a two-level image pyramid once per frame. All matching uses live
// pixels; contrast normalization tolerates moderate camera gain fluctuations.
export function grayFrame(image){
 const {width,height,data}=image;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||
   (data.length!==width*height*4&&data.length!==width*height))throw Error('Invalid image raster');
 const gray=new Uint8Array(width*height);
 if(data.length===gray.length)gray.set(data);else for(let i=0,j=0;i<gray.length;i++,j+=4)gray[i]=(77*data[j]+150*data[j+1]+29*data[j+2]+128)>>8;
 const levels=[{width,height,data:gray}];
 while(levels.length<3){const src=levels.at(-1),w=Math.floor(src.width/2),h=Math.floor(src.height/2);if(w<32||h<32)break;
  const small=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const a=2*y*src.width+2*x;small[y*w+x]=(src.data[a]+src.data[a+1]+src.data[a+src.width]+src.data[a+src.width+1]+2)>>2}
  levels.push({width:w,height:h,data:small})}
 return {width,height,data:gray,levels};
}
const radius=4,side=2*radius+1,taps=side**2;
function patch(level,x,y){
 if(x-radius<1||y-radius<1||x+radius>=level.width-1||y+radius>=level.height-1)return null;
 const values=new Float32Array(taps);let sum=0,ss=0,gxx=0,gxy=0,gyy=0;let n=0;
 const w=level.width,d=level.data;
 for(let j=-radius;j<=radius;j++)for(let i=-radius;i<=radius;i++){
  const at=(y+j)*w+x+i,s=d[at],u=d[at+1]-d[at-1],v=d[at+w]-d[at-w];sum+=s;ss+=s*s;values[n++]=s;gxx+=u*u;gxy+=u*v;gyy+=v*v}
 const energy=ss-sum*sum/taps;if(energy<taps*3**2||gxx*gyy-gxy*gxy<.001*(gxx+gyy)**2)return null;
 for(let i=0;i<taps;i++)values[i]-=sum/taps;return {values,energy};
}
function ncc(pattern,level,x,y){
 if(x-radius<0||y-radius<0||x+radius>=level.width||y+radius>=level.height)return -2;
 let sum=0,ss=0,cov=0,n=0;
 for(let j=-radius;j<=radius;j++){let at=(y+j)*level.width+x-radius;
  for(let i=0;i<side;i++){const v=level.data[at++];cov+=v*pattern.values[n++];sum+=v;ss+=v*v}}
 const e=ss-sum*sum/taps;return e>taps*4?cov/Math.sqrt(e*pattern.energy):-2;
}
function walkPatch(prev,next,pt){
 let dx=0,dy=0,found=false,lastScore=0;
 for(let li=prev.levels.length-1;li>=0;li--){const factor=2**li,a=prev.levels[li],b=next.levels[li];
  // Pixel-centre mapping between levels is half-pixel aware.
  const x=Math.round((pt.x+.5)/factor-.5),y=Math.round((pt.y+.5)/factor-.5),template=patch(a,x,y);
  if(!template){if(li===0)return {ok:false,reason:'纹理不足或点位靠近画面边缘'};continue}
  const cx=x+Math.round(dx/factor),cy=y+Math.round(dy/factor),range=found?3:5;
  let best=-2,bx=cx,by=cy;const candidates=[];
  for(let v=cy-range;v<=cy+range;v++)for(let u=cx-range;u<=cx+range;u++){
   const q=ncc(template,b,u,v);candidates.push([q,u,v]);if(q>best){best=q;bx=u;by=v}}
  let second=-2;for(const [q,u,v] of candidates)if(Math.max(Math.abs(bx-u),Math.abs(by-v))>=3)second=Math.max(second,q);
  const scoreMin=li===0?.73:.53;
  if(best<scoreMin||best-second<.04){
   if(li===0)return {ok:false,reason:best<scoreMin?'图像匹配变弱':'有多个相似匹配',score:best};
   continue;
  }
  const refineOffset=(s0,s1,s2)=>s0<-.999||s2<-.999||s0-2*s1+s2>=-.00001?0:Math.max(-.5,Math.min(.5,(s0-s2)/(2*(s0-2*s1+s2))));
  const ox=li===0&&best<.999995?refineOffset(ncc(template,b,bx-1,by),best,ncc(template,b,bx+1,by)):0;
  const oy=li===0&&best<.999995?refineOffset(ncc(template,b,bx,by-1),best,ncc(template,b,bx,by+1)):0;
  dx=(bx-x+ox)*factor;dy=(by-y+oy)*factor;found=true;lastScore=best;
 }
 return found?{ok:true,x:pt.x+dx,y:pt.y+dy,score:lastScore,reason:''}:{ok:false,reason:'无法匹配前后帧'};
}
export function trackPoint(prev,next,pt){
 const rejected=(reason,score=0)=>({ok:false,x:pt?.x,y:pt?.y,score,reason});
 if(!prev?.levels||!next?.levels||prev.width!==next.width||prev.height!==next.height||
   !Number.isFinite(pt?.x)||!Number.isFinite(pt?.y))return rejected('画面尺寸或点位改变');
 const a=walkPatch(prev,next,pt);if(!a.ok)return rejected(a.reason,a.score);
 const b=walkPatch(next,prev,a);
 if(!b.ok||Math.hypot(b.x-pt.x,b.y-pt.y)>1.4)return rejected('正反向跟踪不一致',a.score);
 return a;
}

// Recover an observable displacement only under a declared local planar-motion
// constraint. Inverse projection alone cannot reveal motion normal to this plane.
function intersectPlane(plane,xyz,uv,pose,K){
 const n=cross(plane.u,plane.v);
 const rectifiedRay=unit([(uv[0]-K.cx)/K.fx,(uv[1]-K.cy)/K.fy,1]);
 const cameraToWorld=T(pose.R),dir=mv(cameraToWorld,rectifiedRay),C=scale(mv(cameraToWorld,pose.t),-1);
 const cosine=dot(dir,n),incidence=Math.abs(cosine);
 if(incidence<.25)return {ok:false,reason:'视线与量测平面夹角过小'};
 const dist=dot(sub(plane.origin,C),n)/cosine;if(!Number.isFinite(dist)||dist<=0)return {ok:false,reason:'量测平面位于镜头后方'};
 if(Math.abs(dot(sub(xyz,plane.origin),n))>Math.max(1e-8,plane.checkToleranceMm/1000))return {ok:false,reason:'模型点不属于声明的量测平面'};
 const difference=sub(add(C,scale(dir,dist)),xyz),duMm=1000*dot(difference,plane.u),dvMm=1000*dot(difference,plane.v);
 return {ok:true,duMm,dvMm,magnitudeMm:Math.hypot(duMm,dvMm),incidence};
}
export function planeMeasurement({plane,node,uv,pose,K,checks,calibrated}={}){
 const reject=reason=>({ok:false,reason});
 if(calibrated!==true)return reject('需确认相机标定、去畸变画面及目标的平面约束');
 if(!plane||!vector(plane.origin,3)||!vector(plane.u,3)||!vector(plane.v,3)||Math.abs(norm(plane.u)-1)>1e-5||Math.abs(norm(plane.v)-1)>1e-5||Math.abs(dot(plane.u,plane.v))>1e-5||
 !Array.isArray(plane.nodeIds)||typeof plane.source!=='string'||!plane.source.trim()||!Number.isFinite(plane.limitMm)||plane.limitMm<=0||
 !Number.isFinite(plane.checkToleranceMm)||plane.checkToleranceMm<=0)return reject('量测平面缺少测量来源、正交坐标轴或毫米阈值');
 if(!node||!vector(uv,2)||!vector(node.xyz,3)||!plane.nodeIds.includes(node.id)||!validPose(pose)||!validK(K))return reject('缺少符合条件的监测节点或相机位姿');
 if(node.role&&node.role!=='target')return reject('检测点不能作为监测目标');
 const held=(Array.isArray(checks)?checks:[]).filter(c=>c&&plane.nodeIds.includes(c.id));
 if(!held.length)return reject('需要同一平面中当前可见的独立检查点');
 let checkMaxMm=0;
 for(const c of held){
  if(c.id===node.id||(c.role&&c.role!=='check')||!vector(c.xyz,3)||!vector(c.uv,2)||norm(sub(c.xyz,node.xyz))<1e-7)return reject('检查点与监测点身份或位置无效');
  const measurement=intersectPlane(plane,c.xyz,c.uv,pose,K);if(!measurement.ok)return measurement;
  checkMaxMm=Math.max(checkMaxMm,measurement.magnitudeMm);
 }
 if(checkMaxMm>plane.checkToleranceMm)return {ok:false,checkMaxMm,reason:'同平面独立检查点的毫米偏差超限'};
 const target=intersectPlane(plane,node.xyz,uv,pose,K);if(!target.ok)return target;
 return {...target,limitMm:plane.limitMm,checkMaxMm,reason:''};
}
