// Camera observations of the moving tabletop scene. Registration uses only
// fixed gussets. No simulated camera position, treatment or slider state enters
// the detector. All image points are in the input video's own pixel coordinates.
import {fixedLandmarks,measurementLandmarks,outline,paintColors,bridgeLength,referencePixelsPerMetre} from './walk-landmarks.js?v=wb5';

const FIXED=5, POINT_LIMIT=15;
const upper=fixedLandmarks.filter(p=>p.xyz[1]>0), lower=fixedLandmarks.filter(p=>p.xyz[1]===0);
const sq=(a,b)=>(a.x-b.x)**2+(a.y-b.y)**2;
function hue(r,g,b) {
  const max=Math.max(r,g,b),min=Math.min(r,g,b),range=max-min;
  if(range<27||max<50||range/max<.25)return -360;
  const angle=max===r?(g-b)/range:max===g?2+(b-r)/range:4+(r-g)/range;
  return (angle*60+360)%360;
}
const hues=paintColors.map(hex=>hue(...[1,3,5].map(pos=>parseInt(hex.slice(pos,pos+2),16))));
const lookup=new Uint8Array(32768);
for(let n=0;n<lookup.length;n++){
  const h=hue(((n>>10)<<3)+4,((n>>5&31)<<3)+4,((n&31)<<3)+4);
  if(h<0)continue;
  let closest=19;
  for(let k=0;k<hues.length;k++){
    const e=Math.abs(h-hues[k]),delta=Math.min(e,360-e);
    if(delta<closest){closest=delta;lookup[n]=k+1}
  }
}

function collect(image,buffer) {
  const {width:w,height:h,data}=image, total=w*h;
  const mask=buffer.mask, queue=buffer.queue;
  for(let j=0,i=0;j<total;j++,i+=4)mask[j]=lookup[((data[i]>>3)<<10)|((data[i+1]>>3)<<5)|(data[i+2]>>3)];
  const byColor=Array.from({length:6},()=>[]);
  const limit=Math.max(11,Math.min(w,h)*.075),maxArea=limit*limit;
  for(let k=0;k<total;k++){
    const col=mask[k];if(!col)continue;
    let head=0,tail=1,sx=0,sy=0,x0=w,x1=0,y0=h,y1=0;
    mask[k]=0;queue[0]=k;
    while(head<tail){
      const u=queue[head++],y=(u/w)|0,x=u-y*w;
      sx+=x;sy+=y;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
      let q;
      if(x>0&&mask[q=u-1]===col){mask[q]=0;queue[tail++]=q}
      if(x+1<w&&mask[q=u+1]===col){mask[q]=0;queue[tail++]=q}
      if(y>0&&mask[q=u-w]===col){mask[q]=0;queue[tail++]=q}
      if(y+1<h&&mask[q=u+w]===col){mask[q]=0;queue[tail++]=q}
    }
    const bw=x1-x0+1,bh=y1-y0+1;
    if(tail<5||tail>maxArea||bw>limit||bh>limit||Math.min(bw,bh)<2||
      x0===0||x1===w-1||y0===0||y1===h-1||Math.min(bw,bh)/Math.max(bw,bh)<.42)continue;
    const fill=tail/(bw*bh);
    if(fill<.52)continue;
    byColor[col-1].push({x:sx/tail,y:sy/tail,area:tail,r:Math.sqrt(tail/Math.PI),col:col-1});
  }
  for(const group of byColor)if(group.length>POINT_LIMIT){
    group.sort((a,b)=>b.area-a.area);group.length=POINT_LIMIT;
  }
  return byColor;
}

