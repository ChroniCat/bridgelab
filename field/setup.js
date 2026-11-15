// The camera is frozen before selection. CSS pointer coordinates are converted
// to pixels of the original clean raster, independently of the displayed size.
import {uniqueLandmark} from '../ar/auto.js';
import {grayFrame} from '../ar/vision.js';
import {landmarkIds} from './tracker.js';

function cornerScore(gray,x,y) {
  let xx=0,xy=0,yy=0;
  for(let j=-4;j<=4;j+=2)for(let i=-4;i<=4;i+=2){
    const k=(y+j)*gray.width+x+i;
    const dx=gray.data[k+1]-gray.data[k-1],dy=gray.data[k+gray.width]-gray.data[k-gray.width];
    xx+=dx*dx;xy+=dx*dy;yy+=dy*dy;
  }
  return (xx+yy-Math.hypot(xx-yy,2*xy))/2;
}
function choose(gray,region,already,preferred) {
  const x0=Math.max(12,Math.ceil(region[0])),x1=Math.min(gray.width-13,Math.floor(region[2]));
  const y0=Math.max(12,Math.ceil(region[1])),y1=Math.min(gray.height-13,Math.floor(region[3]));
  const candidates=[];
  for(let y=y0;y<=y1;y+=3)for(let x=x0;x<=x1;x+=3){
    if(already.some(p=>Math.max(Math.abs(p[0]-x),Math.abs(p[1]-y))<23))continue;
    const strength=cornerScore(gray,x,y);
    if(strength<1800)continue;
    const weight=1/(1+.85*Math.hypot((x-preferred[0])/Math.max(1,x1-x0),(y-preferred[1])/Math.max(1,y1-y0)));
    candidates.push({x,y,score:strength*weight});
  }
  candidates.sort((a,b)=>b.score-a.score);
  const tried=[];
  for(const p of candidates){
    if(tried.some(q=>Math.max(Math.abs(p.x-q.x),Math.abs(p.y-q.y))<9))continue;
    if(uniqueLandmark(gray,p.x,p.y))return [p.x,p.y];
    tried.push(p);
    if(tried.length>=18)break;
  }
  return null;
}
export function proposePoints(frame,target) {
  const gray=frame.levels?frame:grayFrame(frame);
  const {width:w,height:h}=gray,[x,y]=target;
  if(x<34||y<34||x>w-35||y>h-35)return null;
  // The tap identifies a feature; snap within a small visible radius to a
  // repeatably matchable corner on that feature, and show the resulting point.
  let targetPoint=target;
  if(!uniqueLandmark(gray,x,y)){
    targetPoint=choose(gray,[x-8,y-8,x+8,y+8],[],target);
    if(!targetPoint)return null;
  }
  const result=[];
  // Restrict each corner to its side of the target. This guarantees a useful
  // perimeter instead of four strong but nearly collinear texture peaks.
  const left=x-Math.max(20,Math.min(x*.3,50)),right=x+Math.max(20,Math.min((w-x)*.3,50));
  const top=y-Math.max(20,Math.min(y*.3,45)),bottom=y+Math.max(20,Math.min((h-y)*.3,45));
  const mx=Math.max(13,Math.round(w*.095)),my=Math.max(13,Math.round(h*.095));
  const around=[
    [mx,my,left,top], [right,my,w-mx,top],
    [right,bottom,w-mx,h-my], [mx,bottom,left,h-my]
  ];
  for(const [l,t,r,b] of around){
    const point=choose(gray,[l,t,r,b],[...result,targetPoint],[(l+r)/2,(t+b)/2]);
    if(!point)return null;
    result.push(point);
  }
  const [a,b,c,d]=result;
  const loX=Math.max(a[0],d[0])+5,hiX=Math.min(b[0],c[0])-5;
  const loY=Math.max(a[1],b[1])+5,hiY=Math.min(c[1],d[1])-5;
  const check=choose(gray,[loX,loY,hiX,hiY],[...result,targetPoint],[(loX+hiX)/2,(loY+hiY)/2]);
  return check?[...result,check,targetPoint.slice()]:null;
}
export function attachPicker(canvas,onChange=()=>{}) {
  const ctx=canvas.getContext('2d');
  let frozen=null,gray=null,points=[],mode='manual';
  function repaint(){
    if(!frozen)return;
    ctx.putImageData(frozen,0,0);
    const fontSize=Math.max(10,Math.round(canvas.width/32));
    ctx.font='bold '+fontSize+'px system-ui';
    ctx.textBaseline='bottom';ctx.textAlign='center';
    for(let i=0;i<points.length;i++){
      const [x,y]=points[i],color=i===5?'#fece51':i===4?'#70e2c4':'#a99dff';
      ctx.lineWidth=3;ctx.strokeStyle='#161625';
      ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.stroke();ctx.lineWidth=1.5;ctx.strokeStyle=color;ctx.stroke();
      ctx.fillStyle=color;ctx.fillRect(x-1,y-1,2,2);
      ctx.lineWidth=3;ctx.strokeStyle='#11121f';
      const label=landmarkIds[i];ctx.strokeText(label,x,y-7);ctx.fillText(label,x,y-7);
    }
  }
  function notify(reason='') { repaint();onChange(points.map(p=>p.slice()),reason); }
  function click(e){
    if(!frozen||mode==='manual'&&points.length===6)return;
    const b=canvas.getBoundingClientRect();
    if(b.width<=0||b.height<=0)return;
    const x=Math.round((e.clientX-b.left)*frozen.width/b.width-.5),y=Math.round((e.clientY-b.top)*frozen.height/b.height-.5);
    if(x<12||x>frozen.width-13||y<12||y>frozen.height-13){notify('points');return;}
    if(mode==='auto'){
      const suggested=proposePoints(gray,[x,y]);
      if(!suggested){points=[];notify('texture');return;}
      points=suggested;
    }else{
      if(points.some(p=>Math.max(Math.abs(p[0]-x),Math.abs(p[1]-y))<22)){notify('spacing');return;}
      points.push([x,y]);
    }
    notify();
  }
  canvas.addEventListener('click',click);
  return {
    get points(){return points.map(p=>p.slice());},
    setMode(next){if(next!=='manual'&&next!=='auto')return;mode=next;points=[];notify();},
    setFrame(image){
      points=[];frozen=image;gray=image?grayFrame(image):null;
      if(image){canvas.width=image.width;canvas.height=image.height;}
      else ctx.clearRect(0,0,canvas.width,canvas.height);
      notify();
    },
    undo(){if(mode==='auto')points=[];else points.pop();notify();},
    clear(){points=[];notify();},
    destroy(){canvas.removeEventListener('click',click);}
  };
}
