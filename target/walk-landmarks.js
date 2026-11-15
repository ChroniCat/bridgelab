// Coordinates of the riveted joints on the riverward truss in the r3 model,
// in glTF's metres, Y up. The observation paint is specific to this experiment.
export const referencePixelsPerMetre = 1040 / 44;
export const bridgeLength = 104.356;
const pitch = 52.178 / 11;
const spanDepth = [0,6.03,7.84,8.53,8.94,9.144,9.144,8.94,8.53,7.84,6.03];
export const paintColors = ['#23ad95','#3d83d8','#9562cb','#be4a91','#73b447','#e77a27'];

// A short run of gussets must identify its place on either of the almost
// identical spans, even if the other span is beyond the camera's field of view.
const lower = [0,1,3,4,-1,2,1,0,3,-1,1,4,2,0,3,-1,4,0,2,-1,3,2,1];
const upper = [-1,3,0,2,1,3,4,2,1,0,3,-1,1,4,2,0,3,1,4,1,0,4,-1];
const sites = {
  4:['左跨 · 第四节点','Left span · joint 4'],
  9:['左跨 · 近中央墩','Left span · near centre pier'],
  15:['右跨 · 第四节点','Right span · joint 4'],
  19:['右跨 · 第八节点','Right span · joint 8']
};

function landmark(index, top, colorIndex) {
  const level=top?'U':'B';
  return {
    id:'N'+index+'-'+level,
    xyz:[Math.round(index*pitch*1e4)/1e4, top?spanDepth[index%11]:0, 6.096],
    colorIndex, color:paintColors[colorIndex]
  };
}
export const fixedLandmarks = lower.flatMap((col,i) => {
  const points=[];
  if(col>=0)points.push(landmark(i,false,col));
  if(upper[i]>=0)points.push(landmark(i,true,upper[i]));
  return points;
});
export const measurementLandmarks = Object.entries(sites).map(([key,[labelZh,labelEn]]) =>
  ({...landmark(Number(key),false,5),labelZh,labelEn}));

const nodes = new Map([...fixedLandmarks,...measurementLandmarks].map(p=>[p.id,p.xyz]));
export const outline = [];
function edge(a,b) {if(nodes.has(a)&&nodes.has(b)) outline.push([nodes.get(a),nodes.get(b)])}
for(let i=0;i<22;i++) {
  const a='N'+i,b='N'+(i+1),panel=i%11;
  edge(a+'-B',b+'-B');edge(a+'-U',b+'-U');edge(a+'-B',a+'-U');
  if(panel!==1&&panel!==10)edge(a+'-B',b+'-U');
  if(panel!==0&&panel!==9)edge(a+'-U',b+'-B');
}
