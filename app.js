/**
 * SEOUL 3D MASSING & PROFORMA STUDIO v2.0 (app.js)
 * Combines:
 * 1. Skills-Architects Korean Skills (8 Korean Area Definitions, Seoul Zoning & Parking Ordinance, North Solar Setback H/2, Egress)
 * 2. ibuilder/massing Generative 3D & Financial Engine (Polygon Setbacks, Test-Fit Core Layout, Logistic S-Curve Monthly Cashflows,
 *    Fixed-Point Construction Loan Interest Reserve Solver, XIRR/NPV/Peak Equity, Bisection Residual Land Value Solver, IFC 4.0 Export)
 * 3. High-Detail Architectural 3D Studio (Concrete Slab Bands, Curtain Wall Mullions, Rooftop Penthouse & PV, Street Trees, Road Markings,
 *    Daylight Architectural Model Mode vs Night Digital Twin Mode, Exploded Floor View)
 */

const PYEONG_TO_SQM = 3.305785;

// Shared visual palette for the editorial architecture model. Calculation data
// remains independent of these limestone, bronze and muted olive tones.
const ATELIER_PALETTE = Object.freeze({
  paper: 0xf5f3ee,
  ground: 0xe5e0d6,
  night: 0x252723,
  nightGround: 0x30322d,
  skyLight: 0xfffbf3,
  bounceLight: 0xa8a08f,
  sunlight: 0xfff5e6,
  gridMajor: 0xbdb5a7,
  gridMinor: 0xd1cabe,
  site: 0xd8cfc0,
  nightSite: 0x494a40,
  bronze: 0x9a805d,
  olive: 0x7b8269,
  nightOlive: 0x5f6958,
  road: 0xa8a59a,
  nightRoad: 0x383b35,
  roadMark: 0xd4c7a8,
  oak: 0x75624c,
  context: 0xe9e5dc,
  nightContext: 0x41443c,
  contextEdge: 0xc6beb1,
  nightContextEdge: 0x55594d,
  foundation: 0x9b9a8b,
  limestone: 0xe3dcd0,
  nightLimestone: 0xc0b8a7,
  interior: 0xe8dfcd,
  warmGlow: 0xd0b38b,
  glass: 0x9aa49e,
  nightGlass: 0xb7aa8d,
  core: 0x9d8c78,
  column: 0xa59e90,
  nightColumn: 0x8e9485,
  solarPanel: 0x4d5956
});

// ============================================================================
// 1. SEOUL PARCEL PRESETS & ZONING TABLE (서울특별시 도시계획 조례 제44조·제48조·제50조·제51조)
//    Dynamically synchronized with Ministry of Government Legislation (law.go.kr, OC=wanhee)
// ============================================================================
const SEOUL_ZONING_RULES = {
  "일반상업지역": { maxBcr: 60, maxFar: 800, maxFarDowntown: 600, nationalFar: 1300, northSolarDefault: false, ordinanceArticle: "제44조(건폐율)·제48조(용적률)" },
  "중심상업지역": { maxBcr: 60, maxFar: 1000, maxFarDowntown: 800, nationalFar: 1500, northSolarDefault: false, ordinanceArticle: "제44조(건폐율)·제48조(용적률)" },
  "근린상업지역": { maxBcr: 60, maxFar: 600, maxFarDowntown: 500, nationalFar: 900, northSolarDefault: false, ordinanceArticle: "제44조(건폐율)·제48조(용적률)" },
  "준공업지역":   { maxBcr: 60, maxFar: 400, maxFarDowntown: 400, nationalFar: 400, northSolarDefault: false, ordinanceArticle: "제44조·제48조·제50조(준공업)" },
  "준주거지역":   { maxBcr: 60, maxFar: 400, maxFarDowntown: 400, nationalFar: 500, northSolarDefault: false, ordinanceArticle: "제44조(건폐율)·제48조(용적률)" },
  "제3종일반주거지역": { maxBcr: 50, maxFar: 250, maxFarDowntown: 250, nationalFar: 300, northSolarDefault: true, ordinanceArticle: "제44조(건폐율)·제48조(용적률)" },
  "제2종일반주거지역": { maxBcr: 60, maxFar: 200, maxFarDowntown: 200, nationalFar: 250, northSolarDefault: true, ordinanceArticle: "제44조(건폐율)·제48조(용적률)" }
};

const FACADE_ARCHETYPES = {
  curtain_wall: {
    key: "curtain_wall",
    nameKr: "하이엔드 유니타이즈드 커튼월",
    shortKr: "유니타이즈드 커튼월",
    bestForKr: "강남·여의도 프라임 오피스 및 대기업 사옥",
    defaultWwrPct: 72,
    defaultBayM: 2.4,
    defaultLouverM: 0.15,
    wallU: 0.155,
    windowU: 0.84,
    psiSurcharge: 0.035,
    baseShgc: 0.24,
    vltPct: 58,
    fireGrade: "준불연/불연 (알루미늄 단열프레임 + 층간 방화스팬드럴 0.8m)",
    unitCostKrwPerWallSqm: 680000,
    constCostDeltaPct: 6.5,
    rentPremiumPct: 4.5,
    embodiedCarbonKgSqm: 118,
    glassColorDay: 0x909d97,
    glassColorNight: 0xb5ab96,
    frameColor: 0x8d8576,
    spandrelColor: 0xc6bfb1
  },
  kinetic_louver: {
    key: "kinetic_louver",
    nameKr: "친환경 수직 차양 루버 + 더블스킨",
    shortKr: "친환경 수직 차양 루버",
    bestForKr: "종로·광화문·판교 친환경 사옥 및 ZEB 인증 빌딩",
    defaultWwrPct: 65,
    defaultBayM: 2.0,
    defaultLouverM: 0.55,
    wallU: 0.145,
    windowU: 0.81,
    psiSurcharge: 0.030,
    baseShgc: 0.23,
    vltPct: 54,
    fireGrade: "불연 (아노다이징 알루미늄 루버 핀 + 미네랄울 스팬드럴)",
    unitCostKrwPerWallSqm: 790000,
    constCostDeltaPct: 9.5,
    rentPremiumPct: 5.5,
    embodiedCarbonKgSqm: 128,
    glassColorDay: 0x8c9890,
    glassColorNight: 0xb6ac92,
    frameColor: 0xa18b6d,
    spandrelColor: 0xaaa38f
  },
  brick_rainscreen: {
    key: "brick_rainscreen",
    nameKr: "성수동 테라코타·적벽돌 레인스크린",
    shortKr: "성수동 테라코타·적벽돌",
    bestForKr: "성수동 지식산업센터, 신사·한남 크리에이티브 사옥",
    defaultWwrPct: 45,
    defaultBayM: 3.2,
    defaultLouverM: 0.25,
    wallU: 0.138,
    windowU: 0.89,
    psiSurcharge: 0.020,
    baseShgc: 0.31,
    vltPct: 60,
    fireGrade: "불연 REI 120 (고밀도 점토적벽돌/테라코타 + 통기층 50mm + 준불연 단열)",
    unitCostKrwPerWallSqm: 490000,
    constCostDeltaPct: 0.0,
    rentPremiumPct: 2.0,
    embodiedCarbonKgSqm: 82,
    glassColorDay: 0x6d7770,
    glassColorNight: 0xc0ad8e,
    frameColor: 0x62584c,
    spandrelColor: 0xa47c65
  },
  stone_ribbon: {
    key: "stone_ribbon",
    nameKr: "라임스톤·포천석 PC 패널 + 수평 리본창",
    shortKr: "라임스톤 PC + 리본창",
    bestForKr: "도심 중견기업 사옥, 메디컬 빌딩, 명동·중구 상업시설",
    defaultWwrPct: 54,
    defaultBayM: 3.0,
    defaultLouverM: 0.20,
    wallU: 0.148,
    windowU: 0.88,
    psiSurcharge: 0.025,
    baseShgc: 0.28,
    vltPct: 56,
    fireGrade: "불연 REI 120 (천연 라임스톤/포천석 30T 트러스 + 불연 미네랄울)",
    unitCostKrwPerWallSqm: 560000,
    constCostDeltaPct: 3.0,
    rentPremiumPct: 3.0,
    embodiedCarbonKgSqm: 96,
    glassColorDay: 0x929d96,
    glassColorNight: 0xbdb39f,
    frameColor: 0x928a7b,
    spandrelColor: 0xd2c5ae
  },
  diagrid_biophilic: {
    key: "diagrid_biophilic",
    nameKr: "미래형 다이아그리드 외골격 & 그린 테라스",
    shortKr: "다이아그리드·그린테라스",
    bestForKr: "여의도·용산·강남 하이엔드 랜드마크 복합 및 미래형 사옥",
    defaultWwrPct: 68,
    defaultBayM: 3.6,
    defaultLouverM: 0.65,
    wallU: 0.140,
    windowU: 0.78,
    psiSurcharge: 0.028,
    baseShgc: 0.20,
    vltPct: 62,
    fireGrade: "불연 내화피복 다이아그리드 외골격 + 삼중 방화유리 + 방화 스카이테라스",
    unitCostKrwPerWallSqm: 880000,
    constCostDeltaPct: 13.0,
    rentPremiumPct: 8.0,
    embodiedCarbonKgSqm: 112,
    glassColorDay: 0x99a79a,
    glassColorNight: 0xb9b39a,
    frameColor: 0xe4e0d3,
    spandrelColor: 0xc8c8b7
  }
};

const FACADE_ACCENT_PALETTES = {
  titanium:        { nameKr: "알라바스터 화이트", frame: 0xebe8df, spandrel: 0xdedacf, slab: 0xf1ede4 },
  warm_limestone:  { nameKr: "웜 베이지 라임스톤", frame: 0xb9ad99, spandrel: 0xcbbda6, slab: 0xe4dccf },
  champagne:       { nameKr: "샴페인 브론즈 골드", frame: 0x9a8566, spandrel: 0xb4a084, slab: 0xd0c1ab },
  terracotta:      { nameKr: "성수 테라코타 로제", frame: 0x654d40, spandrel: 0xa57961, slab: 0xd7c7b6 },
  crimson_brick:   { nameKr: "크림슨 고벽돌",     frame: 0x443c35, spandrel: 0x875f50, slab: 0xc9bba9 },
  sage_patina:     { nameKr: "세이지 그린 파사드", frame: 0x68745e, spandrel: 0x8b957b, slab: 0xc8cbb7 },
  sapphire:        { nameKr: "로열 사파이어 네이비", frame: 0x9da6a0, spandrel: 0x667981, slab: 0xd0d2c8 },
  basalt_charcoal: { nameKr: "바살트 다크 차콜",  frame: 0x494c44, spandrel: 0x676b60, slab: 0xa6aa9c }
};

const CLADDING_MATERIALS = {
  anodized_metal: {
    key: "anodized_metal",
    nameKr: "아노다이징 알루미늄 메탈패널",
    shortKr: "아노다이징 메탈",
    roughness: 0.28,
    metalness: 0.72,
    costMult: 1.00,
    wallUDelta: 0.000,
    defaultAccent: "auto"
  },
  terracotta_brick: {
    key: "terracotta_brick",
    nameKr: "성수동 테라코타 · 고밀도 적벽돌(줄눈)",
    shortKr: "성수 적벽돌(줄눈)",
    roughness: 0.84,
    metalness: 0.08,
    costMult: 0.94,
    wallUDelta: -0.008,
    defaultAccent: "terracotta"
  },
  limestone: {
    key: "limestone",
    nameKr: "유럽산 천연 라임스톤(대판 줄눈)",
    shortKr: "유럽산 라임스톤",
    roughness: 0.72,
    metalness: 0.10,
    costMult: 1.06,
    wallUDelta: -0.005,
    defaultAccent: "warm_limestone"
  },
  granite_pocheon: {
    key: "granite_pocheon",
    nameKr: "포천석 · 화강암 버너구이 석재패널",
    shortKr: "포천석 화강암",
    roughness: 0.76,
    metalness: 0.14,
    costMult: 0.96,
    wallUDelta: -0.004,
    defaultAccent: "titanium"
  },
  uhpc_concrete: {
    key: "uhpc_concrete",
    nameKr: "초고성능 노출콘크리트 (UHPC 패널)",
    shortKr: "노출콘크리트 UHPC",
    roughness: 0.68,
    metalness: 0.12,
    costMult: 1.03,
    wallUDelta: -0.003,
    defaultAccent: "basalt_charcoal"
  },
  champagne_bronze: {
    key: "champagne_bronze",
    nameKr: "샴페인 브론즈 헤어라인 복합패널",
    shortKr: "샴페인 브론즈패널",
    roughness: 0.24,
    metalness: 0.82,
    costMult: 1.09,
    wallUDelta: 0.002,
    defaultAccent: "champagne"
  }
};

const GLASS_TINT_PALETTES = {
  auto:          { nameKr: "아키타입 기본 로이유리", dayHex: null, nightHex: null, shgcDelta: 0.0 },
  sapphire_blue: { nameKr: "사파이어 쿨블루 로이",  dayHex: 0x7c9198, nightHex: 0x9baaa5, shgcDelta: -0.02 },
  crystal_clear: { nameKr: "크리스탈 초투명 저철분", dayHex: 0xc6d0c5, nightHex: 0xd6cebb, shgcDelta: 0.04 },
  emerald_green: { nameKr: "에메랄드 그린 로이",    dayHex: 0x879b83, nightHex: 0xa6b28e, shgcDelta: -0.03 },
  bronze_gold:   { nameKr: "브론즈 앰버 리플렉티브", dayHex: 0xa18b6e, nightHex: 0xc3ad85, shgcDelta: -0.04 },
  smoke_grey:    { nameKr: "스모크 실버 그레이",    dayHex: 0x818980, nightHex: 0xa5aa9b, shgcDelta: -0.03 }
};

const PODIUM_STYLES = {
  showwindow:      { nameKr: "통유리 리테일 쇼윈도" },
  brick_arcade:    { nameKr: "아케이드 벽돌·석재 기둥열" },
  piloti_colonade: { nameKr: "개방형 필로티 콜로네이드" }
};

const SEOUL_PARCELS = {
  gangnam_yeoksam: {
    id: "gangnam_yeoksam",
    name: "서울 강남구 역삼동 823 일원",
    pnu: "1168010100-1-0823-0000",
    districtPlan: "테헤란로 지구단위계획구역",
    zoning: "일반상업지역",
    buildingUse: "업무시설(오피스)",
    facadeType: "curtain_wall",
    siteAreaSqm: 1650,
    widthM: 42.0,
    depthM: 39.3,
    roadWidthM: 30,
    seoulDowntown: false,
    publicContribPct: 0,
    northSolar: false,
    floorsAbove: 15,
    floorsBelow: 5,
    targetBcr: 54,
    floorHeight: 4.0,
    setbackM: 2.0,
    coreType: "center",
    landPricePyeongM: 150,
    constCostPyeongMan: 950,
    rentPyeongMan: 15.5,
    capRatePct: 4.4,
    loanLtvPct: 62,
    loanRatePct: 6.0,
    targetIrrPct: 14.0,
    lat: 37.5006,
    lng: 127.0364,
    existingBuilding: {
      builtYear: 1991,
      existingFloors: "B3 / 10F",
      existingGfaSqm: 11200,
      existingFarPct: 520,
      structuralGrade: "B등급 (내진보강 필요)"
    }
  },
  seongdong_seongsu: {
    id: "seongdong_seongsu",
    name: "서울 성동구 성수동2가 277 일원",
    pnu: "1120011500-1-0277-0000",
    districtPlan: "성수 준공업지역 지구단위계획",
    zoning: "준공업지역",
    buildingUse: "지식산업센터",
    facadeType: "brick_rainscreen",
    siteAreaSqm: 2400,
    widthM: 52.0,
    depthM: 46.15,
    roadWidthM: 20,
    seoulDowntown: false,
    publicContribPct: 0,
    northSolar: false,
    floorsAbove: 10,
    floorsBelow: 4,
    targetBcr: 52,
    floorHeight: 4.2,
    setbackM: 2.0,
    coreType: "center",
    landPricePyeongM: 95,
    constCostPyeongMan: 860,
    rentPyeongMan: 11.5,
    capRatePct: 4.7,
    loanLtvPct: 65,
    loanRatePct: 5.8,
    targetIrrPct: 14.5,
    lat: 37.5446,
    lng: 127.0560,
    existingBuilding: {
      builtYear: 1986,
      existingFloors: "B1 / 4F",
      existingGfaSqm: 4100,
      existingFarPct: 155,
      structuralGrade: "C등급 (신축 권고)"
    }
  },
  mapo_hapjeong: {
    id: "mapo_hapjeong",
    name: "서울 마포구 합정동 381 일원",
    pnu: "1144012200-1-0381-0000",
    districtPlan: "합정역세권 지구단위계획구역",
    zoning: "제3종일반주거지역",
    buildingUse: "공동주택(주상복합)",
    facadeType: "stone_ribbon",
    siteAreaSqm: 920,
    widthM: 28.0,
    depthM: 32.85,
    roadWidthM: 12,
    seoulDowntown: false,
    publicContribPct: 0,
    northSolar: true,
    floorsAbove: 8,
    floorsBelow: 3,
    targetBcr: 46,
    floorHeight: 3.3,
    setbackM: 1.5,
    coreType: "north",
    landPricePyeongM: 82,
    constCostPyeongMan: 840,
    rentPyeongMan: 10.5,
    capRatePct: 4.6,
    loanLtvPct: 60,
    loanRatePct: 6.2,
    targetIrrPct: 13.0,
    lat: 37.5495,
    lng: 126.9139,
    existingBuilding: {
      builtYear: 1994,
      existingFloors: "B1 / 5F",
      existingGfaSqm: 1950,
      existingFarPct: 185,
      structuralGrade: "B등급 (리모델링/신축 경합)"
    }
  },
  jongno_euljiro: {
    id: "jongno_euljiro",
    name: "서울 중구 을지로3가 95 일원",
    pnu: "1114015000-1-0095-0000",
    districtPlan: "세운재정비촉진지구 / 을지로 서울도심",
    zoning: "중심상업지역",
    buildingUse: "업무시설(오피스)",
    facadeType: "kinetic_louver",
    siteAreaSqm: 1320,
    widthM: 36.0,
    depthM: 36.67,
    roadWidthM: 25,
    seoulDowntown: true, // 제48조제7호 단서: 서울도심 800% + 기부채납 완화
    publicContribPct: 10,
    northSolar: false,
    floorsAbove: 18,
    floorsBelow: 6,
    targetBcr: 55,
    floorHeight: 4.0,
    setbackM: 2.0,
    coreType: "split",
    landPricePyeongM: 175,
    constCostPyeongMan: 1020,
    rentPyeongMan: 16.0,
    capRatePct: 4.3,
    loanLtvPct: 60,
    loanRatePct: 6.1,
    targetIrrPct: 13.5,
    lat: 37.5663,
    lng: 126.9926,
    existingBuilding: {
      builtYear: 1989,
      existingFloors: "B4 / 14F",
      existingGfaSqm: 13800,
      existingFarPct: 840,
      structuralGrade: "B등급 (기득권 용적률 보유 · 대수선 유리)"
    }
  },
  custom_seoul: {
    id: "custom_seoul",
    name: "사용자 직접 입력 필지 (서울시)",
    pnu: "1100000000-1-0001-0000",
    districtPlan: "일반 도시관리계획구역",
    zoning: "일반상업지역",
    buildingUse: "업무시설(오피스)",
    facadeType: "diagrid_biophilic",
    siteAreaSqm: 1500,
    widthM: 40.0,
    depthM: 37.5,
    roadWidthM: 20,
    seoulDowntown: false,
    publicContribPct: 0,
    northSolar: false,
    floorsAbove: 12,
    floorsBelow: 4,
    targetBcr: 55,
    floorHeight: 3.9,
    setbackM: 2.0,
    coreType: "center",
    landPricePyeongM: 120,
    constCostPyeongMan: 900,
    rentPyeongMan: 13.0,
    capRatePct: 4.5,
    loanLtvPct: 60,
    loanRatePct: 6.2,
    targetIrrPct: 14.0,
    lat: 37.5665,
    lng: 126.9780,
    existingBuilding: {
      builtYear: 1995,
      existingFloors: "B2 / 7F",
      existingGfaSqm: 6500,
      existingFarPct: 350,
      structuralGrade: "B등급"
    }
  }
};

// ============================================================================
// 2. APPLICATION STATE
// ============================================================================
const state = {
  ...(typeof window !== 'undefined' ? window.AtelierSpatialSettings?.defaults || {} : {}),
  parcelKey: "gangnam_yeoksam",
  option: "A", // "A" (Podium+Tower), "B" (Courtyard+Terrace), "C" (North Core High-Eff)
  viewMode: "standard", // "standard", "envelope", "xray", "exploded"
  daylightTheme: true, // Default to Bright Luxury Architectural Exhibition Mode
  showSurroundingBuildings: true,
  facadeColorMode: "atelier", // Dashboard-only presentation; excluded from shared design inputs.
  facadePanelDepthMm: 35,
  facadeJointMm: 8,
  facadeLouverAngleDeg: 22,
  facadeType: "curtain_wall",
  claddingMaterial: "anodized_metal",
  facadeWwrPct: 72,
  facadeBayM: 2.4,
  facadeLouverM: 0.15,
  facadeAccent: "auto",
  glassTint: "auto",
  podiumStyle: "showwindow",
  siteAreaSqm: 1650,
  roadWidthM: 30,
  zoning: "일반상업지역",
  buildingUse: "업무시설(오피스)",
  hotelType: "unconfirmed",
  hotelResidentialDistanceM: null,
  hotelResidentialBarrier: null,
  financeMode: "rental",
  hotelAdrKrw: 180000,
  hotelOccupancyPct: 70,
  hotelRoomsOverride: 0,
  hotelAncillaryRevenuePct: 15,
  hotelOpexPct: 60,
  hotelFixedOpexEok: 0,
  hotelFfeReservePct: 4,
  hotelManagementFeePct: 3,
  spaceProgram: "standard",
  seoulDowntown: false,
  publicContribPct: 0,
  northSolar: false,
  parcelMerged: false,
  parcelData: null, // Actual WGS84 boundaries, independent of example parcel names.
  regulationMode: "statutory",
  modelDetail: "auto",
  legalFarCapPct: 0,
  legalBcrCapPct: 0,
  maxHeightM: 0,
  parkingMode: "fit",
  housingUnitAreaSqm: 59,
  housingUnits: 0,
  residentialType: "officetel",
  housingPermitType: "building_permit",
  parkingDistrict: "unconfirmed",
  setbackM: 2.0,       // 남측 전면도로 건축한계선
  setbackSideM: 1.5,   // 동·서측 인접대지 이격거리
  setbackRearM: 2.0,   // 북측 후면대지 이격거리
  floorsAbove: 15,
  floorsBelow: 5,
  targetBcr: 54,
  floorHeight: 4.0,
  coreType: "center",
  mixedUseProfile: "office_retail", // 층별 복합용도 프로파일
  floorUseOverrides: {},            // 3D 층 클릭 인스펙터 개별 용도 오버라이드
  selectedFloorLevel: null,         // 현재 마우스로 클릭된 3D 층 번호
  clipPlanePct: 100,                // ③ That Open Company 스타일 실시간 3D 단면절단 (15~100%)
  showDimensions: true,             // ③ 3D 대지·높이 치수선 표시
  sunHour: 12.0,
  landPricePyeongM: 150,
  constCostPyeongMan: 950,
  rentPyeongMan: 15.5,
  capRatePct: 4.4,
  loanLtvPct: 62,
  loanRatePct: 5.6,
  lpSharePct: 80,      // ② 한국형 부동산펀드(REF/PFV) LP 우선주 출자비중 (%)
  lpHurdlePct: 7.5,    // ② LP 우선배당 허들레이트 (연 %)
  gpPromotePct: 30,    // ② 초과수익 GP(시행사) 성공보수 배분율 (%)
  targetIrrPct: 14.0,
  isRecording: false,
  lawSyncedMeta: null,
  lastComputed: null
};

// ============================================================================
// 3. ARCHITECTURAL & FINANCIAL ENGINE (Skills-Architects KR + ibuilder/massing)
// ============================================================================

function scurveWeights(n, steepness = 6.0) {
  if (n <= 0) return [];
  if (n === 1) return [1.0];
  const cdf = [];
  for (let i = 0; i <= n; i++) {
    const x = steepness * (i / n - 0.5);
    cdf.push(1.0 / (1.0 + Math.exp(-x)));
  }
  const diffs = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = cdf[i + 1] - cdf[i];
    diffs.push(d);
    sum += d;
  }
  return diffs.map(d => d / sum);
}

function calcMonthlyNpv(annualRate, monthlyFlows) {
  if (!Number.isFinite(annualRate) || annualRate <= -1 || !Array.isArray(monthlyFlows)
    || monthlyFlows.some(cf => !Number.isFinite(cf))) return NaN;
  const logMonthlyGrowth = Math.log1p(annualRate) / 12;
  let npv = 0, compensation = 0;
  for (let t = 0; t < monthlyFlows.length; t++) {
    if (monthlyFlows[t] === 0) continue;
    const discounted = monthlyFlows[t] * Math.exp(-logMonthlyGrowth * t);
    if (!Number.isFinite(discounted)) return NaN;
    const corrected = discounted - compensation;
    const next = npv + corrected;
    compensation = (next - npv) - corrected;
    npv = next;
  }
  return Number.isFinite(npv) ? npv : NaN;
}

function solveXirr(monthlyFlows) {
  if (!Array.isArray(monthlyFlows) || monthlyFlows.some(cf => !Number.isFinite(cf))) return NaN;
  const terms = [];
  let previousSign = 0, signChanges = 0;
  monthlyFlows.forEach((cf, t) => {
    if (!cf) return;
    const sign = Math.sign(cf);
    if (previousSign && sign !== previousSign) signChanges++;
    previousSign = sign;
    terms.push({ month: t, sign, logAmount: Math.log(Math.abs(cf)) });
  });
  // More than one sign change can give multiple IRRs. A single arbitrary
  // bisection result would falsely imply a unique investment return.
  if (signChanges !== 1) return NaN;
  const scaledNpv = logAnnualGrowth => {
    let maxExponent = -Infinity;
    for (const term of terms) maxExponent = Math.max(maxExponent, term.logAmount - term.month * logAnnualGrowth / 12);
    let result = 0;
    for (const term of terms) result += term.sign * Math.exp(term.logAmount - term.month * logAnnualGrowth / 12 - maxExponent);
    return result;
  };
  const atZero = scaledNpv(0);
  if (Math.abs(atZero) < 1e-13) return 0;
  let low = -1, high = 1;
  let fLow = scaledNpv(low), fHigh = scaledNpv(high);
  // Search in log(1 + annual IRR), including losses below -45% and gains
  // above 250%. A missing bracket remains unavailable instead of a bound.
  while (Math.sign(fLow) === Math.sign(fHigh) && high < 32) {
    low *= 2; high *= 2;
    fLow = scaledNpv(low); fHigh = scaledNpv(high);
  }
  if (!Number.isFinite(fLow) || !Number.isFinite(fHigh)) return NaN;
  if (fLow === 0) return Math.expm1(low);
  if (fHigh === 0) return Math.expm1(high);
  if (Math.sign(fLow) === Math.sign(fHigh)) return NaN;
  for (let iter = 0; iter < 100; iter++) {
    const mid = (low + high) / 2;
    const fMid = scaledNpv(mid);
    if (Math.abs(fMid) < 1e-13 || high - low < 1e-12) return Math.expm1(mid);
    if (Math.sign(fLow) !== Math.sign(fMid)) high = mid;
    else { low = mid; fLow = fMid; }
  }
  return Math.expm1((low + high) / 2);
}

function syncRegulationModeUI() {
  const scenario = state.regulationMode === "scenario";
  const select = document.getElementById("selectRegulationMode");
  if (select) select.value = scenario ? "scenario" : "statutory";
  for (const id of ["inputLegalFarCap", "inputLegalBcrCap", "inputLegalHeightCap"]) {
    const input = document.getElementById(id);
    if (input) input.disabled = !scenario;
  }
  const solar = document.getElementById("chkNorthSolar");
  if (solar) {
    const zoning = state.zoning;
    solar.disabled = !scenario;
    solar.checked = scenario ? Boolean(state.northSolar) : /전용주거|일반주거/.test(zoning);
    solar.title = scenario ? "일조 적용 여부의 비교 가정입니다. 법정 예외 확인이 아닙니다."
      : "법정 기준 모드에서는 주거지역 일반 사선을 적용합니다. 저장된 비교값과 개별 예외는 구분합니다.";
  }
}

function reviewParcelRegulations(params) {
  const features = params.parcelData?.features;
  if (!features?.length || !window.AtelierParcelRegulations) return null;
  const records = features.map(f => params.parcelData.source === "vworld" && f.properties.source === "vworld" && f.properties.regulations?.pnu === f.properties.pnu ? f.properties.regulations : null);
  return window.AtelierParcelRegulations.resolve(records, params, window.AtelierLegal);
}

