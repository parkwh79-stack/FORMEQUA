"use strict";

// Run: node tests/project-files.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const createBridge = require("../workspace-state.js");
const parcelGeometry = require("../parcel-geometry.js");
const clone = value => JSON.parse(JSON.stringify(value));
const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const initialStateSource = source.match(/const state = (\{[\s\S]*?\n\});/);
assert.ok(initialStateSource, "exercise the engine's actual input defaults");
const defaults = clone(vm.runInNewContext(`(${initialStateSource[1]})`,{window:{AtelierSpatialSettings:require('../spatial-settings.js')}}));
function fixture() {
  const storage = new Map();
  const listeners = {};
  const host = {
    location: new URL("http://127.0.0.1:8090/dashboard.html"),
    sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    addEventListener: (name, fn) => { listeners[name] = fn; },
    document: { addEventListener() {} },
    AtelierParcelGeometry: parcelGeometry
  };
  let live = clone(defaults);
  const bridge = createBridge(host);
  bridge.attach(() => live);
  return { bridge, storage, listeners, host, get live() { return live; }, set live(value) { live = value; } };
}
const parcelData = { version: 1, source: "import", fetchedAt: "2026-10-21T00:00:00.000Z", features: [{
  type: "Feature", geometry: { type: "Polygon", coordinates: [[[127.0, 37.5], [127.001, 37.5], [127.001, 37.501], [127.0, 37.5]]] },
  properties: { pnu: "1168010100100010000", address: "서울특별시 강남구 역삼동 1", source: "import" }
}] };

const first = fixture();
assert.throws(() => first.bridge.exportProject(), /초기화/);
assert.equal(first.bridge.ready(), true);
first.live = { ...clone(defaults), parcelKey: "gangnam_yeoksam", financeMode: "hotel", buildingUse: "숙박시설(호텔)",
  hotelType: "tourist", hotelAdrKrw: 235000, hotelOccupancyPct: 81.2, hotelRoomsOverride: 95,
  hotelTwinPct:25,hotelSuitePct:20,hotelServiceEveryRooms:8,hotelTwinAdrFactor:1.2,hotelSuiteAdrFactor:2.1,
  officeDeskType:'bench',officeOrientation:'90',officeTargetSeats:21,
  officeRoomRequirements:{'L4-R1':{deskType:'standing',orientation:'0',targetSeats:3}},
  layoutObstacles:[{id:'confirmed-input-1',level:4,minX:1,maxX:1.6,minZ:2,maxZ:2.8,kind:'fixed'}],navigationClearanceM:.28,
  hotelAncillaryRevenuePct: 26, hotelOpexPct: 54, hotelFixedOpexEok: 1.2,
  hotelFfeReservePct: 4.5, hotelManagementFeePct: 2.2,
  hotelResidentialDistanceM: 28.5, hotelResidentialBarrier: true,
  floorUseOverrides: { 1: "retail", 2: "hotel", 5: "amenity" }, parcelData: clone(parcelData),
  apiKey: "SECRET_API_KEY", lawApiKey: "SECRET_LAW_KEY", lastComputed: { secret: "NO_RESULTS" },
  lawSyncedMeta: { response: "NO_LAW_CACHE" }, isRecording: true };
first.bridge.save();
const hotel = clone(first.bridge.sanitize(first.live));
first.live = { ...clone(defaults), parcelKey: "seongdong_seongsu", option: "B", financeMode: "rental",
  floorUseOverrides: { 2: "main", 7: "residential" }, loanLtvPct: 74, loanRatePct: 8.1, parcelData: null };
first.bridge.save();
const office = clone(first.bridge.sanitize(first.live));
first.live = { ...clone(defaults), parcelKey: "custom_seoul", buildingUse: "업무시설(오피스텔)",
  layoutObstacles:[{id:'active-site-fixed',level:5,minX:1,maxX:1.5,minZ:2,maxZ:2.7,kind:'fixed'}],
  officeRoomRequirements:{'L5-R2':{deskType:'standing',orientation:'90',targetSeats:4}},
  housingUnits: 61, housingUnitAreaSqm: 33, floorUseOverrides: { 5: "residential" }, parcelData: clone(parcelData) };
