"use strict";

// Run: node seoul-3d-web/tests/interior-plan.test.js
// These are schematic-geometry checks, not statutory / architectural approval.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { generate } = require("../interior-plan.js");

const EPS = 0.00002;
const close = (a, b, message) => assert.ok(Math.abs(a - b) < EPS, message + ": " + a + " ≠ " + b);
const width = r => r.maxX - r.minX;
const depth = r => r.maxZ - r.minZ;
const area = r => width(r) * depth(r);
const overlap = (a, b) => a.minX < b.maxX - EPS && a.maxX > b.minX + EPS && a.minZ < b.maxZ - EPS && a.maxZ > b.minZ + EPS;
const contains = (r, x, z) => x >= r.minX - EPS && x <= r.maxX + EPS && z >= r.minZ - EPS && z <= r.maxZ + EPS;
const faceAdjacent = (a, b) => {
  const xContact = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const zContact = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  return (xContact > EPS && (Math.abs(a.minZ - b.maxZ) < EPS || Math.abs(a.maxZ - b.minZ) < EPS)) ||
    (zContact > EPS && (Math.abs(a.minX - b.maxX) < EPS || Math.abs(a.maxX - b.minX) < EPS));
};

function doorClearance(room, door) {
  const reach = 1.35, half = door.width / 2 + 0.25;
  if (door.axis === "x") return {
    minX: door.x - half, maxX: door.x + half,
    minZ: Math.abs(door.z - room.minZ) < EPS ? door.z : door.z - reach,
    maxZ: Math.abs(door.z - room.minZ) < EPS ? door.z + reach : door.z
  };
  return {
    minX: Math.abs(door.x - room.minX) < EPS ? door.x : door.x - reach,
    maxX: Math.abs(door.x - room.minX) < EPS ? door.x + reach : door.x,
    minZ: door.z - half, maxZ: door.z + half
  };
}

function pointRectDistance(x, z, r) {
  return Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));
}

function safePoint(plan, x, z) {
  if (x < plan.bounds.minX + 0.3 || x > plan.bounds.maxX - 0.3 || z < plan.bounds.minZ + 0.3 || z > plan.bounds.maxZ - 0.3) return false;
  if ([...plan.cores, ...plan.voids].some(r => pointRectDistance(x, z, r) < 0.3 - EPS)) return false;
  if (plan.walls.some(wall => pointRectDistance(x, z, { minX: Math.min(wall.x1, wall.x2), maxX: Math.max(wall.x1, wall.x2), minZ: Math.min(wall.z1, wall.z2), maxZ: Math.max(wall.z1, wall.z2) }) < 0.3 + wall.thickness / 2 - EPS)) return false;
  return !plan.furniture.some(item => pointRectDistance(x, z, { minX: item.x - item.width / 2, maxX: item.x + item.width / 2, minZ: item.z - item.depth / 2, maxZ: item.z + item.depth / 2 }) < 0.3 - EPS);
}

