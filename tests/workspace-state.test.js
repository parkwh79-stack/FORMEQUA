"use strict";

// Run: node seoul-3d-web/tests/workspace-state.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const createBridge = require("../workspace-state.js");

function fixture(storage = new Map(), url = "http://127.0.0.1:8090/") {
  const events = {};
  const documentEvents = {};
  const host = {
    location: new URL(url),
    sessionStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value)
    },
    addEventListener: (name, callback) => { events[name] = callback; },
    document: { addEventListener: (name, callback) => { documentEvents[name] = callback; } }
  };
  return { bridge: createBridge(host), events, documentEvents, storage, host };
}

const input = {
  parcelKey: "seongdong_seongsu", option: "B", viewMode: "xray", daylightTheme: false, showSurroundingBuildings: false,
  facadeType: "stone_ribbon", claddingMaterial: "limestone", facadeWwrPct: 55, facadeBayM: 3.1,
  facadeLouverM: 0.35, facadeAccent: "warm_limestone", glassTint: "bronze_gold", podiumStyle: "brick_arcade",
  facadePanelDepthMm: 65, facadeJointMm: 12, facadeLouverAngleDeg: -35,
  siteAreaSqm: 2800, roadWidthM: 22, zoning: "준공업지역", buildingUse: "지식산업센터",
  hotelType: "unconfirmed", spaceProgram: "standard", parcelData: null,
  hotelResidentialDistanceM: null, hotelResidentialBarrier: null,
  financeMode: "rental", hotelAdrKrw: 180000, hotelOccupancyPct: 70,
  hotelRoomsOverride: 0, hotelAncillaryRevenuePct: 15, hotelOpexPct: 60,
  hotelFixedOpexEok: 0, hotelFfeReservePct: 4, hotelManagementFeePct: 3,
  seoulDowntown: false, publicContribPct: 5, northSolar: true, parcelMerged: true,
  legalFarCapPct: 325, legalBcrCapPct: 42, maxHeightM: 55.5, parkingMode: "report",
  parkingDistrict: "restricted", residentialType: "apartment", housingPermitType: "housing_approval",
  housingUnitAreaSqm: 50, housingUnits: 24,
  setbackM: 2.5, setbackSideM: 2, setbackRearM: 3, floorsAbove: 12, floorsBelow: 3,
  targetBcr: 51, floorHeight: 4.1, coreType: "split", mixedUseProfile: "knowledge_ind",
  floorUseOverrides: { 1: "retail", 6: "amenity", 8: "hotel", 12: "residential" }, clipPlanePct: 65,
  showDimensions: true, sunHour: 13.25, landPricePyeongM: 105, constCostPyeongMan: 980,
  rentPyeongMan: 12.5, capRatePct: 4.8, loanLtvPct: 68, loanRatePct: 6.4,
  lpSharePct: 85, lpHurdlePct: 8, gpPromotePct: 35, targetIrrPct: 15,
  selectedFloorLevel: 6, lastComputed: { finance: "derived" }, lawSyncedMeta: { raw: "law-response" }, isRecording: true
};

const original = fixture();
assert.equal(original.bridge.restore(), null);
original.bridge.attach(() => input);
assert.equal(original.bridge.save(), false, "a default render cannot overwrite a pending restore");
assert.equal(original.bridge.ready(), true);
const persisted = JSON.parse(original.storage.get(original.bridge.storageKey));
assert.equal(persisted.version, 1);
for (const key of ["lastComputed", "lawSyncedMeta", "isRecording", "selectedFloorLevel"]) {
  assert.equal(Object.hasOwn(persisted.inputs, key), false, `${key} is not a user input`);
}
const secondPage = fixture(original.storage);
const restored = secondPage.bridge.restore();
assert.deepEqual(restored, original.bridge.sanitize(input), "all editable design/finance inputs survive the page transition");
secondPage.bridge.attach(() => ({ parcelKey: "gangnam_yeoksam", floorsAbove: 15 }));
secondPage.events["atelier:updated"]();
assert.deepEqual(secondPage.bridge.restore(), restored, "the first default update does not replace the saved study");

