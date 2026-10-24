"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const policy = require("../pilot-ui.js");
for (const feature of ["advancedPlanning", "investorWaterfall", "spreadsheetExport", "bimExchange", "apiExplorer", "auxiliaryCalculators"]) assert.equal(policy.allows(feature), false);
assert.ok(Object.isFrozen(policy) && Object.isFrozen(policy.features));
const node = feature => ({ dataset: { pilotFeature: feature }, setAttribute(name, value) { this[name] = value; }, matches() { return true; } });
const blocked = node("spreadsheetExport"); policy.restrict(blocked);
assert.equal(blocked.hidden, true); assert.equal(blocked.inert, true); assert.equal(blocked.disabled, true);
const listeners = {}, hostListeners = {}, nodes = { pilotReturnSummary: {}, pilotFinanceSummary: {} };
const document = { readyState: "complete", documentElement: { classList: { add() {} } },
  querySelectorAll: () => [blocked], getElementById: id => nodes[id] || null,
  addEventListener(type, fn) { listeners[type] = fn; } };
policy.mount({ document, addEventListener(type, fn) { hostListeners[type] = fn; } });
let prevented = 0, stopped = 0;
listeners.click({ target: { closest: () => blocked }, preventDefault() { prevented++; }, stopImmediatePropagation() { stopped++; } });
assert.equal(prevented, 1); assert.equal(stopped, 1, "retained export button cannot invoke its handler through a synthetic click");
listeners.click({ target: { closest: () => null }, preventDefault() { prevented++; }, stopImmediatePropagation() { stopped++; } });
assert.equal(prevented, 1, "ordinary model and input controls are unaffected");
hostListeners["atelier:updated"]({ detail: { model: { finance: { npv8Eok: 25, equityMultiple: 1.5, equityXirrPct: 12 } } } });
assert.doesNotMatch(nodes.pilotReturnSummary.textContent, /LP|GP/); assert.match(nodes.pilotReturnSummary.textContent, /25억/);
assert.match(nodes.pilotFinanceSummary.textContent, /12%/);
const source = fs.readFileSync(path.join(__dirname, "../spatial-review.js"), "utf8");
let planningListenerCount = 0;
vm.runInNewContext(source, { window: { document: {}, AtelierPilot: policy, addEventListener() { planningListenerCount++; } } });
assert.equal(planningListenerCount, 0, "advanced planning cannot mount or compute navigation in pilot");
const html = fs.readFileSync(path.join(__dirname, "../dashboard.html"), "utf8");
for (const id of ["btnExportReport", "btnExportIfc", "btnVerifyPythonSkills", "drawerTestFit", "drawerResidualSensitivity"]) {
  const opening = html.match(new RegExp('<[^>]*id="' + id + '"[^>]*>'))?.[0];
  assert.ok(opening?.includes("data-pilot-feature=") && /\bhidden\b/.test(opening) && /\binert\b/.test(opening), id + " is hidden before any JS executes");
}
assert.ok(html.indexOf("pilot-ui.js") < html.indexOf('src="app.js'), "policy loads before application initialization");
assert.match(html, /project-files\.js/, "project JSON save and load remain available");
console.log("PASS pilot presentation gates, inactive navigation/API/export tools and unchanged core controls");
