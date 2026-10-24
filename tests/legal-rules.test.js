"use strict";

// Run: node seoul-3d-web/tests/legal-rules.test.js
// Independent arithmetic scenarios from the saved official evidence:
// - seoul-parking-2171833-api.json, annex 2 notes 4/6/8 and annex 3
// - mcp-housing-parking-27.json, Seoul area denominators and housing approval
// - ev-accessibility-mcp.json, new construction / non-mechanical parking
// These checks cover the explicitly implemented subset, not permit approval.
const assert = require("node:assert/strict");
const { parkingFor, rulesFor, roundParking, firstDecimal } = require("../legal-rules.js");
const failures = [];
let checked = 0;
function test(name, callback) {
  checked++;
  try { callback(); } catch (error) { failures.push(name + ": " + error.message); }
}
const fp = (use, areaSqm, netFloorSqm = areaSqm) => ({ use, areaSqm, netFloorSqm });
function parking(plates, options = {}, capacity = 100) {
  return parkingFor(plates, {
    buildingUse: "업무시설(오피스)", parkingDistrict: "standard",
    housingPermitType: "building_permit", residentialType: "apartment", ...options
  }, capacity);
}
function housing(area, units = 10, options = {}, capacity = 100) {
  return parking([fp("residential", area * units * 1.2, area * units)], {
    buildingUse: "공동주택", housingUnits: units, housingUnitAreaSqm: area, ...options
  }, capacity);
}
const key = (result, name) => result.breakdown.find(item => item.key === name);

for (const [label, plates, options, expected] of [
  ["private office", [fp("main", 1000)], {}, 10],
  ["neighborhood facility", [fp("retail", 1340)], {}, 10],
  ["sales facility", [fp("retail", 1000)], { buildingUse: "판매시설" }, 10],
  ["hotel", [fp("hotel", 1340)], { buildingUse: "호텔" }, 10],
  ["hotel public floor", [fp("amenity", 1340)], { buildingUse: "호텔" }, 10]
]) test(label + " facility area denominator", () => assert.equal(parking(plates, options).legalParkingCount, expected));

test("gross facility area includes common space", () => {
  assert.equal(parking([fp("main", 1000, 600)]).legalParkingCount, 10);
});
test("same use on separate floors is combined before rounding", () => {
  assert.equal(parking([fp("main", 60), fp("main", 60)]).legalParkingCount, 1);
});
test("mixed uses truncate each subtotal to the first decimal, then round the sum", () => {
  // 159/100 -> 1.5; 254.6/134 -> 1.9; 281.4/134 -> 2.1;
  // total 5.5 -> 6. Rounding each use separately would return 2+2+2.
  const result = parking([fp("main", 159), fp("retail", 254.6), fp("hotel", 281.4)]);
  assert.equal(key(result, "office").rawCount, 1.5);
  assert.equal(key(result, "neighborhood").rawCount, 1.9);
  assert.equal(key(result, "hotel").rawCount, 2.1);
  assert.equal(result.legalParkingCount, 6);
});
test("mixed-use truncation does not round each facility count up", () => {
  // 1.59 + 1.99 -> first decimal 1.5+1.9=3.4 -> 3, not 4.
  assert.equal(parking([fp("main", 159), fp("retail", 266.66)]).legalParkingCount, 3);
});
test("office, sales and hotel retain different facility denominators", () => {
  const result = parking([fp("main", 160), fp("retail", 160), fp("hotel", 214.4)], { buildingUse: "판매시설" });
  assert.equal(key(result, "sales").divisor, 100);
  assert.equal(key(result, "hotel").divisor, 134);
  assert.equal(result.legalParkingCount, 5); // 1.6+1.6+1.6 = 4.8
});
test("a whole facility total under one space remains zero", () => {
  assert.equal(parking([fp("main", 99.99)]).legalParkingCount, 0);
  assert.equal(parking([fp("main", 40), fp("retail", 67)]).legalParkingCount, 0);
});
test("a mixed floating-point subtotal exactly equal to one is one", () => {
  // JavaScript represents 0.6+0.3+0.1 as 0.9999999999999999.
  assert.equal(parking([fp("main", 60), fp("hotel", 40.2), fp("retail", 13.4)]).legalParkingCount, 1);
});
test("rounding helpers preserve the one-space and half-space boundaries", () => {
  assert.equal(roundParking(0.99), 0);
  assert.equal(roundParking(1), 1);
  assert.equal(roundParking(1.49), 1);
  assert.equal(roundParking(1.5), 2);
  assert.equal(firstDecimal(1.59), 1.5);
  assert.equal(firstDecimal(1.9), 1.9);
});
test("physical supply is not silently inflated to meet the requirement", () => {
  const result = parking([fp("main", 1000)], {}, 3);
  assert.equal(result.plannedParkingCount, 3);
  assert.equal(result.capacityCount, 3);
  assert.equal(result.deficit, 7);
});

