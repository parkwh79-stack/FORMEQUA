"use strict";

// The API evaluates the same app.js functions and program change handler used by
// the browser. It never starts DOMContentLoaded/WebGL or evaluates request text.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const legal = require("./legal-rules.js");
const permissions = require("./use-permissions.js");
const { generate } = require("./interior-plan.js");
const finance = require("./finance-model.js");
const parkingLayout = require("./parking-layout.js");
const coreLayout = require("./core-layout.js");
const buildingReview = require("./building-review.js");
const conceptStructure = require("./concept-structure.js");
const parcelGeometry = require("./parcel-geometry.js");
const parcelRegulations = require("./parcel-regulation-rules.js");
const spatial = require('./spatial-settings.js');
const API_VERSION = "1.0";
const PROGRAMS = ["office", "officetel", "hotel", "housing", "living", "knowledge", "retail", "sales"];
const PARCELS = ["gangnam_yeoksam", "seongdong_seongsu", "mapo_hapjeong", "jongno_euljiro", "custom_seoul"];
const ENUMS = {
  parcelKey: PARCELS,
  option: ["A", "B", "C"], viewMode: ["standard", "envelope", "xray", "exploded"],
  zoning: ["일반상업지역", "중심상업지역", "근린상업지역", "준공업지역", "준주거지역", "제3종일반주거지역", "제2종일반주거지역"],
  buildingUse: ["업무시설(오피스)", "업무시설(오피스텔)", "숙박시설(호텔)", "지식산업센터", "공동주택(주상복합)", "근린생활시설(리테일)", "판매시설"],
  hotelType: ["unconfirmed", "general", "tourist"], spaceProgram: ["standard", "coliving"],
  financeMode: ["rental", "hotel"],
  residentialType: ["apartment", "officetel"], housingPermitType: ["building_permit", "housing_approval"],
  parkingDistrict: ["unconfirmed", "standard", "restricted"], parkingMode: ["fit", "report"],
  regulationMode: ["statutory", "scenario"],
  modelDetail: ["auto", "massing", "concept"],
  coreType: ["center", "north", "split"], mixedUseProfile: ["office_retail", "mixed_resi", "knowledge_ind", "flagship_hq"],
  facadeType: ["curtain_wall", "kinetic_louver", "brick_rainscreen", "stone_ribbon", "diagrid_biophilic"],
  claddingMaterial: ["anodized_metal", "terracotta_brick", "limestone", "granite_pocheon", "uhpc_concrete", "champagne_bronze"],
  facadeAccent: ["auto", "titanium", "warm_limestone", "champagne", "terracotta", "crimson_brick", "sage_patina", "sapphire", "basalt_charcoal"],
  glassTint: ["auto", "sapphire_blue", "crystal_clear", "emerald_green", "bronze_gold", "smoke_grey"],
  podiumStyle: ["showwindow", "brick_arcade", "piloti_colonade"], ...spatial.enums
};
const NUMBERS = {
  siteAreaSqm: [200, 20000], roadWidthM: [4, 50], publicContribPct: [0, 25],
  legalFarCapPct: [0, 1500], legalBcrCapPct: [0, 100], maxHeightM: [0, 300],
  housingUnitAreaSqm: [15, 250], housingUnits: [0, 3000, true],
  hotelAdrKrw: [0, 5000000], hotelOccupancyPct: [0, 100], hotelRoomsOverride: [0, 5000, true],
  hotelAncillaryRevenuePct: [0, 200], hotelOpexPct: [0, 100], hotelFixedOpexEok: [0, 1000],
  hotelFfeReservePct: [0, 30], hotelManagementFeePct: [0, 30],
  setbackM: [1, 6], setbackSideM: [0.5, 5], setbackRearM: [1, 6],
  floorsAbove: [1, 35, true], floorsBelow: [0, 7, true], targetBcr: [25, 60], floorHeight: [3, 5.2],
  facadeWwrPct: [30, 85], facadeBayM: [1.5, 4.5], facadeLouverM: [0.05, 1.1],
  facadePanelDepthMm: [10, 100], facadeJointMm: [3, 25], facadeLouverAngleDeg: [-60, 60],
  clipPlanePct: [15, 100], sunHour: [9, 16], landPricePyeongM: [30, 350],
  constCostPyeongMan: [650, 1500], rentPyeongMan: [5, 30], capRatePct: [3.2, 6.5],
  loanLtvPct: [20, 85], loanRatePct: [2, 15], lpSharePct: [50, 95],
  lpHurdlePct: [4, 12], gpPromotePct: [10, 50], targetIrrPct: [8, 25], ...spatial.numbers
};
const BOOLEANS = ["daylightTheme", "showSurroundingBuildings", "seoulDowntown", "northSolar", "parcelMerged", "showDimensions"];
const NULLABLE_NUMBERS = { hotelResidentialDistanceM: [0, 10000] };
const NULLABLE_BOOLEANS = ["hotelResidentialBarrier"];
const FLOOR_USES = ["main", "retail", "residential", "amenity", "hotel"];
const INPUT_KEYS = [...Object.keys(ENUMS), ...Object.keys(NUMBERS), ...BOOLEANS,
  ...Object.keys(NULLABLE_NUMBERS), ...NULLABLE_BOOLEANS, "floorUseOverrides", "parcelData", ...spatial.collections];