const invalid = original.bridge.sanitize({
  ...input, floorsAbove: "12", floorsBelow: "NaN", floorHeight: Infinity, siteAreaSqm: "0x400",
  roadWidthM: "", targetBcr: "300", loanLtvPct: "67", facadeType: "unknown", sunHour: "13.50",
  parcelMerged: "false", floorUseOverrides: { 0: "retail", 1: "retail", 8: "office", 12: "amenity", 13: "main", "1.2": "retail" }
});
assert.equal(invalid.floorsAbove, 12);
assert.equal(invalid.loanLtvPct, 67);
assert.equal(invalid.sunHour, 13.5);
for (const key of ["floorsBelow", "floorHeight", "siteAreaSqm", "roadWidthM", "targetBcr", "facadeType", "parcelMerged"]) {
  assert.equal(Object.hasOwn(invalid, key), false, `unsafe ${key} falls back to the preset`);
}
assert.deepEqual(invalid.floorUseOverrides, { 1: "retail", 12: "amenity" });
assert.equal(original.bridge.sanitize({ ...input, parcelKey: "unknown" }), null);

// New legal conditions must be saved as editable inputs, with the same strict
// numeric/enum validation as the existing site and finance controls. Zero is
// meaningful: an unset cap or an estimated dwelling count is not missing data.
for (const [key, minimum, maximum] of [
  ["legalFarCapPct", 0, 1500], ["legalBcrCapPct", 0, 100], ["maxHeightM", 0, 300],
  ["housingUnitAreaSqm", 15, 250], ["housingUnits", 0, 3000]
]) {
  for (const value of [minimum, maximum]) {
    assert.equal(original.bridge.sanitize({ ...input, [key]: value })[key], value, `${key} retains an allowed boundary`);
  }
  for (const value of [minimum - 1, maximum + 1, Infinity, NaN, "", "0x20", null, true]) {
    assert.equal(Object.hasOwn(original.bridge.sanitize({ ...input, [key]: value }), key), false, `${key} rejects invalid or out-of-range ${value}`);
  }
}
const legalNumericStrings = original.bridge.sanitize({
  ...input, legalFarCapPct: "280.5", legalBcrCapPct: "42.5", maxHeightM: "48.25",
  housingUnitAreaSqm: "30.25", housingUnits: "32"
});
assert.equal(legalNumericStrings.legalFarCapPct, 280.5);
assert.equal(legalNumericStrings.legalBcrCapPct, 42.5);
assert.equal(legalNumericStrings.maxHeightM, 48.25);
assert.equal(legalNumericStrings.housingUnitAreaSqm, 30.25);
assert.equal(legalNumericStrings.housingUnits, 32);
assert.equal(Object.hasOwn(original.bridge.sanitize({ ...input, housingUnits: 24.5 }), "housingUnits"), false, "dwelling count must be an integer");
for (const [key, values] of Object.entries({
  parkingMode: ["fit", "report"], parkingDistrict: ["unconfirmed", "standard", "restricted"],
  residentialType: ["apartment", "officetel"], housingPermitType: ["building_permit", "housing_approval"],
  hotelType: ["unconfirmed", "general", "tourist"], spaceProgram: ["standard", "coliving"]
})) {
  values.forEach(value => assert.equal(original.bridge.sanitize({ ...input, [key]: value })[key], value, `${key} retains ${value}`));
  for (const value of ["unknown", "", false, null]) assert.equal(Object.hasOwn(original.bridge.sanitize({ ...input, [key]: value }), key), false, `${key} rejects invalid enum`);
}
assert.equal(original.bridge.sanitize(input).floorUseOverrides[8], "hotel", "hotel floor overrides survive navigation");

// Physical facade detail controls travel with the study. Their signed angles
// and millimeter values use strict numeric bounds rather than appearance enums.
for (const [key, minimum, maximum] of [
  ["facadePanelDepthMm", 10, 100], ["facadeJointMm", 3, 25], ["facadeLouverAngleDeg", -60, 60]
]) {
  for (const value of [minimum, maximum]) {
    assert.equal(original.bridge.sanitize({ ...input, [key]: value })[key], value, `${key} retains its allowed boundary`);
  }
  for (const value of [minimum - 1, maximum + 1, Infinity, NaN, "", "0x20", null, true, "realistic"]) {
    assert.equal(Object.hasOwn(original.bridge.sanitize({ ...input, [key]: value }), key), false, `${key} rejects an invalid physical detail`);
  }
}
const facadeNumericStrings = original.bridge.sanitize({
  ...input, facadePanelDepthMm: "42.5", facadeJointMm: "8.5", facadeLouverAngleDeg: "-22.5"
});
assert.equal(facadeNumericStrings.facadePanelDepthMm, 42.5);
assert.equal(facadeNumericStrings.facadeJointMm, 8.5);
assert.equal(facadeNumericStrings.facadeLouverAngleDeg, -22.5);
assert.equal(original.bridge.sanitize({ ...input, facadeLouverAngleDeg: 0 }).facadeLouverAngleDeg, 0, "an unrotated louver is a meaningful saved value");

