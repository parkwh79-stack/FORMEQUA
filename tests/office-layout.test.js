"use strict";

// Independent geometry checks for the original JS heuristic. These do not
// certify workplace access, evacuation compliance, or structural design.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const office = require("../office-layout.js");
const EPS = 0.00002;
const room = { id: "office-a", minX: 0, maxX: 18, minZ: 0, maxZ: 14 };
const door = { id: "entry", roomId: room.id, x: 8, z: 0, width: 1.1, axis: "x" };
const overlap = (a, b) => a.minX < b.maxX - EPS && a.maxX > b.minX + EPS && a.minZ < b.maxZ - EPS && a.maxZ > b.minZ + EPS;
const inside = (a, b) => a.minX >= b.minX - EPS && a.maxX <= b.maxX + EPS && a.minZ >= b.minZ - EPS && a.maxZ <= b.maxZ + EPS;
const box = f => ({ minX: f.x - f.width / 2, maxX: f.x + f.width / 2, minZ: f.z - f.depth / 2, maxZ: f.z + f.depth / 2 });
const contact = (a, b, min = EPS) => {
  const x = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX), z = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  return x >= min - EPS && z >= -EPS || z >= min - EPS && x >= -EPS;
};
const close = (a, b, why) => assert.ok(Math.abs(a - b) <= EPS, why + ": " + a + " vs " + b);
const run = (options = {}, extra = {}) => office.generate({ rooms: [room], doors: [door], options, ...extra });

function validateGeometry(result) {
  const ids = new Set();
  for (const r of result.rooms) {
    const inflated = r.obstacles.map(b => ({ minX: b.minX - .1, maxX: b.maxX + .1, minZ: b.minZ - .1, maxZ: b.maxZ + .1 }));
    for (const aisle of r.aisles) {
      assert.ok(inside(aisle, r.bounds), "aisle inside room inset");
      assert.ok(Math.min(aisle.maxX - aisle.minX, aisle.maxZ - aisle.minZ) >= r.settings.aisleWidthM - EPS, "aisle fragments retain requested width");
      assert.ok(!inflated.some(b => overlap(aisle, b)), "aisle avoids explicit obstacles plus reserve");
    }
    // Reconstruct the reachable rectangle network from the returned geometry.
    const reachable = new Set();
    for (const d of r.doorClearances) {
      if (!inflated.some(b => overlap(d, b))) r.aisles.forEach((a, i) => { if (contact(a, d)) reachable.add(i); });
    }
    if (!r.doorClearances.length && r.aisles.length) reachable.add(0);
    const queue = [...reachable];
    for (let i = 0; i < queue.length; i++) r.aisles.forEach((a, n) => {
      if (!reachable.has(n) && contact(a, r.aisles[queue[i]], r.settings.aisleWidthM)) { reachable.add(n); queue.push(n); }
    });
    for (const w of r.workstations) {
      assert.ok(!ids.has(w.id), "workstation ids unique across rooms"); ids.add(w.id);
      assert.ok(inside(w.envelope, r.bounds) && inside(w.envelope, w.groupEnvelope), "station inside room and group envelope");
      for (const prohibited of [...inflated, ...r.doorClearances, ...r.aisles, ...r.collaboration]) assert.ok(!overlap(w.envelope, prohibited), "station reservation avoids routes/doors/obstacles/collaboration");
      assert.ok([...reachable].some(i => contact(w.groupEnvelope, r.aisles[i])), "group envelope reaches entry-connected aisle network");
      assert.equal(w.entryConnected, r.doorClearances.length ? true : null);
      assert.equal(w.accessBasis, "connected-group-envelope");
      assert.ok(inside(box(w.desk), w.envelope) && inside(box(w.chair), w.envelope), "desk and chair fit complete workstation reservation");
      assert.ok(!overlap(box(w.desk), box(w.chair)), "desk and chair do not overlap");
    }
    for (let i = 0; i < r.furniture.length; i++) {
      const f = r.furniture[i], b = box(f);
      assert.ok([f.x, f.z, f.width, f.depth, f.height].every(Number.isFinite), "finite physical furniture dimensions");
      assert.equal(f.rotationY, 0, "output dimensions are already oriented");
      assert.ok(inside(b, r.bounds), "physical furniture inside room");
      for (const p of [...inflated, ...r.doorClearances, ...r.aisles]) assert.ok(!overlap(b, p), "physical furniture clear of obstacles and routes");
      for (let j = i + 1; j < r.furniture.length; j++) assert.ok(!overlap(b, box(r.furniture[j])), "physical furniture pairs do not overlap");
    }
    for (let i = 0; i < r.collaboration.length; i++) {
      const c = r.collaboration[i];
      assert.ok(inside(c, r.bounds), "collaboration reservation inside room");
      assert.ok([...reachable].some(n => contact(c, r.aisles[n])), "collaboration reservation reaches aisle");
      for (const p of [...inflated, ...r.aisles, ...r.doorClearances, ...r.collaboration.slice(i + 1)]) assert.ok(!overlap(c, p), "collaboration reservation avoids other reserved geometry");
      assert.equal(r.furniture.filter(f => f.collaborationId === c.id && f.type === "chair").length, 4);
    }
    assert.equal(r.metrics.deskCount, r.furniture.filter(f => f.type === "desk").length);
    assert.equal(r.metrics.workstationCount, r.workstations.length);
    assert.equal(r.metrics.collaborationSeatCount, r.furniture.filter(f => f.collaborationId && f.type === "chair").length);
    close(r.metrics.collaborationAreaSqm, r.collaboration.reduce((n, c) => n + (c.maxX - c.minX) * (c.maxZ - c.minZ), 0), "actual collaboration area");
    assert.equal(r.validation.evacuationComplianceVerified, false);
    assert.equal(r.validation.structuralColumnsVerified, false);
    assert.equal(r.isPermitConfirmation, false);
  }
  assert.equal(result.metrics.deskCount, result.furniture.filter(f => f.type === "desk").length);
  assert.equal(result.metrics.workstationCount, result.workstations.length);
  assert.equal(result.provenance.upstreamEngineExecuted, false);
  assert.equal(result.provenance.upstreamCodeOrAssetsBundled, false);
  assert.equal(result.isOptimal, false);
}

