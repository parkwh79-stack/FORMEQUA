"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const nav=require("../spatial-navigation.js"),walk=require("../interior-walk.js"),interior=require("../interior-plan.js");
const base=()=>({level:1,bounds:{minX:-5,maxX:5,minZ:-5,maxZ:5},rooms:[],cores:[],voids:[],walls:[],doors:[],furniture:[],entry:{x:-4,z:0}});
const routeOptions=(a={x:-4,z:0},b={x:4,z:0},extra={})=>({endpoints:[{id:"start",...a},{id:"finish",...b}],routes:[{fromId:"start",toId:"finish",kind:"test"}],...extra});
function reachable(plan,options){const r=nav.analyze(plan,options);assert.equal(r.status,"analyzed",JSON.stringify(r));const p=r.paths[0];assert.equal(p.status,"reachable",JSON.stringify(r));assert.ok(p.distanceM>=0);assert.equal(p.isEgressVerified,false);assert.equal(r.egress.isEgressVerified,false);assert.equal(r.multiLevel.status,"unverified");return{r,p};}
function checkPath(plan,p){let length=0;for(let i=1;i<p.points.length;i++){const a=p.points[i-1],b=p.points[i],d=Math.hypot(a.x-b.x,a.z-b.z),steps=Math.ceil(d/.025);length+=d;for(let j=0;j<=steps;j++){const t=j/(steps||1);assert.ok(walk.canStand(plan,a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t,.219),"returned polyline intersects the independent walk collision model");}}assert.ok(Math.abs(length-p.distanceM)<.00003,"ledger distance follows its actual polyline");assert.ok(p.minClearWidthM>=.44-1e-6);}
const open=base(),openRoute=reachable(open,routeOptions());checkPath(open,openRoute.p);assert.ok(openRoute.p.distanceM>=8&&openRoute.p.distanceM<8.3);
assert.equal(openRoute.r.engine,"lightweight-js-grid");assert.equal(openRoute.r.topologicPyExecuted,false);
assert.equal(openRoute.r.ledger[0].distanceM,openRoute.p.distanceM);assert.equal(openRoute.r.ledger[0].pathId,openRoute.p.id);

for(const kind of["wall","core","void"]){const p=base();if(kind==="wall")p.walls=[{x1:0,x2:0,z1:-5,z2:5,thickness:.03}];else p[kind==="core"?"cores":"voids"]=[{minX:-.02,maxX:.02,minZ:-5,maxZ:5}];const r=nav.analyze(p,routeOptions());assert.equal(r.paths[0].status,"disconnected",kind+" must partition the graph");assert.equal(r.paths[0].distanceM,null);assert.deepEqual(r.paths[0].points,[]);}
const gap=base();gap.rooms=[{id:"left",minX:-5,maxX:0,minZ:-5,maxZ:5,type:"office"}];gap.walls=[{x1:0,x2:0,z1:-5,z2:-.6,thickness:.12},{x1:0,x2:0,z1:.6,z2:5,thickness:.12}];gap.doors=[{id:"door-main",roomId:"left",x:0,z:0,axis:"z",width:1.2}];
const doorway=reachable(gap,routeOptions());checkPath(gap,doorway.p);assert.ok(doorway.p.doorIds.includes("door-main"));assert.ok(doorway.p.minClearWidthM<=1.2);
assert.equal(doorway.p.minDoorWidthM,1.2);assert.equal(doorway.p.doorCrossings[0].widthM,1.2);
const closed=structuredClone(gap);closed.doors[0].closed=true;
assert.equal(nav.analyze(closed,routeOptions()).paths[0].status,"disconnected","closed portal cannot remain traversable");
const narrow=structuredClone(gap);narrow.doors[0].width=.35;
assert.equal(nav.analyze(narrow,routeOptions()).paths[0].status,"disconnected","door metadata narrows the opening and respects body clearance");
const fakeDoor=structuredClone(gap);fakeDoor.walls=[{x1:0,x2:0,z1:-5,z2:5,thickness:.03}];
assert.equal(nav.analyze(fakeDoor,routeOptions()).paths[0].status,"disconnected","a door annotation must never cut an unbroken wall");
const offGrid=structuredClone(gap);offGrid.walls[0].z2=-.44;offGrid.walls[1].z1=.66;offGrid.doors[0].z=.11;offGrid.doors[0].width=1.1;
const portalRoute=reachable(offGrid,routeOptions({x:-4,z:.11},{x:4,z:.11},{cellSizeM:1.4}));checkPath(offGrid,portalRoute.p);
assert.ok(portalRoute.p.doorIds.includes("door-main"),"actual portal anchors keep a doorway between coarse rows connected");

const core=base();core.cores=[{id:"core-main",minX:-1,maxX:1,minZ:-1,maxZ:1}];
const detour=reachable(core,routeOptions());checkPath(core,detour.p);assert.ok(detour.p.distanceM>8.4,"path length must include a real core detour rather than the centre-to-centre line");
const explicitObstacle={...base(),obstacles:[{id:"column",minX:-1,maxX:1,minZ:-1,maxZ:1}]};
const obstacleRoute=reachable(explicitObstacle,routeOptions());checkPath(explicitObstacle,obstacleRoute.p);assert.ok(obstacleRoute.p.distanceM>8.4,"explicit structural/other obstacles are not omitted from the walkable surface");
const toCore=nav.analyze({...core,rooms:[{id:"R1",type:"office",minX:-4.5,maxX:-2,minZ:-2,maxZ:2}]});
const corePath=toCore.paths.find(p=>p.kind==="room-to-core-candidate");assert.equal(corePath.status,"reachable");checkPath({...core},corePath);
const end=corePath.points.at(-1);assert.ok(end.x< -1||end.x>1||end.z< -1||end.z>1,"target is outside the solid core, not an invented stair inside it");
assert.equal(corePath.targetVerification,"candidate");