function validatePlan(fp, options) {
  const plan = generate(fp, options);
  const tag = `${fp.widthM}×${fp.depthM} ${fp.use} ${options.coreType} atrium=${fp.hasAtrium}`;
  assert.deepEqual(plan, generate(fp, options), "deterministic output: " + tag);
  assert.equal(plan.level, fp.level);
  assert.equal(plan.use, fp.use);
  assert.ok(Array.isArray(plan.warnings));
  for (const list of [plan.rooms, plan.corridors, plan.cores, plan.voids]) {
    for (const r of list) {
      assert.ok(width(r) > 0 && depth(r) > 0, "positive rectangular area: " + tag);
      assert.ok(contains(plan.bounds, r.minX, r.minZ) && contains(plan.bounds, r.maxX, r.maxZ), "inside inset bounds: " + tag);
    }
  }
  const allRects = [...plan.rooms, ...plan.corridors, ...plan.cores, ...plan.voids];
  for (let i = 0; i < allRects.length; i++) {
    for (let j = i + 1; j < allRects.length; j++) assert.ok(!overlap(allRects[i], allRects[j]), "rooms/circulation/core/atrium do not overlap: " + tag);
  }
  assert.ok(allRects.reduce((sum, r) => sum + area(r), 0) <= area(plan.bounds) + EPS * 10, "accounted area <= floor: " + tag);

  // The entry and every room door must be in one connected circulation network.
  const reachable = new Set();
  plan.corridors.forEach((r, index) => { if (contains(r, plan.entry.x, plan.entry.z)) reachable.add(index); });
  if (plan.rooms.length) assert.ok(reachable.size, "entry reaches circulation: " + tag);
  for (let changed = true; changed;) {
    changed = false;
    plan.corridors.forEach((r, index) => {
      if (!reachable.has(index) && [...reachable].some(other => faceAdjacent(r, plan.corridors[other]))) {
        reachable.add(index); changed = true;
      }
    });
  }
  if (plan.rooms.length) assert.equal(reachable.size, plan.corridors.length, "circulation has no disconnected islands: " + tag);
  if (plan.rooms.length) {
    assert.ok(safePoint(plan, plan.entry.x, plan.entry.z), "safe interior spawn away from obstacles and boundary: " + tag);
    if (fp.widthM >= 12 && fp.depthM >= 12) {
      const directions = [[0, -1], [1, 0], [-1, 0], [0, 1]];
      assert.ok(directions.some(([dx, dz]) => Array.from({ length: 10 }, (_, step) => (step + 1) * 0.3).every(distance => safePoint(plan, plan.entry.x + dx * distance, plan.entry.z + dz * distance))), "at least 3m walkable preview route from spawn: " + tag);
    }
  }

  assert.equal(new Set(plan.rooms.map(r => r.id)).size, plan.rooms.length, "unique room ids");
  for (const room of plan.rooms) {
    assert.ok(width(room) >= 2.35 - EPS && depth(room) >= 2.35 - EPS, "minimum room dimensions: " + tag);
    close(room.areaSqm, area(room), "room area");
    assert.ok(room.label && room.type, "named room program");
    const doors = plan.doors.filter(door => door.roomId === room.id && door.kind !== "ensuite");
    assert.equal(doors.length, 1, "one usable door per room: " + tag);
    const door = doors[0];
    assert.ok(["x", "z"].includes(door.axis));
    assert.ok(door.width >= 0.9 && door.width <= 1.2, "practical door width");
    const doorwayCoordinate = door.axis === "x" ? door.z : door.x;
    const roomFaceCoordinates = door.axis === "x" ? [room.minZ, room.maxZ] : [room.minX, room.maxX];
    assert.ok(roomFaceCoordinates.some(value => Math.abs(doorwayCoordinate - value) < EPS), "door lies on room boundary");
    const endA = door.axis === "x" ? [door.x - door.width / 2, door.z] : [door.x, door.z - door.width / 2];
    const endB = door.axis === "x" ? [door.x + door.width / 2, door.z] : [door.x, door.z + door.width / 2];
    assert.ok(contains(room, ...endA) && contains(room, ...endB), "opening stays within wall");
    assert.ok([...reachable].some(index => contains(plan.corridors[index], door.x, door.z)), "door enters reachable corridor");

    // An actual opening is required; a door symbol drawn over a solid wall fails.
    for (const wall of plan.walls) {
      assert.ok(wall.thickness > 0 && wall.height > 0);
      const sameAxis = door.axis === "x" ? Math.abs(wall.z1 - wall.z2) < EPS : Math.abs(wall.x1 - wall.x2) < EPS;
      const sameLine = door.axis === "x" ? Math.abs(wall.z1 - door.z) < EPS : Math.abs(wall.x1 - door.x) < EPS;
      if (!sameAxis || !sameLine) continue;
      const start = door.axis === "x" ? Math.min(wall.x1, wall.x2) : Math.min(wall.z1, wall.z2);
      const end = door.axis === "x" ? Math.max(wall.x1, wall.x2) : Math.max(wall.z1, wall.z2);
      const mid = door.axis === "x" ? door.x : door.z;
      assert.ok(Math.min(end, mid + door.width / 2) - Math.max(start, mid - door.width / 2) < EPS, "wall geometry has a genuine door gap: " + tag);
    }

    const furniture = plan.furniture.filter(item => item.roomId === room.id);
    assert.ok(furniture.length, "each generated room has use-specific furniture: " + tag);
    const clearance = doorClearance(room, door);
    const footprints = furniture.map(item => ({ minX: item.x - item.width / 2, maxX: item.x + item.width / 2, minZ: item.z - item.depth / 2, maxZ: item.z + item.depth / 2 }));
    furniture.forEach((item, i) => {
      assert.ok(item.width > 0 && item.depth > 0 && item.height > 0, "positive furniture size");
      assert.equal(item.rotationY, 0, "axis aligned furniture footprint");
      assert.ok(contains(room, footprints[i].minX, footprints[i].minZ) && contains(room, footprints[i].maxX, footprints[i].maxZ), "furniture inside its room");
      assert.ok(!overlap(footprints[i], clearance), "door approach remains clear: " + tag);
      for (const reserved of [...plan.cores, ...plan.voids, ...plan.corridors]) assert.ok(!overlap(footprints[i], reserved), "furniture avoids core, atrium and corridor");
      for (let j = i + 1; j < furniture.length; j++) assert.ok(!overlap(footprints[i], footprints[j]), "furniture does not overlap");
    });
    if (/^guest_/.test(room.type) || room.type === "dwelling_unit" || room.type === "private_room") {
      assert.ok(room.ensuite, "a counted private module includes a separate wet module");
      const bath = room.ensuite.bounds;
      assert.ok(contains(room, bath.minX, bath.minZ) && contains(room, bath.maxX, bath.maxZ), "bathroom stays in guest module");
      const internalDoors = plan.doors.filter(item => item.roomId === room.id && item.kind === "ensuite");
      assert.equal(internalDoors.length, 1, "guest room has an en-suite door");
      const bathDoor = internalDoors[0];
      assert.ok(contains(bath, bathDoor.x, bathDoor.z), "en-suite door is on its bathroom boundary");
      const bathFixtures = furniture.filter(item => item.zone === "ensuite");
      assert.ok(bathFixtures.some(item => item.type === "toilet") && bathFixtures.some(item => item.type === "vanity"), "a counted guest module has both wet fixtures");
      const beds = furniture.filter(item => item.type === "bed");
      assert.equal(beds.length, room.type === "guest_twin" ? 2 : 1, "guest beds match the counted room type");
      furniture.forEach((item, index) => {
        const footprint = footprints[index];
        if (item.zone === "ensuite") {
          assert.ok(contains(bath, footprint.minX, footprint.minZ) && contains(bath, footprint.maxX, footprint.maxZ), "wet fixtures stay in bathroom");
          assert.ok(!overlap(footprint, doorClearance(bath, bathDoor)), "bathroom fixture clears the en-suite approach");
        } else assert.ok(!overlap(footprint, bath), "beds and wardrobes stay outside wet module");
      });
      for (const wall of plan.walls) {
        if (Math.abs(wall.z1 - bathDoor.z) > EPS || Math.abs(wall.z2 - bathDoor.z) > EPS) continue;
        assert.ok(Math.min(Math.max(wall.x1, wall.x2), bathDoor.x + bathDoor.width / 2)
          - Math.max(Math.min(wall.x1, wall.x2), bathDoor.x - bathDoor.width / 2) < EPS, "en-suite wall contains a real door opening");
      }
      if (room.type === "dwelling_unit") {
        for (const type of ["bed", "sofa", "kitchen_counter", "toilet", "vanity"]) assert.ok(furniture.some(item => item.type === type), "a counted dwelling has actual " + type);
        assert.deepEqual(new Set(room.subspaces.map(space => space.type)), new Set(["sleeping", "living", "kitchen", "bathroom"]));
        room.subspaces.forEach(space => assert.ok(contains(room, space.minX, space.minZ) && contains(room, space.maxX, space.maxZ), "private functions stay in the independent dwelling"));
      }
    }
  }

  assert.equal(plan.metrics.roomCount, plan.rooms.length);
  assert.equal(plan.metrics.doorCount, plan.doors.length);
  assert.equal(plan.metrics.furnitureCount, plan.furniture.length);
  close(plan.metrics.netRoomAreaSqm, plan.rooms.reduce((sum, room) => sum + room.areaSqm, 0), "net generated room area");
  assert.equal(plan.metrics.deskCount, plan.furniture.filter(item => item.type === "desk").length, "desk count comes from placed geometry");
  const workstationDesks = plan.furniture.filter(item => item.type === "desk" && item.workstationId);
  assert.equal(plan.metrics.workstationCount, workstationDesks.length, "workstations count actual desk-chair pairs");
  workstationDesks.forEach(desk => {
    const chairs = plan.furniture.filter(item => item.type === "chair" && item.workstationId === desk.workstationId);
    assert.equal(chairs.length, 1, "one chair stays paired with each office desk");
    assert.equal(chairs[0].roomId, desk.roomId, "paired desk and chair share a room");
    assert.ok(Math.hypot(chairs[0].x - desk.x, chairs[0].z - desk.z) < 1.1, "chair remains at its desk");
  });
  const guestRooms = plan.rooms.filter(room => /^guest_/.test(room.type));
  assert.equal(plan.metrics.guestRoomCount, guestRooms.length, "guest count comes from fitted modules");
  assert.equal(plan.metrics.guestBedCount, plan.furniture.filter(item => item.type === "bed" && guestRooms.some(room => room.id === item.roomId)).length);
  close(plan.metrics.corridorAreaSqm, plan.corridors.reduce((sum, r) => sum + area(r), 0), "circulation area comes from reserved geometry");
  close(plan.metrics.coreAreaSqm, plan.cores.reduce((sum, r) => sum + area(r), 0), "core area comes from reserved geometry");
  close(plan.metrics.guestRoomAreaSqm, guestRooms.reduce((sum, room) => sum + room.areaSqm, 0), "guest suite area includes its wet module once");
  close(plan.metrics.serviceAreaSqm, plan.rooms.filter(room => room.type === "hotel_service").reduce((sum, room) => sum + room.areaSqm, 0), "service room area is counted separately");
  assert.equal(plan.metrics.dwellingUnitCount, plan.rooms.filter(room => room.type === "dwelling_unit").length, "dwelling count uses fitted complete modules");
  assert.equal(plan.metrics.privateRoomCount, plan.rooms.filter(room => room.type === "private_room").length, "private-room count uses placed modules");
  assert.equal(plan.metrics.sharedSpaceCount, plan.rooms.filter(room => room.type.startsWith("shared_")).length, "shared spaces are distinct from private modules");
  if (!plan.rooms.length) assert.ok(plan.warnings.length, "no impossible plan is silently presented");
  return plan;
}