// Actual physical geometry, not a desk count formula, drives all four types.
for (const deskType of ["single", "back-to-back", "bench", "standing"]) {
  const fixed = [];
  for (const orientation of [0, 90]) {
    const result = run({ deskType, orientation, collaborationPct: 10 });
    assert.ok(result.metrics.workstationCount > 0, "feasible fixture: " + deskType + "/" + orientation);
    assert.equal(result.rooms[0].orientationDeg, orientation);
    assert.equal(result.status, "generated");
    assert.ok(result.metrics.collaborationAreaSqm > 0, "requested collaboration has actual geometry");
    assert.equal(result.metrics.collaborationDeficitSqm, 0);
    assert.ok(result.workstations.every(w => w.desk.height === (deskType === "standing" ? 1.05 : .74)));
    const clusterCounts = Object.values(result.workstations.reduce((counts, w) => { counts[w.clusterId] = (counts[w.clusterId] || 0) + 1; return counts; }, {}));
    assert.ok(clusterCounts.every(n => n === (deskType === "bench" ? 4 : deskType === "back-to-back" ? 2 : 1)), "untrimmed paired/bench groups are complete");
    validateGeometry(result); fixed.push(result);
  }
  const automatic = run({ deskType, orientation: "auto", collaborationPct: 10 });
  assert.ok(automatic.metrics.workstationCount >= Math.max(...fixed.map(r => r.metrics.workstationCount)), "auto compares both fixed orientations after collaboration objective");
  assert.deepEqual(automatic, run({ deskType, orientation: "auto", collaborationPct: 10 }), "deterministic candidate selection");
  validateGeometry(automatic);
}

const base = run();
assert.ok(run({ aisleWidthM: 2.4 }).metrics.workstationCount < base.metrics.workstationCount, "wider aisles reduce feasible seats");
assert.ok(run({ backClearanceM: 1.8 }).metrics.workstationCount < base.metrics.workstationCount, "rear allowance reduces feasible seats");
const custom = run({ deskWidthM: 2, deskDepthM: 1, orientation: "90" });
for (const w of custom.workstations) { close(w.desk.width, 1, "rotated physical width"); close(w.desk.depth, 2, "rotated physical depth"); }
validateGeometry(custom);

