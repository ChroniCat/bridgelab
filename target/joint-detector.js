// Register a camera image to the stationary steelwork, then measure the coloured
// joint separately. All reported distances are in the original model image.
const referenceWidth = 520;
const maxFrameSide = 720;
const patchRadius = 8;
const patchStep = 2;
const patchSize = 81;
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const invalid = reason => ({ok:false, reason});

function grayscale(image, width, height) {
  const src = image.data, channels = src.length/(image.width*image.height);
  if (channels !== 4 && channels !== 1) throw new Error('Unexpected raster format');
  const result = new Float32Array(width*height);
  const sx=image.width/width, sy=image.height/height;
  // Box filtering suppresses individual monitor pixels and camera moiré.
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const x0=Math.floor(x*sx), y0=Math.floor(y*sy);
    const x1=Math.min(image.width,Math.max(x0+1,Math.floor((x+1)*sx)));
    const y1=Math.min(image.height,Math.max(y0+1,Math.floor((y+1)*sy)));
    let value=0;
    for(let j=y0;j<y1;j++) for(let i=x0;i<x1;i++) {
      const p=(j*image.width+i)*channels;
      value+=channels===1?src[p]:(src[p]*.299+src[p+1]*.587+src[p+2]*.114);
    }
    result[y*width+x]=value/((x1-x0)*(y1-y0));
  }
  return {width,height,data:result};
}

function sample(image,x,y) {
  const ix=Math.floor(x),iy=Math.floor(y), dx=x-ix,dy=y-iy,at=iy*image.width+ix;
  const d=image.data,w=image.width;
  return (d[at]*(1-dx)+d[at+1]*dx)*(1-dy)+(d[at+w]*(1-dx)+d[at+w+1]*dx)*dy;
}
function descriptor(image,x,y,scale=1,angle=0) {
  const extent=patchRadius*scale*1.42+1;
  if(x<extent||y<extent||x>=image.width-extent||y>=image.height-extent) return null;
  const vx=Math.cos(angle)*scale,vy=Math.sin(angle)*scale;
  const v=new Float32Array(patchSize);
  let sum=0, square=0,k=0;
  for(let j=-patchRadius;j<=patchRadius;j+=patchStep) for(let i=-patchRadius;i<=patchRadius;i+=patchStep) {
    const c=sample(image,x+i*vx-j*vy,y+i*vy+j*vx);
    v[k++]=c;sum+=c;square+=c*c;
  }
  const inv=1/Math.sqrt(Math.max(1,square-sum*sum/patchSize));
  if(inv>1/(5*Math.sqrt(patchSize)))return null;
  for(let i=0;i<v.length;i++)v[i]=(v[i]-sum/patchSize)*inv;
  return v;
}
function similarity(a,b) {
  let sum=0;
  for(let i=0;i<a.length;i++)sum+=a[i]*b[i];
  return sum;
}

// Minimum-eigenvalue corners, thinned on a regular grid so repeated bars cannot
// crowd out abutments, top-chord bends and other distinctive fixed structure.
function corners(im,cell,limit,keep=()=>true) {
  const result=[],{width:w,height:h,data:d}=im;
  for(let top=10;top<h-10;top+=cell)for(let left=10;left<w-10;left+=cell) {
    let best=0,at=null;
    for(let y=top;y<Math.min(top+cell,h-10);y+=2)for(let x=left;x<Math.min(left+cell,w-10);x+=2) {
      if(!keep(x,y))continue;
      let xx=0,xy=0,yy=0;
      for(let j=-2;j<=2;j+=2)for(let i=-2;i<=2;i+=2) {
        const p=(y+j)*w+x+i,gx=d[p+1]-d[p-1],gy=d[p+w]-d[p-w];
        xx+=gx*gx; xy+=gx*gy; yy+=gy*gy;
      }
      const strength=(xx*yy-xy*xy)/(xx+yy+1);
      if(strength>best){best=strength;at={x,y,strength}}
    }
    if(best>180)result.push(at);
  }
  return result.sort((a,b)=>b.strength-a.strength).slice(0,limit);
}

