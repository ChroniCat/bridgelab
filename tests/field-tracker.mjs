// Run: node --test tests/field-tracker.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBaseline,createTracker} from '../field/tracker.js';
import {proposePoints} from '../field/setup.js';

const w=320,h=200;
const points=[[45,36],[260,36],[260,167],[45,167],[198,93],[123,116]];
function pixelTiles(seed) {
  let state=seed;
  return points.map(()=>{
    const cells=[];
    for(let i=0;i<18*18;i++){
      state=(Math.imul(1664525,state)+1013904223)>>>0;cells.push(24+(state>>>24)*.83);
    }
    return cells;
  });
}
function raster(tiles,dx=0,dy=0,targetDx=0,checkDx=0) {
  const frame={width:w,height:h,data:new Uint8Array(w*h).fill(100)};
  points.forEach(([cx,cy],i)=>{
    cx+=dx+(i===5?targetDx:i===4?checkDx:0);cy+=dy;
    for(let y=-17;y<17;y++)for(let x=-17;x<17;x++){
      frame.data[(cy+y)*w+cx+x]=tiles[i][((y+17)>>1)*18+((x+17)>>1)];
    }
  });return frame;
}
const first=pixelTiles(486349),second=pixelTiles(155339);
function view(id,tiles){const result=createBaseline({id,frame:raster(tiles),points});assert.equal(result.ok,true,result.reason);return result.baseline;}
const a=view('A',first), b=view('B',second);
test('absolute section recognition, motion compensation, occlusion and reverse revisit',()=>{
  const tracker=createTracker(), views=[a,b];let now=0;
  const read=frame=>tracker.observe(frame,views,now+=300);
  assert.equal(read(raster(first)).reason,'confirming');
  const moved=read(raster(first,4,3));assert.equal(moved.sectionId,'A');assert.ok(moved.offsetPx<.35);
  const shifted=read(raster(first,6,1,8));assert.equal(shifted.sectionId,'A');assert.ok(Math.abs(shifted.offsetPx-8)<.65);
  const empty={width:w,height:h,data:new Uint8Array(w*h).fill(110)};
  assert.equal(read(empty).ok,false);
  assert.equal(read(raster(second)).reason,'confirming');assert.equal(read(raster(second)).sectionId,'B');
  assert.equal(read(empty).ok,false);assert.equal(read(raster(first)).reason,'confirming');assert.equal(read(raster(first)).sectionId,'A');
});
test('ambiguous repeated bays are rejected, even if the monitoring target would break the tie',()=>{
  const duplicate=view('B',first), tracker=createTracker();
  assert.equal(tracker.observe(raster(first),[a,duplicate],10).reason,'ambiguous');
  const altered=[...first];altered[5]=second[5];const almostDuplicate=view('C',altered);
  assert.equal(tracker.observe(raster(first),[a,almostDuplicate],100).reason,'ambiguous');
});
test('independent checkpoint and texture/geometry gates exclude false observations',()=>{
  const tracker=createTracker();
  assert.equal(tracker.observe(raster(first,0,0,0,9),[a],200).ok,false);
  assert.equal(createBaseline({id:'bad',frame:raster(first),points:[...points.slice(0,5),points[4]]}).reason,'spacing');
  assert.equal(createBaseline({id:'bad',frame:raster(first),points:[points[0],points[2],points[1],...points.slice(3)]}).reason,'geometry');
  assert.equal(createBaseline({id:'flat',frame:{width:w,height:h,data:new Uint8Array(w*h)},points}).reason,'texture');
  const auto=proposePoints(raster(first),points[5]);assert.equal(auto.length,6);assert.ok(Math.max(...auto[5].map((v,i)=>Math.abs(v-points[5][i])))<=8);
});
test('overlap is verified only when both independent IDs and both declared shared corners agree',()=>{
  const prior=[[30,36],[150,36],[150,165],[30,165],[121,82],[68,123]];
  const next =[[150,36],[285,36],[285,165],[150,165],[246,86],[199,125]];
  const frame={width:w,height:h,data:new Uint8Array(w*h).fill(110)};
  function stamp(p,cells){
    for(let y=-17;y<17;y++)for(let x=-17;x<17;x++)
      frame.data[(p[1]+y)*w+p[0]+x]=cells[((y+17)>>1)*18+((x+17)>>1)];
  }
  prior.forEach((p,i)=>stamp(p,first[i]));
  [1,2,4,5].forEach(i=>stamp(next[i],second[i]));
  const aa=createBaseline({id:'L',frame,points:prior});
  const bb=createBaseline({id:'R',frame,points:next,overlap:{sectionId:'L',pairs:[['C1','C2'],['C4','C3']]}});
  assert.ok(aa.ok&&bb.ok);
  const tracker=createTracker(),both=[aa.baseline,bb.baseline];
  assert.equal(tracker.observe(frame,both,1).reason,'confirming');
  const hit=tracker.observe(frame,both,100);
  assert.equal(hit.overlapVerified,true);assert.notEqual(hit.sectionId,hit.overlapWith);
  const falseLink={...bb.baseline,overlap:{sectionId:'L',pairs:[['C1','C1'],['C4','C3']]}};
  assert.equal(createTracker().observe(frame,[aa.baseline,falseLink],100).reason,'ambiguous');
});
