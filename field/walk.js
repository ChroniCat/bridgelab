// Public deterministic two-section fixture. Truth is used only to render pixels.
import {createBaseline} from './tracker.js';

const width=416,height=250;
const landmarks=[[65,49],[344,49],[344,198],[65,198],[256,107],[159,133]];
function makeTexture(seed){
  const tile=document.createElement('canvas');tile.width=tile.height=35;
  const ctx=tile.getContext('2d');let s=seed>>>0;
  for(let y=0;y<35;y+=2)for(let x=0;x<35;x+=2){
    s=(Math.imul(s,1664525)+1013904223)>>>0;
    ctx.fillStyle=['#0f1922','#294354','#84999d','#cfd4bf','#e8e0be','#d5a36e','#57757b','#1c3037'][s>>>29];
    ctx.fillRect(x,y,2,2);
  }
  return tile;
}
const tiles=[0,1].map(b=>landmarks.map((_,i)=>makeTexture(232561+(b+1)*39569+i*3233)));
function render(ctx,section,shiftX,shiftY,targetShift){
  ctx.save();ctx.fillStyle='#283a44';ctx.fillRect(0,0,width,height);
  ctx.translate(shiftX,shiftY);
  const grad=ctx.createLinearGradient(0,0,0,height);grad.addColorStop(0,'#8299a0');grad.addColorStop(.65,'#d6d5ba');grad.addColorStop(1,'#596e76');
  ctx.fillStyle=grad;ctx.fillRect(-25,-25,width+50,height+50);
  ctx.strokeStyle='#465962';ctx.lineWidth=9;ctx.beginPath();ctx.moveTo(0,49);ctx.lineTo(width,49);ctx.moveTo(0,198);ctx.lineTo(width,198);
  for(let i=0;i<4;i++){const x=65+i*93;ctx.moveTo(x,49);ctx.lineTo(x,198);if(i<3){ctx.moveTo(x,i%2?49:198);ctx.lineTo(x+93,i%2?198:49)}}ctx.stroke();
  landmarks.forEach(([x,y],i)=>{ctx.drawImage(tiles[section][i],x-17+(i===5?targetShift:0),y-17)});
  ctx.restore();
}
export const demoId='simulated-walk';
export function makeWalk(){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});const sections=[];
  for(let i=0;i<2;i++){
    render(ctx,i,0,0,0);const id=i?'B':'A';
    const built=createBaseline({id,name:id,bridgeId:demoId,revision:1,frame:ctx.getImageData(0,0,width,height),points:landmarks.map(p=>[...p]),image:canvas.toDataURL('image/jpeg',.88),calibration:null});
    if(!built.ok)throw Error(built.reason);sections.push(built.baseline);
  }
  return {site:{id:demoId,name:'Synthetic walk · A / B',revision:1,source:'synthetic',sections},width,height,duration:18,draw(destination,seconds){
    if(seconds>=5&&seconds<5.9||seconds>=11&&seconds<11.9){
      destination.fillStyle='#303741';destination.fillRect(0,0,width,height);return;
    }
    const section=seconds>=5.9&&seconds<11?1:0;
    const displaced=seconds>=2&&seconds<4.7||seconds>=7.5&&seconds<10;
    render(destination,section,Math.round(4*Math.sin(seconds*1.5)),Math.round(3*Math.sin(seconds*.8)),displaced?13:0);
  }};
}
