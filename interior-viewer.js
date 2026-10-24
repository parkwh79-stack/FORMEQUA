/** Procedural interior studies. The room plan, 3D layers and SVG share one model. */
(() => {
  "use strict";
  const byId = id => document.getElementById(id);
  const useNames = { main: "오피스", retail: "리테일", residential: "주거", hotel: "호텔", amenity: "라운지" };
  const layerVisibility = { spaces: true, partitions: true, doors: true, furniture: true };
  let model = null, active = false, currentPlan = null, floor = null, group = null;
  let layers = {}, mode = "overview", source = "manual", externalPose = null, lastSignature = "";
  let parcelKey = null, lastFrame = 0, lastDetection = 0, lastExteriorPose = null;
  let lastEntryPoint = null, zoomEntryUntil = 0, lastAutoRequest = null;
  let shadowAutoUpdate = null;
  const keys = new Set(), heldDirections = new Map();
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const walk = { yaw: 0, pitch: 0, eyeY: 0, distance: 0, bob: 0, speed: 2.8, enabled: true, drag: null };
  const C = { slab: 0xd8d0c2, room: 0xeee9df, wall: 0xe3ddd2, wood: 0x9c8164, fabric: 0xb9b5a5,
    frame: 0x686858, core: 0xb4ac9a, glass: 0xa4afa6, ink: 0x45483e, door: 0xb39a78 };

  function disposeStudy() {
    if (!group) return;
    const geometries = new Set(), materials = new Set(), textures = new Set();
    group.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean).forEach(material => {
        materials.add(material); if (material.map) textures.add(material.map);
      });
    });
    scene.remove(group);
    geometries.forEach(item => item.dispose());
    textures.forEach(item => item.dispose());
    materials.forEach(item => item.dispose());
    group = null; layers = {};
  }

  function material(color, extra = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: .85, metalness: .02, ...extra });
  }

  function box(parent, x, y, z, width, height, depth, mat, kind) {
    const object = new THREE.Mesh(new THREE.BoxGeometry(Math.max(.015, width), Math.max(.015, height), Math.max(.015, depth)), mat);
    object.position.set(x, y, z);
    object.castShadow = true; object.receiveShadow = true;
    if (kind === "space") object.receiveShadow = false;
    object.userData = { level: floor.level, elementType: kind, generatedInterior: true };
    parent.add(object);
    return object;
  }

  function addLabel(room, y) {
    const canvas = document.createElement("canvas");
    canvas.width = 512; canvas.height = 160;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#45483e";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "400 50px Arial, 'SUIT Variable', sans-serif";
    ctx.fillText(room.label, 256, 58);
    ctx.font = "400 33px Arial, sans-serif";
    ctx.fillStyle = "#797b70";
    ctx.fillText(`${room.areaSqm.toFixed(1)} m²`, 256, 105);
    const texture = new THREE.CanvasTexture(canvas);
    texture.encoding = THREE.sRGBEncoding;
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    const width = Math.min(5.8, room.maxX - room.minX - .3);
    const object = new THREE.Mesh(new THREE.PlaneGeometry(width, width * .3125), mat);
    object.rotation.x = -Math.PI / 2;
    object.position.set((room.minX + room.maxX) / 2, y, (room.minZ + room.maxZ) / 2);
    object.userData = { level: floor.level, elementType: "roomLabel", roomId: room.id };
    object.renderOrder = 20;
    layers.spaces.add(object);
  }

  function buildStudy() {
    disposeStudy();
    group = new THREE.Group();
    group.name = `interior-floor-${floor.level}`;
    group.userData = { level: floor.level, use: floor.use, generatedInterior: true };
    scene.add(group);
    ["slabs", "ceilings", "shell", "core", "spaces", "partitions", "doors", "furniture", "route"].forEach(name => {
      layers[name] = new THREE.Group(); layers[name].name = name;
      layers[name].userData = { level: floor.level, elementType: name };
      layers[name].visible = layerVisibility[name] !== false;
      group.add(layers[name]);
    });
    const b = currentPlan.bounds, y = floor.zBottom + .3;
    const height = Math.max(1.8, Math.min(2.8, floor.zTop - floor.zBottom - .45));
    const mats = { slab: material(C.slab), wall: material(C.wall), wood: material(C.wood), fabric: material(C.fabric),
      core: material(C.core), frame: material(C.frame), door: material(C.door), room: material(C.room),
      glass: material(C.glass, { transparent: true, opacity: .14, depthWrite: false }) };

    // Real slab holes reserve the courtyard; the exterior mass is hidden in this view.
    const shape = new THREE.Shape();
    shape.moveTo(b.minX, -b.minZ); shape.lineTo(b.maxX, -b.minZ);
    shape.lineTo(b.maxX, -b.maxZ); shape.lineTo(b.minX, -b.maxZ); shape.closePath();
    currentPlan.voids.forEach(rect => {
      const hole = new THREE.Path();
      hole.moveTo(rect.minX, -rect.minZ); hole.lineTo(rect.minX, -rect.maxZ);
      hole.lineTo(rect.maxX, -rect.maxZ); hole.lineTo(rect.maxX, -rect.minZ); hole.closePath();
      shape.holes.push(hole);
    });
    const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: .24, bevelEnabled: false }), mats.slab);
    slab.rotation.x = -Math.PI / 2; slab.position.y = floor.zBottom + .06;
    slab.receiveShadow = false; slab.userData = { level: floor.level, elementType: "slab" };
    layers.slabs.add(slab);
    const ceiling = new THREE.Mesh(new THREE.ShapeGeometry(shape), material(C.wall, { side: THREE.DoubleSide }));
    ceiling.rotation.x = -Math.PI / 2; ceiling.position.y = y + height;
    ceiling.userData = { level: floor.level, elementType: "ceiling" };
    layers.ceilings.add(ceiling);

    currentPlan.rooms.forEach(room => {
      box(layers.spaces, (room.minX + room.maxX) / 2, y + .014, (room.minZ + room.maxZ) / 2,
        room.maxX - room.minX, .02, room.maxZ - room.minZ, mats.room, "space");
      addLabel(room, y + .055);
    });
    currentPlan.cores.forEach(rect => {
      box(layers.core, (rect.minX + rect.maxX) / 2, y + height / 2, (rect.minZ + rect.maxZ) / 2,
        rect.maxX - rect.minX, height, rect.maxZ - rect.minZ, mats.core, "core");
    });
    (currentPlan.obstacles || []).forEach(rect => box(layers.core, (rect.minX+rect.maxX)/2, y+height/2, (rect.minZ+rect.maxZ)/2,
      rect.maxX-rect.minX,height,rect.maxZ-rect.minZ,mats.frame,'input-obstacle'));
    currentPlan.walls.forEach(wall => {
      const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1;
      const wallHeight = Math.min(height, wall.height || height);
      const object = box(layers.partitions, (wall.x1 + wall.x2) / 2, y + wallHeight / 2, (wall.z1 + wall.z2) / 2,
        Math.hypot(dx, dz), wallHeight, wall.thickness || .12, mats.wall, "partition");
      object.rotation.y = -Math.atan2(dz, dx);
    });
    currentPlan.doors.forEach(door => {
      const alongX = door.axis === "x", doorHeight = Math.min(2.2, height - .12);
      const room = currentPlan.rooms.find(item => item.id === door.roomId);
      const inward = alongX ? Math.sign((room.minZ + room.maxZ) / 2 - door.z) : Math.sign((room.minX + room.maxX) / 2 - door.x);
      // Posts and lintel frame a genuine opening; an open leaf leaves the doorway clear.
      for (const sign of [-1, 1]) box(layers.doors,
        door.x + (alongX ? sign * door.width / 2 : 0), y + doorHeight / 2,
        door.z + (alongX ? 0 : sign * door.width / 2), .065, doorHeight, .065, mats.frame, "doorFrame");
      box(layers.doors, door.x, y + doorHeight + .035, door.z,
        alongX ? door.width + .08 : .08, .07, alongX ? .08 : door.width + .08, mats.frame, "doorLintel");
      // Display the door leaf in an open position, rather than sealing the opening.
      const leaf = box(layers.doors, door.x + (alongX ? -door.width / 2 : inward * door.width * .4), y + doorHeight / 2,
        door.z + (alongX ? inward * door.width * .4 : -door.width / 2), .045, doorHeight, door.width * .8, mats.door, "doorLeaf");
      if (!alongX) leaf.rotation.y = Math.PI / 2;
    });
    currentPlan.furniture.forEach(item => {
      const soft = /sofa|chair|bed/.test(item.type), desk = /desk|table|counter|vanity/.test(item.type);
      const piece = (dx, dy, dz, w, h, d, mat, type) => box(layers.furniture, item.x + dx, y + dy, item.z + dz, w, h, d, mat, type);
      if (/desk|table/.test(item.type)) {
        piece(0, item.height - .04, 0, item.width, .08, item.depth, mats.wood, item.type);
        for (const sx of [-1, 1]) for (const sz of [-1, 1])
          piece(sx * (item.width / 2 - .08), (item.height - .08) / 2, sz * (item.depth / 2 - .08), .045, item.height - .08, .045, mats.frame, "tableLeg");
        if (item.type === "desk") {
          piece(0, item.height + .17, -item.depth * .25, .44, .28, .025, mats.frame, "monitor");
          piece(0, item.height + .025, item.depth * .1, .35, .02, .14, mats.core, "keyboard");
        }
        return;
      }
      if (item.type === "chair") {
        piece(0, .43, 0, item.width, .08, item.depth * .9, mats.fabric, "chairSeat");
        piece(0, item.height * .78, -item.depth * .42, item.width, item.height * .44, .065, mats.fabric, "chairBack");
        for (const sx of [-1, 1]) for (const sz of [-1, 1])
          piece(sx * item.width * .35, .2, sz * item.depth * .3, .035, .4, .035, mats.frame, "chairLeg");
        return;
      }
      if (item.type === "sofa") {
        piece(0, item.height * .31, 0, item.width, item.height * .62, item.depth, mats.fabric, "sofaSeat");
        piece(0, item.height * .73, -item.depth * .4, item.width, item.height * .54, item.depth * .2, mats.fabric, "sofaBack");
        for (const sign of [-1, 1]) piece(sign * item.width * .45, item.height * .5, 0, item.width * .1, item.height * .45, item.depth, mats.fabric, "sofaArm");
        return;
      }
      const furniture = box(layers.furniture, item.x, y + item.height / 2, item.z,
        item.width, item.height, item.depth, soft ? mats.fabric : mats.wood, item.type);
      furniture.rotation.y = item.rotationY || 0;
      furniture.userData.roomId = item.roomId;
      if (desk) box(layers.furniture, item.x, y + item.height + .035, item.z,
        item.width + .015, .07, item.depth + .015, mats.room, `${item.type}Top`);
      if (item.type === "bed") box(layers.furniture, item.x, y + item.height + .06,
        item.z - item.depth * .3, item.width * .82, .12, item.depth * .22, mats.room, "pillow");
    });
    // Restrained perimeter glazing lets the context read as an architectural interior.
    const width = b.maxX - b.minX, depth = b.maxZ - b.minZ;
    for (const z of [b.minZ, b.maxZ]) {
      box(layers.shell, 0, y + .25, z, width, .5, .16, mats.wall, "externalSill");
      box(layers.shell, 0, y + height / 2 + .2, z, width, height - .5, .035, mats.glass, "window");
      const count = Math.max(2, Math.round(width / 3));
      for (let n = 0; n <= count; n++) box(layers.shell, b.minX + width * n / count,
        y + height / 2, z, .065, height, .1, mats.frame, "windowFrame");
    }
    for (const x of [b.minX, b.maxX]) {
      box(layers.shell, x, y + .25, (b.minZ + b.maxZ) / 2, .16, .5, depth, mats.wall, "externalSill");
      box(layers.shell, x, y + height / 2 + .2, (b.minZ + b.maxZ) / 2, .035, height - .5, depth, mats.glass, "window");
      const count = Math.max(2, Math.round(depth / 3));
      for (let n = 0; n <= count; n++) box(layers.shell, x, y + height / 2,
        b.minZ + depth * n / count, .1, height, .065, mats.frame, "windowFrame");
    }
    const entry = new THREE.Mesh(new THREE.RingGeometry(.15, .27, 32), material(C.frame, { side: THREE.DoubleSide }));
    entry.rotation.x = -Math.PI / 2; entry.position.set(currentPlan.entry.x, y + .05, currentPlan.entry.z);
    layers.slabs.add(entry);
    applyVisibility();
    // Interior geometry is static until the next plan/layer change. Reuse its shadow
    // map while walking rather than redrawing hundreds of shadow casters each frame.
    if (renderer?.shadowMap) renderer.shadowMap.needsUpdate = true;
  }

  function applyVisibility() {
    if (!scene) return;
    [buildingGroup, contextGroup, envelopeGroup, dimensionGroup, groundMesh, gridHelper].filter(Boolean)
      .forEach(object => { object.visible = !active; });
    if (group) group.visible = active;
    if (active) { scene.fog = null; scene.background = new THREE.Color(0xf5f3ee); }
    else if (typeof applyStudioThemeToScene === "function") applyStudioThemeToScene();
    document.body.classList.toggle("interior-active", active);
    byId("interiorControls").hidden = !active;
  }

  function capturePose() {
    return { position: camera.position.clone(), target: controls.target.clone(), fov: camera.fov,
      minPolar: controls.minPolarAngle, maxPolar: controls.maxPolarAngle, minDistance: controls.minDistance,
      maxDistance: controls.maxDistance, enablePan: controls.enablePan, enabled: controls.enabled,
      enableDamping: controls.enableDamping, dampingFactor: controls.dampingFactor, zoomSpeed: controls.zoomSpeed };
  }

  function rememberExterior(origin) {
    if (externalPose || !camera || !controls) return;
    externalPose = origin === "auto" && lastExteriorPose ? lastExteriorPose : capturePose();
    if (origin === "auto" && !lastExteriorPose) {
      externalPose.position.set(82, 74, 92); externalPose.target.set(0, 24, 0);
    }
  }

  function pickFloor(level) {
    return model?.floorPlates.find(fp => fp.level === Number(level)) || model?.floorPlates[Math.min(4, model.floorPlates.length - 1)];
  }

  function notifyInteriorChange() {
    if (typeof window.CustomEvent !== "function") return;
    window.dispatchEvent(new window.CustomEvent("atelier:interior-change", {
      detail: { active, level: floor?.level ?? null, mode, source, plan: currentPlan }
    }));
  }

  function openInterior(level, origin = "manual", view = "overview") {
    if (model?.representation?.detailLevel === "massing" || model?.coreLayout?.status === "unfeasible") return false;
    if (!model || !camera || !controls || typeof AtelierInteriorPlan === "undefined") return false;
    const selected = pickFloor(level);
    if (!selected) return false;
    rememberExterior(origin);
    if (!active && renderer?.shadowMap) {
      shadowAutoUpdate = renderer.shadowMap.autoUpdate;
      renderer.shadowMap.autoUpdate = false;
    }
    active = true; source = origin; floor = selected;
    state.selectedFloorLevel = floor.level;
    byId("interiorFloorSelect").value = floor.level;
    currentPlan = AtelierInteriorPlan.generate(floor, { coreType: state.coreType, option: state.option,
      ...window.AtelierSpatialSettings?.select(state),
      parcelKey: state.parcelKey, parcelData: state.parcelData, projectId: state.projectId, hotelAdrKrw: state.hotelAdrKrw, hotelOccupancyPct:state.hotelOccupancyPct,hotelRoomsOverride:state.hotelRoomsOverride,
      spaceProgram: state.spaceProgram, residentialType: state.residentialType, housingUnitAreaSqm: state.housingUnitAreaSqm });
    window.AtelierStudyReviewSnapshot?.recordPlans({ model, floor, plan: currentPlan });
    lastSignature = signature();
    buildStudy(); setView(currentPlan.rooms.length ? view : "overview");
    const m = currentPlan.metrics;
    const programCount = floor.use === "hotel" ? ` · 객실 ${m.guestRoomCount}개 / 침대 ${m.guestBedCount}개`
      : floor.use === "main" ? ` · 업무 좌석 ${m.workstationCount}석`
      : floor.use === "residential" ? currentPlan.spaceProgram === "coliving"
        ? ` · 개인실 ${m.privateRoomCount}개 / 공용 공간 ${m.sharedSpaceCount}개`
        : ` · 배치 초안 ${m.dwellingUnitCount}세대` : "";
    byId("interiorPlanSummary").textContent = `${floor.level}F · ${useNames[floor.use]} · ${m.roomCount}개 실${programCount} · 문 ${m.doorCount}개`;
    document.querySelector('[data-interior-view="perspective"]').disabled = m.roomCount === 0;
    lastEntryPoint = null; lastAutoRequest = null;
    return true;
  }

  function exitInterior() {
    if (!active) return false;
    active = false; clearWalkInput();
    byId("threeCanvas").classList.remove("interior-walk-ready");
    if (byId("interiorFootwork")) byId("interiorFootwork").hidden = true;
    if (renderer?.shadowMap && shadowAutoUpdate !== null) {
      renderer.shadowMap.autoUpdate = shadowAutoUpdate;
      renderer.shadowMap.needsUpdate = true; shadowAutoUpdate = null;
    }
    disposeStudy(); applyVisibility();
    if (state.lastComputed?.model) {
      rebuild3DScene(state.lastComputed.model);
      renderFloorInspectorCard(state.lastComputed.model);
    }
    if (externalPose && camera && controls) {
      controls.enableDamping = false;
      controls.update();
      camera.position.copy(externalPose.position); controls.target.copy(externalPose.target);
      camera.fov = externalPose.fov; controls.minPolarAngle = externalPose.minPolar;
      controls.maxPolarAngle = externalPose.maxPolar; controls.minDistance = externalPose.minDistance;
      controls.maxDistance = externalPose.maxDistance; controls.enablePan = externalPose.enablePan;
      controls.enabled = externalPose.enabled; controls.zoomSpeed = externalPose.zoomSpeed;
      controls.dampingFactor = externalPose.dampingFactor;
      camera.updateProjectionMatrix(); controls.update(); controls.enableDamping = externalPose.enableDamping;
    }
    externalPose = null;
    byId("interiorControls").hidden = true;
    lastEntryPoint = null; lastAutoRequest = null;
    notifyInteriorChange();
    return true;
  }

  function canStand(x, z, margin = .22) {
    return AtelierInteriorWalk.canStand(currentPlan, x, z, margin);
  }

  function clearWalkInput() {
    const directionPointers = [...heldDirections.keys()], dragId = walk.drag?.id;
    keys.clear(); heldDirections.clear(); walk.drag = null;
    const canvas = byId("threeCanvas");
    if (canvas) {
      canvas.classList.remove("interior-walk-dragging");
      if (dragId !== undefined && canvas.hasPointerCapture?.(dragId)) canvas.releasePointerCapture(dragId);
    }
    document.querySelectorAll("[data-walk-direction]").forEach(button => directionPointers.forEach(id => {
      if (button.hasPointerCapture?.(id)) button.releasePointerCapture(id);
    }));
  }

  function walkAvailable() {
    return active && mode === "perspective" && camera && controls && !document.hidden
      && !document.body.classList.contains("design-open") && !document.body.classList.contains("analysis-open");
  }

  function syncWalkPose() {
    camera.position.y = walk.eyeY + walk.bob;
    const horizontal = Math.cos(walk.pitch);
    controls.target.set(camera.position.x + Math.sin(walk.yaw) * horizontal,
      camera.position.y + Math.sin(walk.pitch), camera.position.z - Math.cos(walk.yaw) * horizontal);
    camera.lookAt(controls.target);
    const readout = byId("interiorWalkDistance");
    if (readout) {
      const heading = Math.round((walk.yaw * 180 / Math.PI % 360 + 360) % 360);
      const text = `이동 ${walk.distance.toFixed(1)} m · 시선 ${heading}°`;
      if (readout.textContent !== text) readout.textContent = text;
    }
  }

  function takeStep(forward, right, distance) {
    const movement = AtelierInteriorWalk.direction(walk.yaw, forward, right, distance);
    const next = AtelierInteriorWalk.move(currentPlan, camera.position, movement);
    camera.position.x = next.x; camera.position.z = next.z;
    walk.distance += next.travelled;
    return next.travelled;
  }

  function setView(nextMode) {
    if (!active || !currentPlan) return false;
    mode = nextMode; clearWalkInput();
    const b = currentPlan.bounds, centerZ = (b.minZ + b.maxZ) / 2;
    const width = b.maxX - b.minX, depth = b.maxZ - b.minZ, base = floor.zBottom + .3;
    controls.enableDamping = false;
    controls.update();
    controls.enabled = mode !== "perspective";
    controls.zoomSpeed = 1.9; controls.dampingFactor = .2;
    controls.minDistance = .25; controls.maxDistance = Math.max(150, width * 5);
    controls.minPolarAngle = .001; controls.maxPolarAngle = Math.PI * .48; controls.enablePan = true;
    camera.fov = mode === "perspective" ? 62 : 40;
    camera.updateProjectionMatrix();
    if (mode === "perspective") {
      const entry = currentPlan.entry;
      const eyeY = base + Math.min(1.65, (floor.zTop - floor.zBottom) * .55);
      let direction = { x: 1, z: 0 }, longest = -1;
      [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dz]) => {
        let distance = 0;
        for (let step = .25; step <= 4 && canStand(entry.x + dx * step, entry.z + dz * step); step += .25) distance = step;
        if (distance > longest) { longest = distance; direction = { x: dx, z: dz }; }
      });
      camera.position.set(entry.x, eyeY, entry.z);
      controls.target.set(entry.x + direction.x * 2, eyeY, entry.z + direction.z * 2);
      walk.yaw = Math.atan2(direction.x, -direction.z); walk.pitch = 0;
      walk.eyeY = eyeY; walk.distance = 0; walk.bob = 0;
      controls.minDistance = .01; controls.maxPolarAngle = Math.PI - .001;
      syncWalkPose();
      byId("interiorPlanNote").textContent = "실내 투시 · 드래그로 즉시 시선 회전, 휠로 앞뒤 보행 · W/A/S/D·방향키, Shift 빠른 걸음 · 방·내벽·문·가구는 자동 배치 초안입니다.";
      byId("threeCanvas").focus({ preventScroll: true });
    } else if (mode === "plan") {
      const distance = Math.max(depth, width / Math.max(.3, camera.aspect)) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.18;
      camera.position.set(0, base + distance, centerZ + .01);
      controls.target.set(0, base, centerZ);
      controls.minPolarAngle = .001; controls.maxPolarAngle = .001;
    } else {
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const limitingAngle = Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect));
      const radius = Math.hypot(width, depth, 3) / 2;
      const offset = new THREE.Vector3(.68, .95, .92).normalize().multiplyScalar(radius / Math.sin(limitingAngle) * 1.07);
      controls.target.set(0, base + .7, centerZ);
      camera.position.copy(controls.target).add(offset);
    }
    controls.update(); controls.enableDamping = mode !== "perspective";
    byId("threeCanvas").classList.toggle("interior-walk-ready", mode === "perspective");
    if (byId("interiorFootwork")) byId("interiorFootwork").hidden = mode !== "perspective";
    if (mode !== "perspective") byId("interiorPlanNote").textContent = `용도에 따른 자동 배치 초안 · 공간 구성과 치수는 설계 검토가 필요합니다.${currentPlan.warnings.length ? " " + currentPlan.warnings.join(" ") : ""}`;
    layers.spaces.children.filter(object => object.userData.elementType === "roomLabel").forEach(object => { object.visible = mode !== "perspective"; });
    layers.ceilings.visible = mode === "perspective";
    if (renderer?.shadowMap) renderer.shadowMap.needsUpdate = true;
    document.querySelectorAll("[data-interior-view]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.interiorView === mode)));
    notifyInteriorChange();
    return true;
  }

  function signature() {
    const coreLayout = floor?.coreLayout;
    // Finance-only ledger changes must not reset an active camera. A changed
    // shared core footprint/status must rebuild the visible interior.
    return JSON.stringify([floor?.level, floor?.use, floor?.widthM, floor?.depthM, floor?.northShiftM,
      floor?.zBottom, floor?.zTop, floor?.hasAtrium, coreLayout !== undefined, coreLayout?.status, coreLayout?.cores,
      model?.representation?.detailLevel, state.coreType, state.option, state.daylightTheme, state.spaceProgram, state.residentialType, state.housingUnitAreaSqm,
      window.AtelierSpatialSettings?.select(state), state.parcelKey, window.AtelierStudyIdentity?.scope(state)]);
  }

  function updateModel(detail) {
    model = detail?.model || state.lastComputed?.model;
    const select = byId("interiorFloorSelect");
    const entryButton = byId("btnOpenInterior");
    const inspectorButton = byId("btnInspectInterior");
    const hasFloors = Boolean(model?.floorPlates?.length);
    const detailAvailable = model?.representation?.detailLevel !== "massing" && model?.coreLayout?.status !== "unfeasible";
    const viewerAvailable = typeof scene !== "undefined" && Boolean(scene) && typeof renderer !== "undefined" && Boolean(renderer);
    entryButton.disabled = !hasFloors || !viewerAvailable || !detailAvailable;
    select.disabled = !hasFloors || !viewerAvailable || !detailAvailable;
    if (inspectorButton) inspectorButton.disabled = !hasFloors || !viewerAvailable || !detailAvailable || !model.floorPlates.some(fp => fp.level === state.selectedFloorLevel);
    if (!detailAvailable) {
      exitInterior();
      byId("interiorPlanSummary").textContent = model?.representation?.detailLevel === "massing"
        ? "간략 매스 표시 중 · 개념 상세 · 실내를 선택하면 실내를 검토할 수 있습니다."
        : "공통 동선·코어 예약 미완료 · 실내 생성 조건을 먼저 확인하세요.";
    }
    if (!hasFloors) {
      exitInterior();
      select.replaceChildren();
      floor = null; currentPlan = null; lastSignature = "";
      byId("interiorPlanSummary").textContent = "현재 조건에서 생성된 지상층이 없습니다.";
      return;
    }
    if (parcelKey && parcelKey !== state.parcelKey) exitInterior();
    parcelKey = state.parcelKey;
    const selected = active ? floor?.level : (state.selectedFloorLevel || select.value || 5);
    select.replaceChildren(...model.floorPlates.map(fp => {
      const option = document.createElement("option"); option.value = fp.level;
      option.textContent = `${String(fp.level).padStart(2, "0")}F · ${useNames[fp.use] || "업무"}`;
      return option;
    }));
    floor = pickFloor(selected); select.value = floor?.level || "";
    if (active) {
      if (signature() !== lastSignature) openInterior(floor.level, source, mode);
      else {
        if(currentPlan?.use==='hotel' && window.AtelierHotelModules) currentPlan=window.AtelierHotelModules.assignRooms(currentPlan,state);
        applyVisibility();
      }
    }
  }

  function floorEntryRegions(fp) {
    const x = fp.widthM / 2 - .45, z = fp.depthM / 2 - .45, shift = fp.northShiftM || 0;
    const y0 = fp.zBottom + .4, y1 = fp.zTop - .25;
    if (![x, z, shift, y0, y1].every(Number.isFinite) || x <= 0 || z <= 0 || y1 <= y0) return [];
    const make = (minX, maxX, minZ, maxZ) => ({ minX, maxX, minZ, maxZ, minY: y0, maxY: y1 });
    if (!fp.hasAtrium) return [make(-x, x, shift - z, shift + z)];
    const holeX = fp.widthM * .175, holeZ = fp.depthM * .175;
    // A vertical courtyard is empty space, including during a large wheel step.
    return [make(-x, -holeX, shift - z, shift + z), make(holeX, x, shift - z, shift + z),
      make(-holeX, holeX, shift - z, shift - holeZ), make(-holeX, holeX, shift + holeZ, shift + z)]
      .filter(box => box.maxX > box.minX && box.maxZ > box.minZ);
  }

  function regionEntry(start, end, box) {
    let first = 0, last = 1;
    for (const [axis, min, max] of [["x", box.minX, box.maxX], ["y", box.minY, box.maxY], ["z", box.minZ, box.maxZ]]) {
      const delta = end[axis] - start[axis];
      if (Math.abs(delta) < 1e-9) {
        if (start[axis] <= min || start[axis] >= max) return null;
        continue;
      }
      const a = (min - start[axis]) / delta, b = (max - start[axis]) / delta;
      first = Math.max(first, Math.min(a, b)); last = Math.min(last, Math.max(a, b));
      if (last - first <= 1e-7) return null;
    }
    return first;
  }

  function detectCameraEntry(now) {
    if (!model || !camera || !controls || now - lastDetection < 140) return;
    lastDetection = now;
    if (model.coreLayout?.status === "unfeasible" || state.isRecording) { lastEntryPoint = null; return; }
    if (active) {
      // Manual studies remain open while the visitor orbits the isolated floor.
      if (source === "auto" && mode === "perspective") {
        const b = currentPlan.bounds;
        if (camera.position.x < b.minX - 1.5 || camera.position.x > b.maxX + 1.5 || camera.position.z < b.minZ - 1.5 || camera.position.z > b.maxZ + 1.5 || camera.position.y < floor.zBottom || camera.position.y > floor.zTop + 1.5) exitInterior();
      }
      return;
    }
    const focus = document.body.classList.contains("model-focus");
    const massing = model.representation?.detailLevel === "massing";
    if (state.viewMode !== "standard" || (massing && !focus)) { lastEntryPoint = null; return; }
    const p = camera.position;
    let candidate = model.floorPlates.find(fp => floorEntryRegions(fp).some(box =>
      p.x > box.minX && p.x < box.maxX && p.y > box.minY && p.y < box.maxY && p.z > box.minZ && p.z < box.maxZ));
    if (!candidate && lastEntryPoint && Date.now() < zoomEntryUntil) {
      const target = controls.target;
      const distance = point => Math.hypot(point.x - target.x, point.y - target.y, point.z - target.z);
      // Sweep only an inward zoom. Orbiting around an exterior or approaching a
      // facade without crossing its actual volume must not open a floor.
      if (distance(p) < distance(lastEntryPoint) - .001) {
        let first = Infinity;
        for (const fp of model.floorPlates) for (const box of floorEntryRegions(fp)) {
          const entry = regionEntry(lastEntryPoint, p, box);
          if (entry !== null && entry < first) { candidate = fp; first = entry; }
        }
      }
    }
    lastEntryPoint = { x: p.x, y: p.y, z: p.z };
    if (candidate) {
      if (massing) {
        if (typeof window.CustomEvent === "function" && (!lastAutoRequest || lastAutoRequest.level !== candidate.level || now - lastAutoRequest.at > 700)) {
          lastAutoRequest = { level: candidate.level, at: now };
          window.dispatchEvent(new window.CustomEvent("atelier:interior-request", {
            detail: { level: candidate.level, origin: "auto", view: "perspective" }
          }));
        }
      } else openInterior(candidate.level, "auto", "perspective");
    } else lastExteriorPose = capturePose();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const delta = Math.min(.05, (now - (lastFrame || now)) / 1000); lastFrame = now;
    if (active && mode === "perspective") {
      if (!walkAvailable()) clearWalkInput();
      else {
        const pressed = key => keys.has(key) || [...heldDirections.values()].includes(key);
        let travelled = 0;
        if (walk.enabled) {
          const forward = Number(pressed("w") || pressed("arrowup")) - Number(pressed("s") || pressed("arrowdown"));
          const right = Number(pressed("d") || pressed("arrowright")) - Number(pressed("a") || pressed("arrowleft"));
          travelled = takeStep(forward, right, delta * walk.speed * (keys.has("shift") ? 1.7 : 1));
        }
        const targetBob = travelled > .0001 && !reducedMotion?.matches ? AtelierInteriorWalk.gaitOffset(walk.distance) : 0;
        // Relax at rest; never keep stepping/bobbing into a wall or after releasing a key.
        walk.bob += (targetBob - walk.bob) * Math.min(1, delta * 20);
        syncWalkPose();
      }
    }
    detectCameraEntry(now);
  }

  function installWalkControls(canvas) {
    const toolbar = document.createElement("div");
    toolbar.id = "interiorFootwork"; toolbar.className = "interior-footwork";
    toolbar.hidden = true; toolbar.setAttribute("aria-label", "실내 풋워크 보행 제어");
    toolbar.innerHTML = `<span class="walk-heading">FOOTWORK · 실내 보행</span>
      <button id="btnInteriorWalk" type="button" aria-pressed="true">보행 켜짐</button>
      <div class="walk-direction-pad" role="group" aria-label="보행 방향">
        <button type="button" data-walk-direction="a" aria-label="왼쪽으로 걷기">← 좌</button>
        <button type="button" data-walk-direction="w" aria-label="앞으로 걷기">↑ 앞</button>
        <button type="button" data-walk-direction="s" aria-label="뒤로 걷기">↓ 뒤</button>
        <button type="button" data-walk-direction="d" aria-label="오른쪽으로 걷기">우 →</button>
      </div>
      <label for="interiorWalkSpeed">보행 속도 <select id="interiorWalkSpeed">
        <option value="1.6">천천히 · 1.6 m/s</option><option value="2.8" selected>빠르게 · 2.8 m/s</option><option value="4.2">신속 · 4.2 m/s</option>
      </select></label>
      <output id="interiorWalkDistance" aria-label="보행 이동 거리와 시선 방향">이동 0.0 m · 시선 0°</output>
      <span class="walk-help">드래그: 시선 · 휠: 앞뒤 · WASD / 방향키: 걷기 · Shift: 빠른 걸음 · 벽과 가구 앞에서 멈춥니다.</span>`;
    byId("interiorControls").append(toolbar);
    byId("btnInteriorWalk").addEventListener("click", event => {
      walk.enabled = !walk.enabled; clearWalkInput();
      event.currentTarget.setAttribute("aria-pressed", String(walk.enabled));
      event.currentTarget.textContent = walk.enabled ? "보행 켜짐" : "보행 일시정지";
      canvas.focus({ preventScroll: true });
    });
    byId("interiorWalkSpeed").addEventListener("change", event => { walk.speed = Number(event.target.value); clearWalkInput(); });
    const releaseDirection = event => {
      heldDirections.delete(event.pointerId);
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };
    toolbar.querySelectorAll("[data-walk-direction]").forEach(button => {
      button.addEventListener("pointerdown", event => {
        if (!walkAvailable() || !walk.enabled || (event.pointerType === "mouse" && event.button !== 0)) return;
        event.preventDefault(); canvas.focus({ preventScroll: true });
        heldDirections.set(event.pointerId, button.dataset.walkDirection);
        button.setPointerCapture?.(event.pointerId);
        const key = button.dataset.walkDirection;
        takeStep(key === "w" ? 1 : key === "s" ? -1 : 0, key === "d" ? 1 : key === "a" ? -1 : 0, .18);
        syncWalkPose();
      });
      button.addEventListener("pointerup", releaseDirection);
      button.addEventListener("pointercancel", releaseDirection);
      button.addEventListener("lostpointercapture", event => heldDirections.delete(event.pointerId));
    });
    canvas.addEventListener("pointerdown", event => {
      if (!walkAvailable() || (event.pointerType === "mouse" && event.button !== 0)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      canvas.focus({ preventScroll: true });
      walk.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture?.(event.pointerId);
      canvas.classList.add("interior-walk-dragging");
    }, { capture: true });
    canvas.addEventListener("pointermove", event => {
      if (!walkAvailable() || !walk.drag || walk.drag.id !== event.pointerId) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const dx = event.clientX - walk.drag.x, dy = event.clientY - walk.drag.y;
      walk.drag.x = event.clientX; walk.drag.y = event.clientY;
      walk.yaw += dx * .0032;
      walk.pitch = Math.max(-1.35, Math.min(1.35, walk.pitch - dy * .0032));
      syncWalkPose();
    }, { capture: true });
    const endLook = event => {
      if (!walk.drag || walk.drag.id !== event.pointerId) return;
      walk.drag = null; canvas.classList.remove("interior-walk-dragging");
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener("pointerup", endLook, { capture: true });
    canvas.addEventListener("pointercancel", endLook, { capture: true });
    canvas.addEventListener("lostpointercapture", endLook);
    canvas.addEventListener("wheel", event => {
      if (!walkAvailable() || event.ctrlKey || event.metaKey) return;
      // Only the hovered canvas captures wheel motion. The rest of either page scrolls normally.
      event.preventDefault(); event.stopImmediatePropagation();
      if (!walk.enabled) return;
      const distance = AtelierInteriorWalk.wheelDistance(event.deltaY, event.deltaMode);
      takeStep(1, 0, distance); syncWalkPose();
    }, { passive: false, capture: true });
    canvas.addEventListener("wheel", event => {
      if (!active && event.deltaY < 0 && !event.ctrlKey && !event.metaKey) zoomEntryUntil = Date.now() + 700;
    }, { passive: true });
  }

  function exportSvg() {
    if (!currentPlan) return;
    const escape = value => String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&apos;" }[c]));
    const b = currentPlan.bounds, scale = 22, pad = 36;
    const x = value => pad + (value - b.minX) * scale, z = value => pad + (value - b.minZ) * scale;
    const width = (b.maxX - b.minX) * scale + pad * 2, height = (b.maxZ - b.minZ) * scale + pad * 2 + 65;
    const rect = (r, fill) => `<rect x="${x(r.minX)}" y="${z(r.minZ)}" width="${(r.maxX-r.minX)*scale}" height="${(r.maxZ-r.minZ)*scale}" fill="${fill}" stroke="#a49d8d" stroke-width=".5"/>`;
    const content = [rect(b,"#e1dbd0"), ...currentPlan.rooms.map(r=>rect(r,"#f5f3ee")), ...currentPlan.cores.map(r=>rect(r,"#b4ac9a")), ...currentPlan.voids.map(r=>rect(r,"#fff")),
      ...(currentPlan.obstacles||[]).map(r=>rect(r,'#686858')),
      ...currentPlan.furniture.map(f=>rect({minX:f.x-f.width/2,maxX:f.x+f.width/2,minZ:f.z-f.depth/2,maxZ:f.z+f.depth/2},"#c1b5a3")),
      ...currentPlan.walls.map(w=>`<line x1="${x(w.x1)}" y1="${z(w.z1)}" x2="${x(w.x2)}" y2="${z(w.z2)}" stroke="#55584e" stroke-width="${Math.max(1.5,(w.thickness||.12)*scale)}"/>`),
      ...currentPlan.doors.map(d=>{
        const r = currentPlan.rooms.find(room=>room.id===d.roomId);
        const inward = d.axis==='x' ? Math.sign((r.minZ+r.maxZ)/2-d.z) : Math.sign((r.minX+r.maxX)/2-d.x);
        return `<path d="M ${x(d.x-(d.axis==='x'?d.width/2:0))} ${z(d.z-(d.axis==='z'?d.width/2:0))} l ${d.axis==='x'?0:inward*d.width*scale*.8} ${d.axis==='x'?inward*d.width*scale*.8:0}" stroke="#9c8164" fill="none"/>`;
      }),
      ...currentPlan.rooms.map(r=>`<text x="${x((r.minX+r.maxX)/2)}" y="${z((r.minZ+r.maxZ)/2)}" text-anchor="middle" fill="#45483e" font-size="10">${escape(r.label)} · ${r.areaSqm.toFixed(1)} m²</text>`)].join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>FORMEQUA ${floor.level}F interior study</title><rect width="100%" height="100%" fill="#fff"/><g font-family="Arial,sans-serif">${content}<text x="36" y="${height-37}" fill="#45483e" font-size="13">FORMEQUA · ${floor.level}F · ${escape(useNames[floor.use])}</text><text x="36" y="${height-17}" fill="#797b70" font-size="10">자동 배치 초안 · 치수와 공간 구성은 설계 검토 필요 · 단위 m</text></g></svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `seoul-atelier-${state.parcelKey}-${floor.level}F-interior-study.svg`; link.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  }

  window.AtelierInteriorViewer = Object.freeze({
    open: (level, { origin = "manual", view = "overview" } = {}) => openInterior(level,
      origin === "auto" ? "auto" : "manual", ["overview", "plan", "perspective"].includes(view) ? view : "overview"),
    exit: exitInterior,
    isActive: () => active,
    getState: () => ({ active, level: floor?.level ?? null, mode, source })
  });

  window.addEventListener("atelier:updated", event => updateModel(event.detail));
  window.addEventListener("atelier:plan-selected", event => {
    if (!active) return;
    const detail = event.detail, latest = state.lastComputed?.model;
    // Ignore queued drawings from an earlier calculation. A current drawing and
    // the 3D interior must refer to precisely the same calculated floor list.
    if (!latest || !detail || detail.model !== latest) return;
    const level = detail.floor?.level;
    const selected = Number.isInteger(level) && level > 0 && latest.floorPlates?.find(fp => fp.level === level);
    if (!selected || !detail.plan || latest.representation?.detailLevel === "massing" || latest.coreLayout?.status === "unfeasible") {
      exitInterior();
      return;
    }
    // Rendering or highlighting this same drawing is frequent, including during
    // walking. Only an actual floor change may rebuild geometry/reset the eye.
    if (floor?.level === level) return;
    model = latest;
    openInterior(level, source, mode);
  });
  window.addEventListener('atelier:navigation-path', event => {
    const d=event.detail;
    if (!d || !Array.isArray(d.points) || !d.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.z))) return;
    if(d.points.length<2) {
      for(const object of [...(layers.route?.children||[])]){layers.route.remove(object);object.geometry?.dispose();object.material?.dispose();}
      return;
    }
    if (!active || floor?.level!==d.level) openInterior(d.level,'manual','overview');
    if (!layers.route || floor?.level!==d.level) return;
    for (const object of [...layers.route.children]) { layers.route.remove(object); object.geometry?.dispose(); object.material?.dispose(); }
    if(d.points.length<2) return;
    const geometry=new THREE.BufferGeometry().setFromPoints(d.points.map(p=>new THREE.Vector3(p.x,floor.zBottom+.38,p.z)));
    const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:0x237ca1,depthTest:false}));
    line.renderOrder=40; layers.route.add(line);
  });
  window.addEventListener("atelier:scene-rebuilt", () => { if (active) applyVisibility(); });
  window.addEventListener("DOMContentLoaded", () => {
    if (typeof scene === "undefined" || !scene || !renderer || typeof AtelierInteriorWalk === "undefined") {
      byId("btnOpenInterior").disabled = true; return;
    }
    const canvas = byId("threeCanvas"); canvas.tabIndex = 0; canvas.setAttribute("aria-label", "건축 3D 모형과 실내 평면");
    installWalkControls(canvas);
    updateModel();
    byId("btnOpenInterior").addEventListener("click", () => {
      openInterior(state.selectedFloorLevel > 0 ? state.selectedFloorLevel : byId("interiorFloorSelect").value);
      byId("interiorControls").scrollIntoView({ behavior: "instant", block: "start" });
    });
    byId("btnInspectInterior").addEventListener("click", () => {
      if (state.selectedFloorLevel < 1) return;
      openInterior(state.selectedFloorLevel);
      byId("interiorControls").scrollIntoView({ behavior: "instant", block: "start" });
    });
    byId("btnExitInterior").addEventListener("click", exitInterior);
    byId("btnRecordVideo").addEventListener("click", exitInterior, { capture: true });
    byId("interiorFloorSelect").addEventListener("change", event => openInterior(event.target.value, "manual", mode));
    byId("btnExportInterior").addEventListener("click", exportSvg);
    document.querySelectorAll("[data-interior-view]").forEach(button => button.addEventListener("click", () => setView(button.dataset.interiorView)));
    document.querySelectorAll("[data-interior-layer]").forEach(button => button.addEventListener("click", () => {
      const name = button.dataset.interiorLayer;
      layerVisibility[name] = !layerVisibility[name];
      if (layers[name]) layers[name].visible = layerVisibility[name];
      if (renderer?.shadowMap) renderer.shadowMap.needsUpdate = true;
      button.setAttribute("aria-pressed", String(layerVisibility[name]));
    }));
    document.querySelectorAll(".view-btn").forEach(button => button.addEventListener("click", () => { if (active) exitInterior(); }));
    document.addEventListener("keydown", event => {
      if (!walkAvailable() || !walk.enabled || document.activeElement !== canvas || event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright","shift"].includes(key)) { event.preventDefault(); keys.add(key); }
    });
    document.addEventListener("keyup", event => keys.delete(event.key.toLowerCase()));
    canvas.addEventListener("blur", clearWalkInput);
    window.addEventListener("blur", clearWalkInput);
    document.addEventListener("visibilitychange", () => { if (document.hidden) clearWalkInput(); });
    requestAnimationFrame(frame);
  });
})();
