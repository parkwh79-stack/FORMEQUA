'use strict';
const assert=require('node:assert/strict');
const floor=require('../floor-geometry'),interior=require('../interior-plan'),poly=require('../interior-geometry');
const clip=require('../vendor/polygon-clipping-0.15.7.umd.min'),walk=require('../interior-walk'),nav=require('../spatial-navigation');
const handoff=require('../bim-handoff'),study=require('../dashboard-study');
const multi=p=>[[p.outer,...p.holes]];
const area=mp=>mp.reduce((s,p)=>s+poly.polygon(p[0],p.slice(1)).areaSqm,0);
let cases=0,guestTotal=0,supportTotal=0;
for(const profile of ['chamfered','elliptic','sculpted','twisted'])for(const use of ['main','hotel','residential'])for(const size of [14,26,42])for(const atrium of [false,true]){
 const fp=floor.attach({level:6,widthM:size,depthM:size*.82,northShiftM:3,zBottom:20,zTop:24,use,hasAtrium:atrium},{massProfile:profile,massShapePct:28,floorsAbove:11});
 const plan=interior.generate(fp,{residentialType:'officetel'});cases++;
 if(plan.status!=='generated')continue;
 assert.ok(plan.region);assert.equal(plan.coverage.status,'covered');assert.ok(plan.coverage.unassignedAreaSqm<.01);
 const pieces=[...plan.rooms,...plan.corridors,...plan.supportSpaces,...plan.cores,...plan.obstacles].map(poly.of);
 const union=clip.union(...pieces.map(multi));
 assert.ok(area(clip.difference(multi(plan.region),union))<.01,'no unrepresented perimeter');
 for(const room of plan.rooms){
  assert.ok(area(clip.difference(multi(room.polygon),multi(plan.region)))<.001,'room follows floor and avoids atrium');
  assert.ok(Math.abs(room.areaSqm-poly.area(room))<.001);
  assert.ok(poly.contains(room.polygon,[room.labelPoint.x,room.labelPoint.z]));
  const door=plan.doors.find(d=>d.roomId===room.id&&d.kind!=='ensuite');assert.ok(door);
  assert.ok(room.polygon.outer.some((a,i,r)=>poly.distance([door.x,door.z],a,r[(i+1)%r.length])<.0001),'entrance lies on actual room edge');
  const bare={...plan,furniture:[]};
  assert.ok(walk.canStand(bare,door.x,door.z,.18),'entrance is a genuine wall opening');
  if(room.ensuite){const bath=room.ensuite.bounds;
   const edgeLength=room.ensuite.walls.reduce((s,w)=>s+Math.hypot(w.x2-w.x1,w.z2-w.z1),0);
   assert.ok(Math.abs(edgeLength-(2*((bath.maxX-bath.minX)+(bath.maxZ-bath.minZ))-room.ensuite.door.width))<.01,'inset bathroom has all four walls minus its door');
  }
 }
 for(const f of plan.furniture){const room=[...plan.rooms,...plan.supportSpaces].find(r=>r.id===f.roomId);assert.ok(room&&poly.containsItem(room.polygon,f),'furniture stays inside actual room');}
 const empty={...plan,walls:[],furniture:[],cores:[],voids:[],obstacles:[]};
 assert.equal(walk.canStand(empty,plan.bounds.minX+.01,plan.bounds.minZ+.01),false,'AABB corner outside curved/twisted floor cannot be walked');
 const svg=study.planSvg(plan,'Polygon study');assert.match(svg,/data-polygon-space="true"/);
 const bim=handoff.buildHandoff({floorPlates:[fp]},{plans:[plan]});assert.ok(handoff.validateHandoff(bim).valid);
 for(let i=0;i<plan.rooms.length;i++)assert.ok(Math.abs(bim.rooms[i].areaSqm-plan.rooms[i].areaSqm)<.001);
 assert.equal(plan.metrics.guestRoomCount,plan.rooms.filter(r=>r.hotelModule?.status==='complete').length);
 guestTotal+=plan.metrics.guestRoomCount;supportTotal+=plan.supportSpaces.length;
}
assert.ok(guestTotal>0,'nonrectangular hotel geometry retains genuinely fitted guest rooms');
// Same AABB, different actual boundary: no stale rectangular navigation cache.
const region=poly.polygon([[0,5],[5,0],[10,5],[5,10]]),base={level:1,status:'generated',bounds:{minX:0,maxX:10,minZ:0,maxZ:10},rooms:[],cores:[],voids:[],walls:[],doors:[],furniture:[],entry:{x:5,z:5}};
const outside={id:'corner',x:1,z:1};
assert.equal(nav.analyze(base,{endpoints:[outside]}).endpoints.find(e=>e.id==='corner').status,'walkable');
assert.equal(nav.analyze({...base,region},{endpoints:[outside]}).endpoints.find(e=>e.id==='corner').status,'blocked');
// A rotated furniture rectangle must not enclose a courtyard hole.
const withHole=poly.polygon([[-5,-5],[5,-5],[5,5],[-5,5]],[[[-.2,-.2],[-.2,.2],[.2,.2],[.2,-.2]]]);
assert.equal(poly.containsItem(withHole,{x:0,z:0,width:4,depth:4,rotationY:.2}),false);
console.log(`Polygon interiors: ${cases} curved/twisted/use/size/atrium cases, full area coverage, actual room/door/furniture containment, walk/nav boundaries, SVG and BIM passed (${supportTotal} support zones).`);
