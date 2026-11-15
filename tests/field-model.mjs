import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readGeometry,projectFieldModel,intrinsics,fieldModels} from '../field/model-overlay.js';
import {project} from '../ar/vision.js';

const file=id=>JSON.parse(readFileSync(new URL('../models/'+id+'.json',import.meta.url),'utf8'));
test('selected field model uses named physical controls, never target displacement or a stale binding',()=>{
  const model=readGeometry(file('waibaidu')),panel=model.panels.get('N2'),K=intrinsics(600,400);
  const camera={R:[[1,0,0],[0,0,-1],[0,1,0]],t:[-23,3,25]};
  const observed=panel.xyz.map(x=>project(camera,K,x));
  const binding={modelId:'waibaidu',revision:model.data.revision,assetKey:null,panelId:'N2',reverse:false};
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

test('mixed saved sections resolve their exact geometry and late archive loads respect site selection',async t=>{
  const elements=new Map();
  const document={
    createElement:()=>({getContext:()=>null}),
    querySelector:()=>null,
    getElementById(id){
      if(!elements.has(id))elements.set(id,{
        value:'',getContext:()=>({}),querySelector:()=>({}),
        replaceChildren(){this.value=''},add(option){if(!this.value)this.value=option.value}
      });
      return elements.get(id);
    }
  };
  const globals={document,window:{BridgePrefs:{text:en=>en}},Option:class{
    constructor(label,value){this.value=value}
  },ResizeObserver:class{observe(){} disconnect(){}}};
  for(const [name,value] of Object.entries(globals)){
    const original=Object.getOwnPropertyDescriptor(globalThis,name);
    Object.defineProperty(globalThis,name,{configurable:true,value});
    t.after(()=>original?Object.defineProperty(globalThis,name,original):delete globalThis[name]);
  }
  const oldBinding={modelId:'waibaidu',revision:1,panelId:'N2',assetKey:null,reverse:false};
  const middleBinding={...oldBinding,revision:2};
  const newBinding={...oldBinding,revision:3};
  const models=fieldModels({});
  const calls=[];
  let waitForArchive=null;
  t.mock.method(globalThis,'fetch',async url=>{
    if(url.pathname.endsWith('.glb'))return {ok:true,arrayBuffer:()=>Uint8Array.from(readFileSync(url)).buffer};
    const id=url.pathname.split('/').pop().replace('.json','');
    calls.push(id);
    if(id==='waibaidu-v1')await waitForArchive;
    return {ok:true,json:async()=>file(id)};
  });

  await models.select({id:'waibaidu',sections:[{modelBinding:newBinding}]});
  assert.deepEqual(calls,['waibaidu-r3']);
  assert.equal(models.forBinding(newBinding),models.model);
  assert.equal(models.forBinding(oldBinding),null);

  const mixed={id:'waibaidu',sections:[{modelBinding:oldBinding},{modelBinding:middleBinding},{modelBinding:newBinding}]};
  await models.select(mixed);
  const archived=models.forBinding(oldBinding);
  assert.equal(models.binding().revision,3);
  assert.equal(models.forBinding(middleBinding).data.revision,2);
  assert.deepEqual(archived.panels.get('N2').xyz,readGeometry(file('waibaidu-v1')).panels.get('N2').xyz);
  assert.notDeepEqual(archived.panels.get('N2').xyz,models.model.panels.get('N2').xyz);
  assert.equal(models.forBinding(newBinding),models.model);
  assert.equal(models.forBinding({...oldBinding,assetKey:'previous-import'}),null);

  let resolveArchive;
  waitForArchive=new Promise(resolve=>{resolveArchive=resolve});
  const pending=models.select({...mixed});
  const custom={...file('waibaidu'),assetKey:'import',revision:1};
  await models.select({id:'local-project',geometry:custom,sections:[]});
  resolveArchive();await pending;
  assert.equal(models.forBinding(oldBinding),null);
  assert.equal(models.forBinding({...oldBinding,assetKey:'import'}),models.model);
  assert.equal(models.model.data,custom);
});
