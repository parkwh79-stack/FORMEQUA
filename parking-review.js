/** Interior quantities compared with statutory demand and geometric parking draft. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root?.document) api.mount(root);
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const number = (value, decimals = 0) => finite(value) ? value.toLocaleString("ko-KR", { maximumFractionDigits: decimals }) : "확인 전";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function summarize(model = {}, inputs = {}, generator, cache = new Map()) {
    const names = ["dwellingUnitCount", "privateRoomCount", "guestRoomCount", "guestBedCount", "workstationCount"];
    const totals = Object.fromEntries(names.map(key => [key, 0]));
    let generatedFloors = 0;
    const options = { coreType: inputs.coreType, option: inputs.option, spaceProgram: inputs.spaceProgram, residentialType: inputs.residentialType, housingUnitAreaSqm: inputs.housingUnitAreaSqm };
    for (const floor of model.floorPlates || []) {
      const signature = JSON.stringify([floor, options]);
      let plan = cache.get(signature);
      if (!plan && generator) { plan = generator(floor, options); cache.set(signature, plan); }
      if (!plan?.metrics) continue;
      generatedFloors++;
      names.forEach(key => { totals[key] += finite(plan.metrics[key]) ? plan.metrics[key] : 0; });
    }
    const statutoryUnits = finite(model.parking?.housingUnits) ? model.parking.housingUnits : null;
    return { ...totals, statutoryUnits, unitDifference: statutoryUnits === null ? null : totals.dwellingUnitCount - statutoryUnits, generatedFloors, floorCount: model.floorPlates?.length || 0, isStatutoryCount: false };
  }
  function planSvg(level) {
    if (!level?.bounds) return "";
    const b = level.bounds, scale = 14, pad = 30, w = (b.maxX - b.minX) * scale + pad * 2, h = (b.maxZ - b.minZ) * scale + pad * 2 + 36;
    const x = n => (pad + (n - b.minX) * scale).toFixed(2), y = n => (pad + (n - b.minZ) * scale).toFixed(2);
    const box = (r, fill, stroke = "#8ca3ba", extra = "") => `<rect x="${x(r.minX)}" y="${y(r.minZ)}" width="${((r.maxX - r.minX) * scale).toFixed(2)}" height="${((r.maxZ - r.minZ) * scale).toFixed(2)}" fill="${fill}" stroke="${stroke}" stroke-width=".8" ${extra}/>`;
    const label = (r, text, color = "#28496d", size = 9) => `<text x="${x((r.minX + r.maxX) / 2)}" y="${y((r.minZ + r.maxZ) / 2)}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="${size}" font-weight="700">${esc(text)}</text>`;
    const paths = level.aisles.map(a => box(a, "#edf2f8", "#d8e1ec"));
    const ramps = level.ramps.flatMap(r => [box(r, "#dfc8a6", "#ac895a"), label(r, "램프 ↕ 15%", "#6d4d24")]);
    const solids = [...level.cores, ...level.columns].map(r => box(r, "#859aaf", "#5f7893"));
    const bays = level.spaces.flatMap((s, i) => [box(s, s.type === "accessible_reserved" ? "#cfe4f7" : s.evReserved ? "#d4ede7" : "#fff"), label(s, s.type === "accessible_reserved" ? "장애인" : s.evReserved ? "EV" : String(i + 1), "#294e77", 8)]);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="지하 ${Math.abs(level.level)}층 주차구획 개념 배치"><title>FORMEQUA · B${Math.abs(level.level)} 주차구획 초안</title><rect width="100%" height="100%" fill="#fff"/><g font-family="Arial, Pretendard, sans-serif">${box(b, "#fafcff", "#254c75")}${paths.join("")}${ramps.join("")}${bays.join("")}${solids.join("")}${level.cores.map(c => label(c, "CORE", "#fff", 11)).join("")}<text x="${pad}" y="${h - 26}" font-size="11" fill="#173957" font-weight="700">B${Math.abs(level.level)} · ${level.spaces.length}면 · 단위 m</text><text x="${pad}" y="${h - 10}" font-size="9" fill="#637a93">사각 경계·충돌·차로 연결 검토 / 회전 궤적·단면·인허가 확인 전</text></g></svg>`;
  }
  function basementFloorCount(model, inputs, layout) {
    const valid = n => finite(n) && Number.isInteger(n) && n >= 0;
    if (valid(model.floorsBelow)) return model.floorsBelow;
    const plate = model.areas?.basementPlateSqm, total = model.areas?.undergroundGfaSqm;
    if (finite(plate) && plate > 0 && finite(total) && total >= 0) {
      const count = total / plate;
      if (valid(Math.round(count)) && Math.abs(count - Math.round(count)) < 0.00001) return Math.round(count);
    }
    if (valid(inputs.floorsBelow)) return inputs.floorsBelow;
    return layout.levels?.length ? layout.levels.length : null;
  }
  function mount(host) {
    const doc = host.document, byId = id => doc.getElementById(id), cache = new Map();
    let model = null, layout = null, scheduled = false;
    const inputs = () => typeof state !== "undefined" ? state : {};
    const text = (id, value) => { const el = byId(id); if (el) el.textContent = value; };
    function makeUI() {
      if (byId("parkingQuantityReview")) return true;
      const panel = byId("realyticsStudyPanel"); if (!panel?.firstElementChild) return false;
      const section = doc.createElement("details"); section.id = "parkingQuantityReview"; section.className = "realytics-review-card realytics-disclosure parking-review";
      section.innerHTML = `<summary>실내 수량 · 주차구획 검토 <span id="parkingDraftHeadline">계산 중</span></summary><p class="realytics-note">실내 자동 생성의 수량, 법정 주차 수요, 지하 공간에 실제로 그린 구획 수를 구분해 비교합니다.</p><dl class="realytics-metric-grid" id="parkingQuantityMetrics"></dl><p class="realytics-note" id="parkingQuantityNotice"></p><dl class="realytics-metric-grid" id="parkingLayoutMetrics"></dl><div class="parking-plan-controls"><label>주차 배치 층 <select id="parkingDraftLevel" aria-label="주차 배치 지하층"></select></label><button type="button" id="parkingDraftDownload">주차 SVG 저장</button></div><div class="parking-plan-drawing" id="parkingDraftDrawing"></div><div class="parking-plan-legend"><span><i class="parking-key-space"></i>확장형 2.6×5.2</span><span><i class="parking-key-accessible"></i>장애인 예정</span><span><i class="parking-key-ev"></i>EV 예정</span><span><i class="parking-key-ramp"></i>램프</span><span><i class="parking-key-aisle"></i>6m 차로</span></div><ul class="parking-review-notes" id="parkingDraftWarnings"></ul><details class="realytics-disclosure"><summary>배치 가정 · 법령 근거</summary><ul class="parking-review-notes" id="parkingDraftAssumptions"></ul><p class="realytics-note">구획 치수·차로·램프: <a href="https://www.law.go.kr/법령/주차장법시행규칙" target="_blank" rel="noopener noreferrer">주차장법 시행규칙 제3·6·11조 ↗</a><br>시행 2026.07.27 · 검토 2026.10.21 · 인허가 적합 판정 아님</p></details>`;
      panel.append(section);
      byId("parkingDraftLevel").addEventListener("change", renderDrawing);
      byId("parkingDraftDownload").addEventListener("click", () => {
        const level = layout?.levels?.find(item => item.level === Number(byId("parkingDraftLevel").value)); if (!level) return;
        const url = URL.createObjectURL(new Blob([planSvg(level)], { type: "image/svg+xml;charset=utf-8" }));
        const a = doc.createElement("a"); a.href = url; a.download = `formequa-${inputs().parcelKey || "study"}-B${Math.abs(level.level)}-parking.svg`; a.click(); host.setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      return true;
    }
    function renderDrawing() {
      const level = layout?.levels?.find(item => item.level === Number(byId("parkingDraftLevel").value));
      byId("parkingDraftDrawing").innerHTML = level ? planSvg(level) : `<p class="realytics-note">현재 템플릿에서 구획 배치를 완료하지 못했습니다. 대지 전체의 주차 불가 판정은 아닙니다. 램프·코어·기계식 등 공간 대안을 검토해 주세요.</p>`;
      byId("parkingDraftDownload").disabled = !level;
    }
    function render() {
      scheduled = false; if (!makeUI()) return;
      model ||= inputs().lastComputed?.model; if (!model) return;
      const s = inputs(), p = model.parking || {}, q = summarize(model, s, host.AtelierInteriorPlan?.generate, cache);
      if (cache.size > 140) { const retained = [...cache.entries()].slice(-100); cache.clear(); retained.forEach(([k, v]) => cache.set(k, v)); }
      layout = p.layout || model.parkingLayout || host.AtelierParkingLayout?.fromModel(model, s);
      if (!layout) return;
      const kv = (label, value) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
      byId("parkingQuantityMetrics").innerHTML = [kv("실내 초안 세대", number(q.dwellingUnitCount) + "세대"), kv("주차 산정 세대", number(q.statutoryUnits) + "세대"), kv("초안 − 산정 세대", q.unitDifference === null ? "확인 전" : `${q.unitDifference > 0 ? "+" : ""}${number(q.unitDifference)}세대`), kv("코리빙 개인실", number(q.privateRoomCount) + "실"), kv("호텔 객실 / 침대", `${number(q.guestRoomCount)} / ${number(q.guestBedCount)}`), kv("업무 배치 좌석", number(q.workstationCount) + "석")].join("");
      text("parkingQuantityNotice", `지상 ${q.generatedFloors}/${q.floorCount}개 층의 완성 배치 수량을 합산했습니다. 코리빙 개인실·호텔 객실·업무 좌석은 주거 세대수가 아닙니다. 주차 산정 세대는 ${p.estimatedUnitCount ? "면적 기반 추정" : "사용자 입력"}을 사용하며, 생성 초안의 세대수로 자동 덮어쓰지 않습니다.${q.unitDifference ? " 차이가 있으므로 전용면적·세대 구성과 산정 세대를 함께 검토해야 합니다." : ""}`);
      const accessible = layout.reserved?.accessibleCount || 0, ev = layout.reserved?.evCount || 0;
      const below = basementFloorCount(model, s, layout), belowLabel = below === null ? "지하층 수 확인 전" : below === 0 ? "지하층 없음" : `지하 ${number(below)}개 층 검토`;
      const completed = layout.status !== "incomplete" && layout.validation?.valid && layout.capacityCount > 0 && !!layout.levels?.length;
      const statusLabel = completed ? layout.statusLabel || "배치 생성" : layout.statusLabel || "배치 미완료";
      const capacityUnverified = layout.capacityVerified !== true, deferred = !!model.constraints?.parkingFitDeferred;
      const deficit = finite(p.deficit) ? p.deficit : null;
      text("parkingDraftHeadline", completed ? `${number(layout.capacityCount)}면 초안 · ${belowLabel}` : `${statusLabel} · ${belowLabel}`);
      const metrics = [kv("주차 배치 상태", statusLabel), kv("계획 지하층", belowLabel),
        kv("생성 주차 구획", completed ? `${number(layout.capacityCount)}면 · 층당 ${number(layout.perFloorCount)}면` : `${number(layout.capacityCount)}면 생성 · 전체 배치 미완료`),
        kv("계산상 주차 수용량", `${number(p.capacityCount)}대${capacityUnverified ? " · 실제 수용 미확정" : ""}`),
        kv("법정 최소 / 계획", `${number(p.legalParkingCount)} / ${number(p.plannedParkingCount)}대`),
        kv("미확보 수량", deficit === null ? "확인 전" : deficit > 0 ? `${number(deficit)}대 · 계획 보완 필요` : `계산상 ${number(deficit)}대${capacityUnverified ? " · 실제 수용 확인 전" : ""}`),
        kv("장애인 예정 / 산정", `${number(accessible)} / ${number(p.disabledParkingCount)}면`),
        kv("EV 예정 / 산정", `${number(ev)} / ${number(p.evChargerFastSlow)}면`),
        kv("구획 기하 검사", completed ? "경계·충돌·차로 연결 통과 · 인허가 확인 전" : "구획 생성 미완료 · 주차 불가 판정 아님")];
      if (deferred) metrics.push(kv("매스 자동 조정", "주차 미확보 · 자동 축소 보류"));
      byId("parkingLayoutMetrics").innerHTML = metrics.join("");
      const old = Number(byId("parkingDraftLevel").value);
      byId("parkingDraftLevel").replaceChildren(...(layout.levels || []).map(level => { const option = doc.createElement("option"); option.value = level.level; option.textContent = `B${Math.abs(level.level)} · ${level.spaces.length}면`; return option; }));
      if (layout.levels?.some(level => level.level === old)) byId("parkingDraftLevel").value = old;
      byId("parkingDraftLevel").disabled = !layout.levels?.length;
      const notices = [...(layout.warnings || [])];
      if (capacityUnverified) notices.push("구획 수는 기획 초안입니다. 실제 수용량과 차량 회전·진입·단면·인허가 적합성은 확인 전입니다.");
      if (!completed) notices.push(`생성 구획 ${number(layout.capacityCount)}면은 현재 템플릿의 배치 미완료 결과이며, 실제 주차를 설치할 수 없다는 확정 결과가 아닙니다.`);
      if (deferred) notices.push(`주차 ${deficit === null ? "수요" : number(deficit) + "대"}가 미확보되어 자동 매스 축소를 보류했습니다. 표시된 매스의 주차 계획을 추가 검토해야 합니다.`);
      if (finite(p.disabledParkingCount) && accessible < p.disabledParkingCount) notices.push("예정 장애인 구획이 현재 법정 산정 면수보다 부족합니다.");
      if (finite(p.evChargerFastSlow) && ev < p.evChargerFastSlow) notices.push("예정 EV 구획이 현재 충전시설 산정 수량보다 부족합니다.");
      byId("parkingDraftWarnings").innerHTML = notices.map(note => `<li>${esc(note)}</li>`).join("");
      byId("parkingDraftAssumptions").innerHTML = (layout.assumptions || []).map(note => `<li>${esc(note)}</li>`).join("");
      renderDrawing();
    }
    const schedule = detail => { if (detail?.model) model = detail.model; if (!scheduled) { scheduled = true; host.requestAnimationFrame(render); } };
    host.addEventListener("atelier:updated", event => schedule(event.detail));
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", () => schedule()); else schedule();
  }
  return Object.freeze({ summarize, planSvg, mount });
});
