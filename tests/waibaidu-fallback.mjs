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

test('software scanlines preserve coverage for thin girders and triangles clipped by the viewport',t=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement(){
    const canvas={};
    canvas.getContext=()=>({
      createImageData:(width,height)=>({data:new Uint8ClampedArray(width*height*4)}),
      putImageData:image=>{canvas.pixels=image.data}
    });
    return canvas;
  }}});
  t.after(()=>original?Object.defineProperty(globalThis,'document',original):delete globalThis.document);
  const width=80,height=60;
  const identity=[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  const triangles=[
    [[-15.2,6.1],[85.7,49.3],[84.2,51.6]],
    [[90.4,-6.3],[39.8,24.4],[-17.1,71.7]],
    [[13.2,5.6],[101.3,5.6],[45.7,72.1]],
    [[15.4,55.1],[40.6,-3.3],[83.7,55.1]]
  ];
  const edge=(a,b,x,y)=>(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]);
  for(const points of triangles){
    const positions=points.flatMap(([x,y])=>[2*x/width-1,1-2*y/height,0]);
    const render=canvasMesh([{positions,normals:[0,1,0,0,1,0,0,1,0],indices:[0,1,2],color:[1,0,0]}]);
    render.render(identity,width,height);
    const [a,b,c]=points;
    const winding=Math.sign(edge(a,b,c[0],c[1]));
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const inside=[[a,b],[b,c],[c,a]].every(([first,last])=>winding*edge(first,last,x+.5,y+.5)>=0);
      assert.equal(render.source.pixels[4*(y*width+x)+3]!==0,inside,'pixel '+x+','+y);
    }
    render.destroy();
  }
});
