import {canvasMesh,bridgePreviewPrimitives} from './mesh-canvas.js?v=wb3';

// Mesh renderer for BridgeLab's own static, untextured GLB. The companion
// registration JSON and this mesh share an origin. glTF uses Y up.
const meshURL = new URL('./waibaidu.glb?v=wb3', import.meta.url);
let meshRequest;

async function readMesh() {
  // The downloadable single-file board carries the same GLB in the page.
  const embedded = document.querySelector('#waibaidu-glb');
  let bytes;
  if (embedded) {
    bytes = Uint8Array.from(atob(embedded.textContent.trim()), c => c.charCodeAt(0)).buffer;
  } else {
    const response = await fetch(meshURL);
    if (!response.ok) throw new Error('Could not load bridge mesh');
    bytes = await response.arrayBuffer();
  }
  const head = new DataView(bytes);
  if (head.getUint32(0, true) !== 0x46546c67 || head.getUint32(4, true) !== 2)
    throw new Error('Expected binary glTF 2.0');
  const jsonSize = head.getUint32(12, true);
  const model = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jsonSize)));
  if (model.asset?.extras?.revision !== 3)
    throw new Error('Bridge mesh revision does not match the current reconstruction');
  const binaryStart = 20 + jsonSize + 8;
  function attribute(index) {
    const accessor = model.accessors[index], view = model.bufferViews[accessor.bufferView];
    const offset = binaryStart + (view.byteOffset || 0) + (accessor.byteOffset || 0);
    const Type = {5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array}[accessor.componentType];
    const components = {VEC3: 3, SCALAR: 1}[accessor.type];
    return new Type(bytes, offset, accessor.count * components);
  }
  // Our exporter bakes all node transforms and writes one indexed draw per material.
  return model.meshes.flatMap(mesh => mesh.primitives.map(p => ({
    positions: attribute(p.attributes.POSITION), normals: attribute(p.attributes.NORMAL),
    indices: attribute(p.indices), color: model.materials[p.material].pbrMetallicRoughness.baseColorFactor.slice(0,3)
  })));
}

const vertexShader = `
  attribute vec3 position, normal;
  uniform mat4 clip;
  varying vec3 surfaceNormal;
  void main() {
    gl_Position = clip * vec4(position, 1.0);
    surfaceNormal = normal;
  }`;
const fragmentShader = `
  precision mediump float;
  varying vec3 surfaceNormal;
  uniform vec3 color;
  void main() {
    vec3 n = normalize(surfaceNormal);
    float sky = 0.54 + 0.19*n.y;
    float key = 0.60 * max(0.0, dot(n, normalize(vec3(-0.32,0.83,0.46))));
    float fill = 0.16 * max(0.0, dot(n, normalize(vec3(0.82,0.12,-0.55))));
    vec3 lit = clamp(color * (sky + key + fill), 0.0, 1.0);
    gl_FragColor = vec4(pow(lit, vec3(1.0/2.2)), 1.0);
  }`;

