/** Shared rental and hotel operating income. All money outputs use KRW 100m. */
(function (root, factory) {
  "use strict";
  const api = factory(typeof module === "object" && module.exports ? require("./hotel-modules.js") : root.AtelierHotelModules);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AtelierFinance = api;
})(typeof window !== "undefined" ? window : this, function (hotelModules) {
  "use strict";
  const PYEONG = 3.305785;
  const DEFAULTS = Object.freeze({ financeMode: "rental", hotelAdrKrw: 180000,
    hotelOccupancyPct: 70, hotelRoomsOverride: 0, hotelAncillaryRevenuePct: 15,
    hotelOpexPct: 60, hotelFixedOpexEok: 0, hotelFfeReservePct: 4,
    hotelManagementFeePct: 3, hotelResidentialDistanceM: null, hotelResidentialBarrier: null,
    hotelTwinPct:33, hotelSuitePct:0, hotelServiceEveryRooms:12, hotelTwinAdrFactor:1.1, hotelSuiteAdrFactor:1.8 });
  const roomCaches = new WeakMap();
  function bounded(value, fallback, lo, hi) {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(lo, Math.min(hi, value)) : fallback;
  }
  function guestRoomPlan(fp, params, planner) {
    if (!planner || typeof planner.generate !== "function") return null;
    let roomCache=roomCaches.get(planner);if(!roomCache){roomCache=new Map();roomCaches.set(planner,roomCache);}
    // Land price / finance sensitivities repeatedly evaluate identical plans.
    const coreLayout = params.coreLayout !== undefined ? params.coreLayout : fp.coreLayout;
    const key = JSON.stringify([hotelModules.studyScope(params),fp.level,fp.zBottom,fp.zTop,fp.widthM, fp.depthM, fp.northShiftM, fp.hasAtrium,
      fp.atriumVoidRatio, params.coreType, params.option,
      params.hotelTwinPct,params.hotelSuitePct,params.hotelServiceEveryRooms,
      (params.layoutObstacles||[]).filter(o=>o.level===fp.level).map(o=>[o.id,o.kind,o.minX,o.maxX,o.minZ,o.maxZ]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
      params.circulationProfile,
      coreLayout !== undefined, coreLayout?.status, coreLayout?.cores]);
    if (roomCache.has(key)) return roomCache.get(key);
    // Display-only massing mode must not suppress calculation quantities.
    const plan = planner.generate(fp, {...params,detailLevel:"concept"});
    if (roomCache.size >= 512) roomCache.clear();
    roomCache.set(key, plan); return plan;
  }
  function calculate(params, floorPlates, context = {}) {
    const floors = Array.isArray(floorPlates) ? floorPlates : [];
    const area = floors.reduce((sum, fp) => sum + Math.max(0, Number(fp.areaSqm) || 0), 0);
    const warnings = [];
    const requestedMode = params.financeMode === "hotel" ? "hotel" : "rental";
    const hotelFloors = floors.filter(fp => fp.use === "hotel");
    const mode = requestedMode === "hotel" && hotelFloors.length ? "hotel" : "rental";
    if (requestedMode === "hotel" && !hotelFloors.length) warnings.push("호텔 객실층이 없어 임대 모드로 계산했습니다. 호텔 용도 또는 층별 호텔 용도를 선택하세요.");
    const basement = Math.max(0, Number(context.undergroundGfaSqm) || 0) * 0.35;
    const contractAreaSqm = area > 0 ? area + basement : 0;
    const rent = bounded(params.rentPyeongMan, 0, 0, 1e6);
    const premium = bounded(context.rentPremiumFactor, 1, 0, 10) * bounded(context.facadeRentFactor, 1, 0, 10);
    const occupancyRate = 0.95, ancillaryRentFactor = 1.12, rentalOpexRatio = 0.18;
    const mainHotel = String(params.buildingUse || "").includes("호텔");
    const ledger = floors.map(fp => {
      const floorArea = Math.max(0, Number(fp.areaSqm) || 0);
      const allocatedContractSqm = area > 0 ? floorArea / area * contractAreaSqm : 0;
      const hotelOperatingFloor = mode === "hotel" && (fp.use === "hotel" || (mainHotel && fp.use === "amenity"));
      // Preserve the existing rental scenario's blended use coefficients, now
      // applying the exact same equation to each floor and to the aggregate.
      const effectiveUseRentMult = 0.88 + 0.12 * bounded(fp.rentMult, 1, 0, 10);
      const rentalContractAreaSqm = hotelOperatingFloor ? 0 : allocatedContractSqm;
      const scheduledMonthlyRentMan = rentalContractAreaSqm / PYEONG * rent * premium * effectiveUseRentMult;
      const rentalAnnualGrossEok = scheduledMonthlyRentMan * 12 * occupancyRate * ancillaryRentFactor / 10000;
      return { level: fp.level, use: fp.use, allocatedContractAreaSqm: allocatedContractSqm,
        rentalContractAreaSqm, effectiveUseRentMult, scheduledMonthlyRentMan,
        rentalAnnualGrossEok, rentalAnnualNoiEok: rentalAnnualGrossEok * (1 - rentalOpexRatio),
        generatedGuestRooms: 0, effectiveGuestRooms: 0, hotelAnnualRevenueEok: 0,
        hotelAnnualNoiEok: 0, hotelOperatingFloor };
    });
    const hotel = { active: mode === "hotel", generatedGuestRooms: 0, effectiveGuestRooms: 0,
      roomsSource: "generated", plannerAvailable: !!context.planner?.generate,
      adrKrw: bounded(params.hotelAdrKrw, DEFAULTS.hotelAdrKrw, 0, 5000000),
      occupancyPct: bounded(params.hotelOccupancyPct, DEFAULTS.hotelOccupancyPct, 0, 100),
      ancillaryRevenuePct: bounded(params.hotelAncillaryRevenuePct, DEFAULTS.hotelAncillaryRevenuePct, 0, 200),
      opexPct: bounded(params.hotelOpexPct, DEFAULTS.hotelOpexPct, 0, 100),
      fixedOpexEok: bounded(params.hotelFixedOpexEok, 0, 0, 1000),
      ffeReservePct: bounded(params.hotelFfeReservePct, DEFAULTS.hotelFfeReservePct, 0, 30),
      managementFeePct: bounded(params.hotelManagementFeePct, DEFAULTS.hotelManagementFeePct, 0, 30),
      roomRevenueEok: 0, ancillaryRevenueEok: 0, totalRevenueEok: 0,
      variableOpexEok: 0, managementFeeEok: 0, ffeReserveEok: 0,
      operatingNoiBeforeReserveEok: 0, noiAfterReserveEok: 0, revParKrw: 0 };
    if (hotel.active) {
      if(!hotelModules) throw new Error("호텔 객실 유형 계산 모듈을 불러오지 못했습니다.");
      const hotelSettings=hotelModules.normalizeHotelSettings({...params,hotelAdrKrw:hotel.adrKrw,hotelOccupancyPct:hotel.occupancyPct,
        hotelRoomsOverride:Math.floor(bounded(params.hotelRoomsOverride,0,0,5000))});
      const allRooms=[];
      for (const fp of hotelFloors) {
        const plan=guestRoomPlan(fp,{...params,...hotelSettings},context.planner);
        const typedPlan=plan?hotelModules.assignRooms(plan,{...params,...hotelSettings}):{rooms:[]};
        const floorPreview=hotelModules.preview(typedPlan,{...hotelSettings,hotelRoomsOverride:0});
        const row=ledger.find(row => row.level === fp.level);
        row.generatedGuestRooms=floorPreview.generatedGuestRooms;
        row.hotelRoomTypes=floorPreview.roomTypes;
        allRooms.push(...typedPlan.rooms);
      }
      const preview=hotelModules.preview(allRooms,hotelSettings),override=hotelSettings.hotelRoomsOverride;
      Object.assign(hotel,{generatedGuestRooms:preview.generatedGuestRooms,effectiveGuestRooms:preview.effectiveGuestRooms,
        roomsSource:preview.roomsSource,roomTypes:preview.roomTypes,generatedTypeCounts:preview.generatedTypeCounts,
        effectiveTypeCounts:preview.effectiveTypeCounts,typeMixSource:preview.typeMixSource,weightedAdrKrw:preview.weightedAdrKrw,
        standardAdrKrw:hotel.adrKrw,roomRevenueEok:preview.roomRevenueEok});
      if (!hotel.plannerAvailable) warnings.push("실내 생성기를 불러오지 못해 자동 객실 수를 확인할 수 없습니다. 수동 객실 수가 없으면 객실 매출은 0입니다.");
      if (override) warnings.push(`객실 수 ${override}실은 사용자 운영 가정입니다. 자동 배치 ${hotel.generatedGuestRooms}실 및 법정 정원과 구분합니다.`);
      if (!hotel.effectiveGuestRooms) warnings.push("운영 계산에 사용할 객실이 0실입니다. 평면·코어·객실 수를 확인하세요.");
      warnings.push(...preview.warnings);
      hotel.revParKrw = hotel.weightedAdrKrw * hotel.occupancyPct / 100;
      hotel.ancillaryRevenueEok = hotel.roomRevenueEok * hotel.ancillaryRevenuePct / 100;
      hotel.totalRevenueEok = hotel.roomRevenueEok + hotel.ancillaryRevenueEok;
      hotel.variableOpexEok = hotel.totalRevenueEok * hotel.opexPct / 100;
      hotel.managementFeeEok = hotel.totalRevenueEok * hotel.managementFeePct / 100;
      hotel.ffeReserveEok = hotel.totalRevenueEok * hotel.ffeReservePct / 100;
      hotel.operatingNoiBeforeReserveEok = hotel.totalRevenueEok - hotel.variableOpexEok - hotel.fixedOpexEok - hotel.managementFeeEok;
      hotel.noiAfterReserveEok = hotel.operatingNoiBeforeReserveEok - hotel.ffeReserveEok;
      const hotelArea = hotelFloors.reduce((sum, fp) => sum + fp.areaSqm, 0);
      for (const row of ledger.filter(row => row.use === "hotel")) {
        const fp = hotelFloors.find(fp => fp.level === row.level);
        const areaShare=fp.areaSqm/Math.max(1,hotelArea);
        row.effectiveGuestRooms=0;row.hotelRoomRevenueEok=0;
        for(const type of hotel.roomTypes){
          const local=row.hotelRoomTypes.find(t=>t.type_id===type.type_id);
          const typeShare=type.generatedCount>0?local.generatedCount/type.generatedCount:areaShare;
          local.effectiveCount=type.effectiveCount*typeShare;
          row.effectiveGuestRooms+=local.effectiveCount;
          row.hotelRoomRevenueEok+=local.effectiveCount*type.adrKrw*365*hotel.occupancyPct/100/1e8;
        }
        const share=hotel.roomRevenueEok>0?row.hotelRoomRevenueEok/hotel.roomRevenueEok:
          hotel.effectiveGuestRooms>0?row.effectiveGuestRooms/hotel.effectiveGuestRooms:areaShare;
        row.hotelAnnualRevenueEok = hotel.totalRevenueEok * share;
        row.hotelAnnualNoiEok = hotel.noiAfterReserveEok * share;
      }
    }
    const rentalAnnualGrossEok = ledger.reduce((sum, row) => sum + row.rentalAnnualGrossEok, 0);
    const rentalAnnualNoiEok = ledger.reduce((sum, row) => sum + row.rentalAnnualNoiEok, 0);
    for (const row of ledger) {
      row.annualGrossIncomeEok = row.rentalAnnualGrossEok + row.hotelAnnualRevenueEok;
      row.annualNoiEok = row.rentalAnnualNoiEok + row.hotelAnnualNoiEok;
      row.monthlyGrossIncomeMan = row.annualGrossIncomeEok / 12 * 10000;
    }
    return { requestedMode, mode, floorIncome: ledger, hotel,
      contractAreaSqm, occupancyRate, ancillaryRentFactor, rentalOpexRatio,
      rentalAnnualGrossEok, rentalAnnualNoiEok,
      annualGrossIncomeEok: rentalAnnualGrossEok + hotel.totalRevenueEok,
      stabilizedNoiEok: rentalAnnualNoiEok + hotel.noiAfterReserveEok,
      assumptions: ["임대 계약면적 = 지상 바닥면적 + 지하 연면적 35%를 지상 층별 면적에 비례 배분한 검토 가정입니다. 실제 계약면적은 임대차 약정으로 확인하세요.",
        "임대 수입은 계약평 × 기준 임대료 × 대안·외장 할증 × (0.88 + 0.12 × 용도계수), 점유율 95%, 부가수입 12%, 운영비율 18%의 기존 가정을 사용합니다.",
        "호텔 운영은 연 365일의 안정화 가정입니다. ADR은 부가세·봉사료 제외 객실 단가이며 시장 조사값이 아닙니다.",
        "기준 ADR은 스탠더드 객실 단가입니다. 실제 완성된 트윈·스위트 유형별 수량과 단가 배수를 적용하며 지원실은 객실 매출에서 제외합니다.",
        "호텔 운영비율은 위탁수수료·FF&E·고정운영비를 제외합니다. 세 항목은 별도로 공제하며, FF&E 적립 후 NOI를 DSCR·매각·현금흐름에 적용합니다.",
        "호텔 객실층과 호텔 주용도의 로비·공용층은 임대수입에서 제외합니다. 비호텔 층의 임대수입만 별도로 합산합니다."], warnings };
  }
  function monthlyNoiAtRamp(income, ramp) {
    const factor = bounded(ramp, 0, 0, 1);
    const hotel = income.hotel;
    const hotelVariableProfit = hotel.active ? hotel.totalRevenueEok - hotel.variableOpexEok - hotel.managementFeeEok - hotel.ffeReserveEok : 0;
    return (income.rentalAnnualNoiEok + hotelVariableProfit) / 12 * factor - (hotel.active ? hotel.fixedOpexEok / 12 : 0);
  }
  return Object.freeze({ calculate, monthlyNoiAtRamp, defaults: DEFAULTS, version: "1.1.0" });
});
