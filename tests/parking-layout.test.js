"use strict";
const assert = require("node:assert/strict");
const layout = require("../parking-layout.js");
const { summarize, planSvg } = require("../parking-review.js");
const { generate: interior } = require("../interior-plan.js");
const EPS = 1e-6;
// Independent geometric assertions: a positive count must correspond to every
// actual stall, with the complete reserved circulation and obstacles still there.
function checkGeometry(plan) {
  assert.equal(plan.capacityCount, plan.levels.reduce((n, level) => n + level.spaces.length, 0));
  assert.equal(plan.capacityVerified, false, "concept geometry never confirms physical/legal capacity");
  assert.equal(plan.massFitEligible, plan.capacityCount > 0 && plan.levels.every(level => level.validation.valid));
  assert.equal(plan.validation.massFitEligible, plan.massFitEligible);
  assert.equal(plan.validation.capacityVerified, false);
  assert.equal(plan.status, plan.massFitEligible ? "generated" : "incomplete");
  assert.equal(plan.statusLabel, plan.massFitEligible ? "배치 생성" : "배치 미완료");
  const overlap = (a, b) => Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > EPS && Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > EPS;
  for (const level of plan.levels) {
    assert.equal(level.validation.valid, true, JSON.stringify(level.validation.errors));
    assert.equal(layout.validate(level).valid, true);
    assert.equal(level.ramps.length, 1);
    assert.ok(level.aisles.some(a => a.id === "bypass"));
    assert.ok(level.aisles.some(a => a.id === "landing-front"));
    assert.ok(level.aisles.some(a => a.id === "landing-back"));
    const obstacles = [...level.cores, ...level.columns, ...level.aisles, ...level.ramps];
    for (const space of level.spaces) {
      assert.ok(space.minX >= level.bounds.minX - EPS && space.maxX <= level.bounds.maxX + EPS);
      assert.ok(space.minZ >= level.bounds.minZ - EPS && space.maxZ <= level.bounds.maxZ + EPS);
      assert.ok(obstacles.every(obstacle => !overlap(space, obstacle)), space.id + " collides");
      assert.ok(level.spaces.filter(other => other !== space).every(other => !overlap(space, other)));
      const aisle = level.aisles.find(item => item.id === space.aisleId); assert.ok(aisle);
      const frontTouches = space.orientation === "z" ? Math.abs(space.minZ - aisle.maxZ) < EPS || Math.abs(space.maxZ - aisle.minZ) < EPS : Math.abs(space.minX - aisle.maxX) < EPS || Math.abs(space.maxX - aisle.minX) < EPS;
      assert.ok(frontTouches, space.id + " has no short-side aisle frontage");
      const size = space.orientation === "z" ? [space.maxX - space.minX, space.maxZ - space.minZ] : [space.maxZ - space.minZ, space.maxX - space.minX];
      assert.ok(size[0] >= (space.type === "accessible_reserved" ? 3.3 : 2.6) - EPS); assert.ok(size[1] >= 5.2 - EPS);
    }
    const svg = planSvg(level); assert.ok(svg.includes("CORE")); assert.ok(svg.includes("15%")); assert.ok(!/NaN|undefined|Infinity/.test(svg));
    assert.equal((svg.match(/<rect/g) || []).length, level.spaces.length + level.aisles.length + level.ramps.length + level.cores.length + level.columns.length + 2);
  }
}
let models = 0;
for (const widthM of [20, 30, 35, 40, 45, 60, 80]) for (const depthM of [20, 30, 40, 50, 65, 80]) for (const coreType of ["center", "north", "split"]) {
  const plan = layout.generate({ widthM, depthM, floorsBelow: 3, coreType }); checkGeometry(plan); models++;
  assert.equal(plan.isPermitConfirmation, false); assert.ok(plan.sources[0].url.startsWith("https://www.law.go.kr/"));
}
const good = layout.generate({ widthM: 45, depthM: 50, floorsBelow: 4 }); assert.ok(good.capacityCount > 0); assert.ok(good.reserved.accessibleCount > 0); assert.ok(good.reserved.evCount > 0);
const rotated = layout.generate({ widthM: 50, depthM: 45, floorsBelow: 4 }); assert.equal(good.capacityCount, rotated.capacityCount); checkGeometry(rotated);
for (const [widthM, depthM] of [[45, 50], [50, 45]]) {
  const north = layout.generate({ widthM, depthM, floorsBelow: 1, coreType: "north" });
  assert.ok(north.capacityCount > 0); assert.ok(Math.abs(north.levels[0].cores[0].minZ - (-depthM / 2 + .5)) < EPS, "north core must preserve negative world Z after module rotation");
}
const split = layout.generate({ widthM: 60, depthM: 45, floorsBelow: 1, coreType: "split" }); assert.ok(split.capacityCount > 0); assert.equal(split.levels[0].cores.length, 2); checkGeometry(split);
const narrow = layout.generate({ widthM: 20, depthM: 20, floorsBelow: 7 }); assert.equal(narrow.capacityCount, 0); assert.equal(narrow.levels.length, 0); assert.match(narrow.warnings[0], /램프/);
const coreConflict = layout.generate({ widthM: 30, depthM: 40, floorsBelow: 4 }); assert.equal(coreConflict.capacityCount, 0); assert.match(coreConflict.warnings[0], /코어.*충돌/);
const oversizedCore = layout.generate({ widthM: 45, depthM: 50, floorsBelow: 2, coreWidthM: 80 }); assert.equal(oversizedCore.capacityCount, 0);
for (const input of [{ widthM: NaN, depthM: 50, floorsBelow: 2 }, { widthM: 50, depthM: 50, floorsBelow: 2.5 }, { widthM: 50, depthM: 50, floorsBelow: -1 }]) assert.equal(layout.generate(input).capacityCount, 0);
assert.equal(layout.generate({ widthM: 50, depthM: 50, floorsBelow: 0 }).capacityCount, 0);
// Shared cores are exact basement-centred reservations, not suggestions that
// the parking generator can shrink, move, or replace with its legacy 8x8 core.
function assertSharedCores(plan, sourceCores) {
  assert.equal(plan.coreSource, "shared");
  assert.ok(plan.massFitEligible);
  checkGeometry(plan);
  for (const level of plan.levels) {
    assert.equal(level.cores.length, sourceCores.length);
    for (const sourceCore of sourceCores) {
      const actual = level.cores.find(core => core.id === sourceCore.id);
      assert.ok(actual, sourceCore.id + " lost its stable identity");
      for (const key of ["minX", "maxX", "minZ", "maxZ"]) assert.ok(Math.abs(actual[key] - sourceCore[key]) < EPS, key + " changed");
    }
  }
}
const fixedCore = Object.freeze({ id: "core-main", minX: -1.4, maxX: 1.4, minZ: -2.2, maxZ: 2.2 });
const fixedCores = Object.freeze([fixedCore]);
for (const [widthM, depthM] of [[45, 60], [60, 45]]) for (const coreType of ["center", "north", "split"]) {
  const shared = layout.generate({ widthM, depthM, floorsBelow: 3, coreType, coreRects: fixedCores, coreWidthM: 80, coreDepthM: 80 });
  assertSharedCores(shared, fixedCores);
  assert.equal(shared.levels[0].cores.length, 1, "legacy split/core sizes must not replace shared cores");
}
// An obstruction at the old ramp position can be avoided at the opposite
// perimeter without mirroring the actual shared core to the other side.
for (const input of [
  { widthM: 45, depthM: 60, coreRects: [{ id: "core-west", minX: -21, maxX: -13, minZ: -4, maxZ: 4 }] },
  { widthM: 60, depthM: 45, coreRects: [{ id: "core-north", minX: -4, maxX: 4, minZ: -21, maxZ: -13 }] }
]) {
  const snapshot = JSON.stringify(input), shared = layout.generate({ ...input, floorsBelow: 2, coreType: "center" });
  assertSharedCores(shared, input.coreRects);
  assert.equal(shared.dimensions.mirrored, true);
  assert.ok(input.widthM < input.depthM ? shared.levels[0].ramps[0].minX > 0 : shared.levels[0].ramps[0].minZ > 0);
  assert.equal(JSON.stringify(input), snapshot);
}
// A longitudinal ramp candidate can clear fixed obstacles on both sides.
const longitudinalCores = [
  { id: "core-west", minX: -21, maxX: -17, minZ: -10, maxZ: -6 },
  { id: "core-east", minX: 17, maxX: 21, minZ: -10, maxZ: -6 }
];
const longitudinal = layout.generate({ widthM: 45, depthM: 80, floorsBelow: 2, coreRects: longitudinalCores });
assertSharedCores(longitudinal, longitudinalCores); assert.ok(longitudinal.dimensions.rampOffsetM > 0);
for (const coreRects of [null, {}, [null], [{ minX: 0, maxX: 0, minZ: 0, maxZ: 3 }], [{ minX: NaN, maxX: 3, minZ: 0, maxZ: 3 }], Array(33).fill(fixedCore)]) {
  const bad = layout.generate({ widthM: 45, depthM: 60, floorsBelow: 2, coreRects });
  assert.equal(bad.failureReason, "invalid-core"); checkGeometry(bad); assert.equal(bad.validation.valid, false);
}
const outsideShared = layout.generate({ widthM: 45, depthM: 60, floorsBelow: 2, coreRects: [{ id: "outside", minX: -30, maxX: -25, minZ: 0, maxZ: 4 }] });
assert.equal(outsideShared.failureReason, "core-outside"); checkGeometry(outsideShared);
const blockedShared = layout.generate({ widthM: 22.501595169925817, depthM: 67.50478550977745, floorsBelow: 5,
  coreRects: [{ id: "fixed-center", minX: -4, maxX: 4, minZ: -4, maxZ: 4 }] });
