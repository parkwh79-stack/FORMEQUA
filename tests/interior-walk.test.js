"use strict";
// Navigation behaviour: speed, continuous collision checks, real generated doorways,
// and distance-based gait. No WebGL renderer or mirrored DOM assertions required.
const assert = require("node:assert/strict");
const walk = require("../interior-walk.js");
const { generate } = require("../interior-plan.js");
const empty = () => ({ bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, cores: [], voids: [], furniture: [], walls: [] });
const approx = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-8, label || `${a} ≈ ${b}`);

const straight = walk.direction(0, 1, 0, 2.8), diagonal = walk.direction(0, 1, 1, 2.8);
approx(Math.hypot(straight.x, straight.z), 2.8);
approx(Math.hypot(diagonal.x, diagonal.z), 2.8, "diagonal walking has the same speed");
assert.ok(straight.z < 0, "north-facing forward movement follows the camera");
approx(walk.direction(Math.PI / 2, 1, 0, 2).x, 2, "turning right changes forward travel");
assert.deepEqual(walk.direction(0, 0, 0, 100), { x: 0, z: 0 });

for (const obstacle of ["wall", "core", "void", "furniture"]) {
  const plan = empty();
  if (obstacle === "wall") plan.walls.push({ x1: 0, x2: 0, z1: -10, z2: 10, thickness: .08 });
  if (obstacle === "core") plan.cores.push({ minX: -.1, maxX: .1, minZ: -10, maxZ: 10 });
  if (obstacle === "void") plan.voids.push({ minX: -.1, maxX: .1, minZ: -10, maxZ: 10 });
  if (obstacle === "furniture") plan.furniture.push({ x: 0, z: 0, width: .1, depth: 20 });
  const end = walk.move(plan, { x: -4, z: 0 }, { x: 8, z: 0 });
  assert.ok(end.x < -.25, `a long wheel/fast step cannot tunnel through a thin ${obstacle}`);
  assert.ok(end.travelled > 3 && end.travelled < 4, `travel counts actual movement up to ${obstacle}`);
  assert.ok(walk.canStand(plan, end.x, end.z), `stops clear of ${obstacle}`);
}
const edge = walk.move(empty(), { x: 0, z: 0 }, { x: 15, z: 15 });
assert.ok(edge.x < 9.8 && edge.z < 9.8, "a diagonal sweep cannot walk off the floor");
const slidePlan = empty();
slidePlan.walls.push({ x1: 0, x2: 0, z1: -10, z2: 10, thickness: .12 });
const slide = walk.move(slidePlan, { x: -1, z: -3 }, { x: 3, z: 4 });
assert.ok(slide.x < -.27 && slide.z > .9, "walking diagonally along a wall slides without crossing it");

const rotated = empty();
rotated.furniture.push({ x: 0, z: 0, width: 4, depth: .8, rotationY: Math.PI / 2 });
assert.equal(walk.canStand(rotated, 0, 1.5), false, "rotated furniture blocks its visible footprint");
assert.equal(walk.canStand(rotated, 1.5, 0), true, "rotation does not leave an invisible broad obstacle");

const doorPlan = empty();
doorPlan.walls.push({ x1: 0, x2: 0, z1: -10, z2: -.6 }, { x1: 0, x2: 0, z1: .6, z2: 10 });
approx(walk.move(doorPlan, { x: -2, z: 0 }, { x: 4, z: 0 }).x, 2, "real doorway gap remains passable");
const actual = generate({ level: 3, use: "main", widthM: 30, depthM: 24, northShiftM: 0, hasAtrium: false, zBottom: 8, zTop: 12 }, { coreType: "north", option: "A" });
assert.ok(walk.canStand(actual, actual.entry.x, actual.entry.z), "generated corridor entry is walkable");
let crossedDoors = 0;
for (const door of actual.doors) {
  // A short sweep through each opening tests the generated wall/door contract.
  const start = { x: door.x + (door.axis === "z" ? -.35 : 0), z: door.z + (door.axis === "x" ? -.35 : 0) };
  const finish = { x: door.x + (door.axis === "z" ? .35 : 0), z: door.z + (door.axis === "x" ? .35 : 0) };
  if (!walk.canStand(actual, start.x, start.z) || !walk.canStand(actual, finish.x, finish.z)) continue;
  const end = walk.move(actual, start, { x: finish.x - start.x, z: finish.z - start.z });
  approx(end.x, finish.x); approx(end.z, finish.z); crossedDoors++;
}
assert.ok(crossedDoors > 0, "at least one actual generated room is reachable from its corridor");

approx(walk.wheelDistance(-100), 1.2, "typical wheel notch advances 1.2 m");
approx(walk.wheelDistance(-100, 1), 2.4, "large line-wheel events are capped");
approx(walk.wheelDistance(1e6, 2), -2.4, "large page-wheel events are capped");
assert.ok(walk.wheelDistance(-1) > 0 && walk.wheelDistance(-1) < .02, "trackpad micro-movements remain smooth");
let total = 0;
for (let i = 0; i < 60; i++) total += 2.8 / 60;
approx(walk.gaitOffset(total), walk.gaitOffset(2.8), "gait is based on travel, independent of frame count");
assert.ok(Math.abs(walk.gaitOffset(123.45)) <= .012, "eye movement stays gentle");
console.log(`Interior walk passed: continuous obstacles, normalized motion, ${crossedDoors} actual doorways, wheel units, and distance-based gait.`);
