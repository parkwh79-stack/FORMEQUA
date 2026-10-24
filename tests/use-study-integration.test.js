"use strict";

// Run: node seoul-3d-web/tests/use-study-integration.test.js
// Real program change handlers -> real mass/parking/use rules -> real interior
// planner. Only rendering and DOM presentation are isolated in this VM.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const legal = require("../legal-rules.js");
const permissions = require("../use-permissions.js");
const { generate } = require("../interior-plan.js");
const EPS = 0.00002;
const root = path.join(__dirname, "..");
const scriptAssets = html => new Set([...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi)]
  .map(match => new URL(match[2], "https://local.invalid/"))
  .filter(url => url.origin === "https://local.invalid")
  .map(url => decodeURIComponent(url.pathname.slice(1))));

for (const page of ["index.html", "dashboard.html"]) {
  const html = fs.readFileSync(path.join(root, page), "utf8");
  const assets = scriptAssets(html);
  for (const script of ["legal-rules.js", "use-permissions.js", "use-study.js", "interior-plan.js", "interior-viewer.js"]) {
    assert.ok(assets.has(script), `${page} loads ${script}`);
  }
  for (const id of ["selectStudyProgram", "selectHotelType", "selectLivingLegalUse", "programPermissionStatus", "programPermissionBody"]) {
    assert.ok(html.includes(`id="${id}"`), `${page} exposes ${id}`);
  }
}

const elements = new Map(), events = {};
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    value: "", dataset: {}, style: {}, listeners: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(name, listener) { this.listeners[name] = listener; }
  });
  return elements.get(id);
}
const context = vm.createContext({
  window: {
    AtelierLegal: legal, AtelierUsePermissions: permissions,
    addEventListener(name, listener) { (events[name] ||= []).push(listener); }
  },
  document: { getElementById: element, querySelectorAll: () => [] }, console
});
vm.runInContext(fs.readFileSync(path.join(root, "app.js"), "utf8"), context, { filename: "app.js" });
vm.runInContext("updateAllCalculationsAndUI = () => {}; syncFacadeUI = () => {};", context);
vm.runInContext(fs.readFileSync(path.join(root, "use-study.js"), "utf8"), context, { filename: "use-study.js" });
// Bind just the program UI. app.js's DOMContentLoaded starts WebGL, which this
// calculation test deliberately leaves to browser verification.
events.DOMContentLoaded.at(-1)();
function read(source) { return JSON.parse(vm.runInContext("JSON.stringify(" + source + ")", context)); }
function change(id, value) {
  const target = element(id); target.value = value;
  assert.equal(typeof target.listeners.change, "function", `${id} is wired`);
  target.listeners.change({ target });
}
function setState(values) {
  context.testInputs = values;
  vm.runInContext("Object.assign(state, testInputs)", context);
}
function load(parcelKey = "custom_seoul") {
  context.testParcel = parcelKey;
  vm.runInContext("loadParcelPreset(testParcel)", context);
}
function model() { return read("evaluateDesignAndProforma(state, state.option)"); }
function study(program, overrides = {}, parcelKey = "custom_seoul") {
  load(parcelKey); change("selectStudyProgram", program); setState(overrides);
  return model();
}
function checkMass(m, tag) {
  assert.ok(m.floorPlates.length > 0, tag + " produces a comparison mass");
  assert.equal(m.actualFloorsAbove, m.floorPlates.length);
  assert.ok(m.areas.achievedFarPct <= m.zoningRule.maxFar + EPS, tag + " actual FAR cap");
  assert.ok(m.areas.achievedBcrPct <= m.zoningRule.maxBcr + EPS, tag + " actual BCR cap");
  const actualArea = m.floorPlates.reduce((sum, fp) => sum + fp.areaSqm, 0);
  assert.ok(Math.abs(actualArea - m.areas.aboveGroundGfaSqm) < EPS, tag + " generated GFA");
  for (const fp of m.floorPlates) {
    assert.ok(fp.widthM >= 6 - EPS && fp.depthM >= 6 - EPS, tag + " usable floor geometry");
    const actual = fp.widthM * fp.depthM * (fp.hasAtrium ? 1 - 0.35 ** 2 : 1);
    assert.ok(Math.abs(actual - fp.areaSqm) < EPS, tag + " floor area matches its mesh dimensions");
  }
  assert.ok(m.parking.legalParkingCount >= 0 && m.parking.plannedParkingCount <= m.parking.capacityCount);
  assert.equal(m.usePermission.isPermitConfirmation, false, "scenario screening never claims permit approval");
}
const inside = (r, x, z) => x >= r.minX - EPS && x <= r.maxX + EPS && z >= r.minZ - EPS && z <= r.maxZ + EPS;
const totals = { modelCount: 0, floorCount: 0, guestRooms: 0, units: 0, privateRooms: 0, workstations: 0 };
function checkPlan(fp, options, tag) {
  const p = generate(fp, options), m = p.metrics;
  assert.equal(p.use, fp.use, tag + " planner follows the actual floor use");
  assert.equal(p.level, fp.level);
  for (const rect of [...p.rooms, ...p.corridors, ...p.cores, ...p.voids]) {
    assert.ok(rect.maxX > rect.minX && rect.maxZ > rect.minZ, tag + " positive rectangle");
    assert.ok(inside(p.bounds, rect.minX, rect.minZ) && inside(p.bounds, rect.maxX, rect.maxZ), tag + " interior remains within the generated floor");
  }
  for (const item of p.furniture) {
    const room = p.rooms.find(r => r.id === item.roomId);
    assert.ok(room && item.width > 0 && item.depth > 0 && item.height > 0, tag + " real furniture belongs to a room");
    assert.ok(inside(room, item.x - item.width / 2, item.z - item.depth / 2) && inside(room, item.x + item.width / 2, item.z + item.depth / 2), tag + " furniture fits its room");
  }
  assert.equal(m.roomCount, p.rooms.length);
  assert.equal(m.doorCount, p.doors.length);
  assert.equal(m.furnitureCount, p.furniture.length);
  const guests = p.rooms.filter(room => /^guest_/.test(room.type));
  assert.equal(m.guestRoomCount, guests.length);
  assert.equal(m.guestBedCount, p.furniture.filter(item => item.type === "bed" && guests.some(room => room.id === item.roomId)).length);
  const units = p.rooms.filter(room => room.type === "dwelling_unit");
  assert.equal(m.dwellingUnitCount, units.length);
  assert.equal(m.privateRoomCount, p.rooms.filter(room => room.type === "private_room").length);
  assert.equal(m.sharedSpaceCount, p.rooms.filter(room => room.type.startsWith("shared_")).length);
  assert.equal(m.workstationCount, p.furniture.filter(item => item.type === "desk" && item.workstationId && p.furniture.some(chair => chair.type === "chair" && chair.workstationId === item.workstationId)).length);
  for (const room of [...guests, ...units, ...p.rooms.filter(room => room.type === "private_room")]) {
    const furnitureTypes = new Set(p.furniture.filter(item => item.roomId === room.id).map(item => item.type));
    assert.ok(room.ensuite && furnitureTypes.has("bed") && furnitureTypes.has("toilet") && furnitureTypes.has("vanity"), tag + " counted private module has its bed and bathroom");
    assert.ok(p.doors.some(door => door.roomId === room.id && door.kind !== "ensuite"), tag + " private module has an independent entrance");
    if (room.type === "dwelling_unit") {
      assert.ok(furnitureTypes.has("sofa") && furnitureTypes.has("kitchen_counter"), tag + " counted dwelling includes living and kitchen functions");
      assert.deepEqual(new Set(room.subspaces.map(space => space.type)), new Set(["sleeping", "living", "kitchen", "bathroom"]));
    }
  }
  if (!p.rooms.length) assert.ok(p.warnings.length, tag + " an undersized floor explicitly reports its limitation");
  if (fp.use === "residential") {
    assert.equal(p.spaceProgram, options.spaceProgram);
    assert.equal(p.residentialType, options.residentialType);
    if (options.spaceProgram === "coliving") assert.equal(m.dwellingUnitCount, 0, "shared facilities do not become fictitious independent dwellings");
  }
  totals.floorCount++; totals.guestRooms += m.guestRoomCount; totals.units += m.dwellingUnitCount;
  totals.privateRooms += m.privateRoomCount; totals.workstations += m.workstationCount;
}

