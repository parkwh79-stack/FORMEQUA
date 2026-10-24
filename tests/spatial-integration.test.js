"use strict";

// Cross-module boundaries only. Individual geometric algorithms have separate
// tests. No upstream engines, live services, Revit or browser GPU are required.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const api = require("../analysis-engine.js"), study = require("../dashboard-study.js");
const spatial = require("../spatial-settings.js"), interior = require("../interior-plan.js");
const hotel = require("../hotel-modules.js"), navigation = require("../spatial-navigation.js");
const bim = require("../bim-handoff.js");
const near = (a, b, label) => assert.ok(Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(b)), label + ": " + a + " vs " + b);

const newSettings = {
  officeDeskType: "bench", officeOrientation: "90", officeDeskWidthM: 1.4, officeDeskDepthM: .7,
  officeAisleWidthM: 1.2, officeRowGapM: .9, officeBackClearanceM: .9,
  officeCollaborationPct: 0, officeTargetSeats: 9,
  officeRoomRequirements: { "L4-R1": { deskType: "standing", orientation: "0", targetSeats: 2 } },
  layoutObstacles: [{ id: "fixed-4", level: 4, minX: -.3, maxX: .3, minZ: -.3, maxZ: .3, kind: "fixed" }],
  hotelTwinPct: 30, hotelSuitePct: 15, hotelServiceEveryRooms: 8,
  hotelTwinAdrFactor: 1.25, hotelSuiteAdrFactor: 2, navigationClearanceM: .24
};
const uiInputs = { parcelKey: "custom_seoul", option: "A", buildingUse: "업무시설(오피스)", spaceProgram: "standard",
  coreType: "north", modelDetail: "concept", siteAreaSqm: 1800, zoning: "일반상업지역", northSolar: false,
  floorsAbove: 5, floorsBelow: 0, targetBcr: 55, floorHeight: 4, parkingMode: "report", hotelAdrKrw: 210000,
  hotelOccupancyPct: 75, hotelRoomsOverride: 0, ...newSettings, transientUiOnly: "never-an-api-input" };

// All editable settings must cross both the browser request and API schema.
const request = study.analysisRequest(uiInputs, 4), options = study.planOptions(uiInputs, { representation: { detailLevel: "concept" } });
assert.equal(request.parcelKey, "custom_seoul"); assert.equal(request.program, "office"); assert.equal(request.floorLevel, 4);
assert.equal(request.inputs.transientUiOnly, undefined);
assert.equal(options.parcelKey, uiInputs.parcelKey); assert.equal(options.option, uiInputs.option);
assert.equal(options.hotelAdrKrw, uiInputs.hotelAdrKrw);
for (const key of spatial.keys) {
  assert.deepEqual(request.inputs[key], uiInputs[key], "browser request preserves " + key);
  assert.deepEqual(options[key], uiInputs[key], "browser interior options preserve " + key);
  assert.ok(api.capabilities().allowedInputs.includes(key), "capabilities advertise " + key);
  assert.ok(api.openapi().components.schemas.AnalysisRequest.properties.inputs.properties[key], "OpenAPI advertises " + key);
}
const originalSettings = JSON.stringify(newSettings);
const normalizedRequest = api.validateRequest(request);
for (const key of spatial.keys) assert.deepEqual(normalizedRequest.inputs[key], uiInputs[key], "API retains actual " + key);
assert.equal(api.capabilities().maxRequestBytes, 65536);

