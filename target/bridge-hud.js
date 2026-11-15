// Persistent bridge-position reference for the full-screen recording camera.
// This is a miniature model, NOT an AR registration claim. The large projected
// steelwork overlay is drawn separately, only after visual alignment succeeds.
import {bridgeLength} from './walk-landmarks.js?v=wb5';

const span=bridgeLength/2;
const heights=[0,6.03,7.84,8.53,8.94,9.144,9.144,8.94,8.53,7.84,6.03,0];
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
const valid=m=>Number.isFinite(m)&&m>=0&&m<=bridgeLength;

export function bridgeHudState(result,lastStationM=null,field=false) {
  const recognized=!!result?.ok;
  const station=recognized&&valid(result?.stationM)?result.stationM:null;
  const previous=valid(lastStationM)?lastStationM:null;
  const section=recognized?String(result.sectionName||result.measurements?.[0]?.labelZh||'').slice(0,22):'';
  const kind=station!==null?'located':recognized&&section?'section':previous!==null?'stale':'search';
  return {kind,stationM:station,displayStationM:station??previous,section,field,
    registered:recognized&&(result?.segments?.length||0)>0};
}

export function bridgeHudLabel(state,text=(en)=>en) {
  if(state.kind==='located') {
    const spanName=state.stationM<span?text('Left span','左跨'):text('Right span','右跨');
    return text('Located','已定位')+' · '+spanName+' '+state.stationM.toFixed(1)+' m';
  }
  if(state.kind==='section')return text('Section matched · chainage unlinked','已识别桥段 · 未关联里程');
  if(state.kind==='stale')return text('Last seen, position unverified','上次位置 · 当前未定位')+' '+state.displayStationM.toFixed(1)+' m';
  return text('Searching · position unknown','定位中 · 位置未知');
}

function line(ctx,x1,y1,x2,y2){ctx.moveTo(x1,y1);ctx.lineTo(x2,y2)}
function paintTruss(ctx,x,y,width,height) {
  const start=x+11,end=x+width-11,deck=y+height*.71,roofRise=height*.34;
  const at=i=>start+(end-start)*i/22;
  const top=i=>deck-(2+heights[i%11]/9.144*roofRise);
  // Two parallel truss planes and small cross ties make this visibly a
  // model of the double-span Waibaidu form, rather than a generic flat bar.
  const backX=4,backY=-4;
  for(const [dx,dy,color,thickness] of [[backX,backY,'rgba(139,207,193,.41)',.9],[0,0,'rgba(166,238,221,.88)',1.15]]) {
    ctx.strokeStyle=color;ctx.lineWidth=thickness;ctx.beginPath();
    for(let i=0;i<22;i++){
      line(ctx,at(i)+dx,deck+dy,at(i+1)+dx,deck+dy);
      line(ctx,at(i)+dx,top(i)+dy,at(i+1)+dx,top(i+1)+dy);
      line(ctx,at(i)+dx,deck+dy,at(i)+dx,top(i)+dy);
      if(i%2)line(ctx,at(i)+dx,top(i)+dy,at(i+1)+dx,deck+dy);
      else line(ctx,at(i)+dx,deck+dy,at(i+1)+dx,top(i+1)+dy);
    }
    line(ctx,at(22)+dx,deck+dy,at(22)+dx,top(22)+dy);ctx.stroke();
  }
  ctx.strokeStyle='rgba(146,214,200,.35)';ctx.lineWidth=.8;ctx.beginPath();
  for(let i=0;i<=22;i+=2)line(ctx,at(i),top(i),at(i)+backX,top(i)+backY);
  ctx.stroke();
  // Bridge deck, central pier and two end supports.
  ctx.fillStyle='rgba(114,144,140,.65)';
  ctx.fillRect(start-4,deck+2,end-start+8,2);
  for(const i of [0,11,22])ctx.fillRect(at(i)-3,deck+4,6,Math.max(5,height*.07));
  return {start,end,deck};
}

export function drawBridgeHud(ctx,width,height,state,text=(en)=>en) {
  if(!ctx||!width||!height)return;
  const unit=clamp(Math.min(width/420,height/340),.7,1.9);
  const cardW=Math.min(width*.57,236*unit);
  const cardH=117*unit;
  const x=14*unit,y=65*unit;
  ctx.save();
  ctx.fillStyle='rgba(8,20,22,.84)';
  ctx.fillRect(x,y,cardW,cardH);
  ctx.strokeStyle='rgba(183,234,222,.32)';
  ctx.lineWidth=Math.max(1,unit*.7);
  ctx.strokeRect(x+.5,y+.5,cardW-1,cardH-1);
  const title=text('WAIBAIDU · MODEL GUIDE','外白渡桥 · 模型导航');
  ctx.font='600 '+Math.round(11*unit)+'px system-ui,sans-serif';
  ctx.fillStyle='#e8f8f4';
  ctx.fillText(title,x+10*unit,y+17*unit);
  const m=paintTruss(ctx,x+4*unit,y+20*unit,cardW-8*unit,63*unit);
  const centre=m.start+(m.end-m.start)*.5;
  ctx.fillStyle='rgba(236,243,243,.58)';
  ctx.font='500 '+Math.round(8*unit)+'px system-ui,sans-serif';
  ctx.fillText(text('Left span','左跨'),m.start+6*unit,y+91*unit);
  ctx.fillText(text('Right span','右跨'),centre+9*unit,y+91*unit);
  if(state.displayStationM!==null){
    const hx=m.start+(m.end-m.start)*clamp(state.displayStationM/bridgeLength,0,1);
    const active=state.kind==='located';
    ctx.strokeStyle=active?'#ffbb83':'#91a6a3';
    ctx.fillStyle=active?'#ffbb83':'#91a6a3';
    ctx.lineWidth=1.7*unit;ctx.beginPath();
    line(ctx,hx,m.deck-28*unit,hx,m.deck+9*unit);ctx.stroke();
    ctx.beginPath();ctx.arc(hx,m.deck-28*unit,3.5*unit,0,Math.PI*2);
    if(active)ctx.fill();else ctx.stroke();
  }
  ctx.font='550 '+Math.round(10*unit)+'px system-ui,sans-serif';
  ctx.fillStyle=state.kind==='located'?'#aaf7df':'#d7dedb';
  ctx.fillText(bridgeHudLabel(state,text),x+10*unit,y+108*unit);
  ctx.restore();
}
