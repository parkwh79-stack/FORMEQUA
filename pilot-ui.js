/** Pilot presentation policy. Hidden controls are retained for the shared engine;
 * this is a product scope switch, never an access-control or source-protection boundary. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.AtelierPilot = api; if (root.document) api.mount(root); }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  const features = Object.freeze({
    advancedPlanning: false, investorWaterfall: false, spreadsheetExport: false,
    bimExchange: false, apiExplorer: false, auxiliaryCalculators: false,
    illustrativeComparisons: false, detailedSensitivity: false, videoExport: false,
    envelopePerformance: false, structuralDiagnostics: false
  });
  const enabled = true;
  const allows = feature => !enabled || features[feature] === true;
  function restrict(element) {
    if (!element || allows(element.dataset?.pilotFeature)) return false;
    element.hidden = true;
    element.inert = true;
    element.setAttribute("aria-hidden", "true");
    if (element.matches?.("button,input,select,textarea")) element.disabled = true;
    return true;
  }
  function mount(host) {
    const doc = host.document;
    doc.documentElement.classList.add("pilot-release");
    function apply() { doc.querySelectorAll("[data-pilot-feature]").forEach(restrict); }
    // Capture before existing export/auxiliary handlers. This also rejects a
    // programmatic click on a retained control; it does not pretend to secure APIs.
    function preventUnavailable(event) {
      const control = event.target?.closest?.("[data-pilot-feature]");
      if (control && !allows(control.dataset.pilotFeature)) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }
    doc.addEventListener("click", preventUnavailable, true);
    doc.addEventListener("submit", preventUnavailable, true);
    const amount = (value, places = 1) => Number.isFinite(value)
      ? value.toLocaleString("ko-KR", { maximumFractionDigits: places }) : "—";
    function update(event) {
      const model = event?.detail?.model, f = model?.finance;
      if (!f) return;
      const summary = doc.getElementById("pilotReturnSummary");
      if (summary) summary.textContent = `NPV ${amount(f.npv8Eok)}억 · 자기자본 배수 ${amount(f.equityMultiple, 2)}x`;
      const chapter = doc.getElementById("pilotFinanceSummary");
      if (chapter) chapter.textContent = `입력 가정 · IRR ${amount(f.equityXirrPct)}%`;
      const facade = doc.getElementById("facadeLiveSummaryCard"), material = model.facade;
      if (facade && material) {
        const heading = doc.createElement("strong");
        heading.textContent = `${material.nameKr || "외관"} · 개산 ${amount(material.totalFacadeCostEok)}억원`;
        const detail = doc.createElement("p");
        detail.textContent = `${material.claddingShortKr || "재료"} · ${material.colorNameKr || "색상"} / ${material.glassNameKr || "유리"} · 입면 ${amount(material.grossWallAreaSqm, 0)}㎡`;
        facade.replaceChildren(heading, detail);
      }
    }
    host.addEventListener("atelier:updated", event => { apply(); update(event); });
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", apply);
    else apply();
  }
  return Object.freeze({ enabled, features, allows, restrict, mount });
});