// Confirmed/design obstacles constrain layout; reference render columns never do.
const column = { id: "survey-column", minX: 5, maxX: 9, minZ: 4, maxZ: 8, kind: "explicit-column", confirmed: true };
const obstructed = run({}, { obstacles: [column] });
assert.ok(obstructed.metrics.workstationCount < base.metrics.workstationCount);
assert.equal(obstructed.rooms[0].obstacles[0].id, column.id);
validateGeometry(obstructed);
for (const flag of [{ referenceOnly: true }, { isReference: true }, { confirmed: false }, { source: "reference" }]) {
  const result = run({}, { obstacles: [{ ...column, ...flag }] });
  assert.equal(result.metrics.workstationCount, base.metrics.workstationCount);
  assert.equal(result.rooms[0].obstacles.length, 0);
  assert.ok(result.warnings.some(w => w.includes("참고·미확인")));
}
assert.equal(base.rooms[0].obstacles.length, 0, "no guessed structural grid");

const blockedEntry = run({}, { obstacles: [{ minX: 6, maxX: 10, minZ: 0, maxZ: 2 }] });
assert.equal(blockedEntry.status, "unfeasible");
assert.equal(blockedEntry.metrics.workstationCount, 0, "a door-blocked room cannot claim entry-connected seating");
const noDoors = run({}, { doors: [] });
assert.ok(noDoors.metrics.workstationCount > 0);
assert.ok(noDoors.workstations.every(w => w.entryConnected === null));
assert.equal(noDoors.rooms[0].validation.rectangularAisleConnectivityChecked, false);
assert.ok(noDoors.warnings.some(w => w.includes("실제 출입 연결은 미확인")));
validateGeometry(noDoors);
const offBoundary = run({}, { doors: [{ ...door, z: 2 }] });
assert.ok(offBoundary.warnings.some(w => w.includes("실 경계에 맞지 않는")));
assert.ok(offBoundary.workstations.every(w => w.entryConnected === null));

// Percentages are actual reserved tile areas, with explicit shortfall if unfit.
const collaboration = run({ collaborationPct: 30 });
assert.ok(collaboration.metrics.workstationCount < base.metrics.workstationCount);
assert.ok(collaboration.rooms[0].metrics.achievedCollaborationPct >= 30);
validateGeometry(collaboration);
const deficit = run({ collaborationPct: 40 });
assert.equal(deficit.status, "partial");
assert.ok(deficit.metrics.collaborationDeficitSqm > 0);
assert.ok(deficit.warnings.some(w => w.includes("협업 공간 비중")));
validateGeometry(deficit);

const targeted = run({ targetSeats: 7, deskType: "bench" });
assert.equal(targeted.metrics.workstationCount, 7, "a target caps occupied desk positions, even within a bench reservation");
assert.equal(targeted.metrics.targetDeficit, 0);
assert.ok(targeted.rooms[0].metrics.capacityBeforeTarget > 7);
validateGeometry(targeted);
const impossible = run({ targetSeats: 1000 });
assert.equal(impossible.status, "partial");
assert.equal(impossible.metrics.targetDeficit, 1000 - impossible.metrics.workstationCount);

// A global target is shared, not repeated for each room. Per-room settings win.
const other = { ...room, id: "office-b", minX: 22, maxX: 40 };
const multiInput = { rooms: [room, other], doors: [door, { ...door, roomId: other.id, x: door.x + 22 }],
  options: { targetSeats: 12 }, roomRequirements: { "office-b": { deskType: "standing", orientation: 90, deskWidthM: 1.8, targetSeats: 4 } } };
const multi = office.generate(multiInput);
assert.equal(multi.metrics.workstationCount, 12);
assert.equal(multi.rooms[1].metrics.workstationCount, 4);
assert.equal(multi.rooms[1].orientationDeg, 90);
assert.ok(multi.rooms[1].workstations.every(w => w.deskType === "standing" && w.desk.height === 1.05));
assert.equal(multi.rooms[0].metrics.workstationCount, 8);
validateGeometry(multi);
const conflicts = office.generate({ ...multiInput, options: { targetSeats: 5 }, roomRequirements: { "office-a": { targetSeats: 4 }, "office-b": { targetSeats: 4 } } });
assert.equal(conflicts.metrics.workstationCount, 5);
assert.equal(conflicts.rooms[1].metrics.targetDeficit, 3);
assert.equal(conflicts.status, "partial");
assert.ok(conflicts.warnings.some(w => w.includes("실별 목표 좌석 합계")));

