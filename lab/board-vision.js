// Detect the six coded marks on BridgeLab's printable experiment sheet.
// Each mark is an 8 x 8 grid: black frame, white moat, 4 x 4 identifier.
(function (root) {
'use strict';
const codes = {C1:0x9f09,C2:0x609c,C3:0x14b2,C4:0x031e,CHECK:0x1edd,TARGET:0x5b63};
function cell(id, row, col) {
 if(row===0||col===0||row===7||col===7)return 1;
 if(row<2||row>5||col<2||col>5)return 0;
 return (codes[id] >> (15-(row-2)*4-col+2)) & 1;
}
const rotations=new Map();
for(const id of Object.keys(codes)){
 let bits=Array.from({length:4},(_,i)=>Array.from({length:4},(_,j)=>cell(id,i+2,j+2)));
 for(let rotation=0;rotation<4;rotation++){
  rotations.set(parseInt(bits.flat().join(''),2),id);
  bits=bits.map((row,i)=>row.map((_,j)=>bits[3-j][i]));
 }
}
function cross(a,b,c){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])}
function hull(points){
 points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 function boundary(list){
  const h=[];for(const p of list){
   while(h.length>=2&&cross(h[h.length-2],h[h.length-1],p)<=0)h.pop();
   h.push(p);
  }
  h.pop();return h;
 }
 return boundary(points).concat(boundary(points.reverse()));
}
function corners(points){
 const polygon=hull(points);
 // Remove pixel stair-steps by the area of their corner triangles.
 while(polygon.length>4){
  let min=Infinity,index=0;
  for(let i=0;i<polygon.length;i++){
   const a=polygon[(i+polygon.length-1)%polygon.length],b=polygon[i],c=polygon[(i+1)%polygon.length];
   const area=Math.abs(cross(a,b,c));
   if(area<min){min=area;index=i}
  }
  polygon.splice(index,1);
 }
 return polygon;
}
// Project unit-square coordinates to the image. A mark's center is found
// in its own frame, independently of the other five marks on the sheet.
function projector(q){
 const [a,b,c,d]=q, sx=a[0]-b[0]+c[0]-d[0],sy=a[1]-b[1]+c[1]-d[1];
 const bx=b[0]-c[0],by=b[1]-c[1],dx=d[0]-c[0],dy=d[1]-c[1],det=bx*dy-dx*by;
 if(Math.abs(det)<1)return null;
 const g=(sx*dy-dx*sy)/det,h=(bx*sy-sx*by)/det;
 return (u,v)=>{
  const w=1+g*u+h*v;
  return [((b[0]-a[0]+g*b[0])*u+(d[0]-a[0]+h*d[0])*v+a[0])/w,
          ((b[1]-a[1]+g*b[1])*u+(d[1]-a[1]+h*d[1])*v+a[1])/w];
 };
}
// Decode an optically sampled dark frame and white moat before trusting any ID.
// Bilinear samples reduce phase sensitivity on small, foreshortened screen markers.
function sample(gray,w,h,x,y){
 if(x<0||y<0||x>=w-1||y>=h-1)return NaN;
 const i=Math.floor(x)+Math.floor(y)*w,dx=x-Math.floor(x),dy=y-Math.floor(y);
 return (1-dy)*(gray[i]*(1-dx)+gray[i+1]*dx)+dy*(gray[i+w]*(1-dx)+gray[i+w+1]*dx);
}
function refineBoundary(q,gray,w,h){
 // Estimate each outer edge from local black-to-white transitions. The
 // thresholded component can be skewed by several pixels across a lit screen.
 const lines=[];
 for(let i=0;i<4;i++){
  const a=q[i],b=q[(i+1)%4],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
  const nx=dy/length,ny=-dx/length,r=Math.min(4,length*.085),edges=[];
  for(let k=1;k<=12;k++){
   const f=(k+.5)/14,x=a[0]+f*dx,y=a[1]+f*dy;let best=10,pos=null;
   for(let u=-r;u<=r;u+=.25){
    const high=sample(gray,w,h,x+(u+.65)*nx,y+(u+.65)*ny);
    const low=sample(gray,w,h,x+(u-.65)*nx,y+(u-.65)*ny);
    if(high-low>best){best=high-low;pos=[x+u*nx,y+u*ny]}
   }
   if(pos)edges.push(pos);
  }
  if(edges.length<8)return q;
  const mx=edges.reduce((t,p)=>t+p[0],0)/edges.length,my=edges.reduce((t,p)=>t+p[1],0)/edges.length;
  let xx=0,xy=0,yy=0;
  for(const [x,y] of edges){xx+=(x-mx)**2;xy+=(x-mx)*(y-my);yy+=(y-my)**2}
  const theta=.5*Math.atan2(2*xy,xx-yy);
  lines.push([mx,my,Math.cos(theta),Math.sin(theta)]);
 }
 const out=[];
 for(let i=0;i<4;i++){
  const [x,y,dx,dy]=lines[(i+3)%4],[u,v,du,dv]=lines[i],det=dx*dv-dy*du;
  if(Math.abs(det)<.12)return q;
  const t=((u-x)*dv-(v-y)*du)/det,p=[x+t*dx,y+t*dy];
  if(Math.hypot(p[0]-q[i][0],p[1]-q[i][1])>7)return q;
  out.push(p);
 }
 return out;
}
const ids=Object.keys(codes);
const percentile=(list,p)=>list.slice().sort((a,b)=>a-b)[Math.floor((list.length-1)*p)];
function decode(q,gray,w,h){
 if(q.length!==4)return null;
 const sizePx=Math.min(...q.map((p,i)=>Math.hypot(p[0]-q[(i+1)%4][0],p[1]-q[(i+1)%4][1])));
 if(sizePx<12)return null;
 const at=projector(q);
 if(!at)return null;
 let word=0;const frame=[],moat=[],payload=[];
 for(let row=0;row<8;row++)for(let col=0;col<8;col++){
  const [x,y]=at((col+.5)/8,(row+.5)/8);
  const v=sample(gray,w,h,x,y);
  if(!Number.isFinite(v))return null;
  if(!row||!col||row===7||col===7)frame.push(v);
  else if(row===1||col===1||row===6||col===6)moat.push(v);
  else payload.push(v);
 }
 const black=percentile(frame,.5),white=percentile(moat,.5);
 if(white-black<32)return null;
 const t=(white+black)/2;
 // Retain the original exact 16-bit ID requirement (minimum rotated code
 // distance is six bits). A little local glare on the surrounding ring is allowed.
 if(frame.filter(v=>v>=t).length>2||moat.filter(v=>v<=t).length>1)return null;
 for(const value of payload)word=word*2+(value<t?1:0);
 const id=rotations.get(word);
 return id?{id,center:at(.5,.5),sizePx}:null;
}
function threshold(hist,total){
 let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];
 let n=0,s=0,max=-1,t=0;
 for(let i=0;i<255;i++){
  n+=hist[i];s+=hist[i]*i;
  if(!n||n===total)continue;
  const delta=s/n-(sum-s)/(total-n),score=n*(total-n)*delta*delta;
  if(score>max){max=score;t=i}
 }
 return t;
}
function findMarks(mask,w,h,gray,queue,state){
 const n=w*h, pass=new Map();
 for(let start=0;start<n;start++){
  if(mask[start]!==1)continue;
  let count=1,minX=w,maxX=0,minY=h,maxY=0;queue[0]=start;mask[start]=2;
  for(let j=0;j<count;j++){
   const p=queue[j],x=p%w,y=(p-x)/w;
   minX=Math.min(x,minX);maxX=Math.max(x,maxX);minY=Math.min(y,minY);maxY=Math.max(y,maxY);
   if(x>0&&mask[p-1]===1){mask[p-1]=2;queue[count++]=p-1}
   if(x<w-1&&mask[p+1]===1){mask[p+1]=2;queue[count++]=p+1}
   if(y>0&&mask[p-w]===1){mask[p-w]=2;queue[count++]=p-w}
   if(y<h-1&&mask[p+w]===1){mask[p+w]=2;queue[count++]=p+w}
  }
  const width=maxX-minX+1,height=maxY-minY+1;
  if(minX===0||minY===0||maxX===w-1||maxY===h-1||width>3*height||height>3*width)continue;
  if(width>=8&&height>=8&&Math.max(width,height)<18&&count>=.18*width*height&&count<=.65*width*height)state.smallCandidates++;
  if(count<36||width<13||height<13||width>Math.min(650,w*.58)||height>Math.min(650,h*.58))continue;
  const fill=count/(width*height);
  if(fill<.12||fill>.92)continue;
  // Left/right extrema of each scanline contain the convex hull.
  const left=new Int32Array(height).fill(w),right=new Int32Array(height).fill(-1);
  for(let j=0;j<count;j++){const x=queue[j]%w,y=(queue[j]-x)/w-minY;left[y]=Math.min(left[y],x);right[y]=Math.max(right[y],x)}
  const border=[];
  for(let y=0;y<height;y++)if(right[y]>=0)border.push([left[y],minY+y],[right[y],minY+y]);
  const quad=corners(border);
  let mark=decode(quad,gray,w,h);
  if(!mark)continue;
  const refined=decode(refineBoundary(quad,gray,w,h),gray,w,h);
  if(refined?.id===mark.id)mark=refined;
  if(pass.has(mark.id)){state.duplicates.add(mark.id);continue}
  pass.set(mark.id,mark);
 }
 for(const [id,mark] of pass){
  const existing=state.found.get(id);
  if(!existing)state.found.set(id,mark);
  else if(Math.hypot(mark.center[0]-existing.center[0],mark.center[1]-existing.center[1])>Math.max(2.5,Math.min(mark.sizePx,existing.sizePx)*.12))state.duplicates.add(id);
 }
}
function localThreshold(gray,w,h,mask){
 const stride=w+1,integral=new Uint32Array(stride*(h+1));
 for(let y=0;y<h;y++){
  let sum=0;
  for(let x=0;x<w;x++){sum+=gray[y*w+x];const i=(y+1)*stride+x+1;integral[i]=integral[i-stride]+sum}
 }
 // The reference window spans several cells of each marker, including its
 // contrasting moat, without assuming an exposure shared by the whole monitor.
 const r=Math.max(9,Math.min(48,Math.round(Math.min(w,h)*.065)));
 for(let y=0;y<h;y++){
  const y0=Math.max(0,y-r),y1=Math.min(h,y+r+1);
  for(let x=0;x<w;x++){
   const x0=Math.max(0,x-r),x1=Math.min(w,x+r+1);
   const sum=integral[y1*stride+x1]-integral[y1*stride+x0]-integral[y0*stride+x1]+integral[y0*stride+x0];
   const i=y*w+x;mask[i]=(gray[i]+9)*(x1-x0)*(y1-y0)<sum?1:0;
  }
 }
}
function detect(image){
 const {width:w,height:h,data}=image;
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w*h>4000000||data.length!==w*h*4)throw Error('Expected an RGBA image up to 4 megapixels');
 const n=w*h,gray=new Uint8Array(n),hist=new Uint32Array(256);
 for(let i=0;i<n;i++){
  const offset=i*4,value=(77*data[offset]+150*data[offset+1]+29*data[offset+2])>>8;
  gray[i]=value;hist[value]++;
 }
 const limit=threshold(hist,n),mask=new Uint8Array(n),queue=new Int32Array(n);
 let darkest=0,lightest=255;while(!hist[darkest])darkest++;while(!hist[lightest])lightest--;
 const contrast=lightest-darkest;
 const state={found:new Map(),duplicates:new Set(),smallCandidates:0};
 if(contrast>=32){
  for(let i=0;i<n;i++)mask[i]=gray[i]<=limit?1:0;
  findMarks(mask,w,h,gray,queue,state);
  if(state.found.size<ids.length){localThreshold(gray,w,h,mask);findMarks(mask,w,h,gray,queue,state)}
 }
 const points=ids.filter(id=>state.found.has(id)&&!state.duplicates.has(id)).map(id=>{
  const {center,sizePx}=state.found.get(id);
  return {id,xy:[(center[0]+.5)/w,(center[1]+.5)/h],sizePx};
 });
 const missing=ids.filter(id=>!state.found.has(id)),duplicates=[...state.duplicates];
 const complete=points.length===ids.length;
 const small=points.length?Math.max(...points.map(p=>p.sizePx))<18:state.smallCandidates>=4;
 let reason=complete?'complete':points.length?'partial':'no_markers';
 if(!complete){if(duplicates.length)reason='duplicate';else if(contrast<32)reason='low_contrast';else if(small)reason='small_markers';}
 return {points,complete,duplicates,missing,contrast,reason};
}
function detectImage(imageElement){
 const w=imageElement.naturalWidth,h=imageElement.naturalHeight;
 if(!w||!h)throw Error('Image is not loaded');
 const scale=Math.min(1,1600/Math.max(w,h)),canvas=document.createElement('canvas');
 canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 ctx.drawImage(imageElement,0,0,canvas.width,canvas.height);
 return detect(ctx.getImageData(0,0,canvas.width,canvas.height));
}
const api={detect,detectImage,cell,ids:Object.keys(codes)};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.BoardVision=api;
})(typeof window==='undefined'?globalThis:window);