const invalidSettings = [
  { officeOrientation: 90 }, { officeDeskType: "automatic" }, { officeDeskWidthM: "1.4" }, { officeDeskDepthM: .5 },
  { officeAisleWidthM: Infinity }, { officeRowGapM: 3 }, { officeBackClearanceM: NaN },
  { officeCollaborationPct: 41 }, { officeTargetSeats: 3.5 }, { hotelTwinPct: 90, hotelSuitePct: 20 },
  { hotelServiceEveryRooms: 1.5 }, { hotelTwinAdrFactor: .4 }, { hotelSuiteAdrFactor: 5.1 },
  { navigationClearanceM: .5 }, { officeRoomRequirements: [] },
  { officeRoomRequirements: { "L4-R1": { unknown: true } } },
  { officeRoomRequirements: { "L4-R1": { orientation: 90 } } },
  { officeRoomRequirements: JSON.parse('{"__proto__":{"targetSeats":1}}') },
  { layoutObstacles: [{ ...newSettings.layoutObstacles[0], guessedStructuralMember: true }] },
  { layoutObstacles: [{ ...newSettings.layoutObstacles[0], kind: "reference" }] },
  { layoutObstacles: [{ ...newSettings.layoutObstacles[0], level: 0 }] },
  { layoutObstacles: [newSettings.layoutObstacles[0], newSettings.layoutObstacles[0]] },
  { layoutObstacles: Array.from({ length: 65 }, (_, i) => ({ ...newSettings.layoutObstacles[0], id: "fixed-" + i })) }
];
for (const patch of invalidSettings) assert.throws(() => api.validateRequest({ program: "office", inputs: patch }), api.ValidationError, JSON.stringify(patch));
const uncoerced = study.analysisRequest({ ...uiInputs, officeTargetSeats: "9" });
assert.equal(uncoerced.inputs.officeTargetSeats, "9", "browser must not silently coerce invalid API input");
assert.throws(() => api.validateRequest(uncoerced), api.ValidationError);

const floor = { level: 4, use: "main", widthM: 32, depthM: 26, northShiftM: 0, zBottom: 12, zTop: 16, areaSqm: 832 };
const plan = interior.generate(floor, options);
assert.equal(plan.metrics.workstationCount, 9, "the current floor target caps all office rooms together");
assert.equal(plan.officeLayout.metrics.workstationCount, 9);
assert.equal(plan.furniture.filter(f => f.workstationId && f.type === "desk").length, 9);
assert.ok(plan.officeLayout.rooms.length > 1, "fixture exercises a target shared between several office rooms");
const overridden = plan.officeLayout.rooms.find(r => r.roomId === "L4-R1");
assert.equal(overridden.metrics.workstationCount, 2);
assert.equal(overridden.settings.deskType, "standing"); assert.equal(overridden.orientationDeg, 0);
assert.ok(overridden.workstations.every(w => w.desk.height === 1.05));
assert.equal(plan.obstacles.length, 1, "current-floor obstacle reaches actual plan");
assert.equal(interior.generate({ ...floor, level: 3 }, options).obstacles.length, 0, "floor scope does not leak obstacles to other storeys");
for (const patch of [{ officeTargetSeats: 8 }, { officeRoomRequirements: { "L4-R1": { targetSeats: 1 } } },
  { hotelSuiteAdrFactor: 2.2 }, { layoutObstacles: [] }, { navigationClearanceM: .3 }])
  assert.notEqual(study.planSignature(floor, options), study.planSignature(floor, study.planOptions({ ...uiInputs, ...patch })), "updated planning assumptions invalidate dashboard plan cache");
assert.equal(JSON.stringify(newSettings), originalSettings, "request/planning cannot mutate input settings");

// Real shared analysis engine, not a stubbed DTO, consumes the requested keys.
const officeResponse = api.analyze(request);
assert.equal(officeResponse.plan.level, 4);
assert.equal(officeResponse.plan.metrics.workstationCount, 9);
assert.equal(officeResponse.plan.officeLayout.rooms.find(r => r.roomId === "L4-R1").settings.deskType, "standing");
for (const key of spatial.keys) assert.deepEqual(officeResponse.inputs[key], uiInputs[key]);
const atLimitRequirements = Object.fromEntries(Array.from({ length: 128 }, (_, i) => ["L4-R" + (i + 1), { targetSeats: 0 }]));
const atLimitResponse = api.analyze({ ...request, inputs: { ...request.inputs, officeRoomRequirements: atLimitRequirements } });
assert.equal(Object.keys(atLimitResponse.inputs.officeRoomRequirements).length, 128, "the advertised API collection limit must also work in its actual planning module");
assert.equal(atLimitResponse.plan.status, "generated");
assert.throws(() => api.validateRequest({ program: "office", inputs: { officeRoomRequirements: { ...atLimitRequirements, "L4-R129": {} } } }), api.ValidationError);

