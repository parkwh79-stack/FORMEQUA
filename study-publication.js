/* Private review JSON. Public portfolio images are published manually. */
(function (root, factory) {
  "use strict";
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.AtelierStudyPublication = api; if (root.document) api.mount(root); }
})(typeof window !== "undefined" ? window : null, function (defaultHost) {
  "use strict";
  const PROGRAMS = new Set(["office", "officetel", "hotel", "housing", "living", "knowledge", "retail", "sales"]);
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const round = (value, digits = 3) => Number(value.toFixed(digits));
  const valid = (value, min, max) => finite(value) && value >= min && value <= max;
  const STORAGE_KEY = "formequa:study-reviews:v1";
  const MAX_FINGERPRINTS = 100;
  const MAX_REVIEW_BYTES = 20 * 1024 * 1024;
  const REVIEW_FIELDS = ["project", "calculations", "floorPlans", "legalEvidence", "siteContext", "runtime"];
  const CREDENTIAL_KEYS = new Set(["apikey", "openaiapikey", "geminiapikey", "googleapikey", "vworldapikey", "jusoapikey", "authorization", "accesstoken", "refreshtoken", "bearertoken", "password", "clientsecret", "privatekey", "secretkey", "credentials", "cookie", "sessioncookie"]);
  const VOLATILE_KEYS = new Set(["capturedAt", "createdAt", "exportedAt", "updatedAt", "generatedAt", "calculatedAt", "snapshotAt", "timestamp", "lastSavedAt", "savedAt"]);
  const PALETTES = new Set(["limestone", "bronze", "stone", "white", "terracotta"]);
  const FACADES = new Set(["curtain_wall", "brick_rainscreen", "stone_ribbon", "kinetic_louver", "diagrid_biophilic"]);
  const CONTROLS = "#parcelApply,#parcelSelect,#chkParcelMerger,#sliderFloorsAbove,#sliderFloorsBelow,#sliderTargetBcr,#sliderFloorHeight,#sliderSetback,#sliderSetbackSide,#sliderSetbackRear,#sliderPublicContribPct,#inputSiteArea,#inputRoadWidth,#inputLegalFarCap,#inputLegalBcrCap,#inputLegalHeightCap,#selectZoning,#selectBuildingUse,#selectStudyProgram,#selectRegulationMode,#selectResidentialType,#selectMixedUseProfile,#selectParkingMode,#selectParkingDistrict,#sliderFacadeWwr,#sliderFacadeBay,#sliderFacadeLouver,#sliderFacadePanelDepth,#sliderFacadeJoint,#sliderFacadeLouverAngle,[data-facade],[data-qfacade],[data-mat],[data-qmat],[data-realytics-program],[data-option],[data-select-option]";
  const REVIEW_ACTIONS = "#btnOpenInterior,#btnInspectInterior,#btnFocusInterior,#btnFetchLawLive,#btnSyncZoningLaw,#btnVerifyPythonSkills,#realyticsPlan3d,#realyticsGenerateConcept,#realyticsRunAnalysis,[data-select-floor],[data-refresh-regulations]";
  const VIEW_CONTROLS = "#sliderClipPlane,#sliderSunHour,#chkShowDimensions,#interiorWalkSpeed,#realyticsPlanLabels,#realyticsPlanFurniture,#interiorFootwork input,#interiorFootwork select";
  const CANCEL_CONTROLS = "#parcelClear,[data-reset-manual-limits],[data-view='reset'],#projectFiles,[data-project-load],[data-project-input]";
  function cloneReviewData(source) {
    try {
      if (!source.site || typeof source.site !== "object" || Array.isArray(source.site) || !source.reviewData || typeof source.reviewData !== "object" || Array.isArray(source.reviewData)) return null;
      if (Object.keys(source.reviewData).length !== REVIEW_FIELDS.length || REVIEW_FIELDS.some(key => !Object.hasOwn(source.reviewData, key))) return null;
      const json = JSON.stringify({ site: source.site, reviewData: source.reviewData });
      if (json.length > MAX_REVIEW_BYTES || new TextEncoder().encode(json).byteLength > MAX_REVIEW_BYTES) return null;
      const cloned = JSON.parse(json, (key, value) => {
        const normalized = key.replace(/[-_]/g, "").toLowerCase();
        // The source may retain explicit null redaction markers for auditability.
        if (value !== null && CREDENTIAL_KEYS.has(normalized)) throw new Error("CREDENTIAL_NOT_ALLOWED");
        if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("UNSAFE_JSON_KEY");
        return value;
      });
      const pending = [[cloned, 0]]; let nodes = 0;
      while (pending.length) {
        const [value, depth] = pending.pop();
        if (++nodes > 750000 || depth > 64) throw new Error("REVIEW_STRUCTURE_TOO_DEEP");
        if (value && typeof value === "object") for (const child of Object.values(value)) pending.push([child, depth + 1]);
      }
      return cloned;
    } catch (_) { return null; }
  }
  function stableReview(value) {
    if (Array.isArray(value)) return value.map(stableReview);
    if (value && typeof value === "object") {
      const result = {};
      for (const key of Object.keys(value).sort()) if (!VOLATILE_KEYS.has(key)) result[key] = stableReview(value[key]);
      return result;
    }
    return value;
  }

  function normalizeSnapshot(source) {
    if (!source || source.eligible !== true || !source.summary || !Array.isArray(source.plates)) return null;
    const s = source.summary;
    if (!PROGRAMS.has(s.program) || !valid(s.siteAreaSqm, 1, 1000000) || !valid(s.farPct, 0, 1500) ||
      !valid(s.bcrPct, 0, 100) || !Number.isInteger(s.floors) || s.floors < 0 || s.floors > 100 || source.plates.length !== s.floors) return null;
    const plates = [];
    for (const p of source.plates) {
      if (!p || !Number.isInteger(p.level) || p.level < 1 || p.level > 100 || !valid(p.width, .1, 2000) || !valid(p.depth, .1, 2000) ||
        !valid(p.height, .1, 30) || !valid(p.y, .05, 2000) || !valid(p.shiftX ?? 0, -2000, 2000) || !valid(p.shiftZ ?? 0, -2000, 2000)) return null;
      // The model schema remains bounded independently of the complete private review record.
      plates.push({ level: p.level, width: round(p.width), depth: round(p.depth), height: round(p.height), y: round(p.y),
        shiftX: round(p.shiftX ?? 0), shiftZ: round(p.shiftZ ?? 0), courtyard: p.courtyard === true });
    }
    plates.sort((a, b) => a.level - b.level);
    if (plates.some((p, index) => p.level !== index + 1)) return null;
    const review = cloneReviewData(source);
    if (!review) return null;
    return { summary: { program: s.program, siteAreaSqm: Math.max(10, Math.round(s.siteAreaSqm / 10) * 10), farPct: round(s.farPct, 1), bcrPct: round(s.bcrPct, 1), floors: s.floors },
      plates, appearance: { palette: PALETTES.has(source.appearance?.palette) ? source.appearance.palette : "limestone",
        ...(FACADES.has(source.appearance?.facade) ? { facade: source.appearance.facade } : {}) },
      ...review, geometryKey: typeof source.geometryKey === "string" ? source.geometryKey.slice(0, 20000) : "" };
  }
  // Review timestamps are retained in storage, but do not create a new duplicate record.
  function fingerprintSource(snapshot) {
    const safe = normalizeSnapshot({ ...snapshot, eligible: true });
    if (!safe) throw new Error("STUDY_SNAPSHOT_INVALID");
    return JSON.stringify(stableReview([safe.summary, safe.plates, safe.appearance, safe.site, safe.reviewData]));
  }
  function fingerprint(snapshot) {
    const source = JSON.stringify([1, fingerprintSource(snapshot), snapshot.geometryKey]);
    let first = 2166136261, second = 5381;
    for (let i = 0; i < source.length; i++) { first = Math.imul(first ^ source.charCodeAt(i), 16777619); second = Math.imul(second, 33) ^ source.charCodeAt(i); }
    return (first >>> 0).toString(16).padStart(8, "0") + (second >>> 0).toString(16).padStart(8, "0");
  }
  function reviewPayload(snapshot, modelFingerprint) {
    const safe = normalizeSnapshot({ ...snapshot, eligible: true });
    if (!safe) throw new Error("STUDY_SNAPSHOT_INVALID");
    if (typeof modelFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(modelFingerprint)) throw new Error("STUDY_FINGERPRINT_INVALID");
    const payload = { summary: safe.summary, model: { plates: safe.plates, appearance: safe.appearance }, site: safe.site, reviewData: safe.reviewData, modelFingerprint };
    if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_REVIEW_BYTES) throw new Error("STUDY_REVIEW_TOO_LARGE");
    return payload;
  }
  async function digestFingerprint(source, host = defaultHost) {
    if (!host?.crypto?.subtle || typeof host.TextEncoder !== "function") throw new Error("STUDY_FINGERPRINT_UNAVAILABLE");
    const digest = await host.crypto.subtle.digest("SHA-256", new host.TextEncoder().encode(source));
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  }
  function createController(options) {
    const clock = options.now || Date.now, later = options.setTimeout || setTimeout, cancel = options.clearTimeout || clearTimeout;
    const status = options.onStatus || (() => {}), delay = options.debounceMs ?? 2500, interval = options.intervalMs ?? 30000;
    const hash = options.hashFingerprint || digestFingerprint, seen = new Set();
    let submissions = 0, lastAttempt = -Infinity, observed = null, timer = null, observationTimer = null, revision = 0, pending = null, failed = null, busy = false, armedUntil = -Infinity, hasUserReviewed = false, disposed = false;
    try {
      const saved = JSON.parse(options.storage?.getItem(STORAGE_KEY) || "null");
      if (saved?.version === 1) {
        for (const key of Array.isArray(saved.fingerprints) ? saved.fingerprints.slice(-MAX_FINGERPRINTS) : []) if (typeof key === "string" && /^[a-f0-9]{16}$/.test(key)) seen.add(key);
        if (Number.isSafeInteger(saved.submissions)) submissions = Math.max(0, saved.submissions);
      }
    } catch (_) { /* Disabled browser storage must not interrupt analysis. */ }
    function remember() {
      try { options.storage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, fingerprints: [...seen], submissions })); } catch (_) {}
    }
    function current() { try { return normalizeSnapshot(options.getSnapshot()); } catch (_) { return null; } }
    function stopTimer() { if (timer !== null) cancel(timer); timer = null; }
    function stopObservation() { if (observationTimer !== null) cancel(observationTimer); observationTimer = null; }
    function waiting() { return Boolean(pending) || observationTimer !== null; }
    function schedule(wait = 0) {
      stopTimer(); if (!pending || busy || disposed) return;
      timer = later(run, Math.max(wait, interval - (clock() - lastAttempt), 0));
    }
    function rememberSuccess(key) {
      seen.delete(key); seen.add(key);
      while (seen.size > MAX_FINGERPRINTS) seen.delete(seen.values().next().value);
      submissions++; remember();
    }
    async function run() {
      timer = null; if (busy || !pending || disposed) return;
      const candidate = pending; pending = null;
      if (seen.has(candidate.key)) { status("saved"); return; }
      if (candidate.revision !== revision) { status(waiting() ? "pending" : "idle"); return; }
      busy = true; lastAttempt = clock(); status("saving");
      try {
        const modelFingerprint = await hash(fingerprintSource(candidate.snapshot));
        if (disposed) return;
        if (candidate.revision !== revision) { status(waiting() ? "pending" : "idle"); return; }
        const result = await options.save(reviewPayload(candidate.snapshot, modelFingerprint));
        if (!result || typeof result.study?.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(result.study.id) || typeof result.created !== "boolean" || result.review?.status !== "collected") throw new Error("STUDY_RESPONSE_INVALID");
        rememberSuccess(candidate.key); failed = null;
        if (disposed) return;
        status(candidate.revision === revision ? "saved" : waiting() ? "pending" : "idle");
      } catch (_) {
        if (disposed) return;
        // Neither source inputs nor server error messages are rendered into the notice.
        failed = candidate.revision === revision ? candidate : null;
        status(failed ? "error" : waiting() ? "pending" : "idle");
      } finally { busy = false; if (!disposed && pending) schedule(); }
    }
    function captureObservation() {
      observationTimer = null;
      if (disposed) return;
      const snapshot = current();
      if (!snapshot) {
        const wasPending = pending || failed; observed = null; pending = null; failed = null; stopTimer();
        if (wasPending) status("idle");
        return;
      }
      const key = fingerprint(snapshot);
      if (key === observed && (seen.has(key) || failed)) { status(seen.has(key) ? "saved" : "error"); return; }
      observed = key; pending = null; failed = null; stopTimer();
      if (seen.has(key)) { status("saved"); return; }
      pending = { key, snapshot, revision }; status("pending"); schedule();
    }
    function queueObservation() {
      revision++; pending = null; stopTimer(); stopObservation();
      observationTimer = later(captureObservation, delay);
    }
    function observe() {
      // Full review snapshots can be several MiB. Ignore view-only updates and
      // wait until a human input burst has settled before reading the source.
      if (disposed || clock() > armedUntil) return;
      queueObservation();
    }
    function observeDetail() {
      // User-requested law, site context or interior data can finish after the
      // short input window. Initial automatic detail generation stays local.
      if (disposed || !hasUserReviewed) return;
      queueObservation();
    }
    return Object.freeze({ observe, observeDetail, noteInteraction() { hasUserReviewed = true; armedUntil = clock() + 10000; }, cancelInteraction() {
      hasUserReviewed = false; armedUntil = -Infinity; revision++; pending = null; failed = null; stopTimer(); stopObservation(); status("idle");
    }, retry() {
      if (!failed || busy || disposed) return;
      revision++; stopObservation(); const snapshot = current(); failed = null;
      if (!snapshot) { pending = null; observed = null; stopTimer(); status("idle"); return; }
      const key = fingerprint(snapshot); observed = key;
      if (seen.has(key)) { pending = null; stopTimer(); status("saved"); return; }
      pending = { key, snapshot, revision }; status("pending"); schedule(delay);
    }, dispose() { disposed = true; revision++; pending = null; stopTimer(); stopObservation(); }, state() { return { busy, submissions, pending: waiting(), seen: seen.size, hasUserReviewed }; } });
  }
  function mount(host) {
    if (host?.FORMEQUA_DEPLOYMENT?.reviewStorageEnabled === false) return;
    const doc = host.document; if (!doc || host.__atelierStudyPublicationMounted) return;
    host.__atelierStudyPublicationMounted = true;
    const ready = () => {
      const stage = doc.getElementById("threeStage"); if (!stage) return;
      const notice = doc.createElement("div"); notice.id = "anonymousStudyNotice"; notice.className = "anonymous-study-notice";
      const title = doc.createElement("strong"), detail = doc.createElement("span"), progress = doc.createElement("span"), retry = doc.createElement("button");
      title.textContent = "검토 기록 저장";
      detail.textContent = "검토 기록을 비공개 JSON으로 저장합니다. 주소·지번·설계·법규·주차·실내·사업성 자료를 주간 검토용으로 보관합니다.";
      progress.className = "anonymous-study-status"; progress.setAttribute("role", "status"); progress.setAttribute("aria-live", "polite");
      retry.type = "button"; retry.textContent = "저장 재시도"; retry.hidden = true;
      notice.append(title, detail, progress, retry);
      const anchor = doc.getElementById("realyticsProgramBar") || doc.getElementById("workspaceGrid");
      if (anchor?.parentNode) anchor.insertAdjacentElement("afterend", notice); else stage.insertAdjacentElement("beforebegin", notice);
      let storage = null; try { storage = host.sessionStorage; } catch (_) {}
      const controller = createController({
        storage, now: () => Date.now(), setTimeout: host.setTimeout.bind(host), clearTimeout: host.clearTimeout.bind(host),
        getSnapshot: () => host.AtelierStudyPublicationSource?.snapshot(), hashFingerprint: source => digestFingerprint(source, host),
        async save(body) {
          if (host.FORMEQUA_DEPLOYMENT?.reviewStorageEnabled === false) throw new Error("REVIEW_STORAGE_DISABLED");
          const abort = typeof host.AbortController === "function" ? new host.AbortController() : null;
          const timeout = host.setTimeout(() => abort?.abort(), 15000);
          try {
            const response = await host.fetch("/api/v1/study-reviews", { method: "POST", credentials: "same-origin", mode: "same-origin", redirect: "error", headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify(body), ...(abort ? { signal: abort.signal } : {}) });
            if (!response.ok) throw new Error("STUDY_SAVE_FAILED");
            return await response.json();
          } finally { host.clearTimeout(timeout); }
        },
        onStatus(state) {
          notice.dataset.state = state; retry.hidden = state !== "error";
          progress.textContent = ({ pending: "검토 기록을 준비하고 있습니다.", saving: "검토 기록 저장 중", saved: "비공개 검토 기록이 저장되었습니다.", error: "기록을 저장하지 못했습니다. 현재 분석은 계속 사용할 수 있습니다." })[state] || "";
        }
      });
      const interact = event => {
        if (!event.isTrusted) return;
        if (event.target?.closest?.(CANCEL_CONTROLS)) controller.cancelInteraction();
        else if (event.target?.closest?.(VIEW_CONTROLS)) return;
        else if (event.target?.closest?.(CONTROLS) || event.target?.closest?.(REVIEW_ACTIONS) || (event.type === "input" || event.type === "change") && event.target?.matches?.("input,select,textarea") && !event.target?.closest?.("#anonymousStudyNotice,.topbar-controls")) controller.noteInteraction();
      };
      for (const name of ["input", "change", "click"]) doc.addEventListener(name, interact, true);
      host.addEventListener("atelier:updated", controller.observe);
      host.addEventListener("atelier:review-detail-updated", controller.observeDetail);
      host.addEventListener("atelier:project-loaded", controller.cancelInteraction);
      host.addEventListener("pagehide", event => { if (!event.persisted) controller.dispose(); });
      retry.addEventListener("click", () => controller.retry());
      controller.observe();
    };
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", ready, { once: true }); else ready();
  }
  return Object.freeze({ normalizeSnapshot, fingerprint, fingerprintSource, reviewPayload, digestFingerprint, createController, mount, MAX_REVIEW_BYTES });
});
