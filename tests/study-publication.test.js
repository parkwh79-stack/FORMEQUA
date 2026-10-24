"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const api = require("../study-publication.js");
const hash = source => crypto.createHash("sha256").update(source).digest("hex");
const snapshot = (floors = 2, extra = {}) => ({ eligible: true, geometryKey: "LOCAL-GEOMETRY-IDENTITY",
  summary: { program: "office", siteAreaSqm: 1263.542, farPct: floors * 42.456, bcrPct: 42.456, floors, arbitrary: "EXTRA-METADATA" },
  plates: Array.from({ length: floors }, (_, i) => ({ level: i + 1, width: 25.43268, depth: 21.4751, height: 4, y: i * 4 + 2,
    shiftZ: i * .25, courtyard: i > 0, arbitrary: "EXTRA-METADATA" })),
  site: { parcels: [{ address: "서울시 검토 주소", pnu: "1165010800115960003" }], boundary: [{ x: 12, z: -8 }, { x: 20, z: 3 }] },
  reviewData: { project: { savedAt: "2026-10-21T00:00:00Z", inputs: { rent: 100, landCost: 300 } },
    calculations: { model: { parking: { available: 23, required: 20 } }, finance: { noi: 12, equityIrr: 8.5 } },
    floorPlans: { levels: [1, 2], rooms: [{ name: "검토실", area: 25 }] }, legalEvidence: { checkedAt: "2026-10-20", source: "법규 검토 근거" },
    siteContext: { roads: [{ width: 12 }], address: "서울시 검토 주소" }, runtime: { capturedAt: "2026-10-21T00:00:00Z", formatVersion: 1 } }, ...extra });
const normalized = api.normalizeSnapshot(snapshot());
assert.deepEqual(normalized.summary, { program: "office", siteAreaSqm: 1260, farPct: 84.9, bcrPct: 42.5, floors: 2 });
assert.equal(normalized.plates[0].width, 25.433); assert.equal(normalized.plates[0].shiftX, 0);
assert.equal(normalized.plates[1].courtyard, true); assert.deepEqual(normalized.appearance, { palette: "limestone" });
assert.deepEqual(Object.keys(normalized.plates[0]), ["level", "width", "depth", "height", "y", "shiftX", "shiftZ", "courtyard"]);
for (const palette of ["limestone", "bronze", "stone", "white", "terracotta"]) assert.equal(api.normalizeSnapshot(snapshot(2, { appearance: { palette } })).appearance.palette, palette);
for (const facade of ["curtain_wall", "brick_rainscreen", "stone_ribbon", "kinetic_louver", "diagrid_biophilic"]) assert.equal(api.normalizeSnapshot(snapshot(2, { appearance: { palette: "terracotta", facade } })).appearance.facade, facade);
for (const program of ["office", "officetel", "hotel", "housing", "living", "knowledge", "retail", "sales"]) { const value = snapshot(); value.summary.program = program; assert.equal(api.normalizeSnapshot(value).summary.program, program); }
for (const mutate of [s => { s.eligible = false; }, s => { s.summary.program = "logistics"; }, s => { s.summary.siteAreaSqm = NaN; },
  s => { s.summary.farPct = Infinity; }, s => { s.summary.farPct = 1500.1; }, s => { s.summary.bcrPct = 101; }, s => { s.summary.floors = 1.5; },
  s => { s.summary.farPct = -1; }, s => { s.summary.bcrPct = -1; }, s => { s.summary.floors = -1; }, s => { s.summary.siteAreaSqm = 0; },
  s => { s.plates.pop(); }, s => { s.plates[0].width = 0; }, s => { s.plates[1].level = 1; }, s => { s.plates[1].level = 5; },
  s => { s.plates[0].y = NaN; }, s => { delete s.reviewData.runtime; }, s => { s.reviewData.project.apiKey = "DO-NOT-SAVE"; },
  s => { s.reviewData.project.access_token = "DO-NOT-SAVE"; }, s => { s.reviewData.project.authorization = "Bearer DO-NOT-SAVE"; },
  s => { s.site = null; }, s => { s.reviewData = []; }]) { const value = snapshot(); mutate(value); assert.equal(api.normalizeSnapshot(value), null); }
