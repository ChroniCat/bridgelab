import test from 'node:test';
import assert from 'node:assert/strict';
import {createWalkTracker} from '../target/walk-tracker.js';
import {fixedLandmarks,measurementLandmarks,referencePixelsPerMetre} from '../target/walk-landmarks.js';

function photograph({w=620,h=450,station=30,shift={},omit=[],tilt=.15,roll=.12}={}) {
  // Perspective, slight camera roll and a partial crop. Paint the pixels
  // independently of the estimator. Nothing passes camera pose or motion to it.
  const data=new Uint8ClampedArray(w*h*4); data.fill(198);
  for(const p of [...fixedLandmarks,...measurementLandmarks]){
    if(omit.includes(p.id))continue;
    const dx=p.xyz[0]-station,dy=p.xyz[1]-(shift[p.id]||0)/referencePixelsPerMetre-3.8;
    const scale=18/(1+tilt*dx/35+.008*dy);
    const x=w/2+scale*(dx+roll*dy),y=h/2+scale*(roll*dx-dy);
    const rgb=p.color.substring(1).match(/../g).map(u=>parseInt(u,16)*.82+16);
    const r=.255*scale;
    for(let v=Math.max(0,Math.ceil(y-r));v<=Math.min(h-1,y+r);v++)
      for(let u=Math.max(0,Math.ceil(x-r));u<=Math.min(w-1,x+r);u++)
        if((u-x)**2+(v-y)**2<r*r)data.set(rgb,4*(v*w+u));
  }
  return {width:w,height:h,data};
}

test('station and sub-pixel optical changes are recovered from independent observations through camera perspective',()=>{
  const tracker=createWalkTracker();
  for(const station of [18,30,46,61,75,90]){
    tracker.reset();
    const normal=tracker.observe(photograph({station}));
    assert.equal(normal.ok,true); assert.ok(Math.abs(normal.stationM-station)<.15);
    assert.ok(normal.segments.length>5);
    assert.ok(normal.measurements.every(m=>Math.abs(m.displacementPx)<1));
  }
  const tilted=tracker.observe(photograph({station:72,w:395,h:790,roll:-.17,shift:{'N15-B':4.7}}));
  assert.equal(tilted.ok,true);
  const m=tilted.measurements.find(p=>p.id==='N15-B');
  assert.ok(m.displacementPx>m.thresholdPx);
  assert.ok(Math.abs(m.displacementPx-4.7)<1);
  assert.ok(Math.abs(m.expected[1]-m.point[1])>2);
});

test('missing moving node suppresses its reading and an unrelated frame clears lock',()=>{
  const tracker=createWalkTracker();
  assert.equal(tracker.observe(photograph({station:20})).ok,true);
  const hidden=tracker.observe(photograph({station:20,omit:['N4-B']}));
  assert.equal(hidden.ok,true);
  assert.ok(!hidden.measurements.some(m=>m.id==='N4-B'));
  const insufficient=photograph({omit:fixedLandmarks.slice(1).map(p=>p.id)});
  assert.equal(tracker.observe(insufficient).ok,false);
  assert.equal(tracker.observe(photograph({station:70})).ok,true);
});
