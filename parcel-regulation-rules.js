/** Sourced parcel zoning to reviewed Seoul scenario inputs; never permit approval. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AtelierParcelRegulations = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";
  const checkedAt = "2026-10-21";
  const TABLE = Object.freeze({
    "일반상업지역": { maxBcr: 60, maxFar: 800, maxFarDowntown: 600 },
    "중심상업지역": { maxBcr: 60, maxFar: 1000, maxFarDowntown: 800 },
    "근린상업지역": { maxBcr: 60, maxFar: 600, maxFarDowntown: 500 },
    "준공업지역": { maxBcr: 60, maxFar: 400, maxFarDowntown: 400 },
    "준주거지역": { maxBcr: 60, maxFar: 400, maxFarDowntown: 400 },
    "제3종일반주거지역": { maxBcr: 50, maxFar: 250, maxFarDowntown: 250 },
    "제2종일반주거지역": { maxBcr: 60, maxFar: 200, maxFarDowntown: 200 }
  });
  const sources = Object.freeze([
    { title: "국토의 계획 및 이용에 관한 법률 제50~54·76~78·84조", url: "https://www.law.go.kr/법령/국토의계획및이용에관한법률", effectiveAt: "2026-07-01", checkedAt },
    { title: "국토의 계획 및 이용에 관한 법률 시행령 제84·85·94조", url: "https://www.law.go.kr/법령/국토의계획및이용에관한법률시행령", effectiveAt: "2026-09-18", checkedAt },
    { title: "서울특별시 도시계획 조례 제44·48·50·51조", url: "https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=2149501", effectiveAt: "2026-07-13", checkedAt }
  ]);
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const fail = message => { throw new Error(message); };
  function keys(value, names, label) {
    if (!object(value) || Object.keys(value).some(key => !names.includes(key))) fail(label + "의 구조 또는 항목이 잘못되었습니다.");
  }
  function text(value, length, label) {
    if (typeof value !== "string" || !value.trim() || value.length > length || /[\x00-\x1f]/.test(value)) fail(label + "의 문자열 형식이 잘못되었습니다.");
    return value.trim();
  }
  function number(value, max, label) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) fail(label + "은 0~" + max + " 범위의 유한 숫자여야 합니다.");
    return value;
  }
  function date(value, label) {
    if (typeof value !== "string" || value.length > 40 || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value) || !Number.isFinite(Date.parse(value))) fail(label + "은 ISO 날짜여야 합니다.");
    return value;
  }
  function officialUrl(value, label) {
    const raw = text(value, 2000, label); let url;
    try { url = new URL(raw); } catch (_) { fail(label + "의 URL 형식이 잘못되었습니다."); }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port || !(host.endsWith(".go.kr") || host === "vworld.kr" || host.endsWith(".vworld.kr"))) fail(label + "은 정부·브이월드의 공식 HTTPS URL이어야 합니다.");
    return url.href;
  }
  function list(value, max, label) {
    if (!Array.isArray(value) || value.length > max) fail(label + "은 " + max + "개 이하 배열이어야 합니다.");
    return value;
  }
  function sanitizeRegulations(value) {
    if (value === null || value === undefined) return null;
    keys(value, ["pnu", "status", "zones", "districtPlans", "limits", "sources", "checkedAt", "warnings"], "필지 규제");
    if (typeof value.pnu !== "string" || !/^\d{19}$/.test(value.pnu)) fail("필지 규제의 PNU는 19자리 숫자 문자열이어야 합니다.");
    if (!["verified", "partial", "unverified"].includes(value.status)) fail("필지 규제 확인 상태가 잘못되었습니다.");
    const zones = list(value.zones, 30, "용도지역").map(zone => {
      keys(zone, ["name", "code", "source", "coveragePct", "intersectionAreaSqm"], "용도지역");
      const clean = { name: text(zone.name, 300, "용도지역명") };
      if (zone.code !== undefined) clean.code = text(zone.code, 120, "용도지역 코드");
      if (zone.source !== undefined) clean.source = text(zone.source, 200, "용도지역 출처");
      if (zone.coveragePct !== undefined) clean.coveragePct = number(zone.coveragePct, 100, "용도지역 점유율");
      if (zone.intersectionAreaSqm !== undefined) clean.intersectionAreaSqm = number(zone.intersectionAreaSqm, 20000, "용도지역 교차 면적");
      return clean;
    });
    const districtPlans = list(value.districtPlans, 30, "지구단위계획").map(plan => {
      keys(plan, ["name", "code", "noticeId", "url", "source", "coveragePct", "intersectionAreaSqm"], "지구단위계획");
      const clean = { name: text(plan.name, 300, "계획명") };
      for (const key of ["code", "noticeId", "source"]) if (plan[key] !== undefined) clean[key] = text(plan[key], 200, "계획 " + key);
      if (plan.url !== undefined) clean.url = officialUrl(plan.url, "계획 고시 URL");
      if (plan.coveragePct !== undefined) clean.coveragePct = number(plan.coveragePct, 100, "계획 구역 점유율");
      if (plan.intersectionAreaSqm !== undefined) clean.intersectionAreaSqm = number(plan.intersectionAreaSqm, 20000, "계획 구역 교차 면적");
      return clean;
    });
    keys(value.limits, ["farPct", "bcrPct", "heightM"], "계획 상한");
    const limits = {};
    for (const [key, max] of [["farPct",1500],["bcrPct",100],["heightM",300]]) limits[key] = value.limits[key] === null ? null : number(value.limits[key], max, "계획 상한 " + key);
    const refs = list(value.sources, 20, "규제 출처").map(source => {
      keys(source, ["title", "url", "checkedAt"], "규제 출처");
      const clean = { title: text(source.title, 200, "출처 제목"), url: officialUrl(source.url, "규제 출처 URL") };
      if (source.checkedAt !== undefined) clean.checkedAt = date(source.checkedAt, "출처 확인일");
      return clean;
    });
    return { pnu: value.pnu, status: value.status, zones, districtPlans, limits, sources: refs,
      checkedAt: date(value.checkedAt, "규제 확인일"), warnings: list(value.warnings, 30, "규제 안내").map(item => text(item, 1000, "규제 안내")) };
  }
  const normalizeZone = name => String(name).normalize("NFKC").replace(/\s+/g, "");
  function manualLimitsFor(params = {}) {
    const cap = (key, max) => Number.isFinite(params[key]) && params[key] > 0 && params[key] <= max ? params[key] : null;
    return { farPct: cap("legalFarCapPct", 1500), bcrPct: cap("legalBcrCapPct", 100), heightM: cap("maxHeightM", 300) };
  }
  function resolve(data, params = {}, legalRules) {
    if (params.regulationMode !== undefined && !["statutory", "scenario"].includes(params.regulationMode)) fail("법규 검토 모드는 statutory 또는 scenario여야 합니다.");
    const regulationMode = params.regulationMode === "scenario" ? "scenario" : "statutory";
    const raw = Array.isArray(data) ? data : [data];
    if (raw.length > 5) fail("규제 검토 필지는 최대 5개입니다.");
    const regs = raw.map(sanitizeRegulations);
    const manualLimits = manualLimitsFor(params);
    const result = { status: "unverified", applied: false, regulationMode, inputs: {}, rules: { far: null, bcr: null },
      generalRules: { far: null, bcr: null }, manualLimits,
      planLimits: { farPct: null, bcrPct: null, heightM: null },
      effectiveLimits: { farPct: null, bcrPct: null, heightM: null },
      zones: [], districtPlans: [], sources: [], checkedAt, warnings: [], planLimitsApplied: false,
      planLimitsStatus: "unconfirmed", requiresReview: true, liveParcelVerified: false, isPermitConfirmation: false };
    result.warnings.push("규제 상태·출처는 공급자 응답 또는 저장 파일의 입력 자료입니다. 공적 확인·고시 효력·인허가 승인을 의미하지 않습니다.");
    if (regulationMode === "statutory" && Object.values(manualLimits).some(value => value !== null))
      result.warnings.push("저장된 사용자 비교값은 법정 기준 모드에서 적용하지 않았습니다. 확인된 고시 제한은 계속 적용합니다.");
    if (!regs.length || regs.some(reg => !reg)) { result.warnings.push("모든 대상 필지의 규제 자료를 확인하지 못해 자동 적용하지 않았습니다."); return result; }
    result.zones = regs.flatMap(reg => reg.zones.map(zone => ({ ...zone, pnu: reg.pnu })));
    result.districtPlans = regs.flatMap(reg => reg.districtPlans.map(plan => ({ ...plan, pnu: reg.pnu })));
    result.sources = regs.flatMap(reg => reg.sources);
    result.warnings.push(...regs.flatMap(reg => reg.warnings));
    if (regs.some(reg => !reg.pnu.startsWith("11"))) { result.warnings.push("서울 밖의 필지는 서울 조례 표에 자동 대응하지 않습니다."); return result; }
    if (regs.some(reg => !["verified", "partial"].includes(reg.status) || !reg.sources.length)) { result.warnings.push("용도지역의 제공 상태·공식 출처가 미확인이므로 자동 적용하지 않았습니다."); return result; }
    if (regs.some(reg => reg.zones.length !== 1 || !(reg.zones[0].coveragePct >= 99.9))) {
      result.status = "manual-review";
      result.warnings.push("복수 용도지역 또는 필지 전체 점유율 미확인입니다. 국토계획법 제84조·시행령 제94조의 부분 면적·예외 검토 전에는 최대값·단순 평균을 적용하지 않습니다.");
      return result;
    }
    const names = [...new Set(regs.map(reg => normalizeZone(reg.zones[0].name)))];
    if (names.length !== 1) { result.status = "manual-review"; result.warnings.push("합필 대상의 용도지역이 서로 다릅니다. 부분별 면적과 경계·예외 규정을 확인해야 합니다."); return result; }
    const zoning = names[0];
    if (!Object.hasOwn(TABLE, zoning)) { result.status = "manual-review"; result.warnings.push("현재 검토 엔진이 지원하지 않는 세부 용도지역입니다. 상업지역 등으로 임의 변환하지 않습니다."); return result; }
    const basis = TABLE[zoning];
    const next = { ...params, zoning, regulationMode,
      ...(regulationMode === "statutory" ? { legalFarCapPct: 0, legalBcrCapPct: 0, maxHeightM: 0 } : {}) };
    const ruled = legalRules?.rulesFor ? legalRules.rulesFor(next, TABLE) : null;
    const statutory = legalRules?.rulesFor ? legalRules.rulesFor({ ...next, legalFarCapPct: 0, legalBcrCapPct: 0 }, TABLE) : null;
    const bcr = Math.min(ruled?.maxBcr ?? basis.maxBcr, regulationMode === "scenario" ? (manualLimits.bcrPct ?? Infinity) : Infinity);
    const far = Math.min(ruled?.maxFar ?? (params.seoulDowntown ? basis.maxFarDowntown : basis.maxFar),
      regulationMode === "scenario" ? (manualLimits.farPct ?? Infinity) : Infinity);
    result.inputs.zoning = zoning;
    // General ordinance numbers must never inherit a user's scenario limits.
    // Keep `rules` as the existing final density contract for current consumers.
    result.generalRules = { far: statutory?.maxFar ?? (params.seoulDowntown ? basis.maxFarDowntown : basis.maxFar),
      bcr: statutory?.maxBcr ?? basis.maxBcr };
    result.rules = { far, bcr };
    result.effectiveLimits = { farPct: far, bcrPct: bcr, heightM: regulationMode === "scenario" ? manualLimits.heightM : null };
    result.status = "partial"; result.applied = true;
    result.warnings.push("단일 용도지역과 서울 일반 조례를 검토 입력에 대응했습니다. 서울도심 여부·주거복합 강화·허용 용도·주차·개별 계획은 별도 조건입니다.");
    const confirmedPlans = regs.every(reg => reg.status === "verified" && reg.districtPlans.length > 0
      && reg.districtPlans.every(plan => plan.noticeId && plan.url));
    if (!confirmedPlans) { result.warnings.push("계획 고시·필지별 적용 상한의 확인이 없어 지구단위계획 숫자는 자동 적용하지 않았습니다."); return result; }
    if (regs.some(reg => Object.values(reg.limits).includes(0))) {
      result.status = "manual-review"; result.applied = false; result.inputs = {}; result.rules = { far: null, bcr: null };
      result.effectiveLimits = { farPct: null, bcrPct: null, heightM: null };
      result.warnings.push("계획의 0 상한은 현재 입력의 ‘0=미입력’과 구분해야 하므로 자동 적용을 보류했습니다. 건축 가능안으로 확정하지 마세요.");
      return result;
    }
    for (const [sourceKey, inputKey, base] of [["farPct","legalFarCapPct",statutory?.maxFar ?? far],["bcrPct","legalBcrCapPct",statutory?.maxBcr ?? bcr],["heightM","maxHeightM",null]]) {
      const values = regs.map(reg => reg.limits[sourceKey]);
      if (values.some(value => value === null)) { result.warnings.push("모든 필지의 " + sourceKey + " 계획 상한이 확인되지 않았습니다."); continue; }
      let cap = Math.min(...values);
      if (base !== null && cap > base) { result.warnings.push("일반 조례보다 높은 계획 상한은 완화 승인·세부 조건을 추가 확인하기 전까지 적용하지 않습니다."); continue; }
      result.planLimits[sourceKey] = cap;
      if (regulationMode === "scenario" && typeof params[inputKey] === "number" && params[inputKey] > 0) cap = Math.min(cap, params[inputKey]);
      result.inputs[inputKey] = cap; result.planLimitsApplied = true;
      if (sourceKey === "farPct") result.rules.far = Math.min(far, cap);
      if (sourceKey === "bcrPct") result.rules.bcr = Math.min(bcr, cap);
      result.effectiveLimits[sourceKey] = sourceKey === "farPct" ? result.rules.far : sourceKey === "bcrPct" ? result.rules.bcr : cap;
    }
    if (result.planLimitsApplied) { result.planLimitsStatus = "conservative-input"; result.warnings.push("필지별 고시 근거가 있는 강화 상한만 보수적 검토 입력으로 적용했습니다. 고시의 유효성과 조건 충족은 별도 확인해야 합니다."); }
    return result;
  }
  return Object.freeze({ checkedAt, sources, sanitizeRegulations, manualLimitsFor, resolve, supportedZones: Object.keys(TABLE) });
});