// The model plane coordinates are station x and elevation y. Calculate the
// least-squares homography in a normalized coordinate system for stability.
function homography(pairs) {
  if(pairs.length<4)return null;
  const M=Array.from({length:8},()=>new Float64Array(9));
  for(const {land,point} of pairs){
    const x=(land.xyz[0]-52)/52,y=land.xyz[1]/10,u=point.x/500,v=point.y/500;
    for(const row of [[x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]])
      for(let i=0;i<8;i++)for(let j=0;j<9;j++) M[i][j]+=row[i]*row[j];
  }
  for(let i=0;i<8;i++){
    let pivot=i;
    for(let j=i+1;j<8;j++)if(Math.abs(M[j][i])>Math.abs(M[pivot][i]))pivot=j;
    if(Math.abs(M[pivot][i])<1e-9)return null;
    [M[i],M[pivot]]=[M[pivot],M[i]];
    const f=M[i][i];for(let j=i;j<=8;j++)M[i][j]/=f;
    for(let k=0;k<8;k++)if(k!==i){
      const c=M[k][i];for(let j=i;j<=8;j++)M[k][j]-=c*M[i][j];
    }
  }
  const [a,b,c,d,e,f,g,h]=M.map(r=>r[8]);
  return {
    project(station,elevation) {
      const x=(station-52)/52,y=elevation/10,w=g*x+h*y+1;
      return {x:500*(a*x+b*y+c)/w,y:500*(d*x+e*y+f)/w,w};
    },
    inverse(px,py) {
      const u=px/500,v=py/500,A=a-u*g,B=b-u*h,D=d-v*g,E=e-v*h,C=u-c,F=v-f,det=A*E-B*D;
      return {x:52+52*(C*E-B*F)/det,y:10*(A*F-C*D)/det};
    },
    // Crossing of the central vertical image line and the mid-depth of the
    // bridge. Unlike an extrapolation to sky or water it remains on the model.
    centreStation(px) {
      const u=px/500,y=.38;
      return 52+52*((u*h-b)*y+u-c)/(a-u*g);
    }
  };
}
function assign(map,byColor,tol) {
  const pairs=[];
  for(const land of fixedLandmarks){
    const q=map.project(land.xyz[0],land.xyz[1]);
    let point=null,error=tol*tol;
    for(const p of byColor[land.colorIndex]){
      const d=sq(p,q);
      if(d<error){point=p;error=d}
    }
    if(point)pairs.push({land,point,error});
  }
  return pairs;
}
function viable(pairs) {
  if(pairs.length<6)return false;
  const up=pairs.filter(({land})=>land.xyz[1]>0);
  if(up.length<2||pairs.length-up.length<2)return false;
  const xs=pairs.map(({land})=>land.xyz[0]);
  return Math.max(...xs)-Math.min(...xs)>=9.3 && new Set(pairs.map(p=>p.point)).size===pairs.length;
}
function validate(seed,byColor,w,h,tol) {
  let hits=assign(seed,byColor,tol);
  if(!viable(hits))return null;
  let H=homography(hits);if(!H)return null;
  const medRadius=hits.map(p=>p.point.r).sort((a,b)=>a-b)[hits.length>>1];
  const gate=Math.max(1.45,Math.min(5.5,medRadius*.68+.55));
  for(const t of [Math.max(gate*1.8,tol*.55),gate]){
    hits=assign(H,byColor,t).filter(({point})=>point.r>medRadius*.53&&point.r<medRadius*1.85);
    if(!viable(hits))return null;
    H=homography(hits);if(!H)return null;
  }
  const station=H.centreStation(w/2);
  if(!Number.isFinite(station)||station< -2||station>bridgeLength+2)return null;
  const mid=H.project(station,4),off=H.project(station+1,4),up=H.project(station,5);
  const dx=off.x-mid.x,dy=off.y-mid.y,ex=up.x-mid.x,ey=up.y-mid.y;
  const sx=Math.hypot(dx,dy),sy=Math.hypot(ex,ey);
  if(!Number.isFinite(sx+sy)||dx<1.5||Math.abs(dy)>dx*.7||ey> -1.25||Math.abs(ex)>Math.abs(ey)*.95||
     sy/sx<.5 || sy/sx>2.4 || Math.abs(mid.y-h/2)>h*.72)return null;
  const byId=new Set(hits.map(p=>p.land.id));
  let expected=0,valid=0;
  for(const p of fixedLandmarks){
    const q=H.project(p.xyz[0],p.xyz[1]);if(q.w<=0)continue;
    if(q.x>medRadius&&q.x<w-medRadius&&q.y>medRadius&&q.y<h-medRadius){expected++;if(byId.has(p.id))valid++}
  }
  if(valid<5||valid<expected*.55)return null;
  // Two observed points are withheld from the fitted pose to check its
  // prediction independently. Choose one from each level, avoiding end-only fits.
  const top=hits.filter(m=>m.land.xyz[1]>0), bottom=hits.filter(m=>m.land.xyz[1]===0);
  const spare=[top[Math.floor(top.length/2)],bottom[Math.floor(bottom.length/2)]];
  const test=homography(hits.filter(p=>!spare.includes(p)));
  if(!test || spare.some(({land,point})=>sq(point,test.project(land.xyz[0],land.xyz[1]))>Math.max(2.5,gate*1.6)**2))return null;
  const rms=Math.sqrt(hits.reduce((s,p)=>s+sq(p.point,H.project(p.land.xyz[0],p.land.xyz[1])),0)/hits.length);
  return {H,station,medRadius,rms,matched:hits.length,score:hits.length+valid/Math.max(expected,1)-rms*.15,scale:sy};
}
function affine(a,b,pa,pb,c,pc) {
  const ax=(pb.x-pa.x)/(b.xyz[0]-a.xyz[0]),ay=(pb.y-pa.y)/(b.xyz[0]-a.xyz[0]);
  const bx=(pc.x-pa.x-ax*(c.xyz[0]-a.xyz[0]))/c.xyz[1],by=(pc.y-pa.y-ay*(c.xyz[0]-a.xyz[0]))/c.xyz[1];
  return {project(x,y){return {x:pa.x+ax*(x-a.xyz[0])+bx*y,y:pa.y+ay*(x-a.xyz[0])+by*y}}};
}
function acquire(byColor,w,h) {
  const total=byColor.slice(0,FIXED).reduce((a,c)=>a+c.length,0);
  if(total<6)return null;
  const seeds=new Map();
  for(let i=0;i<lower.length;i++)for(let j=i+1;j<lower.length;j++){
    const a=lower[i],b=lower[j],delta=b.xyz[0]-a.xyz[0];
    if(delta>48||delta<9)continue;
    for(const pa of byColor[a.colorIndex])for(const pb of byColor[b.colorIndex]){
      const ax=(pb.x-pa.x)/delta,ay=(pb.y-pa.y)/delta,scale=Math.hypot(ax,ay);
      if(ax<2||ax>w/9||Math.abs(ay)>ax*.6||pb.x-pa.x<30||pb.r<pa.r*.55||pb.r>pa.r*1.8)continue;
      for(const c of upper){
        if(c.xyz[0]<a.xyz[0]-10||c.xyz[0]>b.xyz[0]+10)continue;
        const cx=pa.x+ax*(c.xyz[0]-a.xyz[0]),cy=pa.y+ay*(c.xyz[0]-a.xyz[0]);
        for(const pc of byColor[c.colorIndex]){
          const bx=(pc.x-cx)/c.xyz[1],by=(pc.y-cy)/c.xyz[1];
          if(by> -scale*.55||by< -scale*1.85||Math.abs(bx)>scale*.78||pc.r<pa.r*.5||pc.r>pa.r*1.8)continue;
          const map=affine(a,b,pa,pb,c,pc),tol=Math.min(16,Math.max(3.2,scale*.47));
          const pairs=assign(map,byColor,tol);
          if(pairs.length<6)continue;
          const key=pairs.map(h=>h.land.id+'@'+h.point.x).join(',');
          if(!seeds.has(key))seeds.set(key,{map,tol,n:pairs.length,err:pairs.reduce((s,v)=>s+v.error,0)/pairs.length});
        }
      }
    }
  }
  const best=[];
  for(const {map,tol} of [...seeds.values()].sort((a,b)=>b.n-a.n||a.err-b.err).slice(0,30)){
    const result=validate(map,byColor,w,h,tol);if(!result)continue;
    const prior=best.find(p=>Math.abs(p.station-result.station)<1.8);
    if(!prior)best.push(result);
    else if(prior.score<result.score)Object.assign(prior,result);
  }
  best.sort((a,b)=>b.score-a.score);
  if(!best.length || best[1]&&best[0].score-best[1].score<1.4)return null;
  return best[0];
}
function readDisplacements(result,byColor,w,h) {
  const {H,medRadius,rms}=result,observations=[];
  for(const land of measurementLandmarks){
    const [x,y]=land.xyz,expected=H.project(x,y);
    if(expected.x<medRadius||expected.x>w-medRadius||expected.y<medRadius||expected.y>h-medRadius)continue;
    const found=[];
    for(const p of byColor[5]){
      if(p.r<medRadius*.48||p.r>medRadius*2.2)continue;
      const observed=H.inverse(p.x,p.y);
      if(Math.abs(observed.x-x)>.19 || Math.abs(observed.y-y)>.62)continue;
      found.push({p,delta:(y-observed.y)*referencePixelsPerMetre});
    }
    if(found.length!==1)continue;
    const {p,delta}=found[0];
    // Under-sampled video or a high-error pose requires a larger displacement
    // to distinguish deformation from centroid noise.
    const thresholdPx=Math.max(2.55,(.47+1.7*rms)*referencePixelsPerMetre/result.scale);
    observations.push({id:land.id,labelZh:land.labelZh,labelEn:land.labelEn,stationM:x,
      displacementPx:delta,thresholdPx,point:[p.x,p.y],expected:[expected.x,expected.y]});
  }
  return observations;
}
export function createWalkTracker() {
  let previous=null,buffer=null;
  return {
    reset(){previous=null},
    observe(image){
      const w=image.width,h=image.height;
      if(!w||!h||image.data.length!==w*h*4)return {ok:false,reason:'image'};
      if(!buffer||buffer.mask.length!==w*h)buffer={mask:new Uint8Array(w*h),queue:new Int32Array(w*h)};
      const byColor=collect(image,buffer);
      let result=previous&&validate(previous.H,byColor,w,h,Math.max(5,Math.min(24,previous.scale*.82)));
      if(!result)result=acquire(byColor,w,h);
      previous=result;
      if(!result)return {ok:false,reason:'alignment'};
      const {H,station,matched}=result;
      const segments=[];
      for(const [a,b] of outline){
        const p=H.project(a[0],a[1]),q=H.project(b[0],b[1]);
        if(p.w<=0||q.w<=0||Math.max(p.x,q.x)<0||Math.min(p.x,q.x)>w||Math.max(p.y,q.y)<0||Math.min(p.y,q.y)>h)continue;
        segments.push([p.x,p.y,q.x,q.y]);
      }
      return {ok:true,stationM:Math.max(0,Math.min(bridgeLength,station)),segments,measurements:readDisplacements(result,byColor,w,h),matched};
    }
  };
}
