import {fitPose,project,verifyChecks} from './vision.js';

export const limitPx=7;
export const tolerancePx=3;
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);

function enclosed(points,p) {
  const sorted=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  function chain(list) {
    const result=[];
    for(const v of list) {
      while(result.length>1&&cross(result.at(-2),result.at(-1),v)<=0)result.pop();
      result.push(v);
    }
    return result.slice(0,-1);
  }
  const hull=[...chain(sorted),...chain(sorted.reverse())];
  return hull.length>=3&&hull.every((v,i)=>cross(v,hull[(i+1)%hull.length],p)>=-1e-4);
}

export function compare(model,K,tracks,prior,width,height) {
  const byRole={control:[],check:[],target:[]};
  for(const n of model.nodes) {
    const t=tracks.get(n.id);
    if(t&&byRole[n.role])byRole[n.role].push({id:n.id,xyz:n.xyz,uv:[t.x,t.y]});
  }
  const {control,check,target}=byRole;
  if(control.length<4||!check.length||!target.length)return null;
  const fit=fitPose(control,K,prior);
  if(!fit.ok||fit.rms>tolerancePx)return null;
  const checks=verifyChecks(check,fit.pose,K,tolerancePx);
  if(!checks.ok)return null;
  const inliers=fit.inliers.map(i=>control[i].uv),rows=[];
  for(const t of target) {
    const p=project(fit.pose,K,t.xyz);
    if(!p||p[0]<0||p[0]>=width||p[1]<0||p[1]>=height||!enclosed(inliers,p))continue;
    rows.push({id:t.id,predicted:p,observed:t.uv,px:Math.hypot(p[0]-t.uv[0],p[1]-t.uv[1])});
  }
  return rows.length?{pose:fit.pose,rows,rmsPx:fit.rms,checkMaxPx:checks.maxPx}:null;
}

export function assessAlert(old,value,t) {
  if(value>limitPx) {
    const prior=old&&t-old.last<=650?old:null;
    const count=(prior?.count||0)+1,since=prior?.since??t;
    return {count,since,last:t,active:!!prior?.active||(count>=3&&t-since>=420)};
  }
  return {count:0,since:null,last:t,active:!!old?.active&&value>limitPx*.8};
}
