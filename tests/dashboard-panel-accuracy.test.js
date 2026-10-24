"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const study = require("../dashboard-study.js"), planner = require("../interior-plan.js"), { planCore } = require("../core-layout.js");
const { analyze } = require("../analysis-engine.js");

const fp = { level: 1, use: "main", widthM: 32, depthM: 28, northShiftM: 0, zBottom: 0, zTop: 4, areaSqm: 896, netFloorSqm: 520 };
const core = planCore({ ...fp, coreType: "center" }), valid = planner.generate({ ...fp, coreLayout: core });
const failed = planner.generate({ ...fp, coreLayout: { ...core, status: "unfeasible" } });
const omitted = planner.generate({ ...fp, coreLayout: core }, { detailLevel: "massing" });
assert.equal(study.planStatus(valid, fp).usable, true);
assert.equal(study.planStatus(failed).status, "failed");
assert.equal(study.planStatus(omitted).status, "not-generated");
assert.equal(study.planStatus(null).status, "missing");
assert.equal(study.planStatus({ rooms: [], metrics: { roomCount: 0 } }).status, "empty");
const summary = study.planSummary([fp, { ...fp, level: 2 }], new Map([[1, valid], [2, failed]]));
assert.equal(summary.generatedFloors, 1); assert.equal(summary.incompleteFloors, 1); assert.equal(summary.complete, false);
assert.equal(summary.totals.workstationCount, valid.metrics.workstationCount, "failed floor does not masquerade as a completed zero");
const incompleteQuantity = { level: 1, rooms: [{ id: "unquantified" }], metrics: { roomCount: 1 } };
assert.equal(study.occupancyText(fp, incompleteQuantity), "좌석 수량 미검토");
assert.equal(study.planSummary([fp], new Map([[1, incompleteQuantity]])).metricCoverage.workstationCount, 0, "missing quantities remain unreviewed");
assert.equal(study.planOptions({}, { representation: { detailLevel: "massing" } }).detailLevel, "massing");
assert.notEqual(study.planSignature(fp, { detailLevel: "massing" }), study.planSignature(fp, { detailLevel: "concept" }));
assert.equal(study.analysisRequest({ modelDetail: "massing" }).inputs.modelDetail, "massing");
const capital = Object.fromEntries(study.financeRows({ equityRequiredEok: 20, peakEquityEok: 35, equityXirrPct: NaN }));
assert.equal(capital["사업비 배분 자기자본"], "20억원");
assert.equal(capital["최대 누적 자금부족 (Peak Equity)"], "35억원");
assert.match(capital["자기자본 XIRR"], /산출 불가/);

