import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {bridgeHudState,bridgeHudLabel,drawBridgeHud} from '../target/bridge-hud.js';

const zh=(en,cn)=>cn;
function makeCanvas(){
  const seen={labels:[],rects:0,markers:0,paths:0};
  const ctx={save(){},restore(){},beginPath(){seen.paths++},moveTo(){},lineTo(){},
    stroke(){},fill(){},fillRect(){seen.rects++},strokeRect(){},
    arc(){seen.markers++},fillText(value){seen.labels.push(value)}};
  return {ctx,seen};
}

test('model guide remains visible before a camera alignment exists',()=>{
  const state=bridgeHudState({ok:false},null,false);
  assert.equal(state.kind,'search');
  assert.equal(state.displayStationM,null);
  const {ctx,seen}=makeCanvas();
  drawBridgeHud(ctx,720,1280,state,zh);
  assert.ok(seen.rects>2);
  assert.ok(seen.paths>10);
  assert.equal(seen.markers,0); // An unknown position is never plotted.
  assert.ok(seen.labels.some(x=>x.includes('外白渡桥')));
  assert.ok(seen.labels.some(x=>x.includes('位置未知')));
});

test('desktop tracking gives a model position; loss shows only the last known position',()=>{
  const found=bridgeHudState({ok:true,stationM:30.25,segments:[[1,2,3,4]]},null,false);
  assert.equal(found.kind,'located');
  assert.ok(found.registered);
  assert.ok(bridgeHudLabel(found,zh).includes('左跨 30.3 m'));
  const {ctx,seen}=makeCanvas();
  drawBridgeHud(ctx,390,844,found,zh);
  assert.equal(seen.markers,1);
  const lost=bridgeHudState({ok:false},30.25,false);
  assert.equal(lost.kind,'stale');
  assert.equal(lost.stationM,null);
  assert.ok(bridgeHudLabel(lost,zh).includes('当前未定位'));
  assert.equal(bridgeHudState({ok:false},null,false).kind,'search');
});

test('field image references do not acquire invented chainage',()=>{
  const withoutBinding=bridgeHudState({ok:true,sectionName:'桥墩 A',stationM:null,segments:[]},null,true);
  assert.equal(withoutBinding.kind,'section');
  assert.equal(withoutBinding.displayStationM,null);
  assert.ok(bridgeHudLabel(withoutBinding,zh).includes('桥墩 A'));
  const linked=bridgeHudState({ok:true,sectionName:'右跨 3',stationM:75.2,segments:[],modelAligned:false},null,true);
  assert.equal(linked.kind,'located');
  assert.ok(bridgeHudLabel(linked,zh).includes('参考桥段定位'));
  const aligned=bridgeHudState({ok:true,stationM:75.2,segments:[[1,2,3,4]],modelAligned:true},null,true);
  assert.ok(aligned.registered);
  assert.ok(bridgeHudLabel(aligned,zh).includes('右跨'));
});

test('model guide is painted into both preview and annotated recording paths',async()=>{
  const camera=await readFile(new URL('../target/mobile.js',import.meta.url),'utf8');
  const field=await readFile(new URL('../target/field-walk-tracker.js',import.meta.url),'utf8');
  const html=await readFile(new URL('../target/mobile.html',import.meta.url),'utf8');
  assert.match(camera,/drawBridgeHud\(ctx,w,h,guide,t\)/);
  assert.match(camera,/paintModel\(pen,w,h,now\)/);
  assert.match(camera,/recordVideo\(video,stream,shell,\(ctx,w,h,now\)=>paintModel\(ctx,w,h,now,true\)/);
  assert.doesNotMatch(camera,/if\(!lastResult\?\.ok\|\|!sampled\.width\)return/);
  assert.match(field,/const panel=model\?\.data\?\.id==='waibaidu'/);
  assert.match(field,/stationM=panel\?\.xyz\?\.length===4/);
  assert.match(html,/id="model-location-status"/);
});
