"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const renderer = require("../study-renderer.js");
const snapshot = { summary: { program: "office", address: "PRIVATE ADDRESS", pnu: "PRIVATE PNU", finance: "PRIVATE FINANCE" },
  appearance: { palette: "bronze", secret: "PRIVATE KEY" }, geometryKey: "PRIVATE GEOGRAPHIC KEY", camera: { lat: 37, lng: 127 },
  plates: [
    { level: 1, width: 31, depth: 25, height: 4.5, y: 2.25, shiftX: -1, shiftZ: 2, courtyard: false, address: "PRIVATE FLOOR" },
    { level: 2, width: 23, depth: 19, height: 3.7, y: 6.35, shiftX: 0, shiftZ: 3, courtyard: true },
    { level: 3, width: 21, depth: 19, height: 3.7, y: 10.05, shiftX: 0, shiftZ: 4, courtyard: true }
  ] };
const plan = renderer.buildScenePlan(snapshot);
assert.equal(renderer.version, "architectural-axon-v3"); assert.equal(renderer.width, 1600); assert.equal(renderer.height, 1000);
assert.equal(plan.palette, "bronze"); assert.equal(plan.plates.length, 3);
assert.deepEqual(plan.bounds, { minX: -16.5, maxX: 14.5, minZ: -10.5, maxZ: 14.5, minY: 0, maxY: 11.9 });
assert.doesNotMatch(JSON.stringify(plan), /PRIVATE|"(?:pnu|address|finance|geometryKey|camera|lat|lng)":/);
const safeSource = { plates: snapshot.plates.map(p => ({ level: p.level, width: p.width, depth: p.depth, height: p.height, y: p.y, shiftX: p.shiftX, shiftZ: p.shiftZ, courtyard: p.courtyard })), summary: { program: "office" }, appearance: { palette: "bronze" } };
assert.deepEqual(plan, renderer.buildScenePlan(safeSource), "private fields cannot affect illustration or be retained");
assert.deepEqual(plan, renderer.buildScenePlan(snapshot), "same supplied geometry is deterministic");
assert.equal(renderer.buildScenePlan({ ...safeSource, appearance: { palette: "unknown" } }).palette, "limestone");
assert.ok(plan.boxes.filter(p => p.kind === "mullion").length > 100, "facade has physical window divisions rather than solid masses");
const frontPanes = plan.boxes.filter(p => p.level === 1 && p.kind === "glazing" && p.z > 14 && p.w > p.d);
assert.ok(frontPanes.length >= 10, "front facade has distinct panes, not one flat glazing strip");
assert.ok(new Set(frontPanes.map(p => p.material)).size >= 2, "adjacent panes retain muted tonal variation at card size");
const frontFrames = plan.boxes.filter(p => p.level === 1 && p.kind === "mullion" && p.z > 14 && p.w <= .25);
assert.ok(frontFrames.every(p => p.w >= .2), "commercial frames remain legible after thumbnail downscaling");
assert.ok(frontFrames.every(frame => frontPanes.every(pane => frame.z + frame.d / 2 - (pane.z + pane.d / 2) >= .15)), "surface frames project in front of recessed glazing");
assert.ok(plan.boxes.some(p => p.kind === "entrance")); assert.ok(plan.trees.length >= 3);
assert.equal(plan.boxes.filter(p => p.kind === "abstract-context").length, 3);
const eps = 1e-7;
for (const plate of plan.plates) {
  const pieces = plan.boxes.filter(p => p.level === plate.level && ["floor-band", "recessed-volume", "glazing", "mullion", "transom"].includes(p.kind));
  assert.ok(pieces.length > 15);
  for (const item of pieces) {
    assert.ok(item.x - item.w / 2 >= plate.shiftX - plate.width / 2 - eps && item.x + item.w / 2 <= plate.shiftX + plate.width / 2 + eps, `floor ${plate.level}: detail preserves width`);
    assert.ok(item.z - item.d / 2 >= plate.shiftZ - plate.depth / 2 - eps && item.z + item.d / 2 <= plate.shiftZ + plate.depth / 2 + eps, `floor ${plate.level}: detail preserves depth`);
    assert.ok(item.y - item.h / 2 >= plate.y - plate.height / 2 - eps && item.y + item.h / 2 <= plate.y + plate.height / 2 + eps, `floor ${plate.level}: detail preserves supplied height`);
    if (plate.courtyard) {
      const minX = plate.shiftX - plate.courtyardWidth / 2, maxX = plate.shiftX + plate.courtyardWidth / 2;
      const minZ = plate.shiftZ - plate.courtyardDepth / 2, maxZ = plate.shiftZ + plate.courtyardDepth / 2;
      assert.ok(item.x + item.w / 2 <= minX + eps || item.x - item.w / 2 >= maxX - eps || item.z + item.d / 2 <= minZ + eps || item.z - item.d / 2 >= maxZ - eps, `floor ${plate.level}: ${item.kind} leaves courtyard empty`);
    }
  }
}
// Large models are bounded in work and instance count; no detail may become NaN or negative.
const tower = renderer.buildScenePlan({ summary: { program: "hotel" }, plates: Array.from({ length: 100 }, (_, i) => ({ level: i + 1, width: 2000, depth: 2000, height: 4, y: 2 + i * 4, courtyard: true })) });
assert.equal(tower.plates.length, 100); assert.ok(tower.boxes.length <= tower.maxBoxes);
assert.equal(tower.boxes.filter(b => b.kind === "floor-band").length, 800, "detail cap never discards literal floor geometry");
for (const item of tower.boxes) {
  assert.ok([item.w, item.h, item.d, item.x, item.y, item.z].every(Number.isFinite)); assert.ok(Math.min(item.w, item.h, item.d) > 0);
}
const invalid = [null, {}, { plates: [] }, { plates: [snapshot.plates[0], snapshot.plates[0]] },
  ...[NaN, Infinity, 0, -1, 2001].map(width => ({ plates: [{ ...snapshot.plates[0], width }] })),
  { plates: Array.from({ length: 101 }, (_, i) => ({ ...snapshot.plates[0], level: i + 1 })) }];
for (const item of invalid) assert.throws(() => renderer.buildScenePlan(item), /STUDY_GEOMETRY_INVALID/);
assert.throws(() => renderer.capture({}, snapshot), /STUDY_WEBGL_UNAVAILABLE/);
const source = fs.readFileSync(path.join(__dirname, "../study-renderer.js"), "utf8");
assert.match(source, /new THREE\.WebGLRenderer/); assert.match(source, /new THREE\.OrthographicCamera/); assert.match(source, /renderer\.forceContextLoss/);
assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|querySelector|sessionStorage|localStorage|AtelierStudyPublicationSource|lastComputed|state\./);
console.log("study-renderer: detailed facades, literal floor bounds/courtyards, privacy and bounded deterministic illustration passed");