const routes = {
  office: { use: "업무시설(오피스)", first: "retail", upper: "main", residentialType: "officetel" },
  hotel: { use: "숙박시설(호텔)", first: "amenity", upper: "hotel", residentialType: "officetel" },
  housing: { use: "공동주택(주상복합)", first: "retail", upper: "residential", residentialType: "apartment" },
  officetel: { use: "업무시설(오피스텔)", first: "retail", upper: "residential", residentialType: "officetel" },
  living: { use: "업무시설(오피스텔)", first: "retail", upper: "residential", residentialType: "officetel" }
};
for (const parcelKey of read("Object.keys(SEOUL_PARCELS)")) {
  for (const [program, route] of Object.entries(routes)) {
    load(parcelKey);
    setState({ floorUseOverrides: { 3: "amenity" }, mixedUseProfile: "mixed_resi", selectedFloorLevel: 3 });
    change("selectStudyProgram", program);
    assert.equal(read("state.buildingUse"), route.use);
    assert.equal(read("state.residentialType"), route.residentialType);
    assert.equal(read("state.spaceProgram"), program === "living" ? "coliving" : "standard");
    assert.deepEqual(read("state.floorUseOverrides"), {}, "a new program clears stale floor overrides");
    assert.equal(read("state.mixedUseProfile"), "office_retail");
    assert.equal(read("state.selectedFloorLevel"), null);
    change("selectHotelType", "tourist");
    assert.equal(read("state.hotelType"), "tourist", "hotel subtype control updates the actual legal input");
    setState({ floorsAbove: 6, parkingMode: "report" });
    const m = model(), params = read("state"), tag = `${parcelKey} ${program}`;
    checkMass(m, tag); totals.modelCount++;
    assert.equal(m.floorPlates[0].use, route.first);
    assert.ok(m.floorPlates.some(fp => fp.use === route.upper), tag + " generates the requested upper-floor use");
    for (const fp of m.floorPlates) {
      const lowerRetail = (program === "officetel" || program === "living" || program === "office") && fp.level <= 2;
      assert.equal(fp.use, fp.level === 1 || lowerRetail ? route.first : route.upper, tag + ` L${fp.level} routing`);
      checkPlan(fp, params, tag + ` L${fp.level}`);
    }
  }
}
assert.equal(totals.modelCount, 25);
for (const key of ["guestRooms", "units", "privateRooms", "workstations"]) assert.ok(totals[key] > 0, "real fitted program output: " + key);

