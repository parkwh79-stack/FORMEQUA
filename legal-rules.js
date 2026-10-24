/**
 * Versioned Seoul planning rules checked with Korean Law MCP on 2026-10-20.
 * Local calculations use this reviewed snapshot, never guessed text parsing.
 * Provenance and full public-law responses: ./law-evidence/
 * Model scope: one rectangular site, new construction, one dwelling size.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AtelierLegal = factory();
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";
  const checkedAt = "2026-10-20";
  const densityCheckedAt = "2026-10-21";
  const sources = Object.freeze([
    { id: "seoul-density", title: "서울특별시 도시계획 조례 제44·48·50·51조", effectiveDate: "2026-07-13", checkedAt: densityCheckedAt, method: "법령 MCP", url: "https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=2149501" },
    { id: "seoul-parking", title: "서울특별시 주차장 설치 및 관리 조례 제20·21·25조 / 별표 2·3", effectiveDate: "2026-10-01", method: "법령 MCP + 법제처 별표 원문", url: "https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=2171833" },
    { id: "housing-parking", title: "주택건설기준 등에 관한 규정 제27조", effectiveDate: "2026-09-08", method: "법령 MCP", url: "https://www.law.go.kr/법령/주택건설기준등에관한규정/제27조" },
    { id: "north-solar", title: "건축법 제61조 / 시행령 제86조", effectiveDate: "2026-10-06", method: "법령 MCP", url: "https://www.law.go.kr/법령/건축법시행령/제86조" },
    { id: "seoul-ev", title: "서울특별시 환경친화적 자동차 조례 제7조의3~5", effectiveDate: "2025-05-19", method: "법령 MCP", url: "https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=2038437" }
  ]);
  const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const roundParking = value => value < 1 - 1e-9 ? 0 : Math.floor(value + 0.5 + 1e-9);
  const firstDecimal = value => Math.floor((value + 1e-9) * 10) / 10;

  function rulesFor(params, table) {
    const zone = table[params.zoning] || table["일반상업지역"];
    const warnings = [];
    let baseOrdFar = params.seoulDowntown ? (zone.maxFarDowntown ?? zone.maxFar) : zone.maxFar;
    const use = String(params.buildingUse || "");
    const hasHousing = /공동주택|오피스텔/.test(use) || params.mixedUseProfile === "mixed_resi"
      || Object.values(params.floorUseOverrides || {}).includes("residential");
    if (params.zoning === "준공업지역" && hasHousing) {
      baseOrdFar = Math.min(baseOrdFar, 250);
      warnings.push("준공업지역 주거·오피스텔 복합은 조례 제50조의 250% 강화 기준을 적용했습니다. 별도 완화는 승인 조건 확인이 필요합니다.");
    }
    const farCap = finite(params.legalFarCapPct), bcrCap = finite(params.legalBcrCapPct);
    const maxFar = farCap > 0 ? Math.min(baseOrdFar, farCap) : baseOrdFar;
    const maxBcr = bcrCap > 0 ? Math.min(zone.maxBcr, bcrCap) : zone.maxBcr;
    if (farCap > baseOrdFar || bcrCap > zone.maxBcr) warnings.push("입력한 개별 상한이 일반 조례보다 높아 일반 상한을 유지했습니다. 완화 승인 여부는 별도 확인 대상입니다.");
    if (params.parcelMerged || finite(params.publicContribPct) > 0) warnings.push("합필·공공기여에 따른 용적률 인센티브는 승인된 계획 확인 전에는 가산하지 않습니다.");
    const solarZone = /전용주거|일반주거/.test(params.zoning);
    // No parcel-specific exception evidence is implemented. In statutory mode,
    // a saved display/scenario checkbox cannot waive the residential baseline.
    const scenarioSolar = params.regulationMode === "scenario";
    const northSolarApplies = solarZone && (!scenarioSolar || Boolean(params.northSolar));
    const commercialHousing = /상업지역/.test(params.zoning) && hasHousing
      && (use.includes("공동주택") || (!use.includes("오피스텔") && params.residentialType === "apartment"));
    if (commercialHousing) warnings.push("상업지역 주거복합의 주거 용적률 400% 및 비주거 10% 조건을 적용했습니다. 임대주택·전략용도 등 승인 특례는 적용하지 않습니다.");
    if (solarZone && !params.northSolar) warnings.push(scenarioSolar
      ? "비교 시나리오에서 주거지역 정북 일조 조건을 해제했습니다. 시행령 제86조의 예외를 확인한 결과가 아닙니다."
      : "저장된 일조 비교값은 법정 기준 모드에서 면제로 적용하지 않았습니다. 주거지역 일반 사선을 적용하며 시행령 제86조의 개별 예외는 미확인입니다.");
    if (params.parcelData?.features?.length) warnings.push("실제 필지의 접도 폭·서울도심 해당 여부·공공기여 면적은 공간자료로 확인되지 않았습니다. 해당 입력은 비교 가정이며 개별 확인이 필요합니다.");
    if (!solarZone && params.northSolar) warnings.push("정북 일조 일반 규정은 전용·일반주거지역 대상입니다. 이 용도지역에는 자동 사선을 적용하지 않습니다.");
    if (solarZone) warnings.push("정북 인접지 용도·도로·공지 등 일조 예외와 공동주택의 채광·동간거리 규정은 대지 자료로 추가 확인해야 합니다.");
    warnings.push("필지 경계·용도지역·서울도심 여부는 입력값입니다. 지적도 및 지구단위계획 고시의 확인을 대신하지 않습니다.");
    return { maxFar, maxBcr, baseOrdFar, northSolarApplies,
      maxResidentialFarPct: commercialHousing ? 400 : null,
      minNonResidentialRatio: commercialHousing ? 0.1 : 0,
      warnings, sourceIds: ["seoul-density", "north-solar"], checkedAt };
  }

  function parkingFor(plates, params, capacity) {
    const warnings = [];
    const use = String(params.buildingUse || "");
    const restricted = params.parkingDistrict === "restricted";
    const types = {};
    let residentialNet = 0;
    for (const fp of plates) {
      const area = Math.max(0, finite(fp.areaSqm));
      if (fp.use === "residential") { residentialNet += Math.max(0, finite(fp.netFloorSqm)); continue; }
      let key = "office", divisor = restricted ? 122 : 100, label = "업무시설";
      if (fp.use === "hotel" || (fp.use === "amenity" && use.includes("호텔"))) {
        key = "hotel"; label = "숙박시설 (로비·공용 포함)"; divisor = restricted ? 268 : 134;
      } else if (fp.use === "retail") {
        key = use.includes("판매시설") ? "sales" : "neighborhood";
        label = key === "sales" ? "판매시설" : "근린생활시설";
        divisor = key === "sales" ? (restricted ? 122 : 100) : (restricted ? 268 : 134);
      }
      if (!types[key]) types[key] = { key, label, areaSqm: 0, divisor, sourceId: "seoul-parking" };
      types[key].areaSqm += area;
    }
    const breakdown = Object.values(types).map(item => ({ ...item, rawCount: firstDecimal(item.areaSqm / item.divisor), formula: item.divisor + "㎡당 1대" }));
    const nonresidential = roundParking(breakdown.reduce((sum, item) => sum + item.rawCount, 0));
    const unitArea = Math.max(15, finite(params.housingUnitAreaSqm) || 59);
    const explicitUnits = Math.max(0, Math.floor(finite(params.housingUnits)));
    const estimatedUnitCount = explicitUnits === 0;
    const housingUnits = residentialNet > 0 ? (explicitUnits || Math.max(1, Math.floor((residentialNet + 1e-8) / unitArea))) : 0;
    const apartment = use.includes("공동주택") || (!use.includes("오피스텔") && params.residentialType === "apartment");
    const housingExclusiveSqm = housingUnits * unitArea;
    // Seoul special-city denominator in regulation 27: <=85㎡ 75, >85㎡ 65.
    const housingAreaBased = housingExclusiveSqm / (unitArea <= 85 ? 75 : 65);
    const housingApproval = apartment && params.housingPermitType === "housing_approval";
    const perUnitMinimum = housingApproval ? (unitArea <= 60 ? 0.7 : 1) : (unitArea <= 30 ? 0.5 : unitArea <= 60 ? 0.8 : 1);
    const housingCount = housingUnits ? Math.ceil(Math.max(housingAreaBased, housingUnits * perUnitMinimum) - 1e-9) : 0;
    const housingAreaDeficitSqm = Math.max(0, housingExclusiveSqm - residentialNet);
    if (housingUnits) {
      breakdown.push({ key: "housing", label: apartment ? "공동주택" : "오피스텔", areaSqm: housingExclusiveSqm, rawCount: housingCount, formula: unitArea + "㎡ × " + housingUnits + "세대 / 면적식과 세대 최소 중 큰 값, 올림", sourceId: housingApproval ? "housing-parking" : "seoul-parking" });
      warnings.push((estimatedUnitCount ? "주거 세대수는 전용률 가정에서 추정했습니다." : "입력한 세대수로 주거 주차대수를 계산했습니다.") + " 도시형생활주택·임대주택 등 특례는 적용하지 않았습니다.");
    }
    if (housingAreaDeficitSqm > 0.01) warnings.push("입력 세대수에 필요한 전용면적이 매스 내 추정 전용면적보다 " + housingAreaDeficitSqm.toFixed(1) + "㎡ 큽니다.");
    if (params.parkingDistrict !== "standard" && !restricted) warnings.push("주차장 설치제한지역 여부 미확인: 별표2 일반 기준으로 비교 중입니다. 제21조·별표3 해당 여부를 먼저 확인하세요.");
    if (use.includes("지식산업센터")) warnings.push("지식산업센터는 현재 업무시설로 가정했습니다. 공장·지원시설 등 실제 시설별 용도와 설치기준을 추가 확인해야 합니다.");
    const legalParkingCount = housingCount + (restricted ? (nonresidential > 0 ? 1 : 0) : nonresidential);
    const legalMaxParkingCount = restricted ? housingCount + nonresidential : null;
    const capacityCount = Math.max(0, Math.floor(finite(capacity)));
    const plannedParkingCount = restricted ? Math.min(capacityCount, legalMaxParkingCount) : capacityCount;
    const deficit = Math.max(0, legalParkingCount - plannedParkingCount);
    if (restricted) warnings.push("설치제한지역은 비주거 최고한도와 교통약자 등 최소 1면, 주거는 별표2 최소를 별도로 합산했습니다. 역·환승센터 내부 특례는 별도 확인 대상입니다.");
    const disabledParkingCount = restricted ? null : (legalParkingCount >= 10 ? Math.ceil(legalParkingCount * 0.03 - 1e-9) : 0);
    if (restricted) warnings.push("설치제한지역 장애인 전용면수의 산정 분모는 적용 확인이 필요해 확정 수량을 표시하지 않습니다.");
    const evEligibleUse = breakdown.some(item => item.key !== "housing") || (apartment && housingUnits >= 100);
    const evApplies = evEligibleUse && plannedParkingCount >= 50;
    const evChargerFastSlow = evApplies ? Math.round(plannedParkingCount * 0.05) : 0;
    const evFastCount = evApplies ? Math.min(10, Math.max(evChargerFastSlow >= 10 ? 1 : 0,
      breakdown.some(item => item.key !== "housing") ? Math.round(evChargerFastSlow * 0.10) : 0)) : 0;
    warnings.push("지하는 전층 자주식 주차·기계실로 가정했습니다. 기계식 주차, 지하 근린생활시설 및 실제 램프·동선·구획 검증은 포함하지 않습니다.");
    return { legalParkingCount, legalMaxParkingCount, plannedParkingCount, capacityCount, deficit,
      breakdown, disabledParkingCount, evChargerFastSlow, evFastCount, evApplies,
      sqmPerParkingUnit: breakdown.length === 1 && breakdown[0].divisor ? breakdown[0].divisor : null,
      warnings, housingUnits, housingAreaDeficitSqm, estimatedUnitCount, restricted,
      sourceIds: ["seoul-parking", "housing-parking", "seoul-ev"] };
  }
  return Object.freeze({ checkedAt, densityCheckedAt, sources, rulesFor, parkingFor, roundParking, firstDecimal });
});