for (const bad of [
  "not-json", "null", JSON.stringify({ version: 0, savedAt: Date.now(), inputs: input }),
  JSON.stringify({ version: 1, savedAt: Date.now() - 13 * 3600000, inputs: input }),
  JSON.stringify({ version: 1, savedAt: Date.now() + 3600000, inputs: input }),
  JSON.stringify({ version: 1, savedAt: "today", inputs: input })
]) {
  const value = fixture(new Map([[original.bridge.storageKey, bad]]));
  assert.equal(value.bridge.restore(), null, "outdated or damaged session data is ignored");
}
const blocked = fixture();
blocked.host.sessionStorage.getItem = () => { throw new Error("unavailable"); };
blocked.host.sessionStorage.setItem = () => { throw new Error("quota"); };
blocked.bridge.attach(() => input);
assert.equal(blocked.bridge.restore(), null);
assert.equal(blocked.bridge.restoreParcel("seongdong_seongsu"), null);
assert.equal(blocked.bridge.ready(), false, "storage rejection does not interrupt the app");

// Each known parcel retains its own editable study in the same browser tab.
// Law responses and calculated results are never admitted to any map entry.
const parcelMemory = fixture();
let activeParcel = { ...input, parcelKey: "gangnam_yeoksam", buildingUse: "업무시설(오피스)", hotelType: "unconfirmed", spaceProgram: "standard" };
parcelMemory.bridge.attach(() => activeParcel);
assert.equal(parcelMemory.bridge.restoreParcel(activeParcel.parcelKey), null);
parcelMemory.bridge.ready();
const officeStudy = parcelMemory.bridge.sanitize(activeParcel);
activeParcel = { ...input, parcelKey: "seongdong_seongsu", buildingUse: "숙박시설(호텔)", hotelType: "tourist", spaceProgram: "standard", floorsAbove: 9 };
parcelMemory.bridge.save();
const hotelStudy = parcelMemory.bridge.sanitize(activeParcel);
activeParcel = { ...input, parcelKey: "mapo_hapjeong", buildingUse: "공동주택(주상복합)", hotelType: "unconfirmed", spaceProgram: "coliving", floorsAbove: 8 };
parcelMemory.bridge.save();
const livingStudy = parcelMemory.bridge.sanitize(activeParcel);
const parcelPage = fixture(parcelMemory.storage);
assert.deepEqual(parcelPage.bridge.restore(), livingStudy, "normal restore still returns the latest parcel's inputs");
assert.deepEqual(parcelPage.bridge.restoreParcel("gangnam_yeoksam"), officeStudy, "office inputs remain attached to their parcel");
assert.deepEqual(parcelPage.bridge.restoreParcel("seongdong_seongsu"), hotelStudy, "hotel type and its floor count remain attached to their parcel");
assert.deepEqual(parcelPage.bridge.restoreParcel("mapo_hapjeong"), livingStudy, "coliving program remains attached to its parcel");
assert.equal(parcelPage.bridge.restoreParcel("jongno_euljiro"), null, "an unsaved parcel falls back to its preset");
for (const key of ["unknown", "__proto__", "constructor", null]) assert.equal(parcelPage.bridge.restoreParcel(key), null, "unrecognized parcel keys are rejected");
const parcelRecord = JSON.parse(parcelMemory.storage.get(parcelMemory.bridge.storageKey));
assert.equal(Object.keys(parcelRecord.perParcel).length, 3);
for (const study of Object.values(parcelRecord.perParcel)) {
  for (const key of ["lastComputed", "lawSyncedMeta", "isRecording", "selectedFloorLevel"]) assert.equal(Object.hasOwn(study, key), false, `${key} never enters per-parcel memory`);
}

