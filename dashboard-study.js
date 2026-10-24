/** FORMEQUA: the calculated program, floor drawings and review data in one place. */
(function (root, factory) {
  "use strict";
  const api = factory(typeof module === 'object' && module.exports ? require('./spatial-settings.js') : root.AtelierSpatialSettings);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AtelierDashboardStudy = api;
  if (root?.document) api.mount(root);
})(typeof window !== "undefined" ? window : null, function (spatial) {
  "use strict";
  const PROGRAMS = {
    office: { name: "오피스", en: "OFFICE", use: "업무시설(오피스)", floor: "main" },
    officetel: { name: "오피스텔", en: "OFFICETEL", use: "업무시설(오피스텔)", floor: "residential" },
    hotel: { name: "호텔", en: "HOTEL", use: "숙박시설(호텔)", floor: "hotel" },
    housing: { name: "공동주택", en: "HOUSING", use: "공동주택(주상복합)", floor: "residential" },
    living: { name: "리빙 · 코리빙", en: "CO-LIVING", use: "업무시설(오피스텔)", floor: "residential" },
    knowledge: { name: "지식산업센터", en: "WORKPLACE", use: "지식산업센터", floor: "main" },
    retail: { name: "근린생활시설", en: "RETAIL", use: "근린생활시설(리테일)", floor: "retail" },
    sales: { name: "판매시설", en: "COMMERCE", use: "판매시설", floor: "retail" }
  };
  // Match the API's editable input schema. Preserve out-of-range values so the
  // server can reject them; session-storage sanitation must not change a request.
  const API_INPUT_KEYS = ("option viewMode modelDetail facadeType claddingMaterial facadeAccent glassTint podiumStyle zoning buildingUse hotelType spaceProgram parkingMode regulationMode residentialType housingPermitType parkingDistrict coreType mixedUseProfile siteAreaSqm roadWidthM publicContribPct legalFarCapPct legalBcrCapPct maxHeightM housingUnitAreaSqm housingUnits setbackM setbackSideM setbackRearM floorsAbove floorsBelow targetBcr floorHeight facadeWwrPct facadeBayM facadeLouverM facadePanelDepthMm facadeJointMm facadeLouverAngleDeg clipPlanePct sunHour landPricePyeongM constCostPyeongMan rentPyeongMan capRatePct loanLtvPct loanRatePct lpSharePct lpHurdlePct gpPromotePct targetIrrPct daylightTheme showSurroundingBuildings seoulDowntown northSolar parcelMerged showDimensions floorUseOverrides financeMode hotelAdrKrw hotelOccupancyPct hotelRoomsOverride hotelAncillaryRevenuePct hotelOpexPct hotelFixedOpexEok hotelFfeReservePct hotelManagementFeePct hotelResidentialDistanceM hotelResidentialBarrier parcelData").split(" ");
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const number = (value, digits = 1) => finite(value) ? value.toLocaleString("ko-KR", { maximumFractionDigits: digits }) : "확인 필요";
  const amount = (value, suffix, digits = 1) => finite(value) ? `${number(value, digits)}${suffix}` : "확인 필요";
  function programKey(inputs) {
    if (inputs.spaceProgram === "coliving" && /공동주택|오피스텔/.test(inputs.buildingUse)) return "living";
    return Object.keys(PROGRAMS).find(key => key !== "living" && PROGRAMS[key].use === inputs.buildingUse) || "office";
  }
  function floorUse(floor, inputs) {
    if (floor.use === "basement") return "지하 주차·설비";
    if (floor.use === "residential") return inputs.spaceProgram === "coliving" ? "코리빙" : inputs.residentialType === "officetel" ? "오피스텔" : "공동주택";
    return { main: inputs.buildingUse === "지식산업센터" ? "지식산업센터" : "오피스", hotel: "호텔", retail: inputs.buildingUse === "판매시설" ? "판매시설" : "근린생활시설", amenity: "공용·편의" }[floor.use] || "용도 확인 필요";
  }
  function planOptions(inputs, model) {
    const detailLevel = model?.representation?.detailLevel || (["massing", "concept"].includes(inputs.modelDetail) ? inputs.modelDetail : null);
    return { ...spatial?.select(inputs), parcelKey: inputs.parcelKey, parcelData: inputs.parcelData, projectId: inputs.projectId, hotelAdrKrw: inputs.hotelAdrKrw,
      hotelOccupancyPct:inputs.hotelOccupancyPct,hotelRoomsOverride:inputs.hotelRoomsOverride,
      coreType: inputs.coreType, option: inputs.option, spaceProgram: inputs.spaceProgram,
      residentialType: inputs.residentialType, housingUnitAreaSqm: inputs.housingUnitAreaSqm,
      ...(detailLevel ? { detailLevel } : {}) };
  }
  function planSignature(floor, options) {
    const coreLayout = options.coreLayout !== undefined ? options.coreLayout : floor.coreLayout;
    return JSON.stringify([floor.level, floor.use, floor.widthM, floor.depthM, floor.northShiftM, floor.zBottom, floor.zTop, floor.hasAtrium, options,
      coreLayout !== undefined, coreLayout?.status, coreLayout?.cores]);
  }
  function analysisRequest(inputs, floorLevel) {
    const clean = Object.fromEntries([...API_INPUT_KEYS, ...(spatial?.keys || [])].filter(key => Object.prototype.hasOwnProperty.call(inputs, key)).map(key => [key, inputs[key]]));
    return { parcelKey: inputs.parcelKey, program: programKey(inputs), inputs: clean, ...(finite(floorLevel) ? { floorLevel } : {}) };
  }
  function sumMetrics(plans) {
    const names = ["roomCount", "netRoomAreaSqm", "workstationCount", "guestRoomCount", "guestBedCount", "dwellingUnitCount", "privateRoomCount", "sharedSpaceCount"];
    return Object.fromEntries(names.map(key => [key, plans.reduce((total, plan) => total + (finite(plan?.metrics?.[key]) ? plan.metrics[key] : 0), 0)]));
  }
  function planStatus(plan, floor) {
    if (plan?.reason === "massing-only" || floor?.coreLayout?.status === "not-requested")
      return { status: "not-generated", label: "상세 평면 미생성", usable: false };
    if (plan?.reason === "shared-core-unfeasible" || plan?.coreLayoutStatus === "unfeasible" || floor?.coreLayout?.status === "unfeasible" || plan?.status === "failed")
      return { status: "failed", label: "코어·평면 배치 미완료", usable: false };
    if (plan?.status === "not-generated") return { status: "empty", label: "실내 생성 조건 미충족", usable: false };
    if (!plan?.metrics || !Array.isArray(plan.rooms)) return { status: "missing", label: "생성 확인 필요", usable: false };
    if (!finite(plan.metrics.roomCount) || plan.metrics.roomCount !== plan.rooms.length)
      return { status: "inconsistent", label: "평면 수량 확인 필요", usable: false };
    if (!plan.rooms.length) return { status: "empty", label: "실 배치 미완료", usable: false };
    return { status: "generated", label: "개념 배치 생성", usable: true };
  }
  function planSummary(floors, plans) {
    const entries = floors.map(fp => ({ floor: fp, plan: plans instanceof Map ? plans.get(fp.level) : plans.find(p => p?.level === fp.level) }));
    const usable = entries.filter(row => planStatus(row.plan, row.floor).usable);
    const totals = sumMetrics(usable.map(row => row.plan));
    return { totalFloors: floors.length, generatedFloors: usable.length, incompleteFloors: floors.length - usable.length,
      complete: floors.length > 0 && usable.length === floors.length, totals,
      metricCoverage: Object.fromEntries(Object.keys(totals).map(key => [key, usable.filter(row => finite(row.plan.metrics[key])).length])),
      statuses: entries.map(row => ({ level: row.floor.level, ...planStatus(row.plan, row.floor) })) };
  }
  function financeRows(f = {}) {
    return [["총 사업비", amount(f.totalDevCostEok, "억원")], ["사업비 배분 자기자본", amount(f.equityRequiredEok, "억원")],
      ["최대 누적 자금부족 (Peak Equity)", amount(f.peakEquityEok, "억원")], ["계획 PF 대출", amount(f.loanAmountEok, "억원")],
      ["안정화 NOI", amount(f.stabilizedNoiEok, "억원/년")], ["예상 매각 총액", amount(f.grossExitValueEok, "억원")],
      ["자기자본 XIRR", finite(f.equityXirrPct) ? amount(f.equityXirrPct, "%") : "산출 불가·현금흐름 확인"],
      ["DSCR", amount(f.dscr, "x", 2)], ["자기자본 배수", amount(f.equityMultiple, "x", 2)]];
  }
  function floorRecords(model, inputs) {
    const above = model?.floorPlates || [], count = finite(inputs?.floorsBelow) ? Math.max(0, Math.floor(inputs.floorsBelow)) : 0;
    const b = model?.basementPlacement || {};
    return above.concat(Array.from({ length: count }, (_, i) => ({ level: -i - 1, use: "basement", widthM: b.widthM, depthM: b.depthM,
      areaSqm: model?.areas?.basementPlateSqm, zBottom: -(i + 1) * 3.5, zTop: -i * 3.5 })));
  }
  function selectedFloorLevel(records, current, inputs, preferredUse) {
    if (Number.isInteger(inputs?.selectedFloorLevel) && records.some(fp => fp.level === inputs.selectedFloorLevel)) return inputs.selectedFloorLevel;
    if (records.some(fp => fp.level === current)) return current;
    return records.find(fp => fp.use === preferredUse && fp.level >= 4)?.level || records.find(fp => fp.use === preferredUse)?.level || records[0]?.level || null;
  }
  function occupancyText(floor, plan) {
    const m = plan?.metrics;
    const status = planStatus(plan, floor);
    if (!status.usable) return status.label;
    if (floor.use === "main") return finite(m.workstationCount) ? `${number(m.workstationCount, 0)}석` : "좌석 수량 미검토";
    if (floor.use === "hotel") return finite(m.guestRoomCount) && finite(m.guestBedCount) ? `${number(m.guestRoomCount, 0)}객실 · ${number(m.guestBedCount, 0)}침대` : "객실·침대 수량 미검토";
    if (floor.use === "residential") return plan.spaceProgram === "coliving" ? finite(m.privateRoomCount) && finite(m.sharedSpaceCount) ? `${number(m.privateRoomCount, 0)}개인실 · 공용 ${number(m.sharedSpaceCount, 0)}` : "개인실·공용 수량 미검토" : finite(m.dwellingUnitCount) ? `${number(m.dwellingUnitCount, 0)}세대` : "세대 수량 미검토";
    return "—";
  }

  /** The same metre coordinates and generated objects used by the WebGL interior. */
  function planSvg(plan, title, layers = {}) {
    const b = plan?.bounds;
    if (!b || ![b.minX, b.maxX, b.minZ, b.maxZ].every(finite) || b.maxX <= b.minX || b.maxZ <= b.minZ) return "";
    const scale = 24, pad = 42, w = (b.maxX - b.minX) * scale + pad * 2, h = (b.maxZ - b.minZ) * scale + pad * 2 + 44;
    const x = v => +(pad + (v - b.minX) * scale).toFixed(3), y = v => +(pad + (v - b.minZ) * scale).toFixed(3);
    const rect = (r, fill, stroke = "#c9d5e3", extra = "") => `<rect x="${x(r.minX)}" y="${y(r.minZ)}" width="${Math.max(0, (r.maxX - r.minX) * scale)}" height="${Math.max(0, (r.maxZ - r.minZ) * scale)}" fill="${fill}" stroke="${stroke}" stroke-width=".8" ${extra}/>`;
    const roomFill = r => r.type?.startsWith("guest_") ? "#e8f5fa" : r.type === "dwelling_unit" || r.type === "private_room" ? "#edf2ff" : r.type?.startsWith("shared_") ? "#f8edda" : "#f4f7fb";
    const body = [rect(b, "#fff", "#183551"),
      ...(plan.corridors || []).map(r => rect(r, "#e2ecf5", "#e2ecf5")),
      ...(plan.rooms || []).map(r => rect(r, roomFill(r))),
      ...(plan.cores || []).map(r => rect(r, "#a7b7ca", "#758ca7")),
      ...(plan.obstacles || []).map(r => rect(r, '#6c7891', '#344e68')),
      ...(plan.voids || []).map(r => rect(r, "#fff", "#bacbd2", 'stroke-dasharray="5 4"'))];
    if (layers.furniture !== false) body.push(...(plan.furniture || []).map(f => {
      const r = { minX: f.x - f.width / 2, maxX: f.x + f.width / 2, minZ: f.z - f.depth / 2, maxZ: f.z + f.depth / 2 };
      return `<g><title>${esc(f.type)}</title>${rect(r, /bed|sofa/.test(f.type) ? "#b9cde2" : /toilet|vanity|shower/.test(f.type) ? "#cee8ed" : "#d9c29a", "#8096ac")}</g>`;
    }));
    body.push(...(plan.walls || []).map(wall => `<line x1="${x(wall.x1)}" y1="${y(wall.z1)}" x2="${x(wall.x2)}" y2="${y(wall.z2)}" stroke="#203b57" stroke-width="${Math.max(1.5, (wall.thickness || .12) * scale)}"/>`));
    body.push(...(plan.doors || []).map(door => {
      const room = plan.rooms.find(r => r.id === door.roomId);
      if (!room) return "";
      const inward = door.axis === "x" ? Math.sign((room.minZ + room.maxZ) / 2 - door.z) : Math.sign((room.minX + room.maxX) / 2 - door.x);
      const horizontal = door.axis === "x", len = door.width * scale, sx = x(door.x - (horizontal ? door.width / 2 : 0)), sy = y(door.z - (horizontal ? 0 : door.width / 2));
      return `<path d="M ${sx} ${sy} l ${horizontal ? 0 : inward * len} ${horizontal ? inward * len : 0}" fill="none" stroke="#9a702c" stroke-width="1.4"/><path d="M ${sx + (horizontal ? len : 0)} ${sy + (horizontal ? 0 : len)} Q ${sx + (horizontal ? len : inward * len)} ${sy + (horizontal ? inward * len : len)} ${sx + (horizontal ? 0 : inward * len)} ${sy + (horizontal ? inward * len : 0)}" fill="none" stroke="#9a702c" stroke-width=".8" stroke-dasharray="2 2"/>`;
    }));
    if (layers.labels !== false) {
      body.push(...(plan.rooms || []).map(r => {
        const available = (r.maxX - r.minX) * scale, fontsize = Math.min(12, Math.max(7.5, available / Math.max(7, r.label.length)));
        return `<text x="${x((r.minX + r.maxX) / 2)}" y="${y((r.minZ + r.maxZ) / 2) - 4}" text-anchor="middle" fill="#17324d" font-size="${fontsize}" font-weight="700" paint-order="stroke" stroke="#fff" stroke-width="2.8">${esc(r.label)}<tspan x="${x((r.minX + r.maxX) / 2)}" dy="${fontsize + 4}" font-weight="400">${number(r.areaSqm)} m²</tspan></text>`;
      }));
      body.push(...(plan.cores || []).map(r => `<text x="${x((r.minX + r.maxX) / 2)}" y="${y((r.minZ + r.maxZ) / 2)}" text-anchor="middle" fill="#17324d" font-size="12" font-weight="700">CORE</text>`));
      body.push(...(plan.voids || []).map(r => `<text x="${x((r.minX + r.maxX) / 2)}" y="${y((r.minZ + r.maxZ) / 2)}" text-anchor="middle" fill="#577585" font-size="12">중정</text>`));
    }
    for (const path of layers.paths || []) if (path.points?.length > 1) body.push(`<polyline points="${path.points.map(p => `${x(p.x)},${y(p.z)}`).join(' ')}" fill="none" stroke="#096ba8" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"><title>${esc(path.id)}</title></polyline>`);
    const northAngle = Number.isFinite(layers.northRotationRad) ? -layers.northRotationRad * 180 / Math.PI : 0;
    body.push(`<text x="${w - pad}" y="24" transform="rotate(${northAngle} ${w - pad - 12} 24)" text-anchor="end" fill="#17324d" font-size="12" font-weight="700">N ↑</text><text x="${pad}" y="${h - 26}" fill="#17324d" font-size="13" font-weight="700">${esc(title)}</text><text x="${pad}" y="${h - 8}" fill="#5d7186" font-size="10">FORMEQUA · ${esc(planStatus(plan).label)} · 단위 m · 인허가 도면 아님</text>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect width="100%" height="100%" fill="#fff"/><g font-family="Arial, Pretendard, sans-serif">${body.join("")}</g></svg>`;
  }

  function mount(host) {
    const doc = host.document, byId = id => doc.getElementById(id);
    const pilotMode = host.AtelierPilot?.enabled === true;
    const featureEnabled = feature => !pilotMode || host.AtelierPilot.allows(feature);
    const featureAttributes = feature => featureEnabled(feature) ? "" : ` data-pilot-feature="${feature}" hidden inert aria-hidden="true"`;
    let mounted = false, model = null, selectedLevel = null, parcelKey = null, cache = new Map(), plans = new Map(), currentPlan = null, response = null, scheduled = false;
    let apiSequence = 0, apiController = null, responseRequest = null;
    const layers = { labels: true, furniture: true };
    const inputs = () => typeof state !== "undefined" ? state : {};
    const text = (id, value) => { if (byId(id)) byId(id).textContent = value; };
    const kv = (label, value) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
    const announce = message => text("realyticsApiStatus", message);
    function safeRequest() {
      return analysisRequest(inputs(), selectedLevel > 0 ? selectedLevel : undefined);
    }
    function responseIsStale() { return responseRequest && responseRequest !== JSON.stringify([safeRequest(), selectedLevel]); }
    function syncLatestModel() {
      const latest = inputs().lastComputed?.model;
      if (!latest || latest === model) return false;
      model = latest;
      // Scene rebuilds happen before atelier:updated. Refresh the existing plan
      // cache now so a floor selection cannot reuse the preceding model's draft.
      render();
      return true;
    }
    function selectLevel(level) {
      if (!Number.isInteger(level)) return;
      syncLatestModel();
      if (!floorRecords(model, inputs()).some(fp => fp.level === level)) return;
      const changed = selectedLevel !== level;
      selectedLevel = level;
      inputs().selectedFloorLevel = level;
      renderFloor();
      if (!changed) return;
      if (typeof host.rebuild3DScene === "function") host.rebuild3DScene(model);
      if (typeof host.renderFloorInspectorCard === "function") host.renderFloorInspectorCard(model);
    }
    function download(contents, name, type) {
      const url = URL.createObjectURL(new Blob([contents], { type }));
      const link = doc.createElement("a"); link.href = url; link.download = name; link.click();
      host.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function changeProgram(key) {
      const select = byId("selectStudyProgram");
      if (!select || !PROGRAMS[key] || programKey(inputs()) === key) return;
      select.value = key; select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    function makeUI() {
      if (mounted || !byId("realyticsStudyPanel") || !byId("realyticsProgramBar")) return;
      mounted = true;
      const bar = byId("realyticsProgramBar"); bar.className = "realytics-program-bar"; bar.setAttribute("data-preserve-color", "");
      bar.innerHTML = `<div class="realytics-program-heading"><span>ASSET PROGRAM</span><strong id="realyticsCurrentProgram">용도 검토</strong></div><div class="realytics-program-options" role="group" aria-label="분석할 건축물의 주용도">${["office", "officetel", "hotel", "housing", "living"].map(key => `<button type="button" data-realytics-program="${key}" aria-pressed="false"><span>${PROGRAMS[key].name}</span><small>${PROGRAMS[key].en}</small></button>`).join("")}</div><label class="realytics-other-program">전체 용도<select id="realyticsAllPrograms" aria-label="전체 분석 용도">${Object.entries(PROGRAMS).map(([key, p]) => `<option value="${key}">${p.name}</option>`).join("")}</select></label>`;
      bar.querySelectorAll("[data-realytics-program]").forEach(button => button.addEventListener("click", () => changeProgram(button.dataset.realyticsProgram)));
      byId("realyticsAllPrograms").addEventListener("change", event => changeProgram(event.target.value));
      const panel = byId("realyticsStudyPanel"); panel.className = "realytics-study"; panel.setAttribute("data-preserve-color", "");
      panel.innerHTML = `
        <section class="realytics-review-card realytics-program-summary"><div class="realytics-card-heading"><div><span class="realytics-eyebrow">PROGRAM & FLOOR INTELLIGENCE</span><h2 id="realyticsStudyTitle">용도별 공간 분석</h2></div><span class="realytics-status" id="realyticsPermission"></span></div><p id="realyticsProgramBrief"></p><dl class="realytics-metric-grid" id="realyticsBuildingMetrics"></dl><p class="realytics-note" id="realyticsUseNote"></p></section>
        <section class="realytics-review-card" id="realyticsPlanCard"><div class="realytics-card-heading"><div><span class="realytics-eyebrow">LIVE FLOOR PLAN</span><h3>용도별 자동 생성 평면</h3></div><span class="realytics-live">현재 매스 연동</span></div>
          <div class="realytics-plan-controls"><label>분석 층<select id="realyticsFloorSelect" aria-label="평면을 볼 층"></select></label><div class="realytics-plan-actions"><button type="button" id="realyticsPlanLarge">크게 보기 ↗</button><button type="button" id="realyticsPlanDownload">SVG 저장</button><button type="button" id="realyticsPlan3d">3D 실내 보기</button><button type="button" id="realyticsGenerateConcept" hidden>상세 모형 보기</button></div></div>
          <div class="realytics-plan-toggles"><label><input type="checkbox" id="realyticsPlanLabels" checked> 실명·면적</label><label><input type="checkbox" id="realyticsPlanFurniture" checked> 가구·설비</label><span>벽 · 문 · 코어 · 중정 · 통로</span></div>
          <div class="realytics-plan-drawing" id="realyticsFloorDrawing"></div><div class="realytics-plan-legend"><span><i class="realytics-key-room"></i>실</span><span><i class="realytics-key-core"></i>코어</span><span><i class="realytics-key-circulation"></i>통로</span><span><i class="realytics-key-furniture"></i>가구</span></div>
          <dl class="realytics-metric-grid" id="realyticsFloorMetrics"></dl><p class="realytics-note" id="realyticsPlanDescription"></p>
          <details class="realytics-disclosure"><summary>선택 층의 실 구성 · 배치 가정</summary><div class="realytics-table-scroll"><table class="realytics-table"><thead><tr><th>실 구성</th><th>면적 ㎡</th><th>출입문</th></tr></thead><tbody id="realyticsRoomsBody"></tbody></table></div><ul class="realytics-note-list" id="realyticsPlanNotes"></ul></details>
        </section>
        <details class="realytics-review-card realytics-disclosure" open><summary>전체 층 구성 <span id="realyticsFloorCount"></span></summary><div class="realytics-table-scroll"><table class="realytics-table"><thead><tr><th>층</th><th>실제 용도</th><th>면적 ㎡</th><th>실</th><th>배치 지표</th></tr></thead><tbody id="realyticsFloorsBody"></tbody></table></div><p class="realytics-note">층을 선택하면 해당 평면을 표시합니다. 좌석·객실·세대는 자동 배치 결과이며 법정 정원·주차 산정 세대수와 구분합니다. 지하층 평면은 생성 범위에 포함되지 않습니다.</p></details>
        <details class="realytics-review-card realytics-disclosure"><summary>법규 · 주차 · 매스 제약</summary><dl class="realytics-metric-grid" id="realyticsLawMetrics"></dl><p id="realyticsPermissionSummary"></p><ul class="realytics-note-list" id="realyticsConstraintNotes"></ul><div id="realyticsLawSources" class="realytics-source-links"></div><p class="realytics-note">조례 일반기준과 필지별 고시 조건을 구분한 예비 검토입니다. 주차 대수는 현재 배치 템플릿의 결과이며 배치 미완료·차량 회전·도로 접속 및 인허가 적합성을 별도 확인합니다.</p><button type="button" class="realytics-text-link" data-realytics-analysis="tab-smap-law">법령 원문·입지 근거 검토 ↗</button></details>
        <details class="realytics-review-card realytics-disclosure"><summary>개략 사업성 · 입력 가정</summary><dl class="realytics-metric-grid" id="realyticsFinanceMetrics"></dl><p class="realytics-note" id="realyticsFinanceNote"></p><dl class="realytics-metric-grid" id="realyticsAssumptionMetrics"></dl><button type="button" class="realytics-text-link" data-realytics-analysis="tab-finance">사업비·수입 산정 보기 ↗</button></details>
        <details class="realytics-review-card realytics-disclosure"${featureAttributes("apiExplorer")}><summary>분석 API <span>v1 · JSON</span></summary><p>현재 설계 입력을 버전이 있는 API 요청으로 확인하고, 같은 계산 엔진의 결과와 평면 데이터를 받을 수 있습니다.</p><div class="realytics-api-actions"><button type="button" id="realyticsCapabilities">API 기능 확인</button><a href="/api/v1/openapi.json" target="_blank" rel="noopener">OpenAPI 문서 ↗</a><button type="button" id="realyticsRequestDownload">요청 JSON 저장</button><button type="button" id="realyticsRunAnalysis" class="realytics-primary-button">현재 조건 API 분석</button></div><p id="realyticsApiStatus" class="realytics-note" role="status">버튼을 누를 때만 서버에 요청합니다. API 결과는 현재 편집 중인 모형에 덮어쓰지 않습니다.</p><details class="realytics-disclosure"><summary>현재 요청 JSON</summary><pre id="realyticsRequestPreview" class="realytics-json"></pre></details><details class="realytics-disclosure" id="realyticsResponseDetails"><summary>API 응답 JSON</summary><pre id="realyticsResponsePreview" class="realytics-json">아직 요청하지 않았습니다.</pre><button type="button" id="realyticsResponseDownload" disabled>응답 JSON 저장</button></details></details>`;
      const dialog = doc.createElement("dialog"); dialog.id = "realyticsPlanDialog"; dialog.className = "realytics-plan-dialog"; dialog.setAttribute("data-preserve-color", "");
      dialog.innerHTML = `<div class="realytics-dialog-heading"><strong id="realyticsDialogTitle">층별 평면</strong><button type="button" id="realyticsPlanClose">닫기 ×</button></div><div id="realyticsDialogDrawing"></div><p>자동 배치 초안 · 방화·피난·채광·무장애·구조·설비는 별도 설계 검토가 필요합니다.</p>`;
      doc.body.append(dialog);
      byId("realyticsPlanClose").addEventListener("click", () => dialog.close());
      byId("realyticsPlanLarge").addEventListener("click", () => { if (currentPlan) dialog.showModal(); });
      byId("realyticsFloorSelect").addEventListener("change", event => selectLevel(Number(event.target.value)));
      byId("realyticsGenerateConcept").addEventListener("click", () => {
        const select = byId("selectModelDetail");
        if (select) { select.value = "concept"; select.dispatchEvent(new Event("change", { bubbles: true })); }
      });
      byId("realyticsPlanLabels").addEventListener("change", event => { layers.labels = event.target.checked; renderFloor(); });
      byId("realyticsPlanFurniture").addEventListener("change", event => { layers.furniture = event.target.checked; renderFloor(); });
      byId("realyticsPlanDownload").addEventListener("click", () => { const fp = model?.floorPlates.find(f => f.level === selectedLevel); if (currentPlan && fp) download(planSvg(currentPlan, `${selectedLevel}F · ${floorUse(fp, inputs())}`, layers), `formequa-${inputs().parcelKey}-${selectedLevel}F-plan.svg`, "image/svg+xml;charset=utf-8"); });
      byId("realyticsPlan3d").addEventListener("click", () => {
        if (!currentPlan) return;
        inputs().selectedFloorLevel = selectedLevel;
        const select = byId("interiorFloorSelect"); if (select) select.value = String(selectedLevel);
        byId("btnOpenInterior")?.click();
      });
      byId("interiorFloorSelect")?.addEventListener("change", event => { const level = Number(event.target.value); if (plans.has(level)) { selectedLevel = level; inputs().selectedFloorLevel = level; renderFloor(); } });
      panel.querySelectorAll("[data-realytics-analysis]").forEach(button => button.addEventListener("click", () => host.dispatchEvent(new CustomEvent("atelier:open-analysis", { detail: { tabId: button.dataset.realyticsAnalysis } }))));
      if (featureEnabled("apiExplorer")) {
        byId("realyticsCapabilities").addEventListener("click", () => runApi("/api/v1/capabilities", false));
        byId("realyticsRunAnalysis").addEventListener("click", () => runApi("/api/v1/analysis", true));
        byId("realyticsRequestDownload").addEventListener("click", () => download(JSON.stringify(safeRequest(), null, 2), "formequa-analysis-request.json", "application/json"));
        byId("realyticsResponseDownload").addEventListener("click", () => { if (response) download(JSON.stringify(response, null, 2), "formequa-analysis-response.json", "application/json"); });
      }
    }
    async function runApi(url, post) {
      if (!featureEnabled("apiExplorer")) return;
      const sequence = ++apiSequence;
      apiController?.abort();
      const controller = new AbortController(), timeout = host.setTimeout(() => controller.abort(), 25000);
      apiController = controller;
      const buttons = [byId("realyticsCapabilities"), byId("realyticsRunAnalysis")]; buttons.forEach(button => { button.disabled = true; });
      const request = post ? JSON.parse(JSON.stringify(safeRequest())) : null;
      const requestSignature = post ? JSON.stringify([request, selectedLevel]) : null;
      response = null; responseRequest = null; byId("realyticsResponseDownload").disabled = true;
      text("realyticsResponsePreview", "서버 응답을 기다리는 중입니다.");
      announce(post ? `${PROGRAMS[request.program].name} · ${request.floorLevel ? request.floorLevel + "층" : "전체 모형(지하 실내 평면 제외)"} 조건으로 분석 중…` : "API 기능을 확인하는 중…");
      try {
        const result = await host.fetch(url, { method: post ? "POST" : "GET", headers: { Accept: "application/json", ...(post ? { "Content-Type": "application/json" } : {}) }, ...(post ? { body: JSON.stringify(request) } : {}), signal: controller.signal });
        const type = result.headers.get("content-type") || "";
        if (!type.includes("application/json")) throw new Error(`HTTP ${result.status} · JSON API 응답이 아닙니다. 최신 API 서버가 실행 중인지 확인하세요.`);
        const json = await result.json();
        if (sequence !== apiSequence) return;
        if (!result.ok) throw new Error(`HTTP ${result.status} · ${typeof json.error === "string" ? json.error : json.error?.message || json.message || "요청을 처리하지 못했습니다."}`);
        response = json; responseRequest = requestSignature;
        if (post) host.AtelierStudyReviewSnapshot?.recordAuxiliary(model, { apiAnalysis: { request, response: json,
          recordedAt: new Date().toISOString(), matchesCurrentInputs: !responseIsStale(), isCurrentDashboardResult: false } });
        const output = JSON.stringify(json, null, 2), limit = 120000;
        text("realyticsResponsePreview", output.length > limit ? output.slice(0, limit) + "\n… 전체 응답은 JSON 저장으로 확인하세요." : output);
        byId("realyticsResponseDownload").disabled = false; byId("realyticsResponseDetails").open = true;
        announce(post ? responseIsStale() ? "이전 조건의 API 응답입니다. 요청 후 입력 또는 선택 층이 변경되어 현재 모형과 다릅니다. 현재 조건으로 다시 분석하세요." : `${PROGRAMS[request.program].name} 분석 완료 · 요청 시점 ${request.floorLevel ? request.floorLevel + "층" : "전체 모형"} · 현재 모형은 유지됩니다.` : "API 기능 조회 완료 · 지원 입력과 계산 범위를 응답에서 확인할 수 있습니다.");
      } catch (error) {
        if (sequence !== apiSequence) return;
        const message = error.name === "AbortError" ? "API 응답 대기 시간이 초과되었습니다. 서버 상태를 확인한 뒤 다시 요청하세요." : `API 요청 실패: ${error.message}`;
        announce(message); text("realyticsResponsePreview", message); byId("realyticsResponseDetails").open = true;
      }
      finally { host.clearTimeout(timeout); if (sequence === apiSequence) { apiController = null; buttons.forEach(button => { button.disabled = false; }); } }
    }
    function renderFloor() {
      if (!mounted || !model) return;
      layers.northRotationRad = model.parcelGeometry?.frameRotationRad || 0;
      const fp = floorRecords(model, inputs()).find(f => f.level === selectedLevel), plan = plans.get(selectedLevel);
      const status = fp?.use === "basement" ? { status: "not-generated", label: "지하 실내 평면 미생성", usable: false } : planStatus(plan, fp);
      currentPlan = status.usable ? plan : null;
      ["realyticsPlanLarge", "realyticsPlanDownload"].forEach(id => { byId(id).disabled = !currentPlan; });
      byId("realyticsPlan3d").disabled = !currentPlan || !byId("btnOpenInterior") || byId("btnOpenInterior").disabled;
      byId("realyticsGenerateConcept").hidden = fp?.level < 1 || status.status !== "not-generated";
      byId("realyticsGenerateConcept").disabled = !byId("selectModelDetail");
      byId("realyticsFloorSelect").value = fp ? String(fp.level) : "";
      const floorName = fp?.level < 0 ? `B${-fp.level}` : `${fp?.level}F`;
      const title = fp ? `${floorName} · ${floorUse(fp, inputs())}` : "생성된 지상층이 없습니다";
      const svg = currentPlan ? planSvg(plan, title, layers) : "";
      const message = !fp ? "현재 매스에 표시할 층이 없습니다." : fp.level < 0 ? "지하 주차 배치도는 주차 검토에서 확인하세요. 실·벽·문·설비를 포함한 지하 실내 평면은 생성하지 않았습니다."
        : status.status === "not-generated" ? "현재는 매스 검토 모형입니다. 상세 평면을 확인하려면 ‘상세 모형 보기’를 선택하세요. 계산용 면적·코어 예약·사업성은 유지됩니다." : `${status.label}. 외곽 면적과 배치 수량을 구분해 확인하세요.`;
      byId("realyticsFloorDrawing").innerHTML = svg || `<p class="realytics-empty">${esc(message)}</p>`;
      text("realyticsPlanDescription", fp?.level < 0 ? "지하 실내 평면은 생성 범위에 포함되지 않습니다. 주차 배치 초안은 주차 검토에서 확인하세요."
        : status.status === "not-generated" ? "간략 매스 표시 중입니다. 개념 상세를 선택하면 층별 평면을 생성합니다. 사업성의 면적 가정은 유지됩니다."
        : status.usable ? "현재 3D 실내와 같은 층 치수·코어·배치 엔진으로 생성합니다. 실내 실면적 합계는 사업성의 전용면적 가정과 별도입니다."
        : "평면 배치가 완료되지 않아 상세 실내와 배치 수량을 표시하지 않습니다. 아래 배치 가정에서 확인할 조건을 살펴보세요.");
      byId("realyticsDialogDrawing").innerHTML = svg; text("realyticsDialogTitle", title);
      const m = plan?.metrics;
      const rows = fp ? [kv("선택 층", title), kv("평면 상태", status.label), kv("산정 바닥면적", amount(fp.areaSqm, "㎡")),
        kv("폭 / 깊이", `${number(fp.widthM)} / ${number(fp.depthM)}m`), kv("표고 / 층고", `${number(fp.zBottom)} / ${number(fp.zTop - fp.zBottom)}m`)] : [];
      if (fp?.level > 0) {
        rows.push(kv("전용면적 가정(사업성)", amount(fp.netFloorSqm, "㎡")));
        if (status.usable) rows.push(kv("실 배치 면적 합계", amount(m.netRoomAreaSqm, "㎡")), kv("실 / 문", `${number(m.roomCount, 0)} / ${number(m.doorCount, 0)}`),
          kv("배치 지표", occupancyText(fp, plan)), kv("복도 / 코어 예약", `${number(m.corridorAreaSqm)} / ${number(m.coreAreaSqm)}㎡`), kv("가구·설비", amount(m.furnitureCount, "개", 0)));
        else rows.push(kv("실·가구·배치 수량", status.label));
        const ledger = model.finance?.income?.floorIncome?.find(row => row.level === fp.level);
        if (ledger) rows.push(kv("수입 산정 계약면적", amount(ledger.rentalContractAreaSqm, "㎡")), kv("층별 연간 수입 / NOI", `${number(ledger.annualGrossIncomeEok, 2)} / ${number(ledger.annualNoiEok, 2)}억원/년`));
      } else if (fp) {
        const parking = model.parking?.layout, level = parking?.levels?.find(row => row.level === fp.level);
        rows.push(kv("주차 배치 상태", parking?.statusLabel || (parking?.status === "generated" ? "주차 초안 생성" : "배치 미완료")),
          kv("선택 지하층 구획", level?.validation?.valid && Array.isArray(level.spaces) ? amount(level.spaces.length, "대", 0) : "배치 미완료·확정 0대 아님"));
      }
      byId("realyticsFloorMetrics").innerHTML = rows.join("");
      byId("realyticsRoomsBody").innerHTML = status.usable ? plan.rooms.map(room => `<tr><td>${esc(room.label)}</td><td>${number(room.areaSqm)}</td><td>${(plan.doors || []).filter(door => door.roomId === room.id).length}개</td></tr>`).join("") : `<tr><td colspan="3">${esc(status.label)}</td></tr>`;
      byId("realyticsPlanNotes").innerHTML = [message, ...(plan?.warnings || []), ...(plan?.assumptions || [])].filter(Boolean).map(note => `<li>${esc(note)}</li>`).join("");
      byId("realyticsFloorsBody").querySelectorAll("tr[data-floor-level]").forEach(row => row.classList.toggle("is-selected", Number(row.dataset.floorLevel) === selectedLevel));
      text("realyticsRequestPreview", JSON.stringify(safeRequest(), null, 2));
      if (typeof host.CustomEvent === 'function') host.dispatchEvent(new host.CustomEvent('atelier:plan-selected', {detail:{plan:currentPlan,plans:[...plans].map(([level,plan])=>({level,plan})),floor:fp,model,inputs:inputs()}}));
      if (responseIsStale()) announce("이전 조건의 API 응답입니다. 현재 입력·선택 층과 다르므로 현재 조건으로 다시 분석하세요.");
    }
    function render() {
      scheduled = false; makeUI(); if (!mounted) return;
      model ||= inputs().lastComputed?.model;
      if (!model?.floorPlates) return;
      const s = inputs(), key = programKey(s), program = PROGRAMS[key], floors = model.floorPlates, records = floorRecords(model, s);
      plans = new Map();
      for (const fp of floors) {
        const options = planOptions(s, model), signature = planSignature(fp, options);
        let plan = cache.get(signature);
        if (!plan && host.AtelierInteriorPlan?.generate) {
          try { plan = host.AtelierInteriorPlan.generate(fp, options); cache.set(signature, plan); }
          catch (error) { plan = { status: "failed", rooms: [], metrics: null, warnings: ["평면 생성 확인 필요: " + error.message] }; }
        }
        if (plan) plans.set(fp.level, plan);
      }
      // Bound retained drafts as sliders create new geometry; active drafts stay referenced.
      if (cache.size > 140) cache = new Map([...cache.entries()].slice(-105));
      const removedSelection = Number.isInteger(s.selectedFloorLevel) && !records.some(fp => fp.level === s.selectedFloorLevel);
      selectedLevel = selectedFloorLevel(records, parcelKey !== s.parcelKey ? null : selectedLevel, s, program.floor);
      if (removedSelection) s.selectedFloorLevel = selectedLevel;
      parcelKey = s.parcelKey;
      text("realyticsCurrentProgram", program.name);
      doc.querySelectorAll("[data-realytics-program]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.realyticsProgram === key)));
      byId("realyticsAllPrograms").value = key;
      text("realyticsStudyTitle", `${program.name} · 공간과 사업성`);
      const permission = model.usePermission || {};
      text("realyticsPermission", permission.label || "용도 허용 미확인"); byId("realyticsPermission").dataset.status = permission.status || "unverified";
      const summary = { office: "업무 공간·회의실·탕비실과 실제 배치 좌석을 함께 검토합니다.", hotel: "객실·욕실·운영 지원실과 객실·침대 수를 층별로 검토합니다.", officetel: "독립 출입·취침·거실·주방·욕실을 갖춘 원룸형 오피스텔 초안을 검토합니다.", housing: "독립 출입 주거 모듈의 세대·실 구성과 주차 산정을 구분해 검토합니다.", living: "개인실과 공용 거실·주방·세탁실을 구분해 코리빙 공간을 검토합니다.", knowledge: "업무형 배치 좌석을 확인합니다. 제조 설비·작업 공정은 별도 설계 대상입니다.", retail: "쇼룸·상담·수납 공간을 포함한 근린생활시설 초안을 검토합니다.", sales: "판매·상담·지원 공간의 구성과 용도지역별 허용 조건을 검토합니다." };
      text("realyticsProgramBrief", summary[key]);
      const summaryState = planSummary(floors, plans), totals = summaryState.totals, a = model.areas || {}, p = model.parking || {}, f = model.finance || {}, z = model.zoningRule || {};
      const partial = summaryState.complete ? "" : " · 일부층만 생성";
      const quantityFields = key === "hotel" ? ["guestRoomCount", "guestBedCount"] : ["housing", "officetel"].includes(key) ? ["dwellingUnitCount"] : key === "living" ? ["privateRoomCount", "sharedSpaceCount"] : ["workstationCount"];
      const quantitiesKnown = quantityFields.every(field => summaryState.metricCoverage[field] === summaryState.generatedFloors);
      const occupancy = !summaryState.generatedFloors ? kv("실내 배치 수량", model.representation?.detailLevel === "massing" ? "상세 평면 미생성" : "배치 미완료·수량 미확인")
        : !quantitiesKnown ? kv("실내 배치 수량", "일부 수량 자료 미검토")
        : key === "hotel" ? kv("배치 객실 / 침대" + partial, `${number(totals.guestRoomCount, 0)} / ${number(totals.guestBedCount, 0)}`)
        : ["housing", "officetel"].includes(key) ? kv("배치 초안 세대" + partial, amount(totals.dwellingUnitCount, "세대", 0))
        : key === "living" ? kv("개인실 / 공용 공간" + partial, `${number(totals.privateRoomCount, 0)} / ${number(totals.sharedSpaceCount, 0)}`)
        : kv("배치 업무 좌석" + partial, amount(totals.workstationCount, "석", 0));
      byId("realyticsBuildingMetrics").innerHTML = [kv("법적 주용도 입력", s.buildingUse), kv("지상 실제 / 요청", `${number(model.actualFloorsAbove, 0)} / ${number(model.requestedFloorsAbove, 0)}층`),
        kv("지상 연면적", amount(a.aboveGroundGfaSqm, "㎡")), kv("실내 생성 / 지상층", `${summaryState.generatedFloors} / ${summaryState.totalFloors}층`), occupancy].join("");
      const detailNote = model.representation?.detailLevel === "massing"
        ? `간략 표현으로 상세 평면 생략 ${summaryState.incompleteFloors}개 층. 개념 상세를 선택하면 평면을 생성합니다.`
        : `미생성·배치 미완료 층을 0실 또는 0세대의 완료 결과로 합산하지 않습니다.${summaryState.incompleteFloors ? ` 상세 미완료 ${summaryState.incompleteFloors}개 층.` : ""}`;
      text("realyticsUseNote", `주용도 선택과 각 층의 실제 배치는 구분됩니다. ${detailNote}${permission.status === "prohibited" ? " 현재 용도는 일반 규정상 허용 불가로 판정되어 모형·수익 지표는 가정 비교용입니다." : ""}`);
      byId("realyticsFloorSelect").replaceChildren(...records.map(fp => { const option = doc.createElement("option"); option.value = fp.level; option.textContent = `${fp.level < 0 ? "B" + -fp.level : fp.level + "F"} · ${floorUse(fp, s)} · ${number(fp.areaSqm)}㎡`; return option; }));
      byId("realyticsFloorSelect").disabled = !records.length;
      text("realyticsFloorCount", `지상 ${floors.length}개 · 지하 ${records.length - floors.length}개 층`);
      byId("realyticsFloorsBody").innerHTML = [...records].sort((a, b) => b.level - a.level).map(fp => {
        const plan = plans.get(fp.level), state = planStatus(plan, fp), basement = fp.level < 0;
        return `<tr data-floor-level="${fp.level}"><td><button type="button" data-select-floor="${fp.level}" aria-label="${fp.level}층 정보 보기">${basement ? "B" + -fp.level : fp.level + "F"}</button></td><td>${esc(floorUse(fp, s))}</td><td>${number(fp.areaSqm)}</td><td>${state.usable ? number(plan.metrics.roomCount, 0) : basement ? "생성 범위 외" : state.status === "not-generated" ? "간략 표현 · 생략" : "배치 미완료"}</td><td>${esc(basement ? "지하 실내 미생성" : occupancyText(fp, plan))}</td></tr>`;
      }).join("") || `<tr><td colspan="5">생성된 층 없음</td></tr>`;
      byId("realyticsFloorsBody").querySelectorAll("[data-select-floor]").forEach(button => button.addEventListener("click", () => { selectLevel(Number(button.dataset.selectFloor)); byId("realyticsFloorSelect").focus({ preventScroll: true }); byId("realyticsFloorDrawing").scrollIntoView({ behavior: "instant", block: "center" }); }));
      const extra = finite(p.plannedParkingCount) && finite(p.legalParkingCount) ? p.plannedParkingCount - p.legalParkingCount : null;
      const review = model.buildingReview || {}, structural = review.structuralReview || model.structuralReview || {},
        egress = review.egress || model.egress || {}, parkingIncomplete = p.layout?.massFitEligible === false || p.layout?.status === "incomplete";
      const structuralStatus = { "confirmed-trigger": "해당 검토 대상 조건 감지", conditional: "적용 조건 확인", unverified: "미검토", "no-listed-trigger": "검사 조건 미해당·면제 아님" }[structural.status] || "미검토";
      const triggerStatus = part => ({ "confirmed-trigger": "해당 조건 감지·상세 설계 필요", conditional: "추가 조건 확인", unverified: "미검토", "no-listed-trigger": "검사 조건 미해당·면제 아님" }[part?.status] || "미검토");
      byId("realyticsLawMetrics").innerHTML = [kv("입력 / 적용 용도지역", `${s.zoning} / ${model.effectiveRegulationInputs?.zoning || s.zoning}`),
        kv("법규 적용", model.regulationMode === "scenario" ? "수동 비교 조건" : "조례 일반기준·확인된 개별 계획"),
        kv("건폐율 / 적용 기준", `${number(a.achievedBcrPct)} / ${number(z.maxBcr)}%`), kv("용적률 / 적용 기준", `${number(a.achievedFarPct)} / ${number(z.maxFar)}%`),
        kv("모형 높이", amount(model.buildingHeightM, "m")), kv("개별 높이 상한", finite(model.constraints?.maxHeightM) && model.constraints.maxHeightM > 0 ? amount(model.constraints.maxHeightM, "m") : "미확인·무제한 확정 아님"),
        kv("주차 최소 / 배치 초안", `${number(p.legalParkingCount, 0)} / ${parkingIncomplete ? "미완료" : amount(p.plannedParkingCount, "대", 0)}`),
        kv("주차 배치 상태", p.layout?.statusLabel || (parkingIncomplete ? "배치 미완료·수용 가능 대수 미확정" : "배치 검토 상태 확인")),
        kv("최소 대비 주차 여유", extra === null ? "확인 필요" : parkingIncomplete ? `${number(p.deficit, 0)}대 부족 표시·배치 대안 검토` : extra >= 0 ? `${number(extra, 0)}대` : `${number(-extra, 0)}대 부족`),
        kv("설치 최고 대수", finite(p.legalMaxParkingCount) ? `${number(p.legalMaxParkingCount, 0)}대` : "적용값 없음·조건 확인"), kv("주차 산정 세대", amount(p.housingUnits, "세대", 0)),
        kv("규모별 표시 수준", model.representation?.detailLevel === "massing" ? "간략 매스·상세 미생성" : "개념 상세·구조 해석 미완료"),
        ...(featureEnabled("structuralDiagnostics") ? [kv("구조안전 검토 대상", structural.label || structuralStatus), kv("구조 설계 검증", structural.structuralDesignVerified === true ? "검증 자료 확인 필요" : "미검증·해석 미완료"),
        kv("직통계단 2개소 조건", triggerStatus(egress.directStairs)), kv("피난계단 조건", triggerStatus(egress.protectedStairs)), kv("특별피난계단 조건", triggerStatus(egress.specialStairs)),
        kv("계단 유형 판단", egress.stairType || "추가 확인 필요"),
        kv("계단 수(검토값)", finite(egress.stairCount) ? amount(egress.stairCount, "개소", 0) : "조건 미확인"),
        kv("최대 보행거리", finite(egress.maxTravelDistM) ? amount(egress.maxTravelDistM, "m") : "동선·구조 조건 미검토")] : []),
        kv("규모별 법규 검토 기준일", review.checkedAt || "기준일 확인 필요")].join("");
      text("realyticsPermissionSummary", permission.summary || "용도별 허용 여부 확인 필요");
      const notices = [...(model.constraints?.warnings || []), ...(p.warnings || []), ...(featureEnabled("structuralDiagnostics") ? [...(structural.warnings || []), ...(structural.documentSubmission?.conditions || []),
        ...(egress.warnings || []), ...(review.circulationDemand?.warnings || [])] : []), ...(model.representation?.reason ? [model.representation.reason] : []),
        ...(permission.entries || []).filter(entry => entry.status !== "allowed").map(entry => `${entry.label}: ${entry.summary}`)];
      const floorAreaSum = floors.reduce((sum, fp) => sum + (finite(fp.areaSqm) ? fp.areaSqm : 0), 0);
      if (finite(a.aboveGroundGfaSqm) && Math.abs(floorAreaSum - a.aboveGroundGfaSqm) > 0.01) notices.push(`면적 대사 확인: 층별 합계 ${number(floorAreaSum)}㎡ / 지상 연면적 ${number(a.aboveGroundGfaSqm)}㎡`);
      if (model.constraints?.stopReason) notices.unshift(`매스 생성 제한: ${model.constraints.stopReason}`);
      byId("realyticsConstraintNotes").innerHTML = [...new Set(notices)].map(note => `<li>${esc(note)}</li>`).join("");
      const sourceBox = byId("realyticsLawSources"); sourceBox.replaceChildren();
      const seenSources = new Set();
      for (const source of [...(permission.sources || []), ...(review.sources || [])]) { try { const url = new URL(source.url); if (!["https:", "http:"].includes(url.protocol) || seenSources.has(url.href)) continue; seenSources.add(url.href); const link = doc.createElement("a"); link.href = url.href; link.textContent = `${source.title} ↗`; link.target = "_blank"; link.rel = "noopener noreferrer"; sourceBox.append(link); } catch (_) {} }
      byId("realyticsFinanceMetrics").innerHTML = financeRows(f).map(row => kv(...row)).join("");
      const hasHotel = floors.some(fp => fp.use === "hotel");
      const hotel = f.income?.hotel;
      const hotelCountNote = hasHotel && f.financeMode === "hotel" ? ` 사업성 객실 ${number(hotel?.effectiveGuestRooms, 0)}실${hotel?.roomsSource === "user-assumption" ? "·사용자 운영 수량 가정" : "·계산용 개념배치 가정"}. ${model.coreLayout?.status === "unfeasible" ? "공통 코어 배치 미완료로 자동 객실 수를 확보하지 못했습니다." : `계산용 배치 ${number(hotel?.generatedGuestRooms, 0)}실은 표시 수준에 따라 상세 평면을 생략해도 유지됩니다.`}` : "";
      const capitalNote = " 사업비 배분 자기자본과 월별 현금흐름의 최대 누적 자금부족(Peak Equity)은 다른 지표입니다.";
      text("realyticsFinanceNote", (hasHotel ? f.financeMode === "hotel" ? "호텔 객실·부대매출에서 운영비·고정비·수수료·FF&E를 차감하고 비호텔 임대 NOI와 합산합니다." : "현재는 임대 시나리오입니다. 호텔 운영 모드를 선택하면 ADR·객실 가동률·운영비를 반영합니다." : "면적당 임대료·공실·운영비 가정에 따른 초기 임대 사업성입니다. 배치 좌석·세대수로 매출을 직접 산정하지 않습니다.") + hotelCountNote + capitalNote + " " + (f.income?.warnings || []).join(" "));
      byId("realyticsAssumptionMetrics").innerHTML = [kv("토지가 입력", amount(s.landPricePyeongM, "백만원/평")), kv("공사비 입력", amount(s.constCostPyeongMan, "만원/평", 0)), kv("임대료 입력", amount(s.rentPyeongMan, "만원/평·월")), kv("매각 Cap rate", amount(s.capRatePct, "%")), kv("사업비 대출비율(LTC) / 기본금리", `${number(s.loanLtvPct)} / ${number(s.loanRatePct)}%`),
        kv("대출 가중금리(계산)", amount(f.weightedLoanRatePct, "%")), kv("주차 대응", model.constraints?.parkingFitDeferred ? "배치 미완료·매스 축소 보류" : s.parkingMode === "report" ? "부족 현황 보고" : "배치 대수에 맞춘 매스 검토")].join("");
      renderFloor();
      if (removedSelection) {
        if (typeof host.rebuild3DScene === "function") host.rebuild3DScene(model);
        if (typeof host.renderFloorInspectorCard === "function") host.renderFloorInspectorCard(model);
      }
    }
    function schedule(detail) { if (detail?.model) model = detail.model; if (!scheduled) { scheduled = true; host.requestAnimationFrame(render); } }
    host.addEventListener("atelier:updated", event => schedule(event.detail));
    host.addEventListener("atelier:select-floor", event => selectLevel(event.detail?.level));
    host.addEventListener("atelier:interior-change", event => {
      if (event.detail?.active === true) selectLevel(event.detail.level);
    });
    host.addEventListener("atelier:scene-rebuilt", () => {
      if (!mounted) return;
      if (syncLatestModel()) return;
      const level = inputs().selectedFloorLevel;
      if (Number.isInteger(level) && floorRecords(model, inputs()).some(fp => fp.level === level)) { selectedLevel = level; renderFloor(); }
      byId("realyticsPlan3d").disabled = !currentPlan || !byId("btnOpenInterior") || byId("btnOpenInterior").disabled;
    });
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", () => schedule()); else schedule();
  }
  return Object.freeze({ programKey, floorUse, planOptions, planSignature, analysisRequest, sumMetrics, planStatus, planSummary, financeRows,
    floorRecords, selectedFloorLevel, occupancyText, planSvg, mount });
});