first.bridge.save();
const project = first.bridge.exportProject({ title: "합정 — 운영형 리빙 / 대안 B" });
assert.deepEqual(project.inputs.layoutObstacles,first.live.layoutObstacles,'active parcel obstacles must survive file export');
assert.deepEqual(project.inputs.officeRoomRequirements,first.live.officeRoomRequirements,'active parcel room settings must survive file export');
assert.equal(project.format, "formequa-project");
assert.equal(project.version, 1);
assert.equal(project.title, "합정 — 운영형 리빙 / 대안 B");
assert.equal(project.activeParcelKey, "custom_seoul");
assert.equal(Object.keys(project.perParcel).length, 3);
assert.deepEqual(project.perParcel.gangnam_yeoksam, hotel);
assert.deepEqual(project.perParcel.seongdong_seongsu, office);
assert.deepEqual(project.inputs, project.perParcel.custom_seoul);
const raw = JSON.stringify(project);
for (const secret of ["SECRET_API_KEY", "SECRET_LAW_KEY", "NO_RESULTS", "NO_LAW_CACHE", "isRecording", "lastComputed", "savedAtMs"]) assert.equal(raw.includes(secret), false, `${secret} is excluded`);
assert.deepEqual(first.bridge.parseProject(raw), project);
const unmodified = clone(project);
first.bridge.validateProject(project);
assert.deepEqual(project, unmodified, "validation never rewrites the user's file object");

const second = fixture();
second.bridge.ready();
const stateIdentity = second.live;
let recalculations = 0;
second.bridge.importProject(raw, inputs => {
  Object.assign(second.live, clone(inputs));
  recalculations += 1;
  second.listeners["atelier:updated"]();
});
assert.equal(recalculations, 1, "loading inputs asks the engine to recalculate rather than restoring old results");
assert.equal(second.live, stateIdentity, "the engine's shared state object is preserved");
assert.deepEqual(second.bridge.restore(), project.inputs);
assert.deepEqual(second.bridge.restoreParcel("gangnam_yeoksam"), hotel);
assert.deepEqual(second.bridge.restoreParcel("seongdong_seongsu"), office);
assert.equal(second.bridge.getProjectMeta().title, project.title);
const roundTrip = second.bridge.exportProject();
assert.deepEqual(roundTrip.inputs, project.inputs);
assert.deepEqual(roundTrip.perParcel, project.perParcel);
assert.equal(roundTrip.title, project.title);
assert.equal(roundTrip.createdAt, project.createdAt);

// Unlike the tab cache, a file from years ago can still be re-evaluated today.
const oldProject = { ...clone(project), createdAt: "2020-01-01T00:00:00.000Z", savedAt: "2020-02-01T00:00:00.000Z" };
second.bridge.importProject(oldProject, inputs => Object.assign(second.live, inputs));
assert.equal(second.bridge.exportProject().createdAt, oldProject.createdAt);
const oldSession = JSON.parse(second.storage.get(second.bridge.storageKey));
oldSession.savedAt = Date.now() - 13 * 60 * 60 * 1000;
second.storage.set(second.bridge.storageKey, JSON.stringify(oldSession));
assert.equal(second.bridge.restore(), null, "12-hour session expiry remains separate from file lifetime");
assert.doesNotThrow(() => second.bridge.parseProject(JSON.stringify(oldProject)));

