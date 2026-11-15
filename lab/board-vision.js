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
function decode(q,gray,w){
 if(q.length!==4)return null;
 const at=projector(q);
 if(!at)return null;
 let word=0;const frame=[],moat=[],payload=[];
 for(let row=0;row<8;row++)for(let col=0;col<8;col++){
  const [x,y]=at((col+.5)/8,(row+.5)/8),v=gray[Math.round(y)*w+Math.round(x)];
  if(!Number.isFinite(v))return null;
  if(!row||!col||row===7||col===7)frame.push(v);
  else if(row===1||col===1||row===6||col===6)moat.push(v);
  else payload.push(v);
 }
 const median=a=>a.slice().sort((a,b)=>a-b)[Math.floor(a.length/2)];
 const black=median(frame),white=median(moat);
 if(white-black<48)return null;
 const t=(white+black)/2;
 if(frame.some(v=>v>=t)||moat.some(v=>v<=t))return null;
 for(const value of payload)word=word*2+(value<t?1:0);
 const id=rotations.get(word);
 return id?{id,center:at(.5,.5)}:null;
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
function detect(image){
 const {width:w,height:h,data}=image;
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w*h>4000000||data.length!==w*h*4)throw Error('Expected an RGBA image up to 4 megapixels');
 const n=w*h,gray=new Uint8Array(n),hist=new Uint32Array(256);
 for(let i=0;i<n;i++){
  const offset=i*4, value=(77*data[offset]+150*data[offset+1]+29*data[offset+2])>>8;
  gray[i]=value;hist[value]++;
 }
 const limit=threshold(hist,n),mask=new Uint8Array(n),queue=new Int32Array(n),found=new Map(),duplicates=new Set();
 for(let i=0;i<n;i++)mask[i]=gray[i]<=limit?1:0;
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
  if(count<42||width<14||height<14||width>Math.min(650,w*.5)||height>Math.min(650,h*.5)||
     width>4*height||height>4*width||minX===0||minY===0||maxX===w-1||maxY===h-1)continue;
  // Left/right extrema of each scanline contain the convex hull.
  const left=new Int32Array(height).fill(w),right=new Int32Array(height).fill(-1);
  for(let j=0;j<count;j++){const x=queue[j]%w,y=(queue[j]-x)/w-minY;left[y]=Math.min(left[y],x);right[y]=Math.max(right[y],x)}
  const border=[];
  for(let y=0;y<height;y++)if(right[y]>=0){border.push([left[y],minY+y],[right[y],minY+y])}
  const mark=decode(corners(border),gray,w);
  if(!mark)continue;
  if(found.has(mark.id)){duplicates.add(mark.id);continue}
  found.set(mark.id,{id:mark.id,xy:[(mark.center[0]+.5)/w,(mark.center[1]+.5)/h]});
 }
 const ids=Object.keys(codes),points=ids.filter(id=>found.has(id)&&!duplicates.has(id)).map(id=>found.get(id));
 return {points,complete:points.length===ids.length,duplicates:[...duplicates],missing:ids.filter(id=>!found.has(id))};
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