for (const [area, expected] of [[30, 5], [30.01, 8], [50, 8], [60, 8], [60.01, 10], [85, 12], [85.01, 14]]) {
  test("Seoul building-permit apartment " + area + " sqm × 10 units", () => {
    assert.equal(housing(area).legalParkingCount, expected);
  });
  test("Seoul officetel " + area + " sqm × 10 rooms", () => {
    assert.equal(housing(area, 10, { buildingUse: "오피스텔", residentialType: "officetel" }).legalParkingCount, expected);
  });
}
for (const [area, expected] of [[20, 7], [30, 7], [50, 7], [60, 8], [60.01, 10], [85, 12], [85.01, 14]]) {
  test("housing-approval apartment " + area + " sqm × 10 units", () => {
    assert.equal(housing(area, 10, { housingPermitType: "housing_approval" }).legalParkingCount, expected);
  });
}
test("housing approval does not turn an officetel into a Housing Act apartment", () => {
  assert.equal(housing(50, 10, { buildingUse: "오피스텔", residentialType: "officetel", housingPermitType: "housing_approval" }).legalParkingCount, 8);
});
test("default residential permit type is the Seoul building-permit route", () => {
  const result = parkingFor([fp("residential", 600, 500)], {
    buildingUse: "공동주택", housingUnits: 10, housingUnitAreaSqm: 50, parkingDistrict: "standard"
  }, 100);
  assert.equal(result.legalParkingCount, 8);
});
test("residential area formula is rounded up, separately from nonresidential totals", () => {
  const result = parking([fp("residential", 1000, 850), fp("main", 149)], {
    buildingUse: "공동주택", housingUnits: 10, housingUnitAreaSqm: 85
  });
  assert.equal(key(result, "housing").rawCount, 12);
  assert.equal(result.legalParkingCount, 13); // ceil(850/75) + round(1.4)
});
test("explicit housing units report a mass-area deficit", () => {
  const result = parking([fp("residential", 600, 300)], {
    buildingUse: "공동주택", housingUnits: 10, housingUnitAreaSqm: 50
  });
  assert.equal(result.housingAreaDeficitSqm, 200);
  assert.equal(result.housingUnits, 10);
  assert.equal(result.estimatedUnitCount, false);
});
test("unit estimates follow the generated residential net area", () => {
  const result = parking([fp("residential", 600, 299)], {
    buildingUse: "오피스텔", residentialType: "officetel", housingUnits: 0, housingUnitAreaSqm: 50
  });
  assert.equal(result.housingUnits, 5);
  assert.equal(result.estimatedUnitCount, true);
});
test("nonresidential mass does not receive imaginary housing parking", () => {
  assert.equal(parking([fp("main", 1000)], { housingUnits: 500, housingUnitAreaSqm: 50 }).housingUnits, 0);
});

test("restricted office imposes a maximum rather than its ordinary minimum", () => {
  const result = parking([fp("main", 1220)], { parkingDistrict: "restricted" }, 30);
  assert.equal(result.legalParkingCount, 1);
  assert.equal(result.legalMaxParkingCount, 10);
  assert.equal(result.plannedParkingCount, 10);
  assert.equal(result.deficit, 0);
});
test("restricted mixed facilities use 122/268 divisors", () => {
  const result = parking([fp("main", 122), fp("retail", 268), fp("hotel", 268)], { parkingDistrict: "restricted" }, 20);
  assert.equal(result.legalMaxParkingCount, 3);
  assert.equal(result.legalParkingCount, 1);
  assert.equal(key(result, "office").divisor, 122);
  assert.equal(key(result, "neighborhood").divisor, 268);
  assert.equal(key(result, "hotel").divisor, 268);
});
test("restricted zero maximum does not force an impossible minimum", () => {
  const result = parking([fp("main", 121)], { parkingDistrict: "restricted" }, 10);
  assert.equal(result.legalMaxParkingCount, 0);
  assert.equal(result.legalParkingCount, 0);
  assert.equal(result.plannedParkingCount, 0);
});
test("housing in a restricted mixed building retains annex 2's separate minimum", () => {
  const result = parking([fp("main", 1220), fp("residential", 600, 500)], {
    buildingUse: "공동주택", housingUnits: 10, housingUnitAreaSqm: 50, parkingDistrict: "restricted"
  }, 100);
  assert.equal(result.legalParkingCount, 9); // housing 8 + nonresidential minimum 1
  assert.equal(result.legalMaxParkingCount, 18); // housing 8 + restricted maximum 10
});
test("unconfirmed parking district uses the standard baseline with an unresolved warning", () => {
  const result = parking([fp("main", 1000)], { parkingDistrict: "unconfirmed" });
  assert.equal(result.legalParkingCount, 10);
  assert.ok(result.warnings.some(text => /설치제한지역.*미확인/.test(text)));
});

