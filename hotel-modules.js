/* Original schematic hotel module catalog and revenue quantities. No vendor
 * runtime or source is included. Sizes and ADR multipliers are editable study
 * assumptions, not statutory minima, market evidence or an operating licence. */
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./study-identity.js") : root.AtelierStudyIdentity);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AtelierHotelModules = api;
})(typeof window !== "undefined" ? window : globalThis, function (identity) {
  "use strict";
  const TYPES = Object.freeze({ standard: "hotel.standard.v1", twin: "hotel.twin.v1", suite: "hotel.suite.v1", housekeeping: "hotel.housekeeping.v1" });
  const DEFAULTS = Object.freeze({ hotelAdrKrw: 180000, hotelOccupancyPct: 70, hotelRoomsOverride: 0,
    hotelTwinPct: 33, hotelSuitePct: 0, hotelServiceEveryRooms: 12, hotelTwinAdrFactor: 1.1, hotelSuiteAdrFactor: 1.8 });
  const CATALOG = [
    { type_id: TYPES.standard, key: "standard", roomType: "guest_room", label: "스탠더드 객실", minAreaSqm: 20, minSideM: 3.5, beds: 1, sofa: false, revenueRoom: true },
    { type_id: TYPES.twin, key: "twin", roomType: "guest_twin", label: "트윈 객실", minAreaSqm: 20, minSideM: 3.5, beds: 2, sofa: false, revenueRoom: true },
    { type_id: TYPES.suite, key: "suite", roomType: "guest_suite", label: "스위트 객실", minAreaSqm: 38, minSideM: 4, beds: 1, sofa: true, revenueRoom: true },
    { type_id: TYPES.housekeeping, key: "housekeeping", roomType: "hotel_service", label: "하우스키핑·운영 지원실", minAreaSqm: 4, minSideM: 1.5, beds: 0, sofa: false, revenueRoom: false }
  ].map(value => Object.freeze({ ...value, isStatutoryMinimum: false }));
  const clone = value => JSON.parse(JSON.stringify(value));
  const round = n => Math.round(n * 1e6) / 1e6;
  const isGuest = room => /^guest_/.test(room?.type || "");
  function setting(params, key, lo, hi, integer = false) {
    const value = params?.[key] === undefined ? DEFAULTS[key] : params[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < lo || value > hi || integer && !Number.isInteger(value)) throw new Error("호텔 설정 범위 오류: " + key);
    return value;
  }
  function normalizeHotelSettings(params = {}) {
    const s = { hotelAdrKrw: setting(params,"hotelAdrKrw",0,5e6), hotelOccupancyPct: setting(params,"hotelOccupancyPct",0,100),
      hotelRoomsOverride: setting(params,"hotelRoomsOverride",0,5000,true), hotelTwinPct: setting(params,"hotelTwinPct",0,100),
      hotelSuitePct: setting(params,"hotelSuitePct",0,100), hotelServiceEveryRooms: setting(params,"hotelServiceEveryRooms",0,50,true),
      hotelTwinAdrFactor: setting(params,"hotelTwinAdrFactor",0.5,3), hotelSuiteAdrFactor: setting(params,"hotelSuiteAdrFactor",1,5) };
    if (s.hotelTwinPct + s.hotelSuitePct > 100 + 1e-9) throw new Error("트윈·스위트 목표 비율의 합계는 100% 이하여야 합니다.");
    return s;
  }
  function definition(room) { return CATALOG.find(c => c.roomType === room?.type) || CATALOG.find(c => c.type_id === room?.type_id); }
  function dimensions(room) {
    const w = Number(room?.maxX) - Number(room?.minX), d = Number(room?.maxZ) - Number(room?.minZ);
    return { widthM: w, depthM: d, areaSqm: w * d, minSideM: Math.min(w,d) };
  }
  function fits(room, def) { const d = dimensions(room); return [d.widthM,d.depthM].every(n=>Number.isFinite(n)&&n>0) && d.areaSqm + 1e-6 >= def.minAreaSqm && d.minSideM + 1e-6 >= def.minSideM; }
  function counts(rooms) { const result = { standard: 0, twin: 0, suite: 0, housekeeping: 0 }; for (const room of rooms) { const d = definition(room); if (d) result[d.key]++; } return result; }
  // Largest remainders preserve integer quantities and the exact requested sum.
  function allocate(total, weights) {
    const sum = weights.reduce((s,n)=>s+n,0), raw = weights.map(n=>sum>0?total*n/sum:0), out=raw.map(Math.floor);
    const order=raw.map((n,i)=>({i,rest:n-out[i]})).sort((a,b)=>b.rest-a.rest||a.i-b.i);
    const remaining=total-out.reduce((s,x)=>s+x,0);
    for(let n=0;n<remaining;n++) out[order[n%order.length].i]++;
    return out;
  }
  function stableId(scope,kind,level,localId) {
    return "formequa:" + [scope || "study",kind,level,localId].map(value=>encodeURIComponent(String(value))).join(":");
  }
  function planRooms(rooms, params = {}) {
    const settings=normalizeHotelSettings(params), result=(rooms||[]).map(room=>({...room})), warnings=[];
    for(const room of result){
      if(!(isGuest(room)||room.type==="hotel_service"))continue;
      if(![room.minX,room.maxX,room.minZ,room.maxZ].every(n=>typeof n==="number"&&Number.isFinite(n))||room.maxX<=room.minX||room.maxZ<=room.minZ)throw new Error("호텔 구획의 경계가 유효하지 않습니다.");
    }
    const candidates=result.filter(isGuest), existing=result.filter(room=>room.type==="hotel_service");
    const desiredServices=settings.hotelServiceEveryRooms>0 && candidates.length ? Math.ceil((candidates.length+existing.length)/(settings.hotelServiceEveryRooms+1)) : existing.length;
    const need=Math.min(Math.max(0,candidates.length-1),Math.max(0,desiredServices-existing.length));
    const ordered=candidates.slice().sort((a,b)=>dimensions(a).areaSqm-dimensions(b).areaSqm||String(a.id).localeCompare(String(b.id)));
    for(const room of ordered.slice(0,need)) { room.type="hotel_service"; room.type_id=TYPES.housekeeping; room.label="하우스키핑·운영 지원실"; room.hotelAssignmentReason="service-reservation"; }
    const guests=result.filter(isGuest), requested=allocate(guests.length,[100-settings.hotelTwinPct-settings.hotelSuitePct,settings.hotelTwinPct,settings.hotelSuitePct]);
    const available=guests.slice().sort((a,b)=>dimensions(b).areaSqm-dimensions(a).areaSqm||String(a.id).localeCompare(String(b.id)));
    const assigned=new Set();
    for(const [index,key] of [[2,"suite"],[1,"twin"]]) {
      const def=CATALOG.find(c=>c.key===key); let remaining=requested[index];
      for(const room of available) if(remaining>0&&!assigned.has(room)&&fits(room,def)) { room.type=def.roomType; room.type_id=def.type_id; room.requested_type_id=def.type_id; room.label=def.label; assigned.add(room); remaining--; }
    }
    for(const room of guests) if(!assigned.has(room)) { const def=fits(room,CATALOG[0])?CATALOG[0]:CATALOG[3]; room.type=def.roomType; room.type_id=def.type_id; room.label=def.label; }
    for(const room of result.filter(room=>room.type==="hotel_service")) room.type_id=TYPES.housekeeping;
    const planned=counts(result), unmet={ standard:Math.max(0,requested[0]-planned.standard),twin:Math.max(0,requested[1]-planned.twin),suite:Math.max(0,requested[2]-planned.suite) };
    if(planned.housekeeping<desiredServices) warnings.push("객실을 모두 지원 공간으로 바꾸지 않기 위해 하우스키핑 목표 수량을 확보하지 못했습니다. 운영 지원 계획을 별도 검토하세요.");
    if(unmet.suite||unmet.twin) warnings.push("목표 객실 유형 중 면적·폭이 맞지 않는 구획은 스탠더드 또는 지원 공간으로 배정했습니다. 목표 수량은 확정 수량이 아닙니다.");
    return {rooms:result,settings,requestedTypeCounts:{standard:requested[0],twin:requested[1],suite:requested[2]},plannedTypeCounts:planned,unmetTypeCounts:unmet,
      service:{requestedCount:desiredServices,plannedCount:planned.housekeeping,everyGuestRooms:settings.hotelServiceEveryRooms,isPlanningAssumption:true},warnings};
  }
  function adrFactor(def,settings) { return def.key==="twin"?settings.hotelTwinAdrFactor:def.key==="suite"?settings.hotelSuiteAdrFactor:1; }
  function fixtureReasons(room,plan,def) {
    const reasons=[];
    if(!fits(room,def)) reasons.push("module-dimensions");
    const inside=(a,b)=>a&&b&&[a.minX,a.maxX,a.minZ,a.maxZ,b.minX,b.maxX,b.minZ,b.maxZ].every(Number.isFinite)&&a.minX>=b.minX-1e-6&&a.maxX<=b.maxX+1e-6&&a.minZ>=b.minZ-1e-6&&a.maxZ<=b.maxZ+1e-6;
    const validDoor=(d,b)=>d&&b&&[d.x,d.z,d.width].every(Number.isFinite)&&d.width>0&&(d.axis==="x"
      ?(Math.abs(d.z-b.minZ)<1e-5||Math.abs(d.z-b.maxZ)<1e-5)&&d.x-d.width/2>=b.minX-1e-6&&d.x+d.width/2<=b.maxX+1e-6
      :d.axis==="z"&&(Math.abs(d.x-b.minX)<1e-5||Math.abs(d.x-b.maxX)<1e-5)&&d.z-d.width/2>=b.minZ-1e-6&&d.z+d.width/2<=b.maxZ+1e-6);
    const doors=(plan.doors||[]).filter(d=>d.roomId===room.id);
    if(!doors.some(d=>d.kind!=="ensuite"&&validDoor(d,room))) reasons.push("entrance-door");
    const footprint=item=>({minX:item.x-item.width/2,maxX:item.x+item.width/2,minZ:item.z-item.depth/2,maxZ:item.z+item.depth/2});
    const items=(plan.furniture||[]).filter(item=>item.roomId===room.id&&[item.x,item.z,item.width,item.depth].every(Number.isFinite)&&item.width>0&&item.depth>0&&inside(footprint(item),room));
    if(items.filter(item=>item.type==="bed").length<def.beds) reasons.push("bed-count");
    if(def.sofa&&!items.some(item=>item.type==="sofa")) reasons.push("suite-living");
    if(!inside(room.ensuite?.bounds,room)||!validDoor(room.ensuite?.door,room.ensuite?.bounds)||!doors.some(d=>d.kind==="ensuite"&&validDoor(d,room.ensuite?.bounds))||!items.some(item=>item.type==="toilet"&&item.zone==="ensuite"&&inside(footprint(item),room.ensuite?.bounds))||!items.some(item=>item.type==="vanity"&&item.zone==="ensuite"&&inside(footprint(item),room.ensuite?.bounds))) reasons.push("ensuite-fixtures");
    return reasons;
  }
  function assignRooms(plan, params = {}) {
    const settings=normalizeHotelSettings(params), result={...plan,rooms:(plan.rooms||[]).map(room=>({...room})),warnings:[...(plan.warnings||[])]};
    if(plan.use!=="hotel") return result;
    const scope=identity.scope(params), unmet={standard:0,twin:0,suite:0};
    const roomIdsSeen=new Set(),requestedCounts=plan.hotelPlanning?.requestedTypeCounts||counts(plan.rooms||[]);
    for(const room of result.rooms) {
      if(typeof room.id!=="string"||!room.id||roomIdsSeen.has(room.id))throw new Error("호텔 실 ID는 층 내에서 고유해야 합니다.");roomIdsSeen.add(room.id);
      let def=definition(room); if(!def) continue;
      const requestedTypeId=room.requested_type_id||def.type_id, reasons=def.revenueRoom?fixtureReasons(room,plan,def):[];
      if(def.revenueRoom&&reasons.length) {
        unmet[def.key]++;
        const basicReasons=fixtureReasons(room,plan,CATALOG[0]);
        def=basicReasons.length?CATALOG[3]:CATALOG[0]; room.type=def.roomType; room.label=def.label;
        result.warnings.push("일부 객실 유형은 침대·욕실·출입 또는 모듈 치수가 맞지 않아 실제 완성된 유형으로 조정했습니다.");
      }
      room.type_id=def.type_id;
      room.moduleId=stableId(scope,"room",plan.level,room.id);
      room.hotelModule={type_id:def.type_id,moduleId:room.moduleId,requestedTypeId,status:def.revenueRoom?"complete":"support",
        adrFactor:def.revenueRoom?adrFactor(def,settings):null,adrKrw:def.revenueRoom?settings.hotelAdrKrw*adrFactor(def,settings):null,
        reasons,...(!def.revenueRoom?{supportFitStatus:fits(room,def)?"geometry-reserved":"insufficient-space"}:{}),isPermitConfirmation:false};
    }
    const guestRooms=result.rooms.filter(room=>room.hotelModule?.status==="complete"), roomIds=new Set(guestRooms.map(room=>room.id));
    result.metrics={...(plan.metrics||{}),guestRoomCount:guestRooms.length,guestBedCount:(plan.furniture||[]).filter(item=>item.type==="bed"&&roomIds.has(item.roomId)).length,
      guestRoomAreaSqm:round(guestRooms.reduce((sum,room)=>sum+dimensions(room).areaSqm,0)),serviceAreaSqm:round(result.rooms.filter(room=>room.type==="hotel_service").reduce((sum,room)=>sum+dimensions(room).areaSqm,0))};
    const actualCounts=counts(result.rooms);
    result.hotelModules={settings,typeCounts:actualCounts,requestedTypeCounts:requestedCounts,
      unmetTypeCounts:{standard:Math.max(0,requestedCounts.standard-actualCounts.standard),twin:Math.max(0,requestedCounts.twin-actualCounts.twin),suite:Math.max(0,requestedCounts.suite-actualCounts.suite)},
      unmetFixtureTypeCounts:unmet,service:plan.hotelPlanning?.service?{...plan.hotelPlanning.service,actualCount:actualCounts.housekeeping,
        geometryReservedCount:result.rooms.filter(room=>room.hotelModule?.supportFitStatus==="geometry-reserved").length}:null,
      quantitySource:"fitted-room-modules",isPlanningAssumption:true};
    result.warnings.push(...(plan.hotelPlanning?.warnings||[]));
    result.warnings=[...new Set(result.warnings)];
    return result;
  }
  function preview(planOrRooms,params={}) {
    const settings=normalizeHotelSettings(params), rooms=Array.isArray(planOrRooms)?planOrRooms:planOrRooms?.rooms||[];
    const generated=rooms.filter(room=>room.hotelModule?.status==="complete"&&definition(room)?.revenueRoom);
    const definitions=CATALOG.filter(c=>c.revenueRoom), actual=definitions.map(def=>generated.filter(room=>room.type_id===def.type_id).length), total=actual.reduce((s,n)=>s+n,0);
    const overridden=settings.hotelRoomsOverride>0, effective=settings.hotelRoomsOverride||total;
    const configured=[100-settings.hotelTwinPct-settings.hotelSuitePct,settings.hotelTwinPct,settings.hotelSuitePct];
    const effectiveCounts=overridden?allocate(effective,total?actual:configured):actual;
    const roomTypes=definitions.map((def,i)=>({type_id:def.type_id,key:def.key,label:def.label,generatedCount:actual[i],effectiveCount:effectiveCounts[i],adrFactor:adrFactor(def,settings),adrKrw:settings.hotelAdrKrw*adrFactor(def,settings)}));
    const dailyRoomRevenueKrw=roomTypes.reduce((sum,row)=>sum+row.effectiveCount*row.adrKrw,0);
    return {generatedGuestRooms:total,effectiveGuestRooms:effective,roomsSource:overridden?"user-assumption":"generated",roomTypes,
      generatedTypeCounts:{standard:actual[0],twin:actual[1],suite:actual[2]},
      effectiveTypeCounts:{standard:effectiveCounts[0],twin:effectiveCounts[1],suite:effectiveCounts[2]},
      typeMixSource:overridden?(total?"generated-proportions-user-total":"configured-proportions-user-total"):"fitted-room-modules",
      weightedAdrKrw:effective?dailyRoomRevenueKrw/effective:0,roomRevenueEok:dailyRoomRevenueKrw*365*settings.hotelOccupancyPct/100/1e8,
      dailyRoomRevenueKrw,occupancyPct:settings.hotelOccupancyPct,isMarketEvidence:false,
      warnings:overridden?["운영 객실 수는 사용자 가정입니다. 유형별 수량은 생성 객실 비율(생성 객실이 없으면 목표 비율)을 정수 배분하며 평면 객실 수를 변경하지 않습니다."]:[]};
  }
  return Object.freeze({catalog:()=>CATALOG.map(clone),types:TYPES,defaults:DEFAULTS,normalizeHotelSettings,planRooms,assignRooms,preview,stableId,studyScope:identity.scope,studyIdentity:identity.describe,version:"1.0.0"});
});
