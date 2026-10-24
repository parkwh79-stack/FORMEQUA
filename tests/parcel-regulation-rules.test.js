"use strict";
const assert = require("node:assert/strict");
const rules = require("../parcel-regulation-rules.js");
const legal = require("../legal-rules.js");
function fixture(zone = "일반상업지역") {
  return { pnu: "1168010100100010000", status: "verified", zones: [{ name: zone, code: "UQA420", source: "VWorld", coveragePct: 100, intersectionAreaSqm: 1000 }],
    districtPlans: [], limits: { farPct: null, bcrPct: null, heightM: null },
    sources: [{ title: "공식 용도지역 레이어", url: "https://www.vworld.kr/dev/v4dv_2ddataguide2_s001.do", checkedAt: "2026-10-21T00:00:00Z" }],
    checkedAt: "2026-10-21T00:00:00Z", warnings: [] };
}
const expected = { "일반상업지역": [800,60], "중심상업지역": [1000,60], "근린상업지역": [600,60], "준공업지역": [400,60], "준주거지역": [400,60], "제3종일반주거지역": [250,50], "제2종일반주거지역": [200,60] };
for (const [zone, [far, bcr]] of Object.entries(expected)) {
  const r = rules.resolve(fixture(zone), { buildingUse: "업무시설(오피스)" }, legal);
  assert.equal(r.applied, true); assert.equal(r.inputs.zoning, zone);
  assert.equal(r.rules.far, far); assert.equal(r.rules.bcr, bcr);
  assert.equal(r.liveParcelVerified, false); assert.equal(r.isPermitConfirmation, false);
}
assert.equal(rules.resolve(fixture(), { seoulDowntown: true }, legal).rules.far, 600);
assert.equal(rules.resolve(fixture("준공업지역"), { buildingUse: "업무시설(오피스텔)" }, legal).rules.far, 250);
const scenario = { regulationMode: "scenario", buildingUse: "업무시설(오피스)", seoulDowntown: false,
  legalFarCapPct: 50, legalBcrCapPct: 6, maxHeightM: 23 };
