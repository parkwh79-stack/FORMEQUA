"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const core = require("../core-layout.js"), interior = require("../interior-plan.js"), finance = require("../finance-model.js");
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.000002, `${a} vs ${b}`);
const overlaps = (a, b) => a.minX < b.maxX - 1e-6 && a.maxX > b.minX + 1e-6 && a.minZ < b.maxZ - 1e-6 && a.maxZ > b.minZ + 1e-6;
const floors = [
  { level: 1, use: "retail", widthM: 14, depthM: 16, northShiftM: 0, zBottom: 0, zTop: 3.6 },
  { level: 2, use: "main", widthM: 12, depthM: 14, northShiftM: 1, zBottom: 3.6, zTop: 7.2 }
];
for (const coreType of ["center", "north", "split"]) {
  const compact = core.planCore({ floorPlates: floors, circulationProfile: "compact", coreType });
  assert.equal(compact.status, "reserved");
  assert.equal(compact.circulation.profile, "compact");
  assert.equal(compact.circulation.label, "계단·출입 예약");
  assert.equal(compact.circulation.elevatorIncluded, false);
  assert.equal(compact.circulation.elevatorRequired, null, "a compact reservation is no elevator-law exemption");
  assert.equal(compact.circulation.stairCount, null, "reserved rectangles do not assert statutory stair quantities");
  assert.equal(compact.circulation.entranceVerified, false); assert.equal(compact.circulation.egressVerified, false);
  assert.equal(compact.isPermitConfirmation, false);
  assert.match(compact.assumptions.join(" "), /법정 최소/);
  assert.match(compact.assumptions.join(" "), /면제를 뜻하지/);
  for (const reservation of compact.cores) { near(reservation.maxX-reservation.minX, 2.4); near(reservation.maxZ-reservation.minZ, 3.6); }
  for (const fp of floors) {
    assert.equal(core.validateForFloor(compact, fp).valid, true);
    const plan = interior.generate(fp, { coreLayout: compact });
    assert.deepEqual(plan.cores, compact.cores);
    assert.equal(plan.circulation.profile, "compact");
    assert.equal(plan.status, "generated");
    for (const reservation of plan.cores) for (const r of [...plan.rooms, ...plan.voids, ...plan.corridors]) assert.equal(overlaps(reservation,r),false);
  }
  const moved = core.planCore({ floorPlates: floors.map(fp=>({...fp,northShiftM:fp.northShiftM+9.25})), circulationProfile: {profile:"compact"}, coreType });
  moved.cores.forEach((r,i)=>{near(r.minZ-compact.cores[i].minZ,9.25);near(r.maxZ-compact.cores[i].maxZ,9.25);near(r.minX,compact.cores[i].minX);});
}
const standard = core.planCore({ floorPlates: floors });
assert.equal(standard.circulation.profile, "standard", "older callers keep their original geometry policy");
const compact = core.planCore({ floorPlates: floors, circulationProfile: "compact" });
assert.ok(compact.metrics.coreAreaSqm < standard.metrics.coreAreaSqm, "compact planning is distinct from a larger service/core reservation");
for (const input of [
  { widthM: 4, depthM: 4 },
  { widthM: 12, depthM: 10, hasAtrium: true, coreType: "north" },
  { floorPlates: [floors[0], {...floors[1],northShiftM:100}] }
]) {
  const failed = core.planCore({ ...input, circulationProfile: "compact" });
  assert.equal(failed.status, "unfeasible"); assert.equal(failed.cores.length, 0);
  assert.equal(failed.circulation.status, "unfeasible"); assert.ok(failed.warnings.length);
}
const notRequested = core.planCore({ floorPlates: floors, detailLevel: "massing", circulationProfile: "compact" });
assert.equal(notRequested.status, "not-requested"); assert.equal(notRequested.reason, "massing-only");
assert.equal(notRequested.metrics, null); assert.deepEqual(notRequested.cores, []);
assert.equal(notRequested.circulation.status, "not-reviewed");
assert.equal(core.validateForFloor(notRequested, floors[0]).status, "not-requested");

function assertNotGenerated(plan) {
  assert.equal(plan.status, "not-generated"); assert.equal(plan.reason, "massing-only");
  assert.equal(plan.quantityStatus, "not-generated"); assert.equal(plan.detailLevel, "massing");
  assert.equal(plan.metrics, null, "not-generated quantities must never look like a confirmed zero count");
  assert.equal(plan.entry, null, "no invented interior entry position");
  for (const name of ["rooms","cores","voids","corridors","walls","doors","furniture","dwellingUnits"]) assert.deepEqual(plan[name],[]);
  assert.match(plan.warnings.join(" "), /실내 평면과 수량을 생성하지/);
}
const snapshot = JSON.stringify(compact);
const conceptual = interior.generate(floors[1], { coreLayout: compact, detailLevel: "concept" });
assertNotGenerated(interior.generate(floors[1], { coreLayout: compact, detailLevel: "massing" }));
assertNotGenerated(interior.generate({ ...floors[1], coreLayout: notRequested }));
assert.equal(JSON.stringify(compact), snapshot, "display detail does not erase the calculation core");
assert.deepEqual(interior.generate(floors[1], { coreLayout: compact, detailLevel: "concept" }), conceptual,
  "returning to concept mode restores the same deterministic room quantities");
const standalone = interior.generate(floors[1], { circulationProfile: "compact" });
assert.equal(standalone.circulation.profile, "compact");
standalone.cores.forEach(r=>{near(r.maxX-r.minX,2.4);near(r.maxZ-r.minZ,3.6);});

// Hotel finance uses the calculation planner without the display-only option.
// A UI request to skip the interior must not mutate its shared core or revenue.
const hotelFp = {level:2,use:"hotel",widthM:24,depthM:20,northShiftM:0,zBottom:3.6,zTop:7.2,areaSqm:480};
const hotelCore = core.planCore({...hotelFp,circulationProfile:"compact",coreType:"north"});
const financeInputs = {...finance.defaults,financeMode:"hotel",buildingUse:"숙박시설(호텔)",hotelRoomsOverride:0};
const hotelFloors = [{...hotelFp,coreLayout:hotelCore}];
const before = finance.calculate(financeInputs,hotelFloors,{planner:interior});
assert.ok(before.hotel.generatedGuestRooms>0);
assertNotGenerated(interior.generate(hotelFloors[0],{detailLevel:"massing"}));
assert.deepEqual(finance.calculate(financeInputs,hotelFloors,{planner:interior}),before,"massing-only UI generation does not alter hotel calculation");

const browser = {window:{}};
for(const name of ["core-layout.js","interior-plan.js"])vm.runInNewContext(fs.readFileSync(path.join(__dirname,"..",name),"utf8"),browser);
const browserCore=browser.window.AtelierCoreLayout.planCore({floorPlates:floors,circulationProfile:"compact"});
assert.deepEqual(JSON.parse(JSON.stringify(browserCore)),compact);
assertNotGenerated(JSON.parse(JSON.stringify(browser.window.AtelierInteriorPlan.generate(floors[0],{coreLayout:browserCore,detailLevel:"massing"}))));
console.log("Core representation: explicit massing omission, nullable ungenerated quantities, compact fixed circulation reservations, no legal exemption, containment and unchanged calculation/finance passed");