function gpuMesh(canvas,primitives) {
  const gl = canvas.getContext('webgl', {alpha:true, antialias:true, premultipliedAlpha:true});
  if (!gl) throw new Error('WebGL unavailable');
  const shaders = [], buffers = [];
  const program = gl.createProgram();
  function shader(kind, source) {
    const result = gl.createShader(kind);
    shaders.push(result);
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result));
    gl.attachShader(program, result);
  }
  function upload(data, target) {
    const buffer = gl.createBuffer();
    buffers.push(buffer);
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return buffer;
  }
  function destroy() {
    for (const b of buffers) gl.deleteBuffer(b);
    for (const s of shaders) gl.deleteShader(s);
    gl.deleteProgram(program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  try {
    shader(gl.VERTEX_SHADER, vertexShader);
    shader(gl.FRAGMENT_SHADER, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const position = gl.getAttribLocation(program,'position'), normal = gl.getAttribLocation(program,'normal');
    const clip = gl.getUniformLocation(program,'clip'), color = gl.getUniformLocation(program,'color');
    gl.enableVertexAttribArray(position); gl.enableVertexAttribArray(normal);
    const draws = primitives.map(p => {
      const wide = p.indices instanceof Uint32Array;
      if (wide && !gl.getExtension('OES_element_index_uint')) throw new Error('32-bit index buffers unavailable');
      return {positions:p.positions, position:upload(p.positions,gl.ARRAY_BUFFER), normal:upload(p.normals,gl.ARRAY_BUFFER),
        index:upload(p.indices,gl.ELEMENT_ARRAY_BUFFER), count:p.indices.length,
        type:wide?gl.UNSIGNED_INT:gl.UNSIGNED_SHORT, color:p.color};
    });
    gl.enable(gl.DEPTH_TEST);
    return {destroy, updatePositions() {
      for (const item of draws) {
        gl.bindBuffer(gl.ARRAY_BUFFER,item.position);
        gl.bufferSubData(gl.ARRAY_BUFFER,0,item.positions);
      }
    }, render(matrix) {
      if (gl.isContextLost()) return false;
      gl.viewport(0,0,canvas.width,canvas.height);
      gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(clip, false, matrix);
      for (const item of draws) {
        gl.bindBuffer(gl.ARRAY_BUFFER,item.position); gl.vertexAttribPointer(position,3,gl.FLOAT,false,0,0);
        gl.bindBuffer(gl.ARRAY_BUFFER,item.normal); gl.vertexAttribPointer(normal,3,gl.FLOAT,false,0,0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,item.index); gl.uniform3fv(color,item.color);
        gl.drawElements(gl.TRIANGLES,item.count,item.type,0);
      }
      return true;
    }};
  } catch (error) { destroy(); throw error; }
}


// The desktop walk changes vertex elevations without altering the stored GLB.
export async function loadWalkMesh(surface, buildPrimitives) {
  meshRequest ??= readMesh().catch(error => { meshRequest=undefined; throw error; });
  const primitives = buildPrimitives(await meshRequest);
  let mesh;
  try { mesh = gpuMesh(surface,primitives); } catch { mesh = canvasMesh(primitives); }
  return {
    get source() { return mesh.source || surface; },
    get mode() { return mesh.source ? 'software' : 'webgl'; },
    updatePositions() { mesh.updatePositions?.(); },
    render(matrix) {
      if (mesh.render(matrix,surface.width,surface.height)) return true;
      mesh.destroy();
      mesh = canvasMesh(primitives);
      return mesh.render(matrix,surface.width,surface.height);
    },
    destroy() { mesh.destroy(); }
  };
}

// Draw a solid version immediately. Loading the high-detail file upgrades the
// same canvas and projection; a failed request leaves the structural preview available.
export function loadBridgeRenderer(canvas, model, onUpgrade) {
  const preview = canvasMesh(bridgePreviewPrimitives(model));
  let active = preview, gpu = null, disposed = false, fullMesh;
  meshRequest ??= readMesh().catch(error => {meshRequest=undefined;throw error});
  meshRequest.then(primitives => {
    if(disposed)return;
    fullMesh=primitives;
    try { gpu=gpuMesh(canvas,primitives); active=gpu; }
    catch { active=canvasMesh(primitives); }
    onUpgrade?.();
  }).catch(()=>{}); // An unavailable GLB leaves an independently usable preview.
  return {
    get source(){return gpu && active===gpu ? canvas : active.source},
    get mode(){return gpu && active===gpu ? 'webgl' : active===preview ? 'simplified' : 'software'},
    render(matrix){
      if(active===gpu && !gpu.render(matrix)){
        gpu.destroy();gpu=null;
        active=canvasMesh(fullMesh);
      }else if(active===gpu){return true}
      return active.render(matrix,canvas.width,canvas.height);
    },
    destroy(){
      disposed=true;
      if(active!==preview)active.destroy();
      preview.destroy();
      fullMesh=null;
    }
  };
}