function evaluateDesignAndProforma(params, optionCode = params.option, overrideLandPricePyeongM = null) {
  const parcelRegulationReview = reviewParcelRegulations(params);
  const regulationMode = params.regulationMode === "scenario" ? "scenario" : "statutory";
  // Saved comparison numbers are never presented as statutory density/height.
  // Confirmed plan limits below remain applicable in both modes.
  if (regulationMode === "statutory") params = { ...params, legalFarCapPct: 0, legalBcrCapPct: 0, maxHeightM: 0 };
  if (parcelRegulationReview?.applied) params = { ...params, ...parcelRegulationReview.inputs };
  const baseZoningRule = SEOUL_ZONING_RULES[params.zoning] || SEOUL_ZONING_RULES["일반상업지역"];
  const legalEngine = typeof window !== "undefined" ? window.AtelierLegal : null;
  const permissionEngine = typeof window !== "undefined" ? window.AtelierUsePermissions : null;
  const permissionBasis = permissionEngine?.evaluate(params);
  const verifiedRule = legalEngine ? legalEngine.rulesFor(params, SEOUL_ZONING_RULES) : {};
  const parcelEngine = window.AtelierParcelGeometry;
  const rawParcelGeometry = params.parcelData && parcelEngine ? parcelEngine.derive(params.parcelData) : null;
  let parcelGeometry = rawParcelGeometry;
  const isMerged = Boolean(parcelGeometry && parcelGeometry.featureCount > 1);
  const cadastralAreaSqm = Math.max(1, parcelGeometry ? parcelGeometry.areaSqm : Number(params.siteAreaSqm));
  const publicContribPct = Math.max(0, Math.min(90, Number(params.publicContribPct || 0)));
  const publicContribSqm = cadastralAreaSqm * (publicContribPct / 100.0);
  const siteAreaSqm = cadastralAreaSqm - publicContribSqm;
  const sitePyeong = cadastralAreaSqm / PYEONG_TO_SQM; // 토지매입비는 공부상 전체 면적 기준
  const baseOrdFar = verifiedRule.baseOrdFar ?? (params.seoulDowntown
    ? (baseZoningRule.maxFarDowntown || baseZoningRule.maxFar) : baseZoningRule.maxFar);
  const alphaRatio = publicContribSqm / siteAreaSqm;
  // 합필·기부채납만으로 용적률 보너스를 지급하지 않는다. 개별 계획의 확인된 상한은 법규 모듈에서 제한한다.
  const zoningRule = {
    ...baseZoningRule,
    ...verifiedRule,
    baseOrdFar,
    maxFar: verifiedRule.maxFar ?? baseOrdFar,
    maxBcr: verifiedRule.maxBcr ?? baseZoningRule.maxBcr,
    alphaRatio,
    publicContribSqm,
    cadastralAreaSqm,
    isMerged
  };
  const northSolarApplies = verifiedRule.northSolarApplies ?? (Boolean(params.northSolar) && Boolean(baseZoningRule.northSolarDefault));
  const massWarnings = [...(verifiedRule.warnings || [])];
  if (parcelGeometry) massWarnings.push(parcelGeometry.warnings[0]);
  if (parcelRegulationReview) massWarnings.push(...parcelRegulationReview.warnings);
  if (params.parcelMerged && !parcelGeometry) massWarnings.push("경계 없는 +35% 합필 가정은 적용하지 않습니다. 실제 인접 필지 경계를 추가해 주세요.");
  if (!legalEngine) massWarnings.push("법규 모듈을 불러오지 못해 주차 기준을 확인할 수 없습니다.");

  const preset = SEOUL_PARCELS[params.parcelKey] || SEOUL_PARCELS.gangnam_yeoksam;
  const aspect = preset.widthM / preset.depthM;
  const contributionScale = Math.sqrt(siteAreaSqm / cadastralAreaSqm);
  let siteWidthM = parcelGeometry ? parcelGeometry.rectangle.widthM * contributionScale : Math.sqrt(siteAreaSqm * aspect);
  let siteDepthM = parcelGeometry ? parcelGeometry.rectangle.depthM * contributionScale : siteAreaSqm / siteWidthM;

  // ① 4면 경계선별 차등 이격거리 (전면 건축한계선 / 측면 인접대지 / 후면 정북)
  const frontSetbackM = Math.max(0, Number(params.setbackM ?? 2.0));
  const sideSetbackM = Math.max(0, Number(params.setbackSideM ?? 1.5));
  const rearSetbackM = Math.max(0, Number(params.setbackRearM ?? 2.0));

  let availWidthM = Math.max(0, siteWidthM - sideSetbackM * 2);
  let availDepthM = Math.max(0, siteDepthM - frontSetbackM - rearSetbackM);
  let maxSetbackArea = availWidthM * availDepthM;
  const baseZShiftFrom4Setbacks = (rearSetbackM - frontSetbackM) * 0.5;

  let optionBcrFactor = 1.0;
  let netEfficiencyBase = 0.58;
  let rentPremiumFactor = 1.0;
  let constCostFactor = 1.0;

  if (optionCode === "A") {
    optionBcrFactor = 1.0;
    netEfficiencyBase = 0.582;
    rentPremiumFactor = 1.0;
    constCostFactor = 1.0;
  } else if (optionCode === "B") {
    optionBcrFactor = 0.96;
    netEfficiencyBase = 0.560;
    rentPremiumFactor = 1.0;
    constCostFactor = 1.035;
  } else if (optionCode === "C") {
    optionBcrFactor = 0.95;
    netEfficiencyBase = 0.627;
    rentPremiumFactor = 1.0;
    constCostFactor = 0.99;
  }

  if (params.coreType === "north") netEfficiencyBase += 0.015;
  if (params.coreType === "split") netEfficiencyBase -= 0.012;

  const effectiveTargetBcr = Math.max(0, Math.min(zoningRule.maxBcr, Number(params.targetBcr) * optionBcrFactor));
  // Select a site frame from the full underground planning envelope. A small
  // above-ground BCR must not rotate/shrink the independently available basement.
  const siteFrameFit = rawParcelGeometry && parcelEngine.fitRectangle ? parcelEngine.fitRectangle(rawParcelGeometry, {
    targetAreaSqm: siteAreaSqm * .82, frontSetbackM: 1.2, sideSetbackM: 1.2, rearSetbackM: 1.2,
    minDimensionM: 6, allowRotation: !northSolarApplies
  }) : null;
  const siteFrameRotation = siteFrameFit?.fits ? siteFrameFit.rotationRad : 0;
  const sitePlacement = rawParcelGeometry && parcelEngine.fitRectangle ? parcelEngine.fitRectangle(rawParcelGeometry, {
    targetAreaSqm: siteAreaSqm * effectiveTargetBcr / 100,
    frontSetbackM, sideSetbackM, rearSetbackM, minDimensionM: 6,
    // Keep the existing north-height envelope in a true north frame. Other
    // studies may align with actual parcel edges; every layer shares that frame.
    rotationRad: siteFrameRotation
  }) : null;
  const framePlacement = sitePlacement?.fits ? sitePlacement : siteFrameFit?.fits ? siteFrameFit : null;
  if (framePlacement) {
    const origin = [framePlacement.clearanceCenterX ?? framePlacement.centerX, framePlacement.clearanceCenterZ ?? framePlacement.centerZ];
    const outlines = framePlacement.clearanceLocalOutlines || framePlacement.localOutlines;
    const points = outlines.flat(2);
    parcelGeometry = { ...rawParcelGeometry, outlines,
      centerWgs84: parcelEngine.unprojectLocal(rawParcelGeometry, origin),
      frameRotationRad: framePlacement.rotationRad,
      bounds: { minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])),
        minZ: Math.min(...points.map(p => p[1])), maxZ: Math.max(...points.map(p => p[1])),
        widthM: Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0])),
        depthM: Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1])) },
      warnings: [...rawParcelGeometry.warnings]
    };
  }
  if (sitePlacement?.fits) {
    siteWidthM = sitePlacement.studyWidthM;
    siteDepthM = sitePlacement.studyDepthM;
    availWidthM = sitePlacement.widthM;
    availDepthM = sitePlacement.depthM;
    maxSetbackArea = sitePlacement.areaSqm;
    const placementNote = '실제 경계와 내부 공백 안에서 이격을 포함한 사각 매스 배치를 검사했습니다. 접도·건축선의 법적 위치는 별도 확인합니다.';
    parcelGeometry.warnings.push(placementNote);
    massWarnings.push(placementNote);
  } else if (sitePlacement) {
    availWidthM = 0; availDepthM = 0; maxSetbackArea = 0;
    massWarnings.push('입력한 건폐율·이격과 최소 검토 폭 6m를 함께 만족하는 매스 배치를 찾지 못했습니다. 대지 형상과 입력 상한을 확인하세요.');
  }
  const targetFootprintSqm = Math.min(maxSetbackArea, siteAreaSqm * (effectiveTargetBcr / 100));

  const baseScale = maxSetbackArea > 0 ? Math.sqrt(targetFootprintSqm / maxSetbackArea) : 0;
  const baseWidthM = availWidthM * baseScale;
  const baseDepthM = availDepthM * baseScale;

  const maxLegalFarSqm = siteAreaSqm * (zoningRule.maxFar / 100);
  const maxResidentialFarSqm = Number(zoningRule.maxResidentialFarPct) > 0 ? siteAreaSqm * Number(zoningRule.maxResidentialFarPct) / 100 : null;
  // National commercial-zone annexes require residential share strictly <90%.
  const baseNonResidentialRatio = Math.max(0, Math.min(1, Number(zoningRule.minNonResidentialRatio) || 0));
  const minNonResidentialRatio = baseNonResidentialRatio > 0 && permissionBasis?.limits?.maxResidentialShareExclusive === 0.9
    ? Math.max(baseNonResidentialRatio, 0.1000001) : baseNonResidentialRatio;
  const requestedFloorsAbove = Math.max(0, Math.floor(Number(params.floorsAbove) || 0));
  const maxHeightM = Math.max(0, Number(params.maxHeightM) || 0);
  const floorHeightM = Math.max(0.1, Number(params.floorHeight) || 4);
  const roofAllowanceM = 1.2;
  const minStudyDimensionM = 6; // 자동 실내 평면 생성을 위한 검토용 한계. 법정 최소 치수가 아니다.
  const overrides = params.floorUseOverrides || {};
  const mixedProfile = params.mixedUseProfile || "office_retail";

  const USE_META = {
    retail:      { labelKr: "상업·리테일 포디움", rentMult: 1.28, loadKnSqm: 5.0 },
    main:        { labelKr: "프라임 업무(오피스)", rentMult: 1.00, loadKnSqm: 3.5 },
    residential: { labelKr: "하이엔드 오피스텔·주거", rentMult: 1.12, loadKnSqm: 2.5 },
    hotel:       { labelKr: "호텔 객실", rentMult: 1.12, loadKnSqm: 2.0 },
    amenity:     { labelKr: "스카이라운지·아트리움", rentMult: 1.18, loadKnSqm: 4.0 }
  };
  let coreLayout = null;

  function floorUseAt(f) {
    const use = String(params.buildingUse || "");
    let defaultFloorUse = f <= 2 ? "retail" : "main";
    if (use.includes("호텔")) defaultFloorUse = f === 1 ? "amenity" : "hotel";
    else if (use.includes("오피스텔")) defaultFloorUse = f <= 2 ? "retail" : "residential";
    else if (use.includes("공동주택")) defaultFloorUse = f === 1 ? "retail" : "residential";
    else if (use.includes("근린생활") || use.includes("판매시설")) defaultFloorUse = "retail";
    else if (use.includes("지식산업센터")) defaultFloorUse = f === 1 ? "retail" : "main";
    else if (mixedProfile === "mixed_resi") {
      if (f >= Math.max(4, Math.ceil(requestedFloorsAbove * 0.65))) defaultFloorUse = "residential";
    } else if (mixedProfile === "knowledge_ind" || use.includes("지식산업센터")) {
      defaultFloorUse = f === 1 ? "retail" : "main";
    } else if (mixedProfile === "flagship_hq") {
      if (f === requestedFloorsAbove) defaultFloorUse = "amenity";
    }
    return overrides[f] || defaultFloorUse;
  }

  function buildFloorPlates(areaBudgetSqm) {
    const plates = [];
    let accumulatedSqm = 0;
    let residentialSqm = 0, nonResidentialSqm = 0;
    let businessSqm = 0;
    let salesSqm = 0;
    let stopReason = null;
    const baseNorthEdge = baseZShiftFrom4Setbacks - baseDepthM / 2;
    const baseSouthEdge = baseZShiftFrom4Setbacks + baseDepthM / 2;
    for (let f = 1; f <= requestedFloorsAbove; f++) {
    const zBottom = (f - 1) * floorHeightM;
    const zTop = f * floorHeightM;
    if (maxHeightM > 0 && zTop + roofAllowanceM > maxHeightM + 1e-8) { stopReason = "height"; break; }
    let w = baseWidthM;
    let d = baseDepthM;
    let northOffsetShift = baseZShiftFrom4Setbacks;
    let hasTerraceStep = false;

    if (optionCode === "A" && f >= 4) {
      w *= 0.88;
      d *= 0.88;
      if (f === 4) hasTerraceStep = true;
    } else if (optionCode === "B" && f >= 5) {
      const stepCount = Math.floor((f - 4) / 3);
      const terraceCut = Math.min(0.28, stepCount * 0.065);
      d *= (1 - terraceCut);
      northOffsetShift += -baseDepthM * terraceCut * 0.35;
      if ((f - 4) % 3 === 1) hasTerraceStep = true;
    } else if (optionCode === "C" && f >= 4) {
      w *= 0.93;
      d *= 0.92;
    }

    let solarRequiredSetbackM = rearSetbackM;
    const solarHeightM = zTop + roofAllowanceM;
    if (northSolarApplies) {
      // Include the modeled roof/parapet allowance conservatively, rather than
      // leaving the actual roof outside an envelope checked at slab height.
      solarRequiredSetbackM = solarHeightM <= 10.0 ? Math.max(1.5, rearSetbackM) : Math.max(rearSetbackM, solarHeightM / 2.0);
    }
    // Keep all floors within the initial BCR footprint. Clamp both edges,
    // including centered floors that already have a smaller depth.
    const northLimit = Math.max(baseNorthEdge, -siteDepthM / 2 + solarRequiredSetbackM);
    const southLimit = Math.min(baseSouthEdge, siteDepthM / 2 - frontSetbackM);
    const depthLimit = southLimit - northLimit;
    if (depthLimit < minStudyDimensionM || w < minStudyDimensionM) { stopReason = "envelope"; break; }
    if (d > depthLimit) { d = depthLimit; hasTerraceStep = true; }
    northOffsetShift = Math.max(northLimit + d / 2, Math.min(southLimit - d / 2, northOffsetShift));
    const hasAtrium = optionCode === "B" && f >= 2;
    const atriumVoidRatio = hasAtrium ? 0.35 * 0.35 : 0;
    let grossPlateSqm = w * d * (1 - atriumVoidRatio);
    const floorUse = floorUseAt(f);
    let remainingFarSqm = Math.max(0, areaBudgetSqm - accumulatedSqm);
    const primaryUse = String(params.buildingUse || "");
    const isBusiness = (floorUse === "main" && !primaryUse.includes("지식산업센터"))
      || (floorUse === "residential" && !primaryUse.includes("공동주택") && (primaryUse.includes("오피스텔") || params.residentialType !== "apartment"))
      || (floorUse === "amenity" && primaryUse.includes("업무시설"));
    const businessCap = permissionBasis?.limits?.businessAreaSqm;
    const businessLimited = isBusiness && Number.isFinite(businessCap) && remainingFarSqm > Math.max(0, businessCap - businessSqm);
    if (isBusiness && Number.isFinite(businessCap)) remainingFarSqm = Math.min(remainingFarSqm, Math.max(0, businessCap - businessSqm));
    const isSales = (floorUse === "retail" || floorUse === "amenity") && primaryUse.includes("판매시설");
    const salesCap = permissionBasis?.limits?.salesAreaSqm;
    const salesLimited = isSales && Number.isFinite(salesCap) && remainingFarSqm > Math.max(0, salesCap - salesSqm);
    if (isSales && Number.isFinite(salesCap)) remainingFarSqm = Math.min(remainingFarSqm, Math.max(0, salesCap - salesSqm));
    let residentialLimited = false;
    if (floorUse === "residential") {
      const remainingResidential = maxResidentialFarSqm === null ? Infinity : Math.max(0, maxResidentialFarSqm - residentialSqm);
      const remainingByMix = minNonResidentialRatio > 0
        ? Math.max(0, nonResidentialSqm * (1 - minNonResidentialRatio) / minNonResidentialRatio - residentialSqm) : Infinity;
      const residentialBudget = Math.min(remainingResidential, remainingByMix);
      residentialLimited = residentialBudget < remainingFarSqm;
      remainingFarSqm = Math.min(remainingFarSqm, residentialBudget);
    }
    if (remainingFarSqm < 1e-7) { stopReason = residentialLimited ? "residential" : businessLimited ? "business-use" : salesLimited ? "sales-use" : "area"; break; }
    if (grossPlateSqm > remainingFarSqm) {
      const ratio = remainingFarSqm / grossPlateSqm;
      grossPlateSqm = remainingFarSqm;
      w *= Math.sqrt(ratio);
      d *= Math.sqrt(ratio);
    }
    if (w < minStudyDimensionM || d < minStudyDimensionM) { stopReason = "small-floor"; break; }
    if (coreLayout?.status === "reserved" && window.AtelierCoreLayout &&
        !window.AtelierCoreLayout.validateForFloor(coreLayout, { widthM:w, depthM:d, northShiftM:northOffsetShift, hasAtrium }).valid) {
      stopReason = "core-fit"; break;
    }
    const uMeta = USE_META[floorUse] || USE_META.main;

    const netFloorSqm = grossPlateSqm * netEfficiencyBase;
    const estMonthlyRentMan = Math.round((grossPlateSqm / PYEONG_TO_SQM) * params.rentPyeongMan * uMeta.rentMult * rentPremiumFactor);

    accumulatedSqm += grossPlateSqm;
    if (isBusiness) businessSqm += grossPlateSqm;
    if (isSales) salesSqm += grossPlateSqm;
    if (floorUse === "residential") residentialSqm += grossPlateSqm;
    else nonResidentialSqm += grossPlateSqm;

    plates.push({
      level: f,
      use: floorUse,
      useLabelKr: floorUse === "amenity" && String(params.buildingUse || "").includes("호텔") ? "호텔 로비·공용" : uMeta.labelKr,
      rentMult: uMeta.rentMult,
      loadKnSqm: uMeta.loadKnSqm,
      estMonthlyRentMan,
      netFloorSqm,
      widthM: w,
      depthM: d,
      northShiftM: northOffsetShift,
      zBottom,
      zTop,
      areaSqm: grossPlateSqm,
      solarSetbackM: solarRequiredSetbackM,
      solarHeightM,
      hasAtrium,
      atriumVoidRatio,
      hasTerraceStep
    });
    }
    return { plates, areaSqm: accumulatedSqm, residentialSqm, nonResidentialSqm, stopReason };
  }

  let generated = buildFloorPlates(maxLegalFarSqm);
  const preliminaryReview = window.AtelierBuildingReview?.evaluate({ ...params, floorPlates: generated.plates,
    buildingHeightM: generated.plates.length ? generated.plates.at(-1).zTop + roofAllowanceM : 0 });
  coreLayout = window.AtelierCoreLayout?.planCore({ floorPlates: generated.plates, coreType: params.coreType, option: optionCode,
    circulationProfile: preliminaryReview?.circulationProfile || "standard" }) || null;
  if (coreLayout) massWarnings.push(...coreLayout.warnings);
  const basementFit = siteFrameFit;
  const basementPlateSqm = basementFit ? (basementFit.fits ? basementFit.areaSqm : 0) : Math.max(0, Math.min(siteAreaSqm * 0.82, maxSetbackArea * 0.95));
  const undergroundGfaSqm = basementPlateSqm * Math.max(0, Number(params.floorsBelow) || 0);
  const parkingAreaEstimate = Math.max(0, Math.floor((undergroundGfaSqm * 0.82) / 34.0));
  const basementScale = Math.sqrt(basementPlateSqm / Math.max(1, siteWidthM * siteDepthM));
  const basementOrigin = basementFit?.fits ? parcelEngine.projectWgs84(parcelGeometry,
    parcelEngine.unprojectLocal(rawParcelGeometry, [basementFit.centerX, basementFit.centerZ])) : [0, 0];
  const basementPlacement = { widthM: basementFit?.fits ? basementFit.widthM : siteWidthM * basementScale,
    depthM: basementFit?.fits ? basementFit.depthM : siteDepthM * basementScale,
    centerX: basementOrigin[0], centerZ: basementOrigin[1], clearanceM: 1.2 };
  const parkingLayout = window.AtelierParkingLayout?.generate({ widthM: basementPlacement.widthM, depthM: basementPlacement.depthM,
    floorsBelow: Number(params.floorsBelow) || 0, coreType: params.coreType, floorHeightM: 3.5,
    ...(coreLayout ? { coreRects: coreLayout.cores.map(core => ({ ...core,
      minX: core.minX - basementOrigin[0], maxX: core.maxX - basementOrigin[0],
      minZ: core.minZ - basementOrigin[1], maxZ: core.maxZ - basementOrigin[1] })) } : {}) }) || null;
  const parkingCapacityCount = parkingLayout ? Math.min(parkingAreaEstimate, parkingLayout.capacityCount) : 0;
  if (!parkingLayout) massWarnings.push("주차 배치 모듈을 확인하지 못했습니다. 면적 추정치만으로 주차 수용량을 확보한 것으로 계산하지 않습니다.");
  const parkingFor = plates => legalEngine ? legalEngine.parkingFor(plates, params, parkingCapacityCount) : {
    legalParkingCount: 0, plannedParkingCount: parkingCapacityCount, deficit: 0,
    disabledParkingCount: 0, evChargerFastSlow: 0, sqmPerParkingUnit: null,
    breakdown: [], warnings: ["주차 법규 모듈 미확인"], housingUnits: 0, estimatedUnitCount: true
  };
  const unconstrainedFarAreaSqm = generated.areaSqm;
  const unconstrainedFloorsAbove = generated.plates.length;
  const unconstrainedParking = parkingFor(generated.plates);
  let parking = unconstrainedParking;
  let parkingReducedAreaSqm = 0;
  const parkingFitEligible = Boolean(parkingLayout?.massFitEligible && coreLayout?.status !== "unfeasible");
  const parkingFitDeferred = params.parkingMode !== "report" && !parkingFitEligible && parking.legalParkingCount > parking.plannedParkingCount;
  if (parkingFitDeferred) massWarnings.push("주차 템플릿 배치가 미완료여서 수용량 0대로 매스를 강제 축소하지 않았습니다. 표시 매스의 주차는 미확보이며 램프·코어·기계식 등 별도 계획이 필요합니다.");
  if (params.parkingMode !== "report" && parkingFitEligible && legalEngine && parking.legalParkingCount > parking.plannedParkingCount) {
    // Parking demand is recalculated for every candidate, including changed
    // mixed uses and whole dwelling counts. Keep only candidates that fit.
    let lo = 0, hi = generated.areaSqm;
    let best = buildFloorPlates(0);
    for (let i = 0; i < 42; i++) {
      const mid = (lo + hi) / 2;
      const candidate = buildFloorPlates(mid);
      const requirement = parkingFor(candidate.plates);
      if (requirement.legalParkingCount <= requirement.plannedParkingCount) { lo = mid; best = candidate; }
      else hi = mid;
    }
    generated = best;
    parking = parkingFor(generated.plates);
    parkingReducedAreaSqm = Math.max(0, unconstrainedFarAreaSqm - generated.areaSqm);
    if (parkingReducedAreaSqm > 0.01) massWarnings.push(`주차 배치 수용량 ${parkingCapacityCount}대에 맞춰 지상 연면적을 ${parkingReducedAreaSqm.toFixed(1)}㎡ 줄였습니다.`);
  }
  const floorPlates = generated.plates;
  if (coreLayout) for (const fp of floorPlates) fp.coreLayout = coreLayout;
  let usePermission = permissionEngine?.evaluate(params, floorPlates) || { status: "unverified", label: "용도 허용 미확인", summary: "용도지역별 건축제한 모듈을 불러오지 못했습니다.", warnings: [] };
  if (parcelRegulationReview && !parcelRegulationReview.applied) usePermission = { ...usePermission, scenarioResult: { status: usePermission.status, label: usePermission.label }, status: "unverified", label: "필지 규제 확인 필요", summary: "필지 전체의 단일 용도지역이 확인되지 않아 현재 선택값은 비교 시나리오로만 계산합니다.", warnings: [...(usePermission.warnings || []), ...parcelRegulationReview.warnings] };
  if (permissionEngine) massWarnings.push("용도 검토: " + usePermission.label + " · " + usePermission.summary);
  if (generated.stopReason === "business-use") massWarnings.push("일반주거지역의 업무시설 바닥면적 합계 3,000㎡ 미만 조건에 맞춰 업무·오피스텔 매스를 제한했습니다.");
  if (generated.stopReason === "sales-use") massWarnings.push("일반주거지역의 일반 신축 판매시설 바닥면적 2,000㎡ 미만 조건에 맞춰 매스를 제한했습니다.");
  if (generated.stopReason === "core-fit") massWarnings.push("고정된 공통 코어를 수용하지 못하는 잔여층은 생략했습니다. 층별 코어를 임의 축소하지 않습니다.");
  const actualFloorsAbove = floorPlates.length;
  const accumFarAreaSqm = generated.areaSqm;
  const weightedUseRentMultSum = floorPlates.reduce((sum, fp) => sum + fp.areaSqm * fp.rentMult, 0);
  if (generated.stopReason === "residential") massWarnings.push("상업지역 공동주택의 주거 용적률과 비주거 비율 조건에 맞춰 주거층 생성을 제한했습니다.");
  if (!actualFloorsAbove) massWarnings.push("현재 이격·높이·용적률·주차 조건에서 자동 생성할 수 있는 지상 평면이 없습니다.");
  if (actualFloorsAbove < requestedFloorsAbove) massWarnings.push(`요청 ${requestedFloorsAbove}층 중 ${actualFloorsAbove}층이 생성되었습니다. 6m 미만 평면은 실내 검토 한계로 생략합니다.`);
  const buildingFootprintSqm = floorPlates.length ? floorPlates[0].widthM * floorPlates[0].depthM : 0;
  const achievedBcrPct = (buildingFootprintSqm / siteAreaSqm) * 100;

  const typFloorIdx = Math.min(floorPlates.length - 1, 4);
  const typicalFloorSqm = floorPlates[typFloorIdx] ? floorPlates[typFloorIdx].areaSqm : buildingFootprintSqm;

  const aboveGroundGfaSqm = accumFarAreaSqm;
  const farCountedGfaSqm = aboveGroundGfaSqm; // 제외면적을 입증하지 않은 일괄 2.5% 공제를 적용하지 않는다.
  const achievedFarPct = (farCountedGfaSqm / siteAreaSqm) * 100;

  const totalGfaSqm = aboveGroundGfaSqm + undergroundGfaSqm;

  const netAreaSqm = aboveGroundGfaSqm * netEfficiencyBase;
  const coreCommonSqm = aboveGroundGfaSqm - netAreaSqm;
  const supplyAreaSqm = netAreaSqm + coreCommonSqm * 0.72;
  const contractAreaSqm = aboveGroundGfaSqm + undergroundGfaSqm * 0.35;

  const { sqmPerParkingUnit, legalParkingCount, plannedParkingCount, disabledParkingCount, evChargerFastSlow } = parking;
  const buildingHeightM = actualFloorsAbove ? floorPlates[actualFloorsAbove - 1].zTop + roofAllowanceM : 0;
  const buildingReview = window.AtelierBuildingReview?.evaluate({ ...params, floorPlates, buildingHeightM,
    basementPlateSqm, totalGfaSqm }) || null;
  const representation = buildingReview?.representation || { requested: params.modelDetail || "auto",
    detailLevel: params.modelDetail === "massing" ? "massing" : "concept", profile: "standard", isStructuralDesign: false };
  const structuralReference = window.AtelierConceptStructure?.generate(floorPlates, {
    coreLayout, profile: preliminaryReview?.circulationProfile, buildingUse: params.buildingUse }) || null;

  // Facade & Envelope Engine (korea-facade-and-envelope)
  const facadeArch = FACADE_ARCHETYPES[params.facadeType] || FACADE_ARCHETYPES.curtain_wall;
  const cladMat = CLADDING_MATERIALS[params.claddingMaterial] || CLADDING_MATERIALS.anodized_metal;
  const glassTintObj = GLASS_TINT_PALETTES[params.glassTint] || GLASS_TINT_PALETTES.auto;
  const accentObj = FACADE_ACCENT_PALETTES[params.facadeAccent] || null;
  const podiumObj = PODIUM_STYLES[params.podiumStyle] || PODIUM_STYLES.showwindow;

  const facadeWwrPct = Math.max(25, Math.min(85, Number(params.facadeWwrPct || facadeArch.defaultWwrPct)));
  const facadeBayM = Math.max(1.4, Math.min(4.8, Number(params.facadeBayM || facadeArch.defaultBayM)));
  const facadeLouverM = Math.max(0.05, Math.min(1.2, Number(params.facadeLouverM || facadeArch.defaultLouverM)));
  const wwrRatio = facadeWwrPct / 100.0;

  let grossWallAreaSqm = 0;
  for (const fp of floorPlates) {
    grossWallAreaSqm += 2.0 * (fp.widthM + fp.depthM) * params.floorHeight;
  }
  const topFp = floorPlates[floorPlates.length - 1] || { widthM: baseWidthM, depthM: baseDepthM };
  const parapetAreaSqm = actualFloorsAbove ? 2.0 * (topFp.widthM + topFp.depthM) * 1.35 : 0;
  const visionGlassAreaSqm = grossWallAreaSqm * wwrRatio;
  const opaqueSpandrelAreaSqm = grossWallAreaSqm * (1.0 - wwrRatio) + parapetAreaSqm;

  const avgPerimeterM = floorPlates.length > 0 ? (grossWallAreaSqm / (actualFloorsAbove * floorHeightM)) : 0;
  const baysPerFloor = Math.max(4, Math.round(avgPerimeterM / facadeBayM));
  const totalBayModules = baysPerFloor * actualFloorsAbove;
  const louverFinAreaSqm = totalBayModules * params.floorHeight * facadeLouverM * (
    (params.facadeType === "kinetic_louver" || params.facadeType === "diagrid_biophilic") ? 1.35 : 0.35
  );

  const adjWallU = Math.max(0.115, facadeArch.wallU + (cladMat.wallUDelta || 0));
  const effectiveFacadeU = (1.0 - wwrRatio) * adjWallU + wwrRatio * facadeArch.windowU + facadeArch.psiSurcharge;
  const shadingFactor = Math.max(0.52, 1.0 - facadeLouverM * 0.42);
  const effectiveShgc = Math.max(0.15, (facadeArch.baseShgc + (glassTintObj.shgcDelta || 0)) * shadingFactor);
  const heatingLossKwh = (effectiveFacadeU * grossWallAreaSqm * 2650 * 24 / 1000.0) / Math.max(1.0, aboveGroundGfaSqm);
  const coolingSolarKwh = (visionGlassAreaSqm * effectiveShgc * 340.0) / Math.max(1.0, aboveGroundGfaSqm);
  const envelopeEuiKwh = heatingLossKwh + coolingSolarKwh;

  const wwrCostMult = (1.0 + ((facadeWwrPct - facadeArch.defaultWwrPct) * 0.0022)) * (cladMat.costMult || 1.0);
  const louverDynamicCostKrw = louverFinAreaSqm * 185000;
  const totalFacadeCostKrw = (grossWallAreaSqm + parapetAreaSqm) * facadeArch.unitCostKrwPerWallSqm * wwrCostMult + louverDynamicCostKrw;
  const totalFacadeCostEok = totalFacadeCostKrw / 1e8;
  const abovePyeong = aboveGroundGfaSqm / PYEONG_TO_SQM;
  const facadeCostPerPyeongMan = abovePyeong > 0 ? ((totalFacadeCostKrw / abovePyeong) / 10000.0) : 0;
  const embodiedCarbonTon = ((grossWallAreaSqm + parapetAreaSqm) * facadeArch.embodiedCarbonKgSqm) / 1000.0;

  // Facade costs are planning estimates. Design choice alone supplies no
  // observed rent premium; edit the rental assumption using project evidence.
  const facadeCostFactor = (1.0 + (facadeArch.constCostDeltaPct / 100.0) * 0.25 + ((facadeWwrPct - 60) * 0.0008)) * (1.0 + ((cladMat.costMult || 1.0) - 1.0) * 0.22);
  const facadeRentFactor = 1.0;

  // Financial Engine (with Parcel Merger discount, Senior/Mezz/Junior PF Tranches & LP/GP Equity Waterfall)
  const rawLandPricePyeongM = overrideLandPricePyeongM !== null ? overrideLandPricePyeongM : params.landPricePyeongM;
  const landPricePyeongM = rawLandPricePyeongM;
  const landPurchaseEok = (sitePyeong * landPricePyeongM) / 100.0;
  const acquisitionTaxEok = landPurchaseEok * 0.046;
  const totalLandCostEok = landPurchaseEok + acquisitionTaxEok;

  const belowPyeong = undergroundGfaSqm / PYEONG_TO_SQM;
  const baseCostMan = params.constCostPyeongMan * constCostFactor * facadeCostFactor;

  const aboveHardCostEok = (abovePyeong * baseCostMan * 0.92) / 10000.0;
  const belowHardCostEok = (belowPyeong * params.constCostPyeongMan * constCostFactor * 1.32) / 10000.0;
  const perimeterM = 2 * (siteWidthM + siteDepthM);
  const excavationDepthM = params.floorsBelow * 3.6;
  const retentionWallCostEok = (perimeterM * excavationDepthM * 85) / 10000.0;

  const totalHardCostEok = aboveHardCostEok + belowHardCostEok + retentionWallCostEok;
  const softCostEok = totalHardCostEok * 0.135;

  const predevMonths = 6;
  const constMonths = Math.max(14, Math.min(34, Math.round(10 + actualFloorsAbove * 0.7 + params.floorsBelow * 1.4)));
  const leaseUpMonths = 6;
  const totalMonths = predevMonths + constMonths + leaseUpMonths;

  // ② PF 대주단 트랜치(선순위 Senior 62% / 중순위 Mezz 23% / 후순위 Junior 15%) 및 가중평균 금리
  const ltcRatio = params.loanLtvPct / 100.0;
  const seniorRatePct = Number(params.loanRatePct || 5.6);
  const mezzRatePct = seniorRatePct + 1.8;
  const juniorRatePct = seniorRatePct + 3.8;
  const seniorWeight = 0.62;
  const mezzWeight = 0.23;
  const juniorWeight = 0.15;
  const weightedLoanRatePct = seniorRatePct * seniorWeight + mezzRatePct * mezzWeight + juniorRatePct * juniorWeight;
  const annualLoanRate = weightedLoanRatePct / 100.0;
  const avgDrawFactor = 0.56;

  let interestReserveEok = 0;
  let loanFeeEok = 0;
  let totalDevCostEok = 0;
  let loanAmountEok = 0;
  let equityRequiredEok = 0;

  for (let iter = 0; iter < 30; iter++) {
    totalDevCostEok = totalLandCostEok + totalHardCostEok + softCostEok + interestReserveEok + loanFeeEok;
    loanAmountEok = totalDevCostEok * ltcRatio;
    loanFeeEok = loanAmountEok * 0.015;
    interestReserveEok = loanAmountEok * annualLoanRate * (constMonths / 12.0) * avgDrawFactor;
  }
  totalDevCostEok = totalLandCostEok + totalHardCostEok + softCostEok + interestReserveEok + loanFeeEok;
  loanAmountEok = totalDevCostEok * ltcRatio;
  equityRequiredEok = totalDevCostEok - loanAmountEok;

  const seniorLoanEok = loanAmountEok * seniorWeight;
  const mezzLoanEok = loanAmountEok * mezzWeight;
  const juniorLoanEok = loanAmountEok * juniorWeight;

  const avgUseRentMult = accumFarAreaSqm > 0 ? (weightedUseRentMultSum / accumFarAreaSqm) : 1.0;
  const contractPyeong = contractAreaSqm / PYEONG_TO_SQM;
  const effectiveRentManPerPyeong = params.rentPyeongMan * rentPremiumFactor * facadeRentFactor * (0.88 + 0.12 * avgUseRentMult);
  const occupancyRate = 0.95;
  const income = (typeof window !== "undefined" ? window.AtelierFinance : null)?.calculate(params, floorPlates, {
    undergroundGfaSqm, rentPremiumFactor, facadeRentFactor,
    planner: typeof window !== "undefined" ? window.AtelierInteriorPlan : null
  });
  const annualGrossRentEok = income?.annualGrossIncomeEok ?? (contractPyeong * effectiveRentManPerPyeong * 12 * occupancyRate * 1.12) / 10000.0;
  const opexRatio = 0.18;
  const stabilizedNoiEok = income?.stabilizedNoiEok ?? annualGrossRentEok * (1 - opexRatio);
  for (const fp of floorPlates) {
    const floorIncome = income?.floorIncome.find(row => row.level === fp.level);
    if (floorIncome) {
      fp.income = floorIncome;
      fp.estMonthlyRentMan = floorIncome.scheduledMonthlyRentMan;
    }
  }

  // Interest-only PF assumption: all three tranches remain outstanding until
  // exit. This coverage ratio includes their interest; principal is paid at exit.
  const annualDebtServiceEok = seniorLoanEok * seniorRatePct / 100
    + mezzLoanEok * mezzRatePct / 100 + juniorLoanEok * juniorRatePct / 100;
  const dscr = annualDebtServiceEok > 0 ? stabilizedNoiEok / annualDebtServiceEok : NaN;

  const exitCapRate = params.capRatePct / 100.0;
  const grossExitValueEok = Math.max(0, stabilizedNoiEok) / exitCapRate;
  const sellingCostEok = grossExitValueEok * 0.015;
  const netExitValueEok = grossExitValueEok - sellingCostEok;

  const yieldOnCostPct = (stabilizedNoiEok / totalDevCostEok) * 100.0;
  const devSpreadBps = Math.round((yieldOnCostPct - params.capRatePct) * 100);

  const predevWeights = Array(predevMonths).fill(1 / predevMonths);
  const hardScurve = scurveWeights(constMonths, 6.0);

  const monthlyProjectCf = [];
  const monthlyEquityCf = [];
  const monthlyDebtDraw = [];
  const monthlyUses = [];
  const monthlyUnleveredUses = [];
  const monthlyCapitalizedFinancing = [];
  const monthlyOperatingDebtInterest = [];

  for (let m = 0; m < totalMonths; m++) {
    let useM = 0;
    let financingM = 0;
    if (m === 0) useM += totalLandCostEok * 0.90;
    else if (m === 1) useM += totalLandCostEok * 0.10;

    if (m < predevMonths) {
      useM += (softCostEok * 0.45) * predevWeights[m];
    } else if (m < predevMonths + constMonths) {
      const cIdx = m - predevMonths;
      useM += (totalHardCostEok + softCostEok * 0.55 + interestReserveEok + loanFeeEok) * hardScurve[cIdx];
      financingM = (interestReserveEok + loanFeeEok) * hardScurve[cIdx];
    }
    monthlyUses.push(useM);
    monthlyCapitalizedFinancing.push(financingM);
    monthlyUnleveredUses.push(useM - financingM);
  }

  let cumEquityFunded = 0;
  let cumEquityNet = 0;
  let peakEquityEok = 0;

  for (let m = 0; m < totalMonths; m++) {
    const useM = monthlyUses[m];
    const remainingEquityToFund = Math.max(0, equityRequiredEok - cumEquityFunded);
    const eqSpend = Math.min(useM, remainingEquityToFund);
    const debtDraw = Math.max(0, useM - eqSpend);
    cumEquityFunded += eqSpend;

    let noiM = 0;
    if (m >= predevMonths + constMonths) {
      const lIdx = m - (predevMonths + constMonths) + 1;
      const ramp = lIdx / leaseUpMonths;
      noiM = income ? window.AtelierFinance.monthlyNoiAtRamp(income, ramp) : (stabilizedNoiEok / 12.0) * ramp;
    }

    // Construction financing is already in uses. After completion its reserve
    // has ended, so pay every tranche's interest from operating cashflow.
    const operatingInterestM = m >= predevMonths + constMonths ? annualDebtServiceEok / 12 : 0;
    monthlyOperatingDebtInterest.push(operatingInterestM);
    let projCf = -monthlyUnleveredUses[m] + noiM;
    let eqCf = -eqSpend + noiM - operatingInterestM;

    if (m === totalMonths - 1) {
      projCf += netExitValueEok;
      eqCf += (netExitValueEok - loanAmountEok);
    }

    monthlyProjectCf.push(projCf);
    monthlyEquityCf.push(eqCf);
    monthlyDebtDraw.push(debtDraw);

    cumEquityNet += eqCf;
    if (-cumEquityNet > peakEquityEok) {
      peakEquityEok = -cumEquityNet;
    }
  }

  const projectXirrPct = solveXirr(monthlyProjectCf) * 100.0;
  const equityXirrPct = solveXirr(monthlyEquityCf) * 100.0;
  const npv8Eok = calcMonthlyNpv(0.08, monthlyEquityCf);

  let totalPosEq = 0;
  let totalNegEq = 0;
  for (const cf of monthlyEquityCf) {
    if (cf > 0) totalPosEq += cf;
    else totalNegEq += -cf;
  }
  const equityMultiple = totalNegEq > 0 ? totalPosEq / totalNegEq : 0;

  // ② 한국형 부동산펀드(REF/PFV) 3-Tier Equity Waterfall (LP 우선주 vs GP 보통주)
  const lpShare = Math.min(0.95, Math.max(0.50, Number(params.lpSharePct || 80) / 100.0));
  const gpShare = 1.0 - lpShare;
  const lpHurdleRate = Number(params.lpHurdlePct || 7.5) / 100.0;
  const gpPromote = Number(params.gpPromotePct || 30) / 100.0;

  // Actual contributions include operating deficits and any exit shortfall.
  // The latter assumes sponsor funding of debt shortfalls, not limited recourse.
  const actualEquityPaidInEok = totalNegEq;
  const lpPaidInEok = actualEquityPaidInEok * lpShare;
  const gpPaidInEok = actualEquityPaidInEok * gpShare;

  // Monthly waterfall: return LP capital, then GP capital, pay simple accrued
  // LP preference on unreturned capital, then split the residual with promote.
  // Every month, including a negative exit month, must reconcile to equity CF.
  const gpResidualShare = gpPromote + (1.0 - gpPromote) * gpShare;
  const lpResidualShare = 1.0 - gpResidualShare;
  const monthlyLpCf = [];
  const monthlyGpCf = [];
  let lpUnreturnedCapitalEok = 0, gpUnreturnedCapitalEok = 0;
  let lpAccruedPreferenceEok = 0, lpPreferenceAccruedTotalEok = 0;
  for (let m = 0; m < totalMonths; m++) {
    const prefM = m ? lpUnreturnedCapitalEok * lpHurdleRate / 12 : 0;
    lpAccruedPreferenceEok += prefM;
    lpPreferenceAccruedTotalEok += prefM;
    const cf = monthlyEquityCf[m];
    if (cf <= 0) {
      const lpCall = cf * lpShare, gpCall = cf - lpCall;
      monthlyLpCf.push(lpCall); monthlyGpCf.push(gpCall);
      lpUnreturnedCapitalEok -= lpCall; gpUnreturnedCapitalEok -= gpCall;
    } else {
      let available = cf;
      const lpCapital = Math.min(available, lpUnreturnedCapitalEok);
      available -= lpCapital; lpUnreturnedCapitalEok -= lpCapital;
      const gpCapital = Math.min(available, gpUnreturnedCapitalEok);
      available -= gpCapital; gpUnreturnedCapitalEok -= gpCapital;
      const lpPreference = Math.min(available, lpAccruedPreferenceEok);
      available -= lpPreference; lpAccruedPreferenceEok -= lpPreference;
      const lpDistribution = lpCapital + lpPreference + available * lpResidualShare;
      monthlyLpCf.push(lpDistribution); monthlyGpCf.push(cf - lpDistribution);
    }
  }
  const lpTotalDistEok = monthlyLpCf.reduce((sum, cf) => sum + Math.max(0, cf), 0);
  const gpTotalDistEok = monthlyGpCf.reduce((sum, cf) => sum + Math.max(0, cf), 0);
  const lpProfitEok = lpTotalDistEok - lpPaidInEok;
  const gpProfitEok = gpTotalDistEok - gpPaidInEok;
  const lpIrrPct = solveXirr(monthlyLpCf) * 100.0;
  const gpIrrPct = solveXirr(monthlyGpCf) * 100.0;
  const lpMultiple = lpPaidInEok > 0 ? (lpTotalDistEok / lpPaidInEok) : 0;
  const gpMultiple = gpPaidInEok > 0 ? (gpTotalDistEok / gpPaidInEok) : 0;

  return {
    optionCode,
    usePermission,
    siteAreaSqm,
    effectiveCadastralAreaSqm: zoningRule.cadastralAreaSqm,
    sitePyeong,
    siteWidthM,
    siteDepthM,
    parcelGeometry,
    sitePlacement: sitePlacement ? { ...sitePlacement, coordinateFrame: "source-parcel-local-xz-metres", sourceOriginWgs84: rawParcelGeometry.centerWgs84 } : null,
    siteReference: parcelGeometry ? { geographicCrs: "EPSG:4326", originWgs84: parcelGeometry.centerWgs84,
      frameRotationRad: parcelGeometry.frameRotationRad || 0, localUnits: "metres", verticalAxis: "y-up",
      projection: "local-equirectangular-approximation", surveyVerified: false } : null,
    basementPlacement,
    coreLayout,
    representation,
    buildingReview,
    structuralReference,
    regulationMode,
    parcelRegulationReview,
    effectiveRegulationInputs: { zoning: params.zoning, legalFarCapPct: params.legalFarCapPct, legalBcrCapPct: params.legalBcrCapPct, maxHeightM: params.maxHeightM },
    frontSetbackM,
    sideSetbackM,
    rearSetbackM,
    zoningRule,
    floorPlates,
    buildingHeightM,
    requestedFloorsAbove,
    actualFloorsAbove,
    northSolarApplies,
    constraints: {
      maxLegalFarSqm,
      maxResidentialFarSqm,
      minNonResidentialRatio,
      residentialGfaSqm: generated.residentialSqm,
      nonResidentialGfaSqm: generated.nonResidentialSqm,
      maxHeightM,
      minStudyDimensionM,
      stopReason: generated.stopReason,
      unconstrainedFarAreaSqm,
      unconstrainedFloorsAbove,
      unconstrainedParkingCount: unconstrainedParking.legalParkingCount,
      parkingReducedAreaSqm,
      parkingMode: params.parkingMode === "report" ? "report" : "fit",
      parkingFitEligible,
      parkingFitDeferred,
      warnings: massWarnings
    },
    areas: {
      siteAreaSqm,
      buildingFootprintSqm,
      achievedBcrPct,
      typicalFloorSqm,
      farCountedGfaSqm,
      achievedFarPct,
      aboveGroundGfaSqm,
      undergroundGfaSqm,
      basementPlateSqm,
      totalGfaSqm,
      netAreaSqm,
      netEfficiencyPct: netEfficiencyBase * 100,
      supplyAreaSqm,
      contractAreaSqm
    },
    parking: {
      ...parking,
      capacityCount: parkingCapacityCount,
      areaEstimateCount: parkingAreaEstimate,
      layout: parkingLayout,
      capacityIsEstimate: true,
      sqmPerParkingUnit,
      legalParkingCount,
      plannedParkingCount,
      disabledParkingCount,
      evChargerFastSlow
    },
    egress: buildingReview?.egress || { stairType: "용도·거실면적별 확인 필요", stairCount: null,
      maxTravelDistM: null, status: "unverified", isPermitConfirmation: false },
    facade: {
      key: facadeArch.key,
      nameKr: facadeArch.nameKr,
      shortKr: facadeArch.shortKr,
      bestForKr: facadeArch.bestForKr,
      claddingKey: cladMat.key,
      claddingNameKr: cladMat.nameKr,
      claddingShortKr: cladMat.shortKr,
      colorNameKr: accentObj ? accentObj.nameKr : "시그니처 기본색(Auto)",
      glassNameKr: glassTintObj ? glassTintObj.nameKr : "기본 로이유리",
      podiumNameKr: podiumObj ? podiumObj.nameKr : "통유리 쇼윈도",
      wwrPct: facadeWwrPct,
      bayWidthM: facadeBayM,
      louverDepthM: facadeLouverM,
      baysPerFloor,
      totalBayModules,
      grossWallAreaSqm,
      visionGlassAreaSqm,
      opaqueSpandrelAreaSqm,
      louverFinAreaSqm,
      wallU: adjWallU,
      windowU: facadeArch.windowU,
      effectiveFacadeU,
      effectiveShgc,
      vltPct: facadeArch.vltPct,
      fireGrade: facadeArch.fireGrade,
      envelopeEuiKwh,
      totalFacadeCostEok,
      facadeCostPerPyeongMan,
      constCostDeltaPct: facadeArch.constCostDeltaPct,
      rentPremiumPct: 0,
      marketPremiumVerified: false,
      envelopePerformanceVerified: false,
      embodiedCarbonTon
    },
    finance: {
      income,
      financeMode: income?.mode || "rental",
      annualGrossIncomeEok: annualGrossRentEok,
      landPricePyeongM,
      landPurchaseEok,
      acquisitionTaxEok,
      totalLandCostEok,
      aboveHardCostEok,
      belowHardCostEok,
      retentionWallCostEok,
      totalHardCostEok,
      softCostEok,
      interestReserveEok,
      loanFeeEok,
      totalDevCostEok,
      loanAmountEok,
      seniorLoanEok,
      mezzLoanEok,
      juniorLoanEok,
      seniorRatePct,
      mezzRatePct,
      juniorRatePct,
      weightedLoanRatePct,
      annualDebtServiceEok,
      debtServiceBasis: "all-tranches-interest-only-until-exit",
      constructionInterestBasis: "assumed-56pct-average-draw-during-construction",
      exitShortfallBasis: "additional-sponsor-equity-assumption",
      dscr,
      equityRequiredEok,
      actualEquityPaidInEok,
      peakEquityEok,
      stabilizedNoiEok,
      grossExitValueEok,
      netExitValueEok,
      yieldOnCostPct,
      devSpreadBps,
      projectXirrPct,
      equityXirrPct,
      npv8Eok,
      equityMultiple,
      lpSharePct: lpShare * 100,
      gpSharePct: gpShare * 100,
      lpHurdlePct: lpHurdleRate * 100,
      gpPromotePct: gpPromote * 100,
      lpPaidInEok,
      gpPaidInEok,
      lpTotalDistEok,
      gpTotalDistEok,
      lpProfitEok,
      gpProfitEok,
      lpIrrPct,
      gpIrrPct,
      lpMultiple,
      gpMultiple,
      predevMonths,
      constMonths,
      leaseUpMonths,
      totalMonths,
      monthlyProjectCf,
      monthlyEquityCf,
      monthlyLpCf,
      monthlyGpCf,
      monthlyDebtDraw,
      monthlyUses,
      monthlyUnleveredUses,
      monthlyCapitalizedFinancing,
      monthlyOperatingDebtInterest,
      // View aliases for the existing calculations used by tables and exports.
      tranches: {
        seniorLoanEok,
        mezzLoanEok,
        juniorLoanEok,
        seniorRatePct,
        mezzRatePct,
        juniorRatePct,
        weightedDebtRatePct: weightedLoanRatePct
      },
      waterfall: {
        lpSharePct: lpShare * 100,
        gpSharePct: gpShare * 100,
        lpHurdlePct: lpHurdleRate * 100,
        gpPromotePct: gpPromote * 100,
        lpEquityEok: lpPaidInEok,
        gpEquityEok: gpPaidInEok,
        lpTotalDistEok,
        gpTotalDistEok,
        lpProfitEok,
        gpProfitEok,
        lpIrrPct,
        gpIrrPct,
        lpMultiple,
        gpMultiple,
        lpPreferenceAccruedTotalEok,
        lpUnpaidPreferenceEok: lpAccruedPreferenceEok,
        preferenceBasis: "simple-monthly-on-unreturned-lp-capital"
      }
    }
  };
}