// Coordinate origin changes cannot change the chosen layout or seat quantities.
const translate = (r, dx, dz) => ({ ...r, minX: r.minX + dx, maxX: r.maxX + dx, minZ: r.minZ + dz, maxZ: r.maxZ + dz });
const fixture = { rooms: [room], doors: [door], obstacles: [column], options: { deskType: "bench", collaborationPct: 10 } };
const snapshot = JSON.stringify(fixture), original = office.generate(fixture), dx = -137.875, dz = 89.25;
const translated = office.generate({ ...fixture, rooms: [translate(room, dx, dz)], doors: [{ ...door, x: door.x + dx, z: door.z + dz }], obstacles: [translate(column, dx, dz)] });
assert.equal(JSON.stringify(fixture), snapshot, "source room, doors, and obstacles are not mutated");
assert.deepEqual(translated.metrics, original.metrics);
assert.equal(translated.rooms[0].orientationDeg, original.rooms[0].orientationDeg);
translated.furniture.forEach((f, i) => { close(f.x, original.furniture[i].x + dx, "translated x"); close(f.z, original.furniture[i].z + dz, "translated z"); });
validateGeometry(translated);

for (const [key, value] of [["deskWidthM", NaN], ["deskDepthM", .2], ["aisleWidthM", Infinity], ["backClearanceM", .5], ["rowGapM", 2.1], ["targetSeats", 2.5], ["targetSeats", 1001], ["collaborationPct", 41], ["orientation", 45], ["deskType", "unknown"]]) assert.throws(() => run({ [key]: value }), /Office layout/);
assert.throws(() => office.generate({ rooms: [null] }), /Office layout/);
assert.throws(() => office.generate({ rooms: [room, room] }), /room ids must not repeat/);
assert.throws(() => run({}, { obstacles: [{ ...column, minX: NaN }] }), /obstacle bounds/);
assert.throws(() => run({}, { roomRequirements: [] }), /roomRequirements/);
assert.throws(() => run({}, { roomRequirements: { "office-a": { targetSeats: NaN } } }), /targetSeats/);
const tiny = office.generate({ rooms: [{ id: "tiny", minX: 0, maxX: 2, minZ: 0, maxZ: 2 }] });
assert.equal(tiny.status, "unfeasible");
assert.equal(tiny.metrics.workstationCount, 0);
assert.throws(() => run({}, { roomRequirements: { "office-a": [] } }), /room requirement/);

// Four door sides, varied small/large rooms, both orientations, obstructions,
// and minimum/maximum dimensions exercise actual exported geometry together.
for (let i = 0; i < 32; i++) {
  const w = 5 + i % 8 * 2.1, d = 4.8 + i % 5 * 2.3;
  const r = { id: "varied-" + i, minX: -w / 2, maxX: w / 2, minZ: -d / 2, maxZ: d / 2 };
  const side = i % 4;
  const entry = { roomId: r.id, width: .95, axis: side < 2 ? "x" : "z",
    x: side < 2 ? -.5 : side === 2 ? r.minX : r.maxX, z: side < 2 ? side === 0 ? r.minZ : r.maxZ : .5 };
  const varied = office.generate({ rooms: [r], doors: [entry],
    obstacles: i % 3 ? [] : [{ minX: -.35, maxX: .35, minZ: -.35, maxZ: .35 }],
    options: { deskType: ["single", "back-to-back", "bench", "standing"][i % 4], orientation: i % 2 ? 0 : 90,
      deskDepthM: i % 3 ? .7 : 1, backClearanceM: i % 3 ? .9 : .6, collaborationPct: i % 5 ? 0 : 10,
      aisleWidthM: i % 3 ? 1.2 : .9 } });
  validateGeometry(varied);
}

// Browser API uses no DOM, THREE, Node or external packages.
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../office-layout.js"), "utf8"), context);
assert.equal(typeof context.window.AtelierOfficeLayout.generate, "function");
assert.deepEqual(JSON.parse(JSON.stringify(context.window.AtelierOfficeLayout.generate({ rooms: [room], doors: [door] }))), base);
assert.ok(Object.isFrozen(office));
console.log("office-layout: physical geometry, desk types, routes/obstacles, collaboration, targets, room overrides, coordinates and browser API passed");