const redacted = snapshot(); redacted.reviewData.runtime.apiKey = null;
assert.equal(api.normalizeSnapshot(redacted).reviewData.runtime.apiKey, null, "explicit source redaction markers remain usable");
const blocked = snapshot(0); blocked.summary.bcrPct = 0; blocked.reviewData.calculations.model.constraint = "주차 또는 법령 제한으로 계획 불가";
assert.equal(api.normalizeSnapshot(blocked).summary.floors, 0);
assert.equal(api.normalizeSnapshot(blocked).summary.farPct, 0);
assert.deepEqual(api.normalizeSnapshot(blocked).plates, [], "a valid site's zero-floor conclusion is a review record, not an empty/invalid parcel");
const oversize = snapshot(); oversize.reviewData.project.description = "한".repeat(Math.floor(api.MAX_REVIEW_BYTES / 3) + 1);
assert.equal(api.normalizeSnapshot(oversize), null, "the UTF-8 limit is enforced rather than counting only JS characters");
const original = snapshot(), copied = api.normalizeSnapshot(original); copied.reviewData.project.inputs.rent = 999; copied.site.parcels[0].address = "변경";
assert.equal(original.reviewData.project.inputs.rent, 100); assert.equal(original.site.parcels[0].address, "서울시 검토 주소");
const source = api.fingerprintSource(normalized), digest = hash(source), payload = api.reviewPayload(normalized, digest);
assert.deepEqual(Object.keys(payload), ["summary", "model", "site", "reviewData", "modelFingerprint"]);
assert.deepEqual(Object.keys(payload.model), ["plates", "appearance"]); assert.equal(payload.modelFingerprint, digest);
assert.equal(payload.site.parcels[0].pnu, "1165010800115960003"); assert.equal(payload.reviewData.calculations.finance.noi, 12);
assert.equal(payload.reviewData.project.savedAt, "2026-10-21T00:00:00Z", "volatile timestamps remain in the stored review payload");
assert.doesNotMatch(JSON.stringify(payload), /LOCAL-GEOMETRY-IDENTITY|EXTRA-METADATA|geometryKey|imageDataUrl|camera/);
assert.throws(() => api.reviewPayload(normalized, "bad"), /STUDY_FINGERPRINT_INVALID/);
const timed = snapshot(); timed.reviewData.project.savedAt = "2099-01-01"; timed.reviewData.runtime.capturedAt = "2099-01-01";
assert.equal(api.fingerprintSource(timed), source, "capture/export timestamps do not create endless duplicate reviews");
for (const key of ["capturedAt", "createdAt", "exportedAt", "updatedAt", "generatedAt", "calculatedAt", "snapshotAt", "timestamp", "lastSavedAt", "savedAt"]) {
  const timedReview = snapshot(); timedReview.reviewData.runtime[key] = "2099-01-01";
  assert.equal(api.fingerprintSource(timedReview), source, `${key} matches the backend's volatile timestamp policy`);
}
const reordered = snapshot(); reordered.reviewData.calculations.finance = { equityIrr: 8.5, noi: 12 };
assert.equal(api.fingerprintSource(reordered), source, "object key order does not affect the stable review identity");
const financeChange = snapshot(); financeChange.reviewData.project.inputs.rent = 120;
assert.notEqual(api.fingerprintSource(financeChange), source, "a finance-only revision must be collected");
const addressChange = snapshot(); addressChange.site.parcels[0].pnu = "1165010800115960005";
assert.notEqual(api.fingerprintSource(addressChange), source, "the approved private site record distinguishes sites with the same massing");
const lawChange = snapshot(); lawChange.reviewData.legalEvidence.checkedAt = "2026-10-21";
assert.notEqual(api.fingerprintSource(lawChange), source, "the date of legal evidence is meaningful and stays in the review identity");
assert.notEqual(api.fingerprint(normalized), api.fingerprint(api.normalizeSnapshot(snapshot(3))));
assert.equal(api.fingerprint(normalized), api.fingerprint(api.normalizeSnapshot(snapshot(2, { camera: { x: 999 } }))));