function solveMaxResidualLandPrice(params) {
  const targetIrr = Number(params.targetIrrPct);
  const unavailable = (status, reason) => ({ maxLandPyeongM: NaN, maxLandTotalEok: NaN, status, reason, targetIrrPct: targetIrr, method: "target-equity-npv" });
  if (!Number.isFinite(targetIrr) || targetIrr <= -100) return unavailable("unavailable", "목표 할인율을 계산할 수 없습니다.");
  const atPrice = price => {
    const model = evaluateDesignAndProforma(params, params.option, price);
    return { model, npv: calcMonthlyNpv(targetIrr / 100, model.finance.monthlyEquityCf) };
  };
  let low = 0, high = Math.max(600, (Number(params.landPricePyeongM) || 0) * 2);
  const lower = atPrice(low);
  if (!Number.isFinite(lower.npv)) return unavailable("unavailable", "월별 자기자본 현금흐름을 계산할 수 없습니다.");
  if (lower.npv < 0) return unavailable("infeasible", "토지가를 0으로 가정해도 목표 할인율에서 자기자본 NPV가 음수입니다.");
  const sitePyeong = lower.model.sitePyeong;
  if (!Number.isFinite(sitePyeong) || sitePyeong <= 0) return unavailable("unavailable", "토지 면적을 계산할 수 없습니다.");
  if (lower.npv === 0) return { maxLandPyeongM: 0, maxLandTotalEok: 0, status: "solved", targetNpvEok: 0, targetIrrPct: targetIrr, method: "target-equity-npv" };
  let upper = atPrice(high);
  for (let i = 0; i < 12 && Number.isFinite(upper.npv) && upper.npv >= 0; i++) {
    high *= 2;
    upper = atPrice(high);
  }
  if (!Number.isFinite(upper.npv)) return unavailable("unavailable", "토지 가격 탐색 중 유효한 현금흐름 구간을 찾지 못했습니다.");
  if (upper.npv >= 0) return unavailable("unbounded", "탐색 범위에서 목표 NPV의 부호가 바뀌는 토지 가격 상한을 찾지 못했습니다.");
  // Solve NPV at the target return directly. This does not rely on IRR
  // existing or on its numerical solver selecting a particular root.
  for (let i = 0; i < 48; i++) {
    const mid = (low + high) / 2;
    const candidate = atPrice(mid);
    if (!Number.isFinite(candidate.npv)) return unavailable("unavailable", "토지 가격 탐색 중 현금흐름 계산이 불가능합니다.");
    if (candidate.npv >= 0) low = mid;
    else high = mid;
  }
  const maxLandPyeongM = low;
  const maxLandTotalEok = (sitePyeong * maxLandPyeongM) / 100.0;
  return { maxLandPyeongM, maxLandTotalEok, status: "solved", targetNpvEok: atPrice(low).npv, targetIrrPct: targetIrr, method: "target-equity-npv" };
}

// ============================================================================
// 4. THREE.JS HIGH-DETAIL ARCHITECTURAL 3D SCENE RENDERER (WITH BIM CLIPPING, DIMENSIONS & RAYCAST INSPECTOR)
// ============================================================================
let scene, camera, renderer, controls, sunLight, groundMesh, gridHelper;
let buildingGroup, contextGroup, envelopeGroup, dimensionGroup, surroundingBuildingsGroup;
let siteContextGeneration = 0, sceneParcelSignature = null, sceneFitExtent = null;

function siteContextHud() {
  let hud = document.getElementById("siteContextHud");
  if (!hud) {
    const stage = document.getElementById("threeStage");
    if (!stage) return null;
    hud = document.createElement("div"); hud.id = "siteContextHud";
    hud.className = "site-context-hud"; hud.setAttribute("aria-live", "polite"); stage.append(hud);
  }
  return hud;
}

function renderSiteContextStatus(model, data, error) {
  const hud = siteContextHud(); if (!hud) return;
  hud.hidden = !model.parcelGeometry;
  if (hud.hidden) return;
  const geo = model.parcelGeometry;
  const strong = document.createElement("strong"); strong.textContent = "실제 지적도 · 매스 배치";
  const note = document.createElement("span");
  const layers = data?.layers || [];
  note.textContent = error ? `주변 자료 조회 실패 · ${error.message || "다시 조회해 주세요"}` : data
    ? `지적 경계 ${data.parcels?.features?.length || 0}개 · 도로선 ${data.roads?.features?.length || 0}개 · 계획도로 ${data.plannedRoads?.features?.length || 0}개`
    : "주변 지적도와 도로 자료를 불러오고 있습니다.";
  const detail = document.createElement("small");
  detail.textContent = `${geo.featureCount}개 필지 · 북향 기준 ${Math.abs((geo.frameRotationRad || 0) * 180 / Math.PI).toFixed(1)}° 배치 · 도로선은 폭·건축선을 확정하지 않습니다.`;
  const metadata = document.createElement("details"), metadataTitle = document.createElement("summary");
  metadataTitle.textContent = "배치 기준 · 범례 · 출처"; metadata.append(metadataTitle, detail);
  hud.replaceChildren(strong, note);
  const mass = document.createElement("small");
  mass.textContent = `건축면적 ${model.areas.buildingFootprintSqm.toFixed(1)}㎡ · 건폐 ${model.areas.achievedBcrPct.toFixed(1)}% / 적용 ${model.zoningRule.maxBcr}% · ${model.actualFloorsAbove}층`;
  hud.append(mass);
  const density = document.createElement("small");
  density.textContent = `${model.regulationMode === "scenario" ? "비교 조건" : "법령 기준"} · 용적 ${model.areas.achievedFarPct.toFixed(1)}% / 적용 상한 ${model.zoningRule.maxFar}% · `
    + (model.parcelRegulationReview?.planLimitsApplied ? "확인 고시 반영" : "개별 고시 상한 미확인");
  hud.append(density);
  const scope = document.createElement("small");
  scope.textContent = `${model.representation?.detailLevel === "massing" ? "간략 매스 · 상세 코어·구조 미표시" : "개념 상세 · 구조 계산 미검증"} · ${model.buildingReview?.egress?.stairType || "피난 조건 확인 필요"}`;
  hud.append(scope);
  const manual = model.parcelRegulationReview?.manualLimits;
  if (model.regulationMode === "scenario" && manual?.bcrPct && manual.bcrPct < Number(state.targetBcr)) {
    const cap = document.createElement("b");
    cap.textContent = `사용자 건폐율 제한 ${manual.bcrPct}% 적용 중 · 대지·법규에서 추가 제한을 확인하세요.`;
    hud.append(cap);
  }
  if (model.coreLayout?.status === "unfeasible" || model.constraints.parkingFitDeferred) {
    const pending = document.createElement("b");
    pending.textContent = [model.coreLayout?.status === "unfeasible" ? "공통 코어 배치 미완료" : "",
      model.constraints.parkingFitDeferred ? "주차 미확보 · 자동 축소 보류" : ""].filter(Boolean).join(" · ");
    hud.append(pending);
  }
  const limits = document.createElement("small");
  limits.textContent = `계산 상한 · 건폐 ${model.zoningRule.maxBcr}% · 용적 ${model.zoningRule.maxFar}%${model.constraints.maxHeightM > 0 ? ` · 높이 ${model.constraints.maxHeightM}m` : ""} · ${model.actualFloorsAbove}/${model.requestedFloorsAbove}층`;
  metadata.append(limits);
  const views = document.createElement("div"); views.className = "site-context-views";
  for (const [label, top] of [["지적 배치도", true], ["입체 매스", false]]) {
    const button = document.createElement("button"); button.className = "btn"; button.type = "button"; button.textContent = label;
    button.addEventListener("click", () => fitCameraToSite(model, top)); views.append(button);
  }
  hud.append(views, metadata);
  if (data) {
    const source = document.createElement("a"); source.href = "https://www.vworld.kr/"; source.target = "_blank"; source.rel = "noopener noreferrer"; source.textContent = "VWorld 공간정보 ↗";
    const legend = document.createElement("small"); legend.textContent = "실선 지적경계 · 짧은 점선 현황 도로선 · 긴 점선 계획도로 · 회색 면은 지적도상 ‘도’ 표기";
    metadata.append(legend, source);
    const warnings = layers.filter(layer => layer.status === "unavailable" || layer.status === "partial");
    if (warnings.length) { const status = document.createElement("small"); status.textContent = `일부 자료 미완료: ${warnings.map(layer => layer.title).join(" · ")}`; hud.append(status); }
  }
  if (!data && (error || !geo.pnus.length)) {
    const retry = document.createElement("button"); retry.className = "btn"; retry.type = "button"; retry.textContent = "주변 자료 다시 조회";
    retry.disabled = !geo.pnus.length; retry.addEventListener("click", () => refreshSiteContext(model, true)); hud.append(retry);
  }
  if (!model.floorPlates.length) {
    const empty = document.createElement("b"); empty.textContent = `매스 생성 없음 · 건폐 상한 ${model.zoningRule.maxBcr}% / 용적 상한 ${model.zoningRule.maxFar}% · 입력 이격·높이·주차 조건 확인`;
    hud.append(empty);
  }
}

function refreshSiteContext(model, force = false) {
  const token = ++siteContextGeneration;
  const previous = contextGroup?.getObjectByName("real-site-context");
  if (previous) { window.AtelierSiteContext?.dispose(previous); clearGroup(previous); contextGroup.remove(previous); }
  renderSiteContextStatus(model, null, null);
  if (!model.parcelGeometry || !window.AtelierSiteContext) return;
  const geo = model.parcelGeometry, pnus = [...new Set(geo.pnus)];
  if (!pnus.length) { renderSiteContextStatus(model, null, new Error("파일 경계에 지번 식별정보가 없어 주변 자료를 조회할 수 없습니다.")); return; }
  window.AtelierStudyReviewSnapshot?.recordSiteContext(model, { status: "loading", data: null, requestedAt: new Date().toISOString() });
  const group = new THREE.Group(); group.name = "real-site-context"; contextGroup.add(group);
  window.AtelierSiteContext.fetchContext(pnus, { force }).then(data => {
    if (token !== siteContextGeneration || !group.parent) return;
    window.AtelierStudyReviewSnapshot?.recordSiteContext(model, { status: "retrieved", data, fetchedAt: new Date().toISOString() });
    window.AtelierSiteContext.render({ THREE, group, data, centerWgs84: geo.centerWgs84,
      frameRotationRad: geo.frameRotationRad || 0, projection: geo.projection,
      selectedPnus: pnus, palette: { ...ATELIER_PALETTE, contextEdge: 0x8a877e, road: 0x646d65 }, daylight: state.daylightTheme });
    const roadNames = new Map();
    for (const feature of data.roads?.features || []) {
      const name = feature.properties?.name;
      if (typeof name !== "string" || !name.trim()) continue;
      const clipped = window.AtelierSiteContext.clipFeature(feature, data.bbox); if (!clipped) continue;
      const projected = window.AtelierSiteContext.projectFeature(clipped, geo.centerWgs84, geo.frameRotationRad || 0, geo.projection);
      if (!["LineString", "MultiLineString"].includes(projected.geometry.type)) continue;
      const lines = projected.geometry.type === "LineString" ? [projected.geometry.coordinates] : projected.geometry.coordinates;
      for (const line of lines) for (let i = 1; i < line.length; i++) {
        const x = (line[i-1][0] + line[i][0]) / 2, z = (line[i-1][1] + line[i][1]) / 2, distance = Math.hypot(x,z);
        if (!roadNames.has(name) || distance < roadNames.get(name).distance) roadNames.set(name, { name, x, z, distance });
      }
    }
    for (const road of [...roadNames.values()].sort((a,b) => a.distance-b.distance).slice(0,4)) {
      const label = create3DTextSprite(road.name, "rgba(245,243,238,.92)", "#465648", "#b4b9aa");
      label.material.depthTest = true;
      label.position.set(road.x, 1.4, road.z); label.scale.set(28, 6.1, 1); group.add(label);
    }
    renderSiteContextStatus(model, data, null);
  }).catch(error => { if (token === siteContextGeneration) {
    window.AtelierStudyReviewSnapshot?.recordSiteContext(model, { status: "failed", data: null, fetchedAt: new Date().toISOString() });
    renderSiteContextStatus(model, null, error);
  } });
}

function fitCameraToSite(model = state.lastComputed?.model, topDown = false) {
  if (!model || !camera || !controls) return;
  const points = model.parcelGeometry?.outlines.flat(2) || [[-model.siteWidthM / 2, -model.siteDepthM / 2], [model.siteWidthM / 2, model.siteDepthM / 2]];
  const xs = points.map(p => p[0]), zs = points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const h = Math.max(1, model.buildingHeightM), span = Math.max(maxX - minX, maxZ - minZ, h, 20);
  const target = new THREE.Vector3((minX + maxX) / 2, h * .32, (minZ + maxZ) / 2);
  const verticalFov = camera.fov * Math.PI / 180, horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const distance = span * .85 / Math.tan(Math.min(verticalFov, horizontalFov) / 2);
  camera.position.copy(target.clone().add((topDown ? new THREE.Vector3(0, 1, .0001) : new THREE.Vector3(1, .92, 1)).normalize().multiplyScalar(distance)));
  controls.target.copy(target); controls.maxDistance = Math.max(600, distance * 3); camera.far = Math.max(3000, distance * 6); camera.updateProjectionMatrix(); controls.update();
}
let globalClipPlane = null;
let raycaster = null;
let pointerDownPos = { x: 0, y: 0 };
let stageResizeObserver = null;

function initThreeScene() {
  const canvas = document.getElementById("threeCanvas");
  const stage = document.getElementById("threeStage");
  if (!canvas || !stage || typeof THREE === "undefined" || typeof THREE.OrbitControls !== "function") {
    throw new Error("The 3D viewer could not load its rendering libraries.");
  }
  const stageWidth = Math.max(1, stage.clientWidth);
  const stageHeight = Math.max(1, stage.clientHeight);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(ATELIER_PALETTE.paper);
  scene.fog = new THREE.FogExp2(ATELIER_PALETTE.paper, 0.0014);

  camera = new THREE.PerspectiveCamera(42, stageWidth / stageHeight, 0.08, 2000);
  camera.position.set(82, 74, 92);

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true
  });
  renderer.setSize(stageWidth, stageHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;

  globalClipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 500);
  raycaster = new THREE.Raycaster();

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.target.set(0, 24, 0);

  const hemiLight = new THREE.HemisphereLight(ATELIER_PALETTE.skyLight, ATELIER_PALETTE.bounceLight, 0.78);
  scene.add(hemiLight);

  sunLight = new THREE.DirectionalLight(ATELIER_PALETTE.sunlight, 1.05);
  sunLight.position.set(50, 105, 70);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.bias = -0.00015;
  sunLight.shadow.normalBias = 0.045;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 360;
  const d = 115;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  scene.add(sunLight);

  const groundGeo = new THREE.PlaneGeometry(560, 560);
  const groundMat = new THREE.MeshStandardMaterial({
    color: ATELIER_PALETTE.ground,
    roughness: 0.9,
    metalness: 0.05
  });
  groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = -0.06;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  gridHelper = new THREE.GridHelper(340, 68, ATELIER_PALETTE.gridMajor, ATELIER_PALETTE.gridMinor);
  gridHelper.position.y = 0.01;
  scene.add(gridHelper);

  buildingGroup = new THREE.Group();
  contextGroup = new THREE.Group();
  envelopeGroup = new THREE.Group();
  dimensionGroup = new THREE.Group();
  scene.add(buildingGroup);
  scene.add(contextGroup);
  scene.add(envelopeGroup);
  scene.add(dimensionGroup);

  // Interactive 3D Floor Raycast Click Handler
  canvas.addEventListener("pointerdown", (e) => {
    pointerDownPos = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener("pointerup", (e) => {
    const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
    if (dist > 6) return; // Ignore camera orbit drags
    handle3DFloorClick(e);
  });

  window.addEventListener("resize", onWindowResize);
  if (typeof ResizeObserver !== "undefined") {
    stageResizeObserver = new ResizeObserver(onWindowResize);
    stageResizeObserver.observe(stage);
  }
  animateThree();
}

function handle3DFloorClick(event) {
  const canvas = document.getElementById("threeCanvas");
  if (!canvas || !raycaster || !camera || !buildingGroup || !buildingGroup.visible || !state.lastComputed) return;

  const rect = canvas.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(buildingGroup.children, true);

  let hitLevel = null;
  for (const hit of intersects) {
    if (globalClipPlane && state.clipPlanePct < 100 && hit.point.y > globalClipPlane.constant) {
      continue;
    }
    if (hit.object && hit.object.userData && hit.object.userData.isInspectableFloor) {
      hitLevel = hit.object.userData.level;
      break;
    }
  }

  if (hitLevel !== null) {
    state.selectedFloorLevel = hitLevel;
    rebuild3DScene(state.lastComputed.model);
    renderFloorInspectorCard(state.lastComputed.model);
    window.dispatchEvent(new CustomEvent("atelier:floor-selected", { detail: { level: hitLevel } }));
  }
}

function renderFloorInspectorCard(model) {
  const card = document.getElementById("floorInspectorCard");
  if (!card) return;
  if (state.selectedFloorLevel === null || !model) {
    card.classList.add("hidden");
    return;
  }

  const lvl = state.selectedFloorLevel;
  card.classList.remove("hidden");
  const interiorButton = document.getElementById("btnInspectInterior");
  if (interiorButton) {
    interiorButton.hidden = lvl < 1;
    interiorButton.disabled = model.representation?.detailLevel === "massing" || !model.floorPlates.some(fp => fp.level === lvl);
  }

  const useLabels = {
    retail: "리테일·상업 (임대 계획 가정)",
    main: "기준 업무·오피스 (1.00x)",
    residential: "주거·오피스텔 (계획 가정)",
    hotel: "호텔 객실 (계획 가정)",
    amenity: "스카이라운지·어메니티 (임대 계획 가정)"
  };

  const titleEl = document.getElementById("inspTitle");
  const gridEl = document.getElementById("inspSpecGrid");

  if (lvl < 0) {
    const bLvl = Math.abs(lvl);
    if (bLvl > Number(state.floorsBelow)) { card.classList.add("hidden"); return; }
    const bAreaSqm = model.areas.undergroundGfaSqm / Math.max(1, state.floorsBelow);
    const bPyeong = bAreaSqm / PYEONG_TO_SQM;
    const parkedLevel = model.parking.layout?.levels?.find(level => level.level === lvl);
    const parkingText = parkedLevel ? `${parkedLevel.spaces.length}면 · 개념 배치` : "배치 미완료 · 수용량 미확정";
    if (titleEl) titleEl.textContent = `LEVEL B${bLvl}F · 지하주차·기계실`;
    if (gridEl) {
      gridEl.innerHTML = `
        <div class="inspector-spec-item"><span>설계 레벨</span><strong>GL ${(lvl * 3.5).toFixed(1)}m ~ ${((lvl + 1) * 3.5).toFixed(1)}m</strong></div>
        <div class="inspector-spec-item"><span>바닥 면적</span><strong>${fmtInt(bAreaSqm)} ㎡ (${fmtInt(bPyeong)}평)</strong></div>
        <div class="inspector-spec-item"><span>주차 초안</span><strong>${parkingText}</strong></div>
        <div class="inspector-spec-item"><span>전체 지하 직접공사비</span><strong>${fmtDec(model.finance.belowHardCostEok)}억 · 흙막이 별도</strong></div>
      `;
    }
    document.querySelectorAll("#inspUsePills .inspector-use-btn").forEach(btn => btn.classList.remove("active"));
    return;
  }

  const fp = model.floorPlates.find(f => f.level === lvl);
  if (!fp) { card.classList.add("hidden"); return; }

  const floorPyeong = fp.areaSqm / PYEONG_TO_SQM;
  const netSqm = fp.areaSqm * (model.areas.netEfficiencyPct / 100);
  const netPyeong = netSqm / PYEONG_TO_SQM;
  const floorIncome = fp.income;
  const monthlyRentMan = floorIncome?.monthlyGrossIncomeMan ?? fp.estMonthlyRentMan;
  const incomeLabel = floorIncome?.hotelOperatingFloor ? "호텔 연평균 수입" : "임대·부가 수입 (점유 반영)";
  const incomeBasis = floorIncome?.hotelOperatingFloor
    ? `객실 ${Number(floorIncome.generatedGuestRooms || 0)}실 · 운영 모드`
    : `검토 계약면적 ${fmtInt(floorIncome?.rentalContractAreaSqm ?? fp.areaSqm)}㎡ · 전용면적과 구분`;

  if (titleEl) titleEl.textContent = `LEVEL ${fp.level}F · ${useLabels[fp.use] || "업무시설"}`;
  if (gridEl) {
    gridEl.innerHTML = `
      <div class="inspector-spec-item"><span>표고 / 층고</span><strong>EL +${fp.zBottom.toFixed(1)}m (${state.floorHeight.toFixed(1)}m)</strong></div>
      <div class="inspector-spec-item"><span>바닥면적(GFA)</span><strong>${fmtInt(fp.areaSqm)} ㎡ (${fmtInt(floorPyeong)}평)</strong></div>
      <div class="inspector-spec-item"><span>전용면적 (사업성 가정)</span><strong>${fmtInt(netSqm)} ㎡ (${fmtInt(netPyeong)}평)</strong></div>
      <div class="inspector-spec-item"><span>${incomeLabel}</span><strong>월 ${(monthlyRentMan / 100).toFixed(1)}백만 (연 ${(monthlyRentMan * 12 / 10000).toFixed(2)}억)</strong></div>
      <div class="inspector-spec-item"><span>수입 산정 기준</span><strong>${incomeBasis}</strong></div>
      <div class="inspector-spec-item"><span>평면 모듈</span><strong>${fp.widthM.toFixed(1)}m × ${fp.depthM.toFixed(1)}m</strong></div>
      <div class="inspector-spec-item"><span>외장 사양</span><strong>${model.facade.claddingShortKr} · ${model.facade.colorNameKr}</strong></div>
    `;
  }

  document.querySelectorAll("#inspUsePills .inspector-use-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.flooruse === fp.use);
  });
}

function create3DTextSprite(text, bgColor = "rgba(245, 243, 238, 0.94)", textColor = "#424439", borderColor = "#aaa08d") {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 112;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = bgColor;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(8, 8, 496, 96, 18);
  ctx.fill();
  ctx.stroke();

  ctx.font = "700 32px 'JetBrains Mono', 'SUIT Variable', sans-serif";
  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 56);

  const tex = new THREE.CanvasTexture(canvas);
  tex.encoding = THREE.sRGBEncoding;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false, fog: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(16, 3.5, 1);
  return sprite;
}

function applyStudioThemeToScene() {
  if (!scene || !groundMesh) return;
  if (state.daylightTheme) {
    scene.background = new THREE.Color(ATELIER_PALETTE.paper);
    scene.fog = new THREE.FogExp2(ATELIER_PALETTE.paper, 0.0014);
    groundMesh.material.color.setHex(ATELIER_PALETTE.ground);
    if (sunLight) sunLight.intensity = 1.05;
    gridHelper.visible = true;
    gridHelper.material.opacity = 0.18;
    gridHelper.material.transparent = true;
  } else {
    scene.background = new THREE.Color(ATELIER_PALETTE.night);
    scene.fog = new THREE.FogExp2(ATELIER_PALETTE.night, 0.0020);
    groundMesh.material.color.setHex(ATELIER_PALETTE.nightGround);
    if (sunLight) sunLight.intensity = 0.62;
    gridHelper.visible = true;
    gridHelper.material.opacity = 0.12;
    gridHelper.material.transparent = true;
  }
}

function onWindowResize() {
  const stage = document.getElementById("threeStage");
  if (!stage || !renderer || !camera) return;
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (width <= 0 || height <= 0) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function updateSunPosition(hour, frameRotationRad = state.lastComputed?.model?.parcelGeometry?.frameRotationRad || 0) {
  if (!sunLight) return;
  const angleFromNoon = ((hour - 12.5) / 4.5) * (Math.PI / 3);
  const altitude = Math.max(0.22, Math.cos(angleFromNoon) * 0.58);
  const radius = 125;
  const x = Math.sin(angleFromNoon) * radius;
  const y = Math.sin(altitude) * radius;
  const z = Math.cos(angleFromNoon) * radius * 0.85;
  sunLight.position.set(x * Math.cos(frameRotationRad) + z * Math.sin(frameRotationRad), y,
    -x * Math.sin(frameRotationRad) + z * Math.cos(frameRotationRad));
}

function clearGroup(group) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  const collect = obj => {
    if (obj.geometry) geometries.add(obj.geometry);
    (Array.isArray(obj.material) ? obj.material : [obj.material]).filter(Boolean).forEach(material => {
      materials.add(material);
      for (const key of ["map", "bumpMap", "normalMap", "roughnessMap", "metalnessMap", "alphaMap", "emissiveMap", "aoMap", "lightMap", "envMap"]) {
        const texture = material[key];
        if (texture && !texture.userData?.atelierShared) textures.add(texture);
      }
    });
  };
  while (group.children.length > 0) {
    const obj = group.children[0];
    group.remove(obj);
    if (obj.traverse) obj.traverse(collect); else collect(obj);
  }
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  textures.forEach(texture => texture.dispose());
}

function getFacadeColorMode() {
  return document.body?.classList?.contains("dashboard-site") && state.facadeColorMode === "realistic" ? "realistic" : "atelier";
}

function syncSurroundingBuildingsUI() {
  const shown = state.showSurroundingBuildings !== false;
  document.querySelectorAll("[data-context-buildings-toggle]").forEach(button => {
    button.textContent = shown ? "주변 건물 숨기기" : "주변 건물 보기";
    button.setAttribute("aria-pressed", String(shown));
    button.disabled = state.viewMode === "xray";
    button.title = state.viewMode === "xray" ? "구조 보기에서는 주변 건물이 표시되지 않습니다." : "주변 배경 건물만 켜거나 끕니다.";
  });
}

function setSurroundingBuildingsVisible(shown) {
  state.showSurroundingBuildings = Boolean(shown);
  if (surroundingBuildingsGroup) surroundingBuildingsGroup.visible = state.showSurroundingBuildings;
  syncSurroundingBuildingsUI();
  window.AtelierWorkspace?.save();
}

