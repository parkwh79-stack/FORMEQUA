/* Shared floor contours in the building-local X/Z metre frame. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./vendor/polygon-clipping-0.15.7.umd.min.js'):root?.polygonClipping);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.AtelierFloorGeometry=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(clip){
  'use strict';
  const EPS=1e-7, PROFILES=['legacy','chamfered','tapered','stepped','elliptic','sculpted','twisted'];
  const sculptural=profile=>['elliptic','sculpted','twisted'].includes(profile);
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
  function hull(points){
    const sorted=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const half=list=>{const out=[];for(const p of list){while(out.length>1&&cross(out.at(-2),out.at(-1),p)<=EPS)out.pop();out.push(p);}return out;};
    const a=half(sorted),b=half(sorted.slice().reverse());a.pop();b.pop();return a.concat(b);
  }
  function create(fp, options={}){
    const w=fp.widthM,d=fp.depthM,z=fp.northShiftM||0;
    if(![w,d,z].every(finite)||w<=0||d<=0)throw new Error('유효한 층 치수가 필요합니다.');
    const cut=options.cornerCutM??fp.cornerCutM??0;
    if(!finite(cut)||cut<0||cut>Math.min(w,d)*.3+EPS)throw new Error('모서리 절삭 범위가 유효하지 않습니다.');
    const x=w/2,a=z-d/2,b=z+d/2;
    const profile=fp.massProfile||'legacy';
    let outer=cut>EPS?[[-x+cut,a],[x-cut,a],[x,a+cut],[x,b-cut],[x-cut,b],[-x+cut,b],[-x,b-cut],[-x,a+cut]]:rectangle(w,d,z);
    if(profile==='elliptic'||profile==='sculpted'){
      const exponent=profile==='sculpted'?2:8-6*(fp.massShapePct??15)/30;
      outer=Array.from({length:32},(_,i)=>{const t=i*Math.PI/16,c=Math.cos(t),s=Math.sin(t);return [Math.abs(c)<1e-12?0:x*Math.sign(c)*Math.pow(Math.abs(c),2/exponent),z+(Math.abs(s)<1e-12?0:d/2*Math.sign(s)*Math.pow(Math.abs(s),2/exponent))];});
    }else if(profile==='twisted'){
      const angle=fp.rotationRad||0,c=Math.cos(angle),s=Math.sin(angle);
      if(!finite(angle)||Math.abs(angle)>Math.PI/2+EPS)throw new Error('유효하지 않은 층 회전각입니다.');
      const rotated=outer.map(([x,y])=>[x*c-(y-z)*s,x*s+(y-z)*c]);
      const fit=Math.min(w/(2*Math.max(...rotated.map(p=>Math.abs(p[0])))),d/(2*Math.max(...rotated.map(p=>Math.abs(p[1])))));
      // Keep the vertical atrium/core zone while turning the perimeter inside
      // the approved rectangular envelope. This is a fitted storey profile.
      outer=hull(rotated.map(([x,y])=>[x*fit,z+y*fit]).concat(rectangle(w*.55,d*.55,z)));
    }
    const holes=fp.hasAtrium?[rectangle(w*.35,d*.35,z).reverse()]:[];
    return {version:1,outer,holes,cornerCutM:cut,profile,areaSqm:Math.abs(ringArea(outer))-holes.reduce((s,r)=>s+Math.abs(ringArea(r)),0),
      outerAreaSqm:Math.abs(ringArea(outer)),perimeterM:perimeter(outer)+holes.reduce((s,r)=>s+perimeter(r),0)};
  }
  function of(fp){return fp.footprint||create(fp);}
  function scaleFor(level,total,input){
    const s=settings(input);
    if(s.profile==='sculpted'){const t=Math.max(0,Math.min(1,(level-1)/Math.max(1,total-1)));return 1-s.amountPct/100*(1-Math.sin(Math.PI*t));}
    if(s.profile!=='tapered'&&s.profile!=='stepped')return 1;
    const t=s.profile==='stepped'?Math.floor((level-1)/3)/Math.max(1,Math.floor((total-1)/3)):(level-1)/Math.max(1,total-1);
    return 1-s.amountPct/100*Math.max(0,Math.min(1,t));
  }
  function attach(fp,input={}){
    const s=settings(input),cornerCutM=s.profile==='chamfered'?Math.min(fp.widthM,fp.depthM)*s.amountPct/100:s.profile==='twisted'?Math.min(fp.widthM,fp.depthM)*.1:0;
    const rotationRad=s.profile==='twisted'?s.amountPct*3*Math.PI/180*Math.max(0,Math.min(1,(fp.level-1)/Math.max(1,(input.floorsAbove??1)-1))):0;
    const shape={...fp,massProfile:s.profile,massShapePct:s.amountPct,cornerCutM,rotationRad};
    const footprint=create(shape);
    return {...shape,floorId:'floor-'+fp.level,footprint,areaSqm:footprint.areaSqm};
  }
  function planningBounds(fp,inset=.5){
    const cut=of(fp).cornerCutM||0,w=fp.widthM,d=fp.depthM,z=fp.northShiftM||0;
    if(sculptural(fp.massProfile)){
      const ring=of(fp).outer;let t=1;
      for(let i=0;i<ring.length;i++){
        const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1];
        const denom=Math.abs(dx)*d/2+Math.abs(dz)*w/2;
        if(denom>EPS)t=Math.min(t,(dx*(z-a[1])+dz*a[0]-inset*Math.hypot(dx,dz))/denom);
      }
      t=Math.max(0,t);return {minX:-w*t/2,maxX:w*t/2,minZ:z-d*t/2,maxZ:z+d*t/2};
    }
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
    const largest=rings.reduce((a,r)=>Math.abs(ringArea(r))>Math.abs(ringArea(a))?r:a,rings[0]);
    if(rings.every(r=>r.every(p=>containsPoint(largest,p))))return Math.abs(ringArea(largest));
    if(rings.slice(1).every(r=>r.every(p=>containsPoint(rings[0],p))))return Math.abs(ringArea(rings[0]));
    if(!clip)throw new Error('층별 수평 투영 합집합을 계산할 수 없습니다.');
    // Micrometre snapping removes trigonometric near-coincidences from the
    // projection union only; storey contours and their areas are unchanged.
    const snapped=rings.map(r=>r.map(p=>p.map(v=>Math.round(v*1e6)/1e6)));
    const unique=[...new Map(snapped.map(r=>[JSON.stringify(r),r])).values()];
    return clip.union(...unique.map(r=>[r])).reduce((sum,p)=>sum+Math.abs(ringArea(p[0]))-p.slice(1).reduce((s,r)=>s+Math.abs(ringArea(r)),0),0);
  }
  return Object.freeze({settings,profiles:PROFILES,sculptural,create,of,attach,scaleFor,planningBounds,containsPoint,containsRect,localContours,projectedArea,ringArea,perimeter,version:'1.1.0'});
});