function fromPair(a,b) {
  const dx=b.p.x-a.p.x,dy=b.p.y-a.p.y,ex=b.q.x-a.q.x,ey=b.q.y-a.q.y;
  const den=dx*dx+dy*dy;
  if(den<75**2)return null;
  const c=(dx*ex+dy*ey)/den,s=(dx*ey-dy*ex)/den;
  if(c<.37||c>1.8||Math.abs(s)>.36*c)return null;
  return (x,y)=>({x:a.q.x+c*(x-a.p.x)-s*(y-a.p.y),y:a.q.y+s*(x-a.p.x)+c*(y-a.p.y)});
}
function projection(matrix) {
  return (x,y)=>{
    const u=x/referenceWidth,v=y/referenceWidth, w=matrix[6]*u+matrix[7]*v+1;
    return {x:referenceWidth*(matrix[0]*u+matrix[1]*v+matrix[2])/w,y:referenceWidth*(matrix[3]*u+matrix[4]*v+matrix[5])/w};
  };
}
function fitProjective(matches) {
  const n=8, M=Array.from({length:n},()=>new Float64Array(n+1));
  for(const {p,q} of matches) {
    const x=p.x/referenceWidth,y=p.y/referenceWidth,u=q.x/referenceWidth,v=q.y/referenceWidth;
    for(const r of [[x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]])
      for(let i=0;i<n;i++)for(let j=0;j<=n;j++)M[i][j]+=r[i]*r[j];
  }
  for(let i=0;i<n;i++) {
    let p=i;for(let j=i+1;j<n;j++)if(Math.abs(M[j][i])>Math.abs(M[p][i]))p=j;
    if(Math.abs(M[p][i])<1e-9)return null;
    [M[i],M[p]]=[M[p],M[i]];
    const k=M[i][i];for(let j=i;j<=n;j++)M[i][j]/=k;
    for(let l=0;l<n;l++)if(l!==i) {
      const m=M[l][i];for(let j=i;j<=n;j++)M[l][j]-=m*M[i][j];
    }
  }
  return projection(M.map(row=>row[n]));
}
function inliers(map,matches,tol) {
  const seen=new Set(),accepted=[];
  for(const m of matches) {
    if(seen.has(m.p))continue;
    if(distance(map(m.p.x,m.p.y),m.q)<tol){seen.add(m.p);accepted.push(m)}
  }
  return accepted;
}
function refit(map,matches) {
  for(const tolerance of [13,8,5,3.5]) {
    const ins=inliers(map,matches,tolerance);
    if(ins.length<7)return null;
    map=fitProjective(ins);
    if(!map)return null;
  }
  return map;
}
function coarseRegistration(features,live) {
  const candidates=corners(live,13,500).map(p=>({...p,desc:descriptor(live,p.x,p.y)})).filter(p=>p.desc);
  const matches=[];
  for(const p of features) {
    const best=[];
    for(const q of candidates) {
      let k=-1;
      for(const d of p.scales) k=Math.max(k,similarity(d,q.desc));
      if(k<.72||(best.length===3&&k<=best[2].k))continue;
      best.push({p,q,k});best.sort((a,b)=>b.k-a.k);
      if(best.length>3)best.pop();
    }
    matches.push(...best);
  }
  matches.sort((a,b)=>b.k-a.k);
  const seeds=matches.slice(0,72);let vote=0,top=null;
  for(let i=1;i<seeds.length;i++)for(let j=0;j<i;j++){
    const map=fromPair(seeds[i],seeds[j]);if(!map)continue;
    const count=inliers(map,matches,9).length;
    if(count>vote){vote=count;top=map}
  }
  if(vote<8)return null;
  return refit(top,matches);
}
function measurePatch(live,p,map,range) {
  const center=map(p.x,p.y);
  const ux=map(p.x+1,p.y),uy=map(p.x,p.y+1);
  const ax=ux.x-center.x,ay=ux.y-center.y,bx=uy.x-center.x,by=uy.y-center.y;
  if(ax*by-ay*bx<=.08)return null;
  const pad=patchRadius*(Math.abs(ax)+Math.abs(ay)+Math.abs(bx)+Math.abs(by))+range+2;
  if(center.x<pad||center.y<pad||center.x>=live.width-pad||center.y>=live.height-pad)return null;
  const offsets=[];
  for(let y=-patchRadius;y<=patchRadius;y+=patchStep)for(let x=-patchRadius;x<=patchRadius;x+=patchStep)
    offsets.push([center.x+x*ax+y*bx,center.y+x*ay+y*by]);
  let best=-2,q;
  for(let dy=-range;dy<=range;dy++)for(let dx=-range;dx<=range;dx++){
    let cov=0,sum=0,sq=0;
    for(let i=0;i<offsets.length;i++){
      const v=sample(live,offsets[i][0]+dx,offsets[i][1]+dy);
      cov+=p.desc[i]*v;sum+=v;sq+=v*v;
    }
    const ncc=cov/Math.sqrt(Math.max(1,sq-sum*sum/patchSize));
    if(ncc>best){best=ncc;q={x:center.x+dx,y:center.y+dy}}
  }
  return best>.66?{p,q,k:best}:null;
}
function refine(map,features,live,held) {
  if(!map)return null;
  const matches=features.map(p=>measurePatch(live,p,map,3)).filter(Boolean);
  for(const tol of [4.5,2.9,2.1]) {
    const ins=inliers(map,matches,tol);
    if(ins.length<8)return null;
    map=fitProjective(ins);if(!map)return null;
  }
  const checks=held.map(p=>measurePatch(live,p,map,2)).filter(m=>m&&m.k>.76&&distance(m.q,map(m.p.x,m.p.y))<2.6);
  if(checks.length<4)return null;
  const xs=checks.map(m=>m.p.x),ys=checks.map(m=>m.p.y);
  if(Math.max(...xs)-Math.min(...xs)<referenceWidth*.35||Math.max(...ys)-Math.min(...ys)<25)return null;
  return map;
}
// Sum the painted steel across its width in rectified coordinates. A profile
// remains measurable when camera blur or the handrail splits the paint into
// several disconnected patches. No changed image is supplied to the detector.
const stripTop = -58, stripBottom = 64;
function jointProfile(image,map,target,factor,shrink) {
  const {width:w,height:h,data:d}=image;
  if(d.length!==w*h*4)return null;
  const rows=[];
  for(let y=stripTop;y<=stripBottom;y++){
    let sum=0;
    for(let x=-21;x<=21;x++){
      const p=map(target.x+x*shrink,target.y+y*shrink);
      const px=(p.x+.5)*factor-.5,py=(p.y+.5)*factor-.5,ix=Math.floor(px),iy=Math.floor(py);
      if(ix<0||iy<0||ix+1>=w||iy+1>=h)return null;
      const dx=px-ix,dy=py-iy,k=(iy*w+ix)*4;
      const channel=c=>(d[k+c]*(1-dx)+d[k+4+c]*dx)*(1-dy)
        +(d[k+w*4+c]*(1-dx)+d[k+w*4+4+c]*dx)*dy;
      const r=channel(0),g=channel(1),b=channel(2);
      const chroma=Math.min(r-g,r-b);
      sum+=Math.max(0,Math.min(1,(chroma-16)/36)*Math.min(1,Math.max(0,(r-55)/48))-.2);
    }
    rows.push(sum);
  }
  const kernel=[1,3,7,10,7,3,1];
  return rows.map((_,i)=>kernel.reduce((sum,k,j)=>sum+k*rows[Math.max(0,Math.min(rows.length-1,i+j-3))],0)/32);
}
function compareJoint(reference,current) {
  if(!current)return null;
  let best=-1,delta=0;
  for(let shift=-19;shift<=49;shift++){
    let cov=0,sq1=0,sq2=0;
    for(let i=10;i<67;i++){
      if(i+shift<0||i+shift>=current.length)continue;
      const a=reference[i],b=current[i+shift];
      cov+=a*b;sq1+=a*a;sq2+=b*b;
    }
    const score=cov/Math.sqrt(Math.max(1,sq1*sq2));
    if(score>best){best=score;delta=shift}
  }
  if(best<.85)return null;
  function centroid(profile,start) {
    let mass=0,moment=0;
    for(let i=start+29;i<start+69;i++){
      mass+=profile[i];moment+=i*profile[i];
    }
    return {mass,y:moment/mass};
  }
  const ref=centroid(reference,0),now=centroid(current,delta);
  if(now.mass<.36*ref.mass||now.mass>2.6*ref.mass)return null;
  return now.y-ref.y;
}

