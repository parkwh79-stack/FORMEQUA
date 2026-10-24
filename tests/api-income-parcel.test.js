"use strict";
const assert = require("node:assert/strict");
const { analyze, capabilities, openapi, ValidationError } = require("../analysis-engine.js");
const dashboard = require("../dashboard-study.js");
const { generate } = require("../interior-plan.js");
const input = { financeMode: "hotel", hotelType: "general", hotelAdrKrw: 210000, hotelOccupancyPct: 73,
  hotelRoomsOverride: 0, hotelAncillaryRevenuePct: 17, hotelOpexPct: 57, hotelFixedOpexEok: 0.8,
  hotelFfeReservePct: 4, hotelManagementFeePct: 3, hotelResidentialDistanceM: null,
  hotelResidentialBarrier: null, floorsAbove: 6, parkingMode: "report", parcelData: null };
const result = analyze({ program: "hotel", parcelKey: "custom_seoul", inputs: input });
assert.equal(result.model.finance.financeMode, "hotel");
const income = result.model.finance.income;
assert.ok(income.hotel.effectiveGuestRooms > 0);
const count = result.model.floorPlates.filter(fp => fp.use === "hotel").reduce((sum, fp) => sum + generate(fp, result.inputs).metrics.guestRoomCount, 0);
assert.equal(income.hotel.generatedGuestRooms, count);
assert.equal(result.inputs.hotelResidentialDistanceM, null);
assert.equal(result.inputs.hotelResidentialBarrier, null);
assert.equal(result.evidence.boundaryApplied, false);
assert.ok(result.limitations.some(text => text.includes("ADR") && text.includes("FF&E")));
assert.ok(!result.limitations.some(text => text.includes("모델은 별도 고도화")));
const request = dashboard.analysisRequest(result.inputs, result.plan.level);
for (const [key, value] of Object.entries(input)) assert.deepEqual(request.inputs[key], value, "dashboard preserves " + key);
const replay = analyze(request);
assert.deepEqual(replay.model, result.model);
assert.deepEqual(replay.plan, result.plan);
const high = analyze({ ...request, inputs: { ...request.inputs, hotelAdrKrw: 290000 } });
assert.ok(high.model.finance.stabilizedNoiEok > result.model.finance.stabilizedNoiEok);
assert.ok(high.model.finance.grossExitValueEok > result.model.finance.grossExitValueEok);
assert.ok(high.model.finance.dscr > result.model.finance.dscr);
assert.notDeepEqual(high.model.finance.monthlyEquityCf, result.model.finance.monthlyEquityCf);
const noHotel = analyze({ program: "office", inputs: { financeMode: "hotel", hotelResidentialDistanceM: null, hotelResidentialBarrier: false, parkingMode: "report" } });
assert.equal(noHotel.model.finance.financeMode, "rental");
assert.ok(noHotel.model.finance.income.warnings.length);
for (const [key, values] of Object.entries({ financeMode: ["bad", null], hotelAdrKrw: [-1, "210000", Infinity],
  hotelOccupancyPct: [-1, 101, null], hotelRoomsOverride: [-1, 1.5, 5001], hotelFixedOpexEok: [-1, "1"],
  hotelResidentialDistanceM: ["", "50", -1, 10001, NaN], hotelResidentialBarrier: ["yes", 1] })) {
  for (const value of values) assert.throws(() => analyze({ program: "hotel", inputs: { [key]: value } }), ValidationError, key + " rejects " + value);
}
function feature(minLon, maxLon) {
  return { type: "Feature", properties: { pnu: "1111010100100010000", address: "입력 경계 검토용" },
    geometry: { type: "Polygon", coordinates: [[[minLon,37.56],[maxLon,37.56],[maxLon,37.5605],[minLon,37.5605],[minLon,37.56]]] } };
}
const parcelData = { version: 1, source: "import", fetchedAt: "2026-10-21T00:00:00Z", features: [feature(126.98,126.9804), feature(126.9804,126.9807)] };
const parcel = analyze({ program: "office", parcelKey: "custom_seoul", inputs: { parcelData, parcelMerged: true, parkingMode: "report", floorsAbove: 5 } });
assert.equal(parcel.evidence.boundaryApplied, true);
assert.equal(parcel.evidence.liveParcelVerified, false);
assert.equal(parcel.evidence.isPermitConfirmation, false);
assert.equal(parcel.model.parcelGeometry.featureCount, 2);
assert.equal(parcel.model.zoningRule.isMerged, true);
assert.ok(Math.abs(parcel.model.effectiveCadastralAreaSqm - parcel.model.parcelGeometry.areaSqm) < 1e-7);
const parcelRequest = dashboard.analysisRequest(parcel.inputs, parcel.plan?.level);
assert.deepEqual(parcelRequest.inputs.parcelData, parcelData);
assert.deepEqual(analyze(parcelRequest).model, parcel.model);
const disconnected = { ...parcelData, features: [feature(126.98,126.9804), feature(126.99,126.9904)] };
for (const invalid of ["raw", [], {}, { ...parcelData, version: 2 }, { ...parcelData, source: "verified" }, disconnected])
  assert.throws(() => analyze({ program: "office", inputs: { parcelData: invalid } }), ValidationError);
const caps = capabilities(), schema = openapi(), properties = schema.components.schemas.AnalysisRequest.properties.inputs.properties;
for (const key of Object.keys(input)) { assert.ok(caps.allowedInputs.includes(key)); assert.ok(properties[key]); }
assert.deepEqual(properties.hotelResidentialDistanceM.type, ["number", "null"]);
assert.deepEqual(properties.hotelResidentialBarrier.type, ["boolean", "null"]);
assert.equal(schema.components.schemas.ParcelData.properties.features.maxItems, 5);
assert.equal(caps.maxRequestBytes, 65536);
const allInputSentinels = Object.fromEntries(caps.allowedInputs.map(key => [key, 123]));
allInputSentinels.parcelKey = "custom_seoul"; allInputSentinels.buildingUse = "업무시설(오피스)";
const allKeys = dashboard.analysisRequest(allInputSentinels).inputs;
assert.deepEqual(Object.keys(allKeys).sort(), caps.allowedInputs.filter(key => key !== "parcelKey").sort(), "dashboard request forwards every API editable key");
console.log("API income/parcel integration passed: shared hotel operations, strict finite/nullable inputs, exact dashboard request snapshots, real boundary union, rejected disconnected merge, OpenAPI and capability contracts.");