// The legal form of a co-living concept can be changed without losing its
// shared-space planning program, and must reach both model and planner.
load(); change("selectStudyProgram", "living"); change("selectLivingLegalUse", "공동주택(주상복합)");
assert.equal(read("state.spaceProgram"), "coliving");
assert.equal(read("state.residentialType"), "apartment");
let m = model();
checkMass(m, "co-living apartment basis");
checkPlan(m.floorPlates.find(fp => fp.use === "residential"), read("state"), "co-living apartment basis");

// Use restrictions must alter actual generated area, rather than just the label.
const largeSite = { siteAreaSqm: 5000, floorsAbove: 15, targetBcr: 50, northSolar: false,
  roadWidthM: 20, publicContribPct: 0, parkingMode: "report" };
for (const zoning of ["제2종일반주거지역", "제3종일반주거지역"]) {
  m = study("office", { ...largeSite, zoning });
  checkMass(m, zoning + " office area cap");
  const offices = m.floorPlates.filter(fp => fp.use === "main").reduce((sum, fp) => sum + fp.areaSqm, 0);
  assert.ok(offices > 2900 && offices < 3000, "actual office floor plates obey the strict 3,000㎡ cap");
  assert.ok(Math.abs(m.usePermission.areas.office - offices) < EPS);
}
m = study("officetel", { ...largeSite, zoning: "제3종일반주거지역", floorUseOverrides: { 3: "main" } });
checkMass(m, "combined office + officetel area cap");
const combined = m.floorPlates.filter(fp => fp.use === "main" || fp.use === "residential").reduce((sum, fp) => sum + fp.areaSqm, 0);
assert.ok(m.floorPlates.some(fp => fp.use === "main") && m.floorPlates.some(fp => fp.use === "residential"));
assert.ok(combined > 2900 && combined < 3000, "office and officetel share one strict business-area budget");
assert.ok(Math.abs((m.usePermission.areas.office || 0) + (m.usePermission.areas.officetel || 0) - combined) < EPS);

assert.equal(permissions.limitsFor({ zoning: "제3종일반주거지역" }).salesAreaSqm, 1999.99);
m = study("sales", { ...largeSite, zoning: "제3종일반주거지역" });
checkMass(m, "sales area cap");
const sales = m.floorPlates.reduce((sum, fp) => sum + fp.areaSqm, 0);
assert.ok(sales > 1900 && sales < 2000, "actual sales floor plates obey the strict 2,000㎡ cap");
assert.ok(Math.abs(m.usePermission.areas.sales - sales) < EPS);

// A prohibited scenario remains available for explicit comparison; its model
// carries the prohibition instead of being presented as an admissible project.
m = study("hotel", { zoning: "제2종일반주거지역", hotelType: "general", northSolar: false, parkingMode: "report", floorsAbove: 4 });
checkMass(m, "prohibited general hotel comparison");
assert.equal(m.usePermission.status, "prohibited");
assert.equal(m.usePermission.canUseForStudy, false);
assert.ok(m.constraints.warnings.some(text => text.includes(m.usePermission.label)));

m = study("hotel", { zoning: "일반상업지역", hotelType: "tourist", parkingMode: "report", floorsAbove: 5, floorUseOverrides: { 3: "main" } });
const officeOverride = m.floorPlates.find(fp => fp.level === 3);
assert.equal(officeOverride.use, "main");
assert.ok(m.usePermission.entries.some(entry => entry.key === "office"), "a hotel's explicit office floor is screened as office");
assert.ok(Math.abs(m.usePermission.areas.office - officeOverride.areaSqm) < EPS);
assert.ok(m.parking.breakdown.some(entry => entry.key === "office" && Math.abs(entry.areaSqm - officeOverride.areaSqm) < EPS), "parking and use permission classify the same office floor");
checkPlan(officeOverride, read("state"), "hotel office override");

console.log("Program study integration passed: " + JSON.stringify(totals) + "; real UI routing, FAR/BCR, 3,000㎡ business / 2,000㎡ sales caps, mixed uses, hotel prohibition, complete private modules and co-living legal bases.");
