/*
 * Deterministic, dependency-free schematic interior planning.
 *
 * Assumptions: a rectangular floor plate, metres, x/z world coordinates and
 * northShiftM applied to every z coordinate. This produces a REVIEW DRAFT,
 * not a permit drawing: structure, fire compartments, accessible routes,
 * daylight, services and Korean statutory requirements need professional
 * review. Room labels do not assert that the proposed use is legally allowed.
 * Original implementation. HyparSpace's separation of room planning and
 * workstation layout, and Elements' repeated-component model informed the
 * planning approach; no external source code or runtime is included.
 */
(function (root, factory) {
  "use strict";
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./core-layout.js') : root.AtelierCoreLayout,
    node ? require('./office-layout.js') : root.AtelierOfficeLayout,
    node ? require('./hotel-modules.js') : root.AtelierHotelModules,
    node ? require('./spatial-settings.js') : root.AtelierSpatialSettings);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AtelierInteriorPlan = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this), function (coreLayoutApi, officeApi, hotelApi, spatialApi) {
  "use strict";

  const EPS = 1e-6;
  const MIN_ROOM_SIDE = 2.35;
  const PROGRAMS = {
    main: [
      ["office", "업무 공간"], ["meeting", "회의실"],
      ["meeting_small", "미팅룸"], ["pantry", "탕비실"],
      ["office", "업무 공간"], ["office", "업무 공간"]
    ],
    hotel: [["guest_room", "스탠더드 객실"], ["guest_room", "스탠더드 객실"], ["guest_twin", "트윈 객실"]],
    residential: [
      ["living", "거실"], ["bedroom", "침실"],
      ["bathroom", "욕실"], ["kitchen", "주방"],
      ["bedroom", "침실"], ["bedroom", "침실"]
    ],
    retail: [
      ["showroom", "쇼룸"], ["consultation", "상담실"],
      ["storage", "창고"], ["showroom", "쇼룸"]
    ],
    amenity: [
      ["lounge", "라운지"], ["pantry", "탕비실"],
      ["meeting", "회의실"], ["lounge", "라운지"]
    ]
  };

  const round = value => Math.round(value * 1e6) / 1e6;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const rect = (minX, maxX, minZ, maxZ) => ({
    minX: round(minX), maxX: round(maxX), minZ: round(minZ), maxZ: round(maxZ)
  });
  const width = r => r.maxX - r.minX;
  const depth = r => r.maxZ - r.minZ;
  const area = r => width(r) * depth(r);
  const inside = (r, x, z) => x > r.minX - EPS && x < r.maxX + EPS && z > r.minZ - EPS && z < r.maxZ + EPS;
  const overlaps = (a, b, gap = 0) => a.minX < b.maxX + gap - EPS && a.maxX > b.minX - gap + EPS && a.minZ < b.maxZ + gap - EPS && a.maxZ > b.minZ - gap + EPS;
  const clip = (r, bounds) => rect(Math.max(r.minX, bounds.minX), Math.min(r.maxX, bounds.maxX), Math.max(r.minZ, bounds.minZ), Math.min(r.maxZ, bounds.maxZ));
  const validRect = r => width(r) > EPS && depth(r) > EPS;
  const uniqueSorted = values => [...new Set(values.map(round))].sort((a, b) => a - b);

  function blank(fp, bounds, warnings) {
    return {
      level: fp.level || 1, use: PROGRAMS[fp.use] ? fp.use : "main", bounds,
      status: "not-generated", reason: "not-generated", quantityStatus: "not-generated",
      rooms: [], corridors: [], cores: [], voids: [], walls: [], doors: [], furniture: [],
      entry: { x: 0, z: round((bounds.minZ + bounds.maxZ) / 2) }, warnings,
      assumptions: [],
      spaceProgram: "standard", residentialType: null, dwellingUnits: [],
      metrics: { roomCount: 0, netRoomAreaSqm: 0, doorCount: 0, furnitureCount: 0,
        deskCount: 0, workstationCount: 0, guestRoomCount: 0, guestBedCount: 0,
        dwellingUnitCount: 0, privateRoomCount: 0, sharedSpaceCount: 0,
        corridorAreaSqm: 0, coreAreaSqm: 0, guestRoomAreaSqm: 0, serviceAreaSqm: 0 }
    };
  }

  function reserveCores(fp, options, bounds, voids, warnings) {
    const shared = options.coreLayout !== undefined ? options.coreLayout : fp.coreLayout;
    if (shared !== undefined) {
      if (Array.isArray(shared?.warnings)) warnings.push(...shared.warnings.filter(message => typeof message === "string"));
      const check = coreLayoutApi?.validateForFloor(shared, fp);
      if (!check) { warnings.push("공통 수직 코어 검증 모듈을 불러오지 못했습니다. 층별 코어를 임의로 생성하지 않았습니다."); return []; }
      warnings.push(...check.warnings);
      return check.cores;
    }
    const profile = typeof options.circulationProfile === "string" ? options.circulationProfile : options.circulationProfile?.profile;
    if (profile === "compact") {
      const compact = coreLayoutApi?.planCore({ ...fp, coreType: options.coreType, option: options.option, circulationProfile: "compact" });
      if (!compact) { warnings.push("소규모 동선 예약 모듈이 없어 임의의 코어를 생성하지 않았습니다."); return []; }
      warnings.push(...compact.warnings);
      return compact.cores;
    }
    const w = width(bounds), d = depth(bounds), z = (bounds.minZ + bounds.maxZ) / 2;
    const requested = options.coreType === "split" ? "split" : (options.coreType === "north" || options.option === "C" ? "north" : "center");
    const desiredW = Math.min(6, Math.max(2.4, fp.widthM * 0.24), w * 0.46);
    const desiredD = Math.min(5.5, Math.max(2.4, fp.depthM * 0.24), d * 0.46);
    const cores = [];
    if (requested === "split") {
      let cw = Math.min(3.3, Math.max(1.8, fp.widthM * 0.12), w * 0.2);
      let cd = desiredD;
      if (voids.length) {
        cw = Math.min(cw, (w - width(voids[0])) / 2 - 0.15);
        cd = Math.min(cd, d - 0.2);
      }
      if (cw >= 1.6 && cd >= 1.8) {
        cores.push(rect(bounds.minX, bounds.minX + cw, z - cd / 2, z + cd / 2));
        cores.push(rect(bounds.maxX - cw, bounds.maxX, z - cd / 2, z + cd / 2));
      }
    } else if (requested === "north" || voids.length) {
      const availableD = voids.length ? voids[0].minZ - bounds.minZ - 0.15 : d;
      const cd = Math.min(desiredD, availableD);
      if (desiredW >= 1.8 && cd >= 1.8) {
        cores.push(rect(-desiredW / 2, desiredW / 2, bounds.minZ, bounds.minZ + cd));
        if (voids.length && requested === "center") {
          warnings.push("중정과 코어가 겹치지 않도록 코어를 북측으로 배치한 검토안입니다. 수직 코어 위치를 전 층에서 확인하세요.");
        }
      }
    } else if (desiredW >= 1.8 && desiredD >= 1.8) {
      cores.push(rect(-desiredW / 2, desiredW / 2, z - desiredD / 2, z + desiredD / 2));
    }
    if (!cores.length) warnings.push("이 층의 크기로는 코어와 중정을 함께 확보하기 어렵습니다. 코어·중정 치수 검토가 필요합니다.");
    return cores;
  }

  function circulation(bounds, obstacles, corridorWidth) {
    const z = (bounds.minZ + bounds.maxZ) / 2, c = corridorWidth;
    const paths = [
      rect(-c / 2, c / 2, bounds.minZ, bounds.maxZ),
      rect(bounds.minX, bounds.maxX, z - c / 2, z + c / 2)
    ];
    for (const o of obstacles) {
      // A ring links both sides of a core or atrium even when it interrupts
      // the cross-shaped main route. Later grid clipping removes intersections.
      paths.push(rect(o.minX - c, o.maxX + c, o.minZ - c, o.minZ));
      paths.push(rect(o.minX - c, o.maxX + c, o.maxZ, o.maxZ + c));
      paths.push(rect(o.minX - c, o.minX, o.minZ, o.maxZ));
      paths.push(rect(o.maxX, o.maxX + c, o.minZ, o.maxZ));
    }
    return paths.map(r => clip(r, bounds)).filter(validRect);
  }

  function makeGrid(bounds, obstacles, paths) {
    const xs = uniqueSorted([bounds.minX, bounds.maxX, ...obstacles.flatMap(r => [r.minX, r.maxX]), ...paths.flatMap(r => [r.minX, r.maxX])]);
    const zs = uniqueSorted([bounds.minZ, bounds.maxZ, ...obstacles.flatMap(r => [r.minZ, r.maxZ]), ...paths.flatMap(r => [r.minZ, r.maxZ])]);
    const cells = [];
    for (let j = 0; j < zs.length - 1; j++) {
      const row = [];
      for (let i = 0; i < xs.length - 1; i++) {
        const x = (xs[i] + xs[i + 1]) / 2, z = (zs[j] + zs[j + 1]) / 2;
        row.push(obstacles.some(r => inside(r, x, z)) ? "reserved" : (paths.some(r => inside(r, x, z)) ? "corridor" : "free"));
      }
      cells.push(row);
    }
    return { xs, zs, cells };
  }

  function mergeGridRects(grid, kind) {
    const { xs, zs, cells } = grid, rectangles = [], active = new Map();
    for (let j = 0; j < cells.length; j++) {
      const next = new Map();
      for (let i = 0; i < cells[j].length;) {
        if (cells[j][i] !== kind) { i++; continue; }
        const start = i;
        while (i < cells[j].length && cells[j][i] === kind) i++;
        const key = start + ":" + i;
        const previous = active.get(key);
        if (previous) {
          previous.maxZ = zs[j + 1];
          next.set(key, previous);
        } else {
          const r = rect(xs[start], xs[i], zs[j], zs[j + 1]);
          rectangles.push(r);
          next.set(key, r);
        }
      }
      active.clear();
      for (const [key, value] of next) active.set(key, value);
    }
    return rectangles;
  }

  function joinedIntervals(intervals) {
    const joined = [];
    for (const item of intervals.sort((a, b) => a[0] - b[0])) {
      const last = joined[joined.length - 1];
      if (last && item[0] <= last[1] + EPS) last[1] = Math.max(last[1], item[1]);
      else joined.push(item.slice());
    }
    return joined;
  }

  function accessFaces(r, corridors) {
    const intervals = { north: [], south: [], west: [], east: [] };
    for (const c of corridors) {
      const loX = Math.max(r.minX, c.minX), hiX = Math.min(r.maxX, c.maxX);
      const loZ = Math.max(r.minZ, c.minZ), hiZ = Math.min(r.maxZ, c.maxZ);
      if (hiX > loX + EPS) {
        if (Math.abs(r.minZ - c.maxZ) < EPS) intervals.north.push([loX, hiX]);
        if (Math.abs(r.maxZ - c.minZ) < EPS) intervals.south.push([loX, hiX]);
      }
      if (hiZ > loZ + EPS) {
        if (Math.abs(r.minX - c.maxX) < EPS) intervals.west.push([loZ, hiZ]);
        if (Math.abs(r.maxX - c.minX) < EPS) intervals.east.push([loZ, hiZ]);
      }
    }
    return Object.entries(intervals).flatMap(([side, spans]) => joinedIntervals(spans).map(span => ({ side, from: span[0], to: span[1], length: span[1] - span[0] })))
      .filter(face => face.length >= 1.35 - EPS)
      .sort((a, b) => b.length - a.length || a.side.localeCompare(b.side));
  }

  function roomZones(grid, corridors) {
    const { xs, zs, cells } = grid, zones = [];
    // Orthogonal-grid maximal rectangles use only geometric event coordinates;
    // the floor size does not increase computational complexity.
    while (zones.length < 24) {
      const prefix = Array.from({ length: zs.length }, () => Array(xs.length).fill(0));
      for (let j = 0; j < cells.length; j++) {
        for (let i = 0; i < cells[j].length; i++) {
          prefix[j + 1][i + 1] = prefix[j][i + 1] + prefix[j + 1][i] - prefix[j][i] + (cells[j][i] === "free" ? 0 : 1);
        }
      }
      let best = null, bestScore = 0;
      for (let left = 0; left < xs.length - 1; left++) {
        for (let right = left + 1; right < xs.length; right++) {
          if (xs[right] - xs[left] < MIN_ROOM_SIDE - EPS) continue;
          for (let top = 0; top < zs.length - 1; top++) {
            for (let bottom = top + 1; bottom < zs.length; bottom++) {
              if (zs[bottom] - zs[top] < MIN_ROOM_SIDE - EPS) continue;
              if (prefix[bottom][right] - prefix[top][right] - prefix[bottom][left] + prefix[top][left]) continue;
              const candidate = rect(xs[left], xs[right], zs[top], zs[bottom]);
              const candidateArea = area(candidate);
              if (candidateArea < bestScore - EPS) continue;
              const faces = accessFaces(candidate, corridors);
              if (!faces.length) continue;
              // Area is primary; ties prefer compact rooms and a longer frontage.
              const score = candidateArea - Math.abs(width(candidate) - depth(candidate)) * 0.0001 + faces[0].length * 0.000001;
              if (score > bestScore + EPS) {
                bestScore = score;
                best = { ...candidate, left, right, top, bottom };
              }
            }
          }
        }
      }
      if (!best) break;
      zones.push(rect(best.minX, best.maxX, best.minZ, best.maxZ));
      for (let j = best.top; j < best.bottom; j++) for (let i = best.left; i < best.right; i++) cells[j][i] = "room";
    }
    return zones;
  }

  function subdivideZone(zone, corridors, use) {
    const faces = accessFaces(zone, corridors);
    const target = use === "retail" ? 6.4 : (use === "residential" ? 3.9 : (use === "hotel" ? 3.8 : 4.8));
    for (const face of faces) {
      const horizontal = face.side === "north" || face.side === "south";
      const length = horizontal ? width(zone) : depth(zone);
      const roomDepth = horizontal ? depth(zone) : width(zone);
      // These are hotel test-fit assumptions, not statutory minimum room sizes.
      const targetFrontage = use === "hotel" ? Math.max(target, 20 / roomDepth) : target;
      let count = Math.min(6, Math.max(1, Math.floor(length / targetFrontage)));
      for (; count >= 2; count--) {
        const rooms = [];
        for (let n = 0; n < count; n++) {
          rooms.push(horizontal
            ? rect(zone.minX + length * n / count, zone.minX + length * (n + 1) / count, zone.minZ, zone.maxZ)
            : rect(zone.minX, zone.maxX, zone.minZ + length * n / count, zone.minZ + length * (n + 1) / count));
        }
        if (rooms.every(r => width(r) >= MIN_ROOM_SIDE - EPS && depth(r) >= MIN_ROOM_SIDE - EPS && accessFaces(r, corridors).length
          && (use !== "hotel" || (Math.min(width(r), depth(r)) >= 3.5 && area(r) >= 20)))) return rooms;
      }
    }
    return [zone];
  }

  function residentialZones(zone, corridors, options) {
    if (options.spaceProgram === "coliving") return subdivideZone(zone, corridors, "hotel");
    const requested = Number(options.housingUnitAreaSqm);
    const targetArea = Number.isFinite(requested) ? clamp(requested, 20, 150) : 59;
    for (const face of accessFaces(zone, corridors)) {
      const horizontal = face.side === "north" || face.side === "south";
      const length = horizontal ? width(zone) : depth(zone);
      const targetFrontage = Math.max(4.5, targetArea / (horizontal ? depth(zone) : width(zone)));
      for (let count = Math.min(6, Math.floor(length / targetFrontage)); count >= 2; count--) {
        const rooms = Array.from({ length: count }, (_, n) => horizontal
          ? rect(zone.minX + length * n / count, zone.minX + length * (n + 1) / count, zone.minZ, zone.maxZ)
          : rect(zone.minX, zone.maxX, zone.minZ + length * n / count, zone.minZ + length * (n + 1) / count));
        if (rooms.every(r => Math.min(width(r), depth(r)) >= 4.5 && area(r) >= 26 && accessFaces(r, corridors).length)) return rooms;
      }
    }
    return [zone];
  }

  function addDoor(room, corridors) {
    const face = accessFaces(room, corridors)[0];
    const doorWidth = Math.min(room.type === "showroom" || room.type === "office" ? 1.15 : 0.95, face.length - 0.4);
    const mid = (face.from + face.to) / 2;
    return {
      x: round(face.side === "west" ? room.minX : (face.side === "east" ? room.maxX : mid)),
      z: round(face.side === "north" ? room.minZ : (face.side === "south" ? room.maxZ : mid)),
      width: round(doorWidth), axis: face.side === "north" || face.side === "south" ? "x" : "z",
      roomId: room.id
    };
  }

  function wallsForRooms(rooms, doors, height) {
    const groups = new Map();
    function segment(axis, constant, from, to) {
      if (to - from < 0.04) return;
      const key = axis + ":" + round(constant);
      if (!groups.has(key)) groups.set(key, { axis, constant, intervals: [] });
      groups.get(key).intervals.push([from, to]);
    }
    for (const r of rooms) {
      const door = doors.find(d => d.roomId === r.id);
      const edges = [
        ["x", r.minZ, r.minX, r.maxX], ["x", r.maxZ, r.minX, r.maxX],
        ["z", r.minX, r.minZ, r.maxZ], ["z", r.maxX, r.minZ, r.maxZ]
      ];
      for (const [axis, constant, from, to] of edges) {
        const isDoorEdge = door.axis === axis && Math.abs(constant - (axis === "x" ? door.z : door.x)) < EPS;
        if (isDoorEdge) {
          const center = axis === "x" ? door.x : door.z;
          segment(axis, constant, from, center - door.width / 2);
          segment(axis, constant, center + door.width / 2, to);
        } else segment(axis, constant, from, to);
      }
    }
    return [...groups.values()].flatMap(group => joinedIntervals(group.intervals).map(([from, to]) => ({
      x1: round(group.axis === "x" ? from : group.constant),
      z1: round(group.axis === "x" ? group.constant : from),
      x2: round(group.axis === "x" ? to : group.constant),
      z2: round(group.axis === "x" ? group.constant : to),
      thickness: 0.12, height: round(height)
    })));
  }

  function doorClearance(room, door) {
    const reach = 1.35, half = door.width / 2 + 0.25;
    if (door.axis === "x") {
      return Math.abs(door.z - room.minZ) < EPS
        ? rect(door.x - half, door.x + half, door.z, door.z + reach)
        : rect(door.x - half, door.x + half, door.z - reach, door.z);
    }
    return Math.abs(door.x - room.minX) < EPS
      ? rect(door.x, door.x + reach, door.z - half, door.z + half)
      : rect(door.x - reach, door.x, door.z - half, door.z + half);
  }

  function officeSettings(options) {
    const input = options.office || {};
    const number = (key, fallback, min, max) => Number.isFinite(Number(input[key])) ? clamp(Number(input[key]), min, max) : fallback;
    return {
      deskWidthM: number("deskWidthM", 1.4, 1.2, 2),
      deskDepthM: number("deskDepthM", 0.7, 0.6, 1),
      aisleWidthM: number("aisleWidthM", 1.2, 0.9, 2.4),
      rowGapM: number("rowGapM", 0.9, 0.7, 2)
    };
  }

  function officeWorkstations(room, door, settings) {
    const inset = 0.25, chairWidth = 0.5, chairDepth = 0.5;
    const clearance = doorClearance(room, door);
    const moduleWidth = settings.deskWidthM, moduleDepth = settings.deskDepthM + 0.9;
    const layouts = [];
    // A workstation reserves its desk, chair and approach together. The chair
    // cannot be relocated to an unrelated free corner when its desk is blocked.
    for (const rotate of [false, true]) {
      const across = rotate ? depth(room) : width(room), along = rotate ? width(room) : depth(room);
      const cols = Math.max(0, Math.floor((across - inset * 2 + settings.aisleWidthM) / (moduleWidth + settings.aisleWidthM)));
      const rows = Math.max(0, Math.floor((along - inset * 2 + settings.rowGapM) / (moduleDepth + settings.rowGapM)));
      const usedAcross = cols * moduleWidth + Math.max(0, cols - 1) * settings.aisleWidthM;
      const usedAlong = rows * moduleDepth + Math.max(0, rows - 1) * settings.rowGapM;
      const placed = [];
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const u = (rotate ? room.minZ : room.minX) + (across - usedAcross) / 2 + col * (moduleWidth + settings.aisleWidthM);
        const v = (rotate ? room.minX : room.minZ) + (along - usedAlong) / 2 + row * (moduleDepth + settings.rowGapM);
        const envelope = rotate ? rect(v, v + moduleDepth, u, u + moduleWidth) : rect(u, u + moduleWidth, v, v + moduleDepth);
        if (overlaps(envelope, clearance, 0.05)) continue;
        const seatId = room.id + "-W" + (placed.length / 2 + 1);
        const make = (type, a, b, w, d, h) => ({ type,
          x: round(rotate ? b : a), z: round(rotate ? a : b),
          width: rotate ? d : w, depth: rotate ? w : d, height: h,
          rotationY: 0, roomId: room.id, workstationId: seatId });
        placed.push(make("desk", u + moduleWidth / 2, v + settings.deskDepthM / 2, settings.deskWidthM, settings.deskDepthM, 0.74));
        placed.push(make("chair", u + moduleWidth / 2, v + settings.deskDepthM + 0.55, chairWidth, chairDepth, 0.8));
      }
      layouts.push(placed);
    }
    return layouts.sort((a, b) => b.length - a.length)[0];
  }

  function hotelEnsuite(room, door, height) {
    if (!/^guest_/.test(room.type) && room.type !== "dwelling_unit" && room.type !== "private_room") return null;
    // A compact wet module occupies a far corner; this keeps the corridor door
    // and the route into the sleeping part of the room outside the bathroom.
    const bw = 2.3, bd = 2.4;
    const candidates = [
      rect(room.minX, room.minX + bw, room.minZ, room.minZ + bd),
      rect(room.maxX - bw, room.maxX, room.minZ, room.minZ + bd),
      rect(room.minX, room.minX + bw, room.maxZ - bd, room.maxZ),
      rect(room.maxX - bw, room.maxX, room.maxZ - bd, room.maxZ)
    ];
    candidates.sort((a, b) => {
      const score = r => Math.hypot((r.minX + r.maxX) / 2 - door.x, (r.minZ + r.maxZ) / 2 - door.z);
      return score(b) - score(a);
    });
    const bath = candidates.find(r => !overlaps(r, doorClearance(room, door), 0.15));
    if (!bath) return null;
    const touchesNorth = Math.abs(bath.minZ - room.minZ) < EPS;
    const bathroomDoor = { x: round((bath.minX + bath.maxX) / 2),
      z: touchesNorth ? bath.maxZ : bath.minZ, width: 0.9, axis: "x", kind: "ensuite", roomId: room.id };
    const subroom = { ...bath, id: room.id, type: "bathroom" };
    const walls = wallsForRooms([subroom], [bathroomDoor], height).filter(wall => {
      const alongX = Math.abs(wall.z1 - wall.z2) < EPS;
      return alongX ? Math.abs(wall.z1 - room.minZ) > EPS && Math.abs(wall.z1 - room.maxZ) > EPS
        : Math.abs(wall.x1 - room.minX) > EPS && Math.abs(wall.x1 - room.maxX) > EPS;
    });
    return { bounds: bath, door: bathroomDoor, walls, subroom };
  }

  function furnish(room, door, settings) {
    if (room.type === "office" && !settings.externalOfficeLayout) {
      const seats = officeWorkstations(room, door, settings);
      if (seats.length) return seats;
    }
    const bath = room.ensuite;
    const placed = [], occupied = bath ? [bath.bounds] : [], clearance = doorClearance(room, door), inset = 0.25;
    // Preserve the approach on both sides of an en-suite opening. It may not
    // be a corridor, but it must remain free of bed and wardrobe footprints.
    if (bath) {
      occupied.push(rect(bath.door.x - 0.7, bath.door.x + 0.7, bath.door.z - 1.0, bath.door.z + 1.0));
    }
    const cx = (room.minX + room.maxX) / 2, cz = (room.minZ + room.maxZ) / 2;
    function add(type, w, d, h, preferred, allowSwap = true) {
      // Both orientations retain axis-aligned world footprints; width/depth
      // describe the resulting footprint so collision checks need no rotation.
      const swapped = () => allowSwap && Math.abs(w - d) > EPS ? add(type, d, w, h, preferred, false) : null;
      if (w + inset * 2 > width(room) || d + inset * 2 > depth(room)) return swapped();
      const left = room.minX + inset + w / 2, right = room.maxX - inset - w / 2;
      const north = room.minZ + inset + d / 2, south = room.maxZ - inset - d / 2;
      const candidates = [...(preferred || []), [left, north], [right, north], [left, south], [right, south], [cx, cz]];
      for (let z = north; z <= south + EPS; z += 0.65) for (let x = left; x <= right + EPS; x += 0.65) candidates.push([x, z]);
      for (const [x, z] of candidates) {
        const footprint = rect(x - w / 2, x + w / 2, z - d / 2, z + d / 2);
        if (footprint.minX < room.minX + inset - EPS || footprint.maxX > room.maxX - inset + EPS || footprint.minZ < room.minZ + inset - EPS || footprint.maxZ > room.maxZ - inset + EPS) continue;
        if (overlaps(footprint, clearance, 0.05) || occupied.some(r => overlaps(footprint, r, 0.16))) continue;
        const item = { type, x: round(x), z: round(z), width: w, depth: d, height: h, rotationY: 0, roomId: room.id };
        placed.push(item); occupied.push(footprint);
        return item;
      }
      return swapped();
    }
    function meeting() {
      const compact = area(room) < 10;
      const table = add("meeting_table", compact ? 1.2 : Math.min(2.4, width(room) - 1.6), compact ? 0.65 : 1.0, 0.74, [[cx, cz]]);
      if (table) {
        add("chair", 0.48, 0.48, 0.78, [[table.x, table.z - 0.85]]);
        add("chair", 0.48, 0.48, 0.78, [[table.x, table.z + 0.85]]);
        if (width(room) > 3.5) {
          add("chair", 0.48, 0.48, 0.78, [[table.x - 0.75, table.z - 0.85]]);
          add("chair", 0.48, 0.48, 0.78, [[table.x + 0.75, table.z + 0.85]]);
        }
      }
    }
    switch (room.type) {
      case "dwelling_unit":
        add("bed", 1.5, 2.0, 0.48);
        add("kitchen_counter", 1.8, 0.65, 0.9);
        add("sofa", 1.5, 0.8, 0.75);
        add("wardrobe", 1.2, 0.6, 2.1);
        break;
      case "private_room":
        if (!add("bed", 1.2, 2.0, 0.48)) add("bed", 0.9, 2.0, 0.48);
        add("wardrobe", 1.2, 0.6, 2.1);
        break;
      case "shared_living":
      case "shared_living_kitchen":
      case "shared_living_kitchen_laundry":
        add("sofa", 2.0, 0.85, 0.75);
        add("coffee_table", 1.0, 0.6, 0.4);
        if (room.type.includes("kitchen")) add("kitchen_counter", 1.8, 0.65, 0.9);
        if (room.type.includes("laundry")) add("washing_machine", 0.65, 0.65, 0.9);
        break;
      case "shared_kitchen":
      case "shared_kitchen_laundry":
        add("kitchen_counter", 2.0, 0.65, 0.9);
        add("meeting_table", 1.2, 0.75, 0.74);
        if (room.type.includes("laundry")) add("washing_machine", 0.65, 0.65, 0.9);
        break;
      case "shared_laundry":
        add("washing_machine", 0.65, 0.65, 0.9);
        add("washing_machine", 0.65, 0.65, 0.9);
        add("storage", 1.2, 0.5, 1.8);
        break;
      case "guest_room":
      case "guest_twin":
      case "guest_suite":
        if (room.type === "guest_twin") {
          add("bed", 0.9, 2.0, 0.48);
          add("bed", 0.9, 2.0, 0.48);
        } else add("bed", 1.5, 2.0, 0.48);
        if (room.type === 'guest_suite') add('sofa', 1.6, .8, .75);
        add("wardrobe", 1.2, 0.6, 2.1);
        break;
      case "bedroom":
        if (!add("bed", 1.5, 2.0, 0.48)) add("bed", 0.9, 2.0, 0.48);
        add("wardrobe", 1.6, 0.6, 2.1);
        break;
      case "bathroom":
        add("toilet", 0.65, 0.75, 0.72);
        add("vanity", 0.9, 0.5, 0.82);
        break;
      case "kitchen":
      case "pantry":
        add("kitchen_counter", Math.min(2.7, width(room) - 0.6), 0.65, 0.9);
        add("storage", 0.8, 0.65, 1.8);
        add("meeting_table", 1.2, 0.75, 0.74, [[cx, cz]]);
        break;
      case "living":
      case "lounge":
        add("sofa", 2.0, 0.85, 0.75);
        add("coffee_table", 1.0, 0.6, 0.4, [[cx, cz]]);
        add("chair", 0.7, 0.7, 0.78);
        break;
      case "meeting":
      case "meeting_small":
      case "consultation":
        meeting();
        break;
      case "showroom":
        add("display", 1.8, 0.8, 0.85, [[cx, cz]]);
        add("display", 1.5, 0.6, 1.25);
        add("storage", 1.2, 0.5, 1.0);
        break;
      case "storage":
      case "hotel_service":
        add("storage", 1.7, 0.55, 1.8);
        add("storage", 1.7, 0.55, 1.8);
        break;
      case "office":
        // A small office can remain unseated when a complete workstation does
        // not fit. An isolated desk is not counted as an occupiable seat.
        add("storage", 0.7, 0.4, 1.1);
        break;
      default: {
        const count = Math.max(1, Math.min(8, Math.floor(area(room) / 11)));
        for (let i = 0; i < count; i++) {
          const desk = add("desk", 1.4, 0.7, 0.74);
          if (desk) add("chair", 0.5, 0.5, 0.8, [[desk.x, desk.z + 0.78], [desk.x, desk.z - 0.78]]);
        }
      }
    }
    if (bath) {
      placed.push(...furnish(bath.subroom, bath.door, settings).map(item => ({ ...item, zone: "ensuite" })));
    }
    return placed;
  }

  function generate(fp = {}, options = {}) {
    if (spatialApi) options = { ...options, ...spatialApi.forFloor(options, fp.level),
      office: { ...spatialApi.officeOptions(options), ...options.office } };
    const w = Number(fp.widthM), d = Number(fp.depthM), shift = Number(fp.northShiftM) || 0;
    const warnings = [];
    const sharedCore = options.coreLayout !== undefined ? options.coreLayout : fp.coreLayout;
    if (options.detailLevel === "massing" || sharedCore?.status === "not-requested") {
      const bounds = Number.isFinite(w) && Number.isFinite(d) && w > 1 && d > 1 && Number.isFinite(shift)
        ? rect(-w / 2 + .5, w / 2 - .5, shift - d / 2 + .5, shift + d / 2 - .5) : rect(0, 0, 0, 0);
      const plan = blank(fp, bounds, ["단순 매스 단계이므로 실내 평면과 수량을 생성하지 않았습니다. 계단·출입·피난·승강기와 용도별 실내 조건은 별도 검토해야 합니다."]);
      plan.reason = "massing-only"; plan.detailLevel = "massing"; plan.metrics = null; plan.entry = null;
      plan.coreLayoutStatus = sharedCore?.status || "not-requested";
      plan.circulation = { profile: sharedCore?.circulation?.profile || "none", status: "not-reviewed",
        calculationStatus: sharedCore?.status || "not-requested", isPermitConfirmation: false };
      return plan;
    }
    if (!Number.isFinite(w) || !Number.isFinite(d) || w <= 0 || d <= 0 || !Number.isFinite(shift)) {
      return { ...blank(fp, rect(0, 0, 0, 0), ["유효한 층 폭과 깊이가 없어 실내 평면을 생성하지 않았습니다."]), reason: "invalid-floor" };
    }
    if (w <= 1 || d <= 1) return { ...blank(fp, rect(-w / 2, w / 2, shift - d / 2, shift + d / 2), ["외벽 여유 공간보다 층 크기가 작아 실내 평면을 생성하지 않았습니다."]), reason: "insufficient-floor-space" };
    const margin = 0.5;
    const bounds = rect(-w / 2 + margin, w / 2 - margin, shift - d / 2 + margin, shift + d / 2 - margin);
    const plan = blank(fp, bounds, warnings);
    const residential = plan.use === "residential";
    const coliving = residential && options.spaceProgram === "coliving";
    plan.spaceProgram = coliving ? "coliving" : "standard";
    plan.residentialType = residential ? (options.residentialType === "officetel" ? "officetel" : "apartment") : null;
    const workstationSettings = { ...officeSettings(options), externalOfficeLayout: Boolean(officeApi) };
    plan.obstacles = (options.layoutObstacles || []).filter(o => o.level === plan.level && o.maxX > bounds.minX && o.minX < bounds.maxX && o.maxZ > bounds.minZ && o.minZ < bounds.maxZ).map(o => ({...o}));
    if (plan.obstacles.length) warnings.push('고정 장애물은 사용자가 입력한 계획 가정입니다. 구조 도면에서 확인한 기둥 위치와 구분하여 검토하세요.');
    plan.assumptions = plan.use === "hotel" ? [
      "객실 전면 목표 3.8m·면적 목표 20㎡ 이상, 욕실 모듈 2.3×2.4m는 초기 배치 가정이며 법정 최소 기준이 아닙니다.",
      "객실·욕실·하우스키핑실을 반복 배치한 초안입니다. 숙박업 종류, 무장애 객실, 설비·방화·피난 계획은 별도 검토 대상입니다."
    ] : (plan.use === "main" ? [
      `업무 가구 가정: 책상 ${workstationSettings.deskWidthM}×${workstationSettings.deskDepthM}m, 좌석 열 사이 ${workstationSettings.rowGapM}m, 책상 옆 통로 ${workstationSettings.aisleWidthM}m. 좌석 수는 법정 수용인원이 아닙니다.`
    ] : (residential ? [
      coliving
        ? "코리빙은 공간 구성 콘셉트이며 법적 건축물 용도 분류가 아닙니다. 개인실과 공용 거실·주방·세탁 공간을 구분한 배치 초안입니다."
        : "복도에서 개별 출입하는 원룸형 세대 초안입니다. 세대 안에 취침·거실·주방 기능과 구획된 욕실을 확보하며, 가족형 다침실 평면이나 확정 세대별 전용면적은 아닙니다.",
      "세대당 전용면적 입력은 모듈 분할의 목표이며 실제 배치 면적과 다를 수 있습니다. 실내 배치 세대·개인실 수는 법정 세대수나 주차 산정 세대수를 대체하지 않습니다.",
      "채광·환기·피난·방화·설비·주택 또는 오피스텔 기준과 용도 허용은 별도 검토가 필요합니다."
    ] : []));
    if (sharedCore !== undefined) {
      plan.voids = fp.hasAtrium ? [rect(-w * 0.175, w * 0.175, shift - d * 0.175, shift + d * 0.175)] : [];
      plan.cores = reserveCores({ ...fp, widthM: w, depthM: d }, options, bounds, plan.voids, warnings);
      plan.coreLayoutStatus = plan.cores.length ? "reserved" : "unfeasible";
      plan.circulation = sharedCore?.circulation || null;
      plan.assumptions.push("전 층과 지하 배치에 공유하는 동일 수직 코어 예약입니다. 층별로 위치·크기를 바꾸지 않으며 상세 피난·승강기·구조 설계는 확인 전입니다.");
      plan.metrics.coreAreaSqm = round(plan.cores.reduce((sum, core) => sum + area(core), 0));
      if (!plan.cores.length) { plan.reason = "shared-core-unfeasible"; return plan; }
    }
    if (width(bounds) < 5.5 || depth(bounds) < 5.5) {
      warnings.push("층 폭 또는 깊이가 작아 코어·복도·실의 최소 여유 공간을 함께 확보할 수 없습니다. 실을 억지로 생성하지 않았습니다.");
      plan.reason = "insufficient-floor-space";
      return plan;
    }
    const floor = { ...fp, widthM: w, depthM: d };
    if (sharedCore === undefined) {
      plan.voids = fp.hasAtrium ? [rect(-w * 0.175, w * 0.175, shift - d * 0.175, shift + d * 0.175)] : [];
      plan.cores = reserveCores(floor, options, bounds, plan.voids, warnings);
      const profile = typeof options.circulationProfile === "string" ? options.circulationProfile : options.circulationProfile?.profile;
      if (profile === "compact") {
        plan.circulation = { profile: "compact", status: plan.cores.length ? "reserved" : "unfeasible", label: "계단·출입 예약", elevatorIncluded: false,
          stairCount: null, elevatorRequired: null, entranceVerified: false, egressVerified: false, isPermitConfirmation: false };
        if (!plan.cores.length) { plan.reason = "shared-core-unfeasible"; return plan; }
      }
    }
    const obstacles = [...plan.voids, ...plan.cores];
    const corridorWidth = plan.use === "hotel" ? 1.8 : (Math.min(w, d) < 14 ? 1.3 : (Math.min(w, d) > 26 ? 1.8 : 1.5));
    const paths = circulation(bounds, obstacles, corridorWidth);
    const grid = makeGrid(bounds, obstacles, paths);
    plan.corridors = mergeGridRects(grid, "corridor");
    const zones = roomZones(grid, plan.corridors);
    const rawRooms = zones.flatMap(zone => residential ? residentialZones(zone, plan.corridors, options) : subdivideZone(zone, plan.corridors, plan.use));
    rawRooms.sort((a, b) => a.minZ - b.minZ || a.minX - b.minX || a.maxZ - b.maxZ);
    const program = PROGRAMS[plan.use], counters = {};
    plan.rooms = rawRooms.map((r, index) => {
      let [type, baseLabel] = program[index % program.length];
      if (residential && !coliving) {
        type = "dwelling_unit"; baseLabel = plan.residentialType === "officetel" ? "오피스텔 원룸" : "원룸형 주거 세대";
      } else if (coliving) {
        const shared = rawRooms.length >= 5 ? [["shared_living", "공용 거실"], ["shared_kitchen", "공용 주방"], ["shared_laundry", "공용 세탁실"]]
          : rawRooms.length === 4 ? [["shared_living", "공용 거실"], ["shared_kitchen_laundry", "공용 주방·세탁실"]]
          : rawRooms.length === 3 ? [["shared_living_kitchen", "공용 거실·주방"], ["shared_laundry", "공용 세탁실"]]
          : [["shared_living_kitchen_laundry", "공용 거실·주방·세탁"]];
        [type, baseLabel] = shared[index] || ["private_room", "코리빙 개인실"];
      }
      if (plan.use === "hotel" && (Math.min(width(r), depth(r)) < 3.5 || area(r) < 20)) {
        type = "hotel_service"; baseLabel = "하우스키핑실";
      }
      counters[type] = (counters[type] || 0) + 1;
      return { id: "L" + plan.level + "-R" + (index + 1), label: baseLabel + " " + String(counters[type]).padStart(2, "0"), type, ...r, areaSqm: round(area(r)) };
    });
    if (plan.use === 'hotel' && hotelApi) {
      const { rooms, ...planning } = hotelApi.planRooms(plan.rooms, options);
      plan.hotelPlanning = planning;
      plan.rooms = rooms;
      warnings.push(...(plan.hotelPlanning.warnings || []));
    }
    plan.doors = plan.rooms.map(room => addDoor(room, plan.corridors));
    const floorHeight = Number(fp.zTop) - Number(fp.zBottom);
    const wallHeight = Number.isFinite(floorHeight) && floorHeight > 1 ? clamp(floorHeight - 0.3, 1.8, 3.0) : 2.7;
    plan.rooms.forEach((room, index) => {
      const door = plan.doors[index];
      if (/^guest_/.test(room.type) || room.type === "dwelling_unit" || room.type === "private_room") room.ensuite = hotelEnsuite(room, door, wallHeight);
      let furniture = furnish(room, door, workstationSettings).filter(item => !plan.obstacles.some(o => overlaps(o, rect(item.x-item.width/2,item.x+item.width/2,item.z-item.depth/2,item.z+item.depth/2),.05)));
      if (room.type === "dwelling_unit" || room.type === "private_room") {
        const types = new Set(furniture.map(item => item.type));
        const complete = room.ensuite && types.has("bed") && types.has("toilet") && types.has("vanity")
          && (room.type !== "dwelling_unit" || (types.has("kitchen_counter") && types.has("sofa")));
        if (!complete) {
          room.type = "residential_support"; room.label = "주거 지원 공간 " + String(index + 1).padStart(2, "0");
          delete room.ensuite;
          furniture = furnish({ ...room, type: "storage" }, door, workstationSettings).filter(item => !plan.obstacles.some(o => overlaps(o, rect(item.x-item.width/2,item.x+item.width/2,item.z-item.depth/2,item.z+item.depth/2),.05)));
          warnings.push("일부 구획에는 출입·욕실·취침 등 필수 기능을 함께 담지 못해 세대 또는 개인실로 계산하지 않았습니다.");
        } else {
          const zones = [["bed", "sleeping", "취침 영역"], ["sofa", "living", "거실 영역"], ["kitchen_counter", "kitchen", "주방 영역"]];
          room.subspaces = zones.flatMap(([furnitureType, type, label]) => furniture.filter(item => item.type === furnitureType).map(item => ({
            type, label, ...rect(item.x - item.width / 2, item.x + item.width / 2, item.z - item.depth / 2, item.z + item.depth / 2)
          })));
          room.subspaces.push({ type: "bathroom", label: "구획된 욕실", ...room.ensuite.bounds });
          room.residentialType = plan.residentialType;
        }
      }
      if (/^guest_/.test(room.type)) {
        const beds = furniture.filter(item => item.type === "bed");
        const wetTypes = new Set(furniture.filter(item => item.zone === "ensuite").map(item => item.type));
        if (room.type === "guest_twin" && beds.length === 1) {
          room.type = "guest_room"; room.label = "스탠더드 객실 " + String(index + 1).padStart(2, "0");
        }
        if (!room.ensuite || !beds.length || !wetTypes.has("toilet") || !wetTypes.has("vanity")) {
          room.type = "hotel_service"; room.label = "운영 지원실 " + String(index + 1).padStart(2, "0");
          delete room.ensuite;
          furniture = furnish(room, door, workstationSettings).filter(item => !plan.obstacles.some(o => overlaps(o, rect(item.x-item.width/2,item.x+item.width/2,item.z-item.depth/2,item.z+item.depth/2),.05)));
        }
      }
      plan.furniture.push(...furniture);
    });
    if (officeApi && plan.rooms.some(room => room.type === 'office')) {
      const officeRooms = plan.rooms.filter(room => room.type === 'office');
      plan.officeLayout = officeApi.generate({ rooms: officeRooms, doors: plan.doors,
        obstacles: plan.obstacles, options: options.office, roomRequirements: options.officeRoomRequirements });
      const ids = new Set(officeRooms.map(room => room.id));
      const fitted = new Set(plan.officeLayout.furniture.map(item => item.roomId));
      plan.furniture = plan.furniture.filter(item => !ids.has(item.roomId) || !fitted.has(item.roomId)).concat(plan.officeLayout.furniture);
      warnings.push(...(plan.officeLayout.warnings || []));
    }
    plan.walls = wallsForRooms(plan.rooms, plan.doors, wallHeight);
    for (const room of plan.rooms) if (room.ensuite) {
      plan.doors.push(room.ensuite.door);
      plan.walls.push(...room.ensuite.walls);
    }
    // Spawn inside the south circulation spine, away from the façade and its
    // collision envelope. This is an interior preview location, not a claim
    // about the eventual ground-floor building entrance.
    plan.entry = { x: 0, z: round(bounds.maxZ - 0.65) };
    const unused = mergeGridRects(grid, "free").reduce((sum, r) => sum + area(r), 0);
    if (!plan.rooms.length) warnings.push("코어·중정·복도 확보 후 충분한 폭과 깊이를 가진 실이 남지 않습니다. 코어 위치 또는 매스 치수를 조정하세요.");
    else if (unused > Math.max(3, w * d * 0.04)) warnings.push("최소 실 폭을 충족하지 못한 일부 잔여 공간은 비워 두었습니다. 실제 평면에서 설비·수납·동선을 조정하세요.");
    if (residential && !coliving && !plan.rooms.some(room => room.type === "dwelling_unit")) warnings.push("이 매스에서는 주방·거실·취침·욕실을 갖춘 독립 세대를 확보하지 못했습니다. 매스 또는 코어 위치를 조정하세요.");
    if (coliving) {
      if (!plan.rooms.some(room => room.type === "private_room")) warnings.push("독립 개인실을 확보하지 못했습니다. 공용 공간만으로 코리빙 정원을 산정하지 않습니다.");
      for (const type of ["sofa", "kitchen_counter", "washing_machine"]) {
        if (!plan.furniture.some(item => item.type === type && plan.rooms.some(room => room.id === item.roomId && room.type.startsWith("shared_")))) warnings.push("공용 거실·주방·세탁 중 일부 가구가 들어가지 않아 코리빙 공용 시설 구성을 완성하지 못했습니다.");
      }
    }
    plan.dwellingUnits = plan.rooms.filter(room => room.type === "dwelling_unit").map(room => ({ id: room.id, label: room.label, residentialType: plan.residentialType,
      areaSqm: room.areaSqm, ...rect(room.minX, room.maxX, room.minZ, room.maxZ), subspaces: room.subspaces }));
    const guestRooms = plan.rooms.filter(room => /^guest_/.test(room.type));
    if (plan.use === "hotel" && !guestRooms.length) warnings.push("이 매스에서는 욕실·침대·출입 동선을 함께 담는 객실 모듈을 확보하지 못했습니다. 객실 수를 임의로 늘리지 않고 운영 지원실로 표시했습니다.");
    if (plan.use === "main" && plan.rooms.some(room => room.type === "office" && !plan.furniture.some(item => item.roomId === room.id && item.workstationId))) {
      warnings.push("일부 업무 공간에는 출입 여유와 통로를 확보한 책상·의자 모듈이 들어가지 않아 좌석을 배치하지 않았습니다.");
    }
    const desks = plan.furniture.filter(item => item.type === "desk");
    plan.metrics = {
      roomCount: plan.rooms.length,
      netRoomAreaSqm: round(plan.rooms.reduce((sum, room) => sum + room.areaSqm, 0)),
      doorCount: plan.doors.length,
      furnitureCount: plan.furniture.length,
      deskCount: desks.length,
      workstationCount: desks.filter(desk => desk.workstationId && plan.furniture.some(item => item.type === "chair" && item.workstationId === desk.workstationId)).length,
      guestRoomCount: guestRooms.length,
      dwellingUnitCount: plan.dwellingUnits.length,
      privateRoomCount: plan.rooms.filter(room => room.type === "private_room").length,
      sharedSpaceCount: plan.rooms.filter(room => room.type.startsWith("shared_")).length,
      guestBedCount: plan.furniture.filter(item => item.type === "bed" && guestRooms.some(room => room.id === item.roomId)).length,
      corridorAreaSqm: round(plan.corridors.reduce((sum, r) => sum + area(r), 0)),
      coreAreaSqm: round(plan.cores.reduce((sum, r) => sum + area(r), 0)),
      guestRoomAreaSqm: round(guestRooms.reduce((sum, room) => sum + room.areaSqm, 0)),
      serviceAreaSqm: round(plan.rooms.filter(room => room.type === "hotel_service").reduce((sum, room) => sum + room.areaSqm, 0))
    };
    if (plan.use === 'hotel' && hotelApi) Object.assign(plan, hotelApi.assignRooms(plan, options));
    plan.warnings = [...new Set(plan.warnings)];
    plan.status = "generated"; plan.reason = null; plan.quantityStatus = "generated"; plan.detailLevel = "concept";
    return plan;
  }

  return Object.freeze({ generate, version: "1.3.0" });
});
