export function sketch(canvas,model){
 const ctx=canvas.getContext('2d');
 const nodes=model.nodes||[],byId=new Map(nodes.map((n,i)=>[n.id,i]));
 const edges=(model.members||[]).map(m=>[byId.get(m.a),byId.get(m.b)]).filter(([a,b])=>a!=null&&b!=null);
 const bounds=[0,1,2].map(k=>nodes.reduce((b,n)=>[Math.min(b[0],n.xyz[k]),Math.max(b[1],n.xyz[k])],[Infinity,-Infinity]));
 if(!nodes.length)return {reset(){},destroy(){}};
 const centre=bounds.map(([a,b])=>(a+b)/2),dims=bounds.map(([a,b])=>b-a),span=Math.max(...dims,.001);
 const points=nodes.map(n=>n.xyz.map((x,k)=>(x-centre[k])/span));
 const isBoard=model.id==='ar-test-board';
 const originYaw=isBoard?-.19:-.66,originPitch=isBoard?.13:.53;
 let yaw=originYaw,pitch=originPitch,drag=null;
 function draw(){
  if(!canvas.isConnected)return;
  const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;
  const ratio=Math.min(2,window.devicePixelRatio||1),cw=Math.round(w*ratio),ch=Math.round(h*ratio);
  if(canvas.width!==cw||canvas.height!==ch){canvas.width=cw;canvas.height=ch}
  ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);
  const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  function cast([x,y,z]){const across=-x*sy+y*cy;return [x*cy+y*sy,-z*cp-across*sp,across*cp-z*sp]}
  const projected=points.map(cast);
  const bounds2=[0,1].map(k=>projected.reduce((b,p)=>[Math.min(b[0],p[k]),Math.max(b[1],p[k])],[Infinity,-Infinity]));
  const scale=Math.min(w*(w<590?.88:.84)/Math.max(.001,bounds2[0][1]-bounds2[0][0]),h*.77/Math.max(.001,bounds2[1][1]-bounds2[1][0]));
  const ox=w/2-(bounds2[0][0]+bounds2[0][1])*.5*scale,oy=h*.5-(bounds2[1][0]+bounds2[1][1])*.5*scale;
  const screen=p=>[ox+scale*p[0],oy+scale*p[1],p[2]];
  const xyz=coords=>screen(cast(coords));
  const displayed=projected.map(screen);
  const floor=(bounds[2][0]-centre[2])/span-.018;
  ctx.lineWidth=.65;
  for(let i=-15;i<=15;i++){
   const q=i*.075;
   ctx.strokeStyle=i%4===0?'rgba(130,135,167,.105)':'rgba(130,135,167,.052)';
   ctx.beginPath();
   for(const [a,b] of [[[-1.125,q,floor],[1.125,q,floor]],[[q,-1.125,floor],[q,1.125,floor]]]){
    ctx.moveTo(...xyz(a).slice(0,2));ctx.lineTo(...xyz(b).slice(0,2))
   }ctx.stroke();
  }
  const budget=Math.max(1,Math.ceil(edges.length/5500));
  const visible=edges.filter((_,i)=>i%budget===0).sort(([a,b],[c,d])=>projected[c][2]+projected[d][2]-projected[a][2]-projected[b][2]);
  const dRange=projected.reduce((range,p)=>[Math.min(range[0],p[2]),Math.max(range[1],p[2])],[Infinity,-Infinity]);
  const thickness=Math.max(1.5,Math.min(6,scale*.0045));
  ctx.lineCap='round';ctx.lineJoin='round';
  for(const [a,b] of visible){
   const p=displayed[a],q=displayed[b],len=Math.hypot(q[0]-p[0],q[1]-p[1]);
   if(len<.3)continue;
   const near=1-((p[2]+q[2])/2-dRange[0])/Math.max(.0001,dRange[1]-dRange[0]);
   const long=Math.abs(points[a][0]-points[b][0])>.02,flat=Math.abs(points[a][2]-points[b][2])<.003;
   const thick=thickness*(long&&flat?1.05:.74),dy=long&&flat?thick*.45:thick*.30;
   const v=Math.round(95+77*near);
   ctx.strokeStyle=`rgb(${v-51},${v-46},${v-13})`;ctx.lineWidth=thick+1;ctx.beginPath();ctx.moveTo(p[0],p[1]+dy);ctx.lineTo(q[0],q[1]+dy);ctx.stroke();
   ctx.strokeStyle=`rgb(${v+10},${v+12},${Math.min(245,v+47)})`;ctx.lineWidth=thick*.58;ctx.beginPath();ctx.moveTo(p[0],p[1]-dy*.7);ctx.lineTo(q[0],q[1]-dy*.7);ctx.stroke();
   ctx.strokeStyle=`rgba(232,233,255,${.16+near*.24})`;ctx.lineWidth=.7;ctx.stroke();
  }
  if(!edges.length||isBoard){
   ctx.fillStyle='#c0c1ed';for(const [i,[x,y]] of displayed.entries()){if(i%Math.max(1,Math.ceil(points.length/1600)))continue;ctx.beginPath();ctx.arc(x,y,isBoard?3:2,0,Math.PI*2);ctx.fill()}
  }
 }
 const resize=new ResizeObserver(draw);resize.observe(canvas);
 canvas.tabIndex=0;
 canvas.onpointerdown=e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId)};
 canvas.onpointermove=e=>{if(!drag)return;yaw+=(e.clientX-drag[0])*.0075;pitch=Math.max(-1.38,Math.min(1.38,pitch+(e.clientY-drag[1])*.008));drag=[e.clientX,e.clientY];draw()};
 canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=()=>{drag=null};
 function reset(){yaw=originYaw;pitch=originPitch;draw()}
 canvas.onkeydown=e=>{const axes={ArrowLeft:[-.12,0],ArrowRight:[.12,0],ArrowUp:[0,-.1],ArrowDown:[0,.1]};
  if(e.key==='Home'){e.preventDefault();reset();return}if(!axes[e.key])return;e.preventDefault();yaw+=axes[e.key][0];pitch=Math.max(-1.38,Math.min(1.38,pitch+axes[e.key][1]));draw()};
 draw();return {reset,destroy(){resize.disconnect();canvas.onpointerdown=canvas.onpointermove=canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=canvas.onkeydown=null}}
}
const picker=document.querySelector('#model');
const canvas=document.querySelector('#geometry');
const status=document.querySelector('#model-status');
const reset=document.querySelector('#reset');
let viewer,sequence=0;
async function load(){
 const seq=++sequence;reset.disabled=true;status.textContent='Loading example model…';
 try{
  const response=await fetch(new URL('./models/'+encodeURIComponent(picker.value)+'.json',import.meta.url));
  if(!response.ok)throw Error('Model unavailable');
  const model=await response.json();if(seq!==sequence)return;
  viewer?.destroy();viewer=sketch(canvas,model);status.textContent='Schematic model · '+model.lengthM+' m';
  reset.disabled=false;
 }catch{if(seq===sequence){viewer?.destroy();viewer=null;canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);status.textContent='Cannot load this model. Check your connection and reload.'}}
}
reset.addEventListener('click',()=>viewer?.reset());
picker.addEventListener('change',load);
load();
