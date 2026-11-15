import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canvasMesh,bridgePreviewPrimitives} from '../models/mesh-canvas.js';

test('solid bridge stays visible before a GLB loads and the software depth buffer hides the far side',t=>{
  // No WebGL context or DOM renderer is available in this harness.
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  const document={createElement(){
    const canvas={width:1,height:1};
    canvas.getContext=type=>type==='2d'?{
      createImageData:(width,height)=>({data:new Uint8ClampedArray(width*height*4)}),
      putImageData:image=>{canvas.pixels=image.data}
    }:null;
    return canvas;
  }};
  Object.defineProperty(globalThis,'document',{configurable:true,value:document});
  t.after(()=>original?Object.defineProperty(globalThis,'document',original):delete globalThis.document);

  const width=416,height=96,length=104.356;
  const current=JSON.parse(readFileSync(new URL('../models/waibaidu.json',import.meta.url)));
  const render=canvasMesh(bridgePreviewPrimitives(current));
  // Elevation at a scale of 3.4 px per metre, with the roadway at row 52.
  const matrix=[6.8/width,0,0,0, 0,6.8/height,0,0, 0,0,.02,0, -length*3.4/width,1-104/height,0,1];
  render.render(matrix,width,height);
  function occupied(x,y){return render.source.pixels[4*(y*width+x)+3]>0}
  const at=x=>Math.round(width/2+(x-length/2)*3.4);
  assert.ok(occupied(at(length/2),65),'central pier below the road');
  for(const fraction of [.25,.75]){
    let filled=0;
    for(let y=18;y<=30;y++)for(let x=at(length*fraction)-5;x<=at(length*fraction)+5;x++)filled+=occupied(x,y);
    assert.ok(filled>0,'upper chord in each span');
  }
  assert.equal(occupied(at(length/2),26),false,'open space above the central bearing');
  render.destroy();

  const near={positions:[-1,-1,-.5,1,-1,-.5,0,1,-.5],normals:[0,1,0,0,1,0,0,1,0],indices:[0,1,2],color:[1,0,0]};
  const far={...near,positions:[-1,-1,.5,1,-1,.5,0,1,.5],color:[0,1,0]};
  const overlap=canvasMesh([near,far]);
  overlap.render([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],32,32);
  const pixel=overlap.source.pixels.slice(4*(16*32+16),4*(16*32+16)+4);
  assert.ok(pixel[0]>100&&pixel[1]===0&&pixel[3]===255,'near surface wins even when drawn first');
  overlap.destroy();
});
