"use strict";
const assert = require("node:assert/strict");
const permissions = require("../use-permissions.js");
const office = "업무시설(오피스)", living = "업무시설(오피스텔)", hotel = "숙박시설(호텔)", housing = "공동주택(주상복합)";
const second = "제2종일반주거지역", third = "제3종일반주거지역";
const plate = (use, areaSqm, level = 1) => ({ use, areaSqm, level });
const check = (zoning, buildingUse, inputs, plates) => permissions.evaluate({ zoning, buildingUse, roadWidthM: 20, ...inputs }, plates);

// Seoul's local permitted list is narrower than national annex 5.
assert.equal(check(second, living).status, "prohibited");
assert.equal(check(second, office, {}, [plate("main", 2999.99)]).status, "allowed");
assert.equal(check(second, office, {}, [plate("main", 3000)]).status, "prohibited");
assert.equal(check(third, office).limits.businessAreaSqm, 2999.99);
assert.equal(check(third, office).limits.maxBusinessAreaSqmExclusive, 3000);
assert.equal(check(third, office).limits.businessAreaIncludesOfficetel, true);
assert.equal(check(third, office).limits.salesAreaSqm, 1999.99);
assert.equal(check(second, office).limits.businessAreaIncludesOfficetel, false);
// Officetel plus offices count toward the same 업무시설 area limit.
assert.equal(check(third, office, { residentialType: "officetel" }, [plate("main", 1800), plate("residential", 1200, 2)]).status, "prohibited");
assert.equal(check(third, living, {}, [plate("residential", 2999)]).status, "allowed");
assert.equal(check(third, living, { roadWidthM: 16 }, [plate("residential", 500)]).status, "conditional");
assert.equal(check(third, living, { roadWidthM: 10 }, [plate("residential", 500)]).status, "prohibited");
assert.equal(check(third, office, {}, [plate("main", 2000), plate("residential", 2000, 2)]).status, "allowed");

for (const zone of [second, third, "준주거지역", "준공업지역"]) {
  assert.equal(check(zone, hotel, { hotelType: "general" }).status, "prohibited", zone);
  assert.equal(check(zone, hotel, { hotelType: "unconfirmed" }).status, "conditional", zone);
  const tourist = check(zone, hotel, { hotelType: "tourist" });
  assert.equal(tourist.status, "conditional", zone);
  assert(tourist.sourceIds.includes("tourism-approval"));
  assert(tourist.sourceIds.includes("school-protection"));
}
assert.equal(check(second, hotel, { hotelType: "tourist", roadWidthM: 10 }).status, "prohibited");
for (const zone of ["일반상업지역", "근린상업지역", "중심상업지역"]) {
  assert.equal(check(zone, hotel, { hotelType: "general" }).status, "conditional");
  assert.equal(check(zone, hotel, { hotelType: "general", hotelResidentialDistanceM: 50 }).status, "prohibited");
  assert.equal(check(zone, hotel, { hotelType: "general", hotelResidentialDistanceM: 51 }).status, "conditional");
  assert.equal(check(zone, housing, {}, [plate("residential", 1000)]).status, "prohibited");
  assert.equal(check(zone, housing, {}, [plate("residential", 800), plate("retail", 200, 2)]).status, "conditional");
  assert.equal(check(zone, office).limits.businessAreaSqm, null);
}
assert.equal(check("준공업지역", housing).status, "conditional");
assert.equal(check(second, housing).status, "allowed");
// Floor-specific changes are screened even when the primary use is permitted.
assert.equal(check(second, office, { floorUseOverrides: { 2: "hotel" }, hotelType: "general" }).status, "prohibited");
assert.equal(check(second, office, { hotelType: "general" }, [plate("main", 1000), plate("hotel", 500, 2)]).status, "prohibited");
const mixedHotel = check(third, hotel, { hotelType: "tourist" }, [plate("main", 3000), plate("hotel", 500, 2)]);
assert.equal(mixedHotel.entries.find(item => item.key === "office").status, "prohibited");
assert.equal(mixedHotel.areas.office, 3000);
assert(check("일반상업지역", hotel, { hotelType: "tourist", floorUseOverrides: { 2: "main" } }).entries.some(item => item.key === "office"));
assert.equal(check(second, "판매시설", { roadWidthM: 19 }, [plate("retail", 500)]).status, "prohibited");
assert.equal(check(third, "판매시설", {}, [plate("retail", 2000)]).status, "prohibited");
assert.equal(check("알수없는지역", office).status, "unverified");
assert.equal(check("일반상업지역", "생활숙박시설").status, "unverified");
const choices = permissions.optionsFor({ zoning: second, floorUseOverrides: { 2: "hotel" }, hotelType: "general" });
assert.equal(choices.length, 7);
assert.equal(choices.find(item => item.value === living).label, "리빙 · 오피스텔");
assert.equal(choices.find(item => item.value === office).status, "conditional");
for (const result of [check(second, office), check("준공업지역", hotel, { hotelType: "tourist" })]) {
  assert.equal(result.isPermitConfirmation, false);
  assert(result.sourceIds.every(id => result.sources.some(source => source.id === id)));
  assert(result.sources.every(source => source.url.startsWith("https://www.law.go.kr/")));
}
console.log("use-permissions: legal boundaries, subtype paths and mixed uses passed");
