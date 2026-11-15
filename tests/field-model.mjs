import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readGeometry,projectFieldModel,intrinsics} from '../field/model-overlay.js';
import {project} from '../ar/vision.js';

const file=id=>JSON.parse(readFileSync(new URL('../models/'+id+'.json',import.meta.url),'utf8'));
test('selected field model uses named physical controls, never target displacement or a stale binding',()=>{
  const model=readGeometry(file('waibaidu')),panel=model.panels.get('N2'),K=intrinsics(600,400);
  const camera={R:[[1,0,0],[0,0,-1],[0,1,0]],t:[-23,3,25]};
  const observed=panel.xyz.map(x=>project(camera,K,x));
  const binding={modelId:'waibaidu',revision:1,assetKey:null,panelId:'N2',reverse:false};
  const hit={ok:true,checkPx:.5,observed:[...observed,[299,212],[320,180]]};
  const fit=projectFieldModel(model,binding,hit,600,400);assert.ok(fit);
  for(const n of model.data.nodes){
    const uv=project(camera,K,n.xyz),projected=project(fit.pose,fit.K,n.xyz);
    assert.ok(Math.hypot(uv[0]-projected[0],uv[1]-projected[1])<.001);
  }
  assert.ok(projectFieldModel(model,binding,{...hit,observed:[...observed,[299,212],[330,197]]},600,400));
  assert.equal(projectFieldModel(model,binding,{...hit,checkPx:8},600,400),null);
  assert.equal(projectFieldModel(model,{...binding,assetKey:'another import'},hit,600,400),null);
  assert.equal(projectFieldModel(model,{...binding,modelId:'training-span'},hit,600,400),null);
});
test('imported 3D models keep surveyed coordinates and their explicitly named reference faces',()=>{
  const data=file('training-span');data.id='custom-field-model';data.fieldFaces=[{id:'bank-side',corners:['N0-U','N1-U','N1-B','N0-B']}];
  const m=readGeometry(data);assert.equal(m.panels.size,1);assert.equal(m.edges.length,data.members.length);
  assert.throws(()=>readGeometry({...data,fieldFaces:[{id:'bad',corners:['N0-U','N1-U','N1-B','F0-B']}]}),/model-face/);
});
