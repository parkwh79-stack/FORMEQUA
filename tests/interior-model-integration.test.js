"use strict";

// Run: node seoul-3d-web/tests/interior-model-integration.test.js
// Uses the real calculation engine and preset loader. Only DOM presentation
// updates are replaced inside an isolated VM; app.js is never modified.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { generate } = require("../interior-plan.js");
const scriptAssets = html => new Set([...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi)]
  .map(match => new URL(match[2], "https://local.invalid/"))
  .filter(url => url.origin === "https://local.invalid")
  .map(url => decodeURIComponent(url.pathname.slice(1))));
// Both entry points must load the floor planner and provide the viewer's UI.
// The detail workspace previously rendered only the exterior shell.
for (const page of ["index.html", "dashboard.html"]) {
  const html = fs.readFileSync(path.join(__dirname, "..", page), "utf8");
  const assets = scriptAssets(html);
  for (const script of ["interior-plan.js", "interior-viewer.js"]) {
    assert.ok(assets.has(script), `${page} loads ${script}`);
  }
  for (const id of ["btnOpenInterior", "btnInspectInterior", "interiorControls", "interiorFloorSelect", "interiorPlanSummary", "interiorPlanNote", "btnExitInterior", "btnExportInterior"]) {
    assert.ok(html.includes(`id="${id}"`), `${page} exposes ${id}`);
  }
}
const legalModulePath = path.join(__dirname, "../legal-rules.js");
const EPS = 0.00002;
const inertElement = { classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, style: {} };
const context = vm.createContext({
  window: { addEventListener() {}, AtelierLegal: fs.existsSync(legalModulePath) ? require(legalModulePath) : undefined,
    AtelierCoreLayout: require("../core-layout.js") },
  document: { getElementById: () => inertElement, querySelectorAll: () => [] },
  console
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../app.js"), "utf8"), context, { filename: "app.js" });
vm.runInContext("updateAllCalculationsAndUI = () => {}; syncFacadeUI = () => {};", context);

function fromVm(source) { return JSON.parse(vm.runInContext("JSON.stringify(" + source + ")", context)); }
function finiteNumbers(value, route = "plan") {
  if (typeof value === "number") assert.ok(Number.isFinite(value), "finite geometry at " + route);
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => finiteNumbers(item, route + "." + key));
}
const overlap = (a, b) => a.minX < b.maxX - EPS && a.maxX > b.minX + EPS && a.minZ < b.maxZ - EPS && a.maxZ > b.minZ + EPS;
const inside = (r, x, z) => x >= r.minX - EPS && x <= r.maxX + EPS && z >= r.minZ - EPS && z <= r.maxZ + EPS;
const presetKeys = fromVm("Object.keys(SEOUL_PARCELS)");
assert.equal(presetKeys.length, 5, "five real parcel studies");
let modelCount = 0, floorCount = 0, roomCount = 0, doorCount = 0, furnitureCount = 0, warningFloors = 0, emptyFloors = 0;
let smallestWidth = Infinity, smallestDepth = Infinity;
const summaries = [];

for (const parcelKey of presetKeys) {
  for (const option of ["A", "B", "C"]) {
    context.requestedParcel = parcelKey;
    context.requestedOption = option;
    vm.runInContext("loadParcelPreset(requestedParcel); state.option = requestedOption; if (state.option === 'C') state.coreType = 'north';", context);
    const { loaded, preset, params } = fromVm("({ loaded: {...state}, preset: SEOUL_PARCELS[requestedParcel], params: {...state, ...SEOUL_PARCELS[requestedParcel], parcelKey: requestedParcel, option: requestedOption, coreType: state.coreType} })");
    // Check the actual loader's nontrivial resets/defaults rather than silently
    // building an incomplete preset-only parameter object.
    assert.equal(params.zoning, preset.zoning);
    assert.equal(params.buildingUse, preset.buildingUse);
    assert.equal(loaded.setbackSideM, Math.max(1, Number((preset.setbackM * 0.75).toFixed(1))));
    assert.equal(loaded.setbackRearM, preset.setbackM);
    assert.equal(loaded.parcelMerged, false);
    assert.equal(loaded.mixedUseProfile, "office_retail");
    assert.deepEqual(loaded.floorUseOverrides, {});
    assert.equal(params.coreType, option === "C" ? "north" : preset.coreType);
    assert.equal(typeof params.lpSharePct, "number", "base finance state survives preset merge");
    context.calculationParams = params;
    const model = fromVm("evaluateDesignAndProforma(calculationParams, requestedOption)");
    assert.ok(model.floorPlates.length <= preset.floorsAbove, "actual floors respect the legal mass limits");
    assert.equal(model.actualFloorsAbove, model.floorPlates.length);
    assert.ok(model.areas.achievedFarPct <= model.zoningRule.maxFar + EPS, "FAR stays within the cap");
    assert.ok(model.areas.achievedBcrPct <= model.zoningRule.maxBcr + EPS, "BCR stays within the cap");
    modelCount++;
    const summary = { parcel: parcelKey, option, floors: model.floorPlates.length, rooms: 0, warnings: 0, empty: 0 };
    for (const fp of model.floorPlates) {
      const tag = `${parcelKey} ${option} L${fp.level}`;
      const plan = generate(fp, { coreType: params.coreType, option });
      finiteNumbers(plan, tag);
      assert.equal(plan.level, fp.level);
      assert.equal(plan.use, fp.use);
      assert.ok(Math.abs(plan.bounds.minX - (-fp.widthM / 2 + 0.5)) < EPS, "x inset " + tag);
      assert.ok(Math.abs(plan.bounds.maxZ - (fp.northShiftM + fp.depthM / 2 - 0.5)) < EPS, "z shift and inset " + tag);
      const rectangles = [...plan.rooms, ...plan.corridors, ...plan.cores, ...plan.voids];
      for (let i = 0; i < rectangles.length; i++) {
        const r = rectangles[i];
        assert.ok(r.maxX > r.minX && r.maxZ > r.minZ, "positive geometry " + tag);
        assert.ok(inside(plan.bounds, r.minX, r.minZ) && inside(plan.bounds, r.maxX, r.maxZ), "inside actual floor " + tag);
        for (let j = i + 1; j < rectangles.length; j++) assert.ok(!overlap(r, rectangles[j]), "no room/core/void/corridor overlap " + tag);
      }
      assert.equal(plan.voids.length, fp.hasAtrium ? 1 : 0);
      if (fp.hasAtrium) {
        assert.ok(Math.abs((plan.voids[0].maxX - plan.voids[0].minX) - fp.widthM * 0.35) < EPS);
        assert.ok(Math.abs((plan.voids[0].maxZ - plan.voids[0].minZ) - fp.depthM * 0.35) < EPS);
      }
      for (const room of plan.rooms) {
        const doors = plan.doors.filter(door => door.roomId === room.id && door.kind !== "ensuite");
        assert.equal(doors.length, 1, "one door for every generated room " + tag);
        const door = doors[0];
        assert.ok(inside(room, door.x, door.z));
        assert.ok(plan.corridors.some(corridor => inside(corridor, door.x, door.z)), "door reaches corridor " + tag);
      }
      for (const item of plan.furniture) {
        const room = plan.rooms.find(r => r.id === item.roomId);
        assert.ok(room, "furniture references a real room " + tag);
        assert.ok(inside(room, item.x - item.width / 2, item.z - item.depth / 2) && inside(room, item.x + item.width / 2, item.z + item.depth / 2), "furniture within room " + tag);
      }
      if (!plan.rooms.length) {
        assert.ok(plan.warnings.length, "undersized floors are explicitly warned " + tag);
        emptyFloors++; summary.empty++;
      }
      if (plan.warnings.length) { warningFloors++; summary.warnings++; }
      floorCount++; roomCount += plan.rooms.length; doorCount += plan.doors.length; furnitureCount += plan.furniture.length; summary.rooms += plan.rooms.length;
      smallestWidth = Math.min(smallestWidth, fp.widthM);
      smallestDepth = Math.min(smallestDepth, fp.depthM);
    }
    summaries.push(summary);
  }
}
assert.equal(modelCount, 15);
assert.ok(floorCount > 0 && floorCount <= presetKeys.reduce((sum, key) => sum + fromVm("SEOUL_PARCELS[" + JSON.stringify(key) + "].floorsAbove") * 3, 0));
assert.ok(doorCount >= roomCount, "each corridor-facing room has an entry, with additional private bathroom openings");
console.table(summaries);
console.log(JSON.stringify({ modelCount, floorCount, roomCount, doorCount, furnitureCount, warningFloors, emptyFloors, smallestWidth, smallestDepth }, null, 2));
console.log("Real preset + calculation engine interior integration passed.");
