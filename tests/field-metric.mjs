// Run with: node tests/field-metric.mjs
import assert from 'node:assert/strict';
import {projectAnchors,measurePlane,fieldCondition,qualityGate,startTrial,trialStatus,
  captureTrialFrame,revealTrial,trialRecords,reportTrials} from '../field/metric.js';

const base=[[40,40],[240,40],[240,140],[40,140],[140,90],[90,90]];
const movedView=([x,y])=>[(.9*x+.1*y+23)/(1+.0006*x+.0001*y),(-.07*x+y+15)/(1+.0006*x+.0001*y)];
const now=base.map(movedView), moved=now.slice();moved[5]=movedView([107,86]);
const measure=points=>measurePlane({baseline:base,observed:points,widthMm:200,heightMm:100});
const solve=measure(moved);
assert(solve.ok);assert(Math.abs(solve.dxMm-17)<1e-8);assert(Math.abs(solve.dyMm+4)<1e-8);
assert(measure(now).magnitudeMm<1e-8);
const bad=now.slice();bad[4]=[now[4][0]+4,now[4][1]];assert.equal(measure(bad).reason,'held_out_check');
assert.equal(projectAnchors(base,[now[0],now[2],now[1],now[3]]),null);
const outside=now.slice();outside[5]=[400,300];assert.equal(measure(outside).ok,false);

const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
const conditions={bridgeId:'test-bridge',sectionId:'E1',revision:1,settings:{deviceId:'test-lens',width:640,height:480},frameWidth:480,frameHeight:360};
const condition=fieldCondition(conditions);
assert.notEqual(condition,'');assert.notEqual(fieldCondition({...conditions,revision:2}),condition);
assert.equal(fieldCondition({...conditions,settings:{width:640,height:480}}),'');
let clock=1730000000000;Date.now=()=>clock;
function run(trueX,observedX,valid=true){
  startTrial({bridgeId:'test-bridge',sectionId:'E1',thresholdMm:5,physical:true});
  assert.throws(()=>revealTrial({dxMm:0,dyMm:0,sourceNote:'test rig'}));
  const row={condition,source:'camera',sectionId:'E1',bridgeId:'test-bridge'};
  assert.equal(captureTrialFrame({...row,source:'synthetic'}).blind,false);
  assert.equal(trialStatus().status,'armed');
  const m={ok:true,dxMm:observedX,dyMm:0,magnitudeMm:Math.abs(observedX),mmPerPx:1,shape:1,checkMm:0};
  for(let i=0;i<40;i++){
    assert.equal(captureTrialFrame({...row,measurement:valid?m:null}).blind,true);
    clock+=200;
  }
  assert.equal(trialStatus().status,'sealed');
  revealTrial({dxMm:trueX,dyMm:0,sourceNote:'scripted independent fixture'});
  clock+=500;
}
for(const x of [0,0,0,1,2,3,7,8,9,10])run(x,x+.2);
assert.equal(trialRecords().at(-1).phase,'calibration');
const changed={ok:true,dxMm:8,dyMm:0,magnitudeMm:8,mmPerPx:1,shape:1,checkMm:0};
assert.equal(qualityGate(changed,condition,5).eligible,false);
for(const x of [0,0,0,8,8,8])run(x,x+.2);
assert.equal(trialRecords().at(-1).phase,'holdout');clock+=1600;
assert.equal(qualityGate(changed,condition,5).exceeds,true);
assert.equal(qualityGate({...changed,mmPerPx:2},condition,5).eligible,false);
assert.equal(qualityGate(changed,condition,7).eligible,false);
assert.equal(qualityGate({...changed,dxMm:99,magnitudeMm:99},condition,5).eligible,false);
assert.equal(qualityGate({...changed,dxMm:5.1,magnitudeMm:5.1},condition,5).exceeds,false);
let held=trialRecords().filter(t=>t.phase==='holdout'),report=reportTrials(held);
assert.equal(report.detected,3);assert.equal(report.falseEvents,0);assert.equal(report.positives,3);assert.equal(report.zeroMs,24000);
run(8,8,false);clock+=2000;
held=trialRecords().filter(t=>t.phase==='holdout');report=reportTrials(held);
assert.equal(report.misses,1);assert(report.timeCoverage<.9);
assert.equal(qualityGate(changed,condition,5).eligible,false);
console.log('Verified planar geometry, blinded trial lifecycle, zero-offset camera motion, held-out false/missed events, coverage, lens & view scope, threshold margin and disabled gate after a failed holdout. Synthetic fixture only.');
