// A depth buffer keeps the road, near truss and far truss in the correct order
// even when WebGL is unavailable. Positions use glTF coordinates with Y up.
const endianTest = new Uint8Array(new Uint32Array([0xff000000]).buffer);
const littleEndian = endianTest[3] === 255;

function faceColor(linear, nx, ny, nz) {
  const key = Math.max(0, -.32 * nx + .83 * ny + .46 * nz);
  const fill = Math.max(0, .82 * nx + .12 * ny - .55 * nz);
  const light = .54 + .19 * ny + .60 * key + .16 * fill;
  const rgb = linear.map(v => Math.round(255 * Math.pow(Math.min(1, v * light), 1/2.2)));
  return littleEndian ? (0xff000000 | rgb[2]<<16 | rgb[1]<<8 | rgb[0])
    : (rgb[0]<<24 | rgb[1]<<16 | rgb[2]<<8 | 255);
}

export function canvasMesh(primitives) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const draws = primitives.map(({positions, normals, indices, color}) => {
    const pixels = new Float32Array(positions.length);
    const colors = new Uint32Array(indices.length / 3);
    for (let i=0; i<indices.length; i+=3) {
      const at = 3 * indices[i];
      colors[i/3] = faceColor(color,normals[at],normals[at+1],normals[at+2]);
    }
    return {positions, pixels, indices, colors};
  });
  let image, colors, depth;
  function render(m, width, height) {
    // Bound drag cost on high-DPI phones. The AR feed processes at most 640 px.
    const scale = Math.min(1, 1440/Math.max(width,height));
    const w = Math.max(1,Math.round(width*scale)), h = Math.max(1,Math.round(height*scale));
    if (!image || canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      image = context.createImageData(w,h);
      colors = new Uint32Array(image.data.buffer); depth = new Float32Array(w*h);
    }
    colors.fill(0); depth.fill(Infinity);
    for (const {positions, pixels, indices, colors:faces} of draws) {
      for (let i=0; i<positions.length; i+=3) {
        const x=positions[i], y=positions[i+1], z=positions[i+2];
        const cw=m[3]*x+m[7]*y+m[11]*z+m[15];
        if (cw<=0) { pixels[i+2]=Infinity; continue; }
        pixels[i]   = (1+(m[0]*x+m[4]*y+m[8]*z+m[12])/cw)*w*.5;
        pixels[i+1] = (1-(m[1]*x+m[5]*y+m[9]*z+m[13])/cw)*h*.5;
        pixels[i+2] = (m[2]*x+m[6]*y+m[10]*z+m[14])/cw;
      }
      for (let i=0; i<indices.length; i+=3) {
        const a=3*indices[i], b=3*indices[i+1], c=3*indices[i+2];
        const ax=pixels[a], ay=pixels[a+1], az=pixels[a+2];
        const bx=pixels[b], by=pixels[b+1], bz=pixels[b+2];
        const cx=pixels[c], cy=pixels[c+1], cz=pixels[c+2];
        if (!Number.isFinite(az+bz+cz)) continue;
        const dx1=bx-ax, dy1=by-ay, dx2=cx-ax, dy2=cy-ay;
        const det=dx1*dy2-dx2*dy1;
        if (Math.abs(det)<.01) continue;
        const x0=Math.max(0,Math.ceil(Math.min(ax,bx,cx)-.5)), x1=Math.min(w-1,Math.floor(Math.max(ax,bx,cx)-.5));
        const y0=Math.max(0,Math.ceil(Math.min(ay,by,cy)-.5)), y1=Math.min(h-1,Math.floor(Math.max(ay,by,cy)-.5));
        const du=dy2/det, dv=-dy1/det, lineU=-dx2/det, lineV=dx1/det;
        const firstU=du*(x0+.5-ax)+lineU*(y0+.5-ay), firstV=dv*(x0+.5-ax)+lineV*(y0+.5-ay);
        const color=faces[i/3], dz1=bz-az, dz2=cz-az;
        for (let y=y0; y<=y1; y++) {
          let u=firstU+(y-y0)*lineU, v=firstV+(y-y0)*lineV, p=y*w+x0;
          for (let x=x0; x<=x1; x++,p++,u+=du,v+=dv) {
            if (u<0 || v<0 || u+v>1) continue;
            const z=az+u*dz1+v*dz2;
            if (z<depth[p] && z>=-1 && z<=1) { depth[p]=z; colors[p]=color; }
          }
        }
      }
    }
    context.putImageData(image,0,0);
    return true;
  }
  return {source:canvas, render, destroy(){canvas.width=canvas.height=1;}};
}