class ValidationError extends Error {
  constructor(message) { super(message); this.name = "ValidationError"; this.code = "INVALID_REQUEST"; }
}
function invalid(message) { throw new ValidationError(message); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function validateRequest(request) {
  if (!isObject(request)) invalid("Request must be a JSON object.");
  for (const key of Object.keys(request)) if (!["program", "parcelKey", "inputs", "floorLevel"].includes(key)) invalid("Unknown request key: " + key);
  if (!PROGRAMS.includes(request.program)) invalid("program must be one of: " + PROGRAMS.join(", "));
  const parcelKey = request.parcelKey === undefined ? "gangnam_yeoksam" : request.parcelKey;
  if (!PARCELS.includes(parcelKey)) invalid("Unknown parcelKey.");
  const inputs = request.inputs === undefined ? {} : request.inputs;
  if (!isObject(inputs)) invalid("inputs must be a JSON object.");
  for (const [key, value] of Object.entries(inputs)) {
    if (!INPUT_KEYS.includes(key)) invalid("Unknown input: " + key);
    if (Object.hasOwn(ENUMS, key) && !ENUMS[key].includes(value)) invalid("Invalid enum for inputs." + key);
    if (Object.hasOwn(NUMBERS, key)) {
      const [minimum, maximum, integer] = NUMBERS[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) invalid(`inputs.${key} must be ${integer ? "an integer" : "a finite number"} between ${minimum} and ${maximum}.`);
    }
    if (BOOLEANS.includes(key) && typeof value !== "boolean") invalid("inputs." + key + " must be boolean.");
    if (Object.hasOwn(NULLABLE_NUMBERS, key) && value !== null) {
      const [minimum, maximum] = NULLABLE_NUMBERS[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) invalid(`inputs.${key} must be null or a finite number between ${minimum} and ${maximum}.`);
    }
    if (NULLABLE_BOOLEANS.includes(key) && value !== null && typeof value !== "boolean") invalid("inputs." + key + " must be null or boolean.");
  }
  if (inputs.parcelKey !== undefined && inputs.parcelKey !== parcelKey) invalid("inputs.parcelKey must match parcelKey.");
  if (inputs.floorUseOverrides !== undefined) {
    if (!isObject(inputs.floorUseOverrides)) invalid("floorUseOverrides must be an object.");
    for (const [level, use] of Object.entries(inputs.floorUseOverrides)) {
      if (!/^(?:[1-9]|[12][0-9]|3[0-5])$/.test(level) || !FLOOR_USES.includes(use)) invalid("Invalid floorUseOverrides entry: " + level);
      if (inputs.floorsAbove !== undefined && Number(level) > inputs.floorsAbove) invalid("floorUseOverrides exceeds floorsAbove.");
    }
  }
  if (request.floorLevel !== undefined && (!Number.isInteger(request.floorLevel) || request.floorLevel < 1 || request.floorLevel > 35)) invalid("floorLevel must be an integer from 1 to 35.");
  const normalized = { ...inputs };
  try { spatial.validate(inputs); } catch(error) { invalid(error.message); }
  if (Object.hasOwn(inputs, "parcelData")) {
    try {
      normalized.parcelData = parcelGeometry.sanitizeParcelData(inputs.parcelData);
      if (normalized.parcelData) {
        const geometry = parcelGeometry.derive(normalized.parcelData);
        if (geometry.areaSqm < 200 || geometry.areaSqm > 20000) throw new Error("지원하는 경계 면적은 200~20,000㎡입니다.");
      }
    }
    catch (error) { invalid("Invalid inputs.parcelData: " + error.message); }
  }
  return { program: request.program, parcelKey, inputs: normalized, floorLevel: request.floorLevel };
}

function createCalculationContext() {
  const elements = new Map(), events = {};
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: "", dataset: {}, style: {}, listeners: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(name, listener) { this.listeners[name] = listener; }
    });
    return elements.get(id);
  };
  const context = vm.createContext({ window: {
    AtelierLegal: legal, AtelierUsePermissions: permissions,
    AtelierFinance: finance, AtelierInteriorPlan: { generate }, AtelierCoreLayout: coreLayout, AtelierSpatialSettings: spatial,
    AtelierBuildingReview: buildingReview, AtelierConceptStructure: conceptStructure,
    AtelierParkingLayout: parkingLayout, AtelierParcelGeometry: parcelGeometry, AtelierParcelRegulations: parcelRegulations,
    addEventListener(name, listener) { (events[name] ||= []).push(listener); }
  }, document: { getElementById: element, querySelectorAll: () => [] } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "app.js"), "utf8"), context, { filename: "app.js", timeout: 3000 });
  // Disable presentation only. loadParcelPreset, the program handler, and all
  // architectural/financial calculations below remain the original functions.
  vm.runInContext("syncWorkspaceInputsToUI = () => {}; updateAllCalculationsAndUI = () => {}; syncFacadeUI = () => {};", context, { timeout: 1000 });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "use-study.js"), "utf8"), context, { filename: "use-study.js", timeout: 1000 });
  events.DOMContentLoaded.at(-1)();
  return { context, element };
}
function read(context, expression) {
  return JSON.parse(vm.runInContext("JSON.stringify(" + expression + ")", context, { timeout: 5000 }));
}
function analyze(rawRequest) {
  const request = validateRequest(rawRequest);
  const { context, element } = createCalculationContext();
  context.apiParcel = request.parcelKey;
  vm.runInContext("loadParcelPreset(apiParcel)", context, { timeout: 1000 });
  const select = element("selectStudyProgram"); select.value = request.program;
  select.listeners.change({ target: select });
  const routed = read(context, "state");
  const inputs = request.inputs;
  if (inputs.buildingUse !== undefined && inputs.buildingUse !== routed.buildingUse) {
    if (request.program !== "living" || !["공동주택(주상복합)", "업무시설(오피스텔)"].includes(inputs.buildingUse)) invalid("inputs.buildingUse conflicts with program.");
  }
  if (inputs.spaceProgram !== undefined && inputs.spaceProgram !== routed.spaceProgram) invalid("inputs.spaceProgram conflicts with program.");
  // The browser exposes this separately for residential floor overrides in an
  // office/hotel study. Preserve that legal mixed-use classification verbatim.
  const residentialType = inputs.residentialType || (request.program === "housing" || (request.program === "living" && inputs.buildingUse === "공동주택(주상복합)") ? "apartment" : "officetel");
  // An actual boundary must not inherit a sample parcel's contribution or
  // downtown flag. Explicit request values remain identifiable study inputs.
  context.apiInputs = { ...(inputs.parcelData ? { publicContribPct: 0, seoulDowntown: false } : {}), ...inputs, residentialType };
  vm.runInContext("Object.assign(state, apiInputs)", context, { timeout: 1000 });
  vm.runInContext("{ const review = reviewParcelRegulations(state); if (review?.applied) state.zoning = review.inputs.zoning; }", context, { timeout: 1000 });
  const params = read(context, "state");
  if (Object.keys(params.floorUseOverrides).some(level => Number(level) > params.floorsAbove)) invalid("floorUseOverrides exceeds floorsAbove.");
  const model = read(context, "evaluateDesignAndProforma(state, state.option)");
  let floor = null;
  if (request.floorLevel !== undefined) {
    floor = model.floorPlates.find(fp => fp.level === request.floorLevel);
    if (!floor) invalid("floorLevel is not present in the constrained mass. Select a level from model.floorPlates.");
  } else {
    const primary = ["hotel", "residential", "main"];
    floor = model.floorPlates.find(fp => primary.includes(fp.use)) || model.floorPlates[0] || null;
  }
  const plan = floor ? generate(floor, { ...params, detailLevel: model.representation?.detailLevel }) : null;
  const limitations = [
    "예시 필지 또는 사용자가 제공한 필지 경계·용도지역은 입력 자료입니다. 공적 지적·토지이용계획 자료의 진위·효력·계획 규제를 자동 확인하지 않습니다.",
    "법령은 " + legal.checkedAt + " 검토 스냅샷입니다. 개별 고시·지구단위계획·인허가를 자동 확인하지 않습니다.",
    "평면과 주차 구획·램프·통로는 개념 배치입니다. 구조·설비·피난·접근성·진입로·차량 회전 궤적 및 개별 법정 조건은 설계 검토가 필요합니다.",
    "재무 수치는 임대·공사비·대출·매각 가정에 따른 계산이며 시장 실거래 또는 확정 금융조건이 아닙니다.",
    "프로젝트 JSON 파일 저장·불러오기는 브라우저의 로컬 기능입니다. 이 분석 API는 사용자 계정·서버 영구 저장·공개 API 인증을 포함하지 않습니다."
  ];
  if (model.floorPlates.some(fp => fp.use === "hotel")) limitations.push(model.finance.financeMode === "hotel"
    ? "호텔 운영은 ADR·가동률·부대매출·운영비·위탁 수수료·FF&E·고정비의 사용자 가정입니다. 객실 수는 자동 배치 또는 명시적 운영 가정이며 법정 정원이 아닙니다."
    : "현재 호텔 층은 임대 시나리오입니다. financeMode를 hotel로 선택하면 ADR·가동률·운영비 기반 호텔 운영 수입으로 계산합니다.");
  if (request.program === "living") limitations.push("리빙은 공간 콘셉트이며 선택한 공동주택 또는 오피스텔의 법적 용도로 검토합니다.");
  return JSON.parse(JSON.stringify({ apiVersion: API_VERSION, program: request.program,
    inputs: Object.fromEntries(INPUT_KEYS.filter(key => params[key] !== undefined).map(key => [key, params[key]])),
    model, plan, limitations, generatedAt: new Date().toISOString(),
    evidence: { checkedAt: legal.checkedAt, densityCheckedAt: legal.densityCheckedAt, legalSources: legal.sources, useSources: permissions.sources,
      boundaryApplied: Boolean(model.parcelGeometry), parcelRegulationApplied: Boolean(model.parcelRegulationReview?.applied), parcelLawCheckedAt: parcelRegulations.checkedAt,
      liveParcelVerified: false, isPermitConfirmation: false },
    units: { area: "m²", length: "m", financeEok: "KRW 100,000,000", hotelAdrKrw: "KRW / room / night, excluding VAT", landPricePyeongM: "KRW 1,000,000 / pyeong", costRentMan: "KRW 10,000 / pyeong", monthlyCashflow: "KRW 100,000,000", percentage: "percent" }
  }));
}
function capabilities() {
  return { apiVersion: API_VERSION, engine: "shared-browser-app", programs: PROGRAMS, parcels: PARCELS,
    endpoints: { analysis: "/api/v1/analysis", openapi: "/api/v1/openapi.json", parcelStatus: "/api/v1/parcels/status", addressSearch: "/api/v1/parcels/search?q={address}", parcelBoundary: "/api/v1/parcels/{pnu}", parcelRegulations: "/api/v1/parcels/{pnu}/regulations" },
    allowedInputs: INPUT_KEYS,
    legalCheckedAt: legal.checkedAt, inputs: { enums: ENUMS, numbers: NUMBERS, booleans: BOOLEANS,
      nullableNumbers: NULLABLE_NUMBERS, nullableBooleans: NULLABLE_BOOLEANS, floorUses: FLOOR_USES,
      spatialPlanning: {defaults:spatial.defaults,collections:spatial.collections,engines:{office:'original-js-heuristic',hotel:'typed-fitted-room-modules',navigation:'lazy-client-grid-review',bim:'versioned-json-handoff-no-native-execution'}},
      parcelData: { nullable: true, version: 1, crs: "EPSG:4326", geometryTypes: ["Polygon", "MultiPolygon"],
        maxFeatures: 5, maxCoordinates: 2000, source: ["vworld", "import"], contiguousMergeRequired: true } },
    maxRequestBytes: 65536, authentication: "local-only; not configured for public access",
    limitations: ["reviewed legal snapshot", "unverified imported or scenario parcel data", "concept interior and parking layouts", "rental or assumption-based hotel operations", "local project files; no server account storage"] };
}
function openapi() {
  const properties = {};
  for (const [key, values] of Object.entries(ENUMS)) properties[key] = { type: "string", enum: values };
  for (const [key, [minimum, maximum, integer]] of Object.entries(NUMBERS)) properties[key] = { type: integer ? "integer" : "number", minimum, maximum };
  for (const key of BOOLEANS) properties[key] = { type: "boolean" };
  for (const [key, [minimum, maximum]] of Object.entries(NULLABLE_NUMBERS)) properties[key] = { type: ["number", "null"], minimum, maximum, description: "null means unconfirmed; never coerced to zero." };
  for (const key of NULLABLE_BOOLEANS) properties[key] = { type: ["boolean", "null"], description: "null means unconfirmed; true is a user assumption, not an approval." };
  properties.parcelData = { $ref: "#/components/schemas/ParcelData" };
  properties.layoutObstacles={type:'array',maxItems:64,description:'User planning obstacles in local model metres; not verified structural columns.',items:{type:'object',additionalProperties:false,required:['id','level','kind','minX','maxX','minZ','maxZ'],properties:{id:{type:'string',pattern:'^[a-zA-Z0-9_.:-]{1,80}$'},level:{type:'integer',minimum:1,maximum:35},kind:{enum:['column','fixed']},...Object.fromEntries(['minX','maxX','minZ','maxZ'].map(k=>[k,{type:'number',minimum:-500,maximum:500}]))}}};
  const roomSettings={deskType:properties.officeDeskType,orientation:properties.officeOrientation,...Object.fromEntries(['deskWidthM','deskDepthM','aisleWidthM','rowGapM','backClearanceM','collaborationPct','targetSeats'].map(k=>[k,properties['office'+k[0].toUpperCase()+k.slice(1)]]))};
  properties.officeRoomRequirements={type:'object',maxProperties:128,propertyNames:{pattern:'^[a-zA-Z0-9_.:-]{1,80}$'},additionalProperties:{type:'object',additionalProperties:false,properties:roomSettings}};
  properties.regulationMode.default = "statutory";
  properties.modelDetail.default = "auto";
  properties.modelDetail.description = "auto는 소규모 기획 분류에서 간략 매스, 나머지는 개념 상세를 표시합니다. massing은 상세 실내 표시를 생략하며 면적·법규·주차·재무 계산은 유지합니다. 법정 BIM/구조 검토 면제 판정이 아닙니다.";
  properties.regulationMode.description = "법정 기준이 기본입니다. scenario를 명시한 경우만 사용자 추가 용적률·건폐율·높이 제한을 적용합니다. 확인된 고시 제한은 두 모드 모두 적용합니다.";
  properties.floorUseOverrides = { type: "object", propertyNames: { pattern: "^(?:[1-9]|[12][0-9]|3[0-5])$" }, additionalProperties: { type: "string", enum: FLOOR_USES } };
  const position = { type: "array", minItems: 2, maxItems: 2, prefixItems: [{ type: "number", minimum: 124, maximum: 132 }, { type: "number", minimum: 33, maximum: 39 }] };
  const ring = { type: "array", minItems: 4, maxItems: 2000, items: position };
  const polygon = { type: "array", minItems: 1, items: ring };
  const parcelFeatureSchema = {
    type: "object", required: ["type", "geometry", "properties"],
    properties: {
      type: { const: "Feature" },
      geometry: { oneOf: [
        { type: "object", required: ["type", "coordinates"], properties: { type: { const: "Polygon" }, coordinates: polygon } },
        { type: "object", required: ["type", "coordinates"], properties: { type: { const: "MultiPolygon" }, coordinates: { type: "array", minItems: 1, items: polygon } } }
      ] },
      properties: { type: "object", properties: { pnu: { type: "string", pattern: "^[0-9]{19}$" }, address: { type: "string" }, source: { type: "string" }, regulations: { type: ["object","null"], description: "필지별 공식 공간자료 조회. 용도지역·지구단위계획·coveragePct·출처·확인일·nullable 세부 상한. 공통 모듈로 엄격 검증합니다." } } }
    }
  };
  const parcelSchema = {
    type: ["object", "null"], required: ["version", "features", "source"],
    description: "사용자가 제공한 EPSG:4326 필지. 전체 좌표 2,000개 이하, 최대 5개 필지이며 연결되지 않은 병합·교차·유효하지 않은 경계는 거부합니다. 공적 자료 확인 또는 합필 승인이 아닙니다.",
    properties: { version: { const: 1 }, source: { type: "string", enum: ["vworld", "import"] }, fetchedAt: { type: "string", format: "date-time" },
      features: { type: "array", minItems: 1, maxItems: 5, items: parcelFeatureSchema } }
  };
  return { openapi: "3.1.0", info: { title: "FORMEQUA Study API", version: API_VERSION,
    description: "FORMEQUA 상세 검토용 공통 계산 API. app.js·법규·필지 경계·주차 배치·실내 생성·임대 및 호텔 운영 모듈과 동일한 계산을 실행합니다. 검토 스냅샷 기반 개념 검토이며 인허가 판정이 아닙니다." },
    servers: [{ url: "/" }], paths: {
      "/api/v1/parcels/status": { get: { summary: "주소·경계 제공자 설정 여부 (실제 승인 검증 아님)", responses: { "200": { description: "설정 여부와 미확인 규제 상태" } } } },
      "/api/v1/parcels/search": { get: { summary: "주소에서 지번·PNU 후보 검색", parameters: [{in:"query",name:"q",required:true,schema:{type:"string",minLength:2,maxLength:200}}], responses: { "200": { description: "최대 10개 후보. 한 필지로 자동 확정하지 않음" }, "503": {description:"주소 제공자 설정 필요"} } } },
      "/api/v1/parcels/{pnu}": { get: { summary: "PNU로 VWorld 연속지적도 경계 조회", parameters: [{in:"path",name:"pnu",required:true,schema:{type:"string",pattern:"^[0-9]{19}$"}}], responses: { "200": { description: "EPSG:4326 경계. 용도지역·인허가 확인 아님", content:{"application/json":{schema:{$ref:"#/components/schemas/ParcelData"}}} }, "503": {description:"VWorld 설정 필요"} } } },
      "/api/v1/parcels/{pnu}/regulations": { get: { summary: "실제 필지 교차 용도지역·지구단위계획 조회", parameters:[{in:"path",name:"pnu",required:true,schema:{type:"string",pattern:"^[0-9]{19}$"}}],responses:{"200":{description:"공간자료·교차 점유율·공식 출처. 계획별 세부 상한은 고시 확인 전 null"},"503":{description:"제공자 또는 공간 계산 실행 환경 설정 필요"}} } },
      "/api/v1/analysis": { post: { operationId: "analyzeStudy", summary: "용도별 매스·법규·주차·금융·선택층 평면 계산",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/AnalysisRequest" },
          example: { program: "hotel", parcelKey: "gangnam_yeoksam", inputs: { hotelType: "tourist", floorsAbove: 6, parkingMode: "report" }, floorLevel: 3 } } } },
        responses: { "200": { description: "공통 계산 결과. 금지된 용도도 명시적 가정 비교 모델로 반환됩니다.", content: { "application/json": { schema: { $ref: "#/components/schemas/AnalysisResponse" } } } },
          "400": { $ref: "#/components/responses/BadRequest" }, "413": { description: "본문 65,536 byte 초과" }, "415": { description: "application/json 필요" }, "503": { description: "Node 계산 실행 파일 사용 불가" }, "504": { description: "계산 시간 초과" } } } },
      "/api/v1/capabilities": { get: { operationId: "getCapabilities", summary: "지원 용도·필지·입력 범위·검토 버전", responses: { "200": { description: "지원 기능과 입력 메타데이터" } } } },
      "/api/v1/openapi.json": { get: { operationId: "getOpenApi", summary: "OpenAPI 문서", responses: { "200": { description: "OpenAPI 3.1 JSON" } } } }
    }, components: { responses: { BadRequest: { description: "잘못된 JSON·키·형·범위·용도 또는 실제 매스에 없는 층", content: { "application/json": { schema: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } } } } } } } },
      schemas: { ParcelData: parcelSchema, AnalysisRequest: { type: "object", required: ["program"], additionalProperties: false,
        properties: { program: { type: "string", enum: PROGRAMS }, parcelKey: { type: "string", enum: PARCELS, default: "gangnam_yeoksam" },
          inputs: { type: "object", additionalProperties: false, properties }, floorLevel: { type: "integer", minimum: 1, maximum: 35 } } },
        AnalysisResponse: { type: "object", required: ["apiVersion", "program", "inputs", "model", "plan", "limitations", "generatedAt", "evidence", "units"],
          properties: { apiVersion: { const: API_VERSION }, program: { type: "string", enum: PROGRAMS }, inputs: { type: "object", properties },
            model: { type: "object", description: "evaluateDesignAndProforma 전체 결과. floorPlates, zoningRule, usePermission, constraints, areas, parking, egress, facade, finance 포함", additionalProperties: true },
            plan: { type: ["object", "null"], description: "선택층 generate 결과: bounds, cores, corridors, rooms, walls, doors, furniture, metrics, warnings" },
            limitations: { type: "array", items: { type: "string" } }, generatedAt: { type: "string", format: "date-time" },
            evidence: { type: "object" }, units: { type: "object" } } }
      } }
  };
}
module.exports = { analyze, validateRequest, capabilities, openapi, ValidationError };
if (require.main === module) {
  try {
    const result = process.argv[2] === "--capabilities" ? capabilities()
      : process.argv[2] === "--openapi" ? openapi() : analyze(JSON.parse(fs.readFileSync(0, "utf8")));
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: { code: error instanceof SyntaxError || error instanceof ValidationError ? "INVALID_REQUEST" : "ENGINE_ERROR", message: error instanceof ValidationError || error instanceof SyntaxError ? error.message : "Analysis engine could not complete the calculation." } }));
    process.exitCode = error instanceof SyntaxError || error instanceof ValidationError ? 2 : 1;
  }
}
