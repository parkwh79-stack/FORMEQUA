"use strict";
// Validates that the persistent 2D view consumes real generated plan objects,
// keeps program classification and optional layers, and escapes room labels.
const assert = require("node:assert/strict");
const study = require("../dashboard-study.js");
const planner = require("../interior-plan.js");

assert.equal(study.programKey({ buildingUse: "업무시설(오피스)" }), "office");
assert.equal(study.programKey({ buildingUse: "업무시설(오피스텔)", spaceProgram: "standard" }), "officetel");
assert.equal(study.programKey({ buildingUse: "숙박시설(호텔)" }), "hotel");
assert.equal(study.programKey({ buildingUse: "공동주택(주상복합)", spaceProgram: "coliving" }), "living");
assert.equal(study.floorUse({ use: "main" }, { buildingUse: "지식산업센터" }), "지식산업센터");
assert.equal(study.floorUse({ use: "residential" }, { residentialType: "officetel" }), "오피스텔");
assert.equal(study.floorUse({ use: "residential" }, { residentialType: "apartment", spaceProgram: "standard" }), "공동주택");
assert.equal(study.floorUse({ use: "residential" }, { residentialType: "officetel", spaceProgram: "coliving" }), "코리빙");
const request = study.analysisRequest({ parcelKey: "custom_seoul", buildingUse: "업무시설(오피스)", siteAreaSqm: 30000, roadWidthM: 60, selectedFloorLevel: 9, lastComputed: { huge: true }, isRecording: false, facadeColorMode: "realistic" }, 3);
assert.equal(request.inputs.siteAreaSqm, 30000, "invalid current input is preserved for API validation, never silently replaced by a preset");
assert.equal(request.inputs.roadWidthM, 60);
assert.equal(request.floorLevel, 3);
assert.ok(!("lastComputed" in request.inputs) && !("selectedFloorLevel" in request.inputs) && !("facadeColorMode" in request.inputs) && !("isRecording" in request.inputs), "derived and presentation state never enters the API request");

const plans = [];
for (const [index, [use, spaceProgram, residentialType]] of [
  ["main", "standard", "officetel"], ["hotel", "standard", "officetel"],
  ["residential", "standard", "officetel"], ["residential", "standard", "apartment"],
  ["residential", "coliving", "officetel"], ["retail", "standard", "officetel"],
  ["amenity", "standard", "officetel"]
].entries()) {
  const fp = { level: index + 1, use, widthM: 32, depthM: 28, northShiftM: 3, zBottom: 0, zTop: 4, areaSqm: 896 };
  const options = study.planOptions({ coreType: "center", option: "A", spaceProgram, residentialType, housingUnitAreaSqm: 59 });
  const plan = planner.generate(fp, options); plans.push(plan);
  const svg = study.planSvg(plan, `${fp.level}F · 실제 배치`);
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.includes("viewBox="));
  assert.ok(!/NaN|Infinity|undefined/.test(svg), "finite serialized plan coordinates");
  assert.equal((svg.match(/<line /g) || []).length, plan.walls.length, "all generated wall segments rendered");
  assert.equal((svg.match(/<g><title>/g) || []).length, plan.furniture.length, "all generated furniture rendered");
  assert.ok(plan.rooms.every(room => svg.includes(room.label)), "each generated room label rendered");
  assert.ok(study.planSvg(plan, "제목", { furniture: false }).indexOf("<g><title>") === -1, "optional furniture removed without changing the plan");
  const noLabels = study.planSvg(plan, "제목", { labels: false });
  assert.ok(plan.rooms.every(room => !noLabels.includes(room.label)), "room labels can be hidden");
  assert.notEqual(study.planSignature(fp, options), study.planSignature({ ...fp, widthM: 31 }, options), "geometry updates invalidate the drawing cache");
  assert.notEqual(study.planSignature(fp, options), study.planSignature(fp, { ...options, coreType: "north" }), "core updates invalidate the drawing cache");
  if (use === "hotel") assert.equal(study.occupancyText(fp, plan), `${plan.metrics.guestRoomCount}객실 · ${plan.metrics.guestBedCount}침대`);
  if (use === "main") assert.equal(study.occupancyText(fp, plan), `${plan.metrics.workstationCount}석`);
}
const sums = study.sumMetrics(plans);
const northRotated = study.planSvg(plans[0], '회전 필지', { northRotationRad: Math.PI / 6 });
assert.ok(Math.abs(Number(northRotated.match(/transform="rotate\(([-\d.]+)/)?.[1]) + 30) < 1e-8, 'true north rotates opposite the site frame');
assert.ok(!/NaN|Infinity/.test(study.planSvg(plans[0], '유효한 북향', { northRotationRad: NaN })));
assert.equal(sums.guestRoomCount, plans.reduce((n, plan) => n + plan.metrics.guestRoomCount, 0));
assert.equal(sums.dwellingUnitCount, plans.reduce((n, plan) => n + plan.metrics.dwellingUnitCount, 0));
assert.equal(sums.workstationCount, plans.reduce((n, plan) => n + plan.metrics.workstationCount, 0));
const escaped = structuredClone(plans[0]); escaped.rooms[0].label = '<script>alert("x")</script>';
const safe = study.planSvg(escaped, '<img src=x onerror="alert(1)">');
assert.ok(!safe.includes("<script>") && !safe.includes("<img"));
assert.ok(safe.includes("&lt;script&gt;") && safe.includes("&lt;img"), "external labels cannot become executable markup");
assert.equal(study.planSvg({ bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 } }, "empty"), "");
assert.equal(study.planSvg(null, "missing"), "");
assert.equal(study.occupancyText({ use: "hotel" }, { rooms: [{ id: "service" }], metrics: { roomCount: 1, guestRoomCount: 0, guestBedCount: 0 } }), "0객실 · 0침대", "completed service-only plan can have a real zero guest-room result");
assert.equal(study.occupancyText({ use: "hotel" }, { rooms: [], metrics: { roomCount: 0, guestRoomCount: 0, guestBedCount: 0 } }), "실 배치 미완료", "empty drafts are not confirmed zero room counts");
assert.equal(study.occupancyText({ use: "main" }, null), "생성 확인 필요", "missing data differs from zero");
console.log("PASS REALYTICS dashboard program mapping, generated SVG geometry, optional layers, summaries and escaped labels (7 floor programs)");