function syncFacadeColorUI() {
  const mode = getFacadeColorMode(), realistic = mode === "realistic";
  document.querySelectorAll("[data-facade-color-toggle]").forEach(button => {
    button.textContent = realistic ? "아뜰리에 톤으로" : "실제 색감 보기";
    button.setAttribute("aria-pressed", String(realistic));
    button.disabled = !window.AtelierMaterials;
  });
  document.querySelectorAll("[data-facade-color-status]").forEach(label => {
    label.textContent = realistic ? "실제 재료 색감 · 참고 표현" : "아뜰리에 톤";
  });
  if (document.body?.dataset) document.body.dataset.facadeColorMode = mode;
}

function setFacadeColorMode(mode) {
  const next = mode === "realistic" ? "realistic" : "atelier";
  if (state.facadeColorMode === next) { syncFacadeColorUI(); return; }
  state.facadeColorMode = next;
  syncFacadeColorUI();
  if (state.lastComputed?.model) rebuild3DScene(state.lastComputed.model);
  window.dispatchEvent(new CustomEvent("atelier:appearance", { detail: { mode: getFacadeColorMode() } }));
}

function updateFacadeDetailView() {
  syncFacadeUI();
  if (state.lastComputed?.model) rebuild3DScene(state.lastComputed.model);
  window.AtelierWorkspace?.save();
  window.dispatchEvent(new CustomEvent("atelier:appearance", { detail: { mode: getFacadeColorMode() } }));
}

function getFacadeAppearance() {
  return window.AtelierMaterials?.resolveAppearance({
    materialKey: state.claddingMaterial, mode: getFacadeColorMode(),
    facadeType: state.facadeType, accentKey: state.facadeAccent,
    glassTintKey: state.glassTint, isDay: state.daylightTheme
  }) || null;
}

let facadeEnvironment = null;
function getFacadeEnvironmentMap() {
  if (!facadeEnvironment && renderer && window.AtelierMaterials?.createEnvironmentMap) {
    facadeEnvironment = window.AtelierMaterials.createEnvironmentMap(THREE, renderer);
  }
  return facadeEnvironment?.texture || null;
}

// Texture coordinates are in metres on each elevation, so a brick or panel
// keeps its scale on narrow piers and long spandrels alike.
function applyWorldFacadeUvs(geometry) {
  const position = geometry.attributes?.position, normal = geometry.attributes?.normal, uv = geometry.attributes?.uv;
  if (!position || !normal || !uv) return geometry;
  for (let i = 0; i < position.count; i++) {
    const nx = Math.abs(normal.getX(i)), ny = Math.abs(normal.getY(i)), nz = Math.abs(normal.getZ(i));
    if (ny > nx && ny > nz) uv.setXY(i, position.getX(i), position.getZ(i));
    else if (nx > nz) uv.setXY(i, position.getZ(i), position.getY(i));
    else uv.setXY(i, position.getX(i), position.getY(i));
  }
  uv.needsUpdate = true;
  return geometry;
}

function addFacadePanelMeshes(parent, panels, material, level = null) {
  // Equal panels share one geometry and GPU draw call on each pair of faces.
  const batches = new Map();
  panels.forEach(panel => {
    const key = panel.size.map(value => value.toFixed(6)).join(":");
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(panel);
  });
  for (const batch of batches.values()) {
    const geometry = applyWorldFacadeUvs(new THREE.BoxGeometry(...batch[0].size));
    const mesh = new THREE.InstancedMesh(geometry, material, batch.length);
    const transform = new THREE.Matrix4();
    batch.forEach((panel, index) => {
      transform.makeTranslation(...panel.position);
      mesh.setMatrixAt(index, transform);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData = { isInspectableFloor: level !== null, level, elementType: "facade-panel" };
    parent.add(mesh);
  }
}

const claddingTextureCache = new Map();

function getProceduralCladdingTexture(materialKey, baseHex) {
  const cacheKey = `${materialKey}_${baseHex}`;
  if (claddingTextureCache.has(cacheKey)) {
    return claddingTextureCache.get(cacheKey);
  }

  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  const r = (baseHex >> 16) & 255;
  const g = (baseHex >> 8) & 255;
  const b = baseHex & 255;
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, 256, 256);

  if (materialKey === "terracotta_brick") {
    // Running-bond brick courses with mortar joints & subtle kiln color variation
    const rows = 8;
    const cols = 4;
    const rowH = 256 / rows;
    const colW = 256 / cols;
    ctx.strokeStyle = "rgba(235, 228, 218, 0.72)";
    ctx.lineWidth = 3.2;

    for (let row = 0; row < rows; row++) {
      const y = row * rowH;
      const offset = (row % 2 === 1) ? colW * 0.5 : 0;
      for (let col = -1; col <= cols; col++) {
        const x = col * colW + offset;
        const delta = ((row * 7 + col * 13) % 5 - 2) * 8;
        const br = Math.min(255, Math.max(0, r + delta));
        const bg = Math.min(255, Math.max(0, g + delta * 0.7));
        const bb = Math.min(255, Math.max(0, b + delta * 0.5));
        ctx.fillStyle = `rgb(${br},${bg},${bb})`;
        ctx.fillRect(x + 2, y + 2, colW - 4, rowH - 4);
        ctx.strokeRect(x, y, colW, rowH);
      }
    }
  } else if (materialKey === "limestone") {
    // Warm European limestone ashlar stone blocks & fine sedimentary lines
    const rows = 4;
    const cols = 2;
    const rowH = 256 / rows;
    const colW = 256 / cols;
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";
      ctx.fillRect(0, (i * 4.3) % 256, 256, 2);
    }
    ctx.strokeStyle = "rgba(70, 65, 58, 0.42)";
    ctx.lineWidth = 2.4;
    for (let row = 0; row < rows; row++) {
      const y = row * rowH;
      const offset = (row % 2 === 1) ? colW * 0.5 : 0;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(256, y);
      ctx.stroke();
      for (let col = 0; col <= cols; col++) {
        const x = (col * colW + offset) % 256;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + rowH);
        ctx.stroke();
      }
    }
  } else if (materialKey === "granite_pocheon") {
    // Speckled Korean Pocheon granite crystal grain + stone panel seams
    for (let i = 0; i < 900; i++) {
      const gx = (i * 73) % 256;
      const gy = (i * 137) % 256;
      ctx.fillStyle = i % 3 === 0 ? "rgba(255,255,255,0.22)" : (i % 3 === 1 ? "rgba(15,23,42,0.22)" : "rgba(148,163,184,0.18)");
      ctx.fillRect(gx, gy, 2.5, 2.5);
    }
    ctx.strokeStyle = "rgba(30, 41, 59, 0.45)";
    ctx.lineWidth = 2.2;
    ctx.strokeRect(2, 2, 124, 124);
    ctx.strokeRect(130, 2, 124, 124);
    ctx.strokeRect(2, 130, 124, 124);
    ctx.strokeRect(130, 130, 124, 124);
  } else if (materialKey === "uhpc_concrete") {
    // Exposed architectural UHPC concrete panels with form tie-cone holes
    ctx.strokeStyle = "rgba(15, 23, 42, 0.38)";
    ctx.lineWidth = 2.2;
    ctx.strokeRect(2, 2, 252, 124);
    ctx.strokeRect(2, 130, 252, 124);
    const holes = [
      [36, 36], [220, 36], [36, 92], [220, 92],
      [36, 164], [220, 164], [36, 220], [220, 220]
    ];
    ctx.fillStyle = "rgba(15, 23, 42, 0.50)";
    for (const [hx, hy] of holes) {
      ctx.beginPath();
      ctx.arc(hx, hy, 4.2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Anodized metal / Champagne bronze brushed hairline cassette seams
    for (let y = 0; y < 256; y += 4) {
      ctx.fillStyle = y % 8 === 0 ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";
      ctx.fillRect(0, y, 256, 2);
    }
    ctx.strokeStyle = "rgba(15, 23, 42, 0.30)";
    ctx.lineWidth = 2.0;
    ctx.strokeRect(2, 2, 124, 252);
    ctx.strokeRect(130, 2, 124, 252);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 1);
  claddingTextureCache.set(cacheKey, tex);
  return tex;
}

function createMassPlateGeometry(fp, heightM, widthM = fp.widthM, depthM = fp.depthM) {
  if (!fp.hasAtrium) return new THREE.BoxGeometry(widthM, heightM, depthM);
  const shape = new THREE.Shape();
  shape.moveTo(-widthM / 2, -depthM / 2);
  shape.lineTo(widthM / 2, -depthM / 2);
  shape.lineTo(widthM / 2, depthM / 2);
  shape.lineTo(-widthM / 2, depthM / 2);
  shape.closePath();
  const holeW = fp.widthM * 0.35, holeD = fp.depthM * 0.35;
  const hole = new THREE.Path();
  hole.moveTo(-holeW / 2, -holeD / 2);
  hole.lineTo(-holeW / 2, holeD / 2);
  hole.lineTo(holeW / 2, holeD / 2);
  hole.lineTo(holeW / 2, -holeD / 2);
  hole.closePath();
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: heightM, bevelEnabled: false, steps: 1, curveSegments: 1 });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -heightM / 2, 0);
  return geometry;
}

function rebuild3DScene(model) {
  if (!buildingGroup) return;
  clearGroup(buildingGroup);
  clearGroup(contextGroup);
  clearGroup(envelopeGroup);
  if (dimensionGroup) clearGroup(dimensionGroup);

  applyStudioThemeToScene();
  updateSunPosition(state.sunHour, model.parcelGeometry?.frameRotationRad || 0);

  const W = model.siteWidthM;
  const D = model.siteDepthM;
  const roadW = state.roadWidthM;
  const isDay = state.daylightTheme;
  const isXray = state.viewMode === "xray";
  const isExploded = state.viewMode === "exploded";
  const simpleMass = model.representation?.detailLevel === "massing";
  if (gridHelper) gridHelper.visible = !model.parcelGeometry;

  // BIM Real-Time Section Clipping Plane
  const clipPct = Number(state.clipPlanePct ?? 100);
  const isClipped = clipPct < 99.5;
  if (globalClipPlane) {
    const maxCutH = model.buildingHeightM + 6.0;
    const minCutH = -state.floorsBelow * 3.5;
    globalClipPlane.constant = isClipped
      ? minCutH + (maxCutH - minCutH) * (clipPct / 100.0)
      : 999.0;
  }
  const activeClipPlanes = isClipped && globalClipPlane ? [globalClipPlane] : [];

  // 1. Parcel Pad & Setback Boundary (with Adjacent Parcel Merger highlight)
  if (model.parcelGeometry) {
    for (const rings of model.parcelGeometry.outlines) {
      const shape = new THREE.Shape(rings[0].map(([x,z]) => new THREE.Vector2(x,-z)));
      for (const ring of rings.slice(1)) shape.holes.push(new THREE.Path(ring.map(([x,z])=>new THREE.Vector2(x,-z))));
      const geo = new THREE.ShapeGeometry(shape); geo.rotateX(-Math.PI/2);
      const pad = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color:isDay?ATELIER_PALETTE.site:ATELIER_PALETTE.nightSite,roughness:.75,side:THREE.DoubleSide}));
      pad.position.y=.14; pad.receiveShadow=true; buildingGroup.add(pad);
      for (const ring of rings) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring.map(([x,z])=>new THREE.Vector3(x,.2,z))), new THREE.LineBasicMaterial({color:ATELIER_PALETTE.bronze}));
        buildingGroup.add(line);
        const borderMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x80633f).convertSRGBToLinear(), toneMapped: false, fog: false });
        for (let i = 0; i < ring.length - 1; i++) {
          const [x1,z1] = ring[i], [x2,z2] = ring[i + 1], length = Math.hypot(x2-x1,z2-z1);
          if (length < .001) continue;
          const border = new THREE.Mesh(new THREE.BoxGeometry(length, .025, .22), borderMaterial);
          border.position.set((x1+x2)/2, .225, (z1+z2)/2); border.rotation.y = -Math.atan2(z2-z1,x2-x1);
          border.name = "selected-parcel-boundary"; buildingGroup.add(border);
        }
      }
    }
    // Preserve individual selected lot boundaries inside the merged outline.
    // They remain in the same projected frame as the building and road layers.
    for (const feature of state.parcelData?.features || []) {
      const polys = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      for (const poly of polys) for (const ring of poly) {
        const points = ring.map(p => window.AtelierParcelGeometry.projectWgs84(model.parcelGeometry, p));
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(([x,z]) => new THREE.Vector3(x,.205,z))),
          new THREE.LineDashedMaterial({ color: ATELIER_PALETTE.bronze, dashSize: 1.2, gapSize: .6, transparent: true, opacity: .65 }));
        line.computeLineDistances(); buildingGroup.add(line);
      }
    }
  }
  const siteGeo = new THREE.BoxGeometry(W, 0.3, D);
  const siteMat = new THREE.MeshStandardMaterial({
    color: isDay ? ATELIER_PALETTE.site : ATELIER_PALETTE.nightSite,
    roughness: 0.75
  });
  const sitePad = new THREE.Mesh(siteGeo, siteMat);
  sitePad.position.set(0, 0.12, 0);
  sitePad.receiveShadow = true;
  sitePad.visible = !model.parcelGeometry;
  buildingGroup.add(sitePad);

  const siteEdges = new THREE.EdgesGeometry(siteGeo);
  const siteLine = new THREE.LineSegments(
    siteEdges,
    new THREE.LineBasicMaterial({ color: state.parcelMerged ? ATELIER_PALETTE.bronze : ATELIER_PALETTE.olive })
  );
  siteLine.position.copy(sitePad.position);
  siteLine.visible = !model.parcelGeometry;
  buildingGroup.add(siteLine);

  // Example context is only used for unlocated studies. Actual cadastral
  // studies load provider geometry below, without invented roads/buildings.
  if (!model.parcelGeometry) {
  // Front Road (+Z South) with Centerline & Crosswalk
  const roadLen = W * 4.8;
  const roadGeo = new THREE.PlaneGeometry(roadLen, roadW);
  const roadMat = new THREE.MeshStandardMaterial({
    color: isDay ? ATELIER_PALETTE.road : ATELIER_PALETTE.nightRoad,
    roughness: 0.88
  });
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.rotation.x = -Math.PI / 2;
  roadMesh.position.set(0, 0.03, D / 2 + roadW / 2);
  roadMesh.receiveShadow = true;
  contextGroup.add(roadMesh);

  // Yellow Centerline on Road
  const centerLineGeo = new THREE.PlaneGeometry(roadLen, 0.4);
  const centerLineMat = new THREE.MeshBasicMaterial({ color: ATELIER_PALETTE.roadMark });
  const centerLine = new THREE.Mesh(centerLineGeo, centerLineMat);
  centerLine.rotation.x = -Math.PI / 2;
  centerLine.position.set(0, 0.06, D / 2 + roadW / 2);
  contextGroup.add(centerLine);

  // Street Trees (가로수) along Front Sidewalk
  if (!isXray) {
    const trunkMat = new THREE.MeshStandardMaterial({ color: ATELIER_PALETTE.oak });
    const foliageMat = new THREE.MeshStandardMaterial({ color: isDay ? ATELIER_PALETTE.olive : ATELIER_PALETTE.nightOlive, roughness: 0.88 });
    const treeCount = Math.max(4, Math.floor(W / 7));
    for (let i = 0; i < treeCount; i++) {
      const tx = -W / 2 + 3 + (i / (treeCount - 1)) * (W - 6);
      const tz = D / 2 + 1.4;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 2.2, 6), trunkMat);
      trunk.position.set(tx, 1.1, tz);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(1.45, 10, 10), foliageMat);
      crown.position.set(tx, 3.1, tz);
      crown.castShadow = true;
      contextGroup.add(trunk);
      contextGroup.add(crown);
    }
  }
  }

  // North Indicator Arrow (-Z is True North)
  const northMarkerGeo = new THREE.ConeGeometry(2.2, 5.5, 4);
  const northMarkerMat = new THREE.MeshBasicMaterial({ color: ATELIER_PALETTE.bronze });
  const northMarker = new THREE.Mesh(northMarkerGeo, northMarkerMat);
  const siteRotation = model.parcelGeometry?.frameRotationRad || 0;
  const northDirection = new THREE.Vector3(-Math.sin(siteRotation), 0, -Math.cos(siteRotation));
  northMarker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), northDirection);
  northMarker.position.copy(northDirection.clone().multiplyScalar(Math.max(W, D) / 2 + 8)); northMarker.position.y = .6;
  contextGroup.add(northMarker);

  // 2. Surrounding Seoul Context Buildings
  surroundingBuildingsGroup = new THREE.Group();
  surroundingBuildingsGroup.name = "surrounding-buildings";
  surroundingBuildingsGroup.visible = state.showSurroundingBuildings !== false;
  contextGroup.add(surroundingBuildingsGroup);
  syncSurroundingBuildingsUI();
  if (!isXray && !model.parcelGeometry) {
    const neighbors = [
      { x: -W * 1.25, z: 0, w: W * 0.85, d: D * 0.82, h: Math.max(18, model.buildingHeightM * 0.68) },
      { x: W * 1.25, z: 0, w: W * 0.85, d: D * 0.82, h: Math.max(22, model.buildingHeightM * 0.82) },
      { x: 0, z: -D * 1.18, w: W * 0.92, d: D * 0.75, h: model.northSolarApplies ? 16 : 38 },
      { x: -W * 1.25, z: -D * 1.18, w: W * 0.8, d: D * 0.72, h: 20 },
      { x: W * 1.25, z: -D * 1.18, w: W * 0.8, d: D * 0.72, h: 24 },
      { x: -W * 1.1, z: D + roadW + 22, w: W * 0.9, d: 28, h: model.buildingHeightM * 0.85 },
      { x: W * 0.9, z: D + roadW + 22, w: W * 0.85, d: 26, h: model.buildingHeightM * 0.72 }
    ];
    const ctxMat = new THREE.MeshStandardMaterial({
      color: isDay ? ATELIER_PALETTE.context : ATELIER_PALETTE.nightContext,
      transparent: true,
      opacity: isDay ? 0.78 : 0.62,
      roughness: 0.94
    });
    const ctxEdgeMat = new THREE.LineBasicMaterial({ color: isDay ? ATELIER_PALETTE.contextEdge : ATELIER_PALETTE.nightContextEdge });

    for (const nb of neighbors) {
      const g = new THREE.BoxGeometry(nb.w, nb.h, nb.d);
      const m = new THREE.Mesh(g, ctxMat);
      m.position.set(nb.x, nb.h / 2, nb.z);
      m.castShadow = true;
      m.receiveShadow = true;
      surroundingBuildingsGroup.add(m);

      const e = new THREE.EdgesGeometry(g);
      const l = new THREE.LineSegments(e, ctxEdgeMat);
      l.position.copy(m.position);
      surroundingBuildingsGroup.add(l);
    }
  }

  // 3. Underground Parking Floors (B1 ~ B7) & Slurry Wall
  const bDepthPerFloor = 3.5;
  const totalBaseDepth = state.floorsBelow * bDepthPerFloor;
  const basementScale = Math.sqrt((model.areas.basementPlateSqm || 0) / Math.max(1, W * D));
  const bW = model.basementPlacement?.widthM ?? W * basementScale;
  const bD = model.basementPlacement?.depthM ?? D * basementScale;
  const bX = model.basementPlacement?.centerX || 0, bZ = model.basementPlacement?.centerZ || 0;

  const slurryGeo = new THREE.BoxGeometry(bW, totalBaseDepth, bD);
  const slurryEdges = new THREE.EdgesGeometry(slurryGeo);
  const slurryLine = new THREE.LineSegments(slurryEdges, new THREE.LineBasicMaterial({ color: ATELIER_PALETTE.foundation }));
  slurryLine.position.set(bX, -totalBaseDepth / 2, bZ);
  buildingGroup.add(slurryLine);

  for (let b = 1; b <= state.floorsBelow; b++) {
    const yPos = -b * bDepthPerFloor;
    const isSelBase = state.selectedFloorLevel === -b;
    const slabGeo = new THREE.BoxGeometry(bW, 0.35, bD);
    const slabMat = new THREE.MeshStandardMaterial({
      color: isSelBase ? ATELIER_PALETTE.bronze : ATELIER_PALETTE.foundation,
      transparent: true,
      opacity: isSelBase ? 0.78 : (isXray ? 0.58 : 0.26),
      clippingPlanes: activeClipPlanes
    });
    const slabMesh = new THREE.Mesh(slabGeo, slabMat);
    slabMesh.position.set(bX, yPos, bZ);
    slabMesh.userData = { isInspectableFloor: true, level: -b };
    buildingGroup.add(slabMesh);
  }
  refreshSiteContext(model);
  const parcelSignature = model.parcelGeometry ? model.parcelGeometry.pnus.join("|") + model.parcelGeometry.source : state.parcelKey;
  const fitExtent = Math.max(W, D, model.buildingHeightM, 20);
  const scaleChanged = sceneFitExtent && (fitExtent / sceneFitExtent < .67 || fitExtent / sceneFitExtent > 1.5);
  if (sceneParcelSignature !== parcelSignature || (scaleChanged && !document.body.classList.contains("interior-active"))) {
    fitCameraToSite(model); sceneParcelSignature = parcelSignature; sceneFitExtent = fitExtent;
  }
  // An infeasible above-ground model still shows its real site and constraints.
  if (!model.floorPlates.length) { window.dispatchEvent(new CustomEvent("atelier:scene-rebuilt")); return; }

  // 4. High-Detail Procedural 3D Facade & Floor Plates (5 Archetypes × 6 Cladding Materials × 8 Color Swatches × 5 Glass Tints × 3 Podiums)
  const arch = FACADE_ARCHETYPES[state.facadeType] || FACADE_ARCHETYPES.curtain_wall;
  const cladMatObj = CLADDING_MATERIALS[state.claddingMaterial] || CLADDING_MATERIALS.anodized_metal;
  const accentOverride = FACADE_ACCENT_PALETTES[state.facadeAccent] || null;
  const glassTintOverride = GLASS_TINT_PALETTES[state.glassTint] || GLASS_TINT_PALETTES.auto;

  const surfaceAppearance = getFacadeAppearance();
  const realisticColors = getFacadeColorMode() === "realistic";
  const surfaceEnvironment = realisticColors ? getFacadeEnvironmentMap() : null;
  const surfaceColor = hex => realisticColors ? new THREE.Color(hex).convertSRGBToLinear() : hex;
  const frameHex = surfaceAppearance?.frameHex ?? (accentOverride ? accentOverride.frame : arch.frameColor);
  const spandrelHex = surfaceAppearance?.spandrelHex ?? (accentOverride ? accentOverride.spandrel : arch.spandrelColor);
  const slabHex = surfaceAppearance?.slabHex ?? (accentOverride
    ? accentOverride.slab
    : (state.facadeType === "brick_rainscreen" ? 0xd2c3b0 : (isDay ? ATELIER_PALETTE.limestone : ATELIER_PALETTE.nightLimestone)));

  const procTex = surfaceAppearance ? null : getProceduralCladdingTexture(state.claddingMaterial, spandrelHex);

  const slabBandMat = new THREE.MeshStandardMaterial({
    color: surfaceColor(slabHex),
    roughness: 0.76,
    metalness: 0.08,
    clippingPlanes: activeClipPlanes
  });

  const frameMat = new THREE.MeshStandardMaterial({
    color: surfaceColor(frameHex),
    roughness: Math.max(0.32, cladMatObj.roughness * 0.8),
    metalness: cladMatObj.metalness,
    envMap: surfaceEnvironment,
    envMapIntensity: 0.85,
    clippingPlanes: activeClipPlanes
  });

  const spandrelMat = surfaceAppearance ? window.AtelierMaterials.createCladdingMaterial(THREE, {
    materialKey: state.claddingMaterial, mode: getFacadeColorMode(), baseHex: spandrelHex,
    widthM: 1, heightM: 1, jointMm: state.facadeJointMm,
    clippingPlanes: activeClipPlanes, envMap: surfaceEnvironment, envMapIntensity: 0.85
  }) : new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: procTex,
    bumpMap: procTex,
    bumpScale: state.claddingMaterial === "terracotta_brick" ? 0.08 : 0.04,
    roughness: cladMatObj.roughness,
    metalness: cladMatObj.metalness,
    clippingPlanes: activeClipPlanes
  });

  const interiorCeilingMat = new THREE.MeshStandardMaterial({
    color: ATELIER_PALETTE.interior,
    emissive: ATELIER_PALETTE.warmGlow,
    emissiveIntensity: isDay ? 0.08 : 0.24,
    roughness: 0.82,
    clippingPlanes: activeClipPlanes
  });

  const terraceGreenMat = new THREE.MeshStandardMaterial({
    color: ATELIER_PALETTE.olive,
    roughness: 0.78,
    clippingPlanes: activeClipPlanes
  });

  const explodeGap = isExploded ? 1.85 : 0.0;
  const bayW = Math.max(1.5, Math.min(4.5, Number(state.facadeBayM) || arch.defaultBayM));
  const wwrRatio = Math.max(0.30, Math.min(0.85, (Number(state.facadeWwrPct) || arch.defaultWwrPct) / 100.0));
  const finDepth = Math.max(0.05, Math.min(1.15, Number(state.facadeLouverM) || arch.defaultLouverM));

  for (const fp of model.floorPlates) {
    const explodeOffset = (fp.level - 1) * explodeGap;
    const slabThick = 0.28;
    const glassHeight = state.floorHeight - slabThick;
    const yBottom = fp.zBottom + explodeOffset;
    const zCenter = fp.northShiftM;
    const isRetail = fp.use === "retail";
    const isResidential = fp.use === "residential";
    const isAmenity = fp.use === "amenity";
    const isSelectedFloor = state.selectedFloorLevel === fp.level;

    if (simpleMass) {
      const geometry = createMassPlateGeometry(fp, fp.zTop - fp.zBottom);
      const material = new THREE.MeshStandardMaterial({ color: isSelectedFloor ? ATELIER_PALETTE.bronze : ATELIER_PALETTE.limestone,
        roughness: .9, transparent: isXray, opacity: isXray ? .35 : 1, clippingPlanes: activeClipPlanes });
      const mass = new THREE.Mesh(geometry, material);
      mass.position.set(0, yBottom + (fp.zTop - fp.zBottom) / 2, zCenter);
      mass.castShadow = true; mass.receiveShadow = true;
      mass.userData = { isInspectableFloor: true, level: fp.level, kind: "planning-mass" };
      buildingGroup.add(mass);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: ATELIER_PALETTE.contextEdge, clippingPlanes: activeClipPlanes }));
      edges.position.copy(mass.position); buildingGroup.add(edges);
      continue;
    }

    // 4a. Architectural Floor Slab Band (콘크리트 슬래브 엣지 밴드)
    const slabGeo = createMassPlateGeometry(fp, slabThick);
    const slabMesh = new THREE.Mesh(slabGeo, slabBandMat);
    slabMesh.position.set(0, yBottom + slabThick / 2, zCenter);
    slabMesh.castShadow = true;
    slabMesh.receiveShadow = true;
    slabMesh.userData = { isInspectableFloor: true, level: fp.level };
    buildingGroup.add(slabMesh);

    // 4b. Interior Parallax Ceiling/Office Plane (three-fenestra depth effect)
    if (!isXray) {
      const intGeo = createMassPlateGeometry(fp, 0.12, fp.widthM * 0.88, fp.depthM * 0.88);
      const intMesh = new THREE.Mesh(intGeo, interiorCeilingMat);
      intMesh.position.set(0, yBottom + slabThick + glassHeight * 0.78, zCenter);
      intMesh.userData = { isInspectableFloor: true, level: fp.level };
      buildingGroup.add(intMesh);
    }

    // 4c. Core Vision Glass Box (with Low-E Glazing Tint, Mixed-Use Tint & Podium Piloti recession)
    const isMasonryLike = state.facadeType === "brick_rainscreen" || state.claddingMaterial === "terracotta_brick" || state.claddingMaterial === "limestone";
    const podiumRecess = (isRetail && state.podiumStyle === "piloti_colonade") ? 1.85 : 0.0;
    const recess = (isMasonryLike ? 0.34 : (state.facadeType === "stone_ribbon" ? 0.24 : 0.10)) + podiumRecess;

    let glassColor = surfaceAppearance?.glassHex ?? (isDay ? arch.glassColorDay : arch.glassColorNight);
    if (realisticColors) {
      if (state.glassTint === "auto" && isRetail && state.podiumStyle === "showwindow") glassColor = 0xc6d6d5;
    } else if (glassTintOverride && glassTintOverride.dayHex !== null) {
      glassColor = isDay ? glassTintOverride.dayHex : glassTintOverride.nightHex;
    } else if (isRetail && state.podiumStyle === "showwindow") {
      glassColor = isDay ? ATELIER_PALETTE.glass : ATELIER_PALETTE.nightGlass;
    } else if (isResidential) {
      glassColor = isDay ? 0xb5b4a4 : 0xc1ad8d;
    } else if (isAmenity) {
      glassColor = isDay ? 0xa6af97 : 0xa5aa8e;
    }

    const glassGeo = new THREE.BoxGeometry(Math.max(4, fp.widthM - recess * 2), glassHeight, Math.max(4, fp.depthM - recess * 2));
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: surfaceColor(glassColor),
      transparent: true,
      opacity: isXray ? 0.14 : (state.glassTint === "crystal_clear" ? 0.48 : (isDay ? 0.68 : 0.78)),
      roughness: 0.16,
      envMap: surfaceEnvironment,
      envMapIntensity: 0.65,
      metalness: state.glassTint === "bronze_gold" || state.glassTint === "smoke_grey" ? 0.24 : 0.12,
      reflectivity: 0.72,
      clippingPlanes: activeClipPlanes
    });
    const glassMesh = new THREE.Mesh(glassGeo, glassMat);
    glassMesh.position.set(0, yBottom + slabThick + glassHeight / 2, zCenter);
    glassMesh.castShadow = true;
    glassMesh.receiveShadow = true;
    glassMesh.userData = { isInspectableFloor: true, level: fp.level };
    buildingGroup.add(glassMesh);

    // Highlight Selected Floor (3D Raycast Selection Box in Champagne Gold)
    if (isSelectedFloor) {
      const selGeo = new THREE.BoxGeometry(fp.widthM + 1.1, state.floorHeight + 0.15, fp.depthM + 1.1);
      const selEdges = new THREE.EdgesGeometry(selGeo);
      const selLine = new THREE.LineSegments(selEdges, new THREE.LineBasicMaterial({ color: ATELIER_PALETTE.bronze }));
      selLine.position.set(0, yBottom + state.floorHeight / 2, zCenter);
      buildingGroup.add(selLine);

      const selFillMat = new THREE.MeshBasicMaterial({
        color: ATELIER_PALETTE.bronze,
        transparent: true,
        opacity: 0.10,
        depthWrite: false
      });
      const selFillMesh = new THREE.Mesh(selGeo, selFillMat);
      selFillMesh.position.copy(selLine.position);
      buildingGroup.add(selFillMesh);
    }

    // 4d. Procedural Facade Relief Grammar (Per-Archetype + Cladding Texture + Podium Style)
    if (!isXray) {
      const spandrelH = Math.max(0.32, glassHeight * Math.max(0.18, 1.0 - wwrRatio));
      const yMid = yBottom + slabThick + glassHeight / 2;

      // Ground-floor & 2F Podium Streetfront Architecture (Showwindow vs Brick/Stone Arcade vs Piloti Colonade)
      if (isRetail) {
        if (fp.level === 1) {
          const canopyGeo = new THREE.BoxGeometry(Math.min(fp.widthM * 0.52, 16), 0.28, 3.0);
          const canopyMesh = new THREE.Mesh(canopyGeo, frameMat);
          canopyMesh.position.set(0, yBottom + state.floorHeight * 0.95, zCenter + fp.depthM / 2 + 1.4);
          canopyMesh.castShadow = true;
          buildingGroup.add(canopyMesh);
        }
        if (state.podiumStyle === "brick_arcade" || state.podiumStyle === "piloti_colonade") {
          const arcadeCols = Math.max(4, Math.round(fp.widthM / 5.2));
          const colW = state.podiumStyle === "brick_arcade" ? 0.78 : 0.46;
          const colMatPodium = state.podiumStyle === "brick_arcade" ? spandrelMat : frameMat;
          for (let ic = 0; ic <= arcadeCols; ic++) {
            const xCol = -fp.widthM / 2 + (ic / arcadeCols) * fp.widthM;
            for (const zSign of [-1, 1]) {
              const pColGeo = new THREE.BoxGeometry(colW, glassHeight, colW);
              const pColMesh = new THREE.Mesh(applyWorldFacadeUvs(pColGeo), colMatPodium);
              pColMesh.position.set(xCol, yMid, zCenter + zSign * (fp.depthM / 2 - colW * 0.35));
              pColMesh.castShadow = true;
              buildingGroup.add(pColMesh);
            }
          }
          // Arcade Top Lintel Beam
          const lintelGeo = createMassPlateGeometry(fp, 0.48);
          const lintelMesh = new THREE.Mesh(applyWorldFacadeUvs(lintelGeo), spandrelMat);
          lintelMesh.position.set(0, yBottom + slabThick + glassHeight - 0.24, zCenter);
          buildingGroup.add(lintelMesh);
        }
      }

      // Horizontal Spandrel Cladding Band (Always rendered on upper floors so Cladding Material & Color Swatch are immediately visible!)
      if (!isRetail) {
        const panelLayout = window.AtelierFacadeGeometry?.generatePanelBand({
          widthM: fp.widthM, depthM: fp.depthM, heightM: spandrelH,
          yCenterM: yBottom + slabThick + spandrelH / 2, northShiftM: zCenter,
          thicknessMm: state.facadePanelDepthMm, jointMm: state.facadeJointMm,
          moduleWidthM: surfaceAppearance?.tileWidthM || 1.2, maxPanels: 160
        });
        if (panelLayout?.panels.length) {
          addFacadePanelMeshes(buildingGroup, panelLayout.panels, spandrelMat, fp.level);
        } else {
          const spGeo = createMassPlateGeometry(fp, spandrelH);
          const spMesh = new THREE.Mesh(applyWorldFacadeUvs(spGeo), spandrelMat);
          spMesh.position.set(0, yBottom + slabThick + spandrelH / 2, zCenter);
          spMesh.castShadow = true; spMesh.receiveShadow = true;
          spMesh.userData = { isInspectableFloor: true, level: fp.level };
          buildingGroup.add(spMesh);
        }
      }

      // Vertical Mullions / Louver Fins / Brick & Stone Piers along North-South (+Z / -Z) and East-West (+X / -X) faces
      const numBaysX = Math.max(3, Math.round(fp.widthM / bayW));
      const numBaysZ = Math.max(3, Math.round(fp.depthM / bayW));
      const pierWidth = isMasonryLike
        ? Math.max(0.36, (fp.widthM / numBaysX) * (1.0 - wwrRatio * 0.85))
        : (state.facadeType === "stone_ribbon" ? 0.24 : 0.12);
      const pierDepth = state.facadeType === "kinetic_louver"
        ? finDepth
        : (isMasonryLike ? 0.34 : (state.facadeType === "curtain_wall" ? Math.max(0.14, finDepth * 0.50) : 0.20));
      const activePierMat = (isMasonryLike || state.claddingMaterial === "uhpc_concrete" || state.claddingMaterial === "granite_pocheon")
        ? spandrelMat
        : frameMat;

      // Front (+Z) & Back (-Z) Elevation Bays
      const bayGeoZ = applyWorldFacadeUvs(new THREE.BoxGeometry(pierWidth, glassHeight, pierDepth));
      for (let bx = 0; bx <= numBaysX; bx++) {
        if (state.facadeType === "stone_ribbon" && bx > 0 && bx < numBaysX && bx % 2 !== 0) continue;
        const xPos = -fp.widthM / 2 + (bx / numBaysX) * fp.widthM;
        for (const zSign of [-1, 1]) {
          const mMesh = new THREE.Mesh(bayGeoZ, activePierMat);
          mMesh.position.set(xPos, yMid, zCenter + zSign * (fp.depthM / 2 + pierDepth * 0.32));
          if (state.facadeType === "kinetic_louver") mMesh.rotation.y = state.facadeLouverAngleDeg * Math.PI / 180;
          buildingGroup.add(mMesh);
        }
      }

      // East (+X) & West (-X) Elevation Bays
      const bayGeoX = applyWorldFacadeUvs(new THREE.BoxGeometry(pierDepth, glassHeight, pierWidth));
      for (let bz = 0; bz <= numBaysZ; bz++) {
        if (state.facadeType === "stone_ribbon" && bz > 0 && bz < numBaysZ && bz % 2 !== 0) continue;
        const zPos = zCenter - fp.depthM / 2 + (bz / numBaysZ) * fp.depthM;
        for (const xSign of [-1, 1]) {
          const mMesh = new THREE.Mesh(bayGeoX, activePierMat);
          mMesh.position.set(xSign * (fp.widthM / 2 + pierDepth * 0.32), yMid, zPos);
          if (state.facadeType === "kinetic_louver") mMesh.rotation.y = -state.facadeLouverAngleDeg * Math.PI / 180;
          buildingGroup.add(mMesh);
        }
      }

      // Horizontal Brise-Soleil Shading Shelf for Kinetic Louver
      if (state.facadeType === "kinetic_louver" && !isRetail) {
        const shelfGeo = createMassPlateGeometry(fp, 0.10, fp.widthM + finDepth * 1.4, fp.depthM + finDepth * 1.4);
        const shelfMesh = new THREE.Mesh(shelfGeo, frameMat);
        shelfMesh.position.set(0, yBottom + slabThick + glassHeight - 0.12, zCenter);
        buildingGroup.add(shelfMesh);
      }

      // Futuristic Diagrid Exoskeleton & Biophilic Sky Terraces
      if (state.facadeType === "diagrid_biophilic") {
        const diagSegs = Math.max(2, Math.round(fp.widthM / (bayW * 2.2)));
        const segW = fp.widthM / diagSegs;
        const diagLen = Math.hypot(segW, state.floorHeight);
        const diagAngle = Math.atan2(segW, state.floorHeight);
        const diagGeo = new THREE.BoxGeometry(0.22, diagLen, 0.24);
        for (let ds = 0; ds < diagSegs; ds++) {
          const xCenter = -fp.widthM / 2 + (ds + 0.5) * segW;
          const dir = (fp.level + ds) % 2 === 0 ? 1 : -1;
          for (const zSign of [-1, 1]) {
            const dMesh = new THREE.Mesh(diagGeo, frameMat);
            dMesh.position.set(xCenter, yMid, zCenter + zSign * (fp.depthM / 2 + 0.12));
            dMesh.rotation.z = dir * diagAngle;
            buildingGroup.add(dMesh);
          }
        }
        // Biophilic Sky-Balcony Planter on alternating floors
        if (fp.level > 2 && fp.level % 2 === 0) {
          const balcDepth = Math.max(0.8, finDepth * 1.3);
          const balcGeo = new THREE.BoxGeometry(fp.widthM * 0.72, 0.26, balcDepth);
          const balcMesh = new THREE.Mesh(balcGeo, slabBandMat);
          balcMesh.position.set(0, yBottom + 0.14, zCenter + fp.depthM / 2 + balcDepth / 2);
          buildingGroup.add(balcMesh);

          const hedgeGeo = new THREE.BoxGeometry(fp.widthM * 0.68, 0.48, balcDepth * 0.55);
          const hedgeMesh = new THREE.Mesh(hedgeGeo, terraceGreenMat);
          hedgeMesh.position.set(0, yBottom + 0.45, zCenter + fp.depthM / 2 + balcDepth * 0.65);
          buildingGroup.add(hedgeMesh);
        }
      }
    }

    // 4e. Stepped Terrace Landscaping Strip (when floor steps in)
    if (fp.hasTerraceStep && !isXray) {
      const greenGeo = new THREE.BoxGeometry(fp.widthM * 0.92, 0.24, 1.45);
      const greenMesh = new THREE.Mesh(greenGeo, terraceGreenMat);
      greenMesh.position.set(0, yBottom + 0.15, zCenter - fp.depthM / 2 - 0.8);
      buildingGroup.add(greenMesh);
    }

    // 4f. Option B Daylight Courtyard Atrium Void
    if (fp.hasAtrium) {
      const voidGeo = new THREE.BoxGeometry(fp.widthM * 0.35, state.floorHeight, fp.depthM * 0.35);
      const voidEdges = new THREE.EdgesGeometry(voidGeo);
      const voidLine = new THREE.LineSegments(voidEdges, new THREE.LineBasicMaterial({ color: ATELIER_PALETTE.olive }));
      voidLine.position.set(0, yBottom + state.floorHeight / 2, zCenter);
      buildingGroup.add(voidLine);
    }
  }

  // 5. Roof Slab + Rooftop Mechanical Penthouse (옥탑) + Solar PV Array
  const topFloor = model.floorPlates[model.floorPlates.length - 1];
  if (topFloor) {
    const topExplode = (topFloor.level - 1) * explodeGap;
    const roofY = topFloor.zTop + topExplode;

    // Roof Parapet Slab
    const roofSlabGeo = createMassPlateGeometry(topFloor, 0.45);
    const roofSlab = new THREE.Mesh(roofSlabGeo, slabBandMat);
    roofSlab.position.set(0, roofY + 0.22, topFloor.northShiftM);
    roofSlab.castShadow = true;
    buildingGroup.add(roofSlab);

    // Rooftop Solar PV Panels (신재생에너지 태양광 모듈)
    if (!simpleMass && !isXray && !isClipped) {
      const pvMat = new THREE.MeshStandardMaterial({
        color: ATELIER_PALETTE.solarPanel,
        roughness: 0.42,
        metalness: 0.34,
        clippingPlanes: activeClipPlanes
      });
      const pvMinZ = -topFloor.depthM / 2 + 0.45;
      const pvMaxZ = topFloor.hasAtrium ? -topFloor.depthM * 0.175 - 0.45 : topFloor.depthM / 2 - 0.45;
      const pvDepthM = Math.min(1.6, Math.max(0, pvMaxZ - pvMinZ));
      const pvRows = pvDepthM > 0.4 ? Math.min(3, Math.floor((pvMaxZ - pvMinZ + 0.4) / (pvDepthM + 0.4))) : 0;
      for (let r = 0; r < pvRows; r++) {
        const pvGeo = new THREE.BoxGeometry(topFloor.widthM * 0.65, 0.12, pvDepthM);
        const pvMesh = new THREE.Mesh(pvGeo, pvMat);
        pvMesh.rotation.x = 0.32; // Tilted toward South sun
        pvMesh.position.set(0, roofY + 0.8, topFloor.northShiftM + pvMinZ + pvDepthM / 2 + r * (pvDepthM + 0.4));
        buildingGroup.add(pvMesh);
      }
    }
  }

  // 6. Continuous core reservation shared by floor plans, parking and IFC.
  const maxExplodeHeight = model.buildingHeightM + (model.floorPlates.length - 1) * explodeGap;
  const totalHeight = maxExplodeHeight + totalBaseDepth;
  const coreMat = new THREE.MeshStandardMaterial({
    color: ATELIER_PALETTE.core,
    roughness: 0.84,
    transparent: true,
    opacity: isXray || isExploded || isClipped ? 0.92 : 0.78,
    clippingPlanes: activeClipPlanes
  });

  for (const core of simpleMass ? [] : model.coreLayout?.cores || []) {
    const cGeo = new THREE.BoxGeometry(core.maxX - core.minX, totalHeight, core.maxZ - core.minZ);
    const cMesh = new THREE.Mesh(cGeo, coreMat);
    cMesh.position.set((core.minX + core.maxX) / 2, (maxExplodeHeight - totalBaseDepth) / 2, (core.minZ + core.maxZ) / 2);
    cMesh.userData = { kind: "core-reservation", coreId: core.id };
    buildingGroup.add(cMesh);
  }

  // Reference axes only: shared positions across every storey, no invented
  // column section or claim of a solved load path/member capacity.
  if (!simpleMass && (isXray || isExploded)) {
    const points = [];
    for (const axis of model.structuralReference?.columns || []) for (const segment of axis.levels) {
      const gap = (segment.level - 1) * explodeGap;
      points.push(new THREE.Vector3(axis.x, segment.zBottom + gap, axis.z), new THREE.Vector3(axis.x, segment.zTop + gap, axis.z));
    }
    if (points.length) {
      const axes = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: ATELIER_PALETTE.column, clippingPlanes: activeClipPlanes }));
      axes.name = "concept-structural-reference-axes"; axes.userData = { isStructuralDesign: false }; buildingGroup.add(axes);
    }
  }

  // 7. Legal 3D Envelope Cage (4-Side Asymmetric Setbacks) & 건축법 제61조 정북방향 일조사선(H/2) Sloped Plane
  if (state.viewMode === "envelope" || model.northSolarApplies) {
    const fSet = Number(state.setbackM) || 2.0;
    const sSet = Number(state.setbackSideM ?? state.setbackM) || 1.5;
    const rSet = Number(state.setbackRearM ?? state.setbackM) || 2.0;
    const envW = Math.max(0, W - sSet * 2);
    const envD = Math.max(0, D - (fSet + rSet));
    const envZShift = (rSet - fSet) * 0.5;
    const envH = model.buildingHeightM + 4;

    const cageGeo = new THREE.BoxGeometry(envW, envH, envD);
    const cageEdges = new THREE.EdgesGeometry(cageGeo);
    const cageLine = new THREE.LineSegments(
      cageEdges,
      new THREE.LineDashedMaterial({ color: ATELIER_PALETTE.olive, dashSize: 2, gapSize: 1 })
    );
    cageLine.computeLineDistances();
    cageLine.position.set(0, envH / 2, envZShift);
    envelopeGroup.add(cageLine);

    if (model.northSolarApplies) {
      const northBoundaryZ = -D / 2;
      const z10m = northBoundaryZ + Math.max(1.5, rSet);
      const topH = Math.max(16, envH);
      const zTop = northBoundaryZ + topH / 2.0;

      const planeVertices = new Float32Array([
        -W / 2, 10, z10m,
         W / 2, 10, z10m,
         W / 2, topH, zTop,
        -W / 2, 10, z10m,
         W / 2, topH, zTop,
        -W / 2, topH, zTop
      ]);
      const solarGeo = new THREE.BufferGeometry();
      solarGeo.setAttribute("position", new THREE.BufferAttribute(planeVertices, 3));
      solarGeo.computeVertexNormals();

      const solarMat = new THREE.MeshBasicMaterial({
        color: ATELIER_PALETTE.bronze,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide
      });
      const solarMesh = new THREE.Mesh(solarGeo, solarMat);
      envelopeGroup.add(solarMesh);

      const solarBorder = new THREE.EdgesGeometry(solarGeo);
      const solarLine = new THREE.LineSegments(solarBorder, new THREE.LineBasicMaterial({ color: ATELIER_PALETTE.bronze }));
      envelopeGroup.add(solarLine);
    }
  }

  // 8. 3D Architectural Dimension Callout Lines & Sprite Labels (That Open Company / BIM Style)
  if (state.showDimensions && dimensionGroup) {
    const dimLineMat = new THREE.LineBasicMaterial({ color: ATELIER_PALETTE.bronze });
    const labelScale = Math.min(1, Math.max(.35, Math.max(W, D, model.buildingHeightM) / 65));
    const sizeDimension = label => { label.scale.multiplyScalar(labelScale); return label; };

    // Site Width Dimension (South Edge)
    const wPts = [
      new THREE.Vector3(-W / 2, 0.5, D / 2 + 2.8),
      new THREE.Vector3(W / 2, 0.5, D / 2 + 2.8)
    ];
    dimensionGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(wPts), dimLineMat));
    const wLabel = sizeDimension(create3DTextSprite(`${model.parcelGeometry ? "검토 사각 폭" : "대지폭"} W ${W.toFixed(1)}m`));
    wLabel.position.set(0, 2.6, D / 2 + 3.2);
    dimensionGroup.add(wLabel);

    // Site Depth Dimension (East Edge)
    const dPts = [
      new THREE.Vector3(W / 2 + 3.2, 0.5, -D / 2),
      new THREE.Vector3(W / 2 + 3.2, 0.5, D / 2)
    ];
    dimensionGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(dPts), dimLineMat));
    const dLabel = sizeDimension(create3DTextSprite(`${model.parcelGeometry ? "검토 사각 깊이" : "대지깊이"} D ${D.toFixed(1)}m${labelScale < .6 ? "" : ` · 이격 ${state.setbackM}/${state.setbackSideM}/${state.setbackRearM}m`}`));
    dLabel.position.set(W / 2 + 9.5 * labelScale, 2.6, 0);
    dimensionGroup.add(dLabel);

    // Total Building Height Vertical Dimension Pole
    const hPts = [
      new THREE.Vector3(-W / 2 - 4.5, 0, D / 2),
      new THREE.Vector3(-W / 2 - 4.5, model.buildingHeightM, D / 2)
    ];
    dimensionGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(hPts), dimLineMat));
    const hLabel = sizeDimension(create3DTextSprite(`최고높이 H ${model.buildingHeightM.toFixed(1)}m (${model.actualFloorsAbove}F/B${state.floorsBelow})`));
    hLabel.position.set(-W / 2 - 10.5, model.buildingHeightM + 2.2, D / 2);
    dimensionGroup.add(hLabel);

    // Front Road Width Callout
    if (!model.parcelGeometry) {
      const rLabel = sizeDimension(create3DTextSprite(`전면도로 입력 ${roadW}m · ${state.zoning}`));
      rLabel.position.set(0, 1.8, D / 2 + roadW * 0.65);
      dimensionGroup.add(rLabel);
    }
  }
  window.dispatchEvent(new CustomEvent("atelier:scene-rebuilt"));
}