const furniture=base();furniture.furniture=[{x:0,z:0,width:8,depth:1,rotationY:Math.PI/2}];
const aroundFurniture=reachable(furniture,routeOptions());checkPath(furniture,aroundFurniture.p);assert.ok(aroundFurniture.p.distanceM>11);assert.ok(aroundFurniture.p.points.some(p=>Math.abs(p.z)>4.1),"rotated visible furniture footprint forces the detour");
const furnishedRoom=base();furnishedRoom.rooms=[{id:"R1",minX:-4,maxX:-1,minZ:-2,maxZ:2,type:"office"}];furnishedRoom.entry={x:4,z:0};furnishedRoom.furniture=[{x:-2.5,z:0,width:1,depth:1}];
const origin=nav.analyze(furnishedRoom).endpoints.find(e=>e.kind==="room-origin");assert.equal(origin.status,"walkable");assert.notDeepEqual(origin.point,{x:-2.5,z:0});assert.ok(walk.canStand(furnishedRoom,origin.point.x,origin.point.z));

// Exercise generated walls, ensuite openings, furniture and candidate routes.
for(const use of["main","hotel","residential"]){const plan=interior.generate({level:3,use,widthM:24,depthM:20,zBottom:8,zTop:12},{coreType:"north"});const before=JSON.stringify(plan),r=nav.analyze(plan,{maxPaths:64});assert.equal(r.status,"analyzed",JSON.stringify(r));assert.ok(r.paths.some(p=>p.kind==="customer-representative"));assert.ok(r.paths.some(p=>p.kind==="staff-representative"));for(const p of r.paths)if(p.status==="reachable")checkPath(plan,p);assert.equal(JSON.stringify(plan),before,"analysis cannot mutate interior geometry");}
const verified=reachable(base(),routeOptions(undefined,undefined,{endpoints:[{id:"start",x:-4,z:0},{id:"finish",kind:"exit",x:4,z:0,verified:true,evidence:"Surveyed exit approach 2026-10-21"}],verticalLinks:[{fromLevel:1,toLevel:2}]}));
assert.equal(verified.p.targetVerification,"provided-evidence");assert.equal(verified.p.isEgressVerified,false,"verified target evidence alone cannot establish a legal egress path");assert.equal(verified.r.multiLevel.status,"unverified");

const large=base();large.bounds={minX:-50,maxX:50,minZ:-50,maxZ:50};const largeResult=nav.analyze(large,routeOptions());assert.equal(largeResult.status,"analyzed");assert.ok(largeResult.grid.cellCount<=15000);assert.ok(largeResult.grid.coarsened);
const tooMany=base();tooMany.rooms=Array.from({length:1001},(_,i)=>({id:"R"+i,minX:-4,maxX:4,minZ:-4,maxZ:4}));assert.equal(nav.analyze(tooMany).status,"limited");
assert.equal(nav.analyze({status:"not-generated",reason:"massing-only",metrics:null}).status,"not-generated");
assert.equal(nav.analyze({...base(),walls:[{x1:NaN,x2:0,z1:-5,z2:5}]}).status,"unavailable");
assert.equal(nav.analyze({...base(),obstacles:[{minX:NaN,maxX:1,minZ:-1,maxZ:1}]}).status,"unavailable");
assert.equal(nav.analyze({...base(),obstacles:{minX:-1,maxX:1,minZ:-1,maxZ:1}}).status,"unavailable");
assert.equal(nav.analyze(base(),routeOptions(undefined,undefined,{maxCells:15001})).status,"unavailable");

nav.clearCache();const cached=nav.analyze(gap,routeOptions());assert.strictEqual(nav.analyze(structuredClone(gap),routeOptions()),cached);assert.ok(Object.isFrozen(cached.paths));
const changed=structuredClone(gap);changed.walls=[{x1:0,x2:0,z1:-5,z2:5}];assert.notStrictEqual(nav.analyze(changed,routeOptions()),cached);assert.equal(nav.analyze(changed,routeOptions()).paths[0].status,"disconnected");
const repeat=nav.analyze(gap,routeOptions());assert.equal(repeat.paths[0].id,cached.paths[0].id);
for(let i=0;i<7;i++)nav.analyze(base(),routeOptions(undefined,undefined,{clearanceM:.22+i*.01}));assert.ok(nav.cacheInfo().entries<=4);
const browser={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../spatial-navigation.js"),"utf8"),browser);const browserResult=browser.window.AtelierSpatialNavigation.analyze(gap,routeOptions());assert.deepEqual(JSON.parse(JSON.stringify(browserResult.paths)),JSON.parse(JSON.stringify(cached.paths)));
console.log("Spatial navigation: collision-safe graph shortest paths, true door gaps/width/closed state, core/furniture detours, walkable origins, ledger IDs, unverified egress/multilevel, limits and synchronous cache passed");
