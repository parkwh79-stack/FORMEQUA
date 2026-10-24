/* Shared continuous core reservations in the computed building's local X/Z
 * metre frame. A coordination draft, not a stair/elevator/fire-safety design. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AtelierCoreLayout = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  const EPS = 0.000001, INSET = 0.5;
  const finite = n => typeof n === "number" && Number.isFinite(n);
  const round = n => Math.round(n * 1000000) / 1000000;
  const rect = (minX, maxX, minZ, maxZ) => ({ minX: round(minX), maxX: round(maxX), minZ: round(minZ), maxZ: round(maxZ) });
  const width = r => r.maxX - r.minX, depth = r => r.maxZ - r.minZ;
  const inside = (r, bounds) => r.minX >= bounds.minX - EPS && r.maxX <= bounds.maxX + EPS && r.minZ >= bounds.minZ - EPS && r.maxZ <= bounds.maxZ + EPS;
  const overlap = (a, b) => a.minX < b.maxX - EPS && a.maxX > b.minX + EPS && a.minZ < b.maxZ - EPS && a.maxZ > b.minZ + EPS;
  const validRect = r => r && [r.minX, r.maxX, r.minZ, r.maxZ].every(finite) && width(r) > EPS && depth(r) > EPS;
  const assumptions = [
    "모든 지상층의 외벽 안쪽 0.5m 여유 영역 교집합에 하나의 동일한 수직 코어 예약을 적용합니다. 층별로 코어를 이동하거나 축소하지 않습니다.",
    "코어 치수는 초기 공간 조정을 위한 가정입니다. 계단·승강기·샤프트의 개수와 상세 치수, 피난·방화·무장애 기준 및 구조 적합성을 확정하지 않습니다.",
    "지하와의 정합은 같은 세계 좌표 코어를 지하 평면의 중심 좌표로 변환해 확인해야 합니다. 지하 진입로·램프·기계실 및 차량 회전은 별도 검토합니다."
  ];
  function floorGeometry(fp) {
    if (!fp || !finite(fp.widthM) || !finite(fp.depthM) || fp.widthM <= 2 * INSET || fp.depthM <= 2 * INSET ||
      (fp.northShiftM !== undefined && !finite(fp.northShiftM))) return null;
    const w = fp.widthM, d = fp.depthM, z = fp.northShiftM === undefined ? 0 : fp.northShiftM;
    return { bounds: rect(-w / 2 + INSET, w / 2 - INSET, z - d / 2 + INSET, z + d / 2 - INSET),
      voids: fp.hasAtrium ? [rect(-w * 0.175, w * 0.175, z - d * 0.175, z + d * 0.175)] : [] };
  }
  function validateForFloor(layout, fp) {
    if (layout?.status === "not-requested") return { valid: false, status: "not-requested", reason: layout.reason || "massing-only", cores: [],
      warnings: ["단순 매스 단계에서는 실내 동선 예약을 요청하지 않았습니다. 계단·출입·피난 또는 승강기 검토가 완료된 상태가 아닙니다."] };
    const warnings = [], geometry = floorGeometry(fp);
    if (!geometry) warnings.push("유효한 층 외곽이 없어 공통 수직 코어의 포함 여부를 확인하지 못했습니다.");
    if (!layout || layout.status !== "reserved" || !Array.isArray(layout.cores) || !layout.cores.length) {
      warnings.push("확보된 공통 수직 코어가 없습니다. 코어를 임의로 추가하거나 축소하지 않았습니다.");
      return { valid: false, cores: [], warnings };
    }
    const cores = [], ids = new Set();
    for (let i = 0; i < layout.cores.length; i++) {
      const r = layout.cores[i];
      if (!validRect(r) || typeof r.id !== "string" || !r.id || ids.has(r.id)) {
        warnings.push("공통 수직 코어의 좌표 또는 식별자가 유효하지 않습니다."); continue;
      }
      ids.add(r.id);
      if (geometry && (!inside(r, geometry.bounds) || geometry.voids.some(v => overlap(r, v))))
        warnings.push("공통 수직 코어가 이 층의 외벽 여유 영역 또는 중정과 충돌합니다. 층별 이동·축소 없이 매스를 다시 검토해야 합니다.");
      if (cores.some(other => overlap(r, other))) warnings.push("공통 수직 코어 예약끼리 겹칩니다.");
      cores.push({ id: r.id, minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ });
    }
    return { valid: !warnings.length, cores: warnings.length ? [] : cores, warnings: [...new Set(warnings)] };
  }
  function planCore(input = {}) {
    const floors = Array.isArray(input.floorPlates) ? input.floorPlates : [input];
    const requested = input.coreType === "split" ? "split" : input.coreType === "north" || input.option === "C" ? "north" : "center";
    const profile = (typeof input.circulationProfile === "string" ? input.circulationProfile : input.circulationProfile?.profile) === "compact" ? "compact" : "standard";
    const result = { version: 1, status: "unfeasible", coreType: requested, cores: [], bounds: null,
      metrics: { coreCount: 0, coreAreaSqm: 0, widthM: 0, depthM: 0 },
      warnings: [], assumptions: assumptions.slice(), isPermitConfirmation: false,
      circulation: { profile, status: "unfeasible", label: profile === "compact" ? "계단·출입 예약" : "수직 동선 예약",
        stairCount: null, exitCount: null, elevatorRequired: null, elevatorIncluded: profile === "compact" ? false : null,
        entranceVerified: false, egressVerified: false, isPermitConfirmation: false } };
    if (input.detailLevel === "massing") {
      result.status = "not-requested"; result.reason = "massing-only"; result.metrics = null;
      result.circulation = { ...result.circulation, profile: "none", status: "not-reviewed", label: "동선 검토 전", elevatorIncluded: null };
      result.warnings.push("단순 매스 단계이므로 실내 동선 예약을 생성하지 않았습니다. 계단·출입·피난·승강기 요건은 별도 검토해야 합니다.");
      return result;
    }
    if (profile === "compact") result.assumptions[1] = "소규모 계획용 2.4×3.6m 계단·출입 예약공간입니다. 법정 최소 계단 치수나 실제 계단·승강기 설계가 아니며, 출입·피난·방화·무장애·승강기 설치 요건의 면제를 뜻하지 않습니다.";
    if (!floors.length) { result.warnings.push("생성된 지상층이 없어 공통 수직 코어를 계획하지 않았습니다."); return result; }
    const geometry = floors.map(floorGeometry);
    if (geometry.some(g => !g)) { result.warnings.push("층 외곽 치수가 유효하지 않아 공통 수직 코어를 계획하지 않았습니다."); return result; }
    const bounds = rect(Math.max(...geometry.map(g => g.bounds.minX)), Math.min(...geometry.map(g => g.bounds.maxX)),
      Math.max(...geometry.map(g => g.bounds.minZ)), Math.min(...geometry.map(g => g.bounds.maxZ)));
    result.bounds = bounds;
    if (!validRect(bounds)) { result.warnings.push("전 층을 관통하는 외곽 교집합이 없어 동일한 수직 코어를 확보하지 못했습니다."); return result; }
    const w = width(bounds), d = depth(bounds), z = (bounds.minZ + bounds.maxZ) / 2;
    const rawW = Math.min(...floors.map(f => f.widthM)), rawD = Math.min(...floors.map(f => f.depthM));
    const desiredW = profile === "compact" ? 2.4 : Math.min(6, Math.max(2.4, rawW * 0.24), w * 0.46);
    const desiredD = profile === "compact" ? 3.6 : Math.min(5.5, Math.max(2.4, rawD * 0.24), d * 0.46);
    const voids = geometry.flatMap(g => g.voids), cores = [];
    if (requested === "split") {
      let cw = profile === "compact" ? 2.4 : Math.min(3.3, Math.max(1.8, rawW * 0.12), w * 0.2), cd = desiredD;
      if (voids.length) {
        if (profile === "standard") {
          cw = Math.min(cw, ...voids.map(v => Math.min(v.minX - bounds.minX, bounds.maxX - v.maxX) - 0.15));
          cd = Math.min(cd, d - 0.2);
        }
      }
      if (cw >= 1.6 && cd >= 1.8) {
        cores.push({ id: "core-west", ...rect(bounds.minX, bounds.minX + cw, z - cd / 2, z + cd / 2) });
        cores.push({ id: "core-east", ...rect(bounds.maxX - cw, bounds.maxX, z - cd / 2, z + cd / 2) });
      }
    } else if (requested === "north" || voids.length) {
      const availableD = voids.length ? Math.min(...voids.map(v => v.minZ - bounds.minZ - 0.15)) : d;
      const cd = profile === "compact" ? desiredD : Math.min(desiredD, availableD);
      if (desiredW >= 1.8 && cd >= 1.8 && (profile !== "compact" || availableD >= cd)) cores.push({ id: "core-main", ...rect(-desiredW / 2, desiredW / 2, bounds.minZ, bounds.minZ + cd) });
      if (voids.length && requested === "center") {
        result.coreType = "north";
        result.warnings.push("중정이 있는 층과 충돌하지 않도록 모든 층의 공통 수직 코어를 북측에 예약했습니다.");
      }
    } else if (desiredW >= 1.8 && desiredD >= 1.8) cores.push({ id: "core-main", ...rect(-desiredW / 2, desiredW / 2, z - desiredD / 2, z + desiredD / 2) });
    if (!cores.length) { result.warnings.push("전 층에서 코어·중정을 함께 담을 최소 여유 치수를 확보하지 못했습니다. 코어를 강제로 작게 만들지 않았습니다."); return result; }
    const draft = { status: "reserved", cores };
    const checks = floors.map(fp => validateForFloor(draft, fp));
    if (checks.some(check => !check.valid)) {
      result.warnings.push(...new Set(checks.flatMap(check => check.warnings))); return result;
    }
    result.status = "reserved"; result.cores = cores; result.circulation.status = "reserved";
    result.metrics = { coreCount: cores.length, coreAreaSqm: round(cores.reduce((sum, core) => sum + width(core) * depth(core), 0)),
      widthM: round(Math.max(...cores.map(c => c.maxX)) - Math.min(...cores.map(c => c.minX))),
      depthM: round(Math.max(...cores.map(c => c.maxZ)) - Math.min(...cores.map(c => c.minZ))) };
    return result;
  }
  return Object.freeze({ planCore, validateForFloor, version: "1.1.0" });
});