// Type-aware hotel finance must reconcile with the same generated rooms that a
// dashboard floor preview and BIM handoff receive, excluding support rooms.
const hotelInputs = { ...uiInputs, buildingUse: "숙박시설(호텔)", financeMode: "hotel", hotelTwinPct: 40,
  hotelSuitePct: 20, hotelServiceEveryRooms: 6, hotelTwinAdrFactor: 1.2 };
delete hotelInputs.transientUiOnly;
const hotelResponse = api.analyze(study.analysisRequest(hotelInputs, 3));
const hotelPlan = hotelResponse.plan, preview = hotel.preview(hotelPlan, hotelResponse.inputs);
const income = hotelResponse.model.finance.income, floorLedger = income.floorIncome.find(r => r.level === hotelPlan.level);
assert.ok(preview.generatedTypeCounts.standard > 0 && preview.generatedTypeCounts.twin > 0 && preview.generatedTypeCounts.suite > 0);
assert.ok(hotelPlan.rooms.some(r => r.type === "hotel_service"), "fixture includes non-revenue support modules");
assert.equal(preview.generatedGuestRooms, hotelPlan.metrics.guestRoomCount);
assert.equal(floorLedger.generatedGuestRooms, preview.generatedGuestRooms);
assert.deepEqual(floorLedger.hotelRoomTypes.map(t => [t.type_id, t.generatedCount, t.adrKrw]), preview.roomTypes.map(t => [t.type_id, t.generatedCount, t.adrKrw]));
near(floorLedger.hotelRoomRevenueEok, preview.roomRevenueEok, "selected floor preview and finance ledger agree");
assert.equal(floorLedger.rentalAnnualGrossEok, 0, "hotel rooms cannot also earn floor rent in operating mode");
near(income.floorIncome.reduce((n, r) => n + r.annualNoiEok, 0), income.stabilizedNoiEok, "typed room ledger reconciles total NOI");
const allPlans = hotelResponse.model.floorPlates.map(fp => interior.generate(fp, study.planOptions(hotelResponse.inputs, hotelResponse.model)));
const wholePreview = hotel.preview(allPlans.flatMap(p => p.rooms), hotelResponse.inputs);
assert.equal(wholePreview.generatedGuestRooms, income.hotel.generatedGuestRooms);
near(wholePreview.roomRevenueEok, income.hotel.roomRevenueEok, "browser-generated rooms reconcile the entire hotel revenue model");

