/* Korean concept-building review. A trigger check is not a permit decision,
 * structural calculation, evacuation simulation, or a verified stair design.
 * Primary MCP responses: law-evidence/building-review-mcp-20261021.json.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AtelierBuildingReview = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  const checkedAt = "2026-10-21";
  const sources = Object.freeze([
    { id: "building-act-48", title: "건축법 제48조 · 구조내력", url: "https://www.law.go.kr/법령/건축법/제48조", checkedAt },
    { id: "building-decree-32", title: "건축법 시행령 제32조 · 구조 안전 확인·서류 제출", url: "https://www.law.go.kr/법령/건축법시행령/제32조", checkedAt },
    { id: "building-decree-34", title: "건축법 시행령 제34조 · 직통계단", url: "https://www.law.go.kr/법령/건축법시행령/제34조", checkedAt },
    { id: "building-decree-35", title: "건축법 시행령 제35조 · 피난계단", url: "https://www.law.go.kr/법령/건축법시행령/제35조", checkedAt },
    { id: "fire-egress-8", title: "피난·방화구조 기준 규칙 제8조 · 직통계단 이격", url: "https://www.law.go.kr/법령/건축물의피난ㆍ방화구조등의기준에관한규칙/제8조", checkedAt },
    { id: "fire-egress-9", title: "피난·방화구조 기준 규칙 제9조 · 계단 구조", url: "https://www.law.go.kr/법령/건축물의피난ㆍ방화구조등의기준에관한규칙/제9조", checkedAt },
    { id: "building-act-64", title: "건축법 제64조 · 승강기", url: "https://www.law.go.kr/법령/건축법/제64조", checkedAt }
  ]);
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const positive = value => finite(value) && value >= 0;
  const uniq = values => [...new Set(values)];
  function invalid(message) { throw new Error("건물 검토: " + message); }
  function normalizeFloors(input) {
    if (input.floorPlates !== undefined && !Array.isArray(input.floorPlates)) invalid("층별 바닥면적 배열이 필요합니다.");
    if (input.basementFloors !== undefined && !Array.isArray(input.basementFloors)) invalid("지하층 자료는 배열이어야 합니다.");
    const floors = [...(input.floorPlates || []), ...(input.basementFloors || [])], levels = new Set();
    if (floors.length > 150) invalid("층별 검토는 150개 층까지 지원합니다.");
    const clean = floors.map(fp => {
      if (!fp || !Number.isInteger(fp.level) || fp.level === 0 || !positive(fp.areaSqm) || levels.has(fp.level)) invalid("중복 없는 층 번호와 유효한 바닥면적이 필요합니다.");
      if (fp.habitableAreaSqm !== undefined && (!positive(fp.habitableAreaSqm) || fp.habitableAreaSqm > fp.areaSqm)) invalid("거실 면적은 해당 층 바닥면적 범위여야 합니다.");
      if (fp.useAreaSqm !== undefined && (!positive(fp.useAreaSqm) || fp.useAreaSqm > fp.areaSqm)) invalid("해당 용도 면적은 층 바닥면적 범위여야 합니다.");
      levels.add(fp.level); return { ...fp };
    });
    const below = input.floorsBelow === undefined ? 0 : input.floorsBelow;
    if (!Number.isInteger(below) || below < 0 || below > 20) invalid("지하층수는 0~20의 정수여야 합니다.");
    if (input.basementPlateSqm !== undefined && !positive(input.basementPlateSqm)) invalid("지하층 면적이 유효하지 않습니다.");
    for (let n = 1; n <= below; n++) if (!levels.has(-n)) clean.push({ level: -n,
      areaSqm: input.basementPlateSqm ?? null, use: "basement-unconfirmed", synthesized: true });
    return clean.sort((a,b) => a.level-b.level);
  }
  function useFor(fp, input) {
    if (typeof fp.useCategory === "string") return fp.useCategory;
    const use = String(input.buildingUse || "");
    if (fp.use === "hotel") return "hotel";
    if (fp.use === "residential") return input.residentialType === "apartment" || use.includes("공동주택") ? "housing" : "officetel";
    if (fp.use === "retail") return use.includes("판매시설") ? "sales" : "neighborhood-unspecified";
    if (fp.use === "basement-unconfirmed") return "unverified";
    if (use.includes("오피스텔")) return "officetel";
    if (use.includes("공동주택")) return "housing";
    if (/다중주택|다가구주택/.test(use)) return "multi-house";
    if (use.includes("단독주택")) return "detached-house";
    if (/호텔|숙박/.test(use)) return "hotel";
    if (use.includes("판매시설")) return "sales";
    if (/근린생활/.test(use)) return "neighborhood-unspecified";
    if (/오피스|업무시설/.test(use)) return "office";
    return "unverified";
  }
  function group(records, sourceIds) {
    const status = records.some(r => r.status === "confirmed-trigger") ? "confirmed-trigger"
      : records.some(r => r.status === "conditional") ? "conditional"
      : records.some(r => r.status === "unverified") ? "unverified" : "no-listed-trigger";
    return { status, triggers: records.filter(r => r.status === "confirmed-trigger"),
      conditions: records.filter(r => ["conditional","unverified"].includes(r.status)).map(r => r.reason),
      assessments: records, sourceIds, isPermitConfirmation: false };
  }
  function directStairs(floors, input) {
    const records = floors.map(fp => {
      const use = useFor(fp,input), base = { level: fp.level, use, sourceId: "building-decree-34" };
      const record = (status,reason,extra={}) => ({...base,status,reason,...extra});
      if (fp.isEscapeFloor === true) return record("no-listed-trigger","입력에서 피난층으로 지정한 층입니다. 실제 지상 출입구는 별도 확인합니다.");
      let threshold, kind="habitable", article;
      if (fp.level < 0) { threshold=200;article="제34조제2항제5호"; }
      else if (["assembly","religious","entertainment-bar","funeral"].includes(use)) {threshold=200;kind="use-floor";article="제34조제2항제1호";}
      else if (["neighborhood-performance","neighborhood-religious"].includes(use)) {threshold=300;kind="use-floor";article="제34조제2항제1호";}
      else if (["officetel","housing"].includes(use)) {threshold=300;article="제34조제2항제3호";}
      else if (fp.level>=3 && ["hotel","sales","academy","hostel","multi-house"].includes(use)) {threshold=200;article="제34조제2항제2호";}
      else if (fp.level>=3 && ["office","detached-house"].includes(use)) {threshold=400;article="제34조제2항제4호";}
      else if (fp.level>=3 && ["neighborhood-unspecified","unverified"].includes(use)) {
        return record(positive(fp.areaSqm)&&fp.areaSqm<200?"no-listed-trigger":"conditional",
          `${fp.level}층의 근린생활 세부 용도·거실 면적에 따라 200·300·400㎡ 조건을 구분해야 합니다.`);
      } else return record(use==="unverified"?"unverified":"no-listed-trigger","이 층에서 검토한 용도·층수 조합은 2개소 조건에 직접 대응하지 않습니다. 1개 계단 적합을 확정한 것은 아닙니다.");
      if(use==="housing" && fp.householdCount!==undefined && (!Number.isInteger(fp.householdCount)||fp.householdCount<0)) invalid("층별 세대수는 음수가 아닌 정수여야 합니다.");
      if(use==="housing" && fp.householdCount!==undefined && fp.householdCount<=4)
        return record("conditional",`${fp.level}층은 층당 4세대 이하 공동주택의 제3호 제외 조건을 입력했습니다. 다른 항·용도·피난 조건은 별도 검토합니다.`,{article,thresholdSqm:threshold});
      const measured=kind==="use-floor"?fp.useAreaSqm:fp.habitableAreaSqm;
      const verified=kind==="use-floor"?fp.useAreaVerified===true:fp.habitableAreaVerified===true;
      const extra={article,thresholdSqm:threshold,areaKind:kind,areaSqm:positive(measured)?measured:null};
      if(positive(measured)&&measured<threshold && verified) return record("no-listed-trigger",`${fp.level}층의 확인 입력 면적이 ${threshold}㎡ 미만입니다. 다른 피난 기준의 면제는 아닙니다.`,extra);
      if(positive(fp.areaSqm)&&fp.areaSqm<threshold) return record("no-listed-trigger",`${fp.level}층 전체 바닥면적이 ${threshold}㎡ 미만이므로 이 면적 조건은 충족하지 않습니다.`,extra);
      const housingUnknown=use==="housing" && fp.householdCount===undefined;
      if(positive(measured)&&measured>=threshold&&verified&&fp.isEscapeFloor===false&&!housingUnknown)
        return record("confirmed-trigger",`${fp.level}층의 확인 입력이 ${article}의 직통계단 2개소 이상 조건을 충족합니다.`,{...extra,minimumCount:2});
      return record("conditional",`${fp.level}층은 ${article} ${threshold}㎡ 조건을 확인해야 합니다. 총바닥면적을 ${kind==="habitable"?"거실":"해당 용도"} 면적으로 대체하지 않았습니다. 피난층 여부${housingUnknown?"·층별 세대수":""}와 면적 근거를 확인하세요.`,extra);
    });
    return group(records,["building-decree-34","fire-egress-8"]);
  }
  function stairTypes(floors,input) {
    const upper=floors.filter(fp=>fp.level>=5),upperSum=upper.reduce((sum,fp)=>sum+(fp.areaSqm||0),0);
    const protectedRecords=[],specialRecords=[];
    const apartment=String(input.buildingUse||"").includes("공동주택");
    for(const fp of floors){
      if(fp.isEscapeFloor===true)continue;
      const use=useFor(fp,input),base={level:fp.level,sourceId:"building-decree-35"};
      if(fp.level>=5||fp.level<=-2){
        const exceptionPossible=input.majorStructureFireResistant!==false &&
          (input.majorStructureFireResistant!==true||upper.length===0||upperSum<=200||input.fireCompartmentEvery200Sqm!==false);
        const protectedStatus=exceptionPossible?"conditional":"confirmed-trigger";
        protectedRecords.push({...base,status:protectedStatus,reason:exceptionPossible
          ?`${fp.level}층의 제35조제1항 피난계단 검토: 주요구조부 내화·불연 여부, 5층 이상 합계 200㎡ 및 200㎡마다 방화구획 예외를 확인해야 합니다.`
          :`${fp.level}층이 제35조제1항의 층수 조건에 해당하고 입력한 예외 조건은 성립하지 않습니다.`});
        if(use==="sales")specialRecords.push({...base,status:protectedStatus,minimumSpecialCount:1,
          reason:`${fp.level}층 판매시설은 제35조제3항에 따라 제1항 적용 시 1개소 이상 특별피난계단을 검토해야 합니다.`});
      }
      const high=fp.level>=(apartment?16:11),deep=fp.level<=-3;
      if(!high&&!deep)continue;
      if(positive(fp.areaSqm)&&fp.areaSqm<400){specialRecords.push({...base,status:"no-listed-trigger",reason:`${fp.level}층 바닥면적이 400㎡ 미만이므로 제35조제2항의 해당 층 면적 제외 조건에 해당합니다. 다른 계단 의무는 별도입니다.`});continue;}
      if(apartment&&input.openCorridorHousing===true){specialRecords.push({...base,status:"conditional",reason:"갓복도식 공동주택의 제35조제2항 제외 조건을 입력했습니다. 피난계단·다른 법령 적용은 별도 확인해야 합니다."});continue;}
      const buildingClassKnown=/업무|오피스|호텔|숙박|판매|근린|지식|공동주택|단독주택/.test(String(input.buildingUse||""));
      const conditional=!positive(fp.areaSqm)||(apartment&&input.openCorridorHousing!==false)||!buildingClassKnown;
      specialRecords.push({...base,status:conditional?"conditional":"confirmed-trigger",areaSqm:fp.areaSqm,
        reason:conditional?`${fp.level}층의 제35조제2항 적용은 바닥면적 400㎡·공동주택 갓복도 여부·용도 확인이 필요합니다.`
          :`${fp.level}층 바닥면적 ${fp.areaSqm}㎡가 제35조제2항의 특별피난계단 규모 조건에 해당합니다.`});
    }
    return {protectedStairs:group(protectedRecords,["building-decree-35","fire-egress-9"]),specialStairs:group(specialRecords,["building-decree-35","fire-egress-9"])};
  }
  function structural(floors,input) {
    const above=floors.filter(fp=>fp.level>0),count=above.reduce((max,fp)=>Math.max(max,fp.level),0);
    const knownTotal=input.totalGfaSqm!==undefined?input.totalGfaSqm:(floors.length&&floors.every(fp=>positive(fp.areaSqm))?floors.reduce((sum,fp)=>sum+fp.areaSqm,0):null);
    if(knownTotal!==null&&!positive(knownTotal))invalid("전체 연면적이 유효하지 않습니다.");
    const material=input.structureMaterial||"unknown",timber=material==="timber",knownMaterial=["timber","non-timber"].includes(material);
    if(!["timber","non-timber","unknown"].includes(material))invalid("구조재료 분류를 확인해 주세요.");
    const records=[],add=(status,reason,article)=>records.push({status,reason,article,sourceId:"building-decree-32"});
    if(count>=3||(count>=2&&knownMaterial&&!timber))add("confirmed-trigger","제32조제2항제1호의 층수 조건에 해당합니다.","제32조제2항제1호");
    else if(count>=2&&!knownMaterial)add("conditional","2층 건물은 목구조 여부에 따라 제1호 기준이 2층/3층으로 달라집니다.","제32조제2항제1호");
    const excludedArea=/창고|축사|재배사/.test(String(input.buildingUse||""));
    if(positive(knownTotal)&&!excludedArea){
      if(knownTotal>=(knownMaterial?(timber?500:200):500))add("confirmed-trigger","제32조제2항제2호의 연면적 조건에 해당합니다.","제32조제2항제2호");
      else if(knownTotal>=200&&!knownMaterial)add("conditional","연면적 200㎡ 이상 500㎡ 미만은 목구조 여부를 확인해야 합니다.","제32조제2항제2호");
    }else if(knownTotal===null)add("unverified","지하층을 포함한 전체 연면적을 확인하지 못했습니다.","제32조제2항제2호");
    for(const [key,threshold,article,label]of[["buildingHeightM",13,"제32조제2항제3호","높이"],["eavesHeightM",9,"제32조제2항제4호","처마높이"],["maxColumnSpanM",10,"제32조제2항제5호","기둥 간격"]]){
      if(input[key]!==undefined&&!positive(input[key]))invalid(label+" 입력이 유효하지 않습니다.");
      if(positive(input[key])&&input[key]>=threshold)add("confirmed-trigger",`${label} ${threshold}m 이상 조건에 해당합니다.`,article);
    }
    if(/단독주택|공동주택/.test(String(input.buildingUse||"")))add("confirmed-trigger","단독·공동주택은 제32조제2항제9호의 용도 조건을 확인합니다.","제32조제2항제9호");
    const documents=group(records,["building-decree-32"]);
    documents.conditions.push("허가·대수선 해당 여부, 표준설계도서 제외, 중요 건축물·문화유산·특수구조 등 제6~8호와 구조기준을 추가 확인해야 합니다.");
    if(input.standardDesignDocuments===true&&documents.status==="confirmed-trigger")documents.status="conditional";
    if(!records.length)documents.status="unverified";
    return {status:documents.status,label:documents.status==="confirmed-trigger"?"구조 안전 확인 서류 제출 규모 조건 해당":"구조 안전 확인·제출 조건 추가 검토",
      generalSafetyRequired:true,documentSubmission:documents,structuralDesignVerified:false,isPermitConfirmation:false,
      warnings:["소규모·매스 표현도 구조안전 검토의 면제를 뜻하지 않습니다. 건축법 제48조제1항은 건축물의 안전한 구조를 요구합니다.",
        "이 결과는 구조 안전 확인 서류의 규모 조건 검토이며 내진·하중·부재·기초·지반·접합부 계산을 수행하거나 구조 적합성을 확인하지 않습니다."],
      sourceIds:["building-act-48","building-decree-32"]};
  }
  function evaluate(input={}) {
    if(!input||typeof input!=="object"||Array.isArray(input))invalid("입력 객체가 필요합니다.");
    const requested=input.modelDetail??"auto";
    if(!["auto","massing","concept"].includes(requested))invalid("표현 수준은 auto, massing, concept 중 하나여야 합니다.");
    const floors=normalizeFloors(input),above=floors.filter(fp=>fp.level>0);
    const count=above.reduce((max,fp)=>Math.max(max,fp.level),0),gfa=above.reduce((sum,fp)=>sum+fp.areaSqm,0);
    const belowCount=floors.filter(fp=>fp.level<0).reduce((max,fp)=>Math.max(max,-fp.level),0);
    const compact=count<=4&&gfa<=1000&&belowCount<=1,profile=compact?"compact":"standard";
    const representation={requested,detailLevel:requested==="auto"?(compact?"massing":"concept"):requested,profile,
      reason:compact?"지상 4층 이하·지상 연면적 1,000㎡ 이하·지하 1층 이하의 기획 표시 분류입니다. 법정 소규모 분류·구조·BIM 검토 면제가 아닙니다.":"층수·면적·지하 규모에 따른 개념 표현입니다. 구조·피난 설계가 확인된 BIM이 아닙니다.",isStructuralDesign:false};
    const direct=directStairs(floors,input),types=stairTypes(floors,input);
    const extraStairs=floors.some(fp=>fp.level>=5&&fp.areaSqm>2000&&["sales","assembly","exhibition","sport","entertainment"].includes(useFor(fp,input)));
    const warnings=[...direct.conditions,...types.protectedStairs.conditions,...types.specialStairs.conditions,
      "총바닥면적·전용률 추정치를 법정 거실 면적으로 자동 변환하지 않습니다. 층별 용도·피난층·면적 원문을 확인해야 합니다.",
      "실제 보행거리, 직통계단 출입구 간 이격·연결, 계단실·부속실·방화문·제연 및 소방·접근성 적합성은 미검증입니다."];
    if(extraStairs)warnings.push("특수 용도의 5층 이상·해당 용도 2,000㎡ 초과 시 제35조제5항의 추가 피난계단 수를 별도 검토해야 합니다.");
    const status=[direct,types.protectedStairs,types.specialStairs].some(part=>part.status==="confirmed-trigger")?"confirmed-trigger"
      :[direct,types.protectedStairs,types.specialStairs].some(part=>part.status==="conditional")?"conditional":"unverified";
    const egress={status,stairCount:direct.status==="confirmed-trigger"?2:null,stairCountStatus:direct.status,
      stairType:types.specialStairs.status==="confirmed-trigger"?"특별피난계단 규모 조건 해당 · 상세 설계 미검증"
        :types.protectedStairs.status==="confirmed-trigger"?"피난계단 또는 특별피난계단 규모 조건 해당"
        :"계단 유형·개소수 조건 추가 확인",maxTravelDistM:null,
      directStairs:direct,...types,
      travelDistance:{status:"unverified",actualDistanceM:null,baseRuleLimitM:30,
        note:"주요구조부 내화·불연, 용도·층수에 따른 50m/40m 등 단서 적용과 실제 동선을 확인해야 합니다.",sourceIds:["building-decree-34"]},
      stairSeparation:{status:"unverified",actualDistanceM:null,defaultDiagonalRatio:.5,
        note:"스프링클러 등 자동식 소화설비 설치 시 1/3 단서와 각 거실 연결 통로를 확인합니다.",sourceIds:["fire-egress-8"]},
      warnings:uniq(warnings),isPermitConfirmation:false};
    const totalKnown=input.totalGfaSqm??(floors.length&&floors.every(fp=>positive(fp.areaSqm))?floors.reduce((sum,fp)=>sum+fp.areaSqm,0):null);
    const elevatorThreshold=count>=6&&positive(totalKnown)&&totalKnown>=2000;
    const emergencyElevator=positive(input.buildingHeightM)&&input.buildingHeightM>31;
    const circulationDemand={status:"reserved-planning",stairReservationCount:direct.status==="confirmed-trigger"||direct.status==="conditional"?2:1,
      elevatorReservation:compact?"optional":"reserved",elevatorRequired:null,
      elevatorReview:{status:elevatorThreshold||emergencyElevator?"conditional":"unverified",passengerThresholdMet:elevatorThreshold,emergencyHeightThresholdMet:emergencyElevator,
        note:"건축법 제64조의 6층·연면적 2,000㎡, 높이 31m 초과 조건과 제외 규정·접근성·용도별 설비 기준은 별도 확인합니다. 예약은 설치 의무 확정이 아닙니다."},
      reservationComplianceVerified:false,isPermitConfirmation:false,
      warnings:["코어 예약 박스 개수는 법정 계단 개소수나 피난·승강기 설치 적합성을 뜻하지 않습니다.",
        "계획 수요와 실제 코어 예약의 정합은 별도 검토해야 합니다. 계단 수요가 2개소인 경우 단일 코어 박스로 충족했다고 판단하지 않습니다."]};
    return {version:1,checkedAt,representation,circulationProfile:profile,circulationDemand,egress,
      structuralReview:structural(floors,input),sources:sources.map(source=>({...source})),isPermitConfirmation:false};
  }
  return Object.freeze({evaluate,checkedAt,sources});
});
