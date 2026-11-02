'use strict';
const assert=require('node:assert/strict');
const geometry=require('../floor-geometry');
const {analyze}=require('../analysis-engine');
const interior=require('../interior-plan');
const ifc=require('../mass-ifc');
const workspace=require('../workspace-state');
const interiors=require('../interior-geometry');
const inside=(fp,r)=>r.polygon?r.polygon.outer.every(p=>geometry.containsPoint(fp.footprint.outer,p)):geometry.containsRect(fp,r);
const base={siteAreaSqm:2400,targetBcr:50,floorsAbove:12,floorsBelow:3,parkingMode:'report',modelDetail:'concept',northSolar:false};
const run=(inputs={},program='office')=>analyze({program,parcelKey:'custom_seoul',inputs:{...base,...inputs}});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const simple={widthM:20,depthM:10,northShiftM:3,level:1};
near(geometry.create(simple).areaSqm,200);
near(geometry.attach(simple,{massProfile:'chamfered',massShapePct:20}).areaSqm,192);
near(geometry.attach({...simple,hasAtrium:true},{massProfile:'chamfered',massShapePct:20}).areaSqm,167.5);
assert.throws(()=>geometry.settings({massShapePct:NaN}));
assert.throws(()=>geometry.settings({crownHeightM:9}));
near(geometry.projectedArea([simple,{...simple,northShiftM:8}]),300);
const ellipse=geometry.attach(simple,{massProfile:'elliptic',massShapePct:30});
near(ellipse.areaSqm,16*Math.sin(Math.PI/16)*50);
assert.equal(ellipse.footprint.outer.length,32);
const bulb={massProfile:'sculpted',massShapePct:30};
near(geometry.scaleFor(1,11,bulb),.7);near(geometry.scaleFor(6,11,bulb),1);near(geometry.scaleFor(11,11,bulb),.7);
for(const strength of [0,15,30])for(const profile of ['elliptic','sculpted','twisted'])for(const width of [8,20,70]){
 const fp=geometry.attach({...simple,widthM:width,level:6,hasAtrium:true},{massProfile:profile,massShapePct:strength,floorsAbove:11});
 assert.ok(fp.footprint.areaSqm>0);assert.ok(fp.footprint.outer.length<=64);
 for(const [x,z] of fp.footprint.outer){assert.ok(Math.abs(x)<=width/2+1e-7);assert.ok(Math.abs(z-simple.northShiftM)<=simple.depthM/2+1e-7);}
 for(const p of fp.footprint.holes[0])assert.ok(geometry.containsPoint(fp.footprint.outer,p),'atrium must stay inside fitted rotating/curved floor');
 const bounds=geometry.planningBounds(fp);for(const p of [[bounds.minX,bounds.minZ],[bounds.maxX,bounds.maxZ],[bounds.minX,bounds.maxZ],[bounds.maxX,bounds.minZ]])assert.ok(geometry.containsPoint(fp.footprint.outer,p));
}
const legacy=run(),explicit=run({massProfile:'legacy',massShapePct:30});
assert.deepEqual(explicit.model.areas,legacy.model.areas);
assert.deepEqual(explicit.model.finance,legacy.model.finance);
for(const profile of ['chamfered','tapered','stepped','elliptic','sculpted','twisted'])for(const program of ['office','hotel']){
 const result=run({massProfile:profile,massShapePct:25},program),m=result.model;
 assert.ok(m.floorPlates.length>3);
 near(m.floorPlates.reduce((s,f)=>s+f.areaSqm,0),m.areas.aboveGroundGfaSqm);
 assert.ok(m.areas.achievedFarPct<=m.zoningRule.maxFar+.01);
 for(const fp of m.floorPlates){
  near(fp.areaSqm,geometry.create(fp).areaSqm);
  const plan=interior.generate(fp,{...result.inputs,coreLayout:m.coreLayout});
   for(const r of [...plan.rooms,...plan.cores])assert.ok(inside(fp,r),`${profile}/${program}: room/core outside floor`);
  for(const f of plan.furniture)assert.ok(geometry.containsRect(fp,{minX:f.x-f.width/2,maxX:f.x+f.width/2,minZ:f.z-f.depth/2,maxZ:f.z+f.depth/2}),`${profile}/${program}: furniture outside floor`);
 }
 for(const axis of m.structuralReference.columns)for(const fp of m.floorPlates)assert.ok(geometry.containsPoint(fp.footprint.outer,[axis.x,axis.z]));
 const text=ifc.buildIfc(m,{floorHeight:4,floorsBelow:3});assert.ok(text.includes('IFCEXTRUDEDAREASOLID'));
 if(profile==='chamfered')assert.equal(m.floorPlates[0].footprint.outer.length,8);
}
const flat=run({floorsAbove:6}),crown=run({floorsAbove:6,crownStyle:'sloped',crownHeightM:8});
near(flat.model.areas.aboveGroundGfaSqm,crown.model.areas.aboveGroundGfaSqm);
assert.equal(crown.model.roofCrown.countedGfaSqm,0);
assert.ok(crown.model.buildingHeightM>flat.model.buildingHeightM);
const limited=run({regulationMode:'scenario',maxHeightM:30,crownStyle:'sloped',crownHeightM:8});
assert.ok(limited.model.buildingHeightM<=30+.001);
const clean=workspace({}).sanitize({parcelKey:'custom_seoul',massProfile:'chamfered',massShapePct:24,crownStyle:'sloped',crownHeightM:4});
assert.equal(clean.massProfile,'chamfered');assert.equal(clean.crownHeightM,4);
for(const option of ['A','B','C'])for(const profile of ['chamfered','tapered','stepped','elliptic','sculpted','twisted']){
 const m=run({option,massProfile:profile,massShapePct:30,crownStyle:'sloped',crownHeightM:8,floorsAbove:35}).model;
 assert.ok(m.actualFloorsAbove>0);near(m.areas.buildingFootprintSqm,geometry.projectedArea(m.floorPlates));
 assert.ok(m.areas.achievedFarPct<=m.zoningRule.maxFar+.01);assert.ok(m.areas.achievedBcrPct<=m.zoningRule.maxBcr+.01);
 for(const fp of m.floorPlates){
  const plan=interior.generate(fp,{coreLayout:m.coreLayout});
   for(const r of [...plan.rooms,...plan.cores])assert.ok(inside(fp,r),`${option}/${profile}: outside contour`);
 }
 if(profile==='chamfered')assert.match(ifc.buildIfc(m,{}),/IFCPOLYLINE\(\((?:#\d+,){8}#\d+\)\)/);
}
(async()=>{
 const {buildSolids}=await import('../vendor/manifold/formequa-kernel.js');
 const fp=geometry.attach({...simple,hasAtrium:true},{massProfile:'chamfered',massShapePct:20});
 const jobs=[{key:'slab',heightM:4,contours:geometry.localContours(fp)},{key:'crown',heightM:6,contours:geometry.localContours(fp),sloped:true}];
 for(let repeat=0;repeat<3;repeat++){
  const solids=await buildSolids(jobs);
  for(const solid of solids){assert.ok(solid.positions.length>12);assert.ok(solid.indices.length>12);assert.ok([...solid.positions].every(Number.isFinite));}
  // Oriented volume validates coordinate conversion, clipping side and holes.
  const volume=s=>{let v=0;const p=s.positions,t=s.indices;for(let i=0;i<t.length;i+=3){const a=t[i]*3,b=t[i+1]*3,c=t[i+2]*3;v+=(p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1])+p[a+1]*(p[b+2]*p[c]-p[b]*p[c+2])+p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c]))/6;}return Math.abs(v);};
  near(volume(solids[0]),fp.areaSqm*4);assert.ok(Math.abs(volume(solids[1])-fp.areaSqm*6*.55)<1e-4);
 }
 await assert.rejects(buildSolids([{key:'bad',heightM:1,contours:[[[NaN,0],[1,0],[0,1]]]}]));
  for(const profile of ['elliptic','sculpted','twisted']){
    const fp=geometry.attach({...simple,level:6,hasAtrium:true},{massProfile:profile,massShapePct:30,floorsAbove:11});
    const [solid]=await buildSolids([{key:profile,heightM:4,contours:geometry.localContours(fp)}]);
    assert.ok(solid.positions.length>0);assert.ok([...solid.positions].every(Number.isFinite));
    const clean=workspace({}).sanitize({parcelKey:'custom_seoul',massProfile:profile,massShapePct:30});assert.equal(clean.massProfile,profile);
  }
 console.log('Mass profiles: canonical areas, room/core/furniture containment, height, saved inputs, IFC and actual Manifold WASM solids passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
