/*
 * Dimensioned facade study geometry, independent of Three.js.
 * Panel subdivision, thickness and joint parameters follow ordinary facade
 * design principles. This is original study code, not a FreeCAD/Grasshopper
 * integration or a manufacturer-approved fabrication/detailing model.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AtelierFacadeGeometry = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_PANELS = 512;
  const finite = (value, fallback) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function clampLouverAngle(angleDeg) {
    return clamp(finite(angleDeg, 22), -60, 60);
  }

  function louverAngleRadians(angleDeg) {
    return clampLouverAngle(angleDeg) * Math.PI / 180;
  }

  function generatePanelBand(options) {
    const input = options && typeof options === "object" ? options : {};
    const widthM = finite(input.widthM, 0);
    const depthM = finite(input.depthM, 0);
    const heightM = finite(input.heightM, 0);
    const northShiftM = finite(input.northShiftM, 0);
    const yCenterM = finite(input.yCenterM, heightM / 2);
    const warnings = [];
    if (widthM <= 0 || depthM <= 0 || heightM <= 0 || !Number.isFinite(yCenterM + heightM / 2) || !Number.isFinite(northShiftM + depthM / 2)) {
      return { panels: [], bounds: null, metadata: { panelCount: 0 }, warnings: ["invalid_dimensions"] };
    }

    // A band stays inside the legal footprint. End faces own the corners;
    // side faces stop before them, avoiding overlapping corner solids.
    const thicknessM = clamp(finite(input.thicknessMm, 35) / 1000, Math.min(0.001, widthM / 8, depthM / 8), Math.min(0.4, widthM / 4, depthM / 4));
    const jointM = clamp(finite(input.jointMm, 8) / 1000, 0, Math.min(0.05, widthM / 8, depthM / 8, heightM / 4));
    const requestedModuleWidthM = clamp(finite(input.moduleWidthM, 1.2), 0.1, 20);
    const maxPanels = Math.floor(clamp(finite(input.maxPanels, MAX_PANELS), 4, MAX_PANELS));
    const sideSpanM = depthM - 2 * thicknessM - jointM;
    const countsFor = moduleWidth => ({
      front: Math.max(1, Math.ceil(widthM / moduleWidth)),
      side: Math.max(1, Math.ceil(sideSpanM / moduleWidth))
    });
    const totalCount = counts => 2 * (counts.front + counts.side);
    let resolvedModuleWidthM = requestedModuleWidthM;
    let counts = countsFor(resolvedModuleWidthM);
    if (totalCount(counts) > maxPanels) {
      // Broaden the module rather than silently dropping whole facade areas.
      // Binary search also bounds work for very large input dimensions.
      let low = requestedModuleWidthM;
      let high = Math.max(widthM, sideSpanM, low);
      for (let step = 0; step < 56; step++) {
        const midpoint = low + (high - low) / 2;
        if (totalCount(countsFor(midpoint)) > maxPanels) low = midpoint;
        else high = midpoint;
      }
      resolvedModuleWidthM = high;
      counts = countsFor(resolvedModuleWidthM);
      warnings.push("module_width_increased_for_performance");
    }

    const bounds = {
      minX: -widthM / 2, maxX: widthM / 2,
      minY: yCenterM - heightM / 2, maxY: yCenterM + heightM / 2,
      minZ: northShiftM - depthM / 2, maxZ: northShiftM + depthM / 2
    };
    const panels = [];
    const moduleWidthByFace = {};
    const panelHeightM = heightM - jointM;

    function addFace(face, spanM, count, alongX, fixedPosition) {
      const gridWidthM = spanM / count;
      const panelWidthM = gridWidthM - jointM;
      // Small dimensions and a large requested joint still produce a visible,
      // positive panel because the joint is bounded by the physical footprint.
      if (panelWidthM <= 0) return;
      moduleWidthByFace[face] = { count, gridWidthM, panelWidthM };
      for (let index = 0; index < count; index++) {
        const along = -spanM / 2 + gridWidthM * (index + 0.5);
        panels.push({
          face, index,
          position: alongX ? [along, yCenterM, fixedPosition] : [fixedPosition, yCenterM, northShiftM + along],
          size: alongX ? [panelWidthM, panelHeightM, thicknessM] : [thicknessM, panelHeightM, panelWidthM]
        });
      }
    }

    addFace("front", widthM, counts.front, true, bounds.maxZ - thicknessM / 2);
    addFace("back", widthM, counts.front, true, bounds.minZ + thicknessM / 2);
    addFace("east", sideSpanM, counts.side, false, bounds.maxX - thicknessM / 2);
    addFace("west", sideSpanM, counts.side, false, bounds.minX + thicknessM / 2);

    return {
      panels, bounds,
      metadata: {
        panelCount: panels.length, maxPanels,
        thicknessM, jointM, panelHeightM,
        requestedModuleWidthM, resolvedModuleWidthM, moduleWidthByFace,
        cornerTreatment: "front_back_ownership",
        coordinateSystem: "x_width_y_up_z_depth_front_positive_z"
      },
      warnings
    };
  }

  return Object.freeze({ generatePanelBand, clampLouverAngle, louverAngleRadians, MAX_PANELS });
});
