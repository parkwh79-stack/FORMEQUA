"use strict";
// Run: node tests/api-analysis.test.js
const assert = require("node:assert/strict");
const { analyze, capabilities, openapi, ValidationError } = require("../analysis-engine.js");
const base = { parcelKey: "custom_seoul", inputs: { siteAreaSqm: 5000, zoning: "제3종일반주거지역", roadWidthM: 20, northSolar: false, floorsAbove: 15, targetBcr: 50, parkingMode: "report" } };
const office = analyze({ ...base, program: "office" });
const officetel = analyze({ ...base, program: "officetel" });
const hotel = analyze({ program: "hotel", parcelKey: "gangnam_yeoksam", inputs: { floorsAbove: 6, hotelType: "tourist", parkingMode: "report" }, floorLevel: 3 });
const dwelling = analyze({ program: "housing", inputs: { floorsAbove: 6, parkingMode: "report" } });
const living = analyze({ program: "living", inputs: { buildingUse: "공동주택(주상복합)", residentialType: "apartment", floorsAbove: 6, parkingMode: "report" } });
for (const result of [office, officetel, hotel, dwelling, living]) {
  assert.equal(result.apiVersion, "1.0");
  assert.ok(result.model.floorPlates.length > 0);
  assert.ok(result.model.areas.achievedFarPct <= result.model.zoningRule.maxFar + 1e-6);
  assert.ok(result.model.areas.achievedBcrPct <= result.model.zoningRule.maxBcr + 1e-6);
  assert.equal(result.evidence.isPermitConfirmation, false);
  assert.equal(result.model.usePermission.isPermitConfirmation, false);
  assert.equal(result.model.finance.monthlyEquityCf.length, result.model.finance.totalMonths);
  assert.equal(result.model.finance.monthlyProjectCf.length, result.model.finance.monthlyEquityCf.length);
  assert.ok(result.model.parking.breakdown.length > 0);
  assert.ok(result.plan.rooms.length > 0 && result.plan.doors.length > 0 && result.plan.furniture.length > 0);
  assert.equal(result.plan.level, result.model.floorPlates.find(fp => fp.level === result.plan.level).level);
}
const officeSqm = office.model.floorPlates.filter(fp => fp.use === "main").reduce((sum, fp) => sum + fp.areaSqm, 0);
const officetelSqm = officetel.model.floorPlates.filter(fp => fp.use === "residential").reduce((sum, fp) => sum + fp.areaSqm, 0);
assert.ok(officeSqm > 2900 && officeSqm < 3000, "actual office plates follow the strict 3,000 sqm area cap");
assert.ok(officetelSqm > 2900 && officetelSqm < 3000, "actual officetel plates follow the same legal business-area cap");
assert.ok(office.plan.metrics.workstationCount > 0, "office receives fitted workstations");
assert.ok(officetel.plan.metrics.dwellingUnitCount > 0, "officetel receives independent dwellings");
assert.ok(hotel.plan.metrics.guestRoomCount > 0 && hotel.plan.metrics.guestBedCount > 0, "hotel receives real guest rooms, beds and bathrooms");
assert.equal(hotel.plan.level, 3);
assert.ok(dwelling.plan.metrics.dwellingUnitCount > 0);
assert.ok(living.plan.metrics.privateRoomCount > 0 && living.plan.metrics.sharedSpaceCount > 0);
assert.equal(living.inputs.residentialType, "apartment");
assert.equal(living.inputs.spaceProgram, "coliving");
assert.equal(living.plan.metrics.dwellingUnitCount, 0, "shared co-living rooms do not become independent dwellings");
assert.ok(hotel.limitations.some(text => text.includes("ADR")), "hotel rental-model limitation is included");
const prohibited = analyze({ program: "hotel", inputs: { zoning: "제2종일반주거지역", hotelType: "general", floorsAbove: 4, parkingMode: "report" } });
assert.equal(prohibited.model.usePermission.status, "prohibited");
assert.equal(prohibited.model.usePermission.canUseForStudy, false);
assert.ok(prohibited.model.floorPlates.length > 0, "prohibited comparison remains explicitly marked");
const mixed = analyze({ program: "office", inputs: { residentialType: "apartment", floorUseOverrides: { "3": "residential" }, floorsAbove: 6, parkingMode: "report" }, floorLevel: 3 });
assert.equal(mixed.inputs.residentialType, "apartment", "mixed-use residential classification follows the explicit browser control");
assert.equal(mixed.plan.use, "residential");
assert.ok(mixed.model.usePermission.entries.some(entry => entry.key === "apartment"));
for (const program of ["knowledge", "retail", "sales"]) assert.equal(analyze({ program }).program, program);
for (const request of [
  null, [], {}, { program: "logistics" }, { program: "office", parcelKey: "unknown" },
  { program: "office", extra: 1 }, { program: "office", inputs: [] },
  { program: "office", inputs: { secret: true } }, { program: "office", inputs: { floorsAbove: 5.5 } },
  { program: "office", inputs: { siteAreaSqm: "500" } }, { program: "office", inputs: { roadWidthM: Infinity } },
  { program: "office", inputs: { siteAreaSqm: 1 } }, { program: "office", inputs: { northSolar: 1 } },
  { program: "office", inputs: { hotelType: "something" } }, { program: "office", inputs: { floorUseOverrides: { "0": "main" } } },
  { program: "office", inputs: { floorUseOverrides: { "3": "industrial" } } },
  { program: "office", inputs: { floorsAbove: 3, floorUseOverrides: { "5": "hotel" } } },
  { program: "office", inputs: { buildingUse: "숙박시설(호텔)" } },
  { program: "hotel", inputs: { spaceProgram: "coliving" } },
  { program: "office", floorLevel: 0 }, { program: "office", floorLevel: 35, inputs: { floorsAbove: 3 } }
]) assert.throws(() => analyze(request), ValidationError);
const cap = capabilities(), schema = openapi();
assert.deepEqual(cap.programs, schema.components.schemas.AnalysisRequest.properties.program.enum);
assert.equal(cap.maxRequestBytes, 65536);
assert.ok(schema.paths["/api/v1/analysis"].post);
// A returned input snapshot can be re-evaluated without a second routing system.
const repeated = analyze({ program: "hotel", parcelKey: hotel.inputs.parcelKey, inputs: hotel.inputs, floorLevel: hotel.plan.level });
assert.deepEqual(repeated.model, hotel.model);
assert.deepEqual(repeated.plan, hotel.plan);
console.log("Analysis API engine passed: all eight programs; actual office/officetel area caps; hotel, dwelling and co-living plans; prohibited-use labels; strict input rejection and reproducible snapshots.");