let caseCount = 0;
for (const [widthM, depthM] of [[20, 20], [32, 24], [12, 18], [8, 9], [6, 6]]) {
  for (const use of ["main", "residential", "retail", "amenity", "hotel"]) {
    for (const coreType of ["center", "north", "split"]) {
      for (const hasAtrium of [false, true]) {
        validatePlan({ widthM, depthM, northShiftM: -3.2, zBottom: 9.6, zTop: 13.2, level: 4, use, hasAtrium }, { coreType, option: "A" });
        caseCount++;
      }
    }
  }
}

// Larger floors provide the requested use-specific spaces, rather than merely
// colouring one undivided slab or returning empty furniture/door collections.
for (const [use, required] of [
  ["main", ["office", "meeting", "meeting_small", "pantry"]],
  ["retail", ["showroom", "consultation", "storage"]],
  ["amenity", ["lounge", "pantry", "meeting"]]
]) {
  const plan = validatePlan({ widthM: 32, depthM: 24, northShiftM: 2.4, level: 5, zBottom: 12, zTop: 15.6, use, hasAtrium: true }, { coreType: "split" });
  assert.ok(plan.rooms.length >= 4 && plan.walls.length >= 8 && plan.furniture.length >= 4);
  required.forEach(type => assert.ok(plan.rooms.some(room => room.type === type), use + " includes " + type));
}

