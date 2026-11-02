/* Shared polygon interiors in local X/Z metres; no legal/structural approval. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./vendor/polygon-clipping-0.15.7.umd.min.js'):root.polygonClipping);
  if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.AtelierInteriorGeometry=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(clip){
  'use strict';
  const EPS=1e-5,round=n=>Math.round(n*1e6)/1e6;
  const signed=r=>r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2;
  function ring(points,positive=true){const r=points.map(p=>p.map(round));if(r.length>1&&Math.hypot(r[0][0]-r.at(-1)[0],r[0][1]-r.at(-1)[1])<EPS)r.pop();if((signed(r)>0)!==positive)r.reverse();return r;}
  function polygon(outer,holes=[]){outer=ring(outer);holes=holes.map(r=>ring(r,false));return {outer,holes,areaSqm:Math.abs(signed(outer))-holes.reduce((s,r)=>s+Math.abs(signed(r)),0)};}
  const rect=r=>polygon([[r.minX,r.minZ],[r.maxX,r.minZ],[r.maxX,r.maxZ],[r.minX,r.maxZ]]);
  const of=r=>r.polygon||rect(r);
  const area=r=>r.polygon?r.polygon.areaSqm:(r.maxX-r.minX)*(r.maxZ-r.minZ);
  const multi=p=>[[p.outer,...p.holes]];
  const unpack=polys=>polys.map(p=>polygon(p[0],p.slice(1))).filter(p=>p.outer.length>=3&&p.areaSqm>1e-5);
  const bounds=p=>({minX:Math.min(...p.outer.map(v=>v[0])),maxX:Math.max(...p.outer.map(v=>v[0])),minZ:Math.min(...p.outer.map(v=>v[1])),maxZ:Math.max(...p.outer.map(v=>v[1]))});
  function distance(p,a,b){const x=b[0]-a[0],z=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*z)/(x*x+z*z||1)));return Math.hypot(p[0]-a[0]-t*x,p[1]-a[1]-t*z);}
  function inRing(r,p){let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[j],b=r[i];if(distance(p,a,b)<EPS)return true;if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
  function contains(p,point,pad=0){if(!p||!inRing(p.outer,point)||p.holes.some(r=>inRing(r,point)))return false;return pad<=0||[p.outer,...p.holes].every(r=>r.every((a,i)=>distance(point,a,r[(i+1)%r.length])>=pad-EPS));}
  const intersectsDisc=(p,point,pad)=>contains(p,point)||[p.outer,...p.holes].some(r=>r.some((a,i)=>distance(point,a,r[(i+1)%r.length])<pad));
  function crosses(a,b,c,d){const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);return cross(a,b,c)*cross(a,b,d)<-EPS*EPS&&cross(c,d,a)*cross(c,d,b)<-EPS*EPS;}
  function containsRect(p,r,pad=0){
    const corners=[[r.minX,r.minZ],[r.maxX,r.minZ],[r.maxX,r.maxZ],[r.minX,r.maxZ]];
    if(!corners.every(c=>contains(p,c,pad)))return false;
    if(p.holes.some(h=>h.some(([x,z])=>x>r.minX+EPS&&x<r.maxX-EPS&&z>r.minZ+EPS&&z<r.maxZ-EPS)))return false;
    return [p.outer,...p.holes].every(h=>h.every((a,i)=>corners.every((c,j)=>!crosses(a,h[(i+1)%h.length],c,corners[(j+1)%4]))));
  }
  function inset(r,amount){
    r=ring(r);const lines=r.map((a,i)=>{const b=r[(i+1)%r.length],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz),nx=-dz/l,nz=dx/l;return {nx,nz,c:nx*a[0]+nz*a[1]+amount};});
    return lines.map((b,i)=>{const a=lines[(i+lines.length-1)%lines.length],det=a.nx*b.nz-b.nx*a.nz;if(Math.abs(det)<1e-10)throw Error('DEGENERATE_INTERIOR_CONTOUR');return [round((a.c*b.nz-b.c*a.nz)/det),round((a.nx*b.c-b.nx*a.c)/det)];});
  }
  function enabled(fp){return !!(clip&&fp.footprint?.outer?.length>4);}
  function regionFor(fp){return polygon(inset(fp.footprint.outer,.2),fp.footprint.holes||[]);}
  function clipped(r,region){return unpack(clip.intersection(multi(rect(r)),multi(region)));}
  function centroid(p){const r=p.outer;let a=0,x=0,z=0;for(let i=0;i<r.length;i++){const b=r[(i+1)%r.length],c=r[i][0]*b[1]-b[0]*r[i][1];a+=c;x+=(r[i][0]+b[0])*c;z+=(r[i][1]+b[1])*c;}return Math.abs(a)>EPS?[x/(3*a),z/(3*a)]:r[0];}
  function convex(p){return !p.holes.length&&p.outer.every((a,i,r)=>{const b=r[(i+1)%r.length],c=r[(i+2)%r.length];return (b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0])>=-EPS;});}
  function fittedRect(p,pad=.12,minSide=0){
    const b=bounds(p),w=b.maxX-b.minX,d=b.maxZ-b.minZ,c=centroid(p),isConvex=convex(p);
    const centers=[c,[(b.minX+b.maxX)/2,(b.minZ+b.maxZ)/2],...p.outer.filter((_,i)=>i%Math.max(1,Math.floor(p.outer.length/8))===0).map(v=>[c[0]*.65+v[0]*.35,c[1]*.65+v[1]*.35])];
    for(let i=1;i<=3;i++)for(let j=1;j<=3;j++)centers.push([b.minX+w*i/4,b.minZ+d*j/4]);
    let best=null,bestArea=0,bestFits=false;
    for(const point of centers){if(!contains(p,point,pad))continue;for(const ratio of [w/d,1,2,.5,.25,1/3,.4,2/3,1.5,3,4]){
      const hw=Math.sqrt(p.areaSqm*ratio)/2,hd=Math.sqrt(p.areaSqm/ratio)/2;let t=1;
      if(isConvex)for(let i=0;i<p.outer.length;i++){const a=p.outer[i],b=p.outer[(i+1)%p.outer.length],dx=b[0]-a[0],dz=b[1]-a[1],den=Math.abs(dx)*hd+Math.abs(dz)*hw;t=Math.min(t,(dx*(point[1]-a[1])-dz*(point[0]-a[0])-pad*Math.hypot(dx,dz))/den);}
      else{let lo=0,hi=1;for(let n=0;n<11;n++){const m=(lo+hi)/2,r={minX:point[0]-hw*m,maxX:point[0]+hw*m,minZ:point[1]-hd*m,maxZ:point[1]+hd*m};if(containsRect(p,r,pad))lo=m;else hi=m;}t=lo;}
      t=Math.max(0,t-.000001);const r={minX:round(point[0]-hw*t),maxX:round(point[0]+hw*t),minZ:round(point[1]-hd*t),maxZ:round(point[1]+hd*t)},a=(r.maxX-r.minX)*(r.maxZ-r.minZ);
      const fits=Math.min(r.maxX-r.minX,r.maxZ-r.minZ)>=minSide-EPS;
      if((fits&&!bestFits||fits===bestFits&&a>bestArea)&&containsRect(p,r,pad-EPS)){best=r;bestArea=a;bestFits=fits;}
    }}return best;
  }
  function row(source,p){const b=bounds(p),layoutBounds=fittedRect(p,.12,/^guest_/.test(source.type)?(source.type==='guest_suite'?4:3.5):0);return {...source,...b,polygon:p,areaSqm:round(p.areaSqm),layoutBounds,labelPoint:layoutBounds?{x:(layoutBounds.minX+layoutBounds.maxX)/2,z:(layoutBounds.minZ+layoutBounds.maxZ)/2}:{x:centroid(p)[0],z:centroid(p)[1]}};}
  function sharedDoor(room,corridors){
    const faces=[];
    for(let i=0;i<room.polygon.outer.length;i++){
      const a=room.polygon.outer[i],b=room.polygon.outer[(i+1)%room.polygon.outer.length],horizontal=Math.abs(a[1]-b[1])<EPS,vertical=Math.abs(a[0]-b[0])<EPS;
      if(!horizontal&&!vertical)continue;const k=horizontal?0:1,q=1-k,constant=a[q];
      for(const c of corridors)for(let j=0;j<c.polygon.outer.length;j++){
        const u=c.polygon.outer[j],v=c.polygon.outer[(j+1)%c.polygon.outer.length];if(Math.abs(u[q]-constant)>EPS||Math.abs(v[q]-constant)>EPS)continue;
        const lo=Math.max(Math.min(a[k],b[k]),Math.min(u[k],v[k])),hi=Math.min(Math.max(a[k],b[k]),Math.max(u[k],v[k]));
        if(hi-lo>=1.35-EPS)faces.push({axis:horizontal?'x':'z',constant,lo,hi});
      }
    }
    faces.sort((a,b)=>(b.hi-b.lo)-(a.hi-a.lo));const f=faces[0];if(!f)return null;
    const mid=(f.lo+f.hi)/2;return {x:round(f.axis==='x'?mid:f.constant),z:round(f.axis==='x'?f.constant:mid),axis:f.axis,width:round(Math.min(room.type==='office'||room.type==='showroom'?1.15:.95,f.hi-f.lo-.4)),roomId:room.id};
  }
  function prepare(plan){
    plan.corridors=plan.corridors.flatMap((r,i)=>clipped(r,plan.region).map((p,j)=>row({...r,id:`L${plan.level}-C${i}-${j}`},p)));
    plan.rooms=plan.rooms.flatMap(r=>clipped(r,plan.region).map((p,i)=>row({...r,id:i?r.id+'-'+i:r.id},p))).filter(r=>{
      if(r.areaSqm<3||!r.layoutBounds||Math.min(r.layoutBounds.maxX-r.layoutBounds.minX,r.layoutBounds.maxZ-r.layoutBounds.minZ)<.75)return false;
      r.accessDoor=sharedDoor(r,plan.corridors);return !!r.accessDoor;
    });
    plan.doors=plan.rooms.map(r=>r.accessDoor);
  }
  function itemBounds(f){return {minX:f.x-f.width/2,maxX:f.x+f.width/2,minZ:f.z-f.depth/2,maxZ:f.z+f.depth/2};}
  function containsItem(p,f){
    if(!f.rotationY)return containsRect(p,itemBounds(f));
    const c=Math.cos(f.rotationY),s=Math.sin(f.rotationY),pts=[[-f.width/2,-f.depth/2],[f.width/2,-f.depth/2],[f.width/2,f.depth/2],[-f.width/2,f.depth/2]].map(([x,z])=>[f.x+c*x+s*z,f.z-s*x+c*z]);
    const footprint=polygon(pts);
    return pts.every(pnt=>contains(p,pnt))&&!p.holes.some(r=>r.some(pnt=>inRing(footprint.outer,pnt)))&&[p.outer,...p.holes].every(r=>r.every((a,i)=>pts.every((b,j)=>!crosses(a,r[(i+1)%r.length],b,pts[(j+1)%pts.length]))));
  }
  function walls(plan,height){
    const groups=new Map(),out=[];
    for(const room of plan.rooms){const r=room.polygon.outer;
      for(let i=0;i<r.length;i++){
        const a=r[i],b=r[(i+1)%r.length];
        if([plan.region.outer,...plan.region.holes].some(r=>r.some((u,j)=>distance(a,u,r[(j+1)%r.length])<EPS*3&&distance(b,u,r[(j+1)%r.length])<EPS*3)))continue;
        const horizontal=Math.abs(a[1]-b[1])<EPS,axis=horizontal?'x':'z',constant=horizontal?a[1]:a[0],lo=horizontal?Math.min(a[0],b[0]):Math.min(a[1],b[1]),hi=horizontal?Math.max(a[0],b[0]):Math.max(a[1],b[1]);
        if(!horizontal&&Math.abs(a[0]-b[0])>=EPS){out.push({x1:a[0],z1:a[1],x2:b[0],z2:b[1],height,thickness:.12});continue;}
        const key=axis+':'+round(constant);if(!groups.has(key))groups.set(key,{axis,constant,spans:[]});groups.get(key).spans.push([lo,hi]);
      }
    }
    for(const {axis,constant,spans} of groups.values()){
      const merged=[];for(const span of spans.sort((a,b)=>a[0]-b[0])){const last=merged.at(-1);if(last&&span[0]<=last[1]+EPS)last[1]=Math.max(last[1],span[1]);else merged.push(span.slice());}
      for(const span of merged){let parts=[span];for(const d of plan.doors)if(d.axis===axis&&Math.abs((axis==='x'?d.z:d.x)-constant)<EPS){const mid=axis==='x'?d.x:d.z,lo=mid-d.width/2,hi=mid+d.width/2;parts=parts.flatMap(([a,b])=>hi<=a||lo>=b?[[a,b]]:[[a,Math.min(b,lo)],[Math.max(a,hi),b]].filter(([a,b])=>b-a>.04));}
        for(const [a,b] of parts)if(b-a>.04)out.push({x1:round(axis==='x'?a:constant),z1:round(axis==='x'?constant:a),x2:round(axis==='x'?b:constant),z2:round(axis==='x'?constant:b),height,thickness:.12});
      }
    }return out;
  }
  function complete(plan,fp){
    const occupied=[...plan.rooms,...plan.corridors,...plan.cores,...plan.obstacles].map(of);
    const union=occupied.length?clip.union(...occupied.map(p=>multi(p))):[];
    const rest=unpack(union.length?clip.difference(multi(plan.region),union):multi(plan.region));
    plan.supportSpaces=rest.map((p,i)=>row({id:`L${plan.level}-P${i+1}`,type:'perimeter_support',label:'설비·수납 영역',open:true},p));
    for(const space of plan.supportSpaces){const b=space.layoutBounds;if(!b)continue;const w=b.maxX-b.minX,d=b.maxZ-b.minZ;
      const add=(type,x,z,width,depth,height)=>{const item={type,x:round(x),z:round(z),width,depth,height,roomId:space.id};if(containsItem(space.polygon,item))plan.furniture.push(item);};
      if(w>=1.7&&d>=2){space.type='perimeter_lounge';space.label='창가 라운지';add('sofa',(b.minX+b.maxX)/2,b.minZ+.55,1.4,.7,.8);if(d>2.8)add('lounge_table',(b.minX+b.maxX)/2,b.minZ+1.65,.6,.6,.55);}
      else if(w>=.7&&d>=.7)add('planter',(b.minX+b.maxX)/2,(b.minZ+b.maxZ)/2,.4,.4,.7);
    }
    const represented=[...occupied,...plan.supportSpaces.map(of)],representedUnion=represented.length?clip.union(...represented.map(multi)):[];
    const missing=representedUnion.length?unpack(clip.difference(multi(plan.region),representedUnion)).reduce((s,p)=>s+p.areaSqm,0):plan.region.areaSqm;
    const gross=fp.areaSqm??fp.footprint?.areaSqm??plan.region.areaSqm;
    plan.coverage={status:missing<.01?'covered':'incomplete',grossFloorAreaSqm:round(gross),interiorAreaSqm:round(plan.region.areaSqm),exteriorWallReserveSqm:round(Math.max(0,gross-plan.region.areaSqm)),roomAreaSqm:round(plan.rooms.reduce((s,r)=>s+area(r),0)),corridorAreaSqm:round(plan.corridors.reduce((s,r)=>s+area(r),0)),supportAreaSqm:round(plan.supportSpaces.reduce((s,r)=>s+area(r),0)),unassignedAreaSqm:round(missing)};
    const target=[0,plan.bounds.maxZ-.65],entries=plan.corridors.map(c=>c.layoutBounds).filter(Boolean).map(b=>[(b.minX+b.maxX)/2,(b.minZ+b.maxZ)/2]).filter(p=>contains(plan.region,p,.25)&&![...plan.cores,...plan.voids,...plan.obstacles].some(r=>contains(of(r),p,.01)));
    entries.sort((a,b)=>Math.hypot(a[0]-target[0],a[1]-target[1])-Math.hypot(b[0]-target[0],b[1]-target[1]));if(entries[0])plan.entry={x:round(entries[0][0]),z:round(entries[0][1])};
    plan.metrics.furnitureCount=plan.furniture.length;plan.metrics.supportAreaSqm=plan.coverage.supportAreaSqm;
    return plan;
  }
  return Object.freeze({polygon,rect,of,area,bounds,contains,containsRect,containsItem,intersectsDisc,regionFor,enabled,clipped,fittedRect,row,prepare,walls,complete,distance,version:'1.0.0'});
});
