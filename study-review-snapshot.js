/** Private owner review archive. This module never publishes a project or reads browser storage. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.AtelierStudyReviewSnapshot = api; api.mount(root); }
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";
  const FORMAT_VERSION = 1, MAX_DEPTH = 60, MAX_NODES = 750000;
  const plansByModel = new WeakMap(), contextByModel = new WeakMap(), auxiliaryByModel = new WeakMap();
  const lawLookups = new Map();
  let mountedHost = null;
  const credentialKeys = new Set(["apikey", "secret", "clientsecret", "accesskey", "secretkey", "privatekey", "password", "passwd", "authorization", "accesstoken", "refreshtoken", "idtoken", "bearertoken", "token", "cookie", "cookies", "credentials", "sessionstorage", "localstorage", "storage", "jusoapikey", "vworldapikey", "vworldpriceapikey", "vworldtwinapikey", "openaiapikey"]);
  const keyName = key => String(key).replace(/[^a-z0-9]/gi, "").toLowerCase();
  const isCredentialKey = key => credentialKeys.has(keyName(key));
  const warning = (warnings, path, reason, extra) => warnings.push({ path, reason, ...(extra || {}) });
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const plain = value => {
    const proto = Object.getPrototypeOf(value);
    return proto === null || proto === Object.prototype || (Object.getPrototypeOf(proto) === null && Object.getOwnPropertyDescriptor(proto, "constructor")?.value?.name === "Object");
  };
  function notifyDetail(kind, model = null) {
    if (!mountedHost?.dispatchEvent || typeof mountedHost.CustomEvent !== "function") return;
    mountedHost.dispatchEvent(new mountedHost.CustomEvent("atelier:review-detail-updated", { detail: { kind, model } }));
  }

  /** Invalid/unsupported values become explicit nulls with paths, never JSON.stringify's silent omissions. */
  function jsonSafe(value, options = {}) {
    const warnings = options.warnings || [], ancestors = new WeakMap();
    let nodes = 0;
    const visit = (item, path, depth) => {
      if (++nodes > (options.maxNodes || MAX_NODES)) { warning(warnings, path, "node_limit", { replacement: null }); return null; }
      if (depth > (options.maxDepth || MAX_DEPTH)) { warning(warnings, path, "depth_limit", { replacement: null }); return null; }
      if (item === null || typeof item === "boolean") return item;
      if (typeof item === "string") {
        // Provider links are evidence, but request credentials must not travel with a URL.
        if (/^https?:\/\//i.test(item)) {
          try {
            const url = new URL(item); let changed = false;
            for (const key of [...url.searchParams.keys()]) if (isCredentialKey(key)) { url.searchParams.set(key, "[excluded]"); changed = true; }
            if (url.username || url.password) { url.username = ""; url.password = ""; changed = true; }
            if (changed) { warning(warnings, path, "url_credentials_excluded"); return url.href; }
          } catch (_) { /* Preserve non-URL source text. */ }
        }
        return item;
      }
      if (typeof item === "number") {
        if (Number.isFinite(item)) return item;
        warning(warnings, path, "non_finite_number", { replacement: null }); return null;
      }
      if (typeof item !== "object") { warning(warnings, path, `unsupported_${typeof item}`, { replacement: null }); return null; }
      if (ancestors.has(item)) { warning(warnings, path, "circular_reference", { referencePath: ancestors.get(item), replacement: null }); return null; }
      if (!Array.isArray(item) && !plain(item)) { warning(warnings, path, "non_json_object", { replacement: null }); return null; }
      // A plain DOM facade must also remain outside the archive.
      if (own(item, "nodeType") || own(item, "ownerDocument") || own(item, "isObject3D") || own(item, "isWebGLRenderer")) {
        warning(warnings, path, "runtime_object_excluded", { replacement: null }); return null;
      }
      ancestors.set(item, path);
      const output = Array.isArray(item) ? [] : {};
      if (Array.isArray(item) && item.length > (options.maxNodes || MAX_NODES) - nodes) {
        warning(warnings, path, "collection_limit", { replacement: null }); ancestors.delete(item); return null;
      }
      const keys = Array.isArray(item) ? Array.from({ length: item.length }, (_, index) => String(index)) : Object.keys(item);
      for (const key of keys) {
        const childPath = Array.isArray(item) ? `${path}[${key}]` : `${path}.${key}`;
        if (["__proto__", "prototype", "constructor"].includes(key)) { warning(warnings, childPath, "unsafe_field_excluded"); continue; }
        if (isCredentialKey(key)) { warning(warnings, childPath, "credential_field_excluded", { replacement: null }); Object.defineProperty(output, key, { value: null, enumerable: true, writable: true, configurable: true }); continue; }
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        let normalized;
        if (!descriptor) { warning(warnings, childPath, "array_hole", { replacement: null }); normalized = null; }
        else if (!own(descriptor, "value")) { warning(warnings, childPath, "accessor_excluded", { replacement: null }); normalized = null; }
        else normalized = visit(descriptor.value, childPath, depth + 1);
        Object.defineProperty(output, key, { value: normalized, enumerable: true, writable: true, configurable: true });
      }
      for (const key of Object.getOwnPropertySymbols(item)) warning(warnings, `${path}.[symbol]`, "symbol_key_excluded");
      ancestors.delete(item);
      return output;
    };
    return { value: visit(value, options.path || "$", 0), warnings };
  }

  function recordPlans(detail) {
    if (!detail?.model || typeof detail.model !== "object") return;
    const entries = Array.isArray(detail.plans) ? detail.plans : detail.plan ? [{ level: detail.floor?.level ?? detail.plan.level, plan: detail.plan }] : [];
    const records = new Map(plansByModel.get(detail.model) || []);
    let changed = false;
    for (const entry of entries) {
      const plan = entry?.plan || entry, level = entry?.level ?? plan?.level;
      if (Number.isInteger(level) && level > 0 && level <= 100 && plan && typeof plan === "object") {
        if (records.get(level) !== plan) changed = true;
        records.set(level, plan);
      }
    }
    plansByModel.set(detail.model, records);
    if (changed) notifyDetail("plans", detail.model);
  }
  function recordSiteContext(model, value) {
    if (model && typeof model === "object") {
      contextByModel.set(model, { ...contextByModel.get(model), ...value });
      notifyDetail("site-context", model);
    }
  }
  function recordLawLookup(query, value) {
    if (!query || typeof query !== "object") return;
    const key = JSON.stringify([query.target, query.query, query.article]);
    lawLookups.set(key, { ...query, ...value });
    // Only user-selectable law presets are retained; do not cache arbitrary response history.
    if (lawLookups.size > 32) lawLookups.delete(lawLookups.keys().next().value);
    notifyDetail("law-lookup");
  }
  function recordAuxiliary(model, value) {
    if (model && typeof model === "object") {
      auxiliaryByModel.set(model, { ...auxiliaryByModel.get(model), ...value });
      notifyDetail("auxiliary-reference", model);
    }
  }

  function build(options = {}) {
    const state = options.state || {}, model = state.lastComputed?.model || null, warnings = [];
    const features = Array.isArray(state.parcelData?.features) ? state.parcelData.features : [];
    if (features.length > 5) warning(warnings, "$.site.parcels", "parcel_limit", { retained: 5, omitted: features.length - 5 });
    const parcels = features.slice(0, 5).map((feature, index) => {
      const props = feature?.properties || {};
      if (typeof props.address !== "string" || !props.address.trim()) warning(warnings, `$.site.parcels[${index}].address`, "address_not_available");
      if (typeof props.pnu !== "string" || !/^\d{19}$/.test(props.pnu)) warning(warnings, `$.site.parcels[${index}].pnu`, "pnu_not_available");
      return { address: typeof props.address === "string" ? props.address : null, pnu: typeof props.pnu === "string" && /^\d{19}$/.test(props.pnu) ? props.pnu : null };
    });
    const firstRing = model?.parcelGeometry?.outlines?.[0]?.[0];
    const boundary = Array.isArray(firstRing) ? firstRing.map(point => ({ x: point?.[0], z: point?.[1] })) : [];
    let project = null, projectStatus = "not_generated";
    if (typeof options.workspace?.exportProject === "function") {
      try { project = options.workspace.exportProject(); projectStatus = "exported"; }
      catch (_) { projectStatus = "export_failed"; warning(warnings, "$.reviewData.project", "project_export_failed", { replacement: null }); }
    } else warning(warnings, "$.reviewData.project", "project_export_unavailable", { replacement: null });
    const inputs = Object.fromEntries(Object.entries(state).filter(([key]) => !["lastComputed", "lawSyncedMeta"].includes(key)));
    const records = plansByModel.get(model) || new Map();
    const aboveGround = (model?.floorPlates || []).map(floor => {
      const plan = records.get(floor.level) || null;
      return { level: floor.level, floor, status: plan?.status || (plan ? "generated" : "not_generated"), plan };
    });
    const underground = Array.from({ length: Math.min(7, Math.max(0, Math.floor(state.floorsBelow || 0))) }, (_, index) => ({
      level: -index - 1, use: "basement", zBottom: -(index + 1) * 3.5, zTop: -index * 3.5,
      placement: model?.basementPlacement || null, interiorStatus: "not_generated", interiorPlan: null,
      parkingLayout: model?.parking?.layout || null
    }));
    const legal = options.legal || {}, regulations = options.parcelRegulations || {}, building = options.buildingReview || {};
    const context = contextByModel.get(model) || null;
    const raw = {
      site: { parcels, boundary },
      reviewData: {
        project,
        calculations: {
          inputs, model, residual: state.lastComputed?.residual || null, optA: state.lastComputed?.optA || null,
          optB: state.lastComputed?.optB || null, optC: state.lastComputed?.optC || null,
          auxiliaryReference: auxiliaryByModel.get(model) || null
        },
        floorPlans: { aboveGround, underground, coreLayout: model?.coreLayout || null, parking: model?.parking || null,
          generatedFloorCount: aboveGround.filter(row => row.plan?.status === "generated").length,
          scope: "existing-generated-concept-plans; underground-interiors-not-generated; no-permit-confirmation" },
        legalEvidence: {
          mode: state.regulationMode || "statutory", lawSyncedMeta: state.lawSyncedMeta || null,
          density: { checkedAt: legal.checkedAt || null, densityCheckedAt: legal.densityCheckedAt || null, sources: legal.sources || [] },
          parcelRegulations: { checkedAt: regulations.checkedAt || null, sources: regulations.sources || [] },
          buildingReviewSources: { checkedAt: building.checkedAt || null, sources: building.sources || [] },
          parcelRecords: features.map(feature => ({ pnu: feature?.properties?.pnu || null, regulations: feature?.properties?.regulations || null })),
          applied: { zoningRule: model?.zoningRule || null, effectiveRegulationInputs: model?.effectiveRegulationInputs || null,
            parcelRegulationReview: model?.parcelRegulationReview || null, usePermission: model?.usePermission || null,
            buildingReview: model?.buildingReview || null, egress: model?.egress || null },
          liveArticleLookups: [...lawLookups.values()],
          permitConfirmation: false,
          unresolved: ["개별 고시의 효력·승인 조건과 접도·공부 면적은 별도 확인", "구조 해석·법정 피난·실시설계는 미완료", "수동 법규·수익·비용 입력은 사용자 가정"]
        },
        siteContext: { parcelData: state.parcelData || null, parcelGeometry: model?.parcelGeometry || null,
          sitePlacement: model?.sitePlacement || null, siteReference: model?.siteReference || null,
          roadWidthInputM: state.roadWidthM ?? null, roadWidthVerified: false,
          surroundingContext: context?.data || null, surroundingStatus: context?.status || "not_generated",
          surroundingRequestedAt: context?.requestedAt || null, surroundingFetchedAt: context?.fetchedAt || null,
          coordinateFrame: "local-xz-metres; original-parcel-GeoJSON-EPSG:4326-preserved" },
        runtime: { formatVersion: FORMAT_VERSION, capturedAt: new Date().toISOString(), source: "current-browser-review",
          calculationStatus: state.lastComputed ? "calculated" : "not_generated", projectStatus,
          planStatus: aboveGround.some(row => row.plan) ? "existing_plans_captured" : "not_generated",
          parcelSource: state.parcelData?.source || "example-or-manual-assumption", isPermitConfirmation: false,
          serializationWarnings: [] }
      }
    };
    const clean = jsonSafe(raw, { warnings }).value;
    clean.reviewData.runtime.serializationWarnings = warnings;
    return clean;
  }

  function mount(host) {
    if (!host || mountedHost === host) return;
    mountedHost = host;
    host.addEventListener?.("atelier:plan-selected", event => recordPlans(event.detail));
  }
  return Object.freeze({ build, jsonSafe, recordPlans, recordSiteContext, recordLawLookup, recordAuxiliary, mount, FORMAT_VERSION });
});