// Residential functions belong to one independently accessed unit, rather than
// labelling unrelated corridor rooms as the living room or kitchen of a home.
const residentialFp = { widthM: 32, depthM: 24, level: 5, zBottom: 12, zTop: 15.6, use: "residential", hasAtrium: false };
const apartments = validatePlan(residentialFp, { coreType: "north", residentialType: "apartment", housingUnitAreaSqm: 59 });
const officetels = validatePlan(residentialFp, { coreType: "north", residentialType: "officetel", housingUnitAreaSqm: 30 });
assert.ok(apartments.metrics.dwellingUnitCount > 0 && officetels.metrics.dwellingUnitCount > 0);
assert.ok(officetels.metrics.dwellingUnitCount > apartments.metrics.dwellingUnitCount, "smaller target modules affect fitted unit quantities");
assert.ok(apartments.dwellingUnits.every(unit => unit.residentialType === "apartment" && unit.subspaces.length === 4));
assert.ok(officetels.rooms.filter(room => room.type === "dwelling_unit").every(room => room.label.includes("오피스텔")));
assert.ok(apartments.assumptions.some(text => text.includes("주차 산정 세대수")), "interior draft count does not overwrite statutory parking inputs");
const movedResidential = generate({ ...residentialFp, northShiftM: 17.25 }, { coreType: "north", residentialType: "apartment", housingUnitAreaSqm: 59 });
assert.deepEqual(movedResidential.metrics, apartments.metrics);
apartments.dwellingUnits.forEach((unit, index) => unit.subspaces.forEach((space, n) => close(movedResidential.dwellingUnits[index].subspaces[n].minZ, space.minZ + 17.25, "private functional zone follows the stepped floor")));