// The actual planning-control handlers pass the selected navigation polyline
// unchanged to WebGL, and SVG transforms exactly those same local metre points.
function mountedSpatialReview(detail) {
  const nodes = new Map(), listeners = {}, dispatched = [];
  let lastNavigation = null;
  class Element {
    constructor() { this.listeners = {}; this.children = []; this.value = ""; this.textContent = ""; this.disabled = false; }
    set innerHTML(value) { this.html = value; for (const m of value.matchAll(/\bid="([^"]+)"/g)) if (!nodes.has(m[1])) nodes.set(m[1], new Element()); }
    get innerHTML() { return this.html || ""; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    emit(name, extra = {}) { return this.listeners[name]?.({ target: this, ...extra }); }
    insertBefore(child) { this.children.push(child); }
    querySelectorAll() { return []; }
  }
  nodes.set("realyticsStudyPanel", new Element());
  const document = { getElementById: id => nodes.get(id) || null, createElement: () => new Element() };
  const host = { document, AtelierSpatialSettings: spatial, AtelierDashboardStudy: study,
    AtelierInteriorPlan: interior, AtelierBimHandoff: bim,
    AtelierSpatialNavigation: { analyze(p, o) { lastNavigation = navigation.analyze(p, o); return lastNavigation; } },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    dispatchEvent(event) { dispatched.push(event); for (const fn of listeners[event.type] || []) fn(event); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../spatial-review.js"), "utf8"), { window: host, CustomEvent });
  host.dispatchEvent({ type: "atelier:plan-selected", detail });
  nodes.get("spatialNavRun").emit("click");
  return { nodes, dispatched, result: lastNavigation };
}
const selected = mountedSpatialReview({ plan, floor, inputs: { ...uiInputs }, model: { floorPlates: [floor], parcelGeometry: null } });
assert.equal(selected.result.status, "analyzed");
const route = selected.result.paths.find(p => p.status === "reachable" && p.points.length > 1);
assert.ok(route, "actual furnished office has at least one analyzed internal approach");
selected.nodes.get("spatialPaths").emit("change", { target: { value: route.id } });
assert.equal(selected.nodes.get("spatialRoute3d").disabled, false);
selected.nodes.get("spatialRoute3d").emit("click");
const routeEvent = selected.dispatched.findLast(e => e.type === "atelier:navigation-path" && e.detail.points.length > 1);
assert.equal(routeEvent.detail.level, floor.level);
assert.deepEqual(routeEvent.detail.points, route.points, "WebGL receives the analyzer's selected points, not a new centre-to-centre line");
const svg = selected.nodes.get("spatialNavDrawing").innerHTML;
const svgPoints = svg.match(/<polyline points="([^"]+)"/)[1].split(" ").map(s => s.split(",").map(Number));
assert.equal(svgPoints.length, route.points.length);
svgPoints.forEach((p, i) => {
  assert.ok(Math.abs((p[0] - 42) / 24 + plan.bounds.minX - route.points[i].x) < .00003, "SVG uses identical route X");
  assert.ok(Math.abs((p[1] - 42) / 24 + plan.bounds.minZ - route.points[i].z) < .00003, "SVG uses identical route Z");
});
assert.equal(route.isEgressVerified, false);
assert.match(selected.nodes.get("spatialNavWarnings").textContent, /법정 유효폭은 검증하지/);

const handoffOptions = { plans: allPlans, parcelKey: hotelResponse.inputs.parcelKey, option: "A", createdAt: "2026-10-21T00:00:00.000Z" };
const pack = bim.buildHandoff(hotelResponse.model, handoffOptions);
const objectIds = p => [...p.storeys, ...p.rooms, ...p.walls, ...p.doors].map(o => o.id).sort();
const originalIds = new Set(objectIds(pack));
for (const patch of [{ option: "B" }, { parcelKey: "gangnam_yeoksam" }]) {
  const other = bim.buildHandoff(hotelResponse.model, { ...handoffOptions, ...patch });
  assert.ok(objectIds(other).every(id => !originalIds.has(id)), "BIM object identities distinguish parcel and option scope");
}
const reordered = bim.buildHandoff({ ...hotelResponse.model, floorPlates: hotelResponse.model.floorPlates.slice().reverse() },
  { ...handoffOptions, plans: allPlans.slice().reverse().map(p => ({ ...p, rooms: p.rooms.slice().reverse(), walls: p.walls.slice().reverse(), doors: p.doors.slice().reverse() })) });
assert.deepEqual(objectIds(reordered), objectIds(pack), "iteration order cannot renumber source object identities");
const hotelFloor = hotelResponse.model.floorPlates.find(fp => fp.level === 3);
const hotelA = interior.generate(hotelFloor, study.planOptions({ ...hotelResponse.inputs, option: "A" }, hotelResponse.model));
const hotelB = interior.generate(hotelFloor, study.planOptions({ ...hotelResponse.inputs, option: "B" }, hotelResponse.model));
const hotelOtherParcel = interior.generate(hotelFloor, study.planOptions({ ...hotelResponse.inputs, parcelKey: "gangnam_yeoksam" }, hotelResponse.model));
const modules = p => new Set(p.rooms.filter(r => r.moduleId).map(r => r.moduleId));
const aModules = modules(hotelA);
assert.ok(aModules.size > 0);
assert.ok([...modules(hotelB)].every(id => !aModules.has(id)), "source hotel module IDs distinguish alternatives");
assert.ok([...modules(hotelOtherParcel)].every(id => !aModules.has(id)), "source hotel module IDs distinguish parcels");
const repriced = interior.generate(hotelFloor, study.planOptions({ ...hotelResponse.inputs, hotelAdrKrw: 300000 }, hotelResponse.model));
assert.deepEqual(modules(repriced), aModules, "pricing does not replace model identity");
assert.equal(pack.quantities.generatedHotelRooms, income.hotel.generatedGuestRooms);
assert.equal(pack.nativeExecution.performed, false); assert.equal(pack.isPermitModel, false);
console.log("Spatial integration passed: strict API/schema, dashboard settings/cache, actual office floor target and overrides, hotel preview/finance, UI route/SVG points, and scoped stable BIM IDs.");
