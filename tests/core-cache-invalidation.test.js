"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const finance = require("../finance-model.js");
const planner = require("../interior-plan.js");
const { planCore } = require("../core-layout.js");
const study = require("../dashboard-study.js");

const fp = { level: 7, use: "hotel", widthM: 32.173, depthM: 28.219, northShiftM: 1.137,
  zBottom: 24, zTop: 28, areaSqm: 32.173 * 28.219 };
const baseLayout = planCore({ ...fp, coreType: "center" });
const movedLayout = structuredClone(baseLayout);
movedLayout.cores[0].minZ += 1.25; movedLayout.cores[0].maxZ += 1.25;
const failedLayout = { ...structuredClone(baseLayout), status: "unfeasible" };
assert.equal(baseLayout.status, "reserved");
let calls = 0;
const trackedPlanner = { generate(floor, options) { calls++; return planner.generate(floor, options); } };
const params = { ...finance.defaults, financeMode: "hotel", buildingUse: "숙박시설(호텔)", coreType: "center", option: "A",
  hotelAdrKrw: 200000, hotelRoomsOverride: 0, rentPyeongMan: 10 };
const income = (layout, overrides = {}) => finance.calculate({ ...params, ...overrides }, [{ ...fp, coreLayout: layout }], { planner: trackedPlanner });
const initial = income(baseLayout), initialCalls = calls;
assert.ok(initial.hotel.generatedGuestRooms > 0, "real hotel floor generates occupied room modules");
assert.equal(initialCalls, 1);
assert.equal(income(structuredClone(baseLayout), { hotelAdrKrw: 300000 }).hotel.generatedGuestRooms, initial.hotel.generatedGuestRooms);
assert.equal(calls, initialCalls, "equivalent core geometry and finance-only edits reuse the plan");
const moved = income(movedLayout);
assert.equal(calls, initialCalls + 1, "same floor dimensions with a moved common core invalidate cached room quantities");
assert.equal(moved.hotel.generatedGuestRooms, planner.generate({ ...fp, coreLayout: movedLayout }, params).metrics.guestRoomCount);
const failed = income(failedLayout);
assert.equal(calls, initialCalls + 2, "reservation status change also invalidates cached quantities");
assert.equal(failed.hotel.generatedGuestRooms, 0, "infeasible core never retains a previous occupied-room count");
assert.equal(failed.hotel.roomRevenueEok, 0, "stale rooms cannot create hotel revenue");
assert.ok(initial.hotel.roomRevenueEok > failed.hotel.roomRevenueEok);
income(baseLayout); assert.equal(calls, initialCalls + 2, "returning to the original core reuses its own cached result");
income(null); const afterNull = calls;
const legacy = finance.calculate(params, [{ ...fp }], { planner: trackedPlanner });
assert.equal(calls, afterNull + 1, "explicit missing shared core differs from legacy unassigned single-floor planning");
assert.ok(legacy.hotel.generatedGuestRooms > 0);
const override = finance.calculate({ ...params, coreLayout: failedLayout }, [{ ...fp, coreLayout: baseLayout }], { planner: trackedPlanner });
assert.equal(override.hotel.generatedGuestRooms, 0, "explicit planner options have the same core precedence in the cache");

const options = study.planOptions(params);
const sig = layout => study.planSignature({ ...fp, coreLayout: layout }, options);
assert.equal(sig(baseLayout), sig(structuredClone(baseLayout)), "equivalent shared drawing geometry has the same signature");
assert.notEqual(sig(baseLayout), sig(movedLayout), "dashboard redraws when only the common core moves");
assert.notEqual(sig(baseLayout), sig(failedLayout), "dashboard redraws when only the common core status changes");
assert.notEqual(sig(null), study.planSignature(fp, options), "dashboard distinguishes unavailable core from unassigned legacy planning");
assert.equal(study.planSignature({ ...fp, coreLayout: movedLayout }, { ...options, coreLayout: baseLayout }),
  study.planSignature({ ...fp, coreLayout: failedLayout }, { ...options, coreLayout: baseLayout }), "explicit shared layout overrides floor metadata");

// Exercise the actual private viewer signature without geometry/DOM/GPU mocks
// replacing the signature itself. Event callbacks are registered but not run.
const context = vm.createContext({ window: { addEventListener() {} }, document: {}, state: { ...params, daylightTheme: true } });
let source = fs.readFileSync(path.join(__dirname, "../interior-viewer.js"), "utf8");
source = source.replace(/\}\)\(\);\s*$/, "window.coreSignatureTest = { setFloor: fp => { floor = fp; }, signature };\n})();");
vm.runInContext(source, context, { filename: "interior-viewer.js" });
const viewer = context.window.coreSignatureTest;
viewer.setFloor({ ...fp, coreLayout: baseLayout }); const before = viewer.signature();
viewer.setFloor({ ...fp, coreLayout: movedLayout }); assert.notEqual(viewer.signature(), before, "visible interior refreshes for moved shared core");
viewer.setFloor({ ...fp, coreLayout: failedLayout }); assert.notEqual(viewer.signature(), before, "visible interior refreshes for failed reservation");
viewer.setFloor({ ...fp, coreLayout: structuredClone(baseLayout), income: { annualNoiEok: 100 }, estMonthlyRentMan: 500 });
assert.equal(viewer.signature(), before, "finance-only ledger updates do not reopen the interior/reset its camera");
viewer.setFloor({ ...fp, coreLayout: baseLayout, widthM: 30 }); assert.notEqual(viewer.signature(), before, "floor geometry changes still rebuild the viewer");
viewer.setFloor({ ...fp, coreLayout: null }); const nullViewer = viewer.signature();
viewer.setFloor(fp); assert.notEqual(viewer.signature(), nullViewer, "viewer retains the explicit-null versus unassigned distinction");
console.log("Core cache invalidation: real hotel room/revenue refresh, dashboard SVG signature, viewer refresh and stable camera for finance-only edits passed.");