function animateThree() {
  requestAnimationFrame(animateThree);
  // First-person interior walking owns the camera while orbit input is disabled.
  if (controls?.enabled) controls.update();
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

// ============================================================================
// 5. CAD-GRADE 2D TEST-FIT FLOORPLAN SVG GENERATOR
// ============================================================================
function renderTestFitSvg(model) {
  const container = document.getElementById("testFitSvgContainer");
  if (!container) return;

  const typFloor = model.floorPlates[Math.min(model.floorPlates.length - 1, 4)] || {
    widthM: 24,
    depthM: 22
  };
  const svgW = 420;
  const svgH = 225;
  const pad = 26;

  const scale = Math.min((svgW - pad * 2) / model.siteWidthM, (svgH - pad * 2) / model.siteDepthM);
  const siteWpx = model.siteWidthM * scale;
  const siteDpx = model.siteDepthM * scale;
  const siteX = (svgW - siteWpx) / 2;
  const siteY = (svgH - siteDpx) / 2;

  const bWpx = typFloor.widthM * scale;
  const bDpx = typFloor.depthM * scale;
  const bX = (svgW - bWpx) / 2;
  const bY = (svgH - bDpx) / 2 + (typFloor.northShiftM || 0) * scale;

  // Shared reference axes; these marks are not engineered column sections.
  let colsSvg = "";
  const simpleMass = model.representation?.detailLevel === "massing";
  for (const axis of simpleMass ? [] : model.structuralReference?.columns || []) {
    const cx = svgW / 2 + axis.x * scale, cy = svgH / 2 + axis.z * scale;
    colsSvg += `<path d="M${cx-2},${cy}h4 M${cx},${cy-2}v4" stroke="#64748b" stroke-width=".8"/>`;
  }

  // The same global X/Z rectangles used by the WebGL model and IFC.
  let coreSvg = "";
  for (const core of simpleMass ? [] : model.coreLayout?.cores || []) {
    const cx = svgW / 2 + core.minX * scale;
    const cy = svgH / 2 + core.minZ * scale;
    const cw = (core.maxX - core.minX) * scale, cd = (core.maxZ - core.minZ) * scale;
    coreSvg += `<rect x="${cx}" y="${cy}" width="${cw}" height="${cd}" fill="rgba(168,132,81,.22)" stroke="#876b40" stroke-width="1.6"/><text x="${cx+cw/2}" y="${cy+cd/2+3}" fill="#725733" font-size="9" font-weight="800" text-anchor="middle">공통 코어</text>`;
  }
  let atriumSvg = "";
  if (typFloor.hasAtrium) {
    const aw = bWpx * .35, ad = bDpx * .35;
    atriumSvg = `<rect x="${bX+(bWpx-aw)/2}" y="${bY+(bDpx-ad)/2}" width="${aw}" height="${ad}" fill="#f8fafd" stroke="#64748b" stroke-width="1.5"/>`;
  }

  container.innerHTML = `
    <svg width="100%" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
      <!-- Site Boundary -->
      <rect x="${siteX}" y="${siteY}" width="${siteWpx}" height="${siteDpx}" fill="#f8fafd" stroke="#059669" stroke-dasharray="4,3" stroke-width="1.5"/>
      <text x="${siteX + 7}" y="${siteY + 13}" fill="#047857" font-size="9.5" font-weight="800">${model.parcelGeometry?.frameRotationRad ? `배치축 평면 · 북향과 ${Math.abs(model.parcelGeometry.frameRotationRad * 180 / Math.PI).toFixed(1)}°` : "▲ 정북방향"} (${model.parcelGeometry ? "검토 영역" : "대지"} ${model.siteWidthM.toFixed(1)}m × ${model.siteDepthM.toFixed(1)}m)</text>

      <!-- Typical Floor Plate (Rentable Zone) -->
      <rect x="${bX}" y="${bY}" width="${bWpx}" height="${bDpx}" fill="rgba(37,99,235,0.10)" stroke="#1d4ed8" stroke-width="2"/>


      ${coreSvg}
      ${atriumSvg}
      ${colsSvg}

      <!-- Bottom Dimension Callout -->
      <text x="${svgW / 2}" y="${svgH - 6}" fill="#334155" font-size="10" font-weight="700" text-anchor="middle">
        기준층 ${typFloor.widthM.toFixed(1)}m × ${typFloor.depthM.toFixed(1)}m (바닥 ${Math.round(model.areas.typicalFloorSqm)}㎡) · ${simpleMass ? "간략 매스" : "구조축 참고 · 부재 설계 전"}
      </text>
    </svg>
  `;
}

// ============================================================================
// 6. DUAL-AXIS SVG MONTHLY CASHFLOW & CUMULATIVE S-CURVE CHART
// ============================================================================
function renderCashflowChart(fin) {
  const container = document.getElementById("cashflowChartContainer");
  if (!container) return;

  document.getElementById("scheduleSummaryBadge").textContent =
    `총 ${fin.totalMonths}개월 (인허가 ${fin.predevMonths}M + 착공 ${fin.constMonths}M + 임대 ${fin.leaseUpMonths}M)`;
  document.getElementById("chartPeakEquityLabel").textContent =
    `Peak Equity: ${fmtDec(fin.peakEquityEok)}억 | 순매각: ${fmtDec(fin.netExitValueEok)}억`;

  const W = 430;
  const H = 148;
  const padL = 8;
  const padR = 8;
  const padT = 14;
  const padB = 20;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const zeroY = padT + plotH * 0.42;

  let maxMonthlyOut = 1;
  for (let i = 0; i < fin.totalMonths - 1; i++) {
    maxMonthlyOut = Math.max(maxMonthlyOut, fin.monthlyUses[i]);
  }

  const n = fin.totalMonths;
  const colW = plotW / n;
  const barW = Math.max(3, colW * 0.68);

  let barsSvg = "";
  let sCurvePoints = [];
  let cumSpend = 0;
  const totalOutflow = fin.totalDevCostEok || 1;

  for (let m = 0; m < n; m++) {
    const x = padL + m * colW + (colW - barW) / 2;
    const cx = padL + m * colW + colW / 2;
    const eqCf = fin.monthlyEquityCf[m];
    const debt = fin.monthlyDebtDraw[m];
    const isExit = m === n - 1;

    cumSpend += fin.monthlyUses[m];
    const scurveRatio = Math.min(1.0, cumSpend / totalOutflow);
    const sy = padT + plotH - scurveRatio * (plotH - 8);
    sCurvePoints.push(`${cx.toFixed(1)},${sy.toFixed(1)}`);

    if (isExit) {
      const h = zeroY - padT - 4;
      barsSvg += `<rect x="${x.toFixed(1)}" y="${padT + 4}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="#059669"/>`;
    } else if (eqCf < -0.05) {
      const h = Math.min(plotH - (zeroY - padT) - 4, Math.max(4, (Math.abs(eqCf) / maxMonthlyOut) * (plotH * 0.52)));
      barsSvg += `<rect x="${x.toFixed(1)}" y="${zeroY}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="#e11d48"/>`;
    } else if (debt > 0.05) {
      const h = Math.min(plotH - (zeroY - padT) - 4, Math.max(4, (debt / maxMonthlyOut) * (plotH * 0.52)));
      barsSvg += `<rect x="${x.toFixed(1)}" y="${zeroY}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="#2563eb"/>`;
    } else {
      barsSvg += `<rect x="${x.toFixed(1)}" y="${zeroY - 12}" width="${barW.toFixed(1)}" height="12" rx="1.5" fill="#10b981"/>`;
    }
  }

  container.innerHTML = `
    <svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}">
      <!-- Horizontal Grid & Zero Line -->
      <line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="rgba(100,116,139,0.35)" stroke-width="1"/>
      <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="rgba(100,116,139,0.20)" stroke-width="1"/>

      <!-- Monthly Cashflow Bars -->
      ${barsSvg}

      <!-- Cumulative S-Curve Spend Line -->
      <polyline fill="none" stroke="#d97706" stroke-width="2.2" points="${sCurvePoints.join(" ")}" />

      <!-- Labels -->
      <text x="${padL + 2}" y="${H - 4}" fill="#475569" font-size="9.5" font-weight="700">M1 (토지매입·인허가)</text>
      <text x="${W / 2}" y="${H - 4}" fill="#475569" font-size="9.5" font-weight="700" text-anchor="middle">착공 S-Curve (PF 인출)</text>
      <text x="${W - padR - 2}" y="${H - 4}" fill="#047857" font-size="9.5" font-weight="800" text-anchor="end">M${n} (안정화 매각 유입)</text>
    </svg>
  `;
}

// ============================================================================
// 7. UI BINDING & DASHBOARD UPDATER
// ============================================================================
const fmtInt = (n) => typeof n === "number" && Number.isFinite(n) ? Math.round(n).toLocaleString("ko-KR") : "—";
const fmtDec = (n, d = 1) => typeof n === "number" && Number.isFinite(n) ? n.toFixed(d) : "—";

function updateAllCalculationsAndUI() {
  const detailSelect = document.getElementById("selectModelDetail");
  if (detailSelect) detailSelect.value = state.modelDetail || "auto";
  const parcelReview = reviewParcelRegulations(state);
  if (parcelReview?.applied) state.zoning = parcelReview.inputs.zoning;
  syncRegulationModeUI();
  const zoningControl = document.getElementById("selectZoning");
  if (zoningControl) { zoningControl.disabled = Boolean(parcelReview?.applied); zoningControl.value = state.zoning; zoningControl.title = parcelReview?.applied ? "조회한 필지 전체의 용도지역을 적용 중입니다." : "확인되지 않은 경우 비교용 입력입니다."; }
  // Compute all 3 options so the Option A/B/C cards show live mini-IRRs!
  const optA = evaluateDesignAndProforma(state, "A");
  const optB = evaluateDesignAndProforma(state, "B");
  const optC = evaluateDesignAndProforma(state, "C");
  const optionMap = { A: optA, B: optB, C: optC };

  const model = optionMap[state.option] || optA;
  const residual = solveMaxResidualLandPrice(state);
  state.lastComputed = { model, residual, optA, optB, optC };

  // Update mini-KPI badges on Option A / B / C cards
  document.getElementById("miniIrrA").textContent = `IRR ${fmtDec(optA.finance.equityXirrPct)}%`;
  document.getElementById("miniIrrB").textContent = `IRR ${fmtDec(optB.finance.equityXirrPct)}%`;
  document.getElementById("miniIrrC").textContent = `IRR ${fmtDec(optC.finance.equityXirrPct)}%`;
  document.getElementById("miniDescA").textContent = `용적 ${fmtDec(optA.areas.achievedFarPct)}% · 전용률 ${fmtDec(optA.areas.netEfficiencyPct)}%`;
  document.getElementById("miniDescB").textContent = `채광중정 · 동일 임대료 가정 · NOI ${fmtDec(optB.finance.stabilizedNoiEok)}억`;
  document.getElementById("miniDescC").textContent = `북측코어 · 전용률 ${fmtDec(optC.areas.netEfficiencyPct)}% 극대화`;

  // Update 3D Scene
  rebuild3DScene(model);

  // Update 6-Hero Executive KPI Ribbon
  const farOk = model.areas.achievedFarPct <= model.zoningRule.maxFar + 1e-6;
  document.getElementById("kpiFarStatus").textContent = model.parcelRegulationReview && !model.parcelRegulationReview.applied ? "입력 가정 기준" : farOk ? "적용 상한 이내" : "한도 초과";
  document.getElementById("kpiFarStatus").className = `badge ${farOk ? "badge-emerald" : "badge-rose"}`;
  document.getElementById("kpiFarArea").textContent = `${fmtInt(model.areas.farCountedGfaSqm)} ㎡`;
  document.getElementById("kpiFarPct").textContent = `용적 ${fmtDec(model.areas.achievedFarPct)}% / 적용상한 ${fmtDec(model.zoningRule.maxFar, 0)}%`;
  document.getElementById("kpiFarBar").style.width = `${Math.min(100, (model.areas.achievedFarPct / model.zoningRule.maxFar) * 100)}%`;

  const pubEl = document.getElementById("valPublicContrib");
  if (pubEl) {
    pubEl.textContent = state.publicContribPct > 0
      ? `${state.publicContribPct}% (${Math.round(model.zoningRule.publicContribSqm)}㎡ 차감 · 완화 미가산)`
      : `0% (기본 상한 ${fmtDec(model.zoningRule.maxFar, 0)}%)`;
  }

  document.getElementById("kpiNetEffBadge").textContent = `전용률 ${fmtDec(model.areas.netEfficiencyPct)}%`;
  document.getElementById("kpiNetArea").textContent = `${fmtInt(model.areas.netAreaSqm / PYEONG_TO_SQM)} 평`;
  document.getElementById("kpiParkingSub").textContent = `주차 추정 ${model.parking.plannedParkingCount}대 / 최소 ${model.parking.legalParkingCount}대${model.parking.deficit ? " · " + model.parking.deficit + "대 부족" : ""}`;
  renderLegalMassSummary(model);
  document.getElementById("kpiEffBar").style.width = `${Math.min(100, model.areas.netEfficiencyPct * 1.25)}%`;

  document.getElementById("kpiBcrStatus").textContent = `건폐 ${fmtDec(model.areas.achievedBcrPct)}%`;
  document.getElementById("kpiTotalCost").textContent = `${fmtDec(model.finance.totalDevCostEok)} 억원`;
  document.getElementById("kpiConstCostSub").textContent = `공사 ${fmtDec(model.finance.totalHardCostEok)}억 (외장 ${fmtDec(model.facade.totalFacadeCostEok)}억)`;

  document.getElementById("kpiLtvLabel").textContent = state.loanLtvPct;
  document.getElementById("kpiPeakEquity").textContent = `${fmtDec(model.finance.peakEquityEok)} 억원`;
  document.getElementById("kpiLoanSub").textContent =
    `PF ${fmtDec(model.finance.loanAmountEok)}억 · DSCR ${fmtDec(model.finance.dscr, 2)}x`;
  document.getElementById("kpiLtcBar").style.width = `${state.loanLtvPct}%`;

  const irrAvailable = Number.isFinite(model.finance.equityXirrPct);
  const irrGood = irrAvailable && model.finance.equityXirrPct >= state.targetIrrPct;
  document.getElementById("kpiIrrBadge").textContent = irrAvailable ? (irrGood ? "목표 상회" : "목표 미달") : "수익률 미산정";
  document.getElementById("kpiIrrBadge").className = `badge ${irrGood ? "badge-emerald" : "badge-amber"}`;
  document.getElementById("kpiEquityIrr").textContent = `${fmtDec(model.finance.equityXirrPct)} %`;
  const wf = model.finance.waterfall;
  document.getElementById("kpiNpvSub").textContent = wf
    ? `LP ${fmtDec(wf.lpIrrPct)}% · GP ${fmtDec(wf.gpIrrPct)}% · NPV ${fmtDec(model.finance.npv8Eok)}억`
    : `NPV ${fmtDec(model.finance.npv8Eok)}억 · EM ${fmtDec(model.finance.equityMultiple, 2)}x`;
  document.getElementById("kpiIrrBar").style.width = `${irrAvailable ? Math.min(100, Math.max(0, model.finance.equityXirrPct * 4)) : 0}%`;

  const landAffordable = residual.maxLandPyeongM >= state.landPricePyeongM;
  document.getElementById("kpiLandGapBadge").textContent = Number.isFinite(residual.maxLandPyeongM) ? (landAffordable ? "가정 내 한도" : "한도 초과") : "한도 미산정";
  document.getElementById("kpiLandGapBadge").className = `badge ${landAffordable ? "badge-emerald" : "badge-rose"}`;
  document.getElementById("kpiResidualLand").textContent = `${fmtDec(residual.maxLandTotalEok)} 억원`;
  document.getElementById("kpiResidualLandPyeong").textContent = `한도 평당 ${fmtInt(residual.maxLandPyeongM)}백만 (현 ${state.landPricePyeongM}백만)`;

  // Update Left Panel Editorial Chapter Summary Pills
  const preset = SEOUL_PARCELS[state.parcelKey] || SEOUL_PARCELS.custom_seoul;
  const chapSiteEl = document.getElementById("chapSummarySite");
  if (chapSiteEl) {
    chapSiteEl.textContent = `${preset.name.split(" ")[0]} · ${fmtInt(model.effectiveCadastralAreaSqm)}㎡${state.parcelMerged ? "(합필)" : ""}`;
  }
  const chapMassEl = document.getElementById("chapSummaryMass");
  if (chapMassEl) {
    chapMassEl.textContent = `${model.actualFloorsAbove}F / B${state.floorsBelow} · 건폐 ${fmtDec(model.areas.achievedBcrPct, 0)}%`;
  }
  const chapFacEl = document.getElementById("chapSummaryFacade");
  if (chapFacEl) {
    chapFacEl.textContent = `${model.facade.claddingShortKr} · ${model.facade.colorNameKr}`;
  }
  const chapFinEl = document.getElementById("chapSummaryFin");
  if (chapFinEl) {
    chapFinEl.textContent = `IRR ${fmtDec(model.finance.equityXirrPct)}% · LP/GP`;
  }

  // Update 3D Viewport Floating HUD
  document.getElementById("hudParcelName").textContent = model.parcelGeometry ? (model.parcelGeometry.addresses.join(" + ") || "적용 필지 경계") : preset.name;
  document.getElementById("hudZoningBadge").textContent = state.zoning;
  document.getElementById("hudPnu").textContent = model.parcelGeometry ? (model.parcelGeometry.pnus.join(" + ") || "경계 PNU 미확인") : preset.pnu + " (예시)";
  document.getElementById("hudSiteArea").textContent = `${fmtInt(model.effectiveCadastralAreaSqm)} ㎡ (${fmtInt(model.sitePyeong)}평)`;
  document.getElementById("hudBuildingHeight").textContent = `${fmtDec(model.buildingHeightM)} m (${model.actualFloorsAbove}F/B${state.floorsBelow})`;
  const hudFacadeEl = document.getElementById("hudFacadeName");
  if (hudFacadeEl) {
    hudFacadeEl.textContent = `${model.facade.shortKr} (${model.facade.claddingShortKr})`;
  }
  const activeMatBadgeEl = document.getElementById("activeMaterialBadge");
  if (activeMatBadgeEl) {
    activeMatBadgeEl.textContent = `${model.facade.claddingShortKr} · ${model.facade.colorNameKr}`;
  }
  const coreKor = state.coreType === "center" ? "중앙코어" : (state.coreType === "north" ? "북측편심코어" : "양단코어");
  document.getElementById("hudCoreEff").textContent = `${fmtDec(model.areas.netEfficiencyPct)}% (${coreKor})`;
  document.getElementById("hudTotalGfa").textContent = `${fmtInt(model.areas.totalGfaSqm)} ㎡ (${fmtInt(model.areas.totalGfaSqm / PYEONG_TO_SQM)}평)`;

  document.getElementById("smapCoordLabel").textContent =
    `WGS84: ${(model.parcelGeometry?.centerWgs84[1] ?? preset.lat).toFixed(4)}° N, ${(model.parcelGeometry?.centerWgs84[0] ?? preset.lng).toFixed(4)}° E | ${model.parcelGeometry ? "지구단위계획 미확인" : preset.districtPlan + " (예시)"}`;
  document.getElementById("smapDistrictPlanBadge").textContent = model.parcelGeometry ? (model.parcelRegulationReview?.districtPlans.map(p => p.name).join(" · ") || "지구단위계획 명칭 미확인") : preset.districtPlan + " (예시)";

  // Update Left Panel Facade Live Summary Card
  const facSummaryEl = document.getElementById("facadeLiveSummaryCard");
  if (facSummaryEl) {
    const fc = model.facade;
    facSummaryEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;font-weight:800;color:var(--text-primary);margin-bottom:4px;">
        <span>🏛️ ${fc.nameKr}</span>
        <span style="color:var(--accent-blue);">${fmtDec(fc.totalFacadeCostEok)} 억원</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 10px;font-size:10.5px;">
        <div>외장마감 질감: <strong>${fc.claddingShortKr}</strong></div>
        <div>외장컬러/유리: <strong>${fc.colorNameKr} / ${fc.glassNameKr}</strong></div>
        <div>총 입면면적: <strong>${fmtInt(fc.grossWallAreaSqm)} ㎡</strong></div>
        <div>유리/스팬드럴: <strong>${fmtInt(fc.visionGlassAreaSqm)} / ${fmtInt(fc.opaqueSpandrelAreaSqm)} ㎡</strong></div>
        <div>평균 열관류율 가정: <strong>${fmtDec(fc.effectiveFacadeU, 2)} W/㎡K</strong></div>
        <div>일사획득(SHGC): <strong>${fmtDec(fc.effectiveShgc, 2)} (VLT ${fc.vltPct}%)</strong></div>
        <div>외장공사비(GFA평당): <strong>${fmtDec(fc.facadeCostPerPyeongMan)} 만원/평</strong></div>
        <div>외장 선택 수익효과: <strong>자동 프리미엄 미반영</strong></div>
      </div>
    `;
  }

  // Update Tab 1: 8 Korean Area Definitions Table
  const a = model.areas;
  const siteBasis = model.parcelGeometry ? "지도 경계 근사면적" : "사용자·예시 입력면적";
  const siteNote = state.publicContribPct > 0
    ? `${siteBasis} ${fmtInt(model.zoningRule.cadastralAreaSqm)}㎡ - 공공기여 가정 ${fmtInt(model.zoningRule.publicContribSqm)}㎡`
    : `${siteBasis} 100.0% · 공부·법적 제척면적 미확인`;
  const rows8 = [
    ["1. 검토 대지면적 (공공기여 가정 차감)", a.siteAreaSqm, a.siteAreaSqm / PYEONG_TO_SQM, siteNote],
    ["2. 건축면적 (수평투영 최대면적)", a.buildingFootprintSqm, a.buildingFootprintSqm / PYEONG_TO_SQM, `건폐율 ${fmtDec(a.achievedBcrPct)}% (검토 적용 상한 ${model.zoningRule.maxBcr}%)`],
    ["3. 기준층 바닥면적 (Typical Floor)", a.typicalFloorSqm, a.typicalFloorSqm / PYEONG_TO_SQM, `층고 ${fmtDec(state.floorHeight)}m`],
    ["4. 용적률산정용 연면적 (지상 산입)", a.farCountedGfaSqm, a.farCountedGfaSqm / PYEONG_TO_SQM, `용적률 ${fmtDec(a.achievedFarPct)}% (검토 적용 상한 ${fmtDec(model.zoningRule.maxFar, 0)}%)`, true],
    ["5. 지하층 연면적 (주차·기계실 계획)", a.undergroundGfaSqm, a.undergroundGfaSqm / PYEONG_TO_SQM, `지하 ${state.floorsBelow}개층 (총연면적의 ${fmtDec(a.undergroundGfaSqm / a.totalGfaSqm * 100)}%)`],
    ["6. 총연면적 (지상+지하 합계, 공사비 기준)", a.totalGfaSqm, a.totalGfaSqm / PYEONG_TO_SQM, "전체 시공물량 기준", true],
    ["7. 전용면적 가정 (전용률 기준)", a.netAreaSqm, a.netAreaSqm / PYEONG_TO_SQM, `지상 전용률 가정 ${fmtDec(a.netEfficiencyPct)}% · 실측·계약 근거 미확인`],
    ["8. 공급면적 / 계약면적 가정", a.contractAreaSqm, a.contractAreaSqm / PYEONG_TO_SQM, `공급 가정 ${fmtInt(a.supplyAreaSqm / PYEONG_TO_SQM)}평 / 계약 가정 ${fmtInt(a.contractAreaSqm / PYEONG_TO_SQM)}평 · 모집공고·계약 근거 미확인`]
  ];

  document.getElementById("tableArea8Body").innerHTML = rows8.map(r => `
    <tr class="${r[4] ? "highlight-row" : ""}">
      <td>${r[0]}</td>
      <td class="num">${fmtInt(r[1])} ㎡</td>
      <td class="num">${fmtInt(r[2])} 평</td>
      <td class="num">${r[3]}</td>
    </tr>
  `).join("");

  // Update Tab 1: Facade & Envelope Table + 5-Facade Live Comparison Matrix
  const fc = model.facade;
  const facBadgeEl = document.getElementById("facadeSystemBadge");
  if (facBadgeEl) facBadgeEl.textContent = `${fc.shortKr} · ${fc.claddingShortKr}`;
  const facBodyEl = document.getElementById("tableFacadeEnvelopeBody");
  if (facBodyEl) {
    facBodyEl.innerHTML = `
      <tr>
        <td>선택 외관 패턴 / 외장 마감재 · 색상</td>
        <td class="num"><strong>${fc.nameKr}</strong> (${fc.claddingShortKr})</td>
        <td class="num">외장색: <strong>${fc.colorNameKr}</strong> · 유리: <strong>${fc.glassNameKr}</strong> · 저층: ${fc.podiumNameKr}</td>
      </tr>
      <tr>
        <td>외피 총면적 / 창면적비(WWR)</td>
        <td class="num">외벽 <strong>${fmtInt(fc.grossWallAreaSqm)} ㎡</strong> (창면적비 ${fmtDec(fc.wwrPct, 0)}%)</td>
        <td class="num">유리 ${fmtInt(fc.visionGlassAreaSqm)}㎡ · 스팬드럴 ${fmtInt(fc.opaqueSpandrelAreaSqm)}㎡</td>
      </tr>
      <tr>
        <td>프로시저럴 입면 모듈 · 차양 루버</td>
        <td class="num">베이 간격 ${fmtDec(fc.bayWidthM, 1)}m (총 ${fc.totalBayModules}모듈)</td>
        <td class="num">루버/핀 깊이 ${fmtDec(fc.louverDepthM, 2)}m (차양면적 ${fmtInt(fc.louverFinAreaSqm)}㎡)</td>
      </tr>
      <tr>
        <td>외피 열관류율 · SHGC 계획 가정</td>
        <td class="num">외벽 U=${fmtDec(fc.wallU, 3)} · 창호 U=${fc.windowU} W/㎡K<br>제품 성적서·부위·용도별 적용 기준 확인 전</td>
        <td class="num">평균 U=${fmtDec(fc.effectiveFacadeU, 2)} W/㎡K · SHGC ${fmtDec(fc.effectiveShgc, 2)}<br>에너지 설계·인증 적합 여부 미검증</td>
      </tr>
      <tr>
        <td>건축법 제52조 외벽 마감 · 방화구조</td>
        <td class="num" colspan="2">계획 재료 설명: ${fc.fireGrade}<br>실제 제품 시험성적·외벽 시스템·적용 대상 확인 전이며 적합 판정이 아닙니다.</td>
      </tr>
      <tr class="highlight-row">
        <td>외장공사비 총액 및 수지 영향</td>
        <td class="num">외장공사비 <strong>${fmtDec(fc.totalFacadeCostEok)} 억원</strong> (평당 ${fmtDec(fc.facadeCostPerPyeongMan)}만원)</td>
        <td class="num">공사비 가정 +${fmtDec(fc.constCostDeltaPct)}% · 임대료 자동 가산 없음 · 내재탄소 개산 ${fmtInt(fc.embodiedCarbonTon)}tCO₂ (EPD 확인 전)</td>
      </tr>
    `;
  }

  const facCompareEl = document.getElementById("tableFacadeCompareBody");
  if (facCompareEl) {
    const facadeKeys = Object.keys(FACADE_ARCHETYPES);
    facCompareEl.innerHTML = facadeKeys.map(fKey => {
      const fArchItem = FACADE_ARCHETYPES[fKey];
      const simState = {
        ...state,
        facadeType: fKey,
        facadeWwrPct: fKey === state.facadeType ? state.facadeWwrPct : fArchItem.defaultWwrPct,
        facadeBayM: fKey === state.facadeType ? state.facadeBayM : fArchItem.defaultBayM,
        facadeLouverM: fKey === state.facadeType ? state.facadeLouverM : fArchItem.defaultLouverM
      };
      const simRes = evaluateDesignAndProforma(simState, state.option);
      const isCur = fKey === state.facadeType;
      return `
        <tr class="clickable-facade-row ${isCur ? "highlight-row" : ""}" data-selectfacade="${fKey}" title="클릭하면 '${fArchItem.nameKr}' 디자인을 3D 건물에 즉시 적용합니다">
          <td>${isCur ? "▶ " : ""}${fArchItem.shortKr} <span style="font-size:10px;color:var(--text-muted);">(WWR ${simRes.facade.wwrPct}%)</span></td>
          <td class="num">${fmtDec(simRes.facade.totalFacadeCostEok)}억 (${fmtInt(simRes.facade.facadeCostPerPyeongMan)}만/평)</td>
          <td class="num">U=${fmtDec(simRes.facade.effectiveFacadeU, 2)} · SHGC ${fmtDec(simRes.facade.effectiveShgc, 2)}</td>
          <td class="num" style="color:var(--accent-emerald);">+${fmtDec(simRes.facade.rentPremiumPct)}%</td>
          <td class="num" style="font-weight:800;color:var(--accent-blue);">${fmtDec(simRes.finance.equityXirrPct)}%</td>
        </tr>
      `;
    }).join("");

    facCompareEl.querySelectorAll(".clickable-facade-row").forEach(row => {
      row.addEventListener("click", () => {
        applyFacadeArchetypeSelection(row.dataset.selectfacade);
      });
    });
  }

  document.getElementById("tableParkingEgressBody").innerHTML = `
    ${model.parking.breakdown.map(item => `<tr><td>${item.label}</td><td class="num">${fmtDec(item.areaSqm)}㎡ · ${item.formula}</td><td class="num">산정 ${fmtDec(item.rawCount)}대</td></tr>`).join("")}
    <tr><td>${model.parking.restricted ? "설치제한지역 · 비주거 최고 / 주거 최소" : "일반지역 · 설치 최소 대수"}</td><td class="num">최소 ${model.parking.legalParkingCount}대${model.parking.legalMaxParkingCount !== null ? " / 적용 최고 " + model.parking.legalMaxParkingCount + "대" : ""}</td><td class="num">계획 ${model.parking.plannedParkingCount}대 · ${model.parking.deficit ? model.parking.deficit + "대 부족" : "계산상 수용"}</td></tr>
    <tr><td>지하 자주식 수용량 · 기획 가정</td><td class="num">면적 환산과 램프·차로·코어 포함 개념 배치 중 작은 값</td><td class="num">${model.parking.capacityCount}대 · 차량 회전 궤적 확인 전</td></tr>
    <tr><td>장애인 주차 · 신축 EV 충전</td><td class="num">장애인 일반 기준 최소대수 3% (10대 이상)<br>EV 대상 용도·자주식 50대 이상 / 반올림</td><td class="num">장애인 ${model.parking.disabledParkingCount === null ? "추가 확인" : model.parking.disabledParkingCount + "면"}<br>충전 ${model.parking.evChargerFastSlow}기 (급속 ${model.parking.evFastCount}기)</td></tr>
    <tr><td>피난 · 외피 개략 검토</td><td class="num">계단 ${Number.isFinite(model.egress.stairCount) ? model.egress.stairCount + "개 이상 검토" : "용도·거실면적 확인 필요"} · 보행거리 미검증</td><td class="num">피난·방화·소방·에너지 적합 여부 별도 확인</td></tr>
  `;

  document.getElementById("testFitEfficiencyBadge").textContent = `전용률 ${fmtDec(a.netEfficiencyPct)}% (${coreKor})`;
  renderTestFitSvg(model);

  renderCashflowChart(model.finance);
  renderWaterfallAndTranchesTable(model);
  renderSourcesAndUsesTable(model);
  renderResidualAndSensitivity(model, residual);
  renderGuardrails(model, residual);
  renderSiteEvidenceTable(preset, model);
  renderOptionAndRemodelComparison(preset, model, optA, optB, optC);
  renderParcelMergerComparison(preset, model);
  if (state.selectedFloorLevel !== null) {
    renderFloorInspectorCard(model);
  }
  window.dispatchEvent(new CustomEvent("atelier:updated", {
    detail: { model, residual, optA, optB, optC, parcelKey: state.parcelKey }
  }));
}

function renderWaterfallAndTranchesTable(model) {
  const f = model.finance;
  const wf = f.waterfall;
  const tr = f.tranches;
  if (!wf || !tr) return;

  const badgeEl = document.getElementById("waterfallSummaryBadge");
  if (badgeEl) {
    badgeEl.textContent = `LP ${fmtDec(wf.lpIrrPct)}% (${fmtDec(wf.lpMultiple, 2)}x) · GP ${fmtDec(wf.gpIrrPct)}% (${fmtDec(wf.gpMultiple, 2)}x)`;
  }

  const totalCapital = f.loanAmountEok + f.actualEquityPaidInEok || 1;
  const senPct = (tr.seniorLoanEok / totalCapital) * 100;
  const mezPct = (tr.mezzLoanEok / totalCapital) * 100;
  const junPct = (tr.juniorLoanEok / totalCapital) * 100;
  const lpPct = (wf.lpEquityEok / totalCapital) * 100;
  const gpPct = (wf.gpEquityEok / totalCapital) * 100;

  const visEl = document.getElementById("waterfallVisualHeader");
  if (visEl) {
    visEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-secondary);">
        <span>총 자본조달 스택 (PF 선·중·후순위 + LP 우선주 + GP 보통주)</span>
        <strong style="font-family:var(--font-mono);">가중평균 PF 금리 ${fmtDec(tr.weightedDebtRatePct, 2)}% · DSCR ${fmtDec(f.dscr, 2)}x</strong>
      </div>
      <div class="waterfall-bar">
        <div class="wf-seg wf-senior" style="width:${senPct.toFixed(1)}%;" title="선순위 PF">선 ${Math.round(senPct)}%</div>
        <div class="wf-seg wf-mezz" style="width:${mezPct.toFixed(1)}%;" title="중순위 PF">중 ${Math.round(mezPct)}%</div>
        <div class="wf-seg wf-junior" style="width:${junPct.toFixed(1)}%;" title="후순위 PF">후 ${Math.round(junPct)}%</div>
        <div class="wf-seg wf-lp" style="width:${lpPct.toFixed(1)}%;" title="LP 우선주">LP ${Math.round(lpPct)}%</div>
        <div class="wf-seg wf-gp" style="width:${Math.max(3, gpPct).toFixed(1)}%;" title="GP 보통주">GP</div>
      </div>
    `;
  }

  const tbody = document.getElementById("tableWaterfallTrancheBody");
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td>[PF 선순위] Senior Tranche (대출비중 62%)</td>
        <td class="num">${fmtDec(tr.seniorLoanEok)} 억</td>
        <td class="num">연 ${fmtDec(tr.seniorRatePct, 2)}% (1순위 신탁)</td>
        <td class="num">원리금 우선상환</td>
        <td class="num">안정 (DSCR ${fmtDec(f.dscr, 2)}x)</td>
      </tr>
      <tr>
        <td>[PF 중순위] Mezzanine Tranche (대출비중 23%)</td>
        <td class="num">${fmtDec(tr.mezzLoanEok)} 억</td>
        <td class="num">연 ${fmtDec(tr.mezzRatePct, 2)}% (2순위)</td>
        <td class="num">선순위 상환 후 회수</td>
        <td class="num">LTV 적정</td>
      </tr>
      <tr>
        <td>[PF 후순위] Junior / Bridge Tranche (대출비중 15%)</td>
        <td class="num">${fmtDec(tr.juniorLoanEok)} 억</td>
        <td class="num">연 ${fmtDec(tr.juniorRatePct, 2)}% (시공사 보증)</td>
        <td class="num">중순위 상환 후 회수</td>
        <td class="num">책임준공 약정</td>
      </tr>
      <tr class="highlight-row">
        <td>[Equity 1종] LP 기관투자자 우선주 (${wf.lpSharePct}% 출자)</td>
        <td class="num">${fmtDec(wf.lpEquityEok)} 억</td>
        <td class="num">우선배당 허들 ${fmtDec(wf.lpHurdlePct, 1)}%</td>
        <td class="num"><strong>${fmtDec(wf.lpTotalDistEok)} 억</strong> (이익 +${fmtDec(wf.lpProfitEok)}억)</td>
        <td class="num" style="color:var(--accent-emerald);font-weight:800;">${fmtDec(wf.lpIrrPct)}% (${fmtDec(wf.lpMultiple, 2)}x)</td>
      </tr>
      <tr class="total-row">
        <td>[Equity 2종] GP 시행사·AMC 보통주 (${fmtDec(wf.gpSharePct, 0)}% + Promote ${wf.gpPromotePct}%)</td>
        <td class="num">${fmtDec(wf.gpEquityEok)} 억</td>
        <td class="num">${Number.isFinite(wf.gpPromoteBonusEok) ? `초과수익 성공보수 +${fmtDec(wf.gpPromoteBonusEok)}억` : `Promote ${fmtDec(wf.gpPromotePct, 0)}%`}</td>
        <td class="num"><strong>${fmtDec(wf.gpTotalDistEok)} 억</strong> (이익 +${fmtDec(wf.gpProfitEok)}억)</td>
        <td class="num" style="color:var(--accent-gold);font-weight:800;">${fmtDec(wf.gpIrrPct)}% (${fmtDec(wf.gpMultiple, 2)}x)</td>
      </tr>
    `;
  }
}

function renderParcelMergerComparison(preset, currentModel) {
  const tbody = document.getElementById("tableParcelMergerBody");
  if (!tbody) return;
  const geom = currentModel.parcelGeometry;
  const badge = document.getElementById("mergerStatusBadge");
  if (badge) badge.textContent = geom ? `${geom.featureCount}개 경계 적용 · 법적 합필 확인 전` : "실제 경계 미적용";
  const button = document.getElementById("btnQuickToggleMerger");
  if (button) { button.textContent = "필지 경계 관리 ↗"; button.onclick = () => { document.getElementById("chap-site")?.classList.add("open"); document.getElementById("parcelReview")?.scrollIntoView({block:"center"}); }; }
  if (!geom) { tbody.innerHTML = '<tr><td colspan="4">주소 검색 또는 GeoJSON 경계를 적용하면 첫 필지와 전체 합집합을 비교합니다. 경계 없는 면적 가산은 적용하지 않습니다.</td></tr>'; return; }
  const firstData = {...state.parcelData, features:[state.parcelData.features[0]]};
  const before = evaluateDesignAndProforma({...state,parcelData:firstData,parcelMerged:false}, state.option);
  const after = currentModel;
  const rows = [
    ["경계 근사 면적",before.effectiveCadastralAreaSqm,after.effectiveCadastralAreaSqm,"㎡"],
    ["지상 연면적",before.areas.aboveGroundGfaSqm,after.areas.aboveGroundGfaSqm,"㎡"],
    ["주차 배치 수용량",before.parking.capacityCount,after.parking.capacityCount,"대"],
    ["안정화 NOI",before.finance.stabilizedNoiEok,after.finance.stabilizedNoiEok,"억/년"]
  ];
  tbody.innerHTML = rows.map(([label,a,b,unit])=>`<tr><td>${label}</td><td class="num">${fmtDec(a)} ${unit}</td><td class="num">${fmtDec(b)} ${unit}</td><td class="num">${fmtDec(b-a)} ${unit} 차이</td></tr>`).join("");
}

function renderSourcesAndUsesTable(model) {
  const f = model.finance;
  const gfaPyeong = model.areas.totalGfaSqm / PYEONG_TO_SQM;
  const perPyeong = (eok) => fmtInt((eok * 10000) / gfaPyeong);
  const pct = (eok) => fmtDec((eok / f.totalDevCostEok) * 100, 1);

  document.getElementById("tableSourcesUsesBody").innerHTML = `
    <tr>
      <td>[Uses] 1. 토지비 및 취득부대비용 (4.6%)</td>
      <td class="num">${fmtDec(f.totalLandCostEok)} 억</td>
      <td class="num">${perPyeong(f.totalLandCostEok)} 만원</td>
      <td class="num">${pct(f.totalLandCostEok)} %</td>
    </tr>
    <tr>
      <td>[Uses] 2. 지상층 직접공사비 (${fmtInt(model.areas.aboveGroundGfaSqm / PYEONG_TO_SQM)}평)</td>
      <td class="num">${fmtDec(f.aboveHardCostEok)} 억</td>
      <td class="num">${perPyeong(f.aboveHardCostEok)} 만원</td>
      <td class="num">${pct(f.aboveHardCostEok)} %</td>
    </tr>
    <tr>
      <td>[Uses] 3. 지하층 공사비 + 흙막이 가시설 (B${state.floorsBelow})</td>
      <td class="num">${fmtDec(f.belowHardCostEok + f.retentionWallCostEok)} 억</td>
      <td class="num">${perPyeong(f.belowHardCostEok + f.retentionWallCostEok)} 만원</td>
      <td class="num">${pct(f.belowHardCostEok + f.retentionWallCostEok)} %</td>
    </tr>
    <tr>
      <td>[Uses] 4. 설계·감리·인허가·부담금 (Soft Cost)</td>
      <td class="num">${fmtDec(f.softCostEok)} 억</td>
      <td class="num">${perPyeong(f.softCostEok)} 만원</td>
      <td class="num">${pct(f.softCostEok)} %</td>
    </tr>
    <tr>
      <td>[Uses] 5. PF 건설이자 예비비 및 금융수수료</td>
      <td class="num">${fmtDec(f.interestReserveEok + f.loanFeeEok)} 억</td>
      <td class="num">${perPyeong(f.interestReserveEok + f.loanFeeEok)} 만원</td>
      <td class="num">${pct(f.interestReserveEok + f.loanFeeEok)} %</td>
    </tr>
    <tr class="highlight-row">
      <td>총사업비 합계 (Total Development Cost)</td>
      <td class="num">${fmtDec(f.totalDevCostEok)} 억</td>
      <td class="num">${perPyeong(f.totalDevCostEok)} 만원</td>
      <td class="num">100.0 %</td>
    </tr>
    <tr>
      <td>[Sources] 자기자본 투입 (Sponsor Equity)</td>
      <td class="num">${fmtDec(f.equityRequiredEok)} 억</td>
      <td class="num">${perPyeong(f.equityRequiredEok)} 만원</td>
      <td class="num">${fmtDec(100 - state.loanLtvPct)} %</td>
    </tr>
    <tr>
      <td>[Sources] PF 선순위/중순위 건축대출 (LTC ${state.loanLtvPct}%)</td>
      <td class="num">${fmtDec(f.loanAmountEok)} 억</td>
      <td class="num">${perPyeong(f.loanAmountEok)} 만원</td>
      <td class="num">${fmtDec(state.loanLtvPct)} %</td>
    </tr>
    <tr class="total-row">
      <td>안정화 매각가치 (Exit @ Cap ${fmtDec(state.capRatePct)}%) / 세전 개발이익</td>
      <td class="num">${fmtDec(f.netExitValueEok)} 억</td>
      <td class="num">+${fmtDec(f.netExitValueEok - f.totalDevCostEok)} 억 이익</td>
      <td class="num">YoC ${fmtDec(f.yieldOnCostPct, 2)}%</td>
    </tr>
  `;
}

function renderResidualAndSensitivity(model, residual) {
  document.getElementById("residualTargetBadge").textContent = `목표 Equity IRR ${fmtDec(state.targetIrrPct)}%`;
  const diffPyeongM = residual.maxLandPyeongM - state.landPricePyeongM;
  const diffSign = diffPyeongM >= 0 ? "+" : "";

  document.getElementById("residualLandSummaryBox").innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
      <span>현재 가정 토지매입가: <strong>${fmtDec(model.finance.landPurchaseEok)} 억원</strong> (평당 ${state.landPricePyeongM}백만)</span>
      <span>목표 할인율의 NPV=0 토지 한도: <strong style="color:#047857;">${fmtDec(residual.maxLandTotalEok)} 억원</strong> (평당 ${fmtInt(residual.maxLandPyeongM)}백만)</span>
    </div>
    <div style="color:${diffPyeongM >= 0 ? "#047857" : "#be123c"};font-weight:700;">
      ▶ 목표 수익률(IRR ${fmtDec(state.targetIrrPct)}%) 달성을 위한 토지 가격 안전마진: <strong>평당 ${diffSign}${fmtInt(diffPyeongM)}백만원 (${diffSign}${fmtDec((residual.maxLandTotalEok - model.finance.landPurchaseEok))}억원)</strong>
    </div>
  `;

  const capDeltas = [-0.4, 0.0, 0.4];
  const costMultipliers = [0.90, 1.00, 1.10];

  const rowsHtml = capDeltas.map(cd => {
    const capVal = Math.max(2.5, state.capRatePct + cd);
    const cells = costMultipliers.map(cm => {
      const cloned = { ...state, capRatePct: capVal, constCostPyeongMan: state.constCostPyeongMan * cm };
      const sim = evaluateDesignAndProforma(cloned, state.option);
      const isCenter = cd === 0.0 && cm === 1.00;
      return `<td class="num" style="${isCenter ? "color:#1d4ed8;font-weight:800;background:rgba(37,99,235,0.06);" : ""}">${fmtDec(sim.finance.equityXirrPct)}% (${fmtDec(sim.finance.npv8Eok)}억)</td>`;
    }).join("");
    return `<tr><td>Cap ${fmtDec(capVal, 1)}%</td>${cells}</tr>`;
  });

  document.getElementById("tableSensitivityBody").innerHTML = rowsHtml.join("");
}

function renderGuardrails(model, residual) {
  const f = model.finance;
  const items = [
    {
      label: "용도지역별 주용도·복합용도 검토 (개별 필지 확인 전)",
      val: `${model.usePermission.label} · ${model.usePermission.status === "prohibited" ? "모형·사업성은 가정 비교용" : "지구단위계획·개별 승인 추가 확인"}`,
      status: model.usePermission.status === "prohibited" ? "fail" : "warn"
    },
    {
      label: `법정 용적률·건폐율 적합성 (서울시 조례 ${model.zoningRule.ordinanceArticle})`,
      val: `건폐 ${fmtDec(model.areas.achievedBcrPct)}% / 용적 ${fmtDec(model.areas.achievedFarPct)}% (상한 ${fmtDec(model.zoningRule.maxFar, 0)}%)`,
      status: model.areas.achievedFarPct <= model.zoningRule.maxFar + 1e-6 && model.areas.achievedBcrPct <= model.zoningRule.maxBcr + 1e-6 ? "pass" : "fail"
    },
    {
      label: "개발 스프레드 (Development Spread = YoC - Exit Cap ≥ 100 bps)",
      val: `${f.devSpreadBps} bps (YoC ${fmtDec(f.yieldOnCostPct, 2)}% vs Cap ${fmtDec(state.capRatePct, 1)}%)`,
      status: f.devSpreadBps >= 100 ? "pass" : (f.devSpreadBps >= 40 ? "warn" : "fail")
    },
    {
      label: "목표 자기자본 수익률 (Equity XIRR ≥ Target IRR)",
      val: `달성 ${fmtDec(f.equityXirrPct)}% vs 목표 ${fmtDec(state.targetIrrPct)}%`,
      status: f.equityXirrPct >= state.targetIrrPct ? "pass" : "warn"
    },
    {
      label: "토지 매입가 적정성 (현재 매입가 ≤ 역산 최대 토지한도)",
      val: `현재 평당 ${state.landPricePyeongM}백만 vs 한도 ${fmtInt(residual.maxLandPyeongM)}백만`,
      status: residual.maxLandPyeongM >= state.landPricePyeongM ? "pass" : "fail"
    }
  ];

  document.getElementById("guardrailListContainer").innerHTML = items.map(it => `
    <div class="guardrail-item ${it.status}">
      <span>${it.label}</span>
      <strong style="font-family:var(--font-mono);">${it.val}</strong>
    </div>
  `).join("");
}

function renderLegalSources() {
  const box = document.getElementById("legalEvidenceList");
  if (!box || !window.AtelierLegal) return;
  box.replaceChildren();
  const note = document.createElement("p"); note.className = "legal-note";
  note.textContent = "법령 MCP·공식 원문 검토: " + window.AtelierLegal.checkedAt + ". 계산은 아래 시행 버전을 사용합니다. 법령 개정을 자동 반영하는 실시간 서비스는 아닙니다.";
  box.append(note);
  [...window.AtelierLegal.sources, ...(window.AtelierUsePermissions?.sources || [])].forEach(source => {
    const link = document.createElement("a"); link.href = source.url;
    link.target = "_blank"; link.rel = "noopener noreferrer";
    link.textContent = source.title + " · 시행 " + source.effectiveDate + " ↗";
    box.append(link);
  });
}

function renderLegalMassSummary(model) {
  const box = document.getElementById("legalMassSummary");
  if (!box) return;
  box.replaceChildren();
  const heading = document.createElement("strong");
  heading.textContent = "적용 결과 · " + model.actualFloorsAbove + "층 / 요청 " + model.requestedFloorsAbove + "층";
  const values = document.createElement("p");
  values.textContent = "건폐 " + fmtDec(model.areas.achievedBcrPct) + " / " + model.zoningRule.maxBcr + "% · 용적 " + fmtDec(model.areas.achievedFarPct) + " / " + model.zoningRule.maxFar + "% · 높이 " + fmtDec(model.buildingHeightM) + "m";
  const parking = document.createElement("p");
  parking.textContent = "주차 수용 추정 " + model.parking.capacityCount + "대 / 계획 " + model.parking.plannedParkingCount + "대 / 최소 " + model.parking.legalParkingCount + "대"
    + (model.parking.legalMaxParkingCount !== null ? " / 적용 최고 " + model.parking.legalMaxParkingCount + "대" : "")
    + (model.parking.deficit ? " · " + model.parking.deficit + "대 부족" : "");
  box.append(heading, values, parking);
  const basis = document.getElementById("regulationBasisSummary");
  if (basis) basis.textContent = `${model.regulationMode === "scenario" ? "사용자 비교 조건" : "법정 기준"} · 건폐 상한 ${model.zoningRule.maxBcr}% / 용적 상한 ${model.zoningRule.maxFar}% · `
    + (model.parcelRegulationReview?.planLimitsApplied ? "확인된 개별 고시 상한 반영" : "개별 고시 상한 미확인")
    + ` · 밀도 기준 MCP 검토 ${window.AtelierLegal?.densityCheckedAt || window.AtelierLegal?.checkedAt || "확인 전"}`
    + (model.regulationMode === "statutory" ? " · 저장된 비교 제한 미적용" : "");
  const coordination = document.createElement("p");
  coordination.textContent = `공통 코어 ${model.coreLayout?.status === "reserved" ? "예약 공간 정합" : "배치 미완료"} · 주차 ${model.parking.layout?.statusLabel || "배치 미완료"}`
    + (model.constraints.parkingFitDeferred ? " · 주차 미확보로 자동 매스 축소 보류" : "");
  box.append(coordination);
  if (model.parcelRegulationReview) {
    const review = model.parcelRegulationReview, note = document.createElement("p");
    note.className = "legal-mass-change";
    note.textContent = review.applied ? `조회 용도지역 ${review.inputs.zoning} · ${model.regulationMode === "scenario" ? "사용자 비교 제한 적용" : "법령 MCP 검토 일반 기준 적용"} · ${review.planLimitsApplied ? "확인된 강화 상한 반영" : "지구단위계획 세부 상한 확인 전"}` : "용도지역 혼재·미확인 또는 미지원 조건: 현재 매스는 입력값의 비교 시나리오입니다.";
    box.append(note);
  }
  if (model.constraints.parkingReducedAreaSqm > 0.01) {
    const change = document.createElement("p"); change.className = "legal-mass-change";
    change.textContent = "주차를 반영해 지상 " + fmtInt(model.constraints.unconstrainedFarAreaSqm) + " → " + fmtInt(model.areas.aboveGroundGfaSqm) + "㎡ (" + fmtInt(model.constraints.parkingReducedAreaSqm) + "㎡ 감소)";
    box.append(change);
  }
  const warnings = [...new Set([...model.constraints.warnings, ...model.parking.warnings])];
  const disclosure = document.createElement("details");
  const summary = document.createElement("summary"); summary.textContent = "적용 가정·추가 확인 " + warnings.length + "건";
  const list = document.createElement("ul");
  warnings.forEach(text => { const item = document.createElement("li"); item.textContent = text; list.append(item); });
  disclosure.append(summary, list); box.append(disclosure);
}

function renderSiteEvidenceTable(preset, model) {
  const safeText = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  document.getElementById("tableSiteEvidenceBody").innerHTML = `
    <tr>
      <td>개념 필지 예시 / 위치</td>
      <td class="num">${model.parcelGeometry ? (model.parcelGeometry.pnus.join(" + ") || "PNU 미확인") : preset.pnu + " (예시)"} (${safeText(model.parcelGeometry?.addresses.join(" + ") || preset.name)})</td>
    </tr>
    <tr>
      <td>지구단위계획 및 도시관리계획</td>
      <td class="num">${model.parcelGeometry ? safeText(model.parcelRegulationReview?.districtPlans.map(p => p.name).join(" · ") || "지구단위계획 명칭 미확인") + " · 개별 상한 확인 전" : preset.districtPlan + " (예시)"} (${state.zoning})</td>
    </tr>
    <tr>
      <td>계산 적용 근거 / 확인 상태</td>
      <td class="num">법령 MCP 검토 ${window.AtelierLegal.checkedAt} · 서울 조례 일반 기준<br>개별 PNU 경계·지구단위 고시 미확인</td>
    </tr>
    <tr>
      <td>일조권 사선제한 (건축법 제61조·시행령 제86조)</td>
      <td class="num">${model.northSolarApplies ? "일반 기준 적용: 높이 10m 이하 1.5m / 초과 H/2 · 예외 별도 확인" : "정북 일조 일반 기준 미적용 · 공동주택 채광·동간거리 별도 검토"}</td>
    </tr>
    <tr>
      <td>3D 도시공간 대조 출처</td>
      <td class="num">서울시 S-Map (smap.seoul.go.kr) · WGS84 (${model.parcelGeometry?.centerWgs84[1] ?? preset.lat}, ${model.parcelGeometry?.centerWgs84[0] ?? preset.lng})</td>
    </tr>
  `;
}

function renderOptionAndRemodelComparison(preset, currentModel, optA, optB, optC) {
  document.getElementById("tableOptionCompareBody").innerHTML = `
    <tr>
      <td>용적률산정 연면적 / 달성 용적률</td>
      <td class="num">${fmtInt(optA.areas.farCountedGfaSqm)}㎡ (${fmtDec(optA.areas.achievedFarPct)}%)</td>
      <td class="num">${fmtInt(optB.areas.farCountedGfaSqm)}㎡ (${fmtDec(optB.areas.achievedFarPct)}%)</td>
      <td class="num">${fmtInt(optC.areas.farCountedGfaSqm)}㎡ (${fmtDec(optC.areas.achievedFarPct)}%)</td>
    </tr>
    <tr>
      <td>전용면적 (전용률)</td>
      <td class="num">${fmtInt(optA.areas.netAreaSqm)}㎡ (${fmtDec(optA.areas.netEfficiencyPct)}%)</td>
      <td class="num">${fmtInt(optB.areas.netAreaSqm)}㎡ (${fmtDec(optB.areas.netEfficiencyPct)}%)</td>
      <td class="num">${fmtInt(optC.areas.netAreaSqm)}㎡ (${fmtDec(optC.areas.netEfficiencyPct)}%)</td>
    </tr>
    <tr>
      <td>총사업비 (Total Cost)</td>
      <td class="num">${fmtDec(optA.finance.totalDevCostEok)} 억원</td>
      <td class="num">${fmtDec(optB.finance.totalDevCostEok)} 억원</td>
      <td class="num">${fmtDec(optC.finance.totalDevCostEok)} 억원</td>
    </tr>
    <tr>
      <td>안정화 연간 순영업소득 (NOI)</td>
      <td class="num">${fmtDec(optA.finance.stabilizedNoiEok)} 억원</td>
      <td class="num">${fmtDec(optB.finance.stabilizedNoiEok)} 억원</td>
      <td class="num">${fmtDec(optC.finance.stabilizedNoiEok)} 억원</td>
    </tr>
    <tr class="highlight-row">
      <td>Equity XIRR (자기자본 내부수익률)</td>
      <td class="num">${fmtDec(optA.finance.equityXirrPct)} %</td>
      <td class="num">${fmtDec(optB.finance.equityXirrPct)} %</td>
      <td class="num">${fmtDec(optC.finance.equityXirrPct)} %</td>
    </tr>
    <tr>
      <td>순현재가치 (NPV @8%) / 배수(EM)</td>
      <td class="num">${fmtDec(optA.finance.npv8Eok)}억 (${fmtDec(optA.finance.equityMultiple, 2)}x)</td>
      <td class="num">${fmtDec(optB.finance.npv8Eok)}억 (${fmtDec(optB.finance.equityMultiple, 2)}x)</td>
      <td class="num">${fmtDec(optC.finance.npv8Eok)}억 (${fmtDec(optC.finance.equityMultiple, 2)}x)</td>
    </tr>
  `;

  if (currentModel.parcelGeometry) {
    document.getElementById("tableRemodelCompareBody").innerHTML = `<tr><td>기존 건물 자료</td><td class="num">신축 기획 매스 ${currentModel.actualFloorsAbove}층</td><td class="num">건축물대장·구조 조사 미연결</td><td class="num">구조 등급·리모델링 수익률 미산정</td></tr>`;
    return;
  }
  const ex = preset.existingBuilding;
  const remodelGfaSqm = Math.min(currentModel.areas.totalGfaSqm * 0.92, ex.existingGfaSqm * 1.15);
  const remodelConstEok = currentModel.finance.totalHardCostEok * 0.52;
  const remodelTotalCostEok = currentModel.finance.totalLandCostEok + remodelConstEok * 1.18;
  const remodelMonths = Math.max(12, Math.round(currentModel.finance.totalMonths * 0.58));

  document.getElementById("tableRemodelCompareBody").innerHTML = `
    <tr>
      <td>기존 건물 현황 (예시 · ${ex.builtYear}년)</td>
      <td class="num">철거 후 신축 (${currentModel.actualFloorsAbove}F/B${state.floorsBelow})</td>
      <td class="num">기존 ${ex.existingFloors} (용적 ${ex.existingFarPct}%) 대수선</td>
      <td class="num">${ex.structuralGrade}</td>
    </tr>
    <tr>
      <td>총연면적 (GFA)</td>
      <td class="num">${fmtInt(currentModel.areas.totalGfaSqm)} ㎡</td>
      <td class="num">${fmtInt(remodelGfaSqm)} ㎡</td>
      <td class="num">${fmtInt(currentModel.areas.totalGfaSqm - remodelGfaSqm)} ㎡ 차이</td>
    </tr>
    <tr>
      <td>공사비 및 총사업비</td>
      <td class="num">총 ${fmtDec(currentModel.finance.totalDevCostEok)}억 (공사 ${fmtDec(currentModel.finance.totalHardCostEok)}억)</td>
      <td class="num">총 ${fmtDec(remodelTotalCostEok)}억 (공사 ${fmtDec(remodelConstEok)}억)</td>
      <td class="num">흙막이·지하토공 절감</td>
    </tr>
    <tr>
      <td>총 사업기간 (인허가+착공+임대)</td>
      <td class="num">${currentModel.finance.totalMonths} 개월</td>
      <td class="num">${remodelMonths} 개월</td>
      <td class="num">${currentModel.finance.totalMonths - remodelMonths}개월 단축</td>
    </tr>
    <tr class="highlight-row">
      <td>Equity XIRR / Yield on Cost</td>
      <td class="num">${fmtDec(currentModel.finance.equityXirrPct)}% (YoC ${fmtDec(currentModel.finance.yieldOnCostPct, 2)}%)</td>
      <td class="num">미산정 · 별도 임대차·투자비·월별 현금흐름 필요</td>
      <td class="num">우위 판단 보류 · 위 면적·비용·기간은 예시 비율 개산</td>
    </tr>
  `;
}

// ============================================================================
// 8. LIVE LAW.GO.KR API LOOKUP (LAW_OC=wanhee) & PYTHON SKILLS VERIFICATION
// ============================================================================
async function fetchLiveLawArticle() {
  const box = document.getElementById("lawResultContainer");
  const [target, query, article] = document.getElementById("selectLawPreset").value.split("|");
  box.textContent = query + " " + article + " 원문을 조회하고 있습니다.";
  try {
    const url = "/api/law-lookup?target=" + encodeURIComponent(target) + "&query=" + encodeURIComponent(query) + "&article=" + encodeURIComponent(article);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("조회 서버 응답 " + resp.status);
    const data = await resp.json();
    if (data.error) throw new Error(String(data.error));
    window.AtelierStudyReviewSnapshot?.recordLawLookup({ target, query, article }, { status: "retrieved", data, fetchedAt: new Date().toISOString() });
    const articles = data.articles || data.matched_articles || [];
    const usable = articles.filter(a => String(a.content || "").trim() || a.paragraphs?.length);
    box.replaceChildren();
    const note = document.createElement("p");
    note.textContent = usable.length ? "조회 원문입니다. 계산에는 2026-10-20 검토한 법령 버전을 사용하며 원문 조회만으로 수치를 자동 변경하지 않습니다." : "조문 본문을 받지 못했습니다. 조회 메타데이터만으로 법규 확인 완료를 표시하지 않습니다. 아래 적용 근거의 공식 원문을 확인하세요.";
    box.append(note);
    usable.forEach(a => {
      const card = document.createElement("article");
      card.className = "law-article-card";
      const title = document.createElement("h4"); title.className = "law-article-title";
      title.textContent = (a.article_no ? "제" + a.article_no + "조 " : "") + (a.title || a.article_title || query);
      const body = document.createElement("p"); body.className = "law-article-body";
      body.textContent = [a.content || "", ...(a.paragraphs || [])].join("\n").trim().slice(0, 4000);
      card.append(title, body); box.append(card);
    });
  } catch (err) {
    window.AtelierStudyReviewSnapshot?.recordLawLookup({ target, query, article }, { status: "failed", data: null, fetchedAt: new Date().toISOString() });
    box.textContent = "원문 조회를 완료하지 못했습니다: " + err.message + ". 아래 검토 근거의 공식 원문을 이용하세요.";
  }
}

async function syncZoningLawFromMinistry() {
  const btn = document.getElementById("btnSyncZoningLaw");
  const badge = document.getElementById("lawApiBadge");
  if (btn) btn.textContent = "적용 근거 확인 중";
  renderLegalSources();
  try {
    const resp = await fetch("law-evidence/manifest.json", { cache: "no-store" });
    if (!resp.ok) throw new Error("근거 파일 응답 " + resp.status);
    const data = await resp.json();
    if (data.status !== "REVIEWED_SNAPSHOT" || data.checkedAt !== window.AtelierLegal.checkedAt || !Array.isArray(data.sources)) throw new Error("근거 버전 불일치");
    state.lawSyncedMeta = data;
    if (btn) btn.textContent = "MCP 검토 근거 · " + data.checkedAt;
    if (badge) badge.textContent = "법령 검토 " + data.checkedAt;
  } catch (err) {
    if (btn) btn.textContent = "내장 검토 기준 · 원문 파일 조회 실패";
    if (badge) badge.textContent = "법령 원문 재확인 필요";
  }
}

async function verifyWithPythonSkillsBackend() {
  const btn = document.getElementById("btnVerifyPythonSkills");
  if (!state.lastComputed) return;
  const m = state.lastComputed.model;

  btn.textContent = "⏳ Python 검증 중...";
  const zoneMap = {
    "일반상업지역": "general_commercial",
    "중심상업지역": "central_commercial",
    "근린상업지역": "neighborhood_commercial",
    "준공업지역": "semi_industrial",
    "준주거지역": "semi_residential",
    "제3종일반주거지역": "type3_general_residential",
    "제2종일반주거지역": "type2_general_residential"
  };
  try {
    const payload = {
      site_area: state.siteAreaSqm,
      road_setback: 0,
      public_contribution_area: m.zoningRule.publicContribSqm || 0,
      seoul_downtown: state.seoulDowntown,
      zone: zoneMap[state.zoning] || "general_commercial",
      building_use: state.buildingUse.includes("업무") ? "office" : (state.buildingUse.includes("공동주택") ? "apartment" : "retail"),
      bcr_pct: m.areas.achievedBcrPct,
      far_pct: m.areas.achievedFarPct,
      ground_floors: m.actualFloorsAbove,
      floor_height_m: state.floorHeight,
      width_m: m.siteWidthM,
      depth_m: m.siteDepthM,
      facade_type: state.facadeType,
      wwr_pct: state.facadeWwrPct,
      bay_width_m: state.facadeBayM,
      louver_depth_m: state.facadeLouverM,
      core_ratio: 1.0 - (m.areas.netEfficiencyPct / 100),
      land_cost_krw_per_pyeong: state.landPricePyeongM * 1000000,
      rent_krw_per_contract_pyeong: state.rentPyeongMan * 10000,
      exit_cap_rate_pct: state.capRatePct
    };
    const resp = await fetch("/api/calculate-skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const res = await resp.json();
    window.AtelierStudyReviewSnapshot?.recordAuxiliary(m, { status: res.status === "ok" ? "retrieved" : "failed", inputs: payload, response: res, fetchedAt: new Date().toISOString(), isCurrentDashboardResult: false });
    if (res.status === "ok") {
      const pyFar = res.area_parking?.korean_8_area_table?.["4_far_countable_gfa_m2"] || 0;
      const pyOrdLimit = res.area_parking?.zoning_and_density?.ordinance_limit_far_pct || 0;
      const pyFacadeEok = res.facade_envelope?.energy_and_cost_impact?.total_facade_cost_eok || 0;
      btn.textContent = `보조 계산 참조 · 외장 ${pyFacadeEok}억 / 면적 ${Math.round(pyFar)}㎡ (적용 법규 계산과 별도)`;
      btn.className = "btn";
    } else {
      btn.textContent = "⚠ 검증 응답 확인";
    }
  } catch (e) {
    btn.textContent = "보조 계산 조회 실패 · 검토 기준 계산 유지";
  }
}

// ============================================================================
// 9. 1-MINUTE 3D WALKTHROUGH VIDEO RECORDER (WITH HUD BURN-IN) & IFC 4.0 SOLID BIM EXPORTER
// ============================================================================
let mediaRecorder = null;
let recordedChunks = [];
let walkthroughTimer = null;
let burnInCanvas = null;
let burnInCtx = null;

function startOrStopVideoWalkthrough() {
  const btn = document.getElementById("btnRecordVideo");
  const banner = document.getElementById("narrationBanner");

  if (state.isRecording) {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    clearInterval(walkthroughTimer);
    state.isRecording = false;
    btn.classList.remove("recording");
    btn.textContent = "🎬 1분 영상";
    banner.classList.add("hidden");
    return;
  }

  const webglCanvas = document.getElementById("threeCanvas");
  burnInCanvas = document.createElement("canvas");
  burnInCanvas.width = webglCanvas.width || 1280;
  burnInCanvas.height = webglCanvas.height || 720;
  burnInCtx = burnInCanvas.getContext("2d");

  const stream = burnInCanvas.captureStream(30);
  recordedChunks = [];

  let mimeType = "video/webm;codecs=vp9";
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = "video/webm";
  }

  mediaRecorder = new MediaRecorder(stream, { mimeType });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `seoul-3d-atelier-walkthrough-${state.parcelKey}.webm`;
    a.click();
  };

  mediaRecorder.start(200);
  state.isRecording = true;
  btn.classList.add("recording");
  btn.textContent = "⏹ 녹화저장 (.webm)";
  banner.classList.remove("hidden");

  const startTime = Date.now();
  const totalDurationMs = 60000;

  walkthroughTimer = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(1.0, elapsed / totalDurationMs);
    document.getElementById("narrationProgressBar").style.width = `${(progress * 100).toFixed(1)}%`;

    const angle = progress * Math.PI * 2.2;
    const radius = 102;
    camera.position.x = Math.cos(angle) * radius;
    camera.position.z = Math.sin(angle) * radius;
    camera.position.y = 55 + Math.sin(progress * Math.PI * 2) * 20;
    controls.target.set(0, 24, 0);

    const m = state.lastComputed.model;
    const r = state.lastComputed.residual;
    const stepEl = document.getElementById("narrationStep");
    const textEl = document.getElementById("narrationText");

    if (progress < 0.20) {
      if (state.option !== "A" || state.viewMode !== "envelope") {
        state.option = "A";
        state.viewMode = "envelope";
        syncOptionButtons();
        updateAllCalculationsAndUI();
      }
      stepEl.textContent = "STEP 1 / 5 · 서울시 필지 조건 및 법적 한계 볼륨 (Option A)";
      textEl.textContent = `${SEOUL_PARCELS[state.parcelKey].name} (${state.zoning}) | 건폐율 ${fmtDec(m.areas.achievedBcrPct)}%, 용적률 ${fmtDec(m.areas.achievedFarPct)}% 및 일조사선 3D 검증`;
    } else if (progress < 0.40) {
      if (state.option !== "B" || state.viewMode !== "standard") {
        state.option = "B";
        state.viewMode = "standard";
        syncOptionButtons();
        updateAllCalculationsAndUI();
      }
      stepEl.textContent = "STEP 2 / 5 · 대안 B (중정·스텝 테라스형)";
      textEl.textContent = `자연채광 중정 및 테라스 조경 대안 · 임대료 자동 가산 없음 | 안정화 NOI 연 ${fmtDec(m.finance.stabilizedNoiEok)}억원`;
    } else if (progress < 0.60) {
      if (state.option !== "C") {
        state.option = "C";
        syncOptionButtons();
        updateAllCalculationsAndUI();
      }
      stepEl.textContent = "STEP 3 / 5 · 대안 C (정북측 편심코어 배치 및 전용률 극대화)";
      textEl.textContent = `북측 편심코어로 남향 업무공간 확보 | 전용률 ${fmtDec(m.areas.netEfficiencyPct)}%, 임대 전용면적 ${fmtInt(m.areas.netAreaSqm)}㎡`;
    } else if (progress < 0.80) {
      if (state.viewMode !== "exploded") {
        state.viewMode = "exploded";
        updateAllCalculationsAndUI();
      }
      stepEl.textContent = "STEP 4 / 5 · 층별 분리(Exploded) · 수직 코어 · 지하 주차장(B1~B" + state.floorsBelow + ") 검증";
      textEl.textContent = `서울시 조례 계획주차 ${m.parking.plannedParkingCount}대 | 총사업비 ${fmtDec(m.finance.totalDevCostEok)}억원 (PF 대출 ${fmtDec(m.finance.loanAmountEok)}억원)`;
    } else if (progress < 1.0) {
      if (state.viewMode !== "standard" || state.option !== "A") {
        state.option = "A";
        state.viewMode = "standard";
        syncOptionButtons();
        updateAllCalculationsAndUI();
      }
      stepEl.textContent = "STEP 5 / 5 · 월별 S-Curve 현금흐름 · LP/GP 워터폴 · 최대 토지매입한도 역산";
      textEl.textContent = `Equity XIRR ${fmtDec(m.finance.equityXirrPct)}% (LP ${fmtDec(m.finance.waterfall.lpIrrPct)}% · GP ${fmtDec(m.finance.waterfall.gpIrrPct)}%) | 토지매입한도 ${fmtDec(r.maxLandTotalEok)}억원`;
    } else {
      startOrStopVideoWalkthrough();
      return;
    }

    // Composite 3D WebGL + Magazine HUD Burn-in onto recording canvas
    if (burnInCtx && renderer) {
      renderer.render(scene, camera);
      const cw = burnInCanvas.width;
      const ch = burnInCanvas.height;
      burnInCtx.clearRect(0, 0, cw, ch);
      burnInCtx.drawImage(webglCanvas, 0, 0, cw, ch);

      // Top Magazine Masthead Burn-in Strip
      burnInCtx.fillStyle = "rgba(18, 22, 31, 0.84)";
      burnInCtx.fillRect(0, 0, cw, 54);
      burnInCtx.strokeStyle = "rgba(184, 134, 11, 0.65)";
      burnInCtx.lineWidth = 2;
      burnInCtx.beginPath();
      burnInCtx.moveTo(0, 54);
      burnInCtx.lineTo(cw, 54);
      burnInCtx.stroke();

      burnInCtx.fillStyle = "#f59e0b";
      burnInCtx.font = "700 15px 'Space Grotesk', sans-serif";
      burnInCtx.fillText("FORMEQUA · ISSUE № 04", 24, 33);

      burnInCtx.fillStyle = "#f8fafc";
      burnInCtx.font = "600 14px 'JetBrains Mono', sans-serif";
      const kpiText = `Option ${state.option} | 연면적 ${fmtInt(m.areas.totalGfaSqm)}㎡ | 총사업비 ${fmtDec(m.finance.totalDevCostEok)}억 | Equity IRR ${fmtDec(m.finance.equityXirrPct)}% | 토지한도 ${fmtDec(r.maxLandTotalEok)}억`;
      burnInCtx.fillText(kpiText, cw - burnInCtx.measureText(kpiText).width - 24, 33);

      // Bottom Editorial Subtitle Burn-in Box
      const boxH = 84;
      burnInCtx.fillStyle = "rgba(18, 22, 31, 0.88)";
      burnInCtx.fillRect(24, ch - boxH - 20, cw - 48, boxH);
      burnInCtx.strokeStyle = "#b8860b";
      burnInCtx.strokeRect(24, ch - boxH - 20, cw - 48, boxH);

      burnInCtx.fillStyle = "#fbbf24";
      burnInCtx.font = "700 15px 'SUIT Variable', sans-serif";
      burnInCtx.fillText(stepEl.textContent, 44, ch - boxH + 12);

      burnInCtx.fillStyle = "#f8fafc";
      burnInCtx.font = "500 16px 'SUIT Variable', sans-serif";
      burnInCtx.fillText(textEl.textContent, 44, ch - boxH + 42);

      // Progress bar inside burn-in
      burnInCtx.fillStyle = "#10b981";
      burnInCtx.fillRect(26, ch - 26, (cw - 52) * progress, 4);
    }
  }, 80);
}

