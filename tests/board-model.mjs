import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {locateBoard,placeBridge,drawMiniature} from '../ar/board-model.js';
import {project} from '../ar/vision.js';
const fixture=name=>JSON.parse(readFileSync(new URL('../models/'+name+'.json',import.meta.url)));
const board=fixture('ar-test-board'),bridge=fixture('waibaidu');
const size=[640,400],K={fx:568,fy:568,cx:320,cy:200};
function poseFor(angle){
  const c=Math.cos(angle),s=Math.sin(angle);
  return {R:[[c,s,0],[0,0,-1],[-s,c,0]],t:[-.08*c,.05,.36+.08*s]};
}
function observe(angle, options={}){
  const pose=poseFor(angle), actual={...K,fx:options.focal||K.fx,fy:options.focal||K.fy};
  const missing=options.missing||[];
  const points=board.nodes.filter(n=>!missing.includes(n.id)).map(n=>{
    const xy=project(pose,actual,n.xyz);
    if(n.id==='CHECK')xy[0]+=options.check||0;
    if(n.id==='TARGET')xy[0]+=options.offset||0;
    return {id:n.id,xy:xy.map((v,i)=>(v+.5)/size[i])};
  });
  return locateBoard({points,duplicates:options.duplicates||[]},board,K,...size);
}
test('The same bridge asset occupies 3D space in front of the printed plane and follows camera perspective',()=>{
  const m=placeBridge(bridge);
  assert.equal(m.members.length,bridge.members.length);
  assert.equal(placeBridge(fixture('training-span')).members.length,44);
  assert.ok([...m.points.values()].every(p=>p[1]<0));
  const y=[...new Set([...m.points.values()].map(p=>p[1]))];
  assert.ok(Math.max(...y)-Math.min(...y)>.01);
  for(const angle of [-.55,0,.46]){
    const r=observe(angle);assert.ok(r.pose);assert.equal(r.verified,true);assert.ok(r.rows[0].px<1e-7);
    for(const v of m.points.values()){
      const p=project(r.pose,r.K,v),truth=project(poseFor(angle),K,v);
      assert.ok(Math.hypot(p[0]-truth[0],p[1]-truth[1])<1e-5);
    }
  }
  const rendered=[];let stroke=[];
  const ctx={save(){},restore(){},beginPath(){stroke=[]},moveTo(x,y){stroke.push(x,y)},lineTo(x,y){stroke.push(x,y)},stroke(){rendered.push([...stroke])}};
  drawMiniature(ctx,m,poseFor(.4),K);
  assert.equal(rendered.length,2*bridge.members.length);
  assert.ok(rendered.every(line=>line.length===4&&line.every(Number.isFinite)));
});
test('An oblique board corrects a poor focal-length guess; its independent planar readings stay stable',()=>{
  const fit=observe(.66,{focal:830,offset:11});
  assert.ok(fit.pose);assert.ok(Math.abs(fit.K.fx-830)<.01);assert.ok(Math.abs(fit.rows[0].px-11)<1e-6);
});
test('Missing or inconsistent landmarks stop the relevant operation without retaining the last pose',()=>{
  for(const missing of [['TARGET'],['CHECK'],['CHECK','TARGET']]){
    const r=observe(.2,{missing});assert.ok(r.pose);assert.equal(r.rows.length,0);
  }
  for(const options of [{missing:['C4']},{check:6},{duplicates:['C2']}]){
    const r=observe(.2,options);assert.equal(r.pose,null);assert.equal(r.rows.length,0);
  }
  const moved=observe(.25,{offset:16});
  assert.ok(moved.pose);assert.equal(moved.verified,true);assert.ok(Math.abs(moved.rows[0].px-16)<1e-6);
});