const coliving = validatePlan(residentialFp, { coreType: "north", spaceProgram: "coliving", residentialType: "officetel" });
assert.ok(coliving.metrics.privateRoomCount > 0 && coliving.metrics.sharedSpaceCount >= 3);
assert.equal(coliving.metrics.dwellingUnitCount, 0, "a co-living bedroom is not counted as an independent dwelling");
const sharedIds = new Set(coliving.rooms.filter(room => room.type.startsWith("shared_")).map(room => room.id));
for (const type of ["sofa", "kitchen_counter", "washing_machine"]) assert.ok(coliving.furniture.some(item => item.type === type && sharedIds.has(item.roomId)), "co-living includes a fitted common " + type);
assert.ok(coliving.assumptions.some(text => text.includes("법적 건축물 용도 분류가 아닙니다")));
for (const [widthM, depthM] of [[20, 20], [12, 18], [8, 9]]) for (const coreType of ["center", "north", "split"]) {
  validatePlan({ ...residentialFp, widthM, depthM, hasAtrium: true }, { coreType, spaceProgram: "coliving" });
}

// A translated floor must translate every object, including cores, voids and
// doors; otherwise an upper stepped floor receives an offset interior.
const baseFp = { widthM: 24.2, depthM: 21.6, northShiftM: 0, level: 7, zBottom: 21.6, zTop: 25.2, use: "main", hasAtrium: true };
const base = generate(baseFp, { coreType: "north" });
const moved = generate({ ...baseFp, northShiftM: 17.25 }, { coreType: "north" });
for (const name of ["rooms", "cores", "voids", "corridors"]) {
  assert.equal(moved[name].length, base[name].length);
  base[name].forEach((r, i) => {
    close(moved[name][i].minX, r.minX, name + " x unchanged");
    close(moved[name][i].maxX, r.maxX, name + " x unchanged");
    close(moved[name][i].minZ, r.minZ + 17.25, name + " z shift");
    close(moved[name][i].maxZ, r.maxZ + 17.25, name + " z shift");
  });
}
for (const name of ["doors", "furniture"]) {
  base[name].forEach((item, i) => {
    close(moved[name][i].x, item.x, name + " x unchanged");
    close(moved[name][i].z, item.z + 17.25, name + " z shift");
  });
}
base.walls.forEach((wall, i) => {
  close(moved.walls[i].z1, wall.z1 + 17.25, "wall z1 shift");
  close(moved.walls[i].z2, wall.z2 + 17.25, "wall z2 shift");
});
close(moved.entry.z, base.entry.z + 17.25, "entry shifts");

