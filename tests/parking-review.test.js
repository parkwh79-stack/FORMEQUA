"use strict";
const assert = require("node:assert/strict");
const { mount } = require("../parking-review.js");
const { generate } = require("../parking-layout.js");

// Render the real UI through its public update event. The small DOM adapter
// checks what users actually see; it does not duplicate the presentation logic.
function mountedReview() {
  const elements = new Map(), events = new Map();
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.value = ""; this.listeners = new Map(); }
    set id(value) { this._id = value; elements.set(value, this); }
    get id() { return this._id; }
    set innerHTML(value) {
      this._html = value;
      for (const match of value.matchAll(/\bid="([^"]+)"/g)) {
        if (!elements.has(match[1])) { const child = new Element("div"); child.id = match[1]; }
      }
    }
    get innerHTML() { return this._html || ""; }
    append(child) { this.children.push(child); this.firstElementChild ||= child; }
    replaceChildren(...children) { this.children = children; this.firstElementChild = children[0] || null; this.value = children[0]?.value || ""; }
    addEventListener(name, handler) { this.listeners.set(name, handler); }
  }
  const panel = new Element("section"); panel.id = "realyticsStudyPanel"; panel.firstElementChild = new Element("div");
  const host = { document: { readyState: "complete", getElementById: id => elements.get(id), createElement: tag => new Element(tag) },
    addEventListener: (name, handler) => events.set(name, handler), requestAnimationFrame: fn => fn() };
  mount(host);
  return { el: id => elements.get(id), render(model) { events.get("atelier:updated")({ detail: { model } }); } };
}

const failedLayout = { status: "incomplete", statusLabel: "배치 미완료", capacityVerified: false,
  capacityCount: 0, perFloorCount: 0, levels: [], validation: { valid: false }, warnings: [], assumptions: [] };
const model = { floorPlates: [], areas: { basementPlateSqm: 1518.9653555736866, undergroundGfaSqm: 7594.826777868433 },
  parking: { layout: failedLayout, capacityCount: 0, legalParkingCount: 40, plannedParkingCount: 0, deficit: 40,
    disabledParkingCount: 2, evChargerFastSlow: 3 }, constraints: { parkingFitDeferred: true } };
const ui = mountedReview(), original = JSON.stringify(model);
ui.render(model);
assert.equal(ui.el("parkingDraftHeadline").textContent, "배치 미완료 · 지하 5개 층 검토", "no generated layouts must not erase actual planned basement levels");
assert.doesNotMatch(ui.el("parkingDraftHeadline").textContent, /B0/);
const metrics = ui.el("parkingLayoutMetrics").innerHTML, warnings = ui.el("parkingDraftWarnings").innerHTML;
assert.match(metrics, /미확보 수량/); assert.match(metrics, /40대 · 계획 보완 필요/);
assert.match(metrics, /주차 미확보 · 자동 축소 보류/);
assert.match(metrics, /0대 · 실제 수용 미확정/);
assert.match(metrics, /구획 생성 미완료 · 주차 불가 판정 아님/);
assert.match(warnings, /자동 매스 축소를 보류/);
assert.match(warnings, /확정 결과가 아닙니다/);
assert.match(ui.el("parkingDraftDrawing").innerHTML, /대지 전체의 주차 불가 판정은 아닙니다/);
assert.equal(ui.el("parkingDraftDownload").disabled, true);
assert.equal(ui.el("parkingDraftLevel").disabled, true);
assert.equal(JSON.stringify(model), original, "presentation must not alter mass or parking calculations");

// Explicit model count and unknown count are distinguished from completed plan
// levels; a missing floor count is never silently advertised as basement zero.
ui.render({ ...model, floorsBelow: 3, areas: {}, constraints: {} });
assert.equal(ui.el("parkingDraftHeadline").textContent, "배치 미완료 · 지하 3개 층 검토");
assert.doesNotMatch(ui.el("parkingLayoutMetrics").innerHTML, /자동 축소 보류/);
ui.render({ ...model, areas: {}, constraints: {} });
assert.equal(ui.el("parkingDraftHeadline").textContent, "배치 미완료 · 지하층 수 확인 전");
ui.render({ ...model, floorsBelow: 0, areas: {}, constraints: {} });
assert.match(ui.el("parkingDraftHeadline").textContent, /지하층 없음/);

// A valid concept layout still discloses unverified actual capacity; generated
// geometry enables the floor selector and drawing without claiming approval.
const good = generate({ widthM: 45, depthM: 60, floorsBelow: 2 });
assert.ok(good.capacityCount > 0);
ui.render({ floorPlates: [], floorsBelow: 2, parking: { layout: good, capacityCount: good.capacityCount,
  legalParkingCount: 40, plannedParkingCount: 40, deficit: 0 }, constraints: {} });
assert.match(ui.el("parkingDraftHeadline").textContent, /면 초안 · 지하 2개 층 검토/);
assert.match(ui.el("parkingLayoutMetrics").innerHTML, /경계·충돌·차로 연결 통과 · 인허가 확인 전/);
assert.match(ui.el("parkingLayoutMetrics").innerHTML, /실제 수용 미확정/);
assert.doesNotMatch(ui.el("parkingDraftWarnings").innerHTML, /현재 템플릿의 배치 미완료/);
assert.equal(ui.el("parkingDraftLevel").children.length, 2);
assert.equal(ui.el("parkingDraftLevel").disabled, false);
assert.equal(ui.el("parkingDraftDownload").disabled, false);
assert.match(ui.el("parkingDraftDrawing").innerHTML, /<svg/);

// Preserve the legal zero-demand scenario while making no physical capacity
// assertion when a concept template has not generated a layout.
ui.render({ ...model, parking: { ...model.parking, legalParkingCount: 0, plannedParkingCount: 0, deficit: 0 }, constraints: {} });
assert.match(ui.el("parkingLayoutMetrics").innerHTML, /계산상 0대 · 실제 수용 확인 전/);
assert.doesNotMatch(ui.el("parkingDraftWarnings").innerHTML, /자동 매스 축소를 보류/);
console.log("parking review: actual basement counts, incomplete-template wording, deferred mass fit, unverified capacity, rendered plans and zero demand passed");
