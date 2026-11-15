import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import '../lab/board-vision.js';

const load=path=>readFile(new URL(path,import.meta.url),'utf8');
const target=await load('../target/target.js');
const markup=await load('../target/index.html');

function element() {
  const listeners=new Map(),attrs=new Map();
  return {
    hidden:false,value:'',classList:{toggle(){}},focus(){},select(){},
    addEventListener(type,fn){listeners.set(type,fn)},
    emit(type){return listeners.get(type)?.({})},
    setAttribute(k,v){attrs.set(k,String(v))},removeAttribute(k){attrs.delete(k)},hasAttribute(k){return attrs.has(k)},
    set src(url){attrs.set('src',url)},get src(){return attrs.get('src')},
    showModal(){this.open=true},close(){this.open=false}
  };
}
// Capture the actual rectangles rendered by the desktop UI into the same RGBA
// shape consumed by the phone detector. Half-size models a normal camera crop.
function harness(href) {
  const nodes=new Map([...markup.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],element()]));
  let animation,clipboard;
  const pixels=new Uint8Array(520*370);
  const context={fillStyle:'',fillRect(x,y,w,h){
    const value=this.fillStyle==='#fff'?255:9;
    for(let row=Math.round(y/2);row<Math.round((y+h)/2);row++)pixels.fill(value,row*520+Math.round(x/2),row*520+Math.round((x+w)/2));
  }};
  Object.assign(nodes.get('board'),{width:1040,height:740,getContext:()=>context});
  const location=new URL(href);
  const document={getElementById:id=>nodes.get(id),addEventListener(){}};
  vm.runInNewContext(target,{document,window:{BridgePrefs:{text:en=>en}},location,URL,history:{replaceState(_s,_t,url){location.href=String(url)}},
    BoardVision:globalThis.BoardVision,performance:{now:()=>0},requestAnimationFrame:cb=>{animation=cb;return 1},cancelAnimationFrame(){},
    clearTimeout(){},setTimeout(){},navigator:{clipboard:{async writeText(url){clipboard=url}}}});
  return {nodes,clipboard:()=>clipboard,location,advance:()=>animation(1000),readMarks(){
    const data=new Uint8ClampedArray(520*370*4);
    for(let i=0;i<pixels.length;i++)data.set([pixels[i],pixels[i],pixels[i],255],i*4);
    return globalThis.BoardVision.detect({width:520,height:370,data});
  }};
}

test('desktop pairing follows selected bridge and routes the phone into the AR camera',async()=>{
  const base='https://chronicat.github.io/bridgelab/';
  const app=harness(base+'target/?bridge=training-span'),get=id=>app.nodes.get(id);
  assert.equal(get('pair-model').value,'training-span');
  assert.equal(get('phone-camera').href,base+'ar/?mode=camera&bridge=training-span');
  assert.equal(get('pair-code').src,'./phone-training-span.png');
  get('pair-open').emit('click');assert.equal(get('pair-dialog').open,true);
  await get('copy-link').emit('click');assert.equal(app.clipboard(),get('phone-camera').href);
  get('pair-close').emit('click');assert.equal(get('pair-dialog').open,false);
  get('pair-model').value='waibaidu';get('pair-model').emit('change');
  assert.equal(app.location.search,'?bridge=waibaidu');
  assert.equal(get('pair-code').src,'./phone-waibaidu.png');
  assert.equal(get('pair-url').value,base+'ar/?mode=camera&bridge=waibaidu');
  const fork=harness('https://example.org/another/path/target/');
  assert.equal(fork.nodes.get('pair-code').hidden,true);
  assert.equal(fork.nodes.get('pair-url').value,'https://example.org/another/path/ar/?mode=camera&bridge=waibaidu');
});

test('six optically decoded marks retain five fixed references when the screen target moves',()=>{
  const app=harness('https://chronicat.github.io/bridgelab/target/');
  const fixed=app.readMarks();assert.equal(fixed.complete,true);
  app.nodes.get('move-target').emit('click');app.advance();
  const moved=app.readMarks();assert.equal(moved.complete,true);
  for(const p of fixed.points){
    const q=moved.points.find(o=>o.id===p.id);
    assert.equal(q.xy[0],p.xy[0]);
    const verticalShift=(q.xy[1]-p.xy[1])*740;
    assert.ok(Math.abs(verticalShift-(p.id==='TARGET'?65:0))<=1.1);
  }
});
