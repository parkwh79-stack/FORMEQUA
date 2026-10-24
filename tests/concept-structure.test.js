"use strict";
const assert=require("node:assert/strict"),structure=require("../concept-structure");
const floors=[{level:1,widthM:30,depthM:24,northShiftM:0,zBottom:0,zTop:4},
 {level:2,widthM:21,depthM:18,northShiftM:1,zBottom:4,zTop:8,hasAtrium:true},
 {level:3,widthM:18,depthM:14,northShiftM:2,zBottom:8,zTop:12,hasAtrium:true}];
const core={cores:[{id:"north",minX:-2,maxX:2,minZ:-4,maxZ:-1}]};
const s=structure.generate(floors,{coreLayout:core});assert.equal(s.status,"reference-only");
assert.equal(s.isStructuralDesign,false);assert.equal(s.memberSizesVerified,false);assert.equal(s.grid.isCodeRequirement,false);
assert.ok(s.columns.length>0);assert.ok(s.warnings.some(w=>/전이구조/.test(w)));
for(const col of s.columns){assert.equal(col.levels.length,3);for(const fp of floors){
 assert.ok(Math.abs(col.x)<=fp.widthM/2-1+1e-8);assert.ok(Math.abs(col.z-(fp.northShiftM||0))<=fp.depthM/2-1+1e-8);
 assert.ok(!fp.hasAtrium||Math.abs(col.x)>=fp.widthM*.175+.15||Math.abs(col.z-fp.northShiftM)>=fp.depthM*.175+.15);
}assert.ok(!core.cores.some(c=>col.x>=c.minX-.15&&col.x<=c.maxX+.15&&col.z>=c.minZ-.15&&col.z<=c.maxZ+.15));}
const small=structure.generate([{level:1,widthM:12,depthM:10,zBottom:0,zTop:3}],{profile:"compact"});
assert.equal(small.grid.targetSpacingM,4.5);assert.ok(small.grid.xSpacingM<=4.5);
assert.equal(structure.generate([]).status,"not-generated");
assert.equal(structure.generate([{widthM:NaN,depthM:10,zBottom:0,zTop:3}]).status,"not-generated");
console.log("Concept structure: continuous shared reference axes, true floor/void/core containment, scale-dependent illustrative grid and no engineered-member claims passed.");
