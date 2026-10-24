/** Program selection and sourced use screening shared by both work surfaces. */
(() => {
  "use strict";
  const byId = id => document.getElementById(id);
  const programs = {
    office: { use: "업무시설(오피스)", name: "오피스", title: "Office study" },
    hotel: { use: "숙박시설(호텔)", name: "호텔", title: "Hotel study" },
    housing: { use: "공동주택(주상복합)", name: "주거 · 공동주택", title: "Residential study" },
    officetel: { use: "업무시설(오피스텔)", name: "오피스텔", title: "Officetel study" },
    living: { use: "업무시설(오피스텔)", name: "리빙 · 코리빙", title: "Co-living study" },
    knowledge: { use: "지식산업센터", name: "지식산업센터", title: "Creative workplace" },
    retail: { use: "근린생활시설(리테일)", name: "리테일 · 근린생활", title: "Retail study" },
    sales: { use: "판매시설", name: "판매시설", title: "Retail study" }
  };
  function currentProgram() {
    if (state.spaceProgram === "coliving" && /공동주택|오피스텔/.test(state.buildingUse)) return "living";
    return Object.keys(programs).find(key => key !== "living" && programs[key].use === state.buildingUse) || "office";
  }
  function applyProgram(key) {
    const program = programs[key];
    if (!program) return;
    state.spaceProgram = key === "living" ? "coliving" : "standard";
    state.buildingUse = program.use;
    state.residentialType = key === "housing" ? "apartment" : "officetel";
    state.mixedUseProfile = "office_retail";
    state.floorUseOverrides = {};
    state.selectedFloorLevel = null;
    syncWorkspaceInputsToUI();
    updateAllCalculationsAndUI();
  }
  function addText(parent, tag, text, className) {
    const el = document.createElement(tag); el.textContent = text;
    if (className) el.className = className;
    parent.append(el); return el;
  }
  function render(detail) {
    const model = detail?.model || state.lastComputed?.model;
    const select = byId("selectStudyProgram");
    if (!select || !model) return;
    const key = currentProgram(), program = programs[key];
    select.value = key;
    byId("hotelTypeField").hidden = key !== "hotel" && !model.floorPlates.some(fp => fp.use === "hotel");
    byId("selectHotelType").value = state.hotelType || "unconfirmed";
    byId("livingLegalUseField").hidden = key !== "living";
    byId("selectLivingLegalUse").value = state.buildingUse;
    const notes = key === "living" ? "리빙은 공간 콘셉트입니다. 선택한 공동주택·오피스텔 기준으로 검토하며, 생활숙박시설을 주거로 가정하지 않습니다."
      : key === "hotel" ? (state.financeMode === "hotel" ? "객실·욕실·로비를 자동 배치하고 ADR·가동률·운영비를 반영합니다. 운영 객실 수는 법정 정원이 아닌 평면 초안 또는 사용자 가정입니다." : "객실·욕실·로비를 자동 배치합니다. 현재 임대 시나리오이며, 수입 모델을 ‘호텔 운영 + 비호텔 임대’로 바꾸면 객실 매출·운영비를 반영합니다.")
      : key === "housing" || key === "officetel" ? "독립 출입 주거 모듈을 배치합니다. 실내 초안의 세대수와 주차 산정 세대수는 별도 지표입니다."
      : "선택한 프로그램에 따라 층별 용도·실내 배치·주차 수요를 다시 계산합니다.";
    byId("programUseBrief").textContent = notes;
    const permission = model.usePermission;
    const status = permission?.status || "unverified";
    byId("programPermissionStatus").textContent = permission?.label || "용도 허용 미확인";
    byId("programPermissionStatus").dataset.status = status;
    byId("programDensitySummary").textContent = `${state.zoning} · 건폐 상한 ${model.zoningRule.maxBcr}% · 용적 상한 ${model.zoningRule.maxFar}%`;
    const box = byId("programPermissionBody"); box.replaceChildren();
    addText(box, "p", permission?.summary || "용도지역별 법규 모듈을 확인하세요.");
    if (status === "prohibited") addText(box, "p", "이 조합은 일반 규정상 허용되지 않습니다. 모형·사업성은 가정 비교용이며 사업 가능안으로 판정하지 않습니다.", "program-exclusion");
    addText(box, "p", "예시 지번의 용도지역·경계는 검증된 토지이용계획 자료가 아닙니다. 지구단위계획·교육환경보호구역·도로·보호지구 및 개별 승인 조건을 추가 확인해야 합니다.", "program-note");
    for (const entry of permission?.entries || []) {
      addText(box, "p", `${entry.label} · ${entry.statusLabel || entry.status}: ${entry.summary}`);
      if (entry.constraints?.length) {
        const list = document.createElement("ul");
        entry.constraints.forEach(item => addText(list, "li", typeof item === "string" ? item : item.summary || item.label || "조건 확인"));
        box.append(list);
      }
    }
    const api = window.AtelierUsePermissions;
    if (api) {
      const table = document.createElement("table"); table.className = "program-use-table";
      const head = document.createElement("thead"), header = document.createElement("tr");
      ["검토 용도", "입력 용도지역의 일반 규정"].forEach(text => addText(header, "th", text)); head.append(header); table.append(head);
      const body = document.createElement("tbody");
      for (const candidate of ["office", "hotel", "housing", "officetel"]) {
        const result = api.evaluate({ ...state, buildingUse: programs[candidate].use, mixedUseProfile: "office_retail", floorUseOverrides: {}, residentialType: candidate === "housing" ? "apartment" : "officetel" });
        const row = document.createElement("tr");
        addText(row, "td", programs[candidate].name); addText(row, "td", result.label + " · " + result.summary); body.append(row);
      }
      table.append(body); box.append(table);
    }
    const sources = permission?.sources || [];
    for (const source of sources) {
      const link = addText(box, "a", source.title + " ↗"); link.href = source.url; link.target = "_blank"; link.rel = "noopener noreferrer";
    }
    document.querySelectorAll("[data-use-scenario-status]").forEach(el => {
      el.hidden = status !== "prohibited";
      el.textContent = "용도 허용 불가 · 가정 비교용 모형";
    });
    const title = byId("editorialProjectName");
    if (title) title.textContent = (title.textContent.split(" — ")[0] || "Seoul") + " — " + program.title;
  }
  window.addEventListener("atelier:updated", event => render(event.detail));
  window.addEventListener("DOMContentLoaded", () => {
    byId("selectStudyProgram")?.addEventListener("change", event => applyProgram(event.target.value));
    byId("selectHotelType")?.addEventListener("change", event => { state.hotelType = event.target.value; updateAllCalculationsAndUI(); });
    byId("selectLivingLegalUse")?.addEventListener("change", event => {
      state.buildingUse = event.target.value;
      state.residentialType = state.buildingUse.includes("공동주택") ? "apartment" : "officetel";
      state.floorUseOverrides = {}; state.selectedFloorLevel = null;
      syncWorkspaceInputsToUI(); updateAllCalculationsAndUI();
    });
    render();
  });
})();
