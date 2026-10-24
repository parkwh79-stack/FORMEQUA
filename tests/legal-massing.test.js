"use strict";

// The constraint mechanics use a small explicit rules fixture here. Verified
// ordinance values and classifications are tested separately in legal-rules.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const coreEngine = require("../core-layout.js"), parkingEngine = require("../parking-layout.js");
const EPS = 0.00002;
const inertElement = { classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, style: {} };
const legalFixture = {
  rulesFor(params, table) {
    const base = table[params.zoning] || table["일반상업지역"];
    const scenario = params.regulationMode === "scenario";
    return {
      maxBcr: Math.min(base.maxBcr, scenario ? params.legalBcrCapPct || Infinity : Infinity),
      maxFar: Math.min(base.maxFar, scenario ? params.legalFarCapPct || Infinity : Infinity),
      baseOrdFar: base.maxFar,
      maxResidentialFarPct: params.testResidentialFarPct || null,
      minNonResidentialRatio: params.testNonResidentialRatio || 0,
      northSolarApplies: Boolean(params.northSolar),
      warnings: [], sourceIds: ["test-constraint-fixture"]
    };
  },
  parkingFor(plates, params, capacity) {
    const area = plates.reduce((sum, fp) => sum + fp.areaSqm, 0);
    const requirement = Math.ceil(area / (params.testParkingSqmPerCar || 100) - 1e-9);
    return {
      legalParkingCount: requirement, plannedParkingCount: capacity,
      deficit: Math.max(0, requirement - capacity), breakdown: [],
      disabledParkingCount: 0, evChargerFastSlow: 0,
      warnings: [], housingUnits: 0, estimatedUnitCount: true, sqmPerParkingUnit: null
    };
  }
};
const context = vm.createContext({
  window: { addEventListener() {}, AtelierLegal: legalFixture, AtelierCoreLayout: coreEngine, AtelierParkingLayout: parkingEngine },
  document: { getElementById: () => inertElement, querySelectorAll: () => [] }, console
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../app.js"), "utf8"), context, { filename: "app.js" });
vm.runInContext("updateAllCalculationsAndUI = () => {}; syncFacadeUI = () => {};", context);
function read(source) { return JSON.parse(vm.runInContext("JSON.stringify(" + source + ")", context)); }
function calculate(overrides = {}, option = "A", parcelKey = "custom_seoul") {
  context.parcelKeyForTest = parcelKey;
  vm.runInContext("loadParcelPreset(parcelKeyForTest)", context);
  context.inputsForTest = { ...read("state"), parkingMode: "report", northSolar: false, ...overrides };
  context.optionForTest = option;
  return read("evaluateDesignAndProforma(inputsForTest, optionForTest)");
}
function finite(value, route = "model") {
  if (typeof value === "number") assert.ok(Number.isFinite(value), "finite " + route);
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => finite(item, route + "." + key));
}
function verifyParking(model) {
  const p=model.parking,c=model.constraints,layout=p.layout;
  assert.ok(model.coreLayout && layout,"VM uses the shipped shared core and spatial parking modules");
  assert.ok(p.plannedParkingCount<=p.capacityCount,"capacity is never silently inflated");
  assert.ok(p.capacityCount<=layout.capacityCount && p.capacityCount<=p.areaEstimateCount);
  assert.equal(p.deficit,Math.max(0,p.legalParkingCount-p.plannedParkingCount),"unmet demand remains visible");
  if(c.parkingFitEligible){
    assert.equal(model.coreLayout.status,"reserved");assert.equal(layout.status,"generated");
    assert.equal(layout.massFitEligible,true);assert.equal(layout.validation.valid,true);
    assert.ok(layout.capacityCount>0 && layout.levels.length>0,"fit eligibility requires actual positive stall geometry");
    assert.ok(layout.levels.every(level=>level.validation.valid));
    assert.equal(c.parkingFitDeferred,false);
    if(c.parkingMode==="fit"){
      assert.ok(p.legalParkingCount<=p.plannedParkingCount,"validated parking fit regenerates a feasible mass");
      assert.equal(p.deficit,0);
    }
  }else{
    assert.ok(model.coreLayout.status==="unfeasible" || layout.status==="incomplete",
      "a deferred fit has a concrete core or circulation failure");
    assert.equal(c.parkingFitDeferred,c.parkingMode==="fit" && c.unconstrainedParkingCount>p.plannedParkingCount);
    assert.equal(c.parkingReducedAreaSqm,0,"failed parking geometry cannot be treated as a zero-capacity design constraint");
    assert.equal(model.areas.aboveGroundGfaSqm,c.unconstrainedFarAreaSqm,"deferred fit preserves the legal mass");
    assert.equal(model.actualFloorsAbove,c.unconstrainedFloorsAbove);
    assert.equal(p.legalParkingCount,c.unconstrainedParkingCount,"deferral cannot erase the original parking demand");
  }
  if(c.parkingMode==="report"){
    assert.equal(c.parkingFitDeferred,false);assert.equal(c.parkingReducedAreaSqm,0);
    assert.equal(model.areas.aboveGroundGfaSqm,c.unconstrainedFarAreaSqm);
  }
}
function verifyGeometry(model) {
  finite(model);
  const a = model.areas;
  assert.ok(a.achievedFarPct <= model.zoningRule.maxFar + EPS, "FAR cap");
  assert.ok(a.achievedBcrPct <= model.zoningRule.maxBcr + EPS, "BCR cap");
  assert.ok(Math.abs(a.aboveGroundGfaSqm - a.farCountedGfaSqm) < EPS, "no blanket FAR deduction");
  assert.ok(Math.abs(model.floorPlates.reduce((sum, fp) => sum + fp.areaSqm, 0) - a.aboveGroundGfaSqm) < EPS, "exact generated area sum");
  assert.equal(model.actualFloorsAbove, model.floorPlates.length);
  assert.ok(model.actualFloorsAbove <= model.requestedFloorsAbove);
  if (model.constraints.maxHeightM) assert.ok(model.buildingHeightM <= model.constraints.maxHeightM + EPS, "height cap includes roof allowance");
  assert.equal(model.buildingHeightM, model.actualFloorsAbove ? model.floorPlates.at(-1).zTop + 1.2 : 0);
  const first = model.floorPlates[0];
  for (const fp of model.floorPlates) {
    assert.ok(fp.widthM >= 6 - EPS && fp.depthM >= 6 - EPS, "usable study dimensions");
    assert.ok(Math.abs(fp.areaSqm - fp.widthM * fp.depthM * (fp.hasAtrium ? 1 - 0.35 * 0.35 : 1)) < EPS, "actual courtyard void area");
    assert.ok(fp.widthM / 2 <= model.siteWidthM / 2 - model.sideSetbackM + EPS, "side edge");
    assert.ok(fp.northShiftM - fp.depthM / 2 >= -model.siteDepthM / 2 + fp.solarSetbackM - EPS, "north solar edge");
    assert.ok(fp.northShiftM + fp.depthM / 2 <= model.siteDepthM / 2 - model.frontSetbackM + EPS, "south edge");
    assert.ok(fp.widthM <= first.widthM + EPS, "projected footprint stays within BCR base");
    assert.ok(fp.northShiftM - fp.depthM / 2 >= first.northShiftM - first.depthM / 2 - EPS);
    assert.ok(fp.northShiftM + fp.depthM / 2 <= first.northShiftM + first.depthM / 2 + EPS);
  }
  verifyParking(model);
}

const tightFar = calculate({ siteAreaSqm: 1500, targetBcr: 60, setbackM: 0, setbackSideM: 0, setbackRearM: 0,
  regulationMode: "scenario", floorsAbove: 2, legalFarCapPct: 65 });
verifyGeometry(tightFar);
assert.equal(tightFar.actualFloorsAbove, 2);
assert.ok(Math.abs(tightFar.floorPlates[1].areaSqm - 75) < EPS, "a residual under 80 sqm shrinks the last floor instead of adding a full floor");
assert.ok(Math.abs(tightFar.areas.achievedFarPct - 65) < EPS);

const empty = calculate({ regulationMode: "scenario", legalFarCapPct: 1, maxHeightM: 3 });
verifyGeometry(empty);
assert.equal(empty.actualFloorsAbove, 0);
assert.equal(empty.areas.buildingFootprintSqm, 0);
assert.ok(empty.constraints.warnings.length);

const report = calculate({ floorsAbove: 35, floorsBelow: 1, northSolar: false, parkingMode: "report" });
const fit = calculate({ floorsAbove: 35, floorsBelow: 1, northSolar: false, parkingMode: "fit" });
verifyGeometry(report); verifyGeometry(fit);
assert.ok(report.parking.deficit > 0, "report mode exposes physical parking shortage");
assert.equal(fit.parking.layout.status,"incomplete");assert.equal(fit.parking.layout.failureReason,"ramp-envelope");
assert.equal(fit.parking.capacityCount,0);assert.equal(fit.constraints.parkingFitDeferred,true);
assert.deepEqual(fit.floorPlates,report.floorPlates,"a ramp-envelope failure preserves the whole legal mass instead of creating a false tiny tower");
assert.equal(fit.parking.deficit,report.parking.deficit);
assert.equal(fit.parking.legalParkingCount,report.parking.legalParkingCount);
assert.equal(fit.constraints.parkingReducedAreaSqm,0);
const positiveReport=calculate({siteAreaSqm:2400,floorsAbove:35,floorsBelow:1,northSolar:false,parkingMode:"report",coreType:"center"});
const positiveFit=calculate({siteAreaSqm:2400,floorsAbove:35,floorsBelow:1,northSolar:false,parkingMode:"fit",coreType:"center"});
verifyGeometry(positiveReport);verifyGeometry(positiveFit);
assert.ok(positiveReport.parking.deficit>0);assert.equal(positiveFit.constraints.parkingFitEligible,true);
assert.equal(positiveFit.constraints.parkingFitDeferred,false);assert.ok(positiveFit.parking.capacityCount>0);
assert.equal(positiveFit.parking.deficit,0);
assert.ok(positiveFit.areas.aboveGroundGfaSqm<positiveReport.areas.aboveGroundGfaSqm,"a validated positive parking capacity still changes the mass");
assert.ok(positiveFit.constraints.parkingReducedAreaSqm>0);

const regular = calculate({ publicContribPct: 0, parcelMerged: false });
const merged = calculate({ publicContribPct: 0, parcelMerged: true });
const contributed = calculate({ publicContribPct: 10, parcelMerged: false });
assert.equal(regular.zoningRule.maxFar, merged.zoningRule.maxFar, "merger is not an automatic FAR bonus");
assert.equal(regular.zoningRule.maxFar, contributed.zoningRule.maxFar, "contribution is not an automatic FAR bonus");
assert.equal(merged.finance.landPricePyeongM, regular.finance.landPricePyeongM, "no automatic merger acquisition discount");

const housingLimited = calculate({ buildingUse: "공동주택", floorsAbove: 35,
  testResidentialFarPct: 400, testNonResidentialRatio: 0.1 });
verifyGeometry(housingLimited);
assert.ok(housingLimited.constraints.residentialGfaSqm <= housingLimited.siteAreaSqm * 4 + EPS, "separate residential FAR budget");
assert.ok(housingLimited.constraints.residentialGfaSqm <= housingLimited.constraints.nonResidentialGfaSqm * 9 + EPS, "nonresidential ratio budget");

for (const [use, firstUse, upperUse] of [
  ["호텔", "amenity", "hotel"], ["오피스텔", "retail", "residential"],
  ["공동주택", "retail", "residential"], ["판매시설", "retail", "retail"],
  ["지식산업센터", "retail", "main"]
]) {
  const model = calculate({ buildingUse: use, mixedUseProfile: "mixed_resi", floorsAbove: 4, northSolar: false });
  assert.equal(model.floorPlates[0].use, firstUse);
  assert.equal(model.floorPlates.at(-1).use, upperUse);
}

let checked = 0;
for (const parcel of read("Object.keys(SEOUL_PARCELS)")) {
  for (const option of ["A", "B", "C"]) {
    for (const solar of [false, true]) {
      for (const parkingMode of ["fit", "report"]) {
        for (const maxHeightM of [0, 18.5]) {
          const model = calculate({ regulationMode: "scenario", floorsAbove: 35, northSolar: solar, parkingMode, maxHeightM,
            legalFarCapPct: solar ? 250 : 400, legalBcrCapPct: 40 }, option, parcel);
          verifyGeometry(model); checked++;
        }
      }
    }
  }
}
console.log(`Legal mass mechanics passed: ${checked} envelope/FAR/BCR/parking/height combinations, residual floor and use classification regressions.`);

// Run the same geometry invariants against the reviewed, shipped legal module,
// not only the mechanics fixture. This catches API or classification drift.
const reviewedRules = require("../legal-rules.js");
context.window.AtelierLegal = reviewedRules;
let reviewedCount = 0;
for (const use of ["업무시설", "호텔", "오피스텔", "공동주택", "근린생활시설", "판매시설"]) {
  for (const parkingDistrict of ["standard", "restricted"]) {
    for (const option of ["A", "B", "C"]) {
      const model = calculate({ buildingUse: use, residentialType: use === "공동주택" ? "apartment" : "officetel",
        regulationMode: "scenario", floorsAbove: 35, floorsBelow: 1, parkingMode: "fit", parkingDistrict,
        legalFarCapPct: 500, legalBcrCapPct: 45, housingUnitAreaSqm: 59, housingUnits: 0 }, option);
      finite(model);
      assert.ok(model.areas.achievedFarPct <= model.zoningRule.maxFar + EPS);
      assert.ok(model.areas.achievedBcrPct <= model.zoningRule.maxBcr + EPS);
      verifyParking(model);
      if (model.parking.legalMaxParkingCount !== null) assert.ok(model.parking.plannedParkingCount <= model.parking.legalMaxParkingCount);
      if (model.constraints.maxResidentialFarSqm !== null) assert.ok(model.constraints.residentialGfaSqm <= model.constraints.maxResidentialFarSqm + EPS);
      if (model.constraints.minNonResidentialRatio > 0) assert.ok(model.constraints.nonResidentialGfaSqm >= model.areas.aboveGroundGfaSqm * model.constraints.minNonResidentialRatio - EPS);
      reviewedCount++;
    }
  }
}
console.log(`Reviewed legal module integration passed: ${reviewedCount} office/hotel/housing/retail + general/restricted parking studies.`);
