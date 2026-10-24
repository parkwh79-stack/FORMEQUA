/* Original JS office planning heuristic, inspired by separately reviewed
 * HyparSpace desk/grid/aisle/per-room-setting principles. No Hypar code, assets,
 * packages or runtime are embedded or executed. See docs/research-hyparspace.md.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AtelierOfficeLayout = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  const EPS = 1e-6, round = n => Math.round(n * 1e6) / 1e6;
  const finite = n => typeof n === "number" && Number.isFinite(n);
  const rect = (minX, maxX, minZ, maxZ, extra) => ({ minX: round(minX), maxX: round(maxX), minZ: round(minZ), maxZ: round(maxZ), ...extra });
  const width = r => r.maxX - r.minX, depth = r => r.maxZ - r.minZ, area = r => width(r) * depth(r);
  const valid = r => r && [r.minX, r.maxX, r.minZ, r.maxZ].every(finite) && width(r) > EPS && depth(r) > EPS;
  const overlap = (a, b) => a.minX < b.maxX - EPS && a.maxX > b.minX + EPS && a.minZ < b.maxZ - EPS && a.maxZ > b.minZ + EPS;
  const inside = (a, b) => a.minX >= b.minX - EPS && a.maxX <= b.maxX + EPS && a.minZ >= b.minZ - EPS && a.maxZ <= b.maxZ + EPS;
  const contact = (a, b) => {
    const x = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX), z = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
    return x > EPS && z >= -EPS || z > EPS && x >= -EPS;
  };
  const inflate = (r, n) => rect(r.minX - n, r.maxX + n, r.minZ - n, r.maxZ + n);
  const intersection = (a, b) => {
    const r = { ...a, ...rect(Math.max(a.minX, b.minX), Math.min(a.maxX, b.maxX), Math.max(a.minZ, b.minZ), Math.min(a.maxZ, b.maxZ)) };
    return valid(r) ? r : null;
  };
  const fail = message => { throw new Error("Office layout: " + message); };
  function settings(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) fail("settings must be an object.");
    const result = {};
    for (const [key, def, min, max] of [["deskWidthM", 1.4, 1.2, 2], ["deskDepthM", .7, .6, 1],
      ["aisleWidthM", 1.2, .9, 2.4], ["rowGapM", .9, .7, 2], ["backClearanceM", .9, .6, 1.8],
      ["collaborationPct", 0, 0, 40], ["targetSeats", 0, 0, 1000]]) {
      const value = input[key] === undefined ? def : input[key];
      if (!finite(value) || value < min || value > max || key === "targetSeats" && !Number.isInteger(value)) fail(key + " is out of range.");
      result[key] = value;
    }
    result.deskType = input.deskType === undefined ? "single" : input.deskType;
    if (!["single", "back-to-back", "bench", "standing"].includes(result.deskType)) fail("unsupported deskType.");
    result.orientation = input.orientation === undefined ? "auto" : input.orientation;
    if (["0", "90"].includes(result.orientation)) result.orientation = Number(result.orientation);
    if (!["auto", 0, 90].includes(result.orientation)) fail("orientation must be auto, 0 or 90.");
    return result;
  }
  function roomBounds(room) {
    if (!valid(room) || typeof room.id !== "string" || !room.id || room.id.length > 120 || width(room) > 200 || depth(room) > 200) fail("a room id and finite rectangular bounds up to 200m are required.");
    return rect(room.minX + .25, room.maxX - .25, room.minZ + .25, room.maxZ - .25);
  }
  function obstaclesFor(room, obstacles, warnings) {
    if (!Array.isArray(obstacles) || obstacles.length > 200) fail("at most 200 explicit obstacles are supported.");
    const selected = [];
    for (let i = 0; i < obstacles.length; i++) {
      const r = obstacles[i];
      if (r?.roomId !== undefined && r.roomId !== room.id) continue;
      if (!valid(r)) fail("explicit obstacle bounds must be finite and positive.");
      if (r.referenceOnly === true || r.isReference === true || r.confirmed === false || r.source === "reference") {
        warnings.push("참고·미확인 기둥 표시는 실제 장애물로 자동 적용하지 않았습니다. 확인된 좌표 또는 명시적 설계 장애물을 입력하세요."); continue;
      }
      if (overlap(r, room)) selected.push({ ...rect(r.minX, r.maxX, r.minZ, r.maxZ), id: r.id || "obstacle-" + i, kind: r.kind || "explicit-planning-obstacle" });
    }
    return selected;
  }
  function doorsFor(room, doors, bounds, warnings) {
    if (!Array.isArray(doors) || doors.length > 200) fail("at most 200 doors are supported.");
    const selected = [];
    doors.forEach((d, index) => {
      if (d?.roomId !== undefined && d.roomId !== room.id) return;
      if (!d || ![d.x, d.z, d.width].every(finite) || d.width <= 0 || !["x", "z"].includes(d.axis)) fail("door coordinates, width and axis are required.");
      const low = d.axis === "x" ? Math.abs(d.z - room.minZ) <= .05 : Math.abs(d.x - room.minX) <= .05;
      const high = d.axis === "x" ? Math.abs(d.z - room.maxZ) <= .05 : Math.abs(d.x - room.maxX) <= .05;
      const along = d.axis === "x" ? d.x : d.z, lo = d.axis === "x" ? room.minX : room.minZ, hi = d.axis === "x" ? room.maxX : room.maxZ;
      if ((!low && !high) || along - d.width / 2 < lo - EPS || along + d.width / 2 > hi + EPS) {
        if (d.roomId === room.id) warnings.push("실 경계에 맞지 않는 문 좌표의 출입 연결은 확인하지 못했습니다."); return;
      }
      const half = d.width / 2 + .25, reach = 1.35;
      const clearance = d.axis === "x" ? rect(d.x - half, d.x + half, low ? d.z : d.z - reach, low ? d.z + reach : d.z)
        : rect(low ? d.x : d.x - reach, low ? d.x + reach : d.x, d.z - half, d.z + half);
      const clipped = intersection(clearance, bounds);
      if (clipped) selected.push({ id: d.id || room.id + "-door-" + index, x: d.x, z: d.z, axis: d.axis, clearance: clipped });
    });
    return selected;
  }
  function subtract(source, obstacle) {
    if (!overlap(source, obstacle)) return [source];
    const hit = intersection(source, obstacle), copy = (x0, x1, z0, z1) => ({ ...source, ...rect(x0, x1, z0, z1) });
    return [copy(source.minX, hit.minX, source.minZ, source.maxZ), copy(hit.maxX, source.maxX, source.minZ, source.maxZ),
      copy(hit.minX, hit.maxX, source.minZ, hit.minZ), copy(hit.minX, hit.maxX, hit.maxZ, source.maxZ)].filter(valid);
  }
  function unionArea(rectangles) {
    const xs = [...new Set(rectangles.flatMap(r => [r.minX, r.maxX]))].sort((a, b) => a - b);
    let total = 0;
    for (let i = 0; i + 1 < xs.length; i++) {
      const x = (xs[i] + xs[i + 1]) / 2, intervals = rectangles.filter(r => r.minX < x && r.maxX > x).map(r => [r.minZ, r.maxZ]).sort((a, b) => a[0] - b[0]);
      let length = 0, lo = null, hi = null;
      for (const [a, b] of intervals) { if (lo === null) { lo = a; hi = b; } else if (a > hi) { length += hi - lo; lo = a; hi = b; } else hi = Math.max(hi, b); }
      if (lo !== null) length += hi - lo;
      total += (xs[i + 1] - xs[i]) * length;
    }
    return round(total);
  }
  function connected(aisles, doors, blockers, minimumWidth) {
    const starts = [];
    for (const d of doors) if (!blockers.some(r => overlap(r, d.clearance))) aisles.forEach((a, i) => { if (contact(a, d.clearance)) starts.push(i); });
    if (!doors.length && aisles.length) starts.push(0);
    const reached = new Set(starts), queue = [...reached];
    const routeContact = (a, b) => {
      const x = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX), z = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
      return x >= minimumWidth - EPS && z >= -EPS || z >= minimumWidth - EPS && x >= -EPS;
    };
    for (let n = 0; n < queue.length; n++) aisles.forEach((aisle, i) => { if (!reached.has(i) && routeContact(aisles[queue[n]], aisle)) { reached.add(i); queue.push(i); } });
    return aisles.filter((_, i) => reached.has(i));
  }
  function candidate(room, bounds, s, obstacles, doors, orientation, variant) {
    const rotated = orientation === 90, toWorld = (u, v) => rotated ? [v, -u] : [u, v];
    const fromWorld = r => rotated ? rect(-r.maxZ, -r.minZ, r.minX, r.maxX) : r;
    const worldRect = r => { const p = toWorld(r.minX, r.minZ), q = toWorld(r.maxX, r.maxZ); return rect(Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[1], q[1])); };
    const uv = fromWorld(bounds), aw = s.aisleWidthM, gap = Math.max(s.rowGapM, aw), moduleD = s.deskDepthM + s.backClearanceM;
    const pair = s.deskType === "back-to-back" || s.deskType === "bench", colsPerGroup = s.deskType === "bench" ? 2 : 1;
    const groupW = s.deskWidthM * colsPerGroup, groupD = moduleD * (pair ? 2 : 1);
    const work = rect(uv.minX + (variant & 1 ? 0 : aw), uv.maxX - (variant & 1 ? aw : 0), uv.minZ + (variant & 2 ? 0 : aw), uv.maxZ - (variant & 2 ? aw : 0));
    const cols = Math.max(0, Math.floor((width(work) + aw) / (groupW + aw))), rows = Math.max(0, Math.floor((depth(work) + gap) / (groupD + gap)));
    const usedW = cols * groupW + Math.max(0, cols - 1) * aw, usedD = rows * groupD + Math.max(0, rows - 1) * gap;
    const startU = variant & 1 ? work.maxX - usedW : work.minX, startV = variant & 2 ? work.maxZ - usedD : work.minZ;
    const spineU = variant & 1 ? uv.maxX - aw / 2 : uv.minX + aw / 2;
    const spineV = variant & 2 ? uv.maxZ - aw / 2 : uv.minZ + aw / 2;
    const raw = [worldRect(rect(spineU - aw / 2, spineU + aw / 2, uv.minZ, uv.maxZ)), worldRect(rect(uv.minX, uv.maxX, spineV - aw / 2, spineV + aw / 2))], gridAisles = [];
    for (let col = 1; col < cols; col++) gridAisles.push(worldRect(rect(startU + col * groupW + (col - 1) * aw, startU + col * (groupW + aw), uv.minZ, uv.maxZ)));
    for (let row = 1; row < rows; row++) gridAisles.push(worldRect(rect(uv.minX, uv.maxX, startV + row * groupD + (row - 1) * gap, startV + row * (groupD + gap))));
    // A direct connector is a conservative routing candidate. An obstacle can
    // invalidate it; this is not an arbitrary-path or evacuation optimizer.
    for (const d of doors) {
      const cx = (d.clearance.minX + d.clearance.maxX) / 2, cz = (d.clearance.minZ + d.clearance.maxZ) / 2;
      const rawPoint = rotated ? [-cz, cx] : [cx, cz];
      const q = [Math.max(uv.minX + aw / 2, Math.min(uv.maxX - aw / 2, rawPoint[0])), Math.max(uv.minZ + aw / 2, Math.min(uv.maxZ - aw / 2, rawPoint[1]))];
      raw.push(worldRect(rect(Math.min(q[0], spineU) - aw / 2, Math.max(q[0], spineU) + aw / 2, q[1] - aw / 2, q[1] + aw / 2)));
      raw.push(worldRect(rect(spineU - aw / 2, spineU + aw / 2, Math.min(q[1], spineV), Math.max(q[1], spineV) + aw)));
      raw.push(d.clearance);
    }
    const blockers = obstacles.map(r => inflate(r, .1));
    const clipAisles = (rectangles, exclusions) => {
      let clipped = rectangles.map(r => intersection(r, bounds)).filter(Boolean);
      for (const b of exclusions) clipped = clipped.flatMap(a => subtract(a, b));
      return clipped.filter(a => Math.min(width(a), depth(a)) >= aw - EPS);
    };
    const primaryAisles = clipAisles(raw, blockers), primaryReachable = connected(primaryAisles, doors, blockers, aw);
    const clear = r => inside(r, bounds) && ![...blockers, ...doors.map(d => d.clearance)].some(b => overlap(r, b));
    const collab = [], tile = 2.8, desiredCollabArea = area(bounds) * s.collaborationPct / 100;
    const wantedZones = Math.ceil((desiredCollabArea - EPS) / (tile * tile));
    if (wantedZones > 0) {
      const proposals = [];
      const tileStarts = (lo, hi) => {
        if (hi - lo < tile - EPS) return [lo];
        const values = [];
        for (let p = lo; p <= hi - tile + EPS; p += tile) values.push(p);
        values.push(hi - tile); return values;
      };
      // Reserve collaboration against primary routes before secondary grid
      // routes. A full desk lattice would otherwise prevent larger shared areas.
      for (const a of primaryReachable) {
        for (const z of tileStarts(a.minZ, a.maxZ)) proposals.push(rect(a.minX - tile, a.minX, z, z + tile), rect(a.maxX, a.maxX + tile, z, z + tile));
        for (const x of tileStarts(a.minX, a.maxX)) proposals.push(rect(x, x + tile, a.minZ - tile, a.minZ), rect(x, x + tile, a.maxZ, a.maxZ + tile));
      }
      const unique = new Map(proposals.map(r => [JSON.stringify(r), r]));
      const distance = r => doors.length ? Math.min(...doors.map(d => Math.hypot((r.minX + r.maxX) / 2 - d.x, (r.minZ + r.maxZ) / 2 - d.z))) : Math.hypot((r.minX + r.maxX) / 2 - bounds.minX, (r.minZ + r.maxZ) / 2 - bounds.minZ);
      for (const r of [...unique.values()].sort((a, b) => distance(b) - distance(a) || a.minZ - b.minZ || a.minX - b.minX)) {
        if (collab.length >= wantedZones) break;
        if (clear(r) && primaryReachable.some(a => contact(r, a)) && !primaryAisles.some(a => overlap(r, a)) && !collab.some(c => overlap(r, c))) collab.push({ ...r, id: room.id + "-collaboration-" + (collab.length + 1) });
      }
    }
    const aisles = primaryAisles.concat(clipAisles(gridAisles, blockers.concat(collab)))
      .map((r, i) => ({ ...r, id: room.id + "-aisle-" + i }));
    const reachable = connected(aisles, doors, blockers, aw), access = r => reachable.some(a => contact(r, a));
    const stations = [];
    function seat(u, v, mirrored, clusterId, groupEnvelope) {
      const local = rect(u, u + s.deskWidthM, v, v + moduleD), envelope = worldRect(local);
      const id = room.id + "-W" + (stations.length + 1), deskV = mirrored ? v + moduleD - s.deskDepthM / 2 : v + s.deskDepthM / 2;
      const chairV = mirrored ? v + s.backClearanceM - .35 : v + s.deskDepthM + .35;
      const make = (type, centerV, w, d, h) => {
        const p = toWorld(u + s.deskWidthM / 2, centerV);
        return { type, x: round(p[0]), z: round(p[1]), width: rotated ? d : w, depth: rotated ? w : d, height: h,
          rotationY: 0, roomId: room.id, workstationId: id };
      };
      const desk = make("desk", deskV, s.deskWidthM, s.deskDepthM, s.deskType === "standing" ? 1.05 : .74);
      const chair = make("chair", chairV, .5, .5, s.deskType === "standing" ? .95 : .8);
      stations.push({ id, roomId: room.id, deskType: s.deskType, orientationDeg: orientation, facingReversed: mirrored,
        clusterId, envelope, groupEnvelope, desk, chair, entryConnected: doors.length ? true : null, accessBasis: "connected-group-envelope" });
    }
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const u = startU + col * (groupW + aw), v = startV + row * (groupD + gap), clusterId = room.id + "-cluster-" + row + "-" + col;
      const cluster = worldRect(rect(u, u + groupW, v, v + groupD));
      if (!clear(cluster) || !access(cluster) || aisles.some(a => overlap(a, cluster)) || collab.some(c => overlap(c, cluster))) continue;
      for (let k = 0; k < colsPerGroup; k++) {
        seat(u + k * s.deskWidthM, v, pair, clusterId, cluster);
        if (pair) seat(u + k * s.deskWidthM, v + moduleD, false, clusterId, cluster);
      }
    }
    return { stations, aisles, collab, orientation, desiredCollabArea, collaborationAreaSqm: round(collab.reduce((n, r) => n + area(r), 0)),
      entryConnectivityChecked: doors.length > 0, reachableAisles: reachable.length };
  }
  function collaborationFurniture(roomId, zones) {
    const pieces = [];
    for (const zone of zones) {
      const x = (zone.minX + zone.maxX) / 2, z = (zone.minZ + zone.maxZ) / 2;
      const make = (type, x, z, w, d, h) => ({ type, x: round(x), z: round(z), width: w, depth: d, height: h, rotationY: 0, roomId, collaborationId: zone.id });
      pieces.push(make("table", x, z, 1.2, .7, .74));
      for (const [dx, dz] of [[-.95, 0], [.95, 0], [0, -.75], [0, .75]]) pieces.push(make("chair", x + dx, z + dz, .5, .5, .8));
    }
    return pieces;
  }
  function trim(result, count, target) {
    const workstations = result.workstations.slice(0, count), retained = new Set(workstations.map(w => w.id));
    return { ...result, workstations, furniture: result.furniture.filter(f => !f.workstationId || retained.has(f.workstationId)),
      metrics: { ...result.metrics, workstationCount: workstations.length, deskCount: workstations.length,
        targetSeats: target, targetDeficit: Math.max(0, target - workstations.length) } };
  }
  function layoutRoom(room, input = {}) {
    const bounds = roomBounds(room), s = settings(input), warnings = [], obstacles = obstaclesFor(room, input.obstacles || [], warnings);
    const doors = doorsFor(room, input.doors || [], bounds, warnings), candidates = [];
    if (valid(bounds)) for (const angle of s.orientation === "auto" ? [0, 90] : [s.orientation]) for (let variant = 0; variant < 4; variant++) candidates.push(candidate(room, bounds, s, obstacles, doors, angle, variant));
    const deficitArea = c => Math.max(0, c.desiredCollabArea - c.collaborationAreaSqm);
    candidates.sort((a, b) => deficitArea(a) - deficitArea(b) || b.stations.length - a.stations.length || a.orientation - b.orientation);
    const best = candidates[0] || { stations: [], aisles: [], collab: [], collaborationAreaSqm: 0, desiredCollabArea: 0, orientation: s.orientation === 90 ? 90 : 0, entryConnectivityChecked: false, reachableAisles: 0 };
    if (!doors.length) warnings.push("출입문이 없어 책상 배치와 내부 통로만 검토했습니다. 실제 출입 연결은 미확인입니다.");
    if (!best.stations.length) warnings.push("통로·문 여유·명시적 장애물을 피하면서 책상과 의자를 함께 담는 업무 모듈을 확보하지 못했습니다.");
    if (deficitArea(best) > .01) warnings.push("요청한 협업 공간 비중을 모두 확보하지 못했습니다. 실제 예약 면적과 부족 면적을 확인하세요.");
    const furniture = best.stations.flatMap(w => [w.desk, w.chair]).concat(collaborationFurniture(room.id, best.collab));
    let result = { roomId: room.id, status: best.stations.length ? "generated" : "unfeasible", settings: s, bounds, orientationDeg: best.orientation,
      workstations: best.stations, furniture, aisles: best.aisles, collaboration: best.collab, obstacles,
      doorClearances: doors.map(d => ({ ...d.clearance, id: d.id })),
      metrics: { workstationCount: best.stations.length, deskCount: best.stations.length, capacityBeforeTarget: best.stations.length,
        targetSeats: s.targetSeats, targetDeficit: Math.max(0, s.targetSeats - best.stations.length), collaborationSeatCount: best.collab.length * 4,
        collaborationAreaSqm: best.collaborationAreaSqm, requestedCollaborationAreaSqm: round(best.desiredCollabArea),
        collaborationDeficitSqm: round(deficitArea(best)), achievedCollaborationPct: valid(bounds) ? round(best.collaborationAreaSqm / area(bounds) * 100) : 0,
        aisleAreaSqm: unionArea(best.aisles) },
      validation: { boundsChecked: true, explicitObstacleCollisionChecked: true, doorClearanceChecked: doors.length > 0,
        rectangularAisleConnectivityChecked: best.entryConnectivityChecked, obstacleSource: "explicit-input-only", vehicleOrWheelchairSweptPathChecked: false,
        evacuationComplianceVerified: false, structuralColumnsVerified: false }, warnings, isPermitConfirmation: false };
    if (s.targetSeats > 0) result = trim(result, s.targetSeats, s.targetSeats);
    if (result.metrics.targetDeficit) result.warnings.push("목표 업무 좌석 " + s.targetSeats + "석 중 " + result.metrics.targetDeficit + "석을 확보하지 못했습니다.");
    if (result.metrics.targetDeficit || result.metrics.collaborationDeficitSqm > .01) result.status = result.workstations.length ? "partial" : "unfeasible";
    return result;
  }
  function generate(input = {}) {
    if (!Array.isArray(input.rooms) || input.rooms.length > 100) fail("rooms must be an array of at most 100 office rooms.");
    const options = settings(input.options || {}), requirementInput = input.roomRequirements || {}, requirements = Object.create(null), ids = new Set();
    if (typeof requirementInput !== "object" || Array.isArray(requirementInput)) fail("roomRequirements must be an object keyed by room id.");
    if (Object.keys(requirementInput).length > 128) fail("at most 128 room requirements are supported.");
    for (const [id, value] of Object.entries(requirementInput)) {
      if (!id || id.length > 120 || !value || typeof value !== "object" || Array.isArray(value)) fail("each room requirement must be an object with a room id.");
      settings({ ...options, ...value }); requirements[id] = value;
    }
    const results = input.rooms.map(room => {
      roomBounds(room);
      if (ids.has(room.id)) fail("room ids must not repeat."); ids.add(room.id);
      return layoutRoom(room, { ...options, ...requirements[room.id], targetSeats: 0, doors: input.doors || [], obstacles: input.obstacles || [] });
    });
    const allocation = results.map(r => r.workstations.length);
    const explicitTargets = results.map(r => requirements[r.roomId]?.targetSeats === undefined ? 0 : settings({ ...options, ...requirements[r.roomId] }).targetSeats), warnings = [];
    if (options.targetSeats > 0) {
      allocation.fill(0); let remaining = options.targetSeats;
      for (let i = 0; i < results.length; i++) { const desired = Math.min(results[i].workstations.length, explicitTargets[i], remaining); allocation[i] = desired; remaining -= desired; }
      for (let changed = true; remaining > 0 && changed;) {
        changed = false;
        for (let i = 0; i < results.length && remaining > 0; i++) {
          const limit = explicitTargets[i] || results[i].workstations.length;
          if (allocation[i] < Math.min(results[i].workstations.length, limit)) { allocation[i]++; remaining--; changed = true; }
        }
      }
      if (explicitTargets.reduce((a, b) => a + b, 0) > options.targetSeats) warnings.push("실별 목표 좌석 합계가 전체 목표를 초과합니다. 전체 상한을 유지하며 실별 부족 수량을 표시했습니다.");
    } else for (let i = 0; i < results.length; i++) if (explicitTargets[i] > 0) allocation[i] = Math.min(allocation[i], explicitTargets[i]);
    const rooms = results.map((result, i) => {
      const value = trim(result, allocation[i], explicitTargets[i]);
      if (value.metrics.targetDeficit) { value.status = value.workstations.length ? "partial" : "unfeasible"; value.warnings = [...value.warnings, "실별 목표 업무 좌석을 " + value.metrics.targetDeficit + "석 확보하지 못했습니다."]; }
      return value;
    });
    const total = key => round(rooms.reduce((sum, r) => sum + r.metrics[key], 0)), workstationCount = total("workstationCount");
    const targetDeficit = options.targetSeats > 0 ? Math.max(0, options.targetSeats - workstationCount) : 0;
    if (targetDeficit) warnings.push("전체 목표 업무 좌석을 " + targetDeficit + "석 확보하지 못했습니다.");
    return { version: "1.0.0", status: !workstationCount ? "unfeasible" : targetDeficit || rooms.some(r => r.status !== "generated") ? "partial" : "generated", rooms,
      furniture: rooms.flatMap(r => r.furniture), workstations: rooms.flatMap(r => r.workstations),
      metrics: { roomCount: rooms.length, workstationCount, deskCount: total("deskCount"), targetSeats: options.targetSeats, targetDeficit,
        collaborationSeatCount: total("collaborationSeatCount"), collaborationAreaSqm: total("collaborationAreaSqm"), collaborationDeficitSqm: total("collaborationDeficitSqm"), aisleAreaSqm: total("aisleAreaSqm") },
      warnings: [...new Set(warnings.concat(rooms.flatMap(r => r.warnings)))],
      provenance: { implementation: "original-javascript-heuristic", inspiration: "HyparSpace OpenOfficeLayout / LayoutStrategies principles",
        referenceCommit: "f277d1b9151b7414acaed3ecf82fa1f2c87b4e3f", upstreamEngineExecuted: false, upstreamCodeOrAssetsBundled: false },
      isOptimal: false, isPermitConfirmation: false };
  }
  return Object.freeze({ layoutRoom, generate, normalizeSettings: settings, version: "1.0.0" });
});
