/* Shared floor contours in the building-local X/Z metre frame. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./vendor/polygon-clipping-0.15.7.umd.min.js'):root?.polygonClipping);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.AtelierFloorGeometry=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(clip){
  'use strict';
  const EPS=1e-7, PROFILES=['legacy','chamfered','tapered','stepped'];
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  function settings(input={}){
    const profile=input.massProfile??'legacy', amount=input.massShapePct??15;
    const crown=input.crownStyle??'flat', height=input.crownHeightM??3;
    if(!PROFILES.includes(profile)||!finite(amount)||amount<0||amount>30||!['flat','sloped'].includes(crown)||!finite(height)||height<0||height>8)throw new Error('유효하지 않은 건물 형태 입력입니다.');
    return {profile,amountPct:amount,crownStyle:crown,crownHeightM:height};
  }
  function ringArea(ring){return ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+p[0]*q[1]-q[0]*p[1];},0)/2;}
  function perimeter(ring){return ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+Math.hypot(q[0]-p[0],q[1]-p[1]);},0);}
  function rectangle(w,d,z=0){return [[-w/2,z-d/2],[w/2,z-d/2],[w/2,z+d/2],[-w/2,z+d/2]];}
  function create(fp, options={}){
    const w=fp.widthM,d=fp.depthM,z=fp.northShiftM||0;
    if(![w,d,z].every(finite)||w<=0||d<=0)throw new Error('유효한 층 치수가 필요합니다.');
    const cut=options.cornerCutM??fp.cornerCutM??0;
    if(!finite(cut)||cut<0||cut>Math.min(w,d)*.3+EPS)throw new Error('모서리 절삭 범위가 유효하지 않습니다.');
    const x=w/2,a=z-d/2,b=z+d/2;
    const outer=cut>EPS?[[-x+cut,a],[x-cut,a],[x,a+cut],[x,b-cut],[x-cut,b],[-x+cut,b],[-x,b-cut],[-x,a+cut]]:rectangle(w,d,z);
    const holes=fp.hasAtrium?[rectangle(w*.35,d*.35,z).reverse()]:[];
    return {version:1,outer,holes,cornerCutM:cut,areaSqm:Math.abs(ringArea(outer))-holes.reduce((s,r)=>s+Math.abs(ringArea(r)),0),
      outerAreaSqm:Math.abs(ringArea(outer)),perimeterM:perimeter(outer)+holes.reduce((s,r)=>s+perimeter(r),0)};
  }
  function of(fp){return fp.footprint||create(fp);}
  function scaleFor(level,total,input){
    const s=settings(input);if(s.profile!=='tapered'&&s.profile!=='stepped')return 1;
    const t=s.profile==='stepped'?Math.floor((level-1)/3)/Math.max(1,Math.floor((total-1)/3)):(level-1)/Math.max(1,total-1);
    return 1-s.amountPct/100*Math.max(0,Math.min(1,t));
  }
  function attach(fp,input={}){
    const s=settings(input),cornerCutM=s.profile==='chamfered'?Math.min(fp.widthM,fp.depthM)*s.amountPct/100:0;
    const footprint=create(fp,{cornerCutM});
    return {...fp,floorId:'floor-'+fp.level,massProfile:s.profile,cornerCutM,footprint,areaSqm:footprint.areaSqm};
  }
  function planningBounds(fp,inset=.5){
    const cut=of(fp).cornerCutM||0,w=fp.widthM,d=fp.depthM,z=fp.northShiftM||0;
    return {minX:-w/2+inset+cut/2,maxX:w/2-inset-cut/2,minZ:z-d/2+inset+cut/2,maxZ:z+d/2-inset-cut/2};
  }
  function containsPoint(ring,p){
    // Current profiles are convex; include boundary points within metre tolerance.
    const direction=Math.sign(ringArea(ring))||1;
    return ring.every((a,i)=>{const b=ring[(i+1)%ring.length];return direction*((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))>=-EPS;});
  }
  function containsRect(fp,r){
    const g=of(fp),corners=[[r.minX,r.minZ],[r.maxX,r.minZ],[r.maxX,r.maxZ],[r.minX,r.maxZ]];
    return corners.every(p=>containsPoint(g.outer,p))&&!g.holes.some(h=>{
      const xs=h.map(p=>p[0]),zs=h.map(p=>p[1]);
      return r.minX<Math.max(...xs)-EPS&&r.maxX>Math.min(...xs)+EPS&&r.minZ<Math.max(...zs)-EPS&&r.maxZ>Math.min(...zs)+EPS;
    });
  }
  function localContours(fp,width=fp.widthM,depth=fp.depthM){
    const g=of(fp),sx=width/fp.widthM,sz=depth/fp.depthM,z=fp.northShiftM||0;
    return [g.outer,...g.holes].map((r,i)=>r.map(p=>[p[0]*(i?1:sx),(p[1]-z)*(i?1:sz)]));
  }
  function projectedArea(floors){
    if(!floors.length)return 0;
    const rings=floors.map(f=>of(f).outer);
    if(rings.slice(1).every(r=>r.every(p=>containsPoint(rings[0],p))))return Math.abs(ringArea(rings[0]));
    if(!clip)throw new Error('층별 수평 투영 합집합을 계산할 수 없습니다.');
    return clip.union(...rings.map(r=>[r])).reduce((sum,p)=>sum+Math.abs(ringArea(p[0]))-p.slice(1).reduce((s,r)=>s+Math.abs(ringArea(r)),0),0);
  }
  return Object.freeze({settings,profiles:PROFILES,create,of,attach,scaleFor,planningBounds,containsPoint,containsRect,localContours,projectedArea,ringArea,perimeter,version:'1.0.0'});
});
