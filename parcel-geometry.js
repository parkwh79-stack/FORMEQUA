/* WGS84 parcel union and conservative rectangular study envelope. MIT vendor below. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./vendor/polygon-clipping-0.15.7.umd.min.js') : root.polygonClipping,
    typeof module === 'object' && module.exports ? require('./parcel-regulation-rules.js') : root.AtelierParcelRegulations);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AtelierParcelGeometry = api;
})(typeof window !== 'undefined' ? window : this, function (clip, regulations) {
  'use strict';
  const cache = new Map(), fitCache = new WeakMap(), R = 6371008.8, RAD = Math.PI / 180;
  const fail = message => { throw new Error(message); };
  const object = v => v && typeof v === 'object' && !Array.isArray(v);
  function keys(v, allowed) { if (!object(v) || Object.keys(v).some(k => !allowed.includes(k))) fail('지원하지 않는 필지 데이터 항목입니다.'); }
  function text(v, max) { if (typeof v !== 'string' || !v.trim() || v.length > max || /[\x00-\x1f]/.test(v)) fail('필지 설명 형식이 잘못되었습니다.'); return v; }
  const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  function intersects(a,b,c,d) {
    const eps = 1e-16;
    const on = (a,b,p) => Math.abs(cross(a,b,p)) < eps && p[0] >= Math.min(a[0],b[0])-eps && p[0] <= Math.max(a[0],b[0])+eps && p[1] >= Math.min(a[1],b[1])-eps && p[1] <= Math.max(a[1],b[1])+eps;
    return (cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0) || on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
  }
  function ringArea(ring) { const [ox,oz]=ring[0]; return ring.slice(0,-1).reduce((s,p,i)=>{const q=ring[i+1];return s+(p[0]-ox)*(q[1]-oz)-(q[0]-ox)*(p[1]-oz);},0)/2; }
  function area(multi) { return multi.reduce((sum,poly)=>sum+Math.abs(ringArea(poly[0]))-poly.slice(1).reduce((s,r)=>s+Math.abs(ringArea(r)),0),0); }
  function pointInside(p, ring) { let yes=false; for(let i=0,j=ring.length-2;i<ring.length-1;j=i++) {const a=ring[i],b=ring[j]; if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;} return yes; }
  function sanitizeParcelData(value) {
    if (value === null) return null;
    keys(value,['version','features','source','fetchedAt']);
    if(value.version!==1 || !['vworld','import'].includes(value.source) || !Array.isArray(value.features) || !value.features.length || value.features.length>5) fail('필지는 최대 5개까지 입력할 수 있습니다. version 1 형식의 Feature가 필요합니다.');
    let count=0;
    const features=value.features.map(feature=>{
      keys(feature,['type','geometry','properties']); keys(feature.geometry,['type','coordinates']); keys(feature.properties,['pnu','address','source','regulations']);
      if(feature.type!=='Feature'||!['Polygon','MultiPolygon'].includes(feature.geometry.type))fail('Polygon 또는 MultiPolygon 경계만 지원합니다.');
      const properties={};
      for(const [k,v] of Object.entries(feature.properties)){if(k==='regulations'){if(!regulations)fail('필지 법규 검증 모듈을 불러오지 못했습니다.');properties[k]=regulations.sanitizeRegulations(v);}else if(k==='pnu'){if(typeof v!=='string'||!/^\d{19}$/.test(v))fail('PNU는 19자리 숫자여야 합니다.');properties[k]=v;}else properties[k]=text(v,k==='address'?300:120);}
      if(properties.regulations && properties.regulations.pnu!==properties.pnu)fail('필지와 법규 자료의 식별자가 일치하지 않습니다.');
      const polys=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
      if(!Array.isArray(polys)||!polys.length)fail('필지 좌표가 비어 있습니다.');
      const clean=polys.map(poly=>{
        if(!Array.isArray(poly)||!poly.length)fail('필지 링이 비어 있습니다.');
        const rings=poly.map(ring=>{
          if(!Array.isArray(ring)||ring.length<4)fail('폐합된 경계에는 최소 4개 좌표가 필요합니다.');
          const r=ring.map(p=>{if(++count>2000)fail('필지 좌표는 총 2,000개까지 지원합니다.'); if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||p[0]<124||p[0]>132||p[1]<33||p[1]>39)fail('한국 지역 WGS84 [경도, 위도] 좌표만 지원합니다.');return [...p];});
          if(r[0][0]!==r.at(-1)[0]||r[0][1]!==r.at(-1)[1])fail('필지 경계가 닫혀 있지 않습니다.');
          if(Math.abs(ringArea(r))<1e-15)fail('필지 경계의 면적이 0입니다.');
          for(let i=0;i<r.length-1;i++){
            if(r[i][0]===r[i+1][0]&&r[i][1]===r[i+1][1])fail('연속 중복 좌표가 있습니다.');
            for(let j=i+2;j<r.length-1;j++){if(i===0&&j===r.length-2)continue;if(intersects(r[i],r[i+1],r[j],r[j+1]))fail('교차하거나 맞닿는 자기 경계는 사용할 수 없습니다.');}
          }
          return r;
        });
        for(let h=1;h<rings.length;h++){
          if(!pointInside(rings[h][0],rings[0]))fail('내부 공백이 외곽 경계 밖에 있습니다.');
          for(let k=0;k<h;k++){
            if(k>0&&(pointInside(rings[h][0],rings[k])||pointInside(rings[k][0],rings[h])))fail('내부 공백이 중첩되어 있습니다.');
            for(let i=0;i<rings[h].length-1;i++)for(let j=0;j<rings[k].length-1;j++)if(intersects(rings[h][i],rings[h][i+1],rings[k][j],rings[k][j+1]))fail('경계 링이 서로 교차합니다.');
          }
        }
        return rings;
      });
      return {type:'Feature',geometry:{type:feature.geometry.type,coordinates:feature.geometry.type==='Polygon'?clean[0]:clean},properties};
    });
    const result={version:1,features,source:value.source};
    if(value.fetchedAt!==undefined){if(typeof value.fetchedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(value.fetchedAt)||!Number.isFinite(Date.parse(value.fetchedAt)))fail('조회 시각 형식이 잘못되었습니다.');result.fetchedAt=value.fetchedAt;}
    return result;
  }
  function rectPoly(x,z,w,d){return [[[x-w/2,z-d/2],[x+w/2,z-d/2],[x+w/2,z+d/2],[x-w/2,z+d/2],[x-w/2,z-d/2]]];}
  function contained(multi,x,z,w,d){return clip.difference(rectPoly(x,z,w,d),multi).length===0;}
  function rotatePoint(point, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return [point[0] * c - point[1] * s, point[0] * s + point[1] * c];
  }
  function transformOutline(outlines, angle, centerX = 0, centerZ = 0) {
    return outlines.map(poly => poly.map(ring => ring.map(([x,z]) => rotatePoint([x-centerX,z-centerZ],angle))));
  }
  function outlineBounds(outlines) {
    let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
    for(const poly of outlines)for(const ring of poly)for(const [x,z]of ring){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
    return { minX,maxX,minZ,maxZ,widthM:maxX-minX,depthM:maxZ-minZ };
  }
  function onRing(point, ring, eps=1e-8) {
    for(let i=0;i<ring.length-1;i++){
      const a=ring[i],b=ring[i+1],dx=b[0]-a[0],dz=b[1]-a[1];
      if(point[0]<Math.min(a[0],b[0])-eps||point[0]>Math.max(a[0],b[0])+eps||point[1]<Math.min(a[1],b[1])-eps||point[1]>Math.max(a[1],b[1])+eps)continue;
      if(Math.abs(cross(a,b,point))<=eps*Math.max(1,Math.hypot(dx,dz)))return true;
    }
    return false;
  }
  // Segment versus the open interior of an axis-aligned rectangle. Merely
  // touching the boundary is allowed; crossing a notch or a hole is not.
  function crossesRectInterior(a,b,minX,maxX,minZ,maxZ) {
    const eps=1e-8,lo=[minX+eps,minZ+eps],hi=[maxX-eps,maxZ-eps];
    if(lo[0]>=hi[0]||lo[1]>=hi[1])return false;
    let t0=0,t1=1;
    for(let axis=0;axis<2;axis++){
      const delta=b[axis]-a[axis];
      if(Math.abs(delta)<1e-12){if(a[axis]<=lo[axis]||a[axis]>=hi[axis])return false;continue;}
      let enter=(lo[axis]-a[axis])/delta,exit=(hi[axis]-a[axis])/delta;
      if(enter>exit)[enter,exit]=[exit,enter];
      t0=Math.max(t0,enter);t1=Math.min(t1,exit);
      if(t0>=t1)return false;
    }
    return t0<t1;
  }
  function safeAxisRectangle(outlines,x,z,w,d) {
    if(!(w>0&&d>0))return false;
    const minX=x-w/2,maxX=x+w/2,minZ=z-d/2,maxZ=z+d/2;
    const corners=[[minX,minZ],[maxX,minZ],[maxX,maxZ],[minX,maxZ]];
    return outlines.some(poly=>{
      if(!corners.every(p=>(pointInside(p,poly[0])||onRing(p,poly[0]))&&!poly.slice(1).some(h=>pointInside(p,h)&&!onRing(p,h))))return false;
      for(const ring of poly)for(let i=0;i<ring.length-1;i++){
        const a=ring[i],b=ring[i+1];
        if(Math.max(a[0],b[0])<minX||Math.min(a[0],b[0])>maxX||Math.max(a[1],b[1])<minZ||Math.min(a[1],b[1])>maxZ)continue;
        if(crossesRectInterior(a,b,minX,maxX,minZ,maxZ))return false;
      }
      return true;
    });
  }
  function projectionFor(derived) {
    if(!derived?.centerWgs84||!derived.centerWgs84.every(Number.isFinite))fail('필지 좌표계의 중심이 유효하지 않습니다.');
    const projection=derived.projection || { metersPerDegreeLon:R*RAD*Math.cos(derived.centerWgs84[1]*RAD),metersPerDegreeLat:R*RAD };
    if(![projection.metersPerDegreeLon,projection.metersPerDegreeLat].every(v=>Number.isFinite(v)&&v>0))fail('필지 미터 좌표계의 투영 비율이 유효하지 않습니다.');
    if(derived.frameRotationRad!==undefined&&!Number.isFinite(derived.frameRotationRad))fail('필지 좌표계의 회전각이 유효하지 않습니다.');
    return projection;
  }
  function projectWgs84(derived,point) {
    if(!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite))fail('유효한 [경도, 위도] 좌표가 필요합니다.');
    const projection=projectionFor(derived);
    const raw=[(point[0]-derived.centerWgs84[0])*projection.metersPerDegreeLon,-(point[1]-derived.centerWgs84[1])*projection.metersPerDegreeLat];
    return rotatePoint(raw,-(derived.frameRotationRad||0));
  }
  function unprojectLocal(derived,point) {
    if(!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite))fail('유효한 [x, z] 좌표가 필요합니다.');
    const projection=projectionFor(derived);
    const raw=rotatePoint(point,derived.frameRotationRad||0);
    return [derived.centerWgs84[0]+raw[0]/projection.metersPerDegreeLon,derived.centerWgs84[1]-raw[1]/projection.metersPerDegreeLat];
  }
  /**
   * Fit a target footprint independently of the largest study rectangle's
   * aspect ratio. Clearance is checked against the real polygon, including
   * concavities and holes, rather than only the selected rectangle's bounds.
   * Front/rear refer to local +Z/-Z; these inputs do not verify road frontage.
   */
  function fitRectangle(derived, options = {}) {
    if(!derived?.outlines?.length)fail('배치할 필지 경계가 없습니다.');
    const target=options.targetAreaSqm??derived.areaSqm;
    const front=options.frontSetbackM??0,side=options.sideSetbackM??0,rear=options.rearSetbackM??0,min=options.minDimensionM??6;
    if(![target,front,side,rear,min].every(v=>typeof v==='number'&&Number.isFinite(v))||target<0||front<0||side<0||rear<0||min<=0||min>500)fail('배치 면적·이격·최소 치수 입력이 유효하지 않습니다.');
    if(options.rotationRad!==undefined&&!Number.isFinite(options.rotationRad))fail('회전각은 유한 숫자여야 합니다.');
    const key=JSON.stringify([target,front,side,rear,min,options.allowRotation===true,options.rotationRad]);
    let cached=fitCache.get(derived);if(cached?.has(key))return cached.get(key);
    if(!cached){cached=new Map();fitCache.set(derived,cached);}
    const empty=reason=>({fits:false,widthM:0,depthM:0,areaSqm:0,centerX:0,centerZ:0,rotationRad:0,footprint:[],clearancePolygon:[],localOutlines:derived.outlines,reason});
    const budget=Math.min(target,derived.areaSqm);
    if(budget<min*min-1e-8){const result=empty('area-budget');cached.set(key,result);return result;}
    const normalize=a=>{while(a>=Math.PI/2)a-=Math.PI;while(a< -Math.PI/2)a+=Math.PI;return Math.abs(a)<1e-10?0:a;};
    let angles=[0];
    if(options.rotationRad!==undefined)angles=[normalize(options.rotationRad)];
    else if(options.allowRotation===true){
      const edges=[];for(const poly of derived.outlines){const ring=poly[0];for(let i=0;i<ring.length-1;i++){
        const dx=ring[i+1][0]-ring[i][0],dz=ring[i+1][1]-ring[i][1];edges.push({angle:normalize(Math.atan2(dz,dx)),length:Math.hypot(dx,dz)});
      }}
      for(const edge of edges.sort((a,b)=>b.length-a.length))if(!angles.some(a=>Math.abs(normalize(a-edge.angle))<Math.PI/180)){
        angles.push(edge.angle);if(angles.length>=9)break;
      }
    }
    const frames=angles.map(angle=>{const outlines=transformOutline(derived.outlines,-angle);return{angle,outlines,bounds:outlineBounds(outlines)};});
    const pad=1e-5, fractions=[.5,.25,.75,.125,.875,0,1];
    let best=null;
    function candidate(frame,cx,cz,w,d){
      // cx/cz is the clearance envelope centre, not the building centre.
      if(!safeAxisRectangle(frame.outlines,cx,cz,w+2*side+2*pad,d+front+rear+2*pad))return null;
      const center=rotatePoint([cx,cz+(rear-front)/2],frame.angle);
      const clearanceCenter=rotatePoint([cx,cz],frame.angle);
      const toWorld=([x,z])=>{const p=rotatePoint([x,z],frame.angle);return[p[0]+center[0],p[1]+center[1]];};
      const footprint=rectPoly(0,0,w,d)[0].map(toWorld);
      const clearancePolygon=rectPoly(0,(front-rear)/2,w+2*side,d+front+rear)[0].map(toWorld);
      if(clip.difference([clearancePolygon],derived.outlines).length||clip.difference([footprint],derived.outlines).length)return null;
      return{fits:true,widthM:w,depthM:d,areaSqm:w*d,centerX:center[0],centerZ:center[1],clearanceCenterX:clearanceCenter[0],clearanceCenterZ:clearanceCenter[1],rotationRad:frame.angle,footprint:[footprint],clearancePolygon:[clearancePolygon],reason:null};
    }
    function ratios(frame){
      const ratio=(frame.bounds.widthM-2*side)/(frame.bounds.depthM-front-rear);
      return[...new Set([1,.5,2,.75,1.3333333333333333,.3333333333333333,3,.25,4,.16666666666666666,6,ratio,1/ratio].filter(a=>a>0&&Number.isFinite(a)))];
    }
    function centres(bounds,w,d){
      const loX=bounds.minX+w/2+side+pad,hiX=bounds.maxX-w/2-side-pad;
      const loZ=bounds.minZ+d/2+rear+pad,hiZ=bounds.maxZ-d/2-front-pad;
      // Return clearance centres, with asymmetric setbacks shifted back out.
      if(hiX<loX-1e-8||hiZ<loZ-1e-8)return[];
      return fractions.flatMap(fx=>fractions.map(fz=>[loX+(hiX-loX)*fx,loZ+(hiZ-loZ)*fz+(front-rear)/2]));
    }
    // First try the full budget. Small BCR footprints must not inherit a very
    // long site's aspect and collapse below the floor planner's minimum width.
    search:for(const frame of frames)for(const ratio of ratios(frame)){
      const w=Math.sqrt(budget*ratio),d=budget/w;if(w<min-1e-8||d<min-1e-8)continue;
      for(const [x,z]of centres(frame.bounds,w,d)){const found=candidate(frame,x,z,w,d);if(found){best=found;break search;}}
    }
    if(!best){
      for(const frame of frames)for(const ratio of ratios(frame)){
        const w=Math.sqrt(budget*ratio),d=budget/w;
        const minimumScale=Math.max(min/w,min/d);if(minimumScale>1)continue;
        for(const [x,z]of centres(frame.bounds,min,min)){
          const lower=Math.max(minimumScale,best?Math.sqrt(best.areaSqm/budget):0);if(lower>=1)continue;
          if(!safeAxisRectangle(frame.outlines,x,z,w*lower+2*side+2*pad,d*lower+front+rear+2*pad))continue;
          let lo=lower,hi=1;for(let i=0;i<20;i++){const mid=(lo+hi)/2;if(safeAxisRectangle(frame.outlines,x,z,w*mid+2*side+2*pad,d*mid+front+rear+2*pad))lo=mid;else hi=mid;}
          const found=candidate(frame,x,z,Math.floor((w*lo+1e-9)*1000)/1000,Math.floor((d*lo+1e-9)*1000)/1000);
          if(found&&(!best||found.areaSqm>best.areaSqm+1e-7))best=found;
        }
      }
    }
    if(!best){const result=empty('no-clearance-fit');cached.set(key,result);return result;}
    // The fast search is only a candidate generator. Exact polygon difference
    // independently certifies the final footprint and its entire clearance box.
    if(clip.difference(best.clearancePolygon,derived.outlines).length||clip.difference(best.footprint,derived.outlines).length)fail('배치 검증 결과 경계 밖의 형상이 남아 적용하지 않았습니다.');
    best.localOutlines=transformOutline(derived.outlines,-best.rotationRad,best.centerX,best.centerZ);
    best.clearanceLocalOutlines=transformOutline(derived.outlines,-best.rotationRad,best.clearanceCenterX,best.clearanceCenterZ);
    best.localBuildingCenter={x:0,z:(rear-front)/2};
    best.studyWidthM=best.widthM+side*2;best.studyDepthM=best.depthM+front+rear;
    best.setbacks={frontM:front,sideM:side,rearM:rear};
    if(cached.size>=32)cached.clear();cached.set(key,best);return best;
  }
  function derive(value) {
    if(value===null||value===undefined)return null;
    const key=JSON.stringify(value); if(cache.has(key))return cache.get(key);
    if(!clip)fail('필지 경계 계산 모듈을 불러오지 못했습니다.');
    const data=sanitizeParcelData(value);
    // Use a common local metric frame, without rounding the incoming cadastral vertices.
    // A deterministic common frame is independent of parcel selection order,
    // ring start vertex and ring winding. Anchoring to the first clicked parcel
    // changed the projection scale and the same merged site's calculated area.
    const allPoints=data.features.flatMap(f=>(f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates).flatMap(poly=>poly.flat()));
    const lon=Math.min(...allPoints.map(p=>p[0])),lat=Math.max(...allPoints.map(p=>p[1])),sx=R*RAD*Math.cos(lat*RAD),sz=R*RAD;
    const polys=data.features.map(f=>(f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates).map(p=>p.map(r=>r.map(([a,b])=>[(a-lon)*sx,-(b-lat)*sz]))));
    let union;try{union=clip.union(...polys);}catch(_){fail('필지 경계를 합칠 수 없습니다.');}
    if(union.length!==1)fail('서로 떨어진 필지는 하나의 매스로 합칠 수 없습니다. 인접한 필지만 선택해 주세요.');
    const pts=union.flat(2),xs=pts.map(p=>p[0]),zs=pts.map(p=>p[1]);
    const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs),W=maxX-minX,D=maxZ-minZ,A=area(union);
    if(!Number.isFinite(A)||A<=0||W>2000||D>2000)fail('필지 면적 또는 범위가 지원 범위를 벗어납니다.');
    let best={widthM:0,depthM:0,centerX:(minX+maxX)/2,centerZ:(minZ+maxZ)/2};
    if(contained(union,best.centerX,best.centerZ,W,D))best={...best,widthM:W,depthM:D};
    else{
      const ratios=[.3,.5,.75,1,1.4,2,3.3];
      for(let xi=1;xi<8;xi++)for(let zi=1;zi<8;zi++){
        const x=minX+W*xi/8,z=minZ+D*zi/8;
        if(!pointInside([x,z],union[0][0])||union[0].slice(1).some(r=>pointInside([x,z],r)))continue;
        for(const ratio of ratios){
          const aspect=W/D*ratio,w=Math.min(2*Math.min(x-minX,maxX-x),2*Math.min(z-minZ,maxZ-z)*aspect),d=w/aspect;
          if(w*d<=best.widthM*best.depthM)continue;
          let lo=0,hi=1;for(let i=0;i<12;i++){const mid=(lo+hi)/2;if(contained(union,x,z,w*mid,d*mid))lo=mid;else hi=mid;}
          if(w*d*lo*lo>best.widthM*best.depthM)best={widthM:w*lo,depthM:d*lo,centerX:x,centerZ:z};
        }
      }
    }
    if(best.widthM<=0||best.depthM<=0)fail('경계 내부에서 검토 가능한 사각 영역을 찾지 못했습니다.');
    const outlines=union.map(p=>p.map(r=>r.map(([x,z])=>[x-best.centerX,z-best.centerZ])));
    const result={areaSqm:A,rectangle:best,outlines,centerWgs84:[lon+best.centerX/sx,lat-best.centerZ/sz],projection:{metersPerDegreeLon:sx,metersPerDegreeLat:sz,xAxis:'east',zAxis:'south'},bounds:outlineBounds(outlines),featureCount:data.features.length,pnus:data.features.map(f=>f.properties.pnu).filter(Boolean),addresses:data.features.map(f=>f.properties.address).filter(Boolean),source:data.source,fetchedAt:data.fetchedAt||null,
      warnings:['경계 합집합의 WGS84 근사 투영 면적입니다. 공부 면적·법적 합필·용도지역·도로 방향은 별도 확인해야 합니다.','매스는 실제 경계 안의 보수적인 남북축 사각 영역을 사용합니다. 비정형 대지 최적 배치·인허가 결과가 아닙니다.']};
    cache.set(key,result);if(cache.size>16)cache.delete(cache.keys().next().value);return result;
  }
  return Object.freeze({sanitizeParcelData,derive,contained,area,fitRectangle,projectWgs84,unprojectLocal});
});
