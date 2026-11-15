// This fixture supplies optical pixels only. The camera path must decode their IDs
// and recover the pose independently, including when the target has moved.
import '../lab/board-vision.js';

export const boardSampleSize=[640,400];
export const boardSampleK={fx:630,fy:630,cx:320,cy:200};
const centres={C1:[-.08,-.05],C2:[.08,-.05],C3:[.08,.05],C4:[-.08,.05],CHECK:[0,0],TARGET:[-.04,0]};
export function drawBoardSample(ctx,seconds){
  const angle=.28*Math.sin(seconds*.45+.4),tilt=.15*Math.cos(seconds*.37);
  const ca=Math.cos(angle),sa=Math.sin(angle),ct=Math.cos(tilt),st=Math.sin(tilt);
  const sway=.004*Math.sin(seconds*.50),distance=.288+.012*Math.sin(seconds*.63);
  function pixel(x,y){
    const z=distance-x*sa+y*st*ca;
    return [320+630*(x*ca+y*st*sa+sway)/z,200+630*y*ct/z];
  }
  function quad(x0,y0,x1,y1){
    const a=pixel(x0,y0),b=pixel(x1,y0),c=pixel(x1,y1),d=pixel(x0,y1);
    ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.lineTo(...c);ctx.lineTo(...d);ctx.closePath();ctx.fill();
  }
  ctx.fillStyle='#34414d';ctx.fillRect(0,0,...boardSampleSize);
  ctx.fillStyle='#20242a';quad(-.111,-.079,.111,.079);
  ctx.fillStyle='#fafaf9';quad(-.104,-.074,.104,.074);
  const phase=seconds%12,travel=Math.max(0,Math.min(1,(phase-3)/.7,(9-phase)/.7));
  for(const [id,[x,baseY]] of Object.entries(centres)){
    const y=baseY+(id==='TARGET'?.01*travel:0);
    ctx.fillStyle='#111';const half=.01,cell=2*half/8;
    quad(x-half,y-half,x+half,y+half);
    // A solid white moat surrounds the independently coded inner pixels.
    ctx.fillStyle='#fafaf9';quad(x-half+cell,y-half+cell,x+half-cell,y+half-cell);
    ctx.fillStyle='#111';
    for(let r=2;r<6;r++)for(let c=2;c<6;c++){
      if(globalThis.BoardVision.cell(id,r,c))quad(x-half+c*cell,y-half+r*cell,x-half+(c+1)*cell,y-half+(r+1)*cell);
    }
  }
}