function exportIfc4Model() {
  if (!state.lastComputed) return;
  if (!window.AtelierMassIfc) { window.alert("IFC 내보내기 모듈을 불러오지 못했습니다. 새로고침해 주세요."); return; }
  const m = state.lastComputed.model;
  try {
    const source = window.AtelierMassIfc.buildIfc(m, { parcelKey: state.parcelKey, option: state.option,
      floorsBelow: state.floorsBelow, floorHeight: state.floorHeight, facadeName: m.facade?.nameKr });
    const blob = new Blob([source], { type: "application/x-step" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = `formequa-mass-${state.parcelKey}-option-${state.option}.ifc`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { window.alert("IFC를 저장하지 못했습니다. " + error.message); }
}

function exportProformaAndReport() {
  if (!state.lastComputed) return;
  const { model: m, residual: r } = state.lastComputed;
  const preset = SEOUL_PARCELS[state.parcelKey];

  let csvRows = [
    ["월차(Month)", "총사업비지출(억원)", "금융비제외사업지출(억원)", "건설금융비배분_추정(억원)", "PF대출인출(억원)", "운영기PF이자_전체트랜치(억원)", "프로젝트현금흐름_Unlevered(억원)", "자기자본현금흐름_Levered(억원)", "LP현금흐름(억원)", "GP현금흐름(억원)"]
  ];
  for (let i = 0; i < m.finance.totalMonths; i++) {
    csvRows.push([
      `M${i + 1}`,
      m.finance.monthlyUses[i].toFixed(3),
      m.finance.monthlyUnleveredUses[i].toFixed(3),
      m.finance.monthlyCapitalizedFinancing[i].toFixed(3),
      m.finance.monthlyDebtDraw[i].toFixed(3),
      m.finance.monthlyOperatingDebtInterest[i].toFixed(3),
      m.finance.monthlyProjectCf[i].toFixed(3),
      m.finance.monthlyEquityCf[i].toFixed(3),
      m.finance.monthlyLpCf[i].toFixed(3),
      m.finance.monthlyGpCf[i].toFixed(3)
    ]);
  }
  const csvContent = "\uFEFF" + csvRows.map(row => row.join(",")).join("\n");
  const csvBlob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const csvLink = document.createElement("a");
  csvLink.href = URL.createObjectURL(csvBlob);
  csvLink.download = `seoul-proforma-cashflow-${state.parcelKey}-option-${state.option}.csv`;
  csvLink.click();

  const wf = m.finance.waterfall;
  const tr = m.finance.tranches;
  const reportGeneratedAt = new Date().toISOString();
  const reportEngineVersion = "2026-10-21-audit1";
  // A report contains allowlisted editable inputs. Never serialize the full
  // application state: it also contains runtime caches and may hold credentials.
  let reportInputs = null;
  let reportInputBasis = "프로젝트 허용목록으로 선별한 입력";
  if (typeof window.AtelierWorkspace?.sanitize === "function") {
    try { reportInputs = window.AtelierWorkspace.sanitize(state); } catch (_) { /* Use the limited allowlist below. */ }
  }
  if (!reportInputs) {
    reportInputBasis = "작업공간 브리지 미가용: 기본 금융·설계 허용목록만 포함, 필지 기하·실별 조건은 별도 프로젝트 파일로 확인";
    reportInputs = {};
    const enums = {
      parcelKey: Object.keys(SEOUL_PARCELS), option: ["A", "B", "C"],
      buildingUse: ["업무시설(오피스)", "업무시설(오피스텔)", "숙박시설(호텔)", "공동주택(주상복합)", "지식산업센터", "근린생활시설(리테일)", "판매시설"],
      zoning: ["일반상업지역", "중심상업지역", "근린상업지역", "준공업지역", "준주거지역", "제3종일반주거지역", "제2종일반주거지역"],
      regulationMode: ["statutory", "scenario"], financeMode: ["rental", "hotel"], hotelType: ["unconfirmed", "general", "tourist"],
      coreType: ["center", "north", "split"], parkingMode: ["fit", "report"], parkingDistrict: ["unconfirmed", "standard", "restricted"],
      residentialType: ["apartment", "officetel"], housingPermitType: ["building_permit", "housing_approval"],
      spaceProgram: ["standard", "coliving"], mixedUseProfile: ["office_retail", "mixed_resi", "knowledge_ind", "flagship_hq"],
      facadeType: Object.keys(FACADE_ARCHETYPES), claddingMaterial: Object.keys(CLADDING_MATERIALS)
    };
    for (const [key, values] of Object.entries(enums)) if (values.includes(state[key])) reportInputs[key] = state[key];
    for (const key of ("siteAreaSqm roadWidthM publicContribPct legalFarCapPct legalBcrCapPct maxHeightM floorsAbove floorsBelow floorHeight targetBcr setbackM setbackSideM setbackRearM housingUnitAreaSqm housingUnits facadeWwrPct facadeBayM facadeLouverM landPricePyeongM constCostPyeongMan rentPyeongMan capRatePct loanLtvPct loanRatePct lpSharePct lpHurdlePct gpPromotePct targetIrrPct hotelAdrKrw hotelOccupancyPct hotelRoomsOverride hotelAncillaryRevenuePct hotelOpexPct hotelFixedOpexEok hotelFfeReservePct hotelManagementFeePct hotelTwinPct hotelSuitePct hotelServiceEveryRooms hotelTwinAdrFactor hotelSuiteAdrFactor").split(" ")) {
      if (typeof state[key] === "number" && Number.isFinite(state[key])) reportInputs[key] = state[key];
    }
    for (const key of ["northSolar", "seoulDowntown", "parcelMerged"]) if (typeof state[key] === "boolean") reportInputs[key] = state[key];
  }
  const reportInputJson = JSON.stringify(reportInputs, null, 2);
  const incomeAssumptions = m.finance.income?.assumptions || [];
  const incomeWarnings = m.finance.income?.warnings || [];
  const unresolved = [...new Set([
    ...m.constraints.warnings, ...m.parking.warnings, ...incomeWarnings,
    "공부상 면적·확정측량 및 개별 지구단위·정비계획 고시의 적용조건",
    "건축물대장·구조·설비·피난·소방·접근성·에너지의 전문 검토",
    "임대차 현황표·임대료 부과면적·시장 비교사례·호텔 실제 운영자료",
    "공종별 견적·공사비지수 기준시점·철거 및 명도비·세금 및 부담금·대출과 펀드 약정",
    "기존 수작업 검토와의 실증 비교 및 법규·계산 판본의 장기 이력 데이터베이스"
  ])];

  const reportMd = `# 서울시 3D 건축기획 및 개발사업수지 사전검토 보고서 (FORMEQUA Issue № 04)
- **검토 기준일 / 생성시각**: ${reportGeneratedAt} (UTC)
- **코드 버전 / 엔진 검토 버전**: ${reportEngineVersion} (명시적 검토 식별자이며 Git 커밋 SHA가 아닙니다)
- **검토 대상 필지**: ${m.parcelGeometry?.addresses.join(" + ") || preset.name} (PNU: ${m.parcelGeometry ? (m.parcelGeometry.pnus.join(" + ") || "미확인") : preset.pnu + " (예시)"})
- **용도지역 입력 / 지구단위계획**: ${state.zoning} / ${m.parcelGeometry ? (m.parcelRegulationReview?.districtPlans.map(p => p.name).join(" · ") || "명칭 미확인") + " · 개별 상한 확인 전" : preset.districtPlan + " (예시)"}
- **선택 대안 및 외관**: Option ${state.option} (생성 지상 ${m.actualFloorsAbove}층 / 요청 ${state.floorsAbove}층 / 지하 ${state.floorsBelow}층, 최고높이 ${fmtDec(m.buildingHeightM)}m) · 외관 ${m.facade.nameKr} (${m.facade.claddingShortKr})
- **법령 적용 버전**: ${window.AtelierLegal.checkedAt} 법령 MCP·공식 원문 검토 스냅샷. 개별 필지 경계·고시 및 그 밖의 인허가 기준 미확정.
- **주차 검토**: 최소 ${m.parking.legalParkingCount}대 / 계획 ${m.parking.plannedParkingCount}대 / 지하 수용 추정 ${m.parking.capacityCount}대 / 부족 ${m.parking.deficit}대. 시설별 산정 및 적용 가정은 아래와 같습니다.
${m.parking.breakdown.map(row => "- " + row.label + ": " + fmtDec(row.areaSqm) + "㎡ / " + row.formula + " = " + fmtDec(row.rawCount) + "대").join("\n")}
- **확인 사항**: ${[...new Set([...m.constraints.warnings, ...m.parking.warnings])].join(" / ")}

## 1. 한국형 8대 면적 산출 요약
| 구분 | 면적 (㎡) | 평수 (평) | 비고 |
|---|---:|---:|---|
| 1. 검토 대지면적 | ${fmtInt(m.areas.siteAreaSqm)} | ${fmtInt(m.areas.siteAreaSqm / PYEONG_TO_SQM)} | ${m.parcelGeometry ? "지도 경계 근사면적" : "사용자·예시 입력면적"} ${fmtInt(m.effectiveCadastralAreaSqm)}㎡ · 공공기여 가정 차감 · 공부·법적 제척면적 미확인 |
| 2. 건축면적 | ${fmtInt(m.areas.buildingFootprintSqm)} | ${fmtInt(m.areas.buildingFootprintSqm / PYEONG_TO_SQM)} | 건폐율 ${fmtDec(m.areas.achievedBcrPct)}% (검토 적용 상한 ${m.zoningRule.maxBcr}%) |
| 3. 기준층 바닥면적 | ${fmtInt(m.areas.typicalFloorSqm)} | ${fmtInt(m.areas.typicalFloorSqm / PYEONG_TO_SQM)} | 층고 ${state.floorHeight}m |
| 4. 용적률산정용 연면적 | ${fmtInt(m.areas.farCountedGfaSqm)} | ${fmtInt(m.areas.farCountedGfaSqm / PYEONG_TO_SQM)} | 용적률 ${fmtDec(m.areas.achievedFarPct)}% (검토 적용 상한 ${m.zoningRule.maxFar}%) |
| 5. 지하층 연면적 | ${fmtInt(m.areas.undergroundGfaSqm)} | ${fmtInt(m.areas.undergroundGfaSqm / PYEONG_TO_SQM)} | 지하 ${state.floorsBelow}개층 |
| 6. 총연면적 (GFA) | ${fmtInt(m.areas.totalGfaSqm)} | ${fmtInt(m.areas.totalGfaSqm / PYEONG_TO_SQM)} | 전체 시공연면적 |
| 7. 전용면적 가정 | ${fmtInt(m.areas.netAreaSqm)} | ${fmtInt(m.areas.netAreaSqm / PYEONG_TO_SQM)} | 전용률 가정 ${fmtDec(m.areas.netEfficiencyPct)}% · 실측·계약 근거 미확인 |
| 8. 계약면적 가정 | ${fmtInt(m.areas.contractAreaSqm)} | ${fmtInt(m.areas.contractAreaSqm / PYEONG_TO_SQM)} | 공급면적 가정 ${fmtInt(m.areas.supplyAreaSqm)}㎡ · 모집공고·계약 근거 미확인 |

## 2. 사업비 · PF 대주단 트랜치 · LP/GP 워터폴 수익성 요약
- **총사업비**: ${fmtDec(m.finance.totalDevCostEok)} 억원 (토지비 ${fmtDec(m.finance.totalLandCostEok)}억 + 순공사비 ${fmtDec(m.finance.totalHardCostEok)}억 + 부대·금융비 ${fmtDec(m.finance.softCostEok + m.finance.interestReserveEok + m.finance.loanFeeEok)}억)
- **금융 계산 범위**: PF 전체 트랜치 이자만 납부하고 매각월에 원금을 상환하는 가정입니다. 건설이자는 공사기간 평균 인출률 56%의 개산이며 실제 월별 인출잔액 이자 검증은 미구현입니다. 운영기 ${m.finance.leaseUpMonths}개월 이자 ${fmtDec(m.finance.monthlyOperatingDebtInterest.reduce((sum, value) => sum + value, 0))}억을 자기자본 현금흐름에서 별도 차감합니다. Project XIRR과 Unlevered CSV는 금융비를 제외합니다.
- **자기자본 투입**: 개발비 조달 계획 ${fmtDec(m.finance.equityRequiredEok)}억 / 운영적자·매각 부족분을 포함한 실제 모형 납입 ${fmtDec(m.finance.actualEquityPaidInEok)}억. 매각대금이 PF 잔액보다 적으면 부족분을 추가 출자한다고 가정하며, 비소구·손실 제한 약정을 구현한 결과가 아닙니다.
- **수입 기준**: ${m.finance.financeMode === "hotel" ? "호텔 운영 + 비호텔 임대" : "임대 가정"} / 안정화 연수입 ${fmtDec(m.finance.annualGrossIncomeEok)}억 / NOI ${fmtDec(m.finance.stabilizedNoiEok)}억. ${m.finance.income?.hotel.active ? `객실 ${m.finance.income.hotel.effectiveGuestRooms}실 · 가중 ADR ${fmtInt(m.finance.income.hotel.weightedAdrKrw)}원 · 가동률 ${fmtDec(m.finance.income.hotel.occupancyPct)}%.` : "임대 점유율·운영비 및 계약면적은 입력·기본 가정입니다."}
- **PF 대주단 트랜치 (LTC ${state.loanLtvPct}%, DSCR ${fmtDec(m.finance.dscr, 2)}x)**: 선순위 ${fmtDec(tr.seniorLoanEok)}억 (${fmtDec(tr.seniorRatePct, 2)}%) / 중순위 ${fmtDec(tr.mezzLoanEok)}억 (${fmtDec(tr.mezzRatePct, 2)}%) / 후순위 ${fmtDec(tr.juniorLoanEok)}억 (${fmtDec(tr.juniorRatePct, 2)}%)
- **자기자본 내부수익률 (Equity XIRR)**: **${fmtDec(m.finance.equityXirrPct)} %** (Project XIRR ${fmtDec(m.finance.projectXirrPct)}%)
- **한국형 REF/PFV 워터폴 배분**:
  - **모형 가정**: 월별 LP 원금 → GP 원금 → 미회수 LP 원금의 월별 단리 우선수익 → 잔여 성공보수 순서입니다. 실제 펀드 약정·복리 허들·catch-up·세금은 별도 검토합니다. DSCR은 전체 PF 트랜치 이자 대비 NOI이며 매각월 원금상환을 포함한 기간별 DSCR은 아닙니다.
  - **LP 우선주 (${wf.lpSharePct}% 출자, ${fmtDec(wf.lpEquityEok)}억)**: 총회수 **${fmtDec(wf.lpTotalDistEok)}억원** · **LP IRR ${fmtDec(wf.lpIrrPct)}%** (${fmtDec(wf.lpMultiple, 2)}x)
  - **GP 시행사 보통주 (${fmtDec(wf.gpSharePct, 0)}% 출자, ${fmtDec(wf.gpEquityEok)}억, Promote ${wf.gpPromotePct}%)**: 총회수 **${fmtDec(wf.gpTotalDistEok)}억원** · **GP IRR ${fmtDec(wf.gpIrrPct)}%** (${fmtDec(wf.gpMultiple, 2)}x)
- **목표 수익률(${state.targetIrrPct}%) 만족 최대 토지매입한도**: **${fmtDec(r.maxLandTotalEok)} 억원** (평당 ${fmtInt(r.maxLandPyeongM)}백만원)

## 3. 수입 산식·가정과 경고
${incomeAssumptions.map(text => "- " + text).join("\n")}
${incomeWarnings.length ? incomeWarnings.map(text => "- 경고: " + text).join("\n") : "- 수입 모듈 추가 경고 없음. 가정값의 실무 검증이 완료되었다는 뜻은 아닙니다."}

## 4. 비용 포함·제외와 고정 가정
- 포함: 토지 매입 및 4.6% 취득 관련 비용 가정, 지상·지하 공사비 개산, 흙막이 개산, 공사비의 13.5% 부대비, 건설이자 개산과 대출수수료. 세목·공종별 확정 금액이 아닙니다.
- 별도 산정되지 않은 항목: 철거·명도·이주, 공종별 물량과 견적, 부담금·취득 및 보유세의 개별 적용조건, 분양·마케팅·임차인 공사비 지원·임대료 면제, 자산별 예비비. 포함 여부와 실제 부담 주체를 확인해야 합니다.
- 고정 계획: 사전개발 6개월, 층수 기반 공사기간 ${m.finance.constMonths}개월, 운영 안정화 6개월, 취득비율 4.6%, 부대비율 13.5%, 건설 평균인출률 56%, PF 수수료 1.5%, 매각비 1.5%입니다. 실제 계약 일정과 조건으로 검증하지 않은 비교 가정입니다.
- 공사비 단가는 사용자·예시 입력입니다. 현재 공식 KICT 지수 조회나 시공사 견적에 자동 연결되지 않습니다. 운영기 이자는 위 총사업비 밖의 월별 Equity 현금흐름에서 반영합니다.
- 단위·반올림: 내부 금액은 억원, 면적은 ㎡, 기간은 균등 월입니다. 수익률은 월별 현금흐름의 연율 환산이며 실제 날짜별 XIRR이 아닙니다. 표의 표시 반올림 전 값으로 합산하고 CSV 금액은 소수 셋째 자리까지 표시하므로 표시 합계에 차이가 날 수 있습니다.

## 5. 미확인 자료와 후속 검토
${unresolved.map(text => "- " + text).join("\n")}

## 6. 재현용 입력 스냅샷
${reportInputBasis}. 현재 결과는 엔진 검토 버전 ${reportEngineVersion} 및 법규 스냅샷 ${window.AtelierLegal.checkedAt} 기준입니다. 이 파일은 프로젝트 v1 파일을 대체하지 않으며 전체 EvidenceRecord 이력 저장소가 아닙니다.

\`\`\`json
${reportInputJson}
\`\`\`
`;

  setTimeout(() => {
    const mdBlob = new Blob([reportMd], { type: "text/markdown;charset=utf-8;" });
    const mdLink = document.createElement("a");
    mdLink.href = URL.createObjectURL(mdBlob);
    mdLink.download = `seoul-pre-review-report-${state.parcelKey}-option-${state.option}.md`;
    mdLink.click();
  }, 350);
}

// ============================================================================
// 10. EVENT LISTENERS & INITIALIZATION
// ============================================================================
function syncOptionButtons() {
  document.querySelectorAll(".option-card").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.option === state.option);
  });
  document.getElementById("activeOptionLabel").textContent = `Option ${state.option}`;
}

