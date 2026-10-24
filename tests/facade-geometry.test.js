"use strict";

// Run: node seoul-3d-web/tests/facade-geometry.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const geometry = require("../facade-geometry.js");
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} versus ${expected}`);
function extents(panel) {
  return panel.position.map((position, axis) => [position - panel.size[axis] / 2, position + panel.size[axis] / 2]);
}
function verifyPhysicalBand(study) {
  assert.ok(study.panels.length >= 4 && study.panels.length <= geometry.MAX_PANELS);
  assert.equal(study.metadata.panelCount, study.panels.length);
  const bounds = [[study.bounds.minX, study.bounds.maxX], [study.bounds.minY, study.bounds.maxY], [study.bounds.minZ, study.bounds.maxZ]];
  for (const panel of study.panels) {
    assert.ok(panel.size.every(size => Number.isFinite(size) && size > 0), "all physical dimensions are positive");
    assert.ok(panel.position.every(Number.isFinite), "all positions are finite");
    const box = extents(panel);
    box.forEach((edge, axis) => {
      assert.ok(edge[0] >= bounds[axis][0] - 1e-8 && edge[1] <= bounds[axis][1] + 1e-8, `${panel.face} remains inside the original legal envelope`);
    });
    close(panel.size[panel.face === "front" || panel.face === "back" ? 2 : 0], study.metadata.thicknessM, "panel retains the actual specified thickness");
    close(panel.size[1], study.metadata.panelHeightM, "panel retains the band height after horizontal joint allowance");
  }
  // AABB intersection is checked across every pair, including all four corners.
  for (let a = 0; a < study.panels.length; a++) {
    for (let b = a + 1; b < study.panels.length; b++) {
      const first = extents(study.panels[a]), second = extents(study.panels[b]);
      const overlaps = first.every((edge, axis) => Math.min(edge[1], second[axis][1]) - Math.max(edge[0], second[axis][0]) > 1e-8);
      assert.equal(overlaps, false, `${study.panels[a].face}/${study.panels[b].face} solids must not intersect`);
    }
  }
  for (const face of ["front", "back", "east", "west"]) {
    const panels = study.panels.filter(panel => panel.face === face);
    const axis = face === "front" || face === "back" ? 0 : 2;
    panels.sort((a, b) => a.position[axis] - b.position[axis]);
    assert.equal(panels.length, study.metadata.moduleWidthByFace[face].count);
    for (let index = 1; index < panels.length; index++) {
      const previousEnd = panels[index - 1].position[axis] + panels[index - 1].size[axis] / 2;
      const nextStart = panels[index].position[axis] - panels[index].size[axis] / 2;
      close(nextStart - previousEnd, study.metadata.jointM, `${face} joint gap is measured in physical metres`);
      close(panels[index].size[axis], panels[0].size[axis], `${face} panels divide the face evenly`);
    }
  }
}

let scenarios = 0;
for (const dimensions of [[6, 0.5, 3.9], [24.8, 17.4, 0.8], [8, 8, 0.12], [0.05, 0.04, 0.01], [120, 80, 3.9]]) {
  for (const thicknessMm of [1, 35, 180, 900]) {
    for (const jointMm of [0, 8, 50, 500]) {
      const study = geometry.generatePanelBand({ widthM: dimensions[0], depthM: dimensions[1], heightM: dimensions[2], thicknessMm, jointMm, northShiftM: 3.7, yCenterM: 14.2, moduleWidthM: 1.2 });
      verifyPhysicalBand(study);
      scenarios++;
    }
  }
}
const standard = geometry.generatePanelBand({ widthM: 6, depthM: 3.9, heightM: 0.8, thicknessMm: 35, jointMm: 8, moduleWidthM: 1.2 });
close(standard.metadata.thicknessM, 0.035, "35 mm becomes 0.035 m");
close(standard.metadata.jointM, 0.008, "8 mm becomes 0.008 m");
close(standard.panels[0].size[0], 1.192, "front panel is grid module minus the true joint");
assert.equal(standard.panels.filter(panel => panel.face === "front").length, 5);
close(standard.bounds.minY, 0, "an unspecified vertical centre starts at ground level");
assert.deepEqual(standard, geometry.generatePanelBand({ widthM: 6, depthM: 3.9, heightM: 0.8, thicknessMm: 35, jointMm: 8, moduleWidthM: 1.2 }), "geometry is deterministic");

for (const maxPanels of [4, 5, 20, 512, 2000]) {
  const limited = geometry.generatePanelBand({ widthM: 10000, depthM: 8000, heightM: 4, moduleWidthM: 0.1, maxPanels });
  verifyPhysicalBand(limited);
  assert.ok(limited.panels.length <= Math.min(maxPanels, 512), "performance budget is respected");
  assert.ok(limited.metadata.resolvedModuleWidthM > limited.metadata.requestedModuleWidthM, "broader actual modules are disclosed rather than omitted");
  assert.deepEqual(limited.warnings, ["module_width_increased_for_performance"]);
}
for (const input of [undefined, {}, { widthM: -2, depthM: 4, heightM: 3 }, { widthM: NaN, depthM: 4, heightM: 3 }, { widthM: 4, depthM: Infinity, heightM: 3 }]) {
  const result = geometry.generatePanelBand(input);
  assert.equal(result.panels.length, 0);
  assert.equal(result.bounds, null);
  assert.deepEqual(result.warnings, ["invalid_dimensions"]);
}
verifyPhysicalBand(geometry.generatePanelBand({ widthM: 6, depthM: 4, heightM: 3, thicknessMm: NaN, jointMm: Infinity, moduleWidthM: -4 }));
assert.equal(geometry.clampLouverAngle(-100), -60);
assert.equal(geometry.clampLouverAngle(100), 60);
assert.equal(geometry.clampLouverAngle(0), 0);
assert.equal(geometry.clampLouverAngle(NaN), 22);
close(geometry.louverAngleRadians(60), Math.PI / 3, "louver angle is converted to radians exactly once");
const browser = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../facade-geometry.js"), "utf8"), browser);
assert.equal(typeof browser.AtelierFacadeGeometry.generatePanelBand, "function", "browser global is independent of CommonJS and Three.js");
console.log(`Facade geometry: ${scenarios + 6} dimensioned bands, true joints/thickness, legal envelope containment, non-overlapping corners and 512-panel budget passed.`);
