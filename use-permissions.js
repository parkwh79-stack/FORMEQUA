/**
 * Seoul building-use screening, reviewed 2026-10-20. Pure scenario rules only:
 * input zoning is not a cadastral/land-use certificate or a permit decision.
 * Full reviewed sources and extraction caveats are in law-evidence/use-evidence-index.json.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AtelierUsePermissions = factory();
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";
  const checkedAt = "2026-10-20";
  const ZONES = Object.freeze({
    "제2종일반주거지역": [5, 5], "제3종일반주거지역": [6, 6], "준주거지역": [7, 7],
    "중심상업지역": [8, 8], "일반상업지역": [9, 9], "근린상업지역": [10, 10], "준공업지역": [14, 12]
  });
  const useOptions = Object.freeze([
    { key: "office", value: "업무시설(오피스)", label: "오피스" },
    { key: "hotel", value: "숙박시설(호텔)", label: "호텔" },
    { key: "apartment", value: "공동주택(주상복합)", label: "주거 · 공동주택" },
    { key: "officetel", value: "업무시설(오피스텔)", label: "리빙 · 오피스텔" },
    { key: "neighborhood", value: "근린생활시설(리테일)", label: "근린생활시설" },
    { key: "sales", value: "판매시설", label: "판매시설" },
    { key: "knowledge", value: "지식산업센터", label: "지식산업센터" }
  ]);
  const statusLabels = Object.freeze({ allowed: "일반기준상 가능", conditional: "조건 확인", prohibited: "일반기준상 불가", unverified: "판정 보류" });
  const primaryUrl = "https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=2149501";
  const sources = Object.freeze([
    ...[5, 6, 7, 8, 9, 10, 14].map(n => Object.freeze({ id: "national-use-" + n,
      title: "국토계획법 시행령 제71조 · 별표 " + n, effectiveDate: "2026-09-18",
      url: "https://www.law.go.kr/법령별표서식/(국토의계획및이용에관한법률시행령,20260918,별표" + n + ")" })),
    ...[5, 6, 7, 8, 9, 10, 12, 16, 17].map(n => Object.freeze({ id: "seoul-use-" + n,
      title: "서울특별시 도시계획 조례 " + (n >= 16 ? "제33·50조" : "제33조") + " · 별표 " + n, effectiveDate: "2026-07-13", url: primaryUrl })),
    Object.freeze({ id: "tourism-approval", title: "관광진흥법 제15·16조제5항", effectiveDate: "2026-05-12", url: "https://www.law.go.kr/법령/관광진흥법/제16조" }),
    Object.freeze({ id: "tourism-conditions", title: "관광진흥법 시행령 제13·14조", effectiveDate: "2026-08-04", url: "https://www.law.go.kr/법령/관광진흥법시행령/제13조" }),
    Object.freeze({ id: "school-protection", title: "교육환경 보호에 관한 법률 제8·9조", effectiveDate: "2026-06-03", url: "https://www.law.go.kr/법령/교육환경보호에관한법률/제9조" })
  ]);
  const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const optionalNumber = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
  const unique = values => [...new Set(values)];
  const keyFor = use => useOptions.find(item => item.value === use)?.key || "unknown";
  const labelFor = key => useOptions.find(item => item.key === key)?.label || "미분류 용도";

  function limitsFor(params) {
    const isSecond = params.zoning === "제2종일반주거지역", isThird = params.zoning === "제3종일반주거지역";
    return {
      // The Seoul annexes use strictly '< 3,000', including annex 6 where the national annex says '<= 3,000'.
      businessAreaSqm: isSecond || isThird ? 2999.99 : null,
      maxBusinessAreaSqmExclusive: isSecond || isThird ? 3000 : null,
      businessAreaIncludesOfficetel: isThird,
      officeAreaSqm: isSecond || isThird ? 2999.99 : null,
      officetelAreaSqm: isThird ? 2999.99 : null,
      salesAreaSqm: isSecond || isThird ? 1999.99 : null,
      maxSalesAreaSqmExclusive: isSecond || isThird ? 2000 : null,
      minOfficetelRoadWidthM: isThird ? 20 : null,
      maxResidentialShareExclusive: /상업지역/.test(params.zoning || "") ? 0.9 : null,
      minNonResidentialShare: /상업지역/.test(params.zoning || "") ? 0.1 : null,
      maxResidentialFarPct: /상업지역/.test(params.zoning || "") ? 400 : null
    };
  }

  function collectUses(params, plates) {
    const primary = keyFor(params.buildingUse);
    const housing = primary === "officetel" || (primary !== "apartment" && params.residentialType === "officetel") ? "officetel" : "apartment";
    const found = new Set([primary]), area = {};
    const add = (key, value) => { found.add(key); area[key] = (area[key] || 0) + Math.max(0, finite(value)); };
    if (Array.isArray(plates)) {
      for (const fp of plates) {
        if (finite(fp.floor ?? fp.level) < 0) continue;
        const key = fp.use === "residential" ? housing : fp.use === "hotel" ? "hotel"
          : fp.use === "retail" ? (primary === "sales" ? "sales" : "neighborhood")
          : fp.use === "main" ? (primary === "knowledge" ? "knowledge" : "office")
          : fp.use === "amenity" ? primary : keyFor(fp.buildingUse);
        add(key, fp.areaSqm);
      }
    } else {
      for (const use of Object.values(params.floorUseOverrides || {})) {
        if (use === "residential") found.add(housing);
        if (use === "hotel") found.add("hotel");
        if (use === "retail") found.add(primary === "sales" ? "sales" : "neighborhood");
        if (use === "main") found.add(primary === "knowledge" ? "knowledge" : "office");
      }
      if (params.mixedUseProfile === "mixed_resi") found.add(housing);
    }
    return { primary, found: [...found], area, hasAreas: Array.isArray(plates) && plates.length > 0 };
  }

  function entryFor(key, params, context) {
    const zone = params.zoning, zoneRule = ZONES[zone], limits = limitsFor(params);
    // The cadastral/context adapters do not provide a verified statutory road
    // width. A numeric planning input cannot prove frontage on an actual site.
    const actualParcel = Boolean(params.parcelData?.features?.length);
    const entry = { key, label: labelFor(key), status: "allowed", summary: "입력한 용도지역의 일반 용도 제한에서 제외되지 않습니다.", constraints: [], sourceIds: [] };
    const change = (status, summary, constraint) => { entry.status = status; entry.summary = summary; if (constraint) entry.constraints.push(constraint); };
    if (!zoneRule || key === "unknown") {
      change("unverified", "현재 검토표에 없는 용도지역 또는 법정 용도입니다.");
      entry.statusLabel = statusLabels[entry.status]; return entry;
    }
    entry.sourceIds.push("national-use-" + zoneRule[0], "seoul-use-" + zoneRule[1]);
    const generalResidential = zone === "제2종일반주거지역" || zone === "제3종일반주거지역";
    const isCommercial = /상업지역/.test(zone);
    const businessArea = (context.area.office || 0) + (limits.businessAreaIncludesOfficetel ? context.area.officetel || 0 : 0);

    if (key === "office" || key === "officetel") {
      if (key === "officetel" && zone === "제2종일반주거지역") {
        change("prohibited", "서울 제2종일반주거지역의 업무시설 허용 목록에 오피스텔은 포함되지 않습니다.", "일반 사무소와 오피스텔의 법정 용도를 구분해야 합니다.");
      } else if (generalResidential) {
        change(context.hasAreas ? "allowed" : "conditional", "업무시설 용도 바닥면적 합계가 3,000㎡ 미만이어야 합니다.");
        entry.constraints.push("업무시설 바닥면적 합계 < 3,000㎡; 제3종은 오피스텔과 일반 업무시설을 합산합니다.");
        if (context.hasAreas && businessArea >= 3000) change("prohibited", "현재 업무시설 면적이 3,000㎡ 미만 조건을 초과합니다.");
        if (key === "officetel") {
          entry.constraints.push("폭 20m 이상 도로 접도; 지정·공고 및 심의가 있는 경우에만 12m까지 완화 가능합니다.");
          const roadWidth = actualParcel ? null : optionalNumber(params.roadWidthM);
          if (actualParcel) entry.constraints.push("도로 폭 입력 " + finite(params.roadWidthM) + "m는 비교 가정입니다. 실제 필지의 법정 도로·접도 폭은 확인되지 않았습니다.");
          if (roadWidth === null || roadWidth < 20) change(entry.status === "prohibited" ? "prohibited" : "conditional", "오피스텔은 20m 접도 또는 지정 구역의 완화 조건 확인이 필요합니다.");
          if (roadWidth !== null && roadWidth < 12) change("prohibited", "입력 도로 폭은 오피스텔 접도 완화의 최소 12m에도 미달합니다.");
        }
      }
      if (zone === "준공업지역" && key === "officetel") entry.constraints.push("오피스텔·주거 복합 용적률은 조례 제50조의 기본 250% 강화 기준을 별도로 적용합니다.");
    }

    if (key === "apartment") {
      if (isCommercial) {
        entry.sourceIds.push("seoul-use-16");
        change("conditional", "주거복합으로 검토하며 주거·비주거 구성과 주거 용적률 조건을 확인해야 합니다.", "공동주택 면적비율 < 90%, 비주거 의무비율 ≥ 10%(준주택 제외), 주거 용적률 ≤ 400%를 기본 적용합니다.");
        const total = Object.values(context.area).reduce((sum, value) => sum + value, 0);
        const housingArea = context.area.apartment || 0;
        const qualifyingNonres = total - housingArea - (context.area.officetel || 0);
        if (context.hasAreas && total > 0 && (housingArea / total >= 0.9 || qualifyingNonres / total < 0.1 - 1e-9)) {
          change("prohibited", "현재 층별 배분은 상업지역 주거복합의 주거·비주거 구성 조건을 충족하지 못합니다.");
        }
      } else if (zone === "준공업지역") {
        entry.sourceIds.push("seoul-use-17");
        change("conditional", "준공업지역 공동주택은 공장비율·사업 유형·산업부지 확보 조건을 먼저 확인해야 합니다.", "공장비율 10% 미만 등 별표 12의 예외 또는 산업부지 확보·산업복합건물 요건 해당 여부가 필요합니다. 3,000㎡ 이상 아파트의 지구단위계획 조건도 확인합니다.");
      }
      if (zone === "제2종일반주거지역") entry.constraints.push("7층 지정·고시 구역 여부와 아파트 층수 심의 조건을 별도로 확인해야 합니다.");
    }

    if (key === "hotel") {
      entry.sourceIds.push("school-protection");
      entry.constraints.push("교육환경보호구역의 고시 경계와 숙박업 제한·심의 또는 예외 적용을 별도로 확인해야 합니다. 과거 관광진흥법의 학교 75m 특례는 적용하지 않습니다.");
      if (params.hotelType === "tourist") {
        entry.sourceIds.push("tourism-approval", "tourism-conditions");
        change("conditional", "관광호텔은 관광진흥법에 따른 사업계획 승인 경로와 개별 입지 조건 확인이 필요합니다.", "관광진흥법 제16조제5항은 승인된 관광숙박시설의 용도 제한에 관한 특례이며, 용적률·건폐율·주차 상한을 자동 완화하지 않습니다.");
        if (generalResidential) {
          entry.constraints.push("관광호텔업 신축의 국가 기본조건: 도로 폭 ≥ 12m, 접도 길이 ≥ 4m, 개구부 방향 인접경계 거리의 2배 이하 높이, 조경 ≥ 15%. 지역 조례의 강화 및 실제 배치를 추가 확인합니다.");
          if (!actualParcel && finite(params.roadWidthM) > 0 && finite(params.roadWidthM) < 12) change("prohibited", "관광호텔업 신축의 국가 기본 접도 폭 12m에 미달합니다. 호스텔·소형호텔은 별도 유형입니다.");
          if (actualParcel) entry.constraints.push("입력 도로 폭으로 실제 접도 충족을 확정하지 않습니다. 법정 도로·접도 폭·접도 길이는 확인되지 않았습니다.");
        } else if (zone === "준주거지역") entry.constraints.push("준주거지역 관광숙박시설은 소음 공해 시설의 배치·차음 등 주거환경 보호 기준을 확인해야 합니다.");
      } else if (params.hotelType !== "general") {
        change("conditional", "일반호텔과 관광호텔의 적용 법령이 다릅니다. 호텔 유형을 먼저 선택해야 합니다.");
        entry.constraints.push("유형 미확인 상태에서는 관광호텔의 특례 승인이나 일반호텔의 거리 조건 충족을 가정하지 않습니다.");
      } else if (!isCommercial) {
        change("prohibited", "이 용도지역에서는 일반호텔이 일반 건축 허용 대상에 해당하지 않습니다.", "관광숙박 사업계획 승인 특례는 관광호텔 유형을 선택해 별도로 검토해야 합니다.");
      } else {
        entry.sourceIds.push("seoul-use-8");
        change("conditional", "일반호텔은 주거지역과의 거리·차단 조건 및 교육환경 검토가 필요합니다.", "서울 조례상 주거지역 경계 50m 이내 건축·용도변경 제한, 50m 초과 200m까지 환경 부적합 시 심의를 통한 제한 가능성을 확인합니다.");
        const distance = optionalNumber(params.hotelResidentialDistanceM);
        if (distance !== null && distance <= 50 && params.hotelResidentialBarrier !== true) change("prohibited", "입력한 주거지역 이격 거리가 50m 이내입니다. 차단 예외의 승인 여부는 별도 확인 대상입니다.");
      }
    }

    if (key === "neighborhood") change("conditional", "리테일의 실제 업종·면적에 따라 제1·2종 근린생활시설 또는 판매시설로 달라집니다.", "현재는 일반 점포·음식점의 배치 초안입니다. 업종별 면적·접도·금지 업종을 확정해야 합니다.");
    if (key === "sales" && generalResidential) {
      change("conditional", "일반 신축 소매시장·상점은 해당 용도 면적 2,000㎡ 미만 및 폭 20m 도로 접도가 필요합니다.", "기존 시장 재건축 특례는 자동 적용하지 않습니다.");
      if ((context.hasAreas && (context.area.sales || 0) >= 2000) || (!actualParcel && optionalNumber(params.roadWidthM) !== null && finite(params.roadWidthM) < 20)) change("prohibited", "현재 판매시설 면적 또는 도로 폭이 일반 신축 허용 조건을 충족하지 못합니다.");
      if (actualParcel) entry.constraints.push("도로 폭 입력은 비교 가정이며 실제 필지의 법정 도로·접도 폭은 미확인입니다.");
    }
    if (key === "knowledge") {
      change("conditional", "지식산업센터는 공장·입주 업종·지원시설의 법정 용도를 구분해 확인해야 합니다.");
      if (zone === "제2종일반주거지역" || zone === "중심상업지역") change("prohibited", "일반적인 지식산업센터는 이 용도지역의 공장 허용 목록에 해당하지 않습니다.");
      if (zone === "제3종일반주거지역") entry.constraints.push("시장이 지정·공고한 구역, 폭 8m 이상 접도 및 공장 배출·환경 조건이 필요합니다.");
    }
    entry.sourceIds = unique(entry.sourceIds);
    entry.statusLabel = statusLabels[entry.status];
    return entry;
  }

  function evaluate(params, floorPlates) {
    params = params || {};
    const context = collectUses(params, floorPlates);
    const entries = context.found.map(key => entryFor(key, params, context));
    const severity = { allowed: 0, conditional: 1, unverified: 2, prohibited: 3 };
    const worst = entries.reduce((result, entry) => severity[entry.status] > severity[result.status] ? entry : result, entries[0]);
    const sourceIds = unique(entries.flatMap(entry => entry.sourceIds));
    return { checkedAt, zoning: params.zoning || "", status: worst.status,
      label: statusLabels[worst.status], summary: worst.summary,
      canUseForStudy: worst.status !== "prohibited" && worst.status !== "unverified",
      isPermitConfirmation: false, entries, limits: limitsFor(params), areas: { ...context.area }, sourceIds,
      sources: sources.filter(source => sourceIds.includes(source.id)),
      warnings: ["용도지역·도로 폭·지번은 입력한 시나리오입니다. 토지이용계획확인서와 지구단위계획·정비계획·경관·교육환경 등 개별 제한을 확인해야 합니다.",
        "리빙은 상품 이름입니다. 선택한 공동주택 또는 오피스텔의 법적 용도로 구분해 검토하며, 생활숙박시설을 주택으로 간주하지 않습니다.",
        ...(params.parcelData?.features?.length ? ["실제 경계 조회로 접도 폭·서울도심 해당 여부·공공기여 면적이 확인된 것은 아닙니다. 해당 수치는 입력 가정이며 원문·현황 확인이 필요합니다."] : [])] };
  }

  function optionsFor(params) {
    return useOptions.map(option => {
      const result = evaluate({ ...(params || {}), buildingUse: option.value, mixedUseProfile: "office_retail", floorUseOverrides: {} });
      return { ...option, ...result, label: option.label, statusLabel: result.label };
    });
  }
  return Object.freeze({ checkedAt, sources, useOptions, statusLabels, limitsFor, evaluate, optionsFor });
});
