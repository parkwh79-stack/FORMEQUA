/**
 * Continue an editable study between the atelier and its detailed workspace.
 * Only user inputs and each known parcel's study are kept in this tab's
 * sessionStorage. Nothing is sent to the server; calculated results, law
 * responses and recording state are omitted.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.AtelierWorkspace = factory(root);
})(typeof window !== "undefined" ? window : this, function createWorkspaceBridge(host) {
  "use strict";
  const VERSION = 1;
  const spatial = host.AtelierSpatialSettings || (typeof require === 'function' ? require('./spatial-settings.js') : null);
  const STORAGE_KEY = "seoul-atelier:workspace:v1";
  const MAX_AGE_MS = 12 * 60 * 60 * 1000;
  const MAX_STORAGE_LENGTH = 5 * 1024 * 1024;
  const PROJECT_FORMAT = "formequa-project";
  const PROJECT_VERSION = 1;
  const MAX_PROJECT_LENGTH = 5 * 1024 * 1024;
  const ENUMS = {
    parcelKey: ["gangnam_yeoksam", "seongdong_seongsu", "mapo_hapjeong", "jongno_euljiro", "custom_seoul"],
    option: ["A", "B", "C"],
    viewMode: ["standard", "envelope", "xray", "exploded"],
    facadeType: ["curtain_wall", "kinetic_louver", "brick_rainscreen", "stone_ribbon", "diagrid_biophilic"],
    claddingMaterial: ["anodized_metal", "terracotta_brick", "limestone", "granite_pocheon", "uhpc_concrete", "champagne_bronze"],
    facadeAccent: ["auto", "titanium", "warm_limestone", "champagne", "terracotta", "crimson_brick", "sage_patina", "sapphire", "basalt_charcoal"],
    glassTint: ["auto", "sapphire_blue", "crystal_clear", "emerald_green", "bronze_gold", "smoke_grey"],
    podiumStyle: ["showwindow", "brick_arcade", "piloti_colonade"],
    zoning: ["일반상업지역", "중심상업지역", "근린상업지역", "준공업지역", "준주거지역", "제3종일반주거지역", "제2종일반주거지역"],
    buildingUse: ["업무시설(오피스)", "업무시설(오피스텔)", "숙박시설(호텔)", "지식산업센터", "공동주택(주상복합)", "근린생활시설(리테일)", "판매시설"],
    hotelType: ["unconfirmed", "general", "tourist"],
    financeMode: ["rental", "hotel"],
    spaceProgram: ["standard", "coliving"],
    parkingMode: ["fit", "report"],
    regulationMode: ["statutory", "scenario"],
    modelDetail: ["auto", "massing", "concept"],
    residentialType: ["apartment", "officetel"],
    housingPermitType: ["building_permit", "housing_approval"],
    parkingDistrict: ["unconfirmed", "standard", "restricted"],
    coreType: ["center", "north", "split"],
    mixedUseProfile: ["office_retail", "mixed_resi", "knowledge_ind", "flagship_hq"], ...spatial?.enums
  };
  // Bounds mirror the existing controls (loan bounds mirror their input handlers).
  const NUMBERS = {
    siteAreaSqm: [200, 20000], roadWidthM: [4, 50], publicContribPct: [0, 25],
    legalFarCapPct: [0, 1500], legalBcrCapPct: [0, 100], maxHeightM: [0, 300],
    housingUnitAreaSqm: [15, 250], housingUnits: [0, 3000, true],
    setbackM: [1, 6], setbackSideM: [0.5, 5], setbackRearM: [1, 6],
    floorsAbove: [1, 35, true], floorsBelow: [0, 7, true], targetBcr: [25, 60], floorHeight: [3, 5.2],
    facadeWwrPct: [30, 85], facadeBayM: [1.5, 4.5], facadeLouverM: [0.05, 1.1],
    facadePanelDepthMm: [10, 100], facadeJointMm: [3, 25], facadeLouverAngleDeg: [-60, 60],
    clipPlanePct: [15, 100], sunHour: [9, 16], landPricePyeongM: [30, 350],
    constCostPyeongMan: [650, 1500], rentPyeongMan: [5, 30], capRatePct: [3.2, 6.5],
    loanLtvPct: [20, 85], loanRatePct: [2, 15], lpSharePct: [50, 95],
    lpHurdlePct: [4, 12], gpPromotePct: [10, 50], targetIrrPct: [8, 25],
    hotelAdrKrw: [0, 5000000], hotelOccupancyPct: [0, 100], hotelRoomsOverride: [0, 5000, true],
    hotelAncillaryRevenuePct: [0, 200], hotelOpexPct: [0, 100], hotelFixedOpexEok: [0, 1000],
    hotelFfeReservePct: [0, 30], hotelManagementFeePct: [0, 30], ...spatial?.numbers
  };
  const BOOLEANS = ["daylightTheme", "showSurroundingBuildings", "seoulDowntown", "northSolar", "parcelMerged", "showDimensions"];
  const FLOOR_USES = ["main", "retail", "residential", "amenity", "hotel"];
  const CHAPTERS = ["chap-site", "chap-mass", "chap-facade", "chap-finance"];
  const TABS = ["tab-area", "tab-finance", "tab-remodel", "tab-smap-law"];
  const DRAWERS = ["drawerFacadeSpec", "drawerTestFit", "drawerSourcesUses", "drawerResidualSensitivity"];
  const RETURNS = ["#home", "#projects", "#approach", "#studio", "#site", "#materials", "#feasibility"];
  let getState = null;
  let initialized = false;
  let importing = false;
  const PROJECT_DEFAULTS = Object.freeze({ ...spatial?.defaults, modelDetail: "auto", regulationMode: "statutory", financeMode: "rental", hotelAdrKrw: 180000,
    hotelOccupancyPct: 70, hotelRoomsOverride: 0, hotelAncillaryRevenuePct: 15,
    hotelOpexPct: 60, hotelFixedOpexEok: 0, hotelFfeReservePct: 4,
    hotelManagementFeePct: 3, hotelResidentialDistanceM: null, hotelResidentialBarrier: null });

  function numeric(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string" || !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }

  function sanitize(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || !ENUMS.parcelKey.includes(input.parcelKey)) return null;
    const clean = {};
    for (const [key, allowed] of Object.entries(ENUMS)) {
      if (allowed.includes(input[key])) clean[key] = input[key];
    }
    if (!Object.hasOwn(input, "regulationMode")) clean.regulationMode = "statutory";
    if (!Object.hasOwn(input, "modelDetail")) clean.modelDetail = "auto";
    for (const [key, [min, max, integer]] of Object.entries(NUMBERS)) {
      const value = numeric(input[key]);
      if (value !== null && value >= min && value <= max && (!integer || Number.isInteger(value))) clean[key] = value;
    }
    for (const key of BOOLEANS) if (typeof input[key] === "boolean") clean[key] = input[key];
    if (input.hotelResidentialDistanceM === null) clean.hotelResidentialDistanceM = null;
    else {
      const distance = numeric(input.hotelResidentialDistanceM);
      if (distance !== null && distance >= 0 && distance <= 10000) clean.hotelResidentialDistanceM = distance;
    }
    if (input.hotelResidentialBarrier === null || typeof input.hotelResidentialBarrier === "boolean") clean.hotelResidentialBarrier = input.hotelResidentialBarrier;
    if (Object.prototype.hasOwnProperty.call(input, "parcelData")) {
      if (input.parcelData === null) clean.parcelData = null;
      else if (typeof host.AtelierParcelGeometry?.sanitizeParcelData === "function") {
        try {
          const parcel = host.AtelierParcelGeometry.sanitizeParcelData(input.parcelData);
          if (parcel) clean.parcelData = parcel;
        } catch (_) { /* Unverified geometry cannot be restored from session data. */ }
      }
    }
    if (input.floorUseOverrides && typeof input.floorUseOverrides === "object" && !Array.isArray(input.floorUseOverrides)) {
      clean.floorUseOverrides = {};
      const maxFloor = clean.floorsAbove || 35;
      for (const [level, use] of Object.entries(input.floorUseOverrides)) {
        if (/^[1-9]\d?$/.test(level) && Number(level) <= maxFloor && FLOOR_USES.includes(use)) clean.floorUseOverrides[level] = use;
      }
    }
    if (spatial) {
      try { spatial.validate(input); Object.assign(clean, spatial.select(input)); }
      catch (_) { return null; }
    }
    return clean;
  }

  function readSaved() {
    try {
      const raw = host.sessionStorage.getItem(STORAGE_KEY);
      if (!raw || raw.length > MAX_STORAGE_LENGTH) return null;
      const saved = JSON.parse(raw);
      const age = Date.now() - saved.savedAt;
      if (saved.version !== VERSION || typeof saved.savedAt !== "number" || !Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) return null;
      const inputs = sanitize(saved.inputs);
      const perParcel = {};
      if (saved.perParcel && typeof saved.perParcel === "object" && !Array.isArray(saved.perParcel)) {
        for (const key of ENUMS.parcelKey) {
          if (!Object.prototype.hasOwnProperty.call(saved.perParcel, key)) continue;
          const study = sanitize(saved.perParcel[key]);
          if (study && study.parcelKey === key) perParcel[key] = study;
        }
      }
      // A legacy v1 record has only inputs. The latest study also wins if an
      // interrupted or older writer left its parcel's map entry out of date.
      if (inputs) perParcel[inputs.parcelKey] = inputs;
      const project = validProjectMeta(saved.project) ? { title: saved.project.title, createdAt: saved.project.createdAt } : null;
      return { inputs, perParcel, project };
    } catch (_) { return null; }
  }

  function restore() {
    return readSaved()?.inputs || null;
  }

  function restoreParcel(parcelKey) {
    if (!ENUMS.parcelKey.includes(parcelKey)) return null;
    return readSaved()?.perParcel[parcelKey] || null;
  }

  function save() {
    if (!initialized || importing || typeof getState !== "function") return false;
    try {
      const inputs = sanitize(getState());
      if (!inputs) return false;
      const previous = readSaved();
      const perParcel = previous?.perParcel || {};
      perParcel[inputs.parcelKey] = inputs;
      host.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, savedAt: Date.now(), inputs, perParcel, project: previous?.project || null }));
      return true;
    } catch (_) { return false; }
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  }

  function isDate(value) {
    if (typeof value !== "string") return false;
    try { return new Date(value).toISOString() === value; } catch (_) { return false; }
  }

  function validProjectMeta(value) {
    return isRecord(value) && typeof value.title === "string" && value.title.trim().length > 0 &&
      value.title.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value.title) && isDate(value.createdAt);
  }

  function projectError(message) { throw new Error(`프로젝트 파일: ${message}`); }

  function equivalent(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    return aKeys.length === bKeys.length && aKeys.every((key, i) => key === bKeys[i] && equivalent(a[key], b[key]));
  }

  function strictInputs(input, path) {
    if (!isRecord(input)) projectError(`${path}은 입력 객체여야 합니다.`);
    const allowed = new Set([...Object.keys(ENUMS), ...Object.keys(NUMBERS), ...BOOLEANS,
      "floorUseOverrides", "hotelResidentialDistanceM", "hotelResidentialBarrier", "parcelData", ...(spatial?.collections || [])]);
    for (const key of Object.keys(input)) if (!allowed.has(key)) projectError(`${path}.${key}은 지원하지 않는 항목입니다.`);
    const candidate = { ...PROJECT_DEFAULTS, ...input };
    if (!Object.prototype.hasOwnProperty.call(candidate, "parcelData")) candidate.parcelData = null;
    const clean = sanitize(candidate);
    if (!clean) projectError(`${path}.parcelKey가 올바르지 않습니다.`);
    for (const key of Object.keys(candidate)) {
      if (!Object.prototype.hasOwnProperty.call(clean, key)) projectError(`${path}.${key} 값이 올바르지 않습니다.`);
      if (Object.prototype.hasOwnProperty.call(NUMBERS, key) && typeof candidate[key] !== "number") projectError(`${path}.${key}은 유한한 숫자여야 합니다.`);
      if (key === "hotelResidentialDistanceM" && candidate[key] !== null && typeof candidate[key] !== "number") projectError(`${path}.${key}은 숫자 또는 null이어야 합니다.`);
    }
    // Silently dropping even one invalid floor override would change the study.
    if (Object.prototype.hasOwnProperty.call(candidate, "floorUseOverrides")) {
      if (!isRecord(candidate.floorUseOverrides)) projectError(`${path}.floorUseOverrides가 올바르지 않습니다.`);
      for (const [level, use] of Object.entries(candidate.floorUseOverrides)) {
        if (clean.floorUseOverrides?.[level] !== use) projectError(`${path}.floorUseOverrides.${level} 값이 올바르지 않습니다.`);
      }
    }
    if (candidate.parcelData !== null && !equivalent(clean.parcelData, candidate.parcelData)) {
      projectError(`${path}.parcelData가 검증된 필지 자료 형식과 일치하지 않습니다.`);
    }
    if (candidate.parcelData !== null) {
      let derived;
      try {
        if (typeof host.AtelierParcelGeometry?.derive !== "function") throw new Error("경계 계산 모듈이 준비되지 않았습니다.");
        derived = host.AtelierParcelGeometry.derive(clean.parcelData);
      } catch (error) { projectError(`${path}.parcelData: ${error.message || "경계를 적용할 수 없습니다."}`); }
      if (!Number.isFinite(derived?.areaSqm) || derived.areaSqm < 200 || derived.areaSqm > 20000) {
        projectError(`${path}.parcelData의 실제 경계 면적은 200~20,000㎡ 범위여야 합니다.`);
      }
    }
    return clean;
  }

  function validateProject(value) {
    if (!isRecord(value)) projectError("JSON 객체가 필요합니다.");
    const keys = ["format", "version", "title", "createdAt", "savedAt", "activeParcelKey", "inputs", "perParcel"];
    for (const key of Object.keys(value)) if (!keys.includes(key)) projectError(`${key}은 지원하지 않는 항목입니다.`);
    for (const key of keys) if (!Object.prototype.hasOwnProperty.call(value, key)) projectError(`${key}이 누락되었습니다.`);
    if (value.format !== PROJECT_FORMAT) projectError("FORMEQUA 프로젝트 형식이 아닙니다.");
    if (value.version !== PROJECT_VERSION) projectError(`지원하지 않는 버전입니다 (${String(value.version)}).`);
    if (!validProjectMeta(value) || !isDate(value.savedAt)) projectError("프로젝트 이름 또는 날짜 형식이 올바르지 않습니다.");
    if (Date.parse(value.savedAt) < Date.parse(value.createdAt)) projectError("저장 날짜가 생성 날짜보다 빠릅니다.");
    if (!ENUMS.parcelKey.includes(value.activeParcelKey)) projectError("활성 필지가 올바르지 않습니다.");
    const inputs = strictInputs(value.inputs, "inputs");
    if (inputs.parcelKey !== value.activeParcelKey) projectError("활성 필지와 현재 입력이 서로 다릅니다.");
    if (!isRecord(value.perParcel)) projectError("perParcel은 필지별 입력 객체여야 합니다.");
    const perParcel = {};
    for (const [key, study] of Object.entries(value.perParcel)) {
      if (!ENUMS.parcelKey.includes(key)) projectError(`perParcel.${key}은 지원하지 않는 필지입니다.`);
      perParcel[key] = strictInputs(study, `perParcel.${key}`);
      if (perParcel[key].parcelKey !== key) projectError(`perParcel.${key}의 필지 키가 일치하지 않습니다.`);
    }
    if (!Object.prototype.hasOwnProperty.call(perParcel, value.activeParcelKey)) projectError("활성 필지의 perParcel 입력이 누락되었습니다.");
    if (!equivalent(perParcel[value.activeParcelKey], inputs)) projectError("활성 필지의 두 입력 사본이 일치하지 않습니다.");
    return { format: PROJECT_FORMAT, version: PROJECT_VERSION, title: value.title, createdAt: value.createdAt,
      savedAt: value.savedAt, activeParcelKey: value.activeParcelKey, inputs, perParcel };
  }

  function parseProject(raw) {
    if (typeof raw !== "string" || raw.length > MAX_PROJECT_LENGTH || new TextEncoder().encode(raw).length > MAX_PROJECT_LENGTH) projectError("파일은 5 MiB 이하의 JSON이어야 합니다.");
    let value;
    try { value = JSON.parse(raw); } catch (_) { projectError("JSON을 읽을 수 없습니다. 파일을 확인해 주세요."); }
    return validateProject(value);
  }

  function exportProject(options = {}) {
    if (!initialized || typeof getState !== "function") projectError("작업실 초기화 후 저장할 수 있습니다.");
    const current = getState();
    // Export only the allowlist, never arbitrary live state or server secrets.
    const allowed = new Set([...Object.keys(ENUMS), ...Object.keys(NUMBERS), ...BOOLEANS,
      "floorUseOverrides", "hotelResidentialDistanceM", "hotelResidentialBarrier", "parcelData", ...(spatial?.collections || [])]);
    const exportable = Object.fromEntries(Object.entries(current).filter(([key]) => allowed.has(key)));
    const inputs = strictInputs(exportable, "inputs");
    const saved = readSaved();
    const perParcel = {};
    for (const [key, study] of Object.entries(saved?.perParcel || {})) perParcel[key] = strictInputs(study, `perParcel.${key}`);
    perParcel[inputs.parcelKey] = inputs;
    const now = new Date().toISOString();
    if (options.title !== undefined && typeof options.title !== "string") projectError("프로젝트 이름을 입력해 주세요.");
    const title = options.title === undefined ? saved?.project?.title || "FORMEQUA 설계 연구" : options.title.trim();
    const value = { format: PROJECT_FORMAT, version: PROJECT_VERSION, title,
      createdAt: saved?.project?.createdAt || now, savedAt: now, activeParcelKey: inputs.parcelKey, inputs, perParcel };
    const checked = validateProject(value);
    if (JSON.stringify(checked).length > MAX_PROJECT_LENGTH) projectError("저장할 자료가 5 MiB 제한을 초과합니다.");
    try {
      host.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, savedAt: Date.now(), inputs, perParcel,
        project: { title: checked.title, createdAt: checked.createdAt } }));
    } catch (_) { /* File download works even if session storage is full. */ }
    return checked;
  }

  function importProject(value, apply) {
    const checked = typeof value === "string" ? parseProject(value) : validateProject(value);
    if (!initialized || typeof apply !== "function") projectError("복원할 작업실이 준비되지 않았습니다.");
    const previousInputs = typeof getState === "function" ? sanitize(getState()) : null;
    importing = true;
    try {
      apply(JSON.parse(JSON.stringify(checked.inputs)), checked);
    } catch (error) {
      if (previousInputs) { try { apply(previousInputs, { rollback: true }); } catch (_) {} }
      throw error;
    } finally { importing = false; }
    try {
      host.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, savedAt: Date.now(),
        inputs: checked.inputs, perParcel: checked.perParcel, project: { title: checked.title, createdAt: checked.createdAt } }));
    } catch (_) { projectError("계산은 복원했으나 이 탭의 저장 공간이 부족합니다. 파일을 보관해 주세요."); }
    return checked;
  }

  function cleanContext(context) {
    const value = context || {};
    const clean = {};
    if (CHAPTERS.includes(value.chapter)) clean.chapter = value.chapter;
    if (TABS.includes(value.tab)) clean.tab = value.tab;
    if (DRAWERS.includes(value.drawer)) clean.drawer = value.drawer;
    if (RETURNS.includes(value.returnTo)) clean.returnTo = value.returnTo;
    return clean;
  }

  function getContext() {
    try {
      const search = new URL(host.location.href).searchParams;
      return cleanContext({ chapter: search.get("chapter"), tab: search.get("tab"), drawer: search.get("drawer"), returnTo: search.get("returnTo") });
    } catch (_) { return {}; }
  }

  function buildUrl(path, context) {
    try {
      const url = new URL(path, host.location.href);
      if (url.origin !== host.location.origin || !/^https?:$/.test(url.protocol)) return "";
      for (const key of ["chapter", "tab", "drawer", "returnTo"]) url.searchParams.delete(key);
      for (const [key, value] of Object.entries(cleanContext(context))) url.searchParams.set(key, value);
      return `${url.pathname}${url.search}${url.hash}`;
    } catch (_) { return ""; }
  }

  const api = Object.freeze({
    attach(reader) { getState = typeof reader === "function" ? reader : null; initialized = false; },
    ready() { initialized = true; return save(); },
    save, restore, restoreParcel, buildUrl, getContext,
    // Shared validation is exposed for loading a preset without admitting arbitrary state.
    sanitize, exportProject, importProject, validateProject, parseProject,
    getProjectMeta() { return readSaved()?.project || null; },
    projectFormat: PROJECT_FORMAT, projectVersion: PROJECT_VERSION, maxProjectBytes: MAX_PROJECT_LENGTH,
    storageKey: STORAGE_KEY
  });
  if (host.addEventListener) {
    host.addEventListener("atelier:updated", save);
    host.addEventListener("pagehide", save);
    // Capture before a navigation handler so clipping/dimensions and last edits
    // are recorded even when their scene-only changes did not recalculate KPIs.
    host.document?.addEventListener("click", event => {
      const link = event.target?.closest?.("[data-workspace-link],[data-workspace-return]");
      if (!link) return;
      save();
      if (link.tagName !== "A") return;
      const current = link.getAttribute("href");
      if (!current) return;
      const context = {
        chapter: link.dataset.workspaceChapter,
        tab: link.dataset.workspaceTab,
        drawer: link.dataset.workspaceDrawer,
        returnTo: link.dataset.workspaceReturnTo
      };
      if (Object.values(context).some(Boolean)) {
        const href = buildUrl(current, context);
        if (href) link.setAttribute("href", href);
      }
    }, true);
  }
  return api;
});