// Instantly available preview assembled from the current registration graph.
// These dimensions follow the model asset's deck, walks, bearing and rail datums.
export function bridgePreviewPrimitives(model) {
  const materials = {
    steel:[.175,.242,.287], secondary:[.09,.145,.185], timber:[.32,.23,.15],
    road:[.083,.098,.105], stone:[.40,.355,.29], marking:[.7,.67,.55]
  };
  const groups = Object.fromEntries(Object.entries(materials).map(([id,color])=>
    [id,{positions:[], normals:[], indices:[], color}]));
  function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]}
  function unit(a){const len=Math.hypot(...a);return a.map(v=>v/len)}
  function beam(group,a,b,width,thickness) {
    const axis=unit(b.map((v,i)=>v-a[i]));
    const basis=unit(cross(Math.abs(axis[2])>.98?[1,0,0]:[0,0,1],axis));
    const up=cross(axis,basis);
    const rect=[[-1,-1],[1,-1],[1,1],[-1,1]];
    const vertices=[a,b].flatMap(end=>rect.map(([w,h])=>
      end.map((v,k)=>v+(basis[k]*w*width+up[k]*h*thickness)/2)));
    const part=groups[group];
    for(const face of [[3,2,1,0],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]){
      const [p,q,r]=face.map(i=>vertices[i]);
      const n=unit(cross(q.map((v,i)=>v-p[i]),r.map((v,i)=>v-p[i])));
      const base=part.positions.length/3;
      for(const id of face){
        const [x,y,z]=vertices[id];part.positions.push(x,z,-y);part.normals.push(n[0],n[2],-n[1]);
      }
      part.indices.push(base,base+1,base+2,base,base+2,base+3);
    }
  }
  const nodes=new Map(model.nodes.map(n=>[n.id,n.xyz]));
  for(const {a,b} of model.members){
    const p=nodes.get(a),q=nodes.get(b);
    const longitudinal=Math.abs(p[1]-q[1])<.1;
    const chord=longitudinal && (p[2]===0&&q[2]===0 || p[2]>0&&q[2]>0
      || Math.abs(p[0]-q[0])>1 && [0,model.lengthM/2,model.lengthM].some(x=>
        Math.abs(p[0]-x)<.01||Math.abs(q[0]-x)<.01));
    const gauge=chord ? .56 : longitudinal ? .245 : .16;
    beam(chord?'steel':'secondary',p,q,gauge,gauge);
  }
  const len=model.lengthM;
  beam('road',[0,0,-.13],[len,0,-.13],11.65,.26);
  for(const side of [-1,1]){
    const y=9.23*side;
    beam('timber',[0,7.68*side,.02],[len,7.68*side,.02],3.08,.16);
    for(const z of [-.57,-.045,.29,1.17])beam('steel',[0,y,z],[len,y,z],.12,.10);
    for(let i=0;i<88;i++){
      const x=len*i/88, end=len*(i+1)/88;
      beam('secondary',[x,y,-.52],[end,y,-.09],.065,.07);
      beam('secondary',[x,y,-.09],[end,y,-.52],.065,.07);
    }
    for(let i=0;i<=132;i++){const x=len*i/132;beam('secondary',[x,y,.12],[x,y,1.17],.065,.065)}
  }
  for(let i=0;i<22;i++){
    const x=(i+.5)*len/22;
    beam('marking',[x-1.03,1.84,.013],[x+1.03,1.84,.013],.10,.018);
  }
  for(const x of [0,len/2,len]){
    const width=x===len/2?4.05:2.45, bottom=x===len/2?-5.15:-4.55;
    beam('stone',[x-width/2,0,(bottom-1.72)/2],[x+width/2,0,(bottom-1.72)/2],18.7,-bottom-1.72);
    for(const y of [-6.096,6.096])beam('steel',[x-.44,y,-.94],[x+.44,y,-.94],.85,1.42);
  }
  return Object.values(groups);
}