const scenarioBefore = JSON.stringify(scenario), rawBefore = fixture();
const restricted = rules.resolve(rawBefore, scenario, legal);
assert.deepEqual(restricted.generalRules, { far: 800, bcr: 60 }, "user limits must not rewrite the displayed general ordinance");
assert.deepEqual(restricted.manualLimits, { farPct: 50, bcrPct: 6, heightM: 23 });
assert.deepEqual(restricted.planLimits, { farPct: null, bcrPct: null, heightM: null }, "missing plan evidence never promotes user limits to a notice");
assert.deepEqual(restricted.effectiveLimits, { farPct: 50, bcrPct: 6, heightM: 23 });
assert.deepEqual(restricted.rules, { far: 50, bcr: 6 }, "existing final rules contract is preserved");
assert.deepEqual(restricted.inputs, { zoning: "일반상업지역" }, "user limits are not misrepresented as automatic plan inputs");
assert.equal(JSON.stringify(scenario), scenarioBefore, "resolving plan evidence cannot replace editable inputs");
assert.deepEqual(rawBefore.limits, { farPct: null, bcrPct: null, heightM: null });
assert.deepEqual(rules.manualLimitsFor({ legalFarCapPct: 0, legalBcrCapPct: 0, maxHeightM: 0 }), { farPct: null, bcrPct: null, heightM: null });
const legacy = { ...scenario }; delete legacy.regulationMode;
const statutory = rules.resolve(rawBefore, legacy, legal);
assert.equal(statutory.regulationMode, "statutory", "missing mode, including a saved legacy input, defaults to law-first calculation");
assert.deepEqual(statutory.generalRules, restricted.generalRules);
assert.deepEqual(statutory.manualLimits, restricted.manualLimits, "law-first mode preserves every saved comparison number");
assert.deepEqual(statutory.planLimits, restricted.planLimits);
assert.deepEqual(statutory.effectiveLimits, { farPct: 800, bcrPct: 60, heightM: null }, "saved user height and density do not constrain the statutory model");
assert.deepEqual(statutory.rules, { far: 800, bcr: 60 });
assert.deepEqual(legacy, { buildingUse: "업무시설(오피스)", seoulDowntown: false, legalFarCapPct: 50, legalBcrCapPct: 6, maxHeightM: 23 });
assert.deepEqual(rules.resolve(rawBefore, { ...scenario, regulationMode: "statutory" }, legal).effectiveLimits, statutory.effectiveLimits);
assert.throws(() => rules.resolve(rawBefore, { regulationMode: "unknown" }, legal), /검토 모드/);
const partial = fixture(); partial.status = "partial";
assert.equal(rules.resolve(partial, {}, legal).applied, true, "partial plan review does not erase complete single-zone GIS coverage");
delete partial.zones[0].coveragePct;
assert.equal(rules.resolve(partial, {}, legal).applied, false, "missing coverage is not full coverage");
partial.zones[0].coveragePct = 99.8;
assert.equal(rules.resolve(partial, {}, legal).applied, false);
partial.zones[0].coveragePct = 99.9;
assert.equal(rules.resolve(partial, {}, legal).applied, true);
const multi = fixture(); multi.zones.push({ name: "제3종일반주거지역", coveragePct: 1, intersectionAreaSqm: 10 });
assert.deepEqual(rules.resolve(multi, {}, legal).inputs, {}, "mixed-zone parcels never take maximum FAR");
assert.deepEqual(rules.resolve([fixture(), fixture("제3종일반주거지역")], {}, legal).inputs, {}, "different-zone merged parcels never use an unweighted average");
const unsupported = fixture("제1종일반주거지역");
assert.equal(rules.resolve(unsupported, {}, legal).applied, false);
assert.equal(rules.resolve(fixture("제2종일반주거지역(7층이하)"), {}, legal).applied, false, "qualified zone label is not silently stripped");
const outside = fixture(); outside.pnu = "4111010100100010000";
assert.equal(rules.resolve(outside, {}, legal).applied, false);
const noSource = fixture(); noSource.sources = [];
assert.equal(rules.resolve(noSource, {}, legal).applied, false);
const unverified = fixture(); unverified.status = "unverified";
assert.equal(rules.resolve(unverified, {}, legal).applied, false);
assert.equal(rules.resolve([fixture(), null], {}, legal).applied, false);
const plan = fixture(); plan.districtPlans = [{ name: "지구단위계획", noticeId: "서울특별시고시 제2026-000호", url: "https://urban.seoul.go.kr/notice", coveragePct: 100, intersectionAreaSqm: 1000 }];
plan.limits = { farPct: 500, bcrPct: 45, heightM: 40 };
const applied = rules.resolve(plan, {}, legal);
assert.deepEqual(applied.inputs, { zoning: "일반상업지역", legalFarCapPct: 500, legalBcrCapPct: 45, maxHeightM: 40 });
assert.equal(applied.planLimitsApplied, true);
assert.equal(rules.resolve(plan, { regulationMode: "scenario", maxHeightM: 25, legalFarCapPct: 450 }, legal).inputs.maxHeightM, 25, "an explicitly enabled scenario keeps a stricter user height");
assert.equal(rules.resolve(plan, { regulationMode: "scenario", legalFarCapPct: 450 }, legal).inputs.legalFarCapPct, 450);
const statutoryPlan = rules.resolve(plan, { ...scenario, regulationMode: "statutory" }, legal);
assert.deepEqual(statutoryPlan.manualLimits, { farPct: 50, bcrPct: 6, heightM: 23 });
assert.deepEqual(statutoryPlan.planLimits, { farPct: 500, bcrPct: 45, heightM: 40 });
assert.deepEqual(statutoryPlan.effectiveLimits, { farPct: 500, bcrPct: 45, heightM: 40 }, "law-first mode always retains confirmed notice limits despite smaller saved comparison values");
assert.deepEqual(statutoryPlan.inputs, { zoning: "일반상업지역", legalFarCapPct: 500, legalBcrCapPct: 45, maxHeightM: 40 });
const layered = rules.resolve(plan, { ...scenario, legalFarCapPct: 450, legalBcrCapPct: 30, maxHeightM: 25 }, legal);
assert.deepEqual(layered.generalRules, { far: 800, bcr: 60 });
assert.deepEqual(layered.planLimits, { farPct: 500, bcrPct: 45, heightM: 40 }, "plan values retain their own source before stricter user limits");
assert.deepEqual(layered.manualLimits, { farPct: 450, bcrPct: 30, heightM: 25 });
assert.deepEqual(layered.effectiveLimits, { farPct: 450, bcrPct: 30, heightM: 25 });
const cleared = rules.resolve(plan, { ...scenario, legalFarCapPct: 0, legalBcrCapPct: 0, maxHeightM: 0 }, legal);
assert.deepEqual(cleared.effectiveLimits, { farPct: 500, bcrPct: 45, heightM: 40 }, "clearing scenario limits cannot remove a confirmed restrictive notice");
assert.deepEqual(plan.limits, { farPct: 500, bcrPct: 45, heightM: 40 });
assert.deepEqual(scenario, JSON.parse(scenarioBefore));
const nextParcel = fixture(); nextParcel.pnu = "1165010800115960003";
const nextReview = rules.resolve(nextParcel, { legalFarCapPct: 0, legalBcrCapPct: 0, maxHeightM: 0 }, legal);
assert.deepEqual(nextReview.planLimits, { farPct: null, bcrPct: null, heightM: null }, "another PNU cannot inherit earlier derived plan metadata");
assert.deepEqual(nextReview.effectiveLimits, { farPct: 800, bcrPct: 60, heightM: null });
const partialPlan = structuredClone(plan); partialPlan.status = "partial";
assert.deepEqual(rules.resolve(partialPlan, {}, legal).inputs, { zoning: "일반상업지역" }, "partial plan limits stay unapplied");
const missingNotice = structuredClone(plan); delete missingNotice.districtPlans[0].noticeId;
assert.deepEqual(rules.resolve(missingNotice, {}, legal).inputs, { zoning: "일반상업지역" });
const higherPlan = structuredClone(plan); higherPlan.limits.farPct = 1000;
assert.ok(!Object.hasOwn(rules.resolve(higherPlan, {}, legal).inputs, "legalFarCapPct"), "unverified FAR bonus is never granted");
const zeroPlan = structuredClone(plan); zeroPlan.limits.farPct = 0;
assert.equal(rules.resolve(zeroPlan, {}, legal).applied, false, "a real zero limit is not treated as disabled input");
assert.equal(rules.sanitizeRegulations(null), null);
const clean = rules.sanitizeRegulations(plan); assert.deepEqual(clean, plan);
for (const mutate of [
  r => { r.pnu = 1168010100100010000; }, r => { r.status = "approved"; },
  r => { r.zones[0].coveragePct = "100"; }, r => { r.zones[0].coveragePct = 100.1; },
  r => { r.zones[0].intersectionAreaSqm = Infinity; }, r => { r.zones[0].intersectionAreaSqm = 20001; },
  r => { r.limits.farPct = "500"; }, r => { r.limits.farPct = NaN; }, r => { r.limits.bcrPct = 101; },
  r => { r.limits.heightM = -1; }, r => { r.sources[0].url = "javascript:alert(1)"; },
  r => { r.sources[0].url = "https://eum.go.kr.example.com/doc"; },
  r => { r.sources[0].url = "https://user:secret@www.eum.go.kr/doc"; },
  r => { r.checkedAt = "yesterday"; }, r => { r.warnings = ["x".repeat(1001)]; },
  r => { r.extra = true; }
]) { const bad = fixture(); mutate(bad); assert.throws(() => rules.sanitizeRegulations(bad)); }
console.log("Parcel regulation rules passed: 7 sourced Seoul zones, conditional coverage mapping, no mixed / unknown default, reviewed use strengthening, conservative sourced plan caps, zero-limit guard and strict provenance input validation.");