const legacyRecord = { version: 1, savedAt: Date.now(), inputs: input };
const legacyPage = fixture(new Map([[parcelMemory.bridge.storageKey, JSON.stringify(legacyRecord)]]));
assert.deepEqual(legacyPage.bridge.restore(), legacyPage.bridge.sanitize(input), "legacy v1 latest inputs still restore");
assert.deepEqual(legacyPage.bridge.restoreParcel(input.parcelKey), legacyPage.bridge.sanitize(input), "legacy v1 study becomes the matching parcel's memory");
assert.equal(legacyPage.bridge.restoreParcel("gangnam_yeoksam"), null);
legacyPage.bridge.attach(() => ({ ...input, parcelKey: "gangnam_yeoksam" }));
legacyPage.bridge.ready();
assert.deepEqual(legacyPage.bridge.restoreParcel(input.parcelKey), legacyPage.bridge.sanitize(input), "saving another parcel upgrades legacy memory without losing it");

const damagedMapRecord = {
  version: 1, savedAt: Date.now(), inputs: { ...input, parcelKey: "mapo_hapjeong" },
  perParcel: {
    unknown: { ...input, parcelKey: "unknown" },
    gangnam_yeoksam: { ...input, parcelKey: "jongno_euljiro" },
    seongdong_seongsu: { ...input, hotelType: "unsafe", spaceProgram: "unsafe", siteAreaSqm: -1 },
    jongno_euljiro: { ...input, parcelKey: "jongno_euljiro", buildingUse: "숙박시설(호텔)", hotelType: "general", floorsAbove: "7" },
    custom_seoul: null
  }
};
const damagedMap = fixture(new Map([[parcelMemory.bridge.storageKey, JSON.stringify(damagedMapRecord)]]));
assert.equal(damagedMap.bridge.restoreParcel("gangnam_yeoksam"), null, "a map entry cannot masquerade as another parcel");
assert.equal(damagedMap.bridge.restoreParcel("custom_seoul"), null);
const cleanedMapStudy = damagedMap.bridge.restoreParcel("seongdong_seongsu");
for (const key of ["hotelType", "spaceProgram", "siteAreaSqm", "lastComputed", "lawSyncedMeta"]) assert.equal(Object.hasOwn(cleanedMapStudy, key), false, `map entry sanitizes ${key}`);
assert.equal(damagedMap.bridge.restoreParcel("jongno_euljiro").hotelType, "general");
assert.equal(damagedMap.bridge.restoreParcel("jongno_euljiro").floorsAbove, 7);
damagedMap.bridge.attach(() => damagedMap.bridge.restore());
damagedMap.bridge.ready();
const cleanedMapRecord = JSON.parse(damagedMap.storage.get(damagedMap.bridge.storageKey));
assert.deepEqual(Object.keys(cleanedMapRecord.perParcel).sort(), ["jongno_euljiro", "mapo_hapjeong", "seongdong_seongsu"], "writing drops invalid keys and mismatched studies");

const linkContext = { chapter: "chap-finance", tab: "tab-finance", drawer: "drawerSourcesUses", returnTo: "#feasibility" };
const url = original.bridge.buildUrl("dashboard.html", linkContext);
const contextPage = fixture(undefined, new URL(url, original.host.location).href);
assert.deepEqual(contextPage.bridge.getContext(), linkContext);
assert.equal(original.bridge.buildUrl("https://example.com/", linkContext), "");
assert.equal(original.bridge.buildUrl("javascript:alert(1)", linkContext), "");
const badContext = original.bridge.buildUrl("dashboard.html?tab=made-up", { chapter: "__proto__", drawer: "page-header", returnTo: "https://example.com" });
assert.equal(badContext, "/dashboard.html");
assert.equal(original.bridge.buildUrl("./#studio"), "/#studio");

input.clipPlanePct = 44;
original.documentEvents.click({ target: { closest: () => ({ tagName: "A", dataset: {}, getAttribute: () => "dashboard.html" }) } });
assert.equal(original.bridge.restore().clipPlanePct, 44, "a link captures scene-only edits before navigating");
input.showDimensions = false;
original.events.pagehide();
assert.equal(original.bridge.restore().showDimensions, false, "pagehide also captures unsaved scene-only edits");