for (const [spaces, expected] of [[9, 0], [10, 1], [33, 1], [34, 2], [100, 3], [101, 4]]) {
  test("accessible spaces are 3% of legal requirement with a 10-space trigger: " + spaces, () => {
    const result = parking([fp("main", spaces * 100)], {}, 200);
    assert.equal(result.disabledParkingCount, expected);
  });
}
for (const [capacity, applies, chargers, fast] of [[49, false, 0, 0], [50, true, 3, 0], [69, true, 3, 0],
  [70, true, 4, 0], [90, true, 5, 1], [190, true, 10, 1], [200, true, 10, 1], [4000, true, 200, 10]]) {
  test("new public-facility EV threshold/rounding at " + capacity + " planned spaces", () => {
    const result = parking([fp("main", 500000)], {}, capacity);
    assert.equal(result.evApplies, applies);
    assert.equal(result.evChargerFastSlow, chargers);
    assert.equal(result.evFastCount, fast);
  });
}
test("EV applies to planned spaces, not an unmet legal requirement", () => {
  const result = parking([fp("main", 20000)], {}, 49);
  assert.equal(result.legalParkingCount, 200);
  assert.equal(result.evApplies, false);
});
test("an apartment under 100 units does not meet the residential EV facility category alone", () => {
  assert.equal(housing(50, 99, {}, 100).evApplies, false);
});
test("an apartment at 100 units and 50 planned spaces reaches both EV triggers", () => {
  const result = housing(50, 100, {}, 50);
  assert.equal(result.evApplies, true);
  assert.equal(result.evChargerFastSlow, 3);
});
test("a new apartment with 10 required chargers includes at least one fast charger", () => {
  const result = housing(50, 100, {}, 200);
  assert.equal(result.evChargerFastSlow, 10);
  assert.equal(result.evFastCount, 1);
});

const zones = {
  "일반상업지역": { maxBcr: 60, maxFar: 800, maxFarDowntown: 600 },
  "준공업지역": { maxBcr: 60, maxFar: 400, maxFarDowntown: 400 },
  "준주거지역": { maxBcr: 60, maxFar: 400 },
  "제3종일반주거지역": { maxBcr: 50, maxFar: 250 }
};
const rule = options => rulesFor({ zoning: "일반상업지역", buildingUse: "업무시설(오피스)", ...options }, zones);
test("confirmed individual caps tighten the ordinance without unapproved bonuses", () => {
  const result = rule({ legalFarCapPct: 500, legalBcrCapPct: 45 });
  assert.equal(result.maxFar, 500);
  assert.equal(result.maxBcr, 45);
  assert.equal(rule({ legalFarCapPct: 900, legalBcrCapPct: 90 }).maxFar, 800);
});
test("downtown density uses the separate ordinance cap", () => assert.equal(rule({ seoulDowntown: true }).maxFar, 600));
test("merger and public contribution do not manufacture an approved FAR increase", () => {
  assert.equal(rule({ parcelMerged: true, publicContribPct: 20 }).maxFar, 800);
});
for (const options of [{ buildingUse: "공동주택" }, { buildingUse: "오피스텔" }, { mixedUseProfile: "mixed_resi" }, { floorUseOverrides: { 4: "residential" } }]) {
  test("industrial mixed housing strengthens FAR " + JSON.stringify(options), () => {
    assert.equal(rule({ zoning: "준공업지역", ...options }).maxFar, 250);
  });
}
test("a hotel is not classified as industrial residential housing", () => {
  assert.equal(rule({ zoning: "준공업지역", buildingUse: "호텔" }).maxFar, 400);
});
test("north sunlight general envelope applies to general residential, not quasi-residential", () => {
  assert.equal(rule({ zoning: "제3종일반주거지역", northSolar: true }).northSolarApplies, true);
  assert.equal(rule({ zoning: "준주거지역", northSolar: true }).northSolarApplies, false);
});

if (failures.length) {
  console.error(`Legal rules: ${checked - failures.length}/${checked} passed.`);
  failures.forEach(message => console.error("FAIL " + message));
  process.exitCode = 1;
} else console.log(`Legal rules: ${checked} independent density/parking/housing/EV/accessibility scenarios passed.`);