assert.equal(blockedShared.failureReason, "core-circulation"); assert.equal(blockedShared.massFitEligible, false); checkGeometry(blockedShared);
assert.equal(blockedShared.capacityVerified, false, "template failure must not be interpreted as confirmed zero capacity");
const noCore = layout.generate({ widthM: 45, depthM: 60, floorsBelow: 1, coreRects: [] });
assert.ok(noCore.massFitEligible); assert.equal(noCore.coreSource, "shared"); assert.equal(noCore.levels[0].cores.length, 0); assert.ok(noCore.warnings.some(text => /빈 배열/.test(text)));
assert.equal(layout.generate({ widthM: 45, depthM: 60, floorsBelow: 1 }).coreSource, "legacy-assumption");
// Corrupt separate parts of a valid plan: the validator must identify each
// failure, rather than merely returning the count the generator decided on.
const copy = () => JSON.parse(JSON.stringify(good.levels[0]));
let broken = copy(); broken.spaces[0].maxX = broken.bounds.maxX + 1; assert.equal(layout.validate(broken).valid, false);
broken = copy(); broken.cores.push({ ...broken.spaces[0], id: "collision-core" }); assert.equal(layout.validate(broken).valid, false);
broken = copy(); broken.spaces.push({ ...broken.spaces[0], id: "duplicate" }); assert.equal(layout.validate(broken).valid, false);
broken = copy(); broken.ramps[0].maxX += 20; assert.equal(layout.validate(broken).valid, false);
broken = copy(); broken.aisles = broken.aisles.filter(a => a.id !== "bypass"); assert.equal(layout.validate(broken).valid, false);
broken = copy(); broken.spaces[0].aisleId = "missing"; assert.equal(layout.validate(broken).valid, false);
broken = copy(); broken.ramps[0].riseM = 50; assert.equal(layout.validate(broken).valid, false);
broken = copy(); broken.aisles[0].maxZ = broken.aisles[0].minZ + 2; assert.equal(layout.validate(broken).valid, false);
// Interior counts use completed plan metrics, never substitute hotel rooms or
// co-living rooms for statutory dwelling units, and do not mutate the inputs.
const floors = ["main", "hotel", "residential"].map((use, index) => ({ level: index + 1, use, widthM: 35, depthM: 30, areaSqm: 1050, zBottom: index * 3.8, zTop: (index + 1) * 3.8 }));
const model = { floorPlates: floors, parking: { housingUnits: 77 } }, inputs = { coreType: "center", housingUnits: 77, housingUnitAreaSqm: 59, residentialType: "officetel" };
const cache = new Map(), q = summarize(model, inputs, interior, cache), count = cache.size;
assert.equal(q.statutoryUnits, 77); assert.equal(q.generatedFloors, 3); assert.ok(q.guestRoomCount > 0); assert.ok(q.dwellingUnitCount > 0); assert.ok(q.workstationCount > 0);
assert.equal(q.unitDifference, q.dwellingUnitCount - 77); assert.equal(inputs.housingUnits, 77);
assert.deepEqual(summarize(model, inputs, interior, cache), q); assert.equal(cache.size, count);
const living = summarize(model, { ...inputs, spaceProgram: "coliving" }, interior);
assert.equal(living.dwellingUnitCount, 0); assert.ok(living.privateRoomCount > 0); assert.equal(living.statutoryUnits, 77);
console.log(`parking layout: ${models} geometry cases, shared fixed cores, ramp candidates, failure status, rotation, collisions, disconnected paths and quantity comparisons passed`);
