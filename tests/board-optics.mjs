// Feed independent, supersampled camera pixels to the public marker decoder.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectBoard} from '../ar/auto.js';

const words={C1:0x9f09,C2:0x609c,C3:0x14b2,C4:0x031e,CHECK:0x1edd,TARGET:0x5b63};
const ids=Object.keys(words);
const layout=[['C1',120,120],['C2',920,120],['C3',920,620],['C4',120,620],['CHECK',520,370],['TARGET',320,370]];
function camera({width=512,height=384,side=80,scale=.42,angle=.1,p=.00028,q=-.00019,marks=layout,shade=false,quiet=false}={}) {
 const cs=Math.cos(angle),sn=Math.sin(angle);
 function imagePoint(x,y){
  x-=520;y-=370;
  const d=1+p*x+q*y;
  return [width*.5+scale*(cs*x-sn*y)/d,height*.5+scale*(sn*x+cs*y)/d];
 }
 function sample(ix,iy) {
  const u=(ix-width*.5)/scale,v=(iy-height*.5)/scale;
  const rx=cs*u+sn*v,ry=-sn*u+cs*v,d=1-p*rx-q*ry;
  if(d<.05)return 40;
  const x=520+rx/d,y=370+ry/d;
  if(x<0||x>1040||y<0||y>740)return quiet?180:45;
  let inside=false;
  for(const [id,cx,cy] of marks) {
   const col=Math.floor((x-cx)/side*8+4),row=Math.floor((y-cy)/side*8+4);
   if(col<0||row<0||col>7||row>7)continue;
   inside=!row||!col||row===7||col===7||
      (row>=2&&row<6&&col>=2&&col<6&&((words[id]>>>(15-(row-2)*4-(col-2)))&1));
   break;
  }
  if(quiet)return inside?174:182;
  const illumination=shade?136*x/1040+20*Math.sin(y/75):0;
  return (inside?18:shade?96:230)+illumination;
 }
 const data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let total=0;for(const dy of [-.33,0,.33])for(const dx of [-.33,0,.33])total+=sample(x+dx,y+dy);
  const v=total/9+(quiet?0:1.5*Math.sin(2.4*x+.02*y));data.set([v,v,v,255],4*(y*width+x));
 }
 return {image:{width,height,data},imagePoint};
}
function checkFull(opts) {
 const {image,imagePoint}=camera(opts),reading=detectBoard(image);
 assert.deepEqual(reading.points.map(p=>p.id),ids,JSON.stringify({reason:reading.reason,missing:reading.missing,duplicates:reading.duplicates}));
 assert.equal(reading.complete,true);
 for(const [id,x,y] of layout){
  const point=reading.points.find(v=>v.id===id),[u,v]=imagePoint(x,y);
  const error=Math.hypot(point.xy[0]*image.width-.5-u,point.xy[1]*image.height-.5-v);
  assert.ok(error<1.5,id+' center error '+error);
 }
 return image;
}
test('screen image retains all marker identities and centers under projective skew and uneven exposure',()=>{
 checkFull({shade:true,side:112});checkFull({angle:Math.PI/2-.12,width:384,height:512,side:80,shade:true});
});
test('cropping or glare reports the surviving IDs without retaining a prior observation',()=>{
 const before=checkFull({});const partial=detectBoard(camera({marks:layout.slice(0,4)}).image);
 assert.deepEqual(partial.points.map(p=>p.id),ids.slice(0,4));assert.deepEqual(partial.missing,['CHECK','TARGET']);
 assert.equal(partial.reason,'partial');assert.equal(partial.complete,false);
 assert.equal(detectBoard(before).reason,'complete');
 const blank=detectBoard(camera({quiet:true}).image);assert.equal(blank.reason,'low_contrast');assert.equal(blank.points.length,0);
});
test('two visible copies of an ID cannot act as an unambiguous control',()=>{
 const out=detectBoard(camera({marks:[...layout,['C1',730,395]]}).image);
 assert.equal(out.reason,'duplicate');assert.deepEqual(out.duplicates,['C1']);assert.equal(out.points.some(p=>p.id==='C1'),false);
});