// Reject a damaged field in any parcel before either the active study or its
// cache changes. Partial recovery would silently alter a financial comparison.
const rejectedCases = [
  value => { value.version = 999; },
  value => { value.format = "another-application"; },
  value => { value.title = ""; },
  value => { value.title = "bad\nname"; },
  value => { value.createdAt = "yesterday"; },
  value => { value.savedAt = "2000-01-01T00:00:00.000Z"; },
  value => { value.extra = "unknown"; },
  value => { value.activeParcelKey = "unknown"; },
  value => { value.inputs.parcelKey = "gangnam_yeoksam"; },
  value => { value.inputs.rentPyeongMan = "20"; },
  value => { value.perParcel.seongdong_seongsu.loanRatePct = 100; },
  value => { value.perParcel.gangnam_yeoksam.hotelResidentialBarrier = "true"; },
  value => { value.perParcel.gangnam_yeoksam.hotelOccupancyPct = 101; },
  value => { value.perParcel.gangnam_yeoksam.hotelResidentialDistanceM = -1; },
  value => { value.perParcel.gangnam_yeoksam.hotelRoomsOverride = 80.5; },
  value => { value.perParcel.gangnam_yeoksam.floorUseOverrides[99] = "hotel"; },
  value => { value.perParcel.gangnam_yeoksam.floorUseOverrides[5] = "warehouse"; },
  value => { value.perParcel.gangnam_yeoksam.apiKey = "NEVER_ACCEPT"; },
  value => { value.inputs.parcelData.bad = true; },
  value => { value.inputs.parcelData.features.push({ ...clone(value.inputs.parcelData.features[0]),
    geometry: { type: "Polygon", coordinates: [[[127.005, 37.5], [127.006, 37.5], [127.006, 37.501], [127.005, 37.5]]] } }); },
  value => { value.inputs.parcelData.features[0].geometry.coordinates = [[[127, 37.5], [127.01, 37.5], [127.01, 37.51], [127, 37.5]]]; },
  value => { value.inputs.parcelData.features[0].geometry.coordinates = [[[127, 37.5], [127.000001, 37.5], [127.000001, 37.500001], [127, 37.5]]]; },
  value => { value.inputs.siteAreaSqm = 1000000; },
  value => { delete value.perParcel.custom_seoul; },
  value => { value.perParcel.custom_seoul.loanRatePct = 12; }
];
for (const damage of rejectedCases) {
  const damaged = clone(project);
  damage(damaged);
  const beforeLive = clone(second.live);
  const beforeSession = second.storage.get(second.bridge.storageKey);
  let called = false;
  assert.throws(() => second.bridge.importProject(damaged, () => { called = true; }), /프로젝트 파일/);
  assert.equal(called, false);
  assert.deepEqual(second.live, beforeLive);
  assert.equal(second.storage.get(second.bridge.storageKey), beforeSession);
}
assert.throws(() => first.bridge.parseProject("{broken"), /JSON/);
assert.throws(() => first.bridge.parseProject("x".repeat(first.bridge.maxProjectBytes + 1)), /5 MiB/);
assert.throws(() => first.bridge.parseProject(raw.replace('"format":', '"__proto__":{},"format":')), /지원하지/);
const reordered = clone(project);
reordered.perParcel.custom_seoul = Object.fromEntries(Object.entries(reordered.inputs).reverse());
assert.doesNotThrow(() => first.bridge.validateProject(reordered), "object property order has no semantic effect");

// If the rendering adapter itself fails after validation, recover the previous
// inputs and do not commit a different parcel map to storage.
const beforeFailure = clone(first.live);
const beforeFailureSession = first.storage.get(first.bridge.storageKey);
let applyCount = 0;
assert.throws(() => first.bridge.importProject(project, inputs => {
  Object.assign(first.live, inputs);
  applyCount += 1;
  if (applyCount === 1) throw new Error("render failed");
}), /render failed/);
assert.equal(applyCount, 2);
assert.deepEqual(first.live, beforeFailure);
assert.equal(first.storage.get(first.bridge.storageKey), beforeFailureSession);
console.log("PASS project files: input-only round-trip, three parcels, hotel assumptions, geometry, TTL independence and atomic validation");
