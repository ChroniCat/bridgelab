// The truth generator and its initial labels are never consulted by the estimator after seeding.
export const replayK = {fx:500,fy:500,cx:320,cy:180};
export const replaySize=[640,360];
const xyz=(id,role,x,y,z)=>({id,role,xyz:[x,y,z],label:id});
const bottom=[0,2,4,6,8].map((x,i)=>xyz('B'+i,'control',x,0,0));
const top=[0,2,4,6,8].map((x,i)=>xyz('U'+i,'control',x,0,2.2));
const far=[0,2,4,6,8].map((x,i)=>xyz('F'+i,'tie',x,1.2,2.2));
const check=xyz('K1','check',1.1,0,1.0),target=xyz('T1','target',5,0,1.05);
const nodes=[...bottom,...top,...far,check,target],members=[];
for(let i=0;i<=4;i++){members.push({a:'B'+i,b:'U'+i},{a:'U'+i,b:'F'+i});if(i<4)members.push({a:'B'+i,b:'B'+(i+1)},{a:'U'+i,b:'U'+(i+1)},{a:'F'+i,b:'F'+(i+1)},{a:i%2?'U'+i:'B'+i,b:i%2?'B'+(i+1):'U'+(i+1)});}
export const replayModel={id:'synthetic-camera-replay',name:'合成桁架试验',kind:'example',revision:1,lengthM:8,units:'m',nodes,members};
export const replaySeeds=[...bottom,...top,check,target].map(n=>n.id);
function rawUV(p,t){const sway=.23*Math.sin(t*.63),nod=.07*Math.sin(t*.8),yaw=.035*Math.sin(t/2);
 const dx=p[0]-4-sway,dy=p[1]+8.7,dz=p[2]-1.1-nod;
 const depth=dy*Math.cos(yaw)+dx*Math.sin(yaw);
 return [320+500*(dx*Math.cos(yaw)-dy*Math.sin(yaw))/depth,180-500*dz/depth]}
function texture(ctx,x,y,seed){
 x=Math.round(x);y=Math.round(y);
 ctx.fillStyle='#203039';ctx.fillRect(x-12,y-12,25,25);
 let n=(seed+13)*196613;
 for(let j=0;j<21;j++)for(let i=0;i<21;i++){
  n=(Math.imul(1664525,n)+1013904223)>>>0;
  ctx.fillStyle=['#122a33','#61767b','#adbaa9','#ffebc4'][n>>>30];
  ctx.fillRect(x-10+i,y-10+j,1,1);
 }
}
export function drawReplay(ctx,t){
 const w=640,h=360,grad=ctx.createLinearGradient(0,0,0,h);grad.addColorStop(0,'#5c7882');grad.addColorStop(.58,'#aec2bb');grad.addColorStop(.59,'#657c77');grad.addColorStop(1,'#314e51');ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);
 const shift=Math.sin(t*.63)*3;ctx.strokeStyle='rgba(220,235,221,.23)';ctx.lineWidth=1;
 for(let y=230;y<358;y+=12){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y+shift);ctx.stroke()}
 const phase=t%18;const step=Math.min(1,Math.max(0,(phase-4)/2),Math.max(0,(14-phase)/2));
 const points=new Map(nodes.map(n=>{const p=[...n.xyz];if(n.role==='target')p[2]-=.32*step;return [n.id,rawUV(p,t)]}));
 for(const e of members){const [x,y]=points.get(e.a),[u,v]=points.get(e.b);ctx.lineWidth=e.a[0]==='F'?5:8;ctx.strokeStyle=e.a[0]==='F'?'#4d676b':'#354e50';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(u,v);ctx.stroke();ctx.lineWidth=1;ctx.strokeStyle='#cbd1bd';ctx.stroke()}
 for(const n of [check,target]){const [x,y]=points.get(n.id);ctx.fillStyle='#899b91';ctx.fillRect(x-12,y-11,24,22)}
 nodes.forEach((n,i)=>{const [x,y]=points.get(n.id);texture(ctx,x,y,i)});return points;
}