export function createJointDetector(reference,scene) {
  if(!scene?.target||reference.width!==scene.width||reference.height!==scene.height)throw new Error('Mismatched bridge reference');
  const shrink=referenceWidth/reference.width, rim=grayscale(reference,referenceWidth,Math.round(reference.height*shrink));
  const target={x:(scene.target[0]+.5)*shrink-.5,y:(scene.target[1]+.5)*shrink-.5};
  const all=corners(rim,22,124,(x,y)=>Math.abs(x-target.x)>60||Math.abs(y-target.y)>42)
    .map(p=>({...p,desc:descriptor(rim,p.x,p.y),scales:[.72,1,1.34,1.7].map(s=>descriptor(rim,p.x,p.y,s)).filter(Boolean)}))
    .filter(p=>p.desc&&p.scales.length);
  const held=all.filter((_,i)=>i%4===0),fixed=all.filter((_,i)=>i%4!==0);
  const base=jointProfile(reference,(x,y)=>({x,y}),target,1/shrink,shrink);
  if(!base||Math.max(...base)<4||fixed.length<12)throw new Error('Reference lacks a measurable joint');
  let previous=null;
  function observe(image) {
    const ratio=Math.min(1,maxFrameSide/Math.max(image.width,image.height));
    const live=grayscale(image,Math.round(image.width*ratio),Math.round(image.height*ratio));
    let map=previous&&refine(previous,fixed,live,held);
    if(!map)map=refine(coarseRegistration(fixed,live),fixed,live,held);
    previous=map;
    if(!map)return invalid('alignment');
    const current=jointProfile(image,map,target,1/ratio,shrink);
    const displacement=compareJoint(base,current);
    if(displacement===null)return invalid('joint');
    const joint=map(target.x,target.y+displacement*shrink),rest=map(target.x,target.y);
    return {ok:true,displacement,observed:[(joint.x+.5)/ratio-.5,(joint.y+.5)/ratio-.5],expected:[(rest.x+.5)/ratio-.5,(rest.y+.5)/ratio-.5]};
  }
  return {observe,reset(){previous=null}};
}
