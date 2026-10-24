/** Rectangular basement parking draft. Metre geometry, not permit approval. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AtelierParkingLayout = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  const EPS = 1e-7, checkedAt = "2026-10-21";
  const source = Object.freeze({ title: "주차장법 시행규칙 제3조·제6조·제11조", url: "https://www.law.go.kr/법령/주차장법시행규칙", effectiveAt: "2026-07-27", checkedAt });
  const rect = (minX, maxX, minZ, maxZ, props = {}) => ({ minX, maxX, minZ, maxZ, ...props });
  const width = r => r.maxX - r.minX, depth = r => r.maxZ - r.minZ;
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const overlap = (a, b) => a.minX < b.maxX - EPS && a.maxX > b.minX + EPS && a.minZ < b.maxZ - EPS && a.maxZ > b.minZ + EPS;
  const inside = (a, b) => a.minX >= b.minX - EPS && a.maxX <= b.maxX + EPS && a.minZ >= b.minZ - EPS && a.maxZ <= b.maxZ + EPS;
  function contact(a, b) {
    const x = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX), z = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
    return (x > EPS && z >= -EPS) || (z > EPS && x >= -EPS);
  }
  function connections(paths, start) {
    const reached = new Set(start >= 0 ? [start] : []), queue = [...reached];
    for (let index = 0; index < queue.length; index++) paths.forEach((path, i) => { if (!reached.has(i) && contact(paths[queue[index]], path)) { reached.add(i); queue.push(i); } });
    return reached;
  }
  function validate(level) {
    const errors = [], solids = [...level.cores, ...level.columns], circulation = [...level.ramps, ...level.aisles];
    const reached = connections(circulation, level.ramps.length ? 0 : -1);
    const all = [...level.spaces, ...solids, ...circulation];
    all.forEach(r => { if (![r.minX, r.maxX, r.minZ, r.maxZ].every(finite) || width(r) <= EPS || depth(r) <= EPS || !inside(r, level.bounds)) errors.push("경계 또는 유효 치수 위반: " + r.id); });
    level.spaces.forEach((space, index) => {
      if (solids.some(obstacle => overlap(space, obstacle))) errors.push("주차구획과 코어·기둥 충돌: " + space.id);
      if (circulation.some(aisle => overlap(space, aisle))) errors.push("주차구획과 차로·램프 충돌: " + space.id);
      if (level.spaces.slice(index + 1).some(other => overlap(space, other))) errors.push("주차구획 중복: " + space.id);
      const aisleIndex = circulation.findIndex(aisle => aisle.id === space.aisleId);
      if (aisleIndex < 0 || !reached.has(aisleIndex) || !contact(space, circulation[aisleIndex])) errors.push("램프 연결 차로에 접하지 않는 구획: " + space.id);
      const legalWidth = space.type === "accessible_reserved" ? 3.3 : 2.6;
      const short = space.orientation === "x" ? depth(space) : width(space), long = space.orientation === "x" ? width(space) : depth(space);
      if (short < legalWidth - EPS || long < 5.2 - EPS) errors.push("구획 치수 부족: " + space.id);
    });
    circulation.forEach(path => {
      if (solids.some(obstacle => overlap(path, obstacle))) errors.push("차로·램프와 코어·기둥 충돌: " + path.id);
      const cross = path.drivingAxis === "x" ? depth(path) : width(path);
      if (cross < 6 - EPS) errors.push("차로·램프 유효 폭 6m 부족: " + path.id);
      if (path.type === "ramp") {
        const run = path.drivingAxis === "x" ? width(path) : depth(path);
        if (path.riseM > (run - path.transitionM) * path.slopePct / 100 + EPS) errors.push("램프 경사·완화구간 길이 부족: " + path.id);
      }
    });
    if (level.spaces.length && reached.size !== circulation.length) errors.push("연결되지 않은 차로 또는 램프");
    return { valid: errors.length === 0, errors, checks: { boundary: true, stallOverlap: true, coreColumnClearance: true, rampAisleClearance: true, aisleConnection: true, stallDimensions: true }, sweptPathVerified: false, accessibilityRouteVerified: false };
  }
  const assumptions = [
    "입력 지하층을 같은 직사각 외곽·코어·기둥 모듈로 반복한 자주식 주차 초안입니다. 실제 필지·흙막이·구조·기계실 면적에 따른 확정 배치가 아닙니다.",
    "모든 일반 구획은 확장형 2.6×5.2m, 장애인 예정 구획은 3.3×5.2m, 직각 주차 차로는 6m로 배치합니다. 구획 수는 빈 면적을 대수로 환산한 값이 아닙니다.",
    "각 지하층에 폭 6m의 2차로 직선 램프와 6m 양단 랜딩, 평탄 우회 차로를 남겼습니다. 층고 3.3m·최대 15%·양단 3m씩 절반 경사 완화구간을 가정합니다. 지상 진입 위치·단면 유효높이·차량 회전 궤적은 미검증입니다.",
    "동일 평면 램프를 수직 반복하고 각 층의 양단 랜딩과 우회 차로로 연결하는 가정입니다. 지상 도로 접속·회차·피난 및 보행 무장애 동선을 별도 설계해야 합니다.",
    "지하 코어는 대표 8×8m(양단형은 4×8m 두 개) 예약이며 지상 실내 초안의 코어와 구조적으로 정합된 배치가 아닙니다. 선택한 중앙·북측·양단 위치만 반영하며 수직 코어와 기계실은 별도 확인 대상입니다.",
    "장애인·전기차 표시는 공간 예약입니다. 법정 설치면수와 비교하며 보행 접근로·충전기·방재 설비 적합성을 확정하지 않습니다."
  ];
  function generate(input = {}) {
    const originalW = input.widthM, originalD = input.depthM, floors = input.floorsBelow;
    const result = { version: "1.1", checkedAt, sources: [source], assumptions: [...assumptions], warnings: [], capacityCount: 0, perFloorCount: 0, levels: [], dimensions: { widthM: originalW, depthM: originalD }, isPermitConfirmation: false,
      status: "incomplete", statusLabel: "배치 미완료", capacityVerified: false, massFitEligible: false, coreSource: input.coreRects !== undefined ? "shared" : "legacy-assumption",
      validation: { valid: false, errors: [], capacityVerified: false, massFitEligible: false, sweptPathVerified: false, accessibilityRouteVerified: false, actualParcelVerified: false } };
    function incomplete(message, reason) {
      result.warnings.push(message); result.failureReason = reason;
      result.validation.errors = [message]; result.levels = []; result.capacityCount = 0; result.perFloorCount = 0;
      return result;
    }
    if (![originalW, originalD, floors].every(finite) || originalW <= 0 || originalD <= 0 || originalW > 500 || originalD > 500 || !Number.isInteger(floors) || floors < 0 || floors > 7) {
      return incomplete("지하 외곽 치수 또는 층수가 유효하지 않아 주차 구획을 생성하지 않았습니다.", "invalid-input");
    }
    if (!floors) return incomplete("지하층이 없어 자주식 지하 주차 구획을 생성하지 않았습니다.", "no-basement");
    const rotated = originalW > originalD, W = rotated ? originalD : originalW, D = rotated ? originalW : originalD;
    let mirrored = rotated && input.coreType === "north";
    const wall = .5, rampW = 6, separator = .4, aisleW = 6, stallD = 5.2;
    const floorHeight = finite(input.floorHeightM) && input.floorHeightM >= 2.6 && input.floorHeightM <= 5 ? input.floorHeightM : 3.3;
    // Two 3m half-slope transitions add 3m to the full-slope equivalent.
    const slope = .15, transition = 3, rampRun = floorHeight / slope + transition, landing = 6;
    result.dimensions = { widthM: originalW, depthM: originalD, floorHeightM: floorHeight, rampRunM: rampRun, rampWidthM: rampW, rampSlopePct: 15, aisleWidthM: aisleW, rotated, mirrored };
    result.assumptions[2] = `각 지하층에 폭 6m의 2차로 직선 램프와 6m 양단 랜딩, 평탄 우회 차로를 남겼습니다. 층고 ${floorHeight}m·최대 15%·양단 3m씩 절반 경사 완화구간을 가정합니다. 지상 진입 위치·단면 유효높이·차량 회전 궤적은 미검증입니다.`;
    const minX = wall, maxX = W - wall, minZ = wall, maxZ = D - wall;
    const rampRight = minX + rampW, bypassLeft = rampRight + separator, parkingLeft = bypassLeft + aisleW;
    if (maxZ - minZ < rampRun + 2 * landing - EPS || maxX - parkingLeft < 3.3 - EPS) {
      return incomplete(`폭 6m 2차로 램프·양단 랜딩(길이 ${(rampRun + 12).toFixed(1)}m)과 차로·구획이 함께 들어가지 않아 이 템플릿의 배치를 완료하지 못했습니다. 기계식·분리 진출입·램프 대안은 별도 검토해야 합니다.`, "ramp-envelope");
    }
    const bounds = rect(0, W, 0, D), cw = finite(input.coreWidthM) ? Math.max(4, input.coreWidthM) : 8, cd = finite(input.coreDepthM) ? Math.max(4, input.coreDepthM) : 8;
    // In the shared app, north is the negative-Z side. Preserve world-side
    // placement when rotating the parking module to use the longer dimension.
    let originalCores;
    if (input.coreRects !== undefined) {
      if (!Array.isArray(input.coreRects) || input.coreRects.length > 32 || input.coreRects.some(r => !r || ![r.minX, r.maxX, r.minZ, r.maxZ].every(finite) || width(r) <= EPS || depth(r) <= EPS)) {
        return incomplete("공통 코어의 좌표 형식을 확인할 수 없어 주차 배치를 적용하지 않았습니다.", "invalid-core");
      }
      const worldBounds = rect(-originalW / 2, originalW / 2, -originalD / 2, originalD / 2);
      if (input.coreRects.some(r => !inside(r, worldBounds))) return incomplete("입력 공통 코어가 지하 외곽 밖에 있어 주차 배치를 완료하지 못했습니다. 코어를 이동하거나 축소하지 않았습니다.", "core-outside");
      originalCores = input.coreRects.map((r, index) => rect(r.minX + originalW / 2, r.maxX + originalW / 2, r.minZ + originalD / 2, r.maxZ + originalD / 2,
        { id: typeof r.id === "string" && /^[A-Za-z0-9_.:-]{1,100}$/.test(r.id) ? r.id : "core-shared-" + index }));
      result.coreSource = "shared";
      result.assumptions[4] = "입력된 공통 코어의 외곽과 위치를 지하 평면에 그대로 예약합니다. 주차구획·차로·램프를 위해 코어를 이동하거나 크기를 바꾸지 않습니다. 구조·설비·피난 적합성은 별도 확인 대상입니다.";
      if (!originalCores.length) result.warnings.push("공통 코어가 빈 배열로 입력되어 코어 면적을 예약하지 않았습니다. 수직 코어 계획을 별도 확인해야 합니다.");
    } else {
      originalCores = input.coreType === "split"
        ? [rect(wall, wall + cw / 2, originalD / 2 - cd / 2, originalD / 2 + cd / 2), rect(originalW - wall - cw / 2, originalW - wall, originalD / 2 - cd / 2, originalD / 2 + cd / 2)]
        : [rect(originalW / 2 - cw / 2, originalW / 2 + cw / 2, input.coreType === "north" ? wall : originalD / 2 - cd / 2, input.coreType === "north" ? wall + cd : originalD / 2 + cd / 2)];
      result.coreSource = "legacy-assumption";
    }
    const normalizedCores = originalCores.map((r, index) => {
      const normalized = rotated ? rect(r.minZ, r.maxZ, r.minX, r.maxX) : r;
      return { ...normalized, id: r.id || "core-" + index, type: "core" };
    });
    let cores, ramps, baseAisles, rampOffset = 0;
    const maxRampOffset = maxZ - minZ - rampRun - 2 * landing;
    // Search the same straight-ramp template at either perimeter and a small
    // bounded set of longitudinal positions. Only circulation is relocated;
    // reflecting into/out of module coordinates preserves every supplied core.
    const offsets = [...new Set([0, maxRampOffset, maxRampOffset / 2, maxRampOffset / 4, maxRampOffset * .75].map(v => Math.max(0, v)))];
    searchCirculation: for (const mirror of [mirrored, !mirrored]) for (const offset of offsets) {
      const candidates = normalizedCores.map(r => ({ ...r, ...(mirror ? rect(W - r.maxX, W - r.minX, r.minZ, r.maxZ) : {}) }));
      const paths = [rect(minX, rampRight, minZ + offset + landing, minZ + offset + landing + rampRun, { id: "ramp", type: "ramp", widthM: rampW, slopePct: 15, riseM: floorHeight, transitionM: transition, drivingAxis: "z" })];
      const aisles = [rect(minX, parkingLeft, minZ + offset, minZ + offset + landing, { id: "landing-front", type: "landing", drivingAxis: "x" }), rect(minX, parkingLeft, minZ + offset + landing + rampRun, minZ + offset + 2 * landing + rampRun, { id: "landing-back", type: "landing", drivingAxis: "x" }), rect(bypassLeft, parkingLeft, minZ, maxZ, { id: "bypass", type: "aisle", drivingAxis: "z" })];
      if (candidates.some(c => !inside(c, bounds) || [...paths, ...aisles].some(a => overlap(a, c)))) continue;
      cores = candidates; ramps = paths; baseAisles = aisles; mirrored = mirror; rampOffset = offset; break searchCirculation;
    }
    if (!cores) return incomplete("입력 코어가 필수 램프·랜딩·우회 차로와 충돌하여 이 템플릿의 배치를 완료하지 못했습니다. 공통 코어를 이동하거나 축소하지 않았으며 다른 진입 계획을 검토해야 합니다.", "core-circulation");
    result.dimensions.mirrored = mirrored; result.dimensions.rampOffsetM = rampOffset;
    if (rampOffset > EPS || mirrored !== (rotated && input.coreType === "north")) result.warnings.push("코어 위치를 유지하고 반대편 외곽 또는 종방향 후보에서 램프를 선택했습니다. 지상 진입로와의 접속은 확인 전입니다.");
    let best = null;
    // Move the module grid rather than letting an obstructed aisle split into unreachable fragments.
    for (const offset of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      const aisles = baseAisles.map(a => ({ ...a })), columns = [], spaces = [];
      let accessibleRemaining = Math.max(1, Math.ceil((W * D / 34) * .03), finite(input.disabledTargetCount) ? Math.ceil(Math.max(0, input.disabledTargetCount) / floors) : 0);
      for (let row = 0, z = minZ + stallD + offset; z + aisleW <= maxZ + EPS; row++, z += 2 * stallD + aisleW + .6) {
        const aisle = rect(parkingLeft, maxX, z, z + aisleW, { id: "aisle-" + row, type: "aisle", drivingAxis: "x" });
        if (cores.some(core => overlap(aisle, core))) continue;
        aisles.push(aisle);
        for (const side of [-1, 1]) {
          const z0 = side < 0 ? z - stallD : z + aisleW, z1 = side < 0 ? z : z + aisleW + stallD;
          if (z0 < minZ - EPS || z1 > maxZ + EPS) continue;
          let n = 0;
          for (let x = parkingLeft; x + 2.6 <= maxX + EPS;) {
            const accessible = accessibleRemaining > 0, bayW = accessible ? 3.3 : 2.6;
            const space = rect(x, x + bayW, z0, z1, { id: "P" + (spaces.length + 1), type: accessible ? "accessible_reserved" : "expanded", aisleId: aisle.id, orientation: "z", evReserved: false });
            if (space.maxX > maxX + EPS) break;
            if (!cores.some(core => overlap(space, core))) { spaces.push(space); if (accessible) accessibleRemaining--; }
            x += bayW; n++;
            if (n % 3 === 0 && x + .6 <= maxX + EPS) {
              // Reserve the entire 0.6m inter-bay strip; the column sits at its rear.
              const backZ = side < 0 ? z0 : z1 - .6;
              const column = rect(x, x + .6, backZ, backZ + .6, { id: "column-" + columns.length, type: "column" });
              if (!cores.some(core => overlap(column, core))) columns.push(column);
              x += .6;
            }
          }
        }
      }
      const draft = { level: -1, bounds, spaces, aisles, ramps, cores, columns };
      draft.validation = validate(draft);
      if (draft.validation.valid && (!best || spaces.length > best.spaces.length)) best = draft;
    }
    if (!best || !best.spaces.length) return incomplete("코어·차로·램프를 피하면서 접근 가능한 주차구획을 만들 수 없어 이 템플릿의 배치를 완료하지 못했습니다.", "stall-layout");
    function transform(r) {
      const aligned = mirrored ? rect(W - r.maxX, W - r.minX, r.minZ, r.maxZ) : r;
      const moved = rotated ? rect(aligned.minZ - originalW / 2, aligned.maxZ - originalW / 2, aligned.minX - originalD / 2, aligned.maxX - originalD / 2) : rect(aligned.minX - originalW / 2, aligned.maxX - originalW / 2, aligned.minZ - originalD / 2, aligned.maxZ - originalD / 2);
      return { ...r, ...moved, ...(r.orientation ? { orientation: rotated ? "x" : "z" } : {}), ...(r.drivingAxis ? { drivingAxis: rotated ? (r.drivingAxis === "x" ? "z" : "x") : r.drivingAxis } : {}) };
    }
    for (let index = 0; index < floors; index++) {
      const level = { level: -index - 1, bounds: transform(best.bounds), spaces: best.spaces.map(transform), aisles: best.aisles.map(transform), ramps: best.ramps.map(transform), cores: best.cores.map(transform), columns: best.columns.map(transform) };
      level.validation = validate(level); result.levels.push(level);
    }
    if (result.levels.some(level => !level.validation.valid)) return incomplete("좌표 변환 후 주차 기하 검증을 통과하지 못해 배치를 적용하지 않았습니다.", "transformed-layout");
    result.perFloorCount = best.spaces.length; result.capacityCount = result.perFloorCount * floors;
    const allSpaces = result.levels.flatMap(level => level.spaces), evTarget = finite(input.evTargetCount) ? Math.max(0, Math.ceil(input.evTargetCount)) : (result.capacityCount >= 50 ? Math.ceil(result.capacityCount * .05) : 0);
    allSpaces.filter(space => space.type !== "accessible_reserved").slice(0, evTarget).forEach(space => { space.evReserved = true; });
    result.reserved = { accessibleCount: allSpaces.filter(space => space.type === "accessible_reserved").length, evCount: allSpaces.filter(space => space.evReserved).length, evTargetCount: evTarget };
    if (finite(input.disabledTargetCount) && result.reserved.accessibleCount < input.disabledTargetCount) result.warnings.push("장애인 예정 구획을 요청 수량만큼 확보하지 못했습니다.");
    if (result.reserved.evCount < evTarget) result.warnings.push("전기차 예정 구획을 요청 수량만큼 예약하지 못했습니다.");
    result.status = "generated"; result.statusLabel = "배치 생성"; result.massFitEligible = true;
    result.validation = { valid: true, capacityVerified: false, massFitEligible: true, sweptPathVerified: false, accessibilityRouteVerified: false, actualParcelVerified: false };
    result.warnings.push("사각 경계·구획·코어·기둥 충돌과 램프까지의 차로 연결만 검증했습니다. 차량 회전 궤적·경사로 단면·기계실·구조 및 실제 법적 적합성은 확인 전입니다.");
    return result;
  }
  function fromModel(model = {}, inputs = {}) {
    const area = model.areas?.basementPlateSqm, siteW = model.siteWidthM, siteD = model.siteDepthM;
    const scale = finite(area) && finite(siteW) && finite(siteD) && area > 0 && siteW > 0 && siteD > 0 ? Math.sqrt(area / (siteW * siteD)) : 0;
    const basement = model.basementPlacement;
    const centerX = basement?.centerX === undefined ? 0 : basement.centerX, centerZ = basement?.centerZ === undefined ? 0 : basement.centerZ;
    let coreRects = inputs.coreRects;
    if (coreRects === undefined && model.coreLayout) {
      coreRects = Array.isArray(model.coreLayout.cores) ? model.coreLayout.cores.map(core => core && typeof core === "object" ? ({ ...core,
        minX: core.minX - centerX, maxX: core.maxX - centerX,
        minZ: core.minZ - centerZ, maxZ: core.maxZ - centerZ }) : core) : null;
    }
    const result = generate({ widthM: basement ? basement.widthM : siteW * scale, depthM: basement ? basement.depthM : siteD * scale,
      floorsBelow: Math.max(0, Number(inputs.floorsBelow) || 0), coreType: inputs.coreType, floorHeightM: 3.5,
      ...(coreRects !== undefined ? { coreRects } : {}) });
    if (model.coreLayout?.status === "unfeasible") {
      const message = "공통 수직 코어 계획이 미완료여서 이 주차 초안을 매스 자동 조정의 수용량으로 적용하지 않습니다.";
      result.massFitEligible = false; result.status = "incomplete"; result.statusLabel = "배치 미완료";
      result.failureReason ||= "shared-core-unfeasible";
      result.validation = { ...result.validation, geometryValid: result.validation.valid, valid: false, massFitEligible: false,
        errors: [...(result.validation.errors || []), message] };
      result.warnings.push(message);
    }
    return result;
  }
  return Object.freeze({ checkedAt, sources: [source], generate, fromModel, validate, overlap, contact });
});
