// Distances have separate sources: GPS samples from the phone and the sections
// of the simulated bridge observed by the camera. No GPS coordinates are saved.
const radians = Math.PI / 180;
function metres(a,b) {
  const lat=(b.latitude-a.latitude)*radians, lon=(b.longitude-a.longitude)*radians;
  const h=Math.sin(lat/2)**2+Math.cos(a.latitude*radians)*Math.cos(b.latitude*radians)*Math.sin(lon/2)**2;
  return 12742000*Math.asin(Math.sqrt(Math.min(1,h)));
}

export function createWalkSession(startedAt=performance.now()) {
  const episodes=[], locations=new Map(), covered=[];
  let station=null, sightings=0, seenFrames=0, verifiedFrames=0;
  let locationStatus='off', fix=null, walked=0, lastGpsTime=-Infinity;
  let closed=null,gpsPair=false;

  function addInterval(a,b) {
    let start=Math.min(a,b), end=Math.max(a,b);
    for(let i=0;i<covered.length;) {
      const interval=covered[i];
      if(interval[1]<start){i++;continue}
      if(interval[0]>end){covered.splice(i,0,[start,end]);return}
      start=Math.min(start,interval[0]);end=Math.max(end,interval[1]);covered.splice(i,1);
    }
    covered.push([start,end]);
  }

  function followStation(value,now) {
    if(!Number.isFinite(value)){station=null;return}
    sightings++;
    if(station){
      const dt=now-station.at,delta=Math.abs(value-station.value);
      // A jump after reframing the phone doesn't verify any of the skipped distance.
      if(dt>0 && dt<=2000 && delta<=2+12*dt/1000)addInterval(value,station.value);
    }
    station={value,at:now};
  }

  function addObservation(result,now=performance.now()) {
    if(closed)return [];
    seenFrames++;
    if(result?.ok)verifiedFrames++;
    followStation(result?.ok?result.stationM:null,now);
    const fresh=[], observed=new Set();
    for(const m of (result?.ok?result.measurements:[])||[]) {
      if(!m?.id || !Number.isFinite(m.displacementPx) || !Number.isFinite(m.thresholdPx) || m.thresholdPx<=0 || observed.has(m.id))continue;
      observed.add(m.id);
      if(!locations.has(m.id)){
        locations.set(m.id,{id:m.id,labelZh:m.labelZh||m.id,labelEn:m.labelEn||m.id,maxPx:0,atS:null,episodes:0,streak:0,started:0,last:-Infinity,active:null,below:0});
      }
      const loc=locations.get(m.id),size=Math.abs(m.displacementPx),atS=Math.max(0,(now-startedAt)/1000);
      if(now-loc.last>1800){loc.streak=0;loc.active=null;loc.below=0}
      loc.last=now;
      if(size>loc.maxPx || loc.atS===null){loc.maxPx=size;loc.atS=atS}
      if(size>=m.thresholdPx) {
        loc.below=0;
        if(!loc.streak){loc.started=now;loc.pendingPeak=size;loc.pendingAt=atS}
        if(size>loc.pendingPeak){loc.pendingPeak=size;loc.pendingAt=atS}
        loc.streak++;
        if(!loc.active && loc.streak>=2 && now-loc.started>=160){
          loc.active={id:loc.id,labelZh:loc.labelZh,labelEn:loc.labelEn,atS:Math.max(0,(loc.started-startedAt)/1000),endS:atS,maxPx:loc.pendingPeak,peakS:loc.pendingAt};
          episodes.push(loc.active);loc.episodes++;fresh.push(loc.active);
        }
        if(loc.active){
          loc.active.endS=atS;
          if(size>loc.active.maxPx){loc.active.maxPx=size;loc.active.peakS=atS}
        }
      }else{
        loc.streak=0;
        if(size<m.thresholdPx*.7 && ++loc.below>=2)loc.active=null;
      }
    }
    for(const loc of locations.values()){
      if(!observed.has(loc.id)){
        loc.streak=0;
        if(now-loc.last>1800){loc.active=null;loc.below=0}
      }
    }
    return fresh;
  }
  function setLocationStatus(status) {
    if(closed || !['off','waiting','denied','unavailable','poor'].includes(status))return;
    locationStatus=status;fix=null;lastGpsTime=-Infinity;
  }
  function addPosition(position,now=performance.now()) {
    if(closed || locationStatus==='off' || locationStatus==='denied')return;
    const p=position?.coords;
    if(!p || !Number.isFinite(p.latitude) || Math.abs(p.latitude)>90 ||
      !Number.isFinite(p.longitude) || Math.abs(p.longitude)>180 || !Number.isFinite(p.accuracy) || p.accuracy<=0 || p.accuracy>15){
      locationStatus='poor';fix=null;return;
    }
    const t=Number.isFinite(position.timestamp)?position.timestamp:now;
    if(t<=lastGpsTime)return;
    const gap=t-lastGpsTime;lastGpsTime=t;
    if(!fix||gap>20000){fix={p,t};locationStatus=gpsPair?'tracking':'waiting';return}
    const len=metres(fix.p,p);
    const noise=Math.max(3,Math.hypot(p.accuracy,fix.p.accuracy));
    if(len>4.5*((t-fix.t)/1000)+noise){fix=null;locationStatus='poor';return}
    gpsPair=true;locationStatus='tracking';
    if(len>noise){walked+=len;fix={p,t}}
  }

  function finish(now=performance.now()) {
    if(closed)return closed;
    const peaks=new Map();
    for(const e of episodes)if(e.maxPx>(peaks.get(e.id)?.maxPx??-1))peaks.set(e.id,e);
    const rows=Array.from(locations.values(),loc=>{
      const peak=peaks.get(loc.id);
      return {id:loc.id,labelZh:loc.labelZh,labelEn:loc.labelEn,maxPx:peak?.maxPx??loc.maxPx,
        atS:peak?.peakS??loc.atS,episodes:loc.episodes};
    }).sort((a,b)=>(b.episodes>0)-(a.episodes>0)||b.maxPx-a.maxPx);
    const confirmed=episodes.slice().sort((a,b)=>b.maxPx-a.maxPx)[0];
    closed={durationS:Math.max(0,(now-startedAt)/1000),seenFrames,verifiedFrames,observedLocations:rows.length,
      realDistanceM:gpsPair?walked:null,locationStatus,
      modelDistanceM:sightings>=2?covered.reduce((total,[lo,hi])=>total+hi-lo,0):null,
      episodes:episodes.map(e=>({...e})),locations:rows,
      maxLocation:confirmed?{...rows.find(loc=>loc.id===confirmed.id),maxPx:confirmed.maxPx,atS:confirmed.peakS}:null};
    return closed;
  }
  return {addObservation,addPosition,setLocationStatus,finish};
}
