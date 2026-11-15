import test from 'node:test';
import assert from 'node:assert/strict';
import {createWalkSession} from '../target/walk-session.js';
function sample(s,x,n,t,location='A') {
  return s.addObservation({ok:true,stationM:x,measurements:[{id:location,labelZh:location,labelEn:location,displacementPx:n,thresholdPx:3}]},t);
}
test('walk summary counts sustained episodes and ranks their peak, excluding isolated spikes',()=>{
  const s=createWalkSession(0);
  assert.equal(sample(s,12,7,100).length,0);
  assert.equal(sample(s,12.5,7.5,300).length,1);
  sample(s,13,7,500);sample(s,13.5,0,700);sample(s,14,0,900);
  sample(s,14.5,4,1100);assert.equal(sample(s,15,5,1300).length,1);
  sample(s,15,60,1400,'isolated');
  const out=s.finish(1600);assert.equal(out.episodes.length,2);assert.equal(out.maxLocation.id,'A');
  assert.equal(out.maxLocation.maxPx,7.5);assert.equal(out.observedLocations,2);
  assert.equal(out.realDistanceM,null);assert.equal(out.modelDistanceM,3);assert.equal(out.durationS,1.6);
  assert.deepEqual(s.addObservation(null,2000),[]);assert.equal(s.finish(4200),out);
});
test('station jumps, lost tracking and revisiting a segment do not increase the coverage',()=>{
  const s=createWalkSession(0);
  for(const [station,t] of [[3,0],[4,500],[5,1000],[4,1500],[90,1750],[91,2000]])sample(s,station,0,t);
  s.addObservation({ok:false},2300);sample(s,55,0,2600);sample(s,56,0,3000);
  assert.equal(s.finish(3200).modelDistanceM,4);
});
test('GPS distance distinguishes no fix, stationary jitter, walking and discontinuous fixes',()=>{
  const p=(x,t,acc=2)=>({timestamp:t,coords:{latitude:0,longitude:x/111195,accuracy:acc}});
  const s=createWalkSession(0);s.setLocationStatus('waiting');s.addPosition(p(0,1000));s.addPosition(p(1,2000));
  s.addPosition(p(2,3000));s.addPosition(p(4,5000));s.addPosition(p(6,6000,60));
  s.addPosition(p(50,9000));s.addPosition(p(51,10000));
  const out=s.finish(10000);assert.ok(Math.abs(out.realDistanceM-4)<.02);assert.equal(out.modelDistanceM,null);
  const t=createWalkSession(0);t.setLocationStatus('denied');assert.equal(t.finish(100).realDistanceM,null);
});
