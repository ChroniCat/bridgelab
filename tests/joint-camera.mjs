import test from 'node:test';
import assert from 'node:assert/strict';
import {createJointDetector} from '../target/joint-detector.js';

const scene={width:1040,height:550,target:[420,344]};
function fixture(drop=0) {
  const {width,height}=scene,data=new Uint8ClampedArray(width*height*4);
  function rect(x,y,w,h,c) {
    for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)data.set([...c,255],4*(j*width+i));
  }
  rect(0,0,width,height,[232,234,230]);
  let seed=611;
  function rand(n){ seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n }
  for(let i=0;i<200;i++){
    const x=45+rand(925),y=80+rand(370),v=45+rand(110);
    rect(x,y,3+rand(30),4+rand(20),[v,v+3,v+5]);
  }
  rect(414,321+drop,10,26,[209,85,43]);
  rect(407,338+drop,23,7,[209,85,43]);
  return {width,height,data};
}
test('registered camera observes arbitrary painted-joint motion and clears measurements on loss',()=>{
  const initial=fixture();
  const camera=createJointDetector(initial,scene);
  const unchanged=camera.observe(initial),changed=camera.observe(fixture(17));
  assert.ok(unchanged.ok&&Math.abs(unchanged.displacement)<3);
  assert.ok(changed.ok&&Math.abs(changed.displacement-17)<3);
  const hidden=fixture();
  for(let y=290;y<397;y++)for(let x=384;x<457;x++)hidden.data.set([232,234,230,255],4*(y*hidden.width+x));
  assert.deepEqual(camera.observe(hidden),{ok:false,reason:'joint'});
  const blank={...initial,data:new Uint8Array(initial.data.length)};
  assert.deepEqual(camera.observe(blank),{ok:false,reason:'alignment'});
});