function syncFacadeUI() {
  syncFacadeColorUI();
  [["sliderFacadePanelDepth", "valFacadePanelDepth", state.facadePanelDepthMm, " mm"],
    ["sliderFacadeJoint", "valFacadeJoint", state.facadeJointMm, " mm"],
    ["sliderFacadeLouverAngle", "valFacadeLouverAngle", state.facadeLouverAngleDeg, "°"]].forEach(([id, labelId, value, suffix]) => {
      const input = document.getElementById(id), label = document.getElementById(labelId);
      if (input) input.value = value;
      if (label) label.textContent = value + suffix;
    });
  document.querySelectorAll(".facade-card").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.facade === state.facadeType);
  });
  document.querySelectorAll("[data-qfacade]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.qfacade === state.facadeType);
  });
  document.querySelectorAll(".mat-chip").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mat === state.claddingMaterial);
  });
  document.querySelectorAll("[data-qmat]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.qmat === state.claddingMaterial);
  });
  document.querySelectorAll(".color-swatch-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.accent === state.facadeAccent);
  });
  document.querySelectorAll("[data-qaccent]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.qaccent === state.facadeAccent);
  });
  document.querySelectorAll(".glass-swatch-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.glasstint === state.glassTint);
  });
  document.querySelectorAll("[data-qglass]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.qglass === state.glassTint);
  });
  document.querySelectorAll(".podium-chip").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.podium === state.podiumStyle);
  });

  const wwrEl = document.getElementById("sliderFacadeWwr");
  if (wwrEl) {
    wwrEl.value = state.facadeWwrPct;
    document.getElementById("valFacadeWwr").textContent = `${state.facadeWwrPct}%`;
  }
  const bayEl = document.getElementById("sliderFacadeBay");
  if (bayEl) {
    bayEl.value = state.facadeBayM;
    document.getElementById("valFacadeBay").textContent = `${state.facadeBayM.toFixed(1)} m`;
  }
  const louverEl = document.getElementById("sliderFacadeLouver");
  if (louverEl) {
    louverEl.value = state.facadeLouverM;
    document.getElementById("valFacadeLouver").textContent = `${state.facadeLouverM.toFixed(2)} m`;
  }
}

