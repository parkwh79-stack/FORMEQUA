/* IFC4 planning-mass export. No DOM, network, or projected-CRS assumptions.
 * Schema reference (IFC4 ADD2 TC1):
 * https://github.com/buildingSMART/IFC4.x-development/blob/ifc4.3-main/reference_schemas/IFC4_ADD2_TC1.exp
 * GUID encoding: https://github.com/buildingSMART/technical.buildingsmart.org/blob/main/IFC-GUID.md
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AtelierMassIfc = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
  const namespace = [0x6b, 0xa7, 0xb8, 0x11, 0x9d, 0xad, 0x11, 0xd1, 0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8]; // UUID URL namespace
  const fail = message => { throw new Error("IFC export: " + message); };
  function finite(value, name) {
    if (typeof value !== "number" || !Number.isFinite(value)) fail(name + " must be finite.");
    return value;
  }
  function positive(value, name) {
    if (finite(value, name) <= 0) fail(name + " must be positive.");
    return value;
  }
  function real(value) {
    const n = finite(value, "number");
    const s = (Math.abs(n) < 5e-10 ? 0 : n).toFixed(9).replace(/0+$/, "");
    return s.endsWith(".") ? s : s.includes(".") ? s : s + ".";
  }
  // Keep STEP ASCII, including apostrophes, backslashes, and UTF-16 text.
  function str(value) {
    let result = "'", unicode = "";
    const flush = () => { if (unicode) { result += "\\X2\\" + unicode + "\\X0\\"; unicode = ""; } };
    for (let i = 0; i < String(value).length; i++) {
      const c = String(value).charCodeAt(i);
      if (c >= 32 && c <= 126 && c !== 92) { flush(); result += c === 39 ? "''" : String.fromCharCode(c); }
      else unicode += c.toString(16).toUpperCase().padStart(4, "0");
    }
    flush();
    return result + "'";
  }
  function utf8(value) {
    const bytes = [];
    for (const c of String(value)) {
      let n = c.codePointAt(0);
      if (n >= 0xd800 && n <= 0xdfff) n = 0xfffd;
      if (n < 0x80) bytes.push(n);
      else if (n < 0x800) bytes.push(0xc0 | n >> 6, 0x80 | n & 63);
      else if (n < 0x10000) bytes.push(0xe0 | n >> 12, 0x80 | n >> 6 & 63, 0x80 | n & 63);
      else bytes.push(0xf0 | n >> 18, 0x80 | n >> 12 & 63, 0x80 | n >> 6 & 63, 0x80 | n & 63);
    }
    return bytes;
  }
  // Synchronous SHA-1 is used solely for standard deterministic UUIDv5 names.
  function sha1(input) {
    const bytes = input.slice(), bitLength = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push(Math.floor(bitLength / Math.pow(256, i)) & 255);
    const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    const rol = (n, k) => n << k | n >>> (32 - k);
    for (let offset = 0; offset < bytes.length; offset += 64) {
      const w = new Array(80);
      for (let i = 0; i < 16; i++) { const j = offset + i * 4; w[i] = bytes[j] << 24 | bytes[j + 1] << 16 | bytes[j + 2] << 8 | bytes[j + 3]; }
      for (let i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
      let [a, b, c, d, e] = h;
      for (let i = 0; i < 80; i++) {
        const f = i < 20 ? b & c | ~b & d : i < 40 ? b ^ c ^ d : i < 60 ? b & c | b & d | c & d : b ^ c ^ d;
        const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
        const t = (rol(a, 5) + f + e + k + w[i]) | 0;
        e = d; d = c; c = rol(b, 30); b = a; a = t;
      }
      [a, b, c, d, e].forEach((n, i) => { h[i] = (h[i] + n) | 0; });
    }
    return h.flatMap(n => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255]);
  }
  function guid(name) {
    const bytes = sha1(namespace.concat(utf8("https://formequa.local/massing/" + name))).slice(0, 16);
    bytes[6] = bytes[6] & 15 | 0x50;
    bytes[8] = bytes[8] & 63 | 0x80;
    let n = bytes.reduce((acc, byte) => acc * 256n + BigInt(byte), 0n), result = "";
    for (let i = 0; i < 22; i++) { result = alphabet[Number(n & 63n)] + result; n >>= 6n; }
    return result;
  }
  function decimalDegreesToDms(value) {
    const sign = finite(value, "angle") < 0 ? -1 : 1;
    let microseconds = Math.round(Math.abs(value) * 3600 * 1000000);
    const degree = Math.floor(microseconds / 3600000000); microseconds -= degree * 3600000000;
    const minute = Math.floor(microseconds / 60000000); microseconds -= minute * 60000000;
    const second = Math.floor(microseconds / 1000000); microseconds -= second * 1000000;
    return [degree, minute, second, microseconds].map(n => n ? sign * n : 0);
  }

  function buildIfc(model, options) {
    if (model && model.model && options === undefined) { options = model; model = options.model; }
    options = options || {};
    if (!model || !Array.isArray(model.floorPlates)) fail("a computed mass model is required.");
    const geo = model.parcelGeometry || null;
    const option = String(options.option || "A"), parcelKey = String(options.parcelKey || "site");
    const pnus = geo && Array.isArray(geo.pnus) ? geo.pnus.slice().sort() : [];
    const scope = JSON.stringify([parcelKey, option, pnus, !pnus.length && geo ? geo.centerWgs84 : null]);
    const g = name => str(guid(scope + "/" + name));
    const exportedAt = options.createdAt || new Date().toISOString();
    if (!Number.isFinite(Date.parse(exportedAt))) fail("createdAt must be a valid date.");
    const below = options.floorsBelow === undefined ? 0 : options.floorsBelow;
    if (!Number.isInteger(below) || below < 0 || below > 100) fail("floorsBelow must be an integer from 0 to 100.");
    const fallbackHeight = options.floorHeight === undefined ? 4 : positive(options.floorHeight, "floorHeight");
    const floors = model.floorPlates.slice().sort((a, b) => a.level - b.level), levels = new Set();
    for (const fp of floors) {
      if (!Number.isInteger(fp.level) || fp.level <= 0 || levels.has(fp.level)) fail("above-ground floor levels must be unique positive integers.");
      levels.add(fp.level);
      positive(fp.widthM, "floor width"); positive(fp.depthM, "floor depth"); finite(fp.zBottom, "floor elevation");
      positive(fp.zTop === undefined ? fallbackHeight : fp.zTop - fp.zBottom, "floor height");
      if (fp.northShiftM !== undefined) finite(fp.northShiftM, "northShiftM");
    }
    const simpleMass = model.representation?.detailLevel === "massing";
    const sharedCores = !simpleMass && model.coreLayout && model.coreLayout.cores !== undefined ? model.coreLayout.cores : [];
    if (!Array.isArray(sharedCores)) fail("coreLayout.cores must be an array.");
    const coreIds = new Set();
    for (const core of sharedCores) {
      if (!core || typeof core.id !== "string" || !core.id || coreIds.has(core.id)) fail("shared core IDs must be unique non-empty strings.");
      coreIds.add(core.id);
      finite(core.minX, "core minX"); finite(core.maxX, "core maxX"); finite(core.minZ, "core minZ"); finite(core.maxZ, "core maxZ");
      positive(core.maxX - core.minX, "core width"); positive(core.maxZ - core.minZ, "core depth");
    }

    const lines = [], add = text => { lines.push("#" + (lines.length + 1) + "=" + text + ";"); return lines.length; };
    const ref = n => "#" + n, refs = ids => "(" + ids.map(ref).join(",") + ")";
    const point = coordinates => add("IFCCARTESIANPOINT((" + coordinates.map(real).join(",") + "))");
    const dir = coordinates => add("IFCDIRECTION((" + coordinates.map(real).join(",") + "))");
    const origin = point([0, 0, 0]), up = dir([0, 0, 1]), east = dir([1, 0, 0]);
    const axis = coordinates => add("IFCAXIS2PLACEMENT3D(" + ref(point(coordinates)) + "," + ref(up) + "," + ref(east) + ")");
    const worldAxis = add("IFCAXIS2PLACEMENT3D(" + ref(origin) + "," + ref(up) + "," + ref(east) + ")");
    const placement = (parent, coordinates) => add("IFCLOCALPLACEMENT(" + (parent ? ref(parent) : "$") + "," + ref(axis(coordinates)) + ")");
    const rotation = geo && geo.frameRotationRad !== undefined ? finite(geo.frameRotationRad, "frameRotationRad") : 0;
    // WebGL local north=(-sin(rotation), 0, -cos(rotation)); IFC=(x,-z,height).
    const north = dir([-Math.sin(rotation), Math.cos(rotation)]);
    const context = add("IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,0.000000001," + ref(worldAxis) + "," + ref(north) + ")");
    const units = ["LENGTHUNIT.,$,.METRE", "AREAUNIT.,$,.SQUARE_METRE", "VOLUMEUNIT.,$,.CUBIC_METRE", "PLANEANGLEUNIT.,$,.RADIAN"]
      .map(v => add("IFCSIUNIT(*,." + v + ".)"));
    const unitSet = add("IFCUNITASSIGNMENT(" + refs(units) + ")");
    const coreNote = "Planning reservation space for shared vertical core coordination only; not a structural wall, designed stair/elevator, fire-safety approval or detailed BIM. " +
      "Reservation solids overlap the planning mass and do not add gross floor area or gross volume quantities.";
    const note = "Conceptual planning mass only; not a survey, permit model, structural design or detailed BIM. " +
      "Local metric coordinates approximate WGS84 around the parcel origin; heights are relative to local ground, not a surveyed vertical datum. " +
      "Detailed facade, interior and rooftop PV/equipment are not exported. The planning roof-height allowance is not a physical solid." +
      (sharedCores.length ? " " + coreNote : "");
    const project = add("IFCPROJECT(" + g("project") + ",$,'FORMEQUA Planning Mass'," + str(note) + ",$,$,'Planning study'," + refs([context]) + "," + ref(unitSet) + ")");
    let latitude = "$", longitude = "$";
    if (geo && geo.centerWgs84 !== undefined) {
      const center = geo.centerWgs84;
      if (!Array.isArray(center) || center.length !== 2 || !center.every(n => typeof n === "number" && Number.isFinite(n)) || Math.abs(center[0]) > 180 || Math.abs(center[1]) > 90) fail("centerWgs84 must be [longitude, latitude].");
      latitude = "(" + decimalDegreesToDms(center[1]).join(",") + ")";
      longitude = "(" + decimalDegreesToDms(center[0]).join(",") + ")";
    }
    const sitePlacement = placement(null, [0, 0, 0]);
    const siteName = geo && Array.isArray(geo.addresses) && geo.addresses.length ? geo.addresses.join(" + ") : parcelKey;
    const site = add("IFCSITE(" + g("site") + ",$," + str(siteName) + "," + str(note) + ",$," + ref(sitePlacement) + ",$,$,.ELEMENT.," + latitude + "," + longitude + ",$," + (pnus.length ? str(pnus.join(" + ")) : "$") + ",$)");
    const buildingPlacement = placement(sitePlacement, [0, 0, 0]);
    const building = add("IFCBUILDING(" + g("building") + ",$," + str("Option " + option + " planning mass") + "," + str(note) + ",$," + ref(buildingPlacement) + ",$,$,.ELEMENT.,$,$,$)");
    const aggregate = (name, parent, children) => children.length && add("IFCRELAGGREGATES(" + g("aggregate/" + name) + ",$,$,$," + ref(parent) + "," + refs(children) + ")");
    const contain = (name, parent, elements) => elements.length && add("IFCRELCONTAINEDINSPATIALSTRUCTURE(" + g("contain/" + name) + ",$,$,$," + refs(elements) + "," + ref(parent) + ")");
    aggregate("project-site", project, [site]); aggregate("site-building", site, [building]);
    function propertySet(name, target, entries) {
      const properties = entries.filter(([, , value]) => value !== undefined && value !== null).map(([key, type, value]) =>
        add("IFCPROPERTYSINGLEVALUE(" + str(key) + ",$," + type + "(" + (typeof value === "number" ? real(value) : typeof value === "boolean" ? value ? ".T." : ".F." : str(value)) + "),$)"));
      const ps = add("IFCPROPERTYSET(" + g("properties/" + name) + ",$," + str(name) + ",$," + refs(properties) + ")");
      add("IFCRELDEFINESBYPROPERTIES(" + g("properties-relation/" + name) + ",$,$,$," + refs([target]) + "," + ref(ps) + ")");
    }
    propertySet("FORMEQUA_PlanningStudy", project, [
      ["ModelScope", "IFCTEXT", note], ["Coordinates", "IFCLABEL", "IFC X = model X; IFC Y = -model Z; IFC Z = height; metres"],
      ["IsSurveyed", "IFCBOOLEAN", false], ["ParcelKey", "IFCLABEL", parcelKey], ["Option", "IFCLABEL", option],
      ["PlanningHeightIncludingRoofAllowance", "IFCLENGTHMEASURE", Number.isFinite(model.buildingHeightM) ? model.buildingHeightM : null],
      ["FacadeReference", "IFCTEXT", options.facadeName || model.facade && model.facade.nameKr]
    ]);
    propertySet("FORMEQUA_SiteReference", site, [
      ["FrameRotationRadians", "IFCREAL", rotation], ["BoundarySource", "IFCLABEL", geo ? geo.source || "unconfirmed" : "example preset; no applied cadastral boundary"],
      ["SourceCheckedAt", "IFCLABEL", geo && geo.fetchedAt], ["PNU", "IFCTEXT", pnus.join(" + ")],
      ["Georeferencing", "IFCTEXT", "WGS84 site reference only. Approximate local metre frame; no projected CRS or IfcMapConversion supplied."],
      ["ElevationDatum", "IFCLABEL", "Unsurveyed local ground = 0 m"]
    ]);
    const storeys = [];
    function closedCurve(points, dimension) {
      const unique = points.slice();
      if (unique.length > 1 && unique[0].every((n, i) => n === unique[unique.length - 1][i])) unique.pop();
      if (unique.length < 3) fail("a parcel ring needs at least three vertices.");
      const ids = unique.map(p => point(dimension === 3 ? [finite(p[0], "boundary X"), -finite(p[1], "boundary Z"), 0] : p));
      return add("IFCPOLYLINE(" + refs(ids.concat(ids[0])) + ")");
    }
    function solidShape(width, depth, height, atrium, profileLabel) {
      const w = width / 2, d = depth / 2;
      const outer = closedCurve([[-w, -d], [w, -d], [w, d], [-w, d]], 2);
      let profile;
      if (atrium) {
        const inner = closedCurve([[-w * 0.35, -d * 0.35], [-w * 0.35, d * 0.35], [w * 0.35, d * 0.35], [w * 0.35, -d * 0.35]], 2);
        profile = add("IFCARBITRARYPROFILEDEFWITHVOIDS(.AREA.,'Planning floor with atrium'," + ref(outer) + "," + refs([inner]) + ")");
      } else profile = add("IFCARBITRARYCLOSEDPROFILEDEF(.AREA.," + str(profileLabel || "Planning floor") + "," + ref(outer) + ")");
      const solid = add("IFCEXTRUDEDAREASOLID(" + ref(profile) + "," + ref(worldAxis) + "," + ref(up) + "," + real(height) + ")");
      const shape = add("IFCSHAPEREPRESENTATION(" + ref(context) + ",'Body','SweptSolid'," + refs([solid]) + ")");
      return add("IFCPRODUCTDEFINITIONSHAPE($,$," + refs([shape]) + ")");
    }
    function emitFloor(level, width, depth, elevation, height, centerX, centerZ, atrium, source) {
      const key = level < 0 ? "B" + -level : "F" + level;
      const name = level < 0 ? "Basement B" + -level : "Level " + level;
      const storeyPlacement = placement(buildingPlacement, [0, 0, elevation]);
      const storey = add("IFCBUILDINGSTOREY(" + g("storey/" + key) + ",$," + str(name) + ",$,$," + ref(storeyPlacement) + ",$,$,.ELEMENT.," + real(elevation) + ")");
      storeys.push(storey);
      const massPlacement = placement(storeyPlacement, [centerX, -centerZ, 0]);
      const shape = solidShape(width, depth, height, atrium);
      const mass = add("IFCBUILDINGELEMENTPROXY(" + g("mass/" + key) + ",$," + str(name + " planning volume") + "," + str(note) + ",'PlanningMass'," + ref(massPlacement) + "," + ref(shape) + "," + str(key + "_MASS") + ",.ELEMENT.)");
      const elements = [mass];
      if (!simpleMass && options.includeSlabs !== false) {
        const thickness = level < 0 ? 0.35 : 0.28;
        // WebGL basement slabs are centered on -3.5m*n; above slabs start at zBottom.
        const slabPlacement = placement(storeyPlacement, [centerX, -centerZ, level < 0 ? -thickness / 2 : 0]);
        const slabShape = solidShape(width, depth, thickness, atrium);
        elements.push(add("IFCSLAB(" + g("slab/" + key) + ",$," + str(name + " conceptual floor slab") + "," + str("Planning slab thickness only; not structural design.") + ",$," + ref(slabPlacement) + "," + ref(slabShape) + "," + str(key + "_SLAB") + ",.FLOOR.)"));
      }
      for (const core of sharedCores) {
        const coreKey = key + "/" + core.id, cx = (core.minX + core.maxX) / 2, cz = (core.minZ + core.maxZ) / 2;
        // Shared cores already use the final model frame. Parent directly to
        // the storey, so floor northShift and basement centre do not move them.
        const corePlacement = placement(storeyPlacement, [cx, -cz, 0]);
        const coreShape = solidShape(core.maxX - core.minX, core.maxZ - core.minZ, height, false, "Core reservation footprint");
        const coreProxy = add("IFCBUILDINGELEMENTPROXY(" + g("core/" + coreKey) + ",$," + str(name + " planning core reservation " + core.id) + "," + str(coreNote) + ",'CoreReservation'," + ref(corePlacement) + "," + ref(coreShape) + "," + str(key + "_CORE_" + core.id) + ",.USERDEFINED.)");
        elements.push(coreProxy);
        propertySet("FORMEQUA_CoreReservation_" + coreKey, coreProxy, [
          ["SharedCoreId", "IFCIDENTIFIER", core.id], ["PlanningReservation", "IFCBOOLEAN", true],
          ["IsStructuralElement", "IFCBOOLEAN", false], ["IsDetailedBim", "IFCBOOLEAN", false],
          ["CountedAsAdditionalGrossArea", "IFCBOOLEAN", false], ["ModelScope", "IFCTEXT", coreNote],
          ["CenterX", "IFCLENGTHMEASURE", cx], ["CenterY", "IFCLENGTHMEASURE", -cz], ["Height", "IFCLENGTHMEASURE", height]
        ]);
      }
      contain(key, storey, elements);
      const geometricArea = width * depth * (atrium ? 1 - 0.35 * 0.35 : 1);
      const grossArea = source && Number.isFinite(source.areaSqm) ? source.areaSqm : geometricArea;
      const netArea = source && Number.isFinite(source.netFloorSqm) ? source.netFloorSqm : null;
      if (grossArea < 0 || netArea !== null && netArea < 0) fail("floor areas must not be negative.");
      const quantities = [add("IFCQUANTITYAREA('GrossFloorArea',$,$," + real(grossArea) + ",$)")];
      if (netArea !== null) quantities.push(add("IFCQUANTITYAREA('NetFloorArea',$,$," + real(netArea) + ",$)"));
      quantities.push(add("IFCQUANTITYVOLUME('GrossVolume',$,$," + real(geometricArea * height) + ",$)"));
      const qset = add("IFCELEMENTQUANTITY(" + g("quantities/" + key) + ",$,'Qto_BuildingStoreyBaseQuantities',$,'Conceptual planning geometry'," + refs(quantities) + ")");
      add("IFCRELDEFINESBYPROPERTIES(" + g("quantities-relation/" + key) + ",$,$,$," + refs([storey]) + "," + ref(qset) + ")");
      propertySet("FORMEQUA_Floor_" + key, storey, [
        ["PlanningUse", "IFCLABEL", source ? source.useLabelKr || source.use || "unconfirmed" : "Parking / MEP planning"],
        ["CenterX", "IFCLENGTHMEASURE", centerX], ["CenterY", "IFCLENGTHMEASURE", -centerZ], ["Height", "IFCLENGTHMEASURE", height]
      ]);
      return { storey, storeyPlacement };
    }
    if (below) {
      let bp = model.basementPlacement;
      if (!bp) {
        const w = positive(model.siteWidthM, "siteWidthM"), d = positive(model.siteDepthM, "siteDepthM");
        const area = positive(model.areas && model.areas.basementPlateSqm, "basementPlateSqm");
        const scale = Math.sqrt(area / (w * d));
        bp = { widthM: w * scale, depthM: d * scale, centerX: 0, centerZ: 0 };
      }
      positive(bp.widthM, "basement width"); positive(bp.depthM, "basement depth");
      const bx = bp.centerX === undefined ? 0 : finite(bp.centerX, "basement centerX"), bz = bp.centerZ === undefined ? 0 : finite(bp.centerZ, "basement centerZ");
      for (let b = below; b >= 1; b--) emitFloor(-b, bp.widthM, bp.depthM, -b * 3.5, 3.5, bx, bz, false, null);
    }
    let highestStorey;
    for (const fp of floors) highestStorey = emitFloor(fp.level, fp.widthM, fp.depthM, fp.zBottom,
      fp.zTop === undefined ? fallbackHeight : fp.zTop - fp.zBottom, 0, fp.northShiftM === undefined ? 0 : fp.northShiftM, !!fp.hasAtrium, fp);
    if (highestStorey && !simpleMass && options.includeSlabs !== false) {
      const fp = floors[floors.length - 1], height = fp.zTop === undefined ? fallbackHeight : fp.zTop - fp.zBottom;
      // Matches the renderer's 0.45m slab centered at zTop + 0.22m.
      const roofPlacement = placement(highestStorey.storeyPlacement, [0, -(fp.northShiftM || 0), height - 0.005]);
      const roofShape = solidShape(fp.widthM, fp.depthM, 0.45, !!fp.hasAtrium);
      const roof = add("IFCSLAB(" + g("slab/roof") + ",$,'Conceptual roof slab'," + str("Planning roof slab only; rooftop PV/equipment and roof-height allowance not modelled.") + ",$," + ref(roofPlacement) + "," + ref(roofShape) + ",'ROOF_SLAB',.ROOF.)");
      contain("roof", highestStorey.storey, [roof]);
    }
    aggregate("building-storeys", building, storeys);
    if (geo && Array.isArray(geo.outlines) && geo.outlines.length && options.includeParcelBoundary !== false) {
      const curves = geo.outlines.flatMap(polygon => polygon.map(ring => closedCurve(ring, 3)));
      const curveSet = add("IFCGEOMETRICCURVESET(" + refs(curves) + ")");
      const footprint = add("IFCSHAPEREPRESENTATION(" + ref(context) + ",'FootPrint','GeometricCurveSet'," + refs([curveSet]) + ")");
      const definition = add("IFCPRODUCTDEFINITIONSHAPE($,$," + refs([footprint]) + ")");
      const boundaryPlacement = placement(sitePlacement, [0, 0, 0]);
      const boundary = add("IFCBUILDINGELEMENTPROXY(" + g("parcel-boundary") + ",$,'Applied parcel outline'," + str("Imported cadastral outline in the same approximate local frame as the mass; not a survey.") + ",'PlanningParcelOutline'," + ref(boundaryPlacement) + "," + ref(definition) + ",'PARCEL_BOUNDARY',.USERDEFINED.)");
      contain("parcel-boundary", site, [boundary]);
    }
    return ["ISO-10303-21;", "HEADER;", "FILE_DESCRIPTION(('FORMEQUA conceptual planning mass; not survey or permit BIM'),'2;1');",
      "FILE_NAME(" + str("formequa-mass-" + parcelKey + "-" + option + ".ifc") + "," + str(new Date(exportedAt).toISOString()) + ",('FORMEQUA'),('FORMEQUA'),'FORMEQUA mass-ifc 1','FORMEQUA','');",
      "FILE_SCHEMA(('IFC4'));", "ENDSEC;", "DATA;", ...lines, "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");
  }
  return Object.freeze({ buildIfc, guid, decimalDegreesToDms });
});
