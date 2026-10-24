/* Anonymous architectural illustrations. No live scene, map or project state is read. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AtelierStudyRenderer = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  const VERSION = "architectural-axon-v3", WIDTH = 1600, HEIGHT = 1000, MAX_BOXES = 26000;
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const PALETTES = Object.freeze({
    limestone: { slab: 0xcac3b5, mullion: 0x5d5a4d, glass: 0x657976, body: 0x8a9085, roof: 0xd1cdc2 },
    bronze: { slab: 0xbda78f, mullion: 0x604a38, glass: 0x5d706a, body: 0x89816f, roof: 0xcbc1ae },
    stone: { slab: 0xb3b7af, mullion: 0x4b5a54, glass: 0x647e7d, body: 0x858f83, roof: 0xc7cbc0 },
    white: { slab: 0xd8d5ca, mullion: 0x63685b, glass: 0x667f7b, body: 0x9d9e90, roof: 0xdbd8ce },
    terracotta: { slab: 0xa97d61, mullion: 0x6e4c38, glass: 0x5e716a, body: 0x917058, roof: 0xcabdab }
  });

  function normalizedPlates(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.plates) || !snapshot.plates.length || snapshot.plates.length > 100) throw new Error("STUDY_GEOMETRY_INVALID");
    const levels = new Set(), result = [];
    for (const value of snapshot.plates) {
      if (!value || !Number.isInteger(value.level) || value.level < 1 || value.level > 100 || levels.has(value.level) ||
        !finite(value.width) || value.width < .1 || value.width > 2000 || !finite(value.depth) || value.depth < .1 || value.depth > 2000 ||
        !finite(value.height) || value.height < .1 || value.height > 30 || !finite(value.y) || value.y < .05 || value.y > 2000 ||
        !finite(value.shiftX ?? 0) || Math.abs(value.shiftX ?? 0) > 2000 || !finite(value.shiftZ ?? 0) || Math.abs(value.shiftZ ?? 0) > 2000) throw new Error("STUDY_GEOMETRY_INVALID");
      levels.add(value.level);
      const courtyard = value.courtyard === true;
      // Explicit metric courtyard dimensions can be supplied by the safe geometry contract.
      const courtyardWidth = courtyard && finite(value.courtyardWidth) && value.courtyardWidth > 0 && value.courtyardWidth < value.width ? value.courtyardWidth : courtyard ? value.width * .35 : 0;
      const courtyardDepth = courtyard && finite(value.courtyardDepth) && value.courtyardDepth > 0 && value.courtyardDepth < value.depth ? value.courtyardDepth : courtyard ? value.depth * .35 : 0;
      result.push({ level: value.level, width: value.width, depth: value.depth, height: value.height, y: value.y,
        shiftX: value.shiftX ?? 0, shiftZ: value.shiftZ ?? 0, courtyard, courtyardWidth, courtyardDepth });
    }
    return result.sort((a, b) => a.level - b.level);
  }

  function buildScenePlan(snapshot) {
    const plates = normalizedPlates(snapshot), boxes = [], trees = [];
    const palette = Object.hasOwn(PALETTES, snapshot.appearance?.palette) ? snapshot.appearance.palette : "limestone";
    const facade = ["curtain_wall", "brick_rainscreen", "stone_ribbon", "kinetic_louver", "diagrid_biophilic"].includes(snapshot.appearance?.facade) ? snapshot.appearance.facade : "curtain_wall";
    const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const p of plates) {
      bounds.minX = Math.min(bounds.minX, p.shiftX - p.width / 2); bounds.maxX = Math.max(bounds.maxX, p.shiftX + p.width / 2);
      bounds.minZ = Math.min(bounds.minZ, p.shiftZ - p.depth / 2); bounds.maxZ = Math.max(bounds.maxZ, p.shiftZ + p.depth / 2);
      bounds.minY = Math.min(bounds.minY, p.y - p.height / 2); bounds.maxY = Math.max(bounds.maxY, p.y + p.height / 2);
    }
    const add = (kind, material, w, h, d, x, y, z, level = null) => {
      if (boxes.length >= MAX_BOXES) return;
      if (![w, h, d, x, y, z].every(finite) || Math.min(w, h, d) <= 0) throw new Error("STUDY_DETAIL_INVALID");
      boxes.push({ kind, material, w, h, d, x, y, z, level });
    };
    function slab(p, y, height, material, kind, inset = 0) {
      const w = p.width - inset * 2, d = p.depth - inset * 2;
      if (Math.min(w, d) <= .01) return;
      if (!p.courtyard) return add(kind, material, w, height, d, p.shiftX, y, p.shiftZ, p.level);
      // Four disjoint strips leave the actual central opening completely empty.
      const iw = p.courtyardWidth + inset * 2, id = p.courtyardDepth + inset * 2;
      const side = (w - iw) / 2, end = (d - id) / 2;
      if (side > .005) {
        add(kind, material, side, height, d, p.shiftX - (w + iw) / 4, y, p.shiftZ, p.level);
        add(kind, material, side, height, d, p.shiftX + (w + iw) / 4, y, p.shiftZ, p.level);
      }
      if (end > .005) {
        add(kind, material, Math.min(iw, w), height, end, p.shiftX, y, p.shiftZ - (d + id) / 4, p.level);
        add(kind, material, Math.min(iw, w), height, end, p.shiftX, y, p.shiftZ + (d + id) / 4, p.level);
      }
    }
    const first = plates[0], top = plates.at(-1);
    for (const p of plates) {
      const low = p.y - p.height / 2, high = p.y + p.height / 2;
      const masonry = facade === "brick_rainscreen" || facade === "stone_ribbon";
      const band = masonry ? Math.min(p.height * .2, .65) : Math.min(p.height * .16, .28), baseBand = Math.min(p.height * .08, .12);
      const reveal = Math.min(.36, p.width * .055, p.depth * .055), paneDepth = Math.min(.07, reveal * .22);
      const frameDepth = Math.min(.24, reveal * .78), glassSetback = Math.min(.19, reveal * .55);
      const clearHeight = Math.max(.02, p.height - band - baseBand);
      const windowY = low + baseBand + clearHeight / 2;
      slab(p, low + baseBand / 2, baseBand, "slab", "floor-band");
      slab(p, high - band / 2, band, p === top ? "roof" : "slab", "floor-band");
      // A recessed opaque interior gives glazing depth without claiming generated interiors.
      slab(p, windowY, clearHeight, "body", "recessed-volume", reveal);
      function face(axis, sign, span, cross, isCourtyard) {
        const frameFixed = sign * (cross / 2 + (isCourtyard ? 1 : -1) * frameDepth / 2);
        const paneFixed = sign * (cross / 2 + (isCourtyard ? 1 : -1) * (glassSetback + paneDepth / 2));
        const x = p.shiftX + (axis === "z" ? frameFixed : 0), z = p.shiftZ + (axis === "x" ? frameFixed : 0);
        const paneX = p.shiftX + (axis === "z" ? paneFixed : 0), paneZ = p.shiftZ + (axis === "x" ? paneFixed : 0);
        const domestic = ["hotel", "housing", "living", "officetel"].includes(snapshot.summary?.program);
        const bay = facade === "kinetic_louver" ? 1.2 : masonry || domestic ? 2.8 : 2.15;
        // Budget both pane and frame instances so no later floor loses its envelope.
        const maxPerFace = clamp(Math.floor(18000 / (plates.length * 16)) - 1, 2, 48);
        const count = clamp(Math.round(span / bay), 1, maxPerFace), thickness = Math.min(masonry ? .4 : facade === "kinetic_louver" ? .17 : .24, p.height * .1, span / 12);
        const step = (span - thickness) / count, paneSpan = Math.max(.001, step - thickness);
        for (let i = 0; i < count; i++) {
          const offset = -span / 2 + thickness / 2 + step * (i + .5);
          const shade = (p.level * 3 + i * 7 + (sign > 0 ? 1 : 0) + (axis === "z" ? 2 : 0)) % 9;
          const material = shade < 2 ? "glassShade" : shade < 4 ? "glassAlt" : "glass";
          add("glazing", material, axis === "x" ? paneSpan : paneDepth, clearHeight, axis === "x" ? paneDepth : paneSpan,
            paneX + (axis === "x" ? offset : 0), windowY, paneZ + (axis === "z" ? offset : 0), p.level);
        }
        for (let i = 0; i <= count; i++) {
          const offset = -span / 2 + thickness / 2 + (span - thickness) * i / count;
          add("mullion", "mullion", axis === "x" ? thickness : frameDepth, clearHeight, axis === "x" ? frameDepth : thickness,
            x + (axis === "x" ? offset : 0), windowY, z + (axis === "z" ? offset : 0), p.level);
        }
        // A thin transom keeps tall commercial glazing legible at gallery size.
        if (p.height >= 3.1) add("transom", "mullion", axis === "x" ? span : frameDepth, Math.min(.07, p.height * .025), axis === "x" ? frameDepth : span, x, windowY - clearHeight * .19, z, p.level);
      }
      face("x", 1, p.width, p.depth, false); face("x", -1, p.width, p.depth, false);
      face("z", 1, p.depth, p.width, false); face("z", -1, p.depth, p.width, false);
      if (p.courtyard) {
        face("x", 1, p.courtyardWidth, p.courtyardDepth, true); face("x", -1, p.courtyardWidth, p.courtyardDepth, true);
        face("z", 1, p.courtyardDepth, p.courtyardWidth, true); face("z", -1, p.courtyardDepth, p.courtyardWidth, true);
      }
    }
    const groundY = Math.min(0, bounds.minY) - .045, spanX = bounds.maxX - bounds.minX, spanZ = bounds.maxZ - bounds.minZ;
    const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2, footprintScale = Math.max(spanX, spanZ);
    const landscape = clamp(footprintScale * .18, 2.5, 12);
    add("plaza", "paving", spanX + landscape * 2.2, .08, spanZ + landscape * 1.8, cx, groundY - .025, cz);
    // Generic planting has no relation to the private site's shape, streets or neighbours.
    const treeRadius = clamp(footprintScale * .023, .38, 1.2), treeCount = clamp(Math.round(first.width / 4.5), 3, 9);
    for (let i = 0; i < treeCount; i++) {
      const x = first.shiftX - first.width * .43 + first.width * .86 * i / Math.max(1, treeCount - 1);
      const z = first.shiftZ + first.depth / 2 + landscape * .5;
      trees.push({ x, y: groundY + .06, z, radius: treeRadius, height: treeRadius * 3.8, variation: (i * 7 % 5) / 5 });
      add("planter", "planting", treeRadius * 2.35, .1, treeRadius * 2.35, x, groundY + .045, z);
    }
    const doorWidth = Math.min(3.2, first.width * .2), doorHeight = Math.min(first.height * .72, 3.1);
    if (first.width > 3 && first.depth > 3) {
      const faceZ = first.shiftZ + first.depth / 2;
      add("entrance", "entrance", doorWidth, doorHeight, .065, first.shiftX, first.y - first.height / 2 + doorHeight / 2, faceZ - .033, first.level);
      add("entrance-canopy", "roof", doorWidth * 1.25, .1, Math.min(1.8, landscape * .45), first.shiftX, first.y - first.height / 2 + doorHeight + .05, faceZ + .25, first.level);
      add("entrance-split", "mullion", .06, doorHeight, .085, first.shiftX, first.y - first.height / 2 + doorHeight / 2, faceZ - .035, first.level);
    }
    // Roof equipment is a low, illustrative service object, never a counted floor.
    const roofY = top.y + top.height / 2;
    if (!top.courtyard && Math.min(top.width, top.depth) > 5) {
      const rw = Math.min(top.width * .24, 5.5), rd = Math.min(top.depth * .2, 4.3), rh = Math.min(.85, top.height * .18);
      add("roof-service", "roof", rw, rh, rd, top.shiftX - top.width * .14, roofY + rh / 2, top.shiftZ - top.depth * .12);
      add("roof-service-cap", "slab", rw + .1, .09, rd + .1, top.shiftX - top.width * .14, roofY + rh + .045, top.shiftZ - top.depth * .12);
      add("roof-plant", "planting", top.width * .29, .065, top.depth * .14, top.shiftX + top.width * .22, roofY + .035, top.shiftZ - top.depth * .24);
    }
    const height = Math.max(bounds.maxY - groundY, 1), contextGap = landscape * 1.1;
    const contextHeight = clamp(height * .28, 2.4, 18);
    for (const c of [
      { x: bounds.minX - contextGap - spanX * .4, z: cz - spanZ * .4, w: spanX * .64, d: spanZ * .68, h: contextHeight },
      { x: cx + spanX * .2, z: bounds.minZ - contextGap - spanZ * .42, w: spanX * .76, d: spanZ * .7, h: contextHeight * .75 },
      { x: bounds.maxX + contextGap + spanX * .42, z: bounds.minZ - contextGap - spanZ * .42, w: spanX * .58, d: spanZ * .56, h: contextHeight * 1.15 }
    ]) add("abstract-context", "context", Math.max(.2, c.w), c.h, Math.max(.2, c.d), c.x, groundY + c.h / 2, c.z);
    return { version: VERSION, palette, facade, plates, boxes, trees, bounds, groundY, landscape, maxBoxes: MAX_BOXES,
      illustration: "Facade, planting, roof service and abstract context are presentation details; floor envelopes remain the supplied concept geometry." };
  }

  function capture(THREE, snapshot) {
    if (!THREE?.WebGLRenderer || !THREE?.InstancedMesh) throw new Error("STUDY_WEBGL_UNAVAILABLE");
    const plan = buildScenePlan(snapshot), geometries = [], materials = [], instances = [];
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: "low-power" });
      renderer.setPixelRatio(1); renderer.setSize(WIDTH, HEIGHT); renderer.setClearColor(0xe9e8e2, 1);
      if (THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
      if (THREE.ACESFilmicToneMapping !== undefined) { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .94; }
      renderer.shadowMap.enabled = true;
      if (THREE.PCFSoftShadowMap !== undefined) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const scene = new THREE.Scene(), model = new THREE.Group(); scene.add(model);
      const selected = PALETTES[plan.palette];
      const materialSpecs = {
        slab: { color: selected.slab, roughness: .82 }, mullion: { color: selected.mullion, roughness: .72, metalness: .06 },
        glass: { color: selected.glass, roughness: .32, metalness: .12 },
        glassAlt: { color: new THREE.Color(selected.glass).multiplyScalar(.84), roughness: .36, metalness: .08 },
        glassShade: { color: new THREE.Color(selected.glass).multiplyScalar(.65), roughness: .4, metalness: .06 },
        body: { color: selected.body, roughness: .9 },
        roof: { color: selected.roof, roughness: .86 }, paving: { color: 0xd6d5cc, roughness: .98 },
        planting: { color: 0xa5ac94, roughness: 1 }, entrance: { color: 0x435452, roughness: .3, metalness: .2 },
        context: { color: 0xd6d8d0, roughness: .98 }
      };
      const boxGeometry = new THREE.BoxGeometry(1, 1, 1); geometries.push(boxGeometry);
      const dummy = new THREE.Object3D();
      for (const [name, spec] of Object.entries(materialSpecs)) {
        const data = plan.boxes.filter(item => item.material === name); if (!data.length) continue;
        const material = new THREE.MeshStandardMaterial(spec); materials.push(material);
        const mesh = new THREE.InstancedMesh(boxGeometry, material, data.length); instances.push(mesh);
        data.forEach((item, index) => {
          dummy.position.set(item.x, item.y, item.z); dummy.scale.set(item.w, item.h, item.d); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = name !== "context" && name !== "paving"; mesh.receiveShadow = true; mesh.frustumCulled = false; model.add(mesh);
      }
      const foliageGeometry = new THREE.SphereGeometry(1, 12, 9), trunkGeometry = new THREE.CylinderGeometry(1, 1.25, 1, 7);
      geometries.push(foliageGeometry, trunkGeometry);
      const leafMaterial = new THREE.MeshStandardMaterial({ color: 0x9ba78a, roughness: .98 }), trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x8c8472, roughness: 1 });
      materials.push(leafMaterial, trunkMaterial);
      for (const tree of plan.trees) {
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial); trunk.position.set(tree.x, tree.y + tree.height * .32, tree.z); trunk.scale.set(tree.radius * .075, tree.height * .64, tree.radius * .075); trunk.castShadow = true; model.add(trunk);
        const crown = new THREE.Mesh(foliageGeometry, leafMaterial); crown.position.set(tree.x, tree.y + tree.height * .72, tree.z); crown.scale.set(tree.radius, tree.radius * (1.08 + tree.variation * .2), tree.radius * .91); crown.castShadow = true; crown.receiveShadow = true; model.add(crown);
      }
      const b = plan.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      const extent = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, b.maxY - plan.groundY, 1);
      const groundGeometry = new THREE.PlaneGeometry(extent * 30, extent * 30), groundMaterial = new THREE.MeshStandardMaterial({ color: 0xe9e8e2, roughness: 1 });
      geometries.push(groundGeometry); materials.push(groundMaterial);
      const ground = new THREE.Mesh(groundGeometry, groundMaterial); ground.rotation.x = -Math.PI / 2; ground.position.set(cx, plan.groundY - .08, cz); ground.receiveShadow = true; scene.add(ground);
      scene.add(new THREE.HemisphereLight(0xfffdf5, 0x8c978d, .68));
      const key = new THREE.DirectionalLight(0xfff4dc, 1.3); key.position.set(cx - extent * 1.4, extent * 2.5, cz + extent * 1.6); key.target.position.set(cx, (b.minY + b.maxY) / 2, cz); scene.add(key, key.target);
      key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -.00015; key.shadow.normalBias = .025; key.shadow.radius = 3;
      Object.assign(key.shadow.camera, { left: -extent * 1.55, right: extent * 1.55, top: extent * 1.55, bottom: -extent * 1.55, near: .1, far: extent * 8 + 100 }); key.shadow.camera.updateProjectionMatrix();
      const fill = new THREE.DirectionalLight(0xdde8e5, .27); fill.position.set(cx + extent * 2, extent, cz - extent); scene.add(fill);
      const camera = new THREE.OrthographicCamera(-extent, extent, extent, -extent, .1, extent * 25 + 100);
      const target = new THREE.Vector3(cx, (plan.groundY + b.maxY) / 2, cz);
      camera.position.set(cx + extent * 1.8, target.y + extent * 1.35, cz + extent * 2.15); camera.lookAt(target); camera.updateMatrixWorld(true);
      // Frame the submitted building and its front planting, never the background context.
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const x of [b.minX - plan.landscape * .4, b.maxX + plan.landscape * .4]) for (const y of [plan.groundY, b.maxY + 1]) for (const z of [b.minZ - plan.landscape * .2, b.maxZ + plan.landscape * .95]) {
        const point = new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
      }
      const aspect = WIDTH / HEIGHT, halfHeight = Math.max((maxY - minY) * .55, (maxX - minX) / aspect * .55, .1), offsetX = (minX + maxX) / 2, offsetY = (minY + maxY) / 2;
      camera.left = offsetX - halfHeight * aspect; camera.right = offsetX + halfHeight * aspect; camera.top = offsetY + halfHeight; camera.bottom = offsetY - halfHeight; camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      const output = renderer.domElement.toDataURL("image/png");
      if (!output.startsWith("data:image/png;base64,") || output.length > 1800000) throw new Error("STUDY_IMAGE_TOO_LARGE");
      return output;
    } finally {
      instances.forEach(item => item.dispose?.()); geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose());
      if (renderer) { renderer.dispose(); renderer.forceContextLoss?.(); }
    }
  }
  return Object.freeze({ version: VERSION, width: WIDTH, height: HEIGHT, buildScenePlan, capture });
});