function applyFacadeArchetypeSelection(facadeKey) {
  state.facadeType = facadeKey;
  const fArch = FACADE_ARCHETYPES[state.facadeType] || FACADE_ARCHETYPES.curtain_wall;
  state.facadeWwrPct = fArch.defaultWwrPct;
  state.facadeBayM = fArch.defaultBayM;
  state.facadeLouverM = fArch.defaultLouverM;

  // Match natural default cladding material & podium when switching archetype
  if (facadeKey === "brick_rainscreen") {
    state.claddingMaterial = "terracotta_brick";
    state.facadeAccent = "terracotta";
    state.podiumStyle = "brick_arcade";
  } else if (facadeKey === "stone_ribbon") {
    state.claddingMaterial = "limestone";
    state.facadeAccent = "warm_limestone";
    state.podiumStyle = "showwindow";
  } else if (facadeKey === "kinetic_louver") {
    state.claddingMaterial = "champagne_bronze";
    state.facadeAccent = "champagne";
    state.podiumStyle = "piloti_colonade";
  } else if (facadeKey === "diagrid_biophilic") {
    state.claddingMaterial = "anodized_metal";
    state.facadeAccent = "titanium";
    state.podiumStyle = "piloti_colonade";
  } else {
    state.claddingMaterial = "anodized_metal";
    state.facadeAccent = "auto";
    state.podiumStyle = "showwindow";
  }
  syncFacadeUI();
  updateAllCalculationsAndUI();
}

function loadParcelPreset(parcelKey, restoredInputs = null) {
  const p = SEOUL_PARCELS[parcelKey] || SEOUL_PARCELS.gangnam_yeoksam;
  state.parcelKey = p.id;
  state.parcelData = null;
  state.siteAreaSqm = p.siteAreaSqm;
  state.roadWidthM = p.roadWidthM;
  state.zoning = p.zoning;
  state.buildingUse = p.buildingUse;
  state.hotelType = "unconfirmed";
  Object.assign(state, { hotelResidentialDistanceM: null, hotelResidentialBarrier: null,
    financeMode: "rental", hotelAdrKrw: 180000, hotelOccupancyPct: 70,
    hotelRoomsOverride: 0, hotelAncillaryRevenuePct: 15, hotelOpexPct: 60,
    hotelFixedOpexEok: 0, hotelFfeReservePct: 4, hotelManagementFeePct: 3 });
  state.spaceProgram = "standard";
  state.facadeType = p.facadeType || "curtain_wall";
  const fArch = FACADE_ARCHETYPES[state.facadeType] || FACADE_ARCHETYPES.curtain_wall;
  state.facadeWwrPct = fArch.defaultWwrPct;
  state.facadeBayM = fArch.defaultBayM;
  state.facadeLouverM = fArch.defaultLouverM;
  state.glassTint = "auto";
  state.facadePanelDepthMm = 35;
  state.facadeJointMm = 8;
  state.facadeLouverAngleDeg = 22;
  if (state.facadeType === "brick_rainscreen") {
    state.claddingMaterial = "terracotta_brick";
    state.facadeAccent = "terracotta";
    state.podiumStyle = "brick_arcade";
  } else if (state.facadeType === "stone_ribbon") {
    state.claddingMaterial = "limestone";
    state.facadeAccent = "warm_limestone";
    state.podiumStyle = "showwindow";
  } else if (state.facadeType === "kinetic_louver") {
    state.claddingMaterial = "champagne_bronze";
    state.facadeAccent = "champagne";
    state.podiumStyle = "piloti_colonade";
  } else {
    state.claddingMaterial = "anodized_metal";
    state.facadeAccent = "auto";
    state.podiumStyle = "showwindow";
  }
  state.seoulDowntown = Boolean(p.seoulDowntown);
  state.publicContribPct = Number(p.publicContribPct) || 0;
  state.northSolar = p.northSolar;
  state.floorsAbove = p.floorsAbove;
  state.floorsBelow = p.floorsBelow;
  state.targetBcr = p.targetBcr;
  state.floorHeight = p.floorHeight;
  state.setbackM = p.setbackM;
  state.setbackSideM = Math.max(1.0, Number((p.setbackM * 0.75).toFixed(1)));
  state.setbackRearM = p.setbackM;
  state.parcelMerged = false;
  state.legalFarCapPct = 0;
  state.legalBcrCapPct = 0;
  state.maxHeightM = 0;
  state.regulationMode = "statutory";
  state.parkingMode = "fit";
  state.housingUnitAreaSqm = 59;
  state.housingUnits = 0;
  state.residentialType = p.buildingUse.includes("공동주택") ? "apartment" : "officetel";
  state.housingPermitType = "building_permit";
  state.parkingDistrict = "unconfirmed";
  state.mixedUseProfile = "office_retail";
  state.floorUseOverrides = {};
  state.selectedFloorLevel = null;
  state.coreType = p.coreType;
  state.landPricePyeongM = p.landPricePyeongM;
  state.constCostPyeongMan = p.constCostPyeongMan;
  state.rentPyeongMan = p.rentPyeongMan;
  state.capRatePct = p.capRatePct;
  state.loanLtvPct = p.loanLtvPct;
  state.loanRatePct = p.loanRatePct;
  state.targetIrrPct = p.targetIrrPct;

  // Restore only validated editable inputs before the first calculation emits
  // atelier:updated. Derived results and live-law metadata always start fresh.
  const restored = restoredInputs && window.AtelierWorkspace
    ? window.AtelierWorkspace.sanitize(restoredInputs) : null;
  if (restored && restored.parcelKey === state.parcelKey) Object.assign(state, restored);
  syncWorkspaceInputsToUI();
  updateAllCalculationsAndUI();
}

function syncWorkspaceInputsToUI() {
  document.getElementById("parcelSelect").value = state.parcelKey;
  document.getElementById("inputSiteArea").value = state.parcelData ? Number(state.siteAreaSqm.toFixed(1)) : state.siteAreaSqm;
  document.getElementById("inputRoadWidth").value = state.roadWidthM;
  document.getElementById("selectZoning").value = state.zoning;
  document.getElementById("selectBuildingUse").value = state.buildingUse;
  const chkDowntownEl = document.getElementById("chkSeoulDowntown");
  if (chkDowntownEl) chkDowntownEl.checked = state.seoulDowntown;
  const contribSliderEl = document.getElementById("sliderPublicContribPct");
  if (contribSliderEl) {
    contribSliderEl.value = state.publicContribPct;
    const contribValEl = document.getElementById("valPublicContribPct");
    if (contribValEl) contribValEl.textContent = `${state.publicContribPct.toFixed(1)}%`;
  }
  document.getElementById("chkNorthSolar").checked = state.northSolar;
  const chkMergerEl = document.getElementById("chkParcelMerger");
  if (chkMergerEl) chkMergerEl.checked = state.parcelMerged;

  document.getElementById("sliderFloorsAbove").value = state.floorsAbove;
  document.getElementById("valFloorsAbove").textContent = `${state.floorsAbove}층`;

  document.getElementById("sliderFloorsBelow").value = state.floorsBelow;
  document.getElementById("valFloorsBelow").textContent = `${state.floorsBelow}층`;

  document.getElementById("sliderTargetBcr").value = state.targetBcr;
  document.getElementById("valTargetBcr").textContent = `${state.targetBcr}%`;

  document.getElementById("sliderFloorHeight").value = state.floorHeight;
  document.getElementById("valFloorHeight").textContent = `${state.floorHeight.toFixed(1)} m`;

  document.getElementById("sliderSetback").value = state.setbackM;
  document.getElementById("valSetback").textContent = `${state.setbackM.toFixed(1)} m`;
  const sideEl = document.getElementById("sliderSetbackSide");
  if (sideEl) {
    sideEl.value = state.setbackSideM;
    document.getElementById("valSetbackSide").textContent = `${state.setbackSideM.toFixed(1)} m`;
  }
  const rearEl = document.getElementById("sliderSetbackRear");
  if (rearEl) {
    rearEl.value = state.setbackRearM;
    document.getElementById("valSetbackRear").textContent = `${state.setbackRearM.toFixed(1)} m`;
  }

  const mixEl = document.getElementById("selectMixedUseProfile");
  if (mixEl) mixEl.value = state.mixedUseProfile;

  document.getElementById("selectCoreType").value = state.coreType;

  document.getElementById("sliderLandPricePyeong").value = state.landPricePyeongM;
  document.getElementById("valLandPricePyeong").textContent = `${state.landPricePyeongM} 백만원/평`;

  document.getElementById("sliderConstCostPyeong").value = state.constCostPyeongMan;
  document.getElementById("valConstCostPyeong").textContent = `${state.constCostPyeongMan} 만원/평`;

  document.getElementById("sliderRentPyeong").value = state.rentPyeongMan;
  document.getElementById("valRentPyeong").textContent = `${state.rentPyeongMan.toFixed(1)} 만원/평`;

  document.getElementById("sliderCapRate").value = state.capRatePct;
  document.getElementById("valCapRate").textContent = `${state.capRatePct.toFixed(1)} %`;

  document.getElementById("inputLoanLtv").value = state.loanLtvPct;
  document.getElementById("inputLoanRate").value = state.loanRatePct;

  document.getElementById("sliderTargetIrr").value = state.targetIrrPct;
  document.getElementById("valTargetIrr").textContent = `${state.targetIrrPct.toFixed(1)} %`;

  const inspCard = document.getElementById("floorInspectorCard");
  if (inspCard) inspCard.classList.add("hidden");

  const setValue = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.value = value;
  };
  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };
  setValue("sliderClipPlane", state.clipPlanePct);
  setValue("inputLegalFarCap", state.legalFarCapPct);
  setValue("inputLegalBcrCap", state.legalBcrCapPct);
  setValue("inputLegalHeightCap", state.maxHeightM);
  setValue("selectModelDetail", state.modelDetail || "auto");
  syncRegulationModeUI();
  setValue("selectParkingMode", state.parkingMode);
  setValue("inputHousingUnitArea", state.housingUnitAreaSqm);
  setValue("inputHousingUnits", state.housingUnits);
  setValue("selectResidentialType", state.residentialType);
  setValue("selectHousingPermitType", state.housingPermitType);
  setValue("selectParkingDistrict", state.parkingDistrict);
  setValue("sliderQuickClip", state.clipPlanePct);
  setText("valClipPlane", state.clipPlanePct >= 100 ? "100% (전체)" : `${state.clipPlanePct}% 단면절단`);
  const dimensionCheck = document.getElementById("chkShowDimensions");
  if (dimensionCheck) dimensionCheck.checked = state.showDimensions;
  setText("btnToggleQuickDim", state.showDimensions ? "📏 치수선 ON" : "📏 치수선 OFF");
  setText("btnToggleStudioTheme", state.daylightTheme ? "🌙 야간 트윈" : "☀️ 주간 모형");
  setValue("sliderSunHour", state.sunHour);
  const sunMinutes = Math.round(state.sunHour * 60);
  setText("valSunHour", `${Math.floor(sunMinutes / 60)}:${String(sunMinutes % 60).padStart(2, "0")}`);
  setValue("sliderLpSharePct", state.lpSharePct);
  setText("valLpSharePct", `LP ${state.lpSharePct}% : GP ${100 - state.lpSharePct}%`);
  setValue("sliderLpHurdlePct", state.lpHurdlePct);
  setText("valLpHurdlePct", `연 ${state.lpHurdlePct.toFixed(1)}%`);
  setValue("sliderGpPromotePct", state.gpPromotePct);
  setText("valGpPromotePct", `GP ${state.gpPromotePct}% 배분`);
  document.querySelectorAll(".view-btn").forEach(button => {
    if (button.dataset.view !== "reset") button.classList.toggle("active", button.dataset.view === state.viewMode);
  });
  syncOptionButtons();
  syncFacadeUI();
  syncSurroundingBuildingsUI();
}

function openAtelierChapter(chapId) {
  document.querySelectorAll(".atelier-chapter").forEach(ch => {
    ch.classList.toggle("open", ch.id === chapId);
  });
  window.dispatchEvent(new CustomEvent("atelier:open-design", {
    detail: { chapterId: chapId }
  }));
}

function switchRightAnalyticsTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tabId);
  });
  document.querySelectorAll(".tab-content").forEach(c => {
    c.classList.toggle("active", c.id === tabId);
  });
  window.dispatchEvent(new CustomEvent("atelier:open-analysis", {
    detail: { tabId }
  }));
}

// Private owner review archive. Address/PNU, project inputs and calculations
// remain behind the owner-only archive boundary and never enter the public feed.
window.AtelierStudyPublicationSource = Object.freeze({
  snapshot() {
    const model = state.lastComputed?.model;
    if (!model || !Number.isFinite(model.siteAreaSqm) || model.siteAreaSqm <= 0) return { eligible: false };
    const archive = window.AtelierStudyReviewSnapshot?.build({ state, workspace: window.AtelierWorkspace,
      legal: window.AtelierLegal, parcelRegulations: window.AtelierParcelRegulations, buildingReview: window.AtelierBuildingReview });
    if (!archive) return { eligible: false };
    const use = state.buildingUse || "";
    const program = state.spaceProgram === "coliving" ? "living"
      : /호텔/.test(use) ? "hotel" : /오피스텔/.test(use) ? "officetel"
      : /공동주택/.test(use) ? "housing" : /지식산업/.test(use) ? "knowledge"
      : /근린생활/.test(use) ? "retail" : /판매/.test(use) ? "sales" : "office";
    const plates = (model.floorPlates || []).filter(fp => fp.level > 0).map(fp => ({
      level: fp.level, width: fp.widthM, depth: fp.depthM,
      height: fp.zTop - fp.zBottom, y: (fp.zTop + fp.zBottom) / 2,
      shiftX: 0, shiftZ: fp.northShiftM || 0, courtyard: Boolean(fp.hasAtrium)
    }));
    return { eligible: true,
      summary: { program, siteAreaSqm: model.siteAreaSqm, farPct: model.areas.achievedFarPct,
      bcrPct: model.areas.achievedBcrPct, floors: model.actualFloorsAbove }, plates,
      appearance: {
        palette: ({ champagne_bronze: "bronze", granite_pocheon: "stone", uhpc_concrete: "white", terracotta_brick: "terracotta" })[state.claddingMaterial] || "limestone",
        facade: ["curtain_wall", "brick_rainscreen", "stone_ribbon", "kinetic_louver", "diagrid_biophilic"].includes(state.facadeType) ? state.facadeType : "curtain_wall"
      },
      geometryKey: window.AtelierStudyIdentity?.scope({ parcelData: state.parcelData, parcelKey: state.parcelKey, option: state.option }, model) || state.parcelKey,
      site: archive.site, reviewData: archive.reviewData
    };
  }
});

window.addEventListener("DOMContentLoaded", () => {
  try {
    initThreeScene();
  } catch (error) {
    if (renderer) renderer.dispose();
    renderer = null;
    buildingGroup = null;
    document.body.dataset.viewerUnavailable = "true";
    window.dispatchEvent(new CustomEvent("atelier:viewer-unavailable", {
      detail: { message: "3D 뷰어를 불러오지 못했습니다. 설계 입력과 분석은 계속 사용할 수 있습니다." }
    }));
    console.warn("The 3D viewer is unavailable:", error);
  }
  const workspace = window.AtelierWorkspace;
  const restoredInputs = workspace ? workspace.restore() : null;
  if (workspace) workspace.attach(() => state);
  loadParcelPreset(restoredInputs?.parcelKey || "gangnam_yeoksam", restoredInputs);
  if (workspace) workspace.ready();

  document.getElementById("parcelSelect").addEventListener("change", (e) => {
    workspace?.save();
    loadParcelPreset(e.target.value, workspace?.restoreParcel?.(e.target.value));
  });

  // Editorial Accordion Chapters (01 ~ 04) in Left Panel
  document.querySelectorAll(".chapter-header").forEach(hdr => {
    hdr.addEventListener("click", () => {
      const parentChap = hdr.closest(".atelier-chapter");
      if (!parentChap) return;
      const isAlreadyOpen = parentChap.classList.contains("open");
      document.querySelectorAll(".atelier-chapter").forEach(ch => ch.classList.remove("open"));
      if (!isAlreadyOpen) parentChap.classList.add("open");
    });
  });

  // Top KPI Ribbon Interactive Pillars -> Click to jump to Tab & Chapter
  document.querySelectorAll(".kpi-card[data-kpitab]").forEach(card => {
    card.addEventListener("click", () => {
      const targetTab = card.dataset.kpitab;
      const targetChap = card.dataset.kpichapter;
      if (targetTab) switchRightAnalyticsTab(targetTab);
      if (targetChap) openAtelierChapter(targetChap);
      // If in gallery mode, exit gallery mode so user sees the specification sheet
      const grid = document.getElementById("workspaceGrid");
      if (grid && grid.classList.contains("gallery-mode")) {
        grid.classList.remove("gallery-mode");
        const galBtn = document.getElementById("btnToggleGalleryMode");
        if (galBtn) galBtn.textContent = "✦ 갤러리 뷰";
        setTimeout(onWindowResize, 260);
      }
    });
  });

  // Studio Theme Toggle (Daylight Architectural Model vs Night Digital Twin)
  document.querySelectorAll("[data-context-buildings-toggle]").forEach(button => {
    button.addEventListener("click", () => setSurroundingBuildingsVisible(state.showSurroundingBuildings === false));
  });
  document.getElementById("btnToggleStudioTheme").addEventListener("click", (e) => {
    state.daylightTheme = !state.daylightTheme;
    e.currentTarget.textContent = state.daylightTheme ? "🌙 야간 트윈" : "☀️ 주간 모형";
    updateAllCalculationsAndUI();
  });

  // The dashboard owns the full-window focus surface; retain the legacy fallback elsewhere.
  const btnGallery = document.getElementById("btnToggleGalleryMode");
  if (btnGallery) {
    btnGallery.addEventListener("click", (e) => {
      if (window.AtelierModelFocus) {
        window.AtelierModelFocus.toggle();
        return;
      }
      const grid = document.getElementById("workspaceGrid");
      grid.classList.remove("wide-analytics");
      const isGallery = grid.classList.toggle("gallery-mode");
      e.currentTarget.textContent = isGallery ? "✦ 사양서 보기" : "✦ 갤러리 뷰";
      setTimeout(onWindowResize, 280);
    });
  }

  // Expand Right Analytics Panel Toggle
  document.getElementById("btnExpandAnalytics").addEventListener("click", (e) => {
    const grid = document.getElementById("workspaceGrid");
    grid.classList.remove("gallery-mode");
    const isWide = grid.classList.toggle("wide-analytics");
    e.currentTarget.textContent = isWide ? "▶ 기본폭" : "◀ 넓히기";
    setTimeout(onWindowResize, 260);
  });

  // Collapsible Floating 3D Facade Quick-Studio
  const btnToggleQuickStudio = document.getElementById("btnToggleQuickStudio");
  if (btnToggleQuickStudio) {
    btnToggleQuickStudio.addEventListener("click", (e) => {
      const studio = document.getElementById("hudFacadeQuickStudio");
      if (!studio) return;
      const collapsed = studio.classList.toggle("collapsed");
      e.currentTarget.textContent = collapsed ? "🎨 외관팔레트 열기 ▴" : "🎨 외관팔레트 접기 ▾";
    });
  }

  // Option A / B / C Cards
  document.querySelectorAll(".option-card").forEach(btn => {
    btn.addEventListener("click", () => {
      state.option = btn.dataset.option;
      if (state.option === "C") {
        state.coreType = "north";
        document.getElementById("selectCoreType").value = "north";
      }
      syncOptionButtons();
      updateAllCalculationsAndUI();
    });
  });

  // Site & Zoning Inputs
  document.getElementById("selectModelDetail")?.addEventListener("change", event => {
    state.modelDetail = ["massing", "concept"].includes(event.target.value) ? event.target.value : "auto";
    updateAllCalculationsAndUI();
  });
  document.getElementById("selectRegulationMode")?.addEventListener("change", event => {
    state.regulationMode = event.target.value === "scenario" ? "scenario" : "statutory";
    updateAllCalculationsAndUI();
  });
  document.getElementById("inputSiteArea").addEventListener("input", (e) => {
    state.siteAreaSqm = Math.max(200, Number(e.target.value) || 1000);
    updateAllCalculationsAndUI();
  });
  document.getElementById("inputRoadWidth").addEventListener("input", (e) => {
    state.roadWidthM = Math.max(4, Number(e.target.value) || 12);
    updateAllCalculationsAndUI();
  });
  document.getElementById("selectZoning").addEventListener("change", (e) => {
    state.zoning = e.target.value;
    const rule = SEOUL_ZONING_RULES[state.zoning];
    if (rule) {
      state.northSolar = rule.northSolarDefault;
      document.getElementById("chkNorthSolar").checked = state.northSolar;
      if (state.targetBcr > rule.maxBcr) {
        state.targetBcr = rule.maxBcr;
        document.getElementById("sliderTargetBcr").value = state.targetBcr;
        document.getElementById("valTargetBcr").textContent = `${state.targetBcr}%`;
      }
    }
    updateAllCalculationsAndUI();
  });
  document.getElementById("selectBuildingUse").addEventListener("change", (e) => {
    state.buildingUse = e.target.value;
    state.spaceProgram = "standard";
    state.mixedUseProfile = "office_retail";
    const mixedUseSelect = document.getElementById("selectMixedUseProfile");
    if (mixedUseSelect) mixedUseSelect.value = state.mixedUseProfile;
    if (state.buildingUse.includes("공동주택")) state.residentialType = "apartment";
    if (state.buildingUse.includes("오피스텔")) state.residentialType = "officetel";
    const residentialSelect = document.getElementById("selectResidentialType");
    if (residentialSelect) residentialSelect.value = state.residentialType;
    state.floorUseOverrides = {};
    updateAllCalculationsAndUI();
  });
  const legalInputs = {
    inputLegalFarCap: ["legalFarCapPct", 0, 1500],
    inputLegalBcrCap: ["legalBcrCapPct", 0, 100],
    inputLegalHeightCap: ["maxHeightM", 0, 300],
    inputHousingUnitArea: ["housingUnitAreaSqm", 15, 250],
    inputHousingUnits: ["housingUnits", 0, 3000]
  };
  Object.entries(legalInputs).forEach(([id, [key, min, max]]) => {
    const element = document.getElementById(id);
    const applyInput = event => {
      const number = Number(event.target.value);
      if (!Number.isFinite(number)) return;
      if (event.type === "input" && (event.target.value === "" || number < min || number > max)) return;
      state[key] = Math.min(max, Math.max(min, key === "housingUnits" ? Math.round(number) : number));
      if (event.type === "change") event.target.value = state[key];
      updateAllCalculationsAndUI();
    };
    element?.addEventListener("input", applyInput);
    element?.addEventListener("change", applyInput);
  });
  const legalSelects = { selectParkingMode: "parkingMode", selectResidentialType: "residentialType",
    selectHousingPermitType: "housingPermitType", selectParkingDistrict: "parkingDistrict" };
  Object.entries(legalSelects).forEach(([id, key]) => {
    document.getElementById(id)?.addEventListener("change", event => {
      state[key] = event.target.value;
      updateAllCalculationsAndUI();
    });
  });
  const chkDowntownEl = document.getElementById("chkSeoulDowntown");
  if (chkDowntownEl) {
    chkDowntownEl.addEventListener("change", (e) => {
      state.seoulDowntown = e.target.checked;
      updateAllCalculationsAndUI();
    });
  }
  document.getElementById("chkNorthSolar").addEventListener("change", (e) => {
    state.northSolar = e.target.checked;
    updateAllCalculationsAndUI();
  });

  const chkMergerEl = document.getElementById("chkParcelMerger");
  if (chkMergerEl) { chkMergerEl.disabled = true; chkMergerEl.title = "실제 경계를 추가하면 합집합이 자동 적용됩니다."; }
  // Mixed-Use Floor Profile Selector
  const mixSelectEl = document.getElementById("selectMixedUseProfile");
  if (mixSelectEl) {
    mixSelectEl.addEventListener("change", (e) => {
      state.mixedUseProfile = e.target.value;
      state.floorUseOverrides = {};
      updateAllCalculationsAndUI();
    });
  }

  // 3D Floor Inspector Card Close & Per-Floor Use Override Pills
  const btnCloseInsp = document.getElementById("btnCloseFloorInspector");
  if (btnCloseInsp) {
    btnCloseInsp.addEventListener("click", () => {
      state.selectedFloorLevel = null;
      const card = document.getElementById("floorInspectorCard");
      if (card) card.classList.add("hidden");
      if (state.lastComputed) rebuild3DScene(state.lastComputed.model);
    });
  }
  document.querySelectorAll("#inspUsePills .inspector-use-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (state.selectedFloorLevel === null || state.selectedFloorLevel < 1) return;
      state.floorUseOverrides[state.selectedFloorLevel] = btn.dataset.flooruse;
      updateAllCalculationsAndUI();
    });
  });

  const bindSlider = (id, valId, prop, fmtFn) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      state[prop] = Number(el.value);
      if (valId) document.getElementById(valId).textContent = fmtFn(state[prop]);
      updateAllCalculationsAndUI();
    });
  };

  bindSlider("sliderPublicContribPct", null, "publicContribPct", v => `${v.toFixed(1)}%`);
  bindSlider("sliderFloorsAbove", "valFloorsAbove", "floorsAbove", v => `${v}층`);
  bindSlider("sliderFloorsBelow", "valFloorsBelow", "floorsBelow", v => `${v}층`);
  bindSlider("sliderTargetBcr", "valTargetBcr", "targetBcr", v => `${v}%`);
  bindSlider("sliderFloorHeight", "valFloorHeight", "floorHeight", v => `${v.toFixed(1)} m`);
  bindSlider("sliderSetback", "valSetback", "setbackM", v => `${v.toFixed(1)} m`);
  bindSlider("sliderSetbackSide", "valSetbackSide", "setbackSideM", v => `${v.toFixed(1)} m`);
  bindSlider("sliderSetbackRear", "valSetbackRear", "setbackRearM", v => `${v.toFixed(1)} m`);
  bindSlider("sliderSunHour", "valSunHour", "sunHour", v => {
    const hrs = Math.floor(v);
    const mins = Math.round((v - hrs) * 60);
    return `${hrs}:${mins === 0 ? "00" : mins}`;
  });

  // BIM Section Clipping Sliders (Synchronized between Left Drawer & 3D Floating Toolbar)
  const syncClipSliders = (val) => {
    state.clipPlanePct = Number(val);
    const s1 = document.getElementById("sliderClipPlane");
    const s2 = document.getElementById("sliderQuickClip");
    const v1 = document.getElementById("valClipPlane");
    if (s1) s1.value = state.clipPlanePct;
    if (s2) s2.value = state.clipPlanePct;
    if (v1) v1.textContent = state.clipPlanePct >= 100 ? "100% (전체)" : `${state.clipPlanePct}% 단면절단`;
    if (state.lastComputed) rebuild3DScene(state.lastComputed.model);
  };
  const clipS1 = document.getElementById("sliderClipPlane");
  if (clipS1) clipS1.addEventListener("input", (e) => syncClipSliders(e.target.value));
  const clipS2 = document.getElementById("sliderQuickClip");
  if (clipS2) clipS2.addEventListener("input", (e) => syncClipSliders(e.target.value));

  // 3D Dimension Lines Toggle (Synchronized between Left Drawer & 3D Floating Toolbar)
  const syncDimToggle = (show) => {
    state.showDimensions = Boolean(show);
    const chk = document.getElementById("chkShowDimensions");
    const qBtn = document.getElementById("btnToggleQuickDim");
    if (chk) chk.checked = state.showDimensions;
    if (qBtn) qBtn.textContent = state.showDimensions ? "📏 치수선 ON" : "📏 치수선 OFF";
    if (state.lastComputed) rebuild3DScene(state.lastComputed.model);
  };
  const chkDim = document.getElementById("chkShowDimensions");
  if (chkDim) chkDim.addEventListener("change", (e) => syncDimToggle(e.target.checked));
  const btnQuickDim = document.getElementById("btnToggleQuickDim");
  if (btnQuickDim) btnQuickDim.addEventListener("click", () => syncDimToggle(!state.showDimensions));

  // Facade Archetype Cards, Cladding Materials, Color Swatches, Glass Tints & 3D Viewport Quick-Studio
  document.querySelectorAll(".facade-card").forEach(btn => {
    btn.addEventListener("click", () => {
      applyFacadeArchetypeSelection(btn.dataset.facade);
    });
  });

  document.querySelectorAll("[data-qfacade]").forEach(btn => {
    btn.addEventListener("click", () => {
      applyFacadeArchetypeSelection(btn.dataset.qfacade);
    });
  });

  const selectCladdingMaterial = (matKey) => {
    state.claddingMaterial = matKey;
    const matInfo = CLADDING_MATERIALS[matKey];
    if (matInfo && matInfo.defaultAccent) {
      state.facadeAccent = matInfo.defaultAccent;
    }
    syncFacadeUI();
    updateAllCalculationsAndUI();
  };

  document.querySelectorAll(".mat-chip").forEach(btn => {
    btn.addEventListener("click", () => selectCladdingMaterial(btn.dataset.mat));
  });
  document.querySelectorAll("[data-qmat]").forEach(btn => {
    btn.addEventListener("click", () => selectCladdingMaterial(btn.dataset.qmat));
  });

  const selectAccentColor = (accentKey) => {
    state.facadeAccent = accentKey;
    syncFacadeUI();
    updateAllCalculationsAndUI();
  };

  document.querySelectorAll(".color-swatch-btn").forEach(btn => {
    btn.addEventListener("click", () => selectAccentColor(btn.dataset.accent));
  });
  document.querySelectorAll("[data-qaccent]").forEach(btn => {
    btn.addEventListener("click", () => selectAccentColor(btn.dataset.qaccent));
  });

  const selectGlassTint = (tintKey) => {
    state.glassTint = tintKey;
    syncFacadeUI();
    updateAllCalculationsAndUI();
  };

  document.querySelectorAll(".glass-swatch-btn").forEach(btn => {
    btn.addEventListener("click", () => selectGlassTint(btn.dataset.glasstint));
  });
  document.querySelectorAll("[data-qglass]").forEach(btn => {
    btn.addEventListener("click", () => selectGlassTint(btn.dataset.qglass));
  });

  document.querySelectorAll(".podium-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      state.podiumStyle = btn.dataset.podium;
      syncFacadeUI();
      updateAllCalculationsAndUI();
    });
  });

  const btnOpenFacadeDetail = document.getElementById("btnOpenFacadeDetailTab");
  if (btnOpenFacadeDetail) {
    btnOpenFacadeDetail.addEventListener("click", () => {
      openAtelierChapter("chap-facade");
      switchRightAnalyticsTab("tab-area");
      const facDrawer = document.getElementById("drawerFacadeSpec");
      if (facDrawer) facDrawer.open = true;
    });
  }

  bindSlider("sliderFacadeWwr", "valFacadeWwr", "facadeWwrPct", v => `${v}%`);
  bindSlider("sliderFacadeBay", "valFacadeBay", "facadeBayM", v => `${v.toFixed(1)} m`);
  bindSlider("sliderFacadeLouver", "valFacadeLouver", "facadeLouverM", v => `${v.toFixed(2)} m`);
  [["sliderFacadePanelDepth", "facadePanelDepthMm", 10, 100],
    ["sliderFacadeJoint", "facadeJointMm", 3, 25],
    ["sliderFacadeLouverAngle", "facadeLouverAngleDeg", -60, 60]].forEach(([id, key, min, max]) => {
      document.getElementById(id)?.addEventListener("input", event => {
        const value = Number(event.target.value);
        if (!Number.isFinite(value)) return;
        state[key] = Math.min(max, Math.max(min, value));
        updateFacadeDetailView();
      });
    });

  document.getElementById("selectCoreType").addEventListener("change", (e) => {
    state.coreType = e.target.value;
    updateAllCalculationsAndUI();
  });

  bindSlider("sliderLandPricePyeong", "valLandPricePyeong", "landPricePyeongM", v => `${v} 백만원/평`);
  bindSlider("sliderConstCostPyeong", "valConstCostPyeong", "constCostPyeongMan", v => `${v} 만원/평`);
  bindSlider("sliderRentPyeong", "valRentPyeong", "rentPyeongMan", v => `${v.toFixed(1)} 만원/평`);
  bindSlider("sliderCapRate", "valCapRate", "capRatePct", v => `${v.toFixed(1)} %`);
  bindSlider("sliderTargetIrr", "valTargetIrr", "targetIrrPct", v => `${v.toFixed(1)} %`);

  // Korean REF/PFV LP vs GP Waterfall Sliders
  bindSlider("sliderLpSharePct", "valLpSharePct", "lpSharePct", v => `LP ${v}% : GP ${100 - v}%`);
  bindSlider("sliderLpHurdlePct", "valLpHurdlePct", "lpHurdlePct", v => `연 ${v.toFixed(1)}%`);
  bindSlider("sliderGpPromotePct", "valGpPromotePct", "gpPromotePct", v => `GP ${v}% 배분`);

  document.getElementById("inputLoanLtv").addEventListener("input", (e) => {
    state.loanLtvPct = Math.min(85, Math.max(20, Number(e.target.value) || 60));
    updateAllCalculationsAndUI();
  });
  document.getElementById("inputLoanRate").addEventListener("input", (e) => {
    state.loanRatePct = Math.min(15, Math.max(2, Number(e.target.value) || 6.0));
    updateAllCalculationsAndUI();
  });

  // 3D Viewport Mode Buttons
  document.querySelectorAll(".view-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.view;
      if (mode === "reset") {
        fitCameraToSite();
        return;
      }
      state.viewMode = mode;
      document.querySelectorAll(".view-btn").forEach(b => {
        if (b.dataset.view !== "reset") b.classList.toggle("active", b.dataset.view === mode);
      });
      updateAllCalculationsAndUI();
    });
  });

  // Right Panel Tabs
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      switchRightAnalyticsTab(btn.dataset.tab);
    });
  });

  // S-Map Split-View Toggle
  const toggleSmap = () => {
    const pane = document.getElementById("smapSplitPane");
    pane.classList.toggle("hidden");
    setTimeout(onWindowResize, 60);
  };
  document.getElementById("btnToggleSmap").addEventListener("click", toggleSmap);
  document.getElementById("btnCloseSmapPane").addEventListener("click", toggleSmap);

  document.getElementById("btnFetchLawLive").addEventListener("click", fetchLiveLawArticle);
  document.getElementById("btnVerifyPythonSkills").addEventListener("click", verifyWithPythonSkillsBackend);
  const btnSyncZoning = document.getElementById("btnSyncZoningLaw");
  if (btnSyncZoning) {
    btnSyncZoning.addEventListener("click", syncZoningLawFromMinistry);
  }

  document.getElementById("btnRecordVideo").addEventListener("click", startOrStopVideoWalkthrough);
  document.getElementById("btnExportIfc").addEventListener("click", exportIfc4Model);
  document.getElementById("btnExportReport").addEventListener("click", exportProformaAndReport);

  syncZoningLawFromMinistry();
  const publicAtelierLanding = window.location.protocol === "https:" && document.body.dataset.sitePage === "atelier";
  if (!publicAtelierLanding) fetchLiveLawArticle();
});

// Back/forward cache restores the previous document without DOMContentLoaded.
// Pull the latest edits from the other view before presenting the cached model.
window.addEventListener("pageshow", (event) => {
  if (!event.persisted || !window.AtelierWorkspace) return;
  const restoredInputs = window.AtelierWorkspace.restore();
  if (restoredInputs) loadParcelPreset(restoredInputs.parcelKey, restoredInputs);
});