function harness(options = {}) {
  let currentSource = snapshot(), now = 0, next = 0, snapshotReads = 0;
  const tasks = new Map(), calls = [], states = [], store = new Map();
  const storage = options.storage || { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value) };
  const controller = api.createController({ getSnapshot: () => { snapshotReads++; return currentSource; }, now: () => now, debounceMs: 2500, intervalMs: 30000,
    setTimeout: (fn, ms) => { const id = ++next; tasks.set(id, { fn, at: now + ms }); return id; }, clearTimeout: id => tasks.delete(id),
    storage, hashFingerprint: options.hashFingerprint || (async value => hash(value)),
    save: async body => { calls.push(body); return options.save ? options.save(body) : { study: { id: "review-test" }, created: true, review: { status: "collected" } }; },
    onStatus: value => states.push(value) });
  async function tick(ms) {
    now += ms;
    for (let i = 0; i < 12; i++) { const due = [...tasks].filter(([, v]) => v.at <= now); for (const [id, value] of due) { tasks.delete(id); value.fn(); } await Promise.resolve(); }
  }
  return { controller, calls, states, storage, store, tasks, tick, reads: () => snapshotReads, source: value => { currentSource = value; }, mutate: value => { controller.noteInteraction(); currentSource = value; controller.observe(); } };
}
async function main() {
  const disabledHost = { FORMEQUA_DEPLOYMENT: { reviewStorageEnabled: false },
    get document() { throw new Error("Disabled publication must not access the DOM, storage, snapshots or network"); } };
  assert.doesNotThrow(() => api.mount(disabledHost));
  assert.equal(disabledHost.__atelierStudyPublicationMounted, undefined);
  assert.equal(await api.digestFingerprint(source, { crypto: crypto.webcrypto, TextEncoder }), digest, "the fingerprint is computed locally without a provider");
  await assert.rejects(api.digestFingerprint(source, {}), /STUDY_FINGERPRINT_UNAVAILABLE/);
  const h = harness(); h.controller.observe(); await h.tick(5000); assert.equal(h.calls.length, 0, "opening an initial model does not submit it");
  assert.equal(h.reads(), 0, "opening the dashboard does not copy the potentially large review snapshot");
  h.source(snapshot(3)); h.controller.observe(); await h.tick(5000); assert.equal(h.calls.length, 0, "programmatic restore is not a human review");
  assert.equal(h.reads(), 0, "unarmed camera or programmatic updates do not read the source");
  h.mutate(snapshot(4)); await h.tick(2499); assert.equal(h.calls.length, 0); await h.tick(1); assert.equal(h.calls.length, 1);
  assert.equal(h.reads(), 1, "a settled change captures its full review exactly once, including hashing and save completion");
  assert.equal(h.states.at(-1), "saved"); assert.equal(h.calls[0].model.plates.length, 4); assert.match(h.calls[0].modelFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(h.calls[0].reviewData.calculations.finance.equityIrr, 8.5);
  assert.doesNotMatch([...h.store.values()].join(), /1165010800115960003|서울시|rent|finance|LOCAL-GEOMETRY/);
  h.controller.noteInteraction(); h.controller.observe(); await h.tick(40000); assert.equal(h.calls.length, 1, "a repeated calculation does not duplicate a review");
  h.mutate(snapshot(5)); await h.tick(1000); h.mutate(snapshot(6)); await h.tick(1000); h.mutate(snapshot(7)); await h.tick(2500);
  assert.equal(h.calls.length, 2); assert.equal(h.calls[1].summary.floors, 7, "slider changes coalesce into the latest stable plan");
  h.mutate(snapshot(8)); await h.tick(2500); assert.equal(h.calls.length, 2); await h.tick(27500); assert.equal(h.calls.length, 3);
  const nextFinance = snapshot(8); nextFinance.reviewData.project.inputs.rent = 140; h.mutate(nextFinance); await h.tick(30000);
  assert.equal(h.calls.length, 4); assert.equal(h.calls[3].reviewData.project.inputs.rent, 140, "finance-only changes are not silently discarded");
  const nextTimestamp = structuredClone(nextFinance); nextTimestamp.reviewData.runtime.capturedAt = "2099-01-01"; h.source(nextTimestamp); h.controller.observe(); await h.tick(30000);
  assert.equal(h.calls.length, 4, "timestamp-only changes do not add reviews");
  h.mutate(snapshot(9)); h.source(snapshot(9, { eligible: false })); h.controller.observe(); await h.tick(60000);
  assert.equal(h.calls.length, 4, "invalid or missing parcels cancel pending collection");
  h.mutate(snapshot(10)); h.controller.dispose(); await h.tick(60000); assert.equal(h.calls.length, 4);

  let fail = true;
  const e = harness({ save: () => { if (fail) throw new Error("PRIVATE-SERVER-DETAIL"); return { study: { id: "existing-review" }, created: false, review: { status: "collected" } }; } });
  e.controller.observe(); e.mutate(snapshot(3)); await e.tick(2500); assert.equal(e.states.at(-1), "error"); assert.equal(e.controller.state().submissions, 0);
  await e.tick(60000); assert.equal(e.calls.length, 1, "a failed save does not enter an automatic retry loop");
  fail = false; e.controller.retry(); await e.tick(2500); assert.equal(e.calls.length, 2); assert.equal(e.states.at(-1), "saved");
  assert.equal(e.controller.state().submissions, 1); assert.doesNotMatch(e.states.join(), /PRIVATE/);
  const restored = harness({ storage: e.storage }); restored.controller.observe(); restored.mutate(snapshot(3)); await restored.tick(60000);
  assert.equal(restored.calls.length, 0, "acknowledged fingerprints survive a dashboard refresh");
  let staleFail = true;
  const retryCurrent = harness({ save: () => { if (staleFail) throw new Error("failure"); return { study: { id: "current" }, created: true, review: { status: "collected" } }; } });
  retryCurrent.controller.observe(); retryCurrent.mutate(snapshot(3)); await retryCurrent.tick(2500); retryCurrent.source(snapshot(4)); staleFail = false; retryCurrent.controller.retry(); await retryCurrent.tick(30000);
  assert.equal(retryCurrent.calls.at(-1).summary.floors, 4, "manual retry re-reads the current valid record");
  const retryInvalid = harness({ save: () => { throw new Error("failure"); } }); retryInvalid.controller.observe(); retryInvalid.mutate(snapshot(3)); await retryInvalid.tick(2500);
  retryInvalid.source(snapshot(3, { eligible: false })); retryInvalid.controller.retry(); await retryInvalid.tick(30000); assert.equal(retryInvalid.calls.length, 1);

  let finish;
  const concurrent = harness({ save: () => new Promise(resolve => { finish = resolve; }) });
  concurrent.controller.observe(); concurrent.mutate(snapshot(3)); await concurrent.tick(2500); concurrent.mutate(snapshot(4)); await concurrent.tick(60000);
  assert.equal(concurrent.calls.length, 1, "only one save runs at a time");
  finish({ study: { id: "first" }, created: true, review: { status: "collected" } }); await concurrent.tick(0); await concurrent.tick(2500);
  assert.equal(concurrent.calls.length, 2); assert.equal(concurrent.calls[1].summary.floors, 4);
  finish({ study: { id: "second" }, created: true, review: { status: "collected" } }); await concurrent.tick(0);
  let finishHash;
  const changing = harness({ hashFingerprint: () => new Promise(resolve => { finishHash = resolve; }) });
  changing.controller.observe(); changing.mutate(snapshot(3)); await changing.tick(2500); changing.mutate(snapshot(4)); finishHash(hash("stale")); await changing.tick(0);
  assert.equal(changing.calls.length, 0, "a plan changed during hashing is not submitted");
  await changing.tick(30000); finishHash(hash(api.fingerprintSource(snapshot(4)))); await changing.tick(0); assert.equal(changing.calls.length, 1);
  const reset = harness(); reset.controller.observe(); reset.mutate(snapshot(3)); reset.controller.cancelInteraction(); reset.source(snapshot(4)); reset.controller.observe(); await reset.tick(60000);
  assert.equal(reset.calls.length, 0, "reset and project restore disarm collection");
  const malformed = harness({ save: () => ({ study: { id: "old-generation" }, created: true, generation: { status: "ready" } }) });
  malformed.controller.observe(); malformed.mutate(snapshot(3)); await malformed.tick(2500); assert.equal(malformed.states.at(-1), "error", "an old image-generation response cannot masquerade as a saved review");
  const rolling = harness(); rolling.controller.observe();
  for (let i = 0; i < 110; i++) { const value = snapshot(3); value.reviewData.project.inputs.rent += i; rolling.mutate(value); await rolling.tick(30000); }
  assert.equal(rolling.calls.length, 110); assert.equal(rolling.controller.state().seen, 100); assert.equal(JSON.parse([...rolling.store.values()][0]).fingerprints.length, 100);
  assert.equal([...rolling.store.keys()][0], "formequa:study-reviews:v1");
  const burst = harness(); burst.controller.observe();
  for (let i = 0; i < 60; i++) { const value = snapshot(); value.reviewData.project.inputs.rent += i; burst.mutate(value); await burst.tick(20); }
  assert.equal(burst.reads(), 0, "continuous slider changes do not copy the large review on every input");
  await burst.tick(2500); assert.equal(burst.reads(), 1); assert.equal(burst.calls.length, 1);
  assert.equal(burst.calls[0].reviewData.project.inputs.rent, 159);
  await burst.tick(11000); for (let i = 0; i < 30; i++) burst.controller.observe(); await burst.tick(30000);
  assert.equal(burst.reads(), 1, "view-only updates after the interaction window perform no snapshot work");
  const delayed = harness(); delayed.controller.observe(); delayed.mutate(snapshot(3)); await delayed.tick(2500);
  delayed.mutate(snapshot(4)); await delayed.tick(2500); delayed.controller.observe(); await delayed.tick(2500);
  await delayed.tick(30000); assert.equal(delayed.calls.length, 2, "a repeated render while waiting for the 30-second interval does not drop the pending review");
  assert.equal(delayed.calls[1].summary.floors, 4);
  const initialDetail = harness(); initialDetail.controller.observeDetail(); initialDetail.controller.observe(); await initialDetail.tick(30000);
  assert.equal(initialDetail.reads(), 0); assert.equal(initialDetail.calls.length, 0); assert.equal(initialDetail.controller.state().hasUserReviewed, false, "initial plans, context and camera-only updates do not authorize collection");
  const detail = harness(); detail.controller.noteInteraction(); await detail.tick(12000);
  const detailPlan = snapshot(); detailPlan.reviewData.floorPlans.rooms.push({ name: "새 실내 검토", area: 18 }); detail.source(detailPlan);
  detail.controller.observeDetail(); await detail.tick(2500);
  assert.equal(detail.calls.length, 1); assert.equal(detail.reads(), 1, "a user-requested detailed review may finish after the input window");
  assert.equal(detail.calls[0].reviewData.floorPlans.rooms.length, 2);
  await detail.tick(30000); const detailLaw = structuredClone(detailPlan); detailLaw.reviewData.legalEvidence.lookup = { article: "조회한 원문", status: "complete" }; detail.source(detailLaw);
  detail.controller.observeDetail(); await detail.tick(2500); assert.equal(detail.calls.length, 2); assert.equal(detail.calls[1].reviewData.legalEvidence.lookup.status, "complete");
  await detail.tick(30000); detailLaw.reviewData.runtime.capturedAt = "2099-01-01"; detail.source(detailLaw); detail.controller.observeDetail(); await detail.tick(2500);
  assert.equal(detail.calls.length, 2, "repeated detail events with unchanged review data remain deduplicated");
  detail.controller.cancelInteraction(); detailLaw.reviewData.legalEvidence.lookup.status = "new-detail-after-restore"; detail.source(detailLaw);
  const beforeRestoreReads = detail.reads(); detail.controller.observeDetail(); await detail.tick(30000);
  assert.equal(detail.reads(), beforeRestoreReads); assert.equal(detail.calls.length, 2, "reset and project restore revoke authorization for late detail events");
  const pendingDetail = harness(); pendingDetail.controller.noteInteraction(); pendingDetail.controller.observeDetail(); pendingDetail.controller.cancelInteraction(); await pendingDetail.tick(30000);
  assert.equal(pendingDetail.reads(), 0, "reset cancels an already scheduled detail capture");
  const zeroFloor = harness(); zeroFloor.controller.observe(); zeroFloor.mutate(blocked); await zeroFloor.tick(2500);
  assert.equal(zeroFloor.calls.length, 1); assert.equal(zeroFloor.calls[0].summary.floors, 0); assert.deepEqual(zeroFloor.calls[0].model.plates, []);
  assert.match(zeroFloor.calls[0].reviewData.calculations.model.constraint, /계획 불가/);
  const brokenStore = harness({ storage: { getItem() { throw new Error("disabled"); }, setItem() { throw new Error("disabled"); } } });
  brokenStore.controller.observe(); brokenStore.mutate(snapshot(3)); await brokenStore.tick(2500); assert.equal(brokenStore.calls.length, 1);

  const client = fs.readFileSync(path.join(__dirname, "../study-publication.js"), "utf8");
  assert.match(client, /\/api\/v1\/study-reviews/); assert.match(client, /검토 기록 저장/); assert.match(client, /주간 검토용/); assert.match(client, /event\.isTrusted/); assert.match(client, /atelier:project-loaded/);
  assert.match(client, /atelier:review-detail-updated/); assert.match(client, /#btnOpenInterior/); assert.match(client, /#btnFetchLawLive/); assert.match(client, /#btnVerifyPythonSkills/); assert.match(client, /#realyticsRunAnalysis/);
  assert.match(client, /VIEW_CONTROLS = .*#interiorWalkSpeed/);
  assert.doesNotMatch(client, /THREE|captureModelImage|AtelierStudyRenderer|imageDataUrl|onPublished|localStorage|queued|processing|awaiting_configuration|Gemini|OpenAI|fetch\(["']https?:/);
  assert.equal(api.captureModelImage, undefined); assert.equal(api.publicPayload, undefined);
  console.log("study-publication: complete private JSON, stable identities, credentials excluded, debounce, dedupe and recovery passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