// Hotel repetition is real geometry, including the private bathroom door and
// wet fixtures, so changes in the allowed floor envelope alter fitted keys.
const hotelFp = { widthM: 32, depthM: 24, northShiftM: 0, level: 6, zBottom: 18, zTop: 21.6, use: "hotel", hasAtrium: false };
const hotel = validatePlan(hotelFp, { coreType: "north" });
assert.ok(hotel.metrics.guestRoomCount > 0 && hotel.metrics.serviceAreaSqm > 0, "hotel includes fitted bedrooms and operational space");
assert.ok(hotel.assumptions.some(text => text.includes("법정 최소 기준이 아닙니다")), "planning assumptions are distinct from legal checks");
const smallerHotel = validatePlan({ ...hotelFp, widthM: 12, depthM: 18 }, { coreType: "north" });
assert.ok(smallerHotel.metrics.guestRoomCount < hotel.metrics.guestRoomCount, "smaller mass fits fewer real hotel modules");
const movedHotel = generate({ ...hotelFp, northShiftM: 17.25 }, { coreType: "north" });
assert.deepEqual(movedHotel.metrics, hotel.metrics, "translation preserves hotel quantities");
hotel.rooms.forEach((room, index) => {
  const shiftedRoom = movedHotel.rooms[index];
  assert.equal(shiftedRoom.type, room.type);
  if (!room.ensuite) return;
  close(shiftedRoom.ensuite.bounds.minZ, room.ensuite.bounds.minZ + 17.25, "hotel wet module moves with floor");
  close(shiftedRoom.ensuite.door.z, room.ensuite.door.z + 17.25, "private bathroom opening moves with floor");
});
hotel.furniture.forEach((item, index) => close(movedHotel.furniture[index].z, item.z + 17.25, "hotel furniture moves with floor"));

// Workstation dimensions and circulation spacing affect placed seats. These
// values are furniture-layout inputs and never a statutory occupancy formula.
const officeFp = { widthM: 32, depthM: 24, northShiftM: 0, level: 3, zBottom: 7.2, zTop: 10.8, use: "main", hasAtrium: false };
const compactOffice = validatePlan(officeFp, { coreType: "north", office: { aisleWidthM: 0.9, rowGapM: 0.7 } });
const spaciousOffice = validatePlan(officeFp, { coreType: "north", office: { aisleWidthM: 2.4, rowGapM: 2 } });
assert.ok(compactOffice.metrics.workstationCount > spaciousOffice.metrics.workstationCount, "more circulation space reduces fitted seats in this fixed envelope");
const wideDesks = validatePlan(officeFp, { coreType: "north", office: { deskWidthM: 1.8, deskDepthM: 0.9 } });
wideDesks.furniture.filter(item => item.type === "desk").forEach(desk => {
  assert.ok((Math.abs(desk.width - 1.8) < EPS && Math.abs(desk.depth - 0.9) < EPS)
    || (Math.abs(desk.depth - 1.8) < EPS && Math.abs(desk.width - 0.9) < EPS), "configured desk geometry is retained in either orientation");
});

const tiny = generate({ widthM: 5, depthM: 5, use: "residential", level: 1 });
assert.equal(tiny.rooms.length, 0);
assert.ok(tiny.warnings.length);
assert.equal(generate({ widthM: NaN, depthM: 20 }).rooms.length, 0);
assert.equal(generate({ widthM: -10, depthM: 20 }).rooms.length, 0);

// Identical browser and CommonJS APIs, with no DOM/THREE dependency.
const browser = { window: {} };
for (const name of ['core-layout.js','spatial-settings.js','office-layout.js','study-identity.js','hotel-modules.js'])
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), browser);
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../interior-plan.js"), "utf8"), browser);
assert.equal(typeof browser.window.AtelierInteriorPlan.generate, "function");
assert.deepEqual(JSON.parse(JSON.stringify(browser.window.AtelierInteriorPlan.generate(baseFp, { coreType: "north" }))), base);

console.log(`Interior draft geometry: ${caseCount} use/size/core/atrium combinations passed, plus program, translation, door-opening and browser API checks.`);
