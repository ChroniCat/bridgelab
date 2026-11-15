// Use the annotated view when canvas capture is supported. Direct camera tracks
// keep video recording available on browsers that cannot encode a canvas track.
const formats = ['video/mp4;codecs=avc1.42E01E','video/webm;codecs=vp9','video/webm;codecs=vp8','video/mp4','video/webm'];

export function coverRect(sourceWidth,sourceHeight,destWidth,destHeight) {
  const scale=Math.max(destWidth/sourceWidth,destHeight/sourceHeight);
  const width=destWidth/scale,height=destHeight/scale;
  return [(sourceWidth-width)/2,(sourceHeight-height)/2,width,height];
}

export function recordVideo(video,sourceStream,viewport,drawAnnotations,onEnded) {
  if(!globalThis.MediaRecorder)throw new Error('recording-unavailable');
  const surface=document.createElement('canvas');
  const ratio=viewport.clientWidth/viewport.clientHeight;
  const longSide=Math.min(1280,Math.max(video.videoWidth,video.videoHeight));
  surface.width=Math.max(2,2*Math.round(longSide*Math.min(1,ratio)/2));
  surface.height=Math.max(2,2*Math.round(longSide*Math.min(1,1/ratio)/2));
  const ctx=surface.getContext('2d',{alpha:false});
  let captured,recorder,annotated=false,closing=false,finished=false,lastDraw=-Infinity,error=false,resolve;
  const chunks=[], ready=new Promise(done=>{resolve=done});
  function draw(now) {
    if(!ctx||!video.videoWidth||!video.videoHeight||now-lastDraw<40)return;
    lastDraw=now;
    const w=surface.width,h=surface.height,vw=viewport.clientWidth,vh=viewport.clientHeight;
    if(!vw||!vh)return;
    const fit=Math.min(w/vw,h/vh),dw=vw*fit,dh=vh*fit,x=(w-dw)/2,y=(h-dh)/2;
    ctx.fillStyle='#080b0c';ctx.fillRect(0,0,w,h);
    ctx.drawImage(video,...coverRect(video.videoWidth,video.videoHeight,vw,vh),x,y,dw,dh);
    ctx.save();ctx.translate(x,y);drawAnnotations(ctx,dw,dh,now);ctx.restore();
  }
  function seal() {
    if(finished)return;finished=true;
    captured?.getTracks().forEach(t=>t.stop());
    const mime=recorder?.mimeType||chunks[0]?.type||'video/webm';
    const blob=chunks.length?new Blob(chunks,{type:mime}):null;
    resolve({blob,annotated,error:error||!blob?.size});
    if(!closing)onEnded();
  }
  function start(stream) {
    for(const mimeType of [...formats,'']) {
      try {
        if(mimeType&&MediaRecorder.isTypeSupported&&!MediaRecorder.isTypeSupported(mimeType))continue;
        const candidate=new MediaRecorder(stream,mimeType?{mimeType}:undefined);
        candidate.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};
        candidate.onstop=seal;
        candidate.onerror=()=>{error=true;if(candidate.state!=='inactive'){try{candidate.stop()}catch{seal()}}else seal()};
        candidate.start(1000);
        return candidate;
      } catch { /* Try the next native container. */ }
    }
    return null;
  }
  if(ctx&&surface.captureStream) {
    try{draw(performance.now());captured=surface.captureStream(24);recorder=start(captured)}catch{}
    if(!recorder){captured?.getTracks().forEach(t=>t.stop());captured=null}
    else annotated=true;
  }
  if(!recorder)recorder=start(sourceStream);
  if(!recorder)throw new Error('recording-unavailable');
  return {
    draw:annotated?draw:()=>{},
    stop() {
      closing=true;
      if(!finished){
        if(recorder.state!=='inactive'){try{recorder.stop()}catch{seal()}}
        setTimeout(seal,3200);
      }
      return ready;
    }
  };
}

// Keep the most recent completed take on this device. A denied storage request
// or quota error leaves the in-tab download and playback available.
function openArchive() {
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('bridgelab-camera-review',1);
    req.onupgradeneeded=()=>req.result.createObjectStore('latest');
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
export async function lastTake(mode,take) {
  const db=await openArchive();
  try {
    return await new Promise((resolve,reject)=>{
      const write=take!==undefined;
      const tx=db.transaction('latest',write?'readwrite':'readonly'), store=tx.objectStore('latest');
      const request=write?store.put(take,mode):store.get(mode);
      tx.oncomplete=()=>resolve(write?true:request.result);
      tx.onerror=tx.onabort=()=>reject(tx.error);
    });
  } finally {db.close()}
}
