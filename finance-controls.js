/** Income inputs and audit trail. Uses the same state and engine as the API. */
(() => {
  "use strict";
  const byId = id => document.getElementById(id);
  const fields = [
    ["hotelAdrKrw", "객실 단가 ADR (원/실·박, VAT 제외)", 0, 5000000, 10000],
    ["hotelOccupancyPct", "안정화 객실 가동률 (%)", 0, 100, 1],
    ["hotelRoomsOverride", "운영 객실 수 (0 = 자동 배치)", 0, 5000, 1],
    ["hotelAncillaryRevenuePct", "객실 매출 대비 부대매출 (%)", 0, 200, 1],
    ["hotelOpexPct", "변동 운영비 / 총매출 (%)", 0, 100, 1],
    ["hotelFixedOpexEok", "별도 고정 운영비 (억원/년)", 0, 1000, 0.1],
    ["hotelManagementFeePct", "별도 위탁 수수료 / 총매출 (%)", 0, 30, 0.1],
    ["hotelFfeReservePct", "별도 FF&E 적립 / 총매출 (%)", 0, 30, 0.1]
  ];
  function add(parent, tag, content, className) {
    const el = document.createElement(tag); if (content !== undefined) el.textContent = content;
    if (className) el.className = className; parent.append(el); return el;
  }
  function makeSelect(parent, id, label, options) {
    const field = add(parent, "label", label, "finance-input"); field.htmlFor = id;
    const select = add(field, "select"); select.id = id;
    for (const [value, text] of options) { const option = add(select, "option", text); option.value = value; }
    return select;
  }
  function update(key, value) { state[key] = value; updateAllCalculationsAndUI(); }
  function install() {
    const chapter = document.querySelector("#chap-finance .chapter-body");
    if (!chapter || byId("financeModeInput")) return;
    const controls = document.createElement("section"); controls.className = "finance-income-controls";
    controls.setAttribute("aria-label", "임대 또는 호텔 운영 수입 가정"); chapter.prepend(controls);
    add(controls, "h3", "수입 모델");
    makeSelect(controls, "financeModeInput", "사업성 수입 기준", [["rental", "임대 수입 · 기존 시나리오"], ["hotel", "호텔 운영 + 비호텔 임대"]])
      .addEventListener("change", event => update("financeMode", event.target.value));
    const hotel = add(controls, "div", undefined, "finance-hotel-inputs"); hotel.id = "hotelIncomeInputs";
    for (const [key, label, min, max, step] of fields) {
      const wrap = add(hotel, "label", label, "finance-input"); wrap.htmlFor = "income-" + key;
      const input = add(wrap, "input"); input.id = "income-" + key; input.type = "number";
      input.min = min; input.max = max; input.step = step; input.required = true;
      input.addEventListener("change", () => {
        const value = input.valueAsNumber;
        const valid = Number.isFinite(value) && value >= min && value <= max && (key !== "hotelRoomsOverride" || Number.isInteger(value));
        input.setCustomValidity(valid ? "" : `${min} ~ ${max} 범위의 ${key === "hotelRoomsOverride" ? "정수" : "숫자"}를 입력하세요.`);
        if (!valid) { input.reportValidity(); return; }
        update(key, value);
      });
    }
    add(hotel, "p", "기본값은 시장 조사값이 아닌 비교용 가정입니다. 운영비율에 위탁 수수료·FF&E·고정 운영비를 포함하지 말고 각 항목에 나누어 입력하세요.", "finance-assumption");
    const summary = add(controls, "div"); summary.id = "financeIncomeSummary"; summary.setAttribute("role", "status");

    const program = document.querySelector(".program-study");
    if (program) {
      const legal = add(program, "details", undefined, "finance-hotel-law"); legal.id = "hotelLocationInputs";
      add(legal, "summary", "호텔 입지 검토 · 이격·차단 입력");
      const grid = add(legal, "div", undefined, "finance-hotel-law-grid");
      const label = add(grid, "label", "주거지역 경계 이격거리 (m)", "finance-input"); label.htmlFor = "hotelResidentialDistanceInput";
      const input = add(label, "input"); input.id = "hotelResidentialDistanceInput"; input.type = "number";
      input.min = 0; input.max = 10000; input.step = 0.1; input.placeholder = "미확인 · 빈칸";
      input.addEventListener("change", () => {
        if (!input.value.trim()) { input.setCustomValidity(""); update("hotelResidentialDistanceM", null); return; }
        if (!Number.isFinite(input.valueAsNumber) || input.valueAsNumber < 0 || input.valueAsNumber > 10000) {
          input.setCustomValidity("0 ~ 10000m를 입력하거나 미확인이면 비워 두세요."); input.reportValidity(); return;
        }
        input.setCustomValidity(""); update("hotelResidentialDistanceM", input.valueAsNumber);
      });
      makeSelect(grid, "hotelResidentialBarrierInput", "차단 예외 적용 여부 (사용자 확인)", [["", "미확인"], ["yes", "적용 근거 확인 가정"], ["no", "예외 미적용"]])
        .addEventListener("change", event => update("hotelResidentialBarrier", event.target.value === "" ? null : event.target.value === "yes"));
      add(legal, "p", "입력은 검토 가정입니다. 이격거리는 실제 주거지역 경계에서 측정해야 하며, 차단 예외·교육환경·사업계획 승인 여부를 자동 확인하지 않습니다. 숫자 입력만으로 허용 판정하지 않습니다.", "finance-assumption");
    }
    const panel = byId("tab-finance");
    if (panel) {
      const audit = document.createElement("details"); audit.id = "financeIncomeAudit"; audit.className = "finance-income-audit"; audit.open = !window.AtelierPilot?.enabled;
      add(audit, "summary", "수입·NOI 산정 근거 / 층별 대사");
      const body = add(audit, "div"); body.id = "financeIncomeAuditBody"; panel.prepend(audit);
    }
    render();
  }
  function money(value) { return Number(value || 0).toLocaleString("ko-KR", { maximumFractionDigits: 2 }) + "억"; }
  function render() {
    const income = state.lastComputed?.model?.finance?.income;
    if (!byId("financeModeInput")) return;
    byId("financeModeInput").value = state.financeMode || "rental";
    byId("hotelIncomeInputs").hidden = state.financeMode !== "hotel";
    for (const [key] of fields) if (document.activeElement !== byId("income-" + key)) byId("income-" + key).value = state[key] ?? window.AtelierFinance?.defaults[key] ?? 0;
    const hasHotel = state.lastComputed?.model?.floorPlates.some(fp => fp.use === "hotel");
    if (byId("hotelLocationInputs")) {
      byId("hotelLocationInputs").hidden = !hasHotel && !String(state.buildingUse).includes("호텔");
      if (document.activeElement !== byId("hotelResidentialDistanceInput")) byId("hotelResidentialDistanceInput").value = state.hotelResidentialDistanceM ?? "";
      byId("hotelResidentialBarrierInput").value = state.hotelResidentialBarrier === true ? "yes" : state.hotelResidentialBarrier === false ? "no" : "";
    }
    if (!income) return;
    const summary = byId("financeIncomeSummary"); summary.replaceChildren();
    add(summary, "strong", `${income.mode === "hotel" ? "호텔 운영·비호텔 임대" : "임대"} · 연수입 ${money(income.annualGrossIncomeEok)} / NOI ${money(income.stabilizedNoiEok)}`);
    if (income.hotel.active) add(summary, "p", `객실 ${income.hotel.effectiveGuestRooms}실 (${income.hotel.roomsSource === "generated" ? "자동 배치" : "사용자 가정"}) · 가중 ADR ${Math.round(income.hotel.weightedAdrKrw).toLocaleString("ko-KR")}원 · RevPAR ${Math.round(income.hotel.revParKrw).toLocaleString("ko-KR")}원`);
    income.warnings.forEach(text => add(summary, "p", text, "finance-income-warning"));
    const audit = byId("financeIncomeAuditBody"); if (!audit) return; audit.replaceChildren();
    const h = income.hotel;
    const pairs = [["계산 모드", income.mode === "hotel" ? "호텔 운영 + 비호텔 임대" : "기존 임대 시나리오"],
      ["비호텔 임대 수입 / NOI", `${money(income.rentalAnnualGrossEok)} / ${money(income.rentalAnnualNoiEok)}`]];
    if (h.active) pairs.push(["객실 수 (자동 / 운영)", `${h.generatedGuestRooms} / ${h.effectiveGuestRooms}실`],
      ["연 객실 / 부대 매출", `${money(h.roomRevenueEok)} / ${money(h.ancillaryRevenueEok)}`],
      ["연 변동 운영비 / 고정 운영비", `${money(h.variableOpexEok)} / ${money(h.fixedOpexEok)}`],
      ["연 위탁 수수료 / FF&E", `${money(h.managementFeeEok)} / ${money(h.ffeReserveEok)}`],
      ["호텔 NOI (FF&E 적립 후)", money(h.noiAfterReserveEok)]);
    pairs.push(["연 총수입 / 합계 NOI", `${money(income.annualGrossIncomeEok)} / ${money(income.stabilizedNoiEok)}`]);
    const funding = state.lastComputed?.model?.finance;
    if (funding) pairs.push(["전체 PF 연 이자 / 이자 기준 DSCR", `${money(funding.annualDebtServiceEok)} / ${Number.isFinite(funding.dscr) ? funding.dscr.toFixed(2) + "x" : "미산정"}`],
      ["개발비 자기자본 계획 / 실제 모형 납입", `${money(funding.equityRequiredEok)} / ${money(funding.actualEquityPaidInEok)}`],
      ["운영 안정화 기간 PF 이자", money((funding.monthlyOperatingDebtInterest || []).reduce((sum, value) => sum + value, 0))]);
    const dl = add(audit, "dl"); for (const [label, value] of pairs) { add(dl, "dt", label); add(dl, "dd", value); }
    if(h.active && Array.isArray(h.roomTypes)) {
      const typeScroll=add(audit,'div',undefined,'finance-audit-scroll'), typeTable=add(typeScroll,'table');
      const typeHead=add(add(typeTable,'thead'),'tr');['객실 유형','배치 / 운영','유형 ADR','연 객실 매출'].forEach(label=>add(typeHead,'th',label));
      const typeBody=add(typeTable,'tbody');
      h.roomTypes.forEach(row=>{const tr=add(typeBody,'tr');[row.label,`${row.generatedCount} / ${row.effectiveCount}실`,`${Math.round(row.adrKrw).toLocaleString('ko-KR')}원`,money(row.effectiveCount*row.adrKrw*365*h.occupancyPct/100/1e8)].forEach(value=>add(tr,'td',value));});
    }
    const scroll = add(audit, "div", undefined, "finance-audit-scroll"); const table = add(scroll, "table");
    const tr = add(add(table, "thead"), "tr"); ["층", "임대 계약㎡", "객실", "연 총수입", "NOI"].forEach(label => add(tr, "th", label));
    const body = add(table, "tbody");
    income.floorIncome.forEach(row => {
      const tr = add(body, "tr"); [`${row.level}F`, row.rentalContractAreaSqm.toFixed(1), row.generatedGuestRooms || "—", money(row.annualGrossIncomeEok), money(row.annualNoiEok)].forEach(value => add(tr, "td", value));
    });
    const footer = add(add(table, "tfoot"), "tr");
    ["합계", income.floorIncome.reduce((sum, row) => sum + row.rentalContractAreaSqm, 0).toFixed(1), h.generatedGuestRooms || "—", money(income.annualGrossIncomeEok), money(income.stabilizedNoiEok)].forEach(value => add(footer, "td", value));
    const assumptions = add(audit, "details"); add(assumptions, "summary", "면적 기준·수입 공식·운영 가정");
    income.assumptions.forEach(text => add(assumptions, "p", text, "finance-assumption"));
    add(assumptions, "p", "PF는 전체 트랜치 이자를 납부하고 매각월 원금을 상환하는 가정입니다. 건설이자는 평균인출률 56%의 개산이며, 운영기 이자는 월별 Equity CF에서 차감합니다. DSCR은 전체 PF 연 이자 대비 NOI입니다.", "finance-assumption");
    add(assumptions, "p", window.AtelierPilot?.enabled
      ? "개발비 자기자본 계획과 실제 모형 납입은 다를 수 있습니다. 운영적자·매각 부족분은 추가 출자하는 가정이며 수익률은 확정 투자 성과가 아닙니다."
      : "개발비 자기자본 계획과 실제 모형 납입은 다를 수 있습니다. 운영적자·매각 부족분은 추가 출자한다고 가정하며 비소구 손실 제한은 구현하지 않습니다. LP/GP는 월별 실제 납입과 분배를 대사하고 LP 우선수익은 미회수 원금의 단리로 계산합니다.", "finance-assumption");
    income.warnings.forEach(text => add(audit, "p", text, "finance-income-warning"));
  }
  window.addEventListener("DOMContentLoaded", install);
  window.addEventListener("atelier:updated", render);
})();