// Mount the actual dashboard script. This lightweight DOM exercises its real
// handlers and displayed values without replacing the renderer/view-model code.
function harness(model, overrides = {}, pilot = false) {
  const nodes = new Map(), frames = [], requests = [], pending = [];
  class Element {
    constructor(tag = "div") { this.tag = tag; this.listeners = {}; this.dataset = {}; this.value = ""; this.textContent = ""; this.disabled = false; this.hidden = false; this.children = []; this.queries = new Map(); this.classList = { toggle() {}, add() {}, remove() {} }; }
    set innerHTML(value) {
      this.html = value; this.queries.clear();
      for (const match of value.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
        const e = nodes.get(match[1]) || new Element(); e.id = match[1]; e.hidden = /\bhidden(?:\s|>)/.test(match[0]); e.disabled = /\bdisabled(?:\s|>)/.test(match[0]); nodes.set(e.id, e);
      }
    }
    get innerHTML() { return this.html || ""; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    emit(type, extra = {}) { return Promise.all((this.listeners[type] || []).map(fn => fn({ type, target: this, currentTarget: this, ...extra }))); }
    dispatchEvent(event) { this.emit(event.type, { ...event, target: this }); }
    setAttribute(name, value) { this[name] = value; }
    replaceChildren(...children) { this.children = children; }
    append(child) { this.children.push(child); if (child.id) nodes.set(child.id, child); }
    focus() {} scrollIntoView() {} showModal() { this.open = true; } close() { this.open = false; }
    querySelectorAll(selector) {
      if (this.queries.has(selector)) return this.queries.get(selector);
      const attribute = selector.match(/\[(data-[\w-]+)\]/)?.[1], result = [];
      if (attribute) for (const match of this.innerHTML.matchAll(new RegExp('<[^>]*\\b' + attribute + '="([^"]+)"[^>]*>', 'g'))) {
        const e = new Element(); e.dataset[attribute.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = match[1]; result.push(e);
      }
      this.queries.set(selector, result); return result;
    }
  }
  const add = id => { const e = new Element(); e.id = id; nodes.set(id, e); return e; };
  for (const id of ["realyticsStudyPanel", "realyticsProgramBar", "btnOpenInterior", "interiorFloorSelect", "selectModelDetail"]) add(id);
  const doc = { readyState: "complete", getElementById: id => nodes.get(id) || null, createElement: tag => new Element(tag), body: new Element(), querySelectorAll: () => [], addEventListener() {} };
  const listeners = {}, state = { parcelKey: "custom_seoul", option: "A", buildingUse: "업무시설(오피스)", coreType: "center", modelDetail: "concept",
    floorsBelow: 1, zoning: "일반상업지역", selectedFloorLevel: 2, loanLtvPct: 60, loanRatePct: 6, parkingMode: "report", ...overrides, lastComputed: { model } };
  const host = { document: doc, AtelierInteriorPlan: planner, requestAnimationFrame: fn => frames.push(fn), setTimeout, clearTimeout,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }, dispatchEvent(event) { (listeners[event.type] || []).forEach(fn => fn(event)); },
    fetch(url, options) { requests.push({ url, options }); return new Promise(resolve => pending.push(resolve)); },
    rebuild3DScene() { host.sceneRebuilds = (host.sceneRebuilds || 0) + 1; host.dispatchEvent({ type: "atelier:scene-rebuilt" }); },
    renderFloorInspectorCard() { host.inspectorUpdates = (host.inspectorUpdates || 0) + 1; } };
  if (pilot) host.AtelierPilot = require("../pilot-ui.js");
  const context = vm.createContext({ window: host, document: doc, state, URL, AbortController, Event, CustomEvent });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../dashboard-study.js"), "utf8"), context);
  const flush = () => { while (frames.length) frames.shift()(); };
  flush();
  const update = next => { state.lastComputed = { model: next }; host.dispatchEvent({ type: "atelier:updated", detail: { model: next } }); flush(); };
  const respond = (index, value) => pending[index]({ ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => value });
  return { nodes, state, host, requests, respond, update, flush };
}
async function main() {
  const floors = [fp, { ...fp, level: 2, widthM: 24, depthM: 20, areaSqm: 480, netFloorSqm: 280, zBottom: 4, zTop: 8 }];
  const common = planCore({ floorPlates: floors, coreType: "center" }); floors.forEach(f => { f.coreLayout = common; });
  const model = { floorPlates: floors, actualFloorsAbove: 2, requestedFloorsAbove: 2, coreLayout: common,
    representation: { detailLevel: "concept" }, basementPlacement: { widthM: 30, depthM: 22, centerX: 0, centerZ: 0 },
    areas: { aboveGroundGfaSqm: 1376, basementPlateSqm: 660, achievedFarPct: 150, achievedBcrPct: 50 },
    zoningRule: { maxFar: 800, maxBcr: 60 }, constraints: { maxHeightM: 0, warnings: [] }, usePermission: { status: "unverified", label: "확인 필요" },
    finance: { equityRequiredEok: 20, peakEquityEok: 35, totalDevCostEok: 100, weightedLoanRatePct: 7.1 },
    parking: { legalParkingCount: 5, plannedParkingCount: 0, deficit: 5, layout: { status: "incomplete", massFitEligible: false } },
    structuralReview: { status: "unverified", structuralDesignVerified: false }, egress: { stairCount: null, maxTravelDistM: null } };
  const h = harness(model), n = id => h.nodes.get(id);
  const pilot = harness(model, {}, true), p = id => pilot.nodes.get(id);
  assert.match(p("realyticsStudyPanel").innerHTML, /data-pilot-feature="apiExplorer" hidden inert/);
  assert.equal((p("realyticsRunAnalysis").listeners.click || []).length, 0, "pilot does not bind hidden API analysis controls");
  assert.equal((p("realyticsRequestDownload").listeners.click || []).length, 0, "pilot does not bind hidden request export controls");
  assert.doesNotMatch(p("realyticsLawMetrics").innerHTML, /최대 보행거리|계단 수\(검토값\)|구조 설계 검증/, "unverified specialist diagnostics are omitted in pilot");
  assert.match(p("realyticsLawMetrics").innerHTML, /용적률 \/ 적용 기준|주차 최소 \/ 배치 초안/, "core legal density and parking stay visible");
  assert.equal(p("realyticsFinanceMetrics").innerHTML, n("realyticsFinanceMetrics").innerHTML, "pilot gating never changes project-level finance");
  p("realyticsFloorSelect").value = "1"; await p("realyticsFloorSelect").emit("change");
  assert.match(p("realyticsFloorMetrics").innerHTML, /896㎡/, "floor plan remains interactive in pilot");
  await p("realyticsRunAnalysis").emit("click"); assert.equal(pilot.requests.length, 0);
  assert.equal(n("realyticsFloorSelect").value, "2");
  assert.match(n("realyticsFloorMetrics").innerHTML, /480㎡/); assert.match(n("realyticsFloorMetrics").innerHTML, /280㎡/);
  assert.match(n("realyticsFinanceMetrics").innerHTML, /Peak Equity.*35억원/);
  assert.match(n("realyticsAssumptionMetrics").innerHTML, /LTC/); assert.doesNotMatch(n("realyticsAssumptionMetrics").innerHTML, /LTV/);
  assert.match(n("realyticsLawMetrics").innerHTML, /조건 미확인/); assert.match(n("realyticsLawMetrics").innerHTML, /동선·구조 조건 미검토/);
  n("realyticsFloorSelect").value = "1"; await n("realyticsFloorSelect").emit("change");
  assert.equal(h.state.selectedFloorLevel, 1); assert.ok(h.host.sceneRebuilds > 0 && h.host.inspectorUpdates > 0);
  h.state.selectedFloorLevel = 2; h.host.dispatchEvent({ type: "atelier:scene-rebuilt" });
  assert.equal(n("realyticsFloorSelect").value, "2", "3D selection updates the right-hand selected floor");
  h.update({ ...model, actualFloorsAbove: 1, floorPlates: [floors[0]], areas: { ...model.areas, aboveGroundGfaSqm: 896 } });
  assert.equal(h.state.selectedFloorLevel, 1, "removing the selected floor synchronizes a valid remaining selection");
  assert.equal(n("realyticsFloorSelect").value, "1"); h.update(model);
  h.state.selectedFloorLevel = -1; h.host.dispatchEvent({ type: "atelier:scene-rebuilt" });
  assert.equal(n("realyticsFloorSelect").value, "-1");
  assert.match(n("realyticsFloorMetrics").innerHTML, /660㎡/); assert.doesNotMatch(n("realyticsFloorMetrics").innerHTML, /480㎡/);
  assert.match(n("realyticsFloorDrawing").innerHTML, /지하 실내 평면/); assert.equal(n("realyticsPlan3d").disabled, true);
  h.state.selectedFloorLevel = 1;
  const omittedModel = { ...model, representation: { detailLevel: "massing" } }; h.update(omittedModel);
  assert.match(n("realyticsBuildingMetrics").innerHTML, /상세 평면 미생성/); assert.doesNotMatch(n("realyticsBuildingMetrics").innerHTML, /0석/);
  assert.match(n("realyticsUseNote").textContent, /간략 표현으로 상세 평면 생략 2개 층/);
  assert.doesNotMatch(n("realyticsUseNote").textContent, /상세 미완료/);
  assert.match(n("realyticsPlanDescription").textContent, /간략 매스 표시 중/);
  assert.match(n("realyticsFloorsBody").innerHTML, /간략 표현 · 생략/);
  assert.equal(n("realyticsGenerateConcept").hidden, false); assert.equal(n("realyticsPlanLarge").disabled, true);
  assert.match(n("realyticsFloorMetrics").innerHTML, /896㎡/, "massing-only view preserves known floor area");
  assert.match(n("realyticsFinanceMetrics").innerHTML, /35억원/, "representation change preserves computed finance");
  await n("realyticsGenerateConcept").emit("click"); assert.equal(n("selectModelDetail").value, "concept");
  const failedCore = { ...common, status: "unfeasible" };
  h.update({ ...model, coreLayout: failedCore, floorPlates: floors.map(f => ({ ...f, coreLayout: failedCore })) });
  assert.match(n("realyticsBuildingMetrics").innerHTML, /배치 미완료·수량 미확인/); assert.doesNotMatch(n("realyticsBuildingMetrics").innerHTML, /0석/);
  assert.match(n("realyticsFloorMetrics").innerHTML, /코어·평면 배치 미완료/); assert.equal(n("realyticsGenerateConcept").hidden, true);
  h.update(model);
  assert.match(n("realyticsPlanDescription").textContent, /현재 3D 실내와 같은/);
  const pending = n("realyticsRunAnalysis").emit("click");
  const body = JSON.parse(h.requests[0].options.body); assert.equal(body.floorLevel, 1);
  h.state.loanRatePct = 9; h.update(model);
  h.respond(0, { marker: "old-rate", model: { finance: { peakEquityEok: 99999 } } }); await pending;
  assert.match(n("realyticsApiStatus").textContent, /이전 조건/); assert.match(n("realyticsFinanceMetrics").innerHTML, /35억원/);
  assert.equal(body.inputs.loanRatePct, 6, "request captures its original input snapshot");
  const older = n("realyticsRunAnalysis").emit("click");
  h.state.loanRatePct = 8;
  const newer = n("realyticsRunAnalysis").emit("click");
  h.respond(2, { marker: "newest" }); await newer;
  h.respond(1, { marker: "obsolete" }); await older;
  assert.match(n("realyticsResponsePreview").textContent, /newest/); assert.doesNotMatch(n("realyticsResponsePreview").textContent, /obsolete/);
  assert.equal(n("realyticsRunAnalysis").disabled, false);
  // Real shared-engine snapshots: a three-storey 480sqm study and a 15-storey
  // study must not share a fabricated high-rise stair/structure presentation.
  const snapshots = [];
  for (const [name, inputs] of Object.entries({ small: { siteAreaSqm: 400, floorsAbove: 3, floorsBelow: 1, floorHeight: 3.2, targetBcr: 40 },
    large: { siteAreaSqm: 2400, floorsAbove: 15, floorsBelow: 3, floorHeight: 4, targetBcr: 60 } })) {
    const result = analyze({ program: "office", parcelKey: "custom_seoul", inputs: { ...inputs, modelDetail: "auto", parkingMode: "report", zoning: "일반상업지역" } });
    const actual = result.model, panel = harness(actual, result.inputs), html = panel.nodes.get("realyticsLawMetrics").innerHTML;
    assert.match(html, /미검증·해석 미완료/);
    assert.match(html, /동선·구조 조건 미검토/); assert.doesNotMatch(html, /nullm|0개소/);
    assert.ok(panel.nodes.get("realyticsLawSources").children.some(link => decodeURIComponent(link.href).includes("제48조")), "structural law provenance is linked");
    const capitalRows = Object.fromEntries(study.financeRows(actual.finance));
    assert.ok(panel.nodes.get("realyticsFinanceMetrics").innerHTML.includes(capitalRows["최대 누적 자금부족 (Peak Equity)"]));
    if (name === "small") {
      assert.equal(actual.areas.aboveGroundGfaSqm, 480); assert.equal(actual.representation.detailLevel, "massing");
      assert.ok(actual.finance.peakEquityEok > actual.finance.equityRequiredEok, "operating losses make peak funding exceed the initial capital allocation");
      assert.match(panel.nodes.get("realyticsBuildingMetrics").innerHTML, /상세 평면 미생성/);
      assert.match(html, /검사 조건 미해당·면제 아님/);
    } else {
      assert.equal(actual.representation.detailLevel, "concept"); assert.equal(actual.actualFloorsAbove, 15);
      assert.equal(actual.buildingReview.egress.specialStairs.status, "confirmed-trigger");
      assert.match(html, /특별피난계단 규모 조건 해당/);
    }
    snapshots.push({ name, floors: actual.actualFloorsAbove, aboveGroundGfaSqm: actual.areas.aboveGroundGfaSqm,
      detail: actual.representation.detailLevel, structural: actual.buildingReview.structuralReview.status,
      specialStairs: actual.buildingReview.egress.specialStairs.status, stairCount: actual.egress.stairCount,
      equityRequiredEok: actual.finance.equityRequiredEok, peakEquityEok: actual.finance.peakEquityEok });
  }
  console.log(JSON.stringify({ actualPanelSnapshots: snapshots }));
  console.log("Dashboard panel accuracy: generated/missing/failed/massing status, actual floor/net areas, capital/peak units, two-way floor and basement selection, request snapshots and stale/out-of-order API responses passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