// Exercise the real preset loader and common form synchronization. Calculated
// presentation updates are isolated; the engine's existing tests cover math.
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, { classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, style: {} });
  return elements.get(id);
};
const appEvents = {};
const appWindow = {
  AtelierWorkspace: secondPage.bridge,
  addEventListener(name, listener) { appEvents[name] = listener; },
  dispatchEvent: () => secondPage.events["atelier:updated"]()
};
const appContext = vm.createContext({
  window: appWindow, document: { getElementById: element, querySelectorAll: () => [] }, console
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../app.js"), "utf8"), appContext, { filename: "app.js" });
vm.runInContext("updateAllCalculationsAndUI = () => window.dispatchEvent();", appContext);
appContext.savedInputs = restored;
vm.runInContext("window.AtelierWorkspace.attach(() => state); loadParcelPreset(savedInputs.parcelKey, savedInputs); window.AtelierWorkspace.ready();", appContext);
const loaded = JSON.parse(vm.runInContext("JSON.stringify(window.AtelierWorkspace.sanitize(state))", appContext));
assert.deepEqual(loaded, restored, "the actual loader applies the validated session after setting preset defaults");
const valueChecks = {
  parcelSelect: "seongdong_seongsu", inputSiteArea: 2800, sliderFloorsAbove: 12,
  sliderFacadeWwr: 55, sliderQuickClip: 65, sliderClipPlane: 65, sliderSunHour: 13.25,
  sliderFacadePanelDepth: 65, sliderFacadeJoint: 12, sliderFacadeLouverAngle: -35,
  sliderLpSharePct: 85, sliderLpHurdlePct: 8, sliderGpPromotePct: 35,
  selectCoreType: "split", selectMixedUseProfile: "knowledge_ind", inputLoanLtv: 68, inputLoanRate: 6.4,
  inputLegalFarCap: 325, inputLegalBcrCap: 42, inputLegalHeightCap: 55.5,
  selectParkingMode: "report", selectParkingDistrict: "restricted", selectResidentialType: "apartment",
  selectHousingPermitType: "housing_approval", inputHousingUnitArea: 50, inputHousingUnits: 24
};
for (const [id, value] of Object.entries(valueChecks)) assert.equal(element(id).value, value, `restored ${id}`);
assert.equal(element("chkParcelMerger").checked, true);
assert.equal(element("chkShowDimensions").checked, true);
assert.equal(element("activeOptionLabel").textContent, "Option B");
assert.equal(element("valSunHour").textContent, "13:15");
assert.equal(element("valLpSharePct").textContent, "LP 85% : GP 15%");
assert.equal(element("valClipPlane").textContent, "65% 단면절단");
assert.deepEqual(secondPage.bridge.restore(), restored, "first initialized update keeps the restored study");

// A cached atelier page must see edits made in the detailed dashboard, even
// though restoring that document does not emit DOMContentLoaded again.
input.floorsAbove = 18;
input.lpSharePct = 90;
input.claddingMaterial = "champagne_bronze";
Object.assign(input, { facadePanelDepthMm: 90, facadeJointMm: 5, facadeLouverAngleDeg: 40 });
Object.assign(input, { legalFarCapPct: 248, legalBcrCapPct: 38, maxHeightM: 48.2,
  parkingMode: "fit", parkingDistrict: "standard", residentialType: "officetel",
  housingPermitType: "building_permit", housingUnitAreaSqm: 30, housingUnits: 40 });
original.bridge.save();
appEvents.pageshow({ persisted: false });
assert.equal(element("sliderFloorsAbove").value, 12, "a normal pageshow does not reinitialize the study");
appEvents.pageshow({ persisted: true });
assert.equal(element("sliderFloorsAbove").value, 18, "BFCache return restores the latest floor count");
assert.equal(element("sliderLpSharePct").value, 90, "BFCache return resynchronizes finance controls");
assert.equal(vm.runInContext("state.claddingMaterial", appContext), "champagne_bronze");
for (const [id, value] of Object.entries({ sliderFacadePanelDepth: 90, sliderFacadeJoint: 5, sliderFacadeLouverAngle: 40 })) {
  assert.equal(element(id).value, value, `BFCache return restores physical detail ${id}`);
}
assert.equal(vm.runInContext("state.clipPlanePct", appContext), 44, "BFCache return restores scene-only edits too");
for (const [id, value] of Object.entries({
  inputLegalFarCap: 248, inputLegalBcrCap: 38, inputLegalHeightCap: 48.2,
  selectParkingMode: "fit", selectParkingDistrict: "standard", selectResidentialType: "officetel",
  selectHousingPermitType: "building_permit", inputHousingUnitArea: 30, inputHousingUnits: 40
})) assert.equal(element(id).value, value, `BFCache return restores legal condition ${id}`);
assert.deepEqual(secondPage.bridge.restore(), original.bridge.sanitize(input), "the cached page keeps the latest study during recalculation");

console.log("Workspace state: per-parcel study memory, legacy v1 compatibility, full design/finance/legal/facade-detail round trip, bounds/enums, unavailable storage, navigation context, startup ordering, real form synchronization and BFCache return passed.");
