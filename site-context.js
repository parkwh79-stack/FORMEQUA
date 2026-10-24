/* Actual GIS surroundings. All geometry uses the selected building's X/east,
 * Z/south frame, including its inverse site rotation. No road width is inferred.
 */
(function (root, factory) {
  const api = factory(root, typeof module === "object" && module.exports
    ? require("./vendor/polygon-clipping-0.15.7.umd.min.js") : root.polygonClipping);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AtelierSiteContext = api;
})(typeof window !== "undefined" ? window : globalThis, function (root, clip) {
  "use strict";
  const R = 6371008.8, RAD = Math.PI / 180;
  const cache = new Map(), ownedGroups = new WeakMap();
  const CACHE_MS = 5 * 60 * 1000, MAX_CACHE = 8, MAX_TEXT = 20 * 1024 * 1024;
  function fail(message, code = "INVALID_SITE_CONTEXT") {
    const error = new Error(message); error.code = code; throw error;
  }
  function pnusKey(pnus) {
    if (!Array.isArray(pnus) || !pnus.length || pnus.length > 5 ||
        pnus.some(pnu => typeof pnu !== "string" || !/^\d{19}$/.test(pnu)))
      fail("주변 자료를 조회할 실제 PNU 1~5개가 필요합니다.", "INVALID_PNUS");
    return [...new Set(pnus)].sort().join(",");
  }
  function validBbox(bbox) {
    return Array.isArray(bbox) && bbox.length === 4 && bbox.every(Number.isFinite) &&
      bbox[0] < bbox[2] && bbox[1] < bbox[3] && bbox[0] >= -180 && bbox[2] <= 180 && bbox[1] >= -90 && bbox[3] <= 90;
  }
  function transform(center, angle, projection) {
    if (!Array.isArray(center) || center.length !== 2 || !center.every(Number.isFinite) ||
        Math.abs(center[0]) > 180 || Math.abs(center[1]) >= 90 || !Number.isFinite(angle))
      fail("선택 필지의 투영 원점·회전각을 확인해 주세요.");
    const sx = projection?.metersPerDegreeLon ?? R * RAD * Math.cos(center[1] * RAD);
    const sz = projection?.metersPerDegreeLat ?? R * RAD;
    if (!(Number.isFinite(sx) && sx > 0 && Number.isFinite(sz) && sz > 0)) fail("필지 투영 배율이 유효하지 않습니다.");
    const c = Math.cos(angle), s = Math.sin(angle);
    let count = 0;
    return point => {
      if (++count > 400000 || !Array.isArray(point) || point.length !== 2 ||
          !point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90)
        fail("주변 공간자료 좌표 형식을 확인해 주세요.");
      const x = (point[0] - center[0]) * sx, z = -(point[1] - center[1]) * sz;
      return [c * x + s * z, -s * x + c * z];
    };
  }
  function mapGeometry(geometry, point) {
    if (!geometry || typeof geometry !== "object") fail("주변 공간자료의 기하가 없습니다.");
    const depth = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 }[geometry.type];
    if (depth === undefined) fail("지원하지 않는 주변 공간자료 기하입니다.");
    const map = (values, level) => {
      if (!level) return point(values);
      if (!Array.isArray(values)) fail("주변 공간자료 좌표 배열을 확인해 주세요.");
      return values.map(value => map(value, level - 1));
    };
    return { type: geometry.type, coordinates: map(geometry.coordinates, depth) };
  }
  function mapGeojson(value, map) {
    if (!value || typeof value !== "object") fail("GeoJSON 공간자료가 필요합니다.");
    if (value.type === "FeatureCollection") {
      if (!Array.isArray(value.features) || value.features.length > 2500) fail("주변 공간자료 개수가 지원 범위를 넘습니다.");
      return { type: "FeatureCollection", features: value.features.map(feature => mapGeojson(feature, map)) };
    }
    if (value.type === "Feature") return { type: "Feature", ...(value.id === undefined ? {} : { id: value.id }),
      properties: { ...(value.properties || {}) }, geometry: map(value.geometry) };
    return map(value);
  }
  /** Returns GeoJSON with [local X, local Z] coordinates; never changes source geometry. */
  function projectFeature(value, centerWgs84, frameRotationRad = 0, projection = null) {
    const point = transform(centerWgs84, frameRotationRad, projection);
    return mapGeojson(value, geometry => mapGeometry(geometry, point));
  }
  // Liang-Barsky clipping retains separate segments when a polyline leaves the
  // requested geographic box. An unbounded source road must not move the camera.
  function clipSegment(a, b, bbox) {
    let lo = 0, hi = 1;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const p = [-dx, dx, -dy, dy], q = [a[0]-bbox[0], bbox[2]-a[0], a[1]-bbox[1], bbox[3]-a[1]];
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return null; continue; }
      const t = q[i] / p[i];
      if (p[i] < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
      if (lo > hi) return null;
    }
    if (hi - lo < 1e-14) return null;
    return [[a[0]+lo*dx, a[1]+lo*dy], [a[0]+hi*dx, a[1]+hi*dy]];
  }
  function clipLines(lines, bbox) {
    const result = [];
    for (const line of lines) {
      let current = null;
      for (let i = 1; i < line.length; i++) {
        const segment = clipSegment(line[i-1], line[i], bbox);
        if (!segment) { current = null; continue; }
        if (current && Math.abs(current.at(-1)[0]-segment[0][0]) < 1e-12 && Math.abs(current.at(-1)[1]-segment[0][1]) < 1e-12)
          current.push(segment[1]);
        else { current = segment; result.push(current); }
      }
    }
    return result;
  }
  /** Clips in geographic space before rotation; Polygon holes stay intact. */
  function clipFeature(feature, bbox) {
    if (!validBbox(bbox)) fail("주변 공간자료 조회 범위가 유효하지 않습니다.");
    // Check coordinates before the clipping library receives provider data.
    const clean = projectFeature(feature, [0, 0], 0, { metersPerDegreeLon: 1, metersPerDegreeLat: 1 });
    // projectFeature's Z axis is south; use source coordinates for geographic clipping.
    const g = feature.geometry;
    let geometry;
    if (["Polygon", "MultiPolygon"].includes(g.type)) {
      if (!clip) fail("경계 교차 모듈을 불러오지 못했습니다.");
      const box = [[[bbox[0],bbox[1]],[bbox[2],bbox[1]],[bbox[2],bbox[3]],[bbox[0],bbox[3]],[bbox[0],bbox[1]]]];
      const polygons = clip.intersection(g.type === "Polygon" ? [g.coordinates] : g.coordinates, box);
      if (!polygons.length) return null;
      geometry = { type: "MultiPolygon", coordinates: polygons };
    } else if (["LineString", "MultiLineString"].includes(g.type)) {
      const lines = clipLines(g.type === "LineString" ? [g.coordinates] : g.coordinates, bbox);
      if (!lines.length) return null;
      geometry = { type: "MultiLineString", coordinates: lines };
    } else return null;
    return { ...clean, geometry };
  }
  function disposeTree(group) {
    const geometries = new Set(), materials = new Set();
    group.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose?.();
    for (const material of materials) material.dispose?.();
    group.parent?.remove(group);
  }
  /** Disposes only this module's child, never unrelated model objects. */
  function dispose(group) {
    const previous = ownedGroups.get(group);
    if (previous) { disposeTree(previous); ownedGroups.delete(group); }
  }
  function validateData(data, expectedKey) {
    if (!data || data.version !== 1 || data.crs !== "EPSG:4326" || !validBbox(data.bbox) ||
        pnusKey(data.pnus) !== expectedKey) fail("선택 필지와 주변 공간자료의 기준이 일치하지 않습니다.");
    for (const key of ["parcels", "roads", "plannedRoads"]) {
      const collection = data[key];
      if (!collection || collection.type !== "FeatureCollection" || !Array.isArray(collection.features) || collection.features.length > 1500)
        fail("주변 공간자료의 레이어 형식을 확인해 주세요.");
    }
    return data;
  }
  /** Adds only actual provider features. Road centerlines remain lines even if
   * a raw width attribute is present; planning boundaries are a separate style.
   */
  function render({ THREE, group, data, centerWgs84, frameRotationRad = 0, projection = null,
    selectedPnus = data?.pnus, palette = {}, daylight = true }) {
    const expectedKey = pnusKey(selectedPnus);
    if (data?.pnus && pnusKey(data.pnus) !== expectedKey) return { status: "stale", featureCount: 0 };
    validateData(data, expectedKey);
    // Validate the frame before replacing any previously visible surroundings.
    transform(centerWgs84, frameRotationRad, projection);
    const child = new THREE.Group(); child.name = "actual-site-context";
    const counts = { parcels: 0, roads: 0, plannedRoads: 0, cadastralRoadLots: 0, roadSurfaces: 0, skipped: 0 };
    const selected = new Set(selectedPnus);
    const colors = {
      parcels: daylight ? (palette.contextEdge ?? 0xb6ad9e) : (palette.nightContextEdge ?? 0x777d70),
      roads: daylight ? (palette.road ?? 0x8a877b) : (palette.roadMark ?? 0xc5bda8),
      plannedRoads: palette.bronze ?? 0x9a805d
    };
    function line(points, kind, properties) {
      if (points.length < 2) return;
      const y = kind === "parcels" ? 0.22 : kind === "roads" ? 0.27 : 0.3;
      const geometry = new THREE.BufferGeometry().setFromPoints(points.map(([x,z]) => new THREE.Vector3(x,y,z)));
      const settings = { color: colors[kind], transparent: true, opacity: kind === "parcels" ? 0.8 : 0.95, depthWrite: false, toneMapped: false, fog: false };
      const material = kind === "parcels" ? new THREE.LineBasicMaterial(settings)
        : new THREE.LineDashedMaterial({ ...settings, dashSize: kind === "roads" ? 2 : 6, gapSize: kind === "roads" ? 1.2 : 2.5 });
      const object = new THREE.Line(geometry, material);
      object.computeLineDistances?.(); object.renderOrder = kind === "parcels" ? 2 : 3;
      object.userData = { ...properties, siteContext: true, kind, sourceKind: properties.kind };
      child.add(object);
    }
    function surface(polygon, properties, cadastralRoadLot = false) {
      const shape = new THREE.Shape(polygon[0].map(([x,z]) => new THREE.Vector2(x,-z)));
      for (const ring of polygon.slice(1)) shape.holes.push(new THREE.Path(ring.map(([x,z]) => new THREE.Vector2(x,-z))));
      const material = new THREE.MeshBasicMaterial({ color: colors.roads, transparent: true, opacity: cadastralRoadLot ? 0.32 : 0.45,
        side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
      mesh.rotation.x = -Math.PI / 2; mesh.position.y = cadastralRoadLot ? 0.08 : 0.18;
      mesh.userData = { ...properties, siteContext: true,
        kind: cadastralRoadLot ? "cadastral-road-lot" : "verified-road-surface", sourceKind: properties.kind,
        ...(cadastralRoadLot ? { physicalBoundaryVerified: false, displayLabel: "지적도상 도 표기" } : {}) };
      child.add(mesh); if (!cadastralRoadLot) counts.roadSurfaces++;
    }
    try {
      for (const kind of ["parcels", "roads", "plannedRoads"]) for (const feature of data[kind].features) {
        if (kind === "parcels" && (feature.properties?.selected || selected.has(feature.properties?.pnu))) continue;
        try {
          const clipped = clipFeature(feature, data.bbox);
          if (!clipped) continue;
          const projected = projectFeature(clipped, centerWgs84, frameRotationRad, projection);
          const g = projected.geometry, props = projected.properties;
          if (["Polygon", "MultiPolygon"].includes(g.type)) {
            const polygons = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
            // This is a verbatim cadastral suffix, not a verified present road
            // surface, a road-width measurement or a statutory road designation.
            const cadastralRoadLot = kind === "parcels" && typeof props.jibun === "string" && /도\s*$/u.test(props.jibun);
            if (cadastralRoadLot) counts.cadastralRoadLots++;
            for (const polygon of polygons) {
              if (cadastralRoadLot) surface(polygon, props, true);
              if (kind === "roads" && props.physicalBoundaryVerified === true) surface(polygon, props);
              for (const ring of polygon) line(ring, kind, props);
            }
          } else for (const points of g.type === "LineString" ? [g.coordinates] : g.coordinates) line(points, kind, props);
          counts[kind]++;
        } catch (_) { counts.skipped++; }
      }
    } catch (error) { disposeTree(child); throw error; }
    dispose(group); group.add(child); ownedGroups.set(group, child);
    return { status: counts.skipped ? "partial" : "ready", ...counts,
      featureCount: counts.parcels + counts.roads + counts.plannedRoads, group: child };
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function abortError() { const error = new Error("주변 자료 조회를 취소했습니다."); error.name = "AbortError"; return error; }
  function withAbort(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const aborted = () => { signal.removeEventListener("abort", aborted); reject(abortError()); };
      signal.addEventListener("abort", aborted, { once: true });
      promise.then(value => { signal.removeEventListener("abort", aborted); resolve(value); },
        error => { signal.removeEventListener("abort", aborted); reject(error); });
    });
  }
  /** Same-origin proxy only. Cache entries never contain credentials; canceled
   * callers cannot apply a late result, and rendering rejects a different PNU set.
   */
  async function fetchContext(pnus, options = {}) {
    const key = pnusKey(pnus), now = Date.now();
    if (options.signal?.aborted) throw abortError();
    let entry = cache.get(key);
    if (!options.force && entry?.data && entry.expires > now) return clone(await withAbort(Promise.resolve(entry.data), options.signal));
    if (options.force || !entry?.pending) {
      entry = {}; cache.set(key, entry);
      while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
      const controller = new AbortController(), fetcher = options.fetch || root.fetch?.bind(root);
      if (!fetcher) { cache.delete(key); fail("공간자료 조회 기능을 사용할 수 없습니다.", "FETCH_UNAVAILABLE"); }
      const timer = setTimeout(() => controller.abort(), 30000);
      const current = entry;
      entry.pending = (async () => {
        try {
          const response = await fetcher("/api/v1/parcels/context?pnus=" + encodeURIComponent(key),
            { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store", signal: controller.signal });
          if (!response.ok) fail("주변 공간자료를 조회하지 못했습니다. 잠시 후 다시 조회해 주세요.", "CONTEXT_HTTP_" + response.status);
          if (Number(response.headers?.get("content-length")) > MAX_TEXT) fail("주변 공간자료의 응답이 너무 큽니다.");
          const source = await response.text();
          if (source.length > MAX_TEXT) fail("주변 공간자료의 응답이 너무 큽니다.");
          let data;
          try { data = JSON.parse(source); } catch (_) { fail("주변 공간자료의 응답 형식을 확인해 주세요."); }
          validateData(data, key);
          if (cache.get(key) === current) { current.data = data; current.expires = Date.now() + CACHE_MS; }
          return data;
        } catch (error) {
          if (cache.get(key) === current) cache.delete(key);
          if (typeof error.code === "string" && /^(INVALID_SITE_CONTEXT|INVALID_PNUS|CONTEXT_HTTP_\d{3})$/.test(error.code)) throw error;
          fail("주변 공간자료를 조회하지 못했습니다. 서버 연결을 확인해 주세요.", controller.signal.aborted ? "CONTEXT_TIMEOUT" : "CONTEXT_UNAVAILABLE");
        } finally { clearTimeout(timer); current.pending = null; }
      })();
    }
    return clone(await withAbort(entry.pending, options.signal));
  }
  function invalidate(pnus) { if (pnus === undefined) cache.clear(); else cache.delete(pnusKey(pnus)); }
  return Object.freeze({ projectFeature, clipFeature, render, dispose, fetchContext, invalidate });
});
