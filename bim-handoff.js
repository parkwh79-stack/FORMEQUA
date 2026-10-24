/* Original versioned JSON coordination bridge. This is an application schema,
 * not IFC, a certified BIM standard, or an executable Revit/Dynamo connector.
 * Existing IFC planning-mass export remains separate. */
(function(root,factory){
  const api=factory(typeof module==="object"&&module.exports?require("./hotel-modules.js"):root.AtelierHotelModules);
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.AtelierBimHandoff=api;
})(typeof window!=="undefined"?window:globalThis,function(hotelModules){
  "use strict";
  const EPS=1e-5;
  const finite=(n,name)=>{if(typeof n!=="number"||!Number.isFinite(n))throw new Error("BIM 전달 좌표 오류: "+name);return n;};
  const positive=(n,name)=>{if(finite(n,name)<=0)throw new Error("BIM 전달 치수 오류: "+name);return n;};
  const round=n=>Math.round(n*1e6)/1e6;
  const key=values=>values.map(round).join(",");
  const id=(scope,kind,level,source)=>hotelModules.stableId(scope,kind,level,source);
  function toBimPoint(point){return [finite(point.x,"x"),-finite(point.z,"z"),finite(point.y,"height")].map(round);}
  function toRevitFeet(point){if(!Array.isArray(point)||point.length!==3)throw new Error("BIM XYZ 좌표 3개가 필요합니다.");return point.map(n=>finite(n,"BIM coordinate")/0.3048);}
  function boundsOf(room){
    const b={minX:finite(room.minX,"minX"),maxX:finite(room.maxX,"maxX"),minZ:finite(room.minZ,"minZ"),maxZ:finite(room.maxZ,"maxZ")};
    positive(b.maxX-b.minX,"room width");positive(b.maxZ-b.minZ,"room depth");return b;
  }
  function outline(b,elevation){return [[b.minX,b.minZ],[b.maxX,b.minZ],[b.maxX,b.maxZ],[b.minX,b.maxZ],[b.minX,b.minZ]].map(([x,z])=>toBimPoint({x,z,y:elevation}));}
  function overlaps(a,b,c,d){return Math.min(b,d)-Math.max(a,c)>EPS;}
  function liesOnRect(w,b){
    return Math.abs(w.z1-w.z2)<EPS
      ? (Math.abs(w.z1-b.minZ)<EPS||Math.abs(w.z1-b.maxZ)<EPS)&&overlaps(Math.min(w.x1,w.x2),Math.max(w.x1,w.x2),b.minX,b.maxX)
      : (Math.abs(w.x1-b.minX)<EPS||Math.abs(w.x1-b.maxX)<EPS)&&overlaps(Math.min(w.z1,w.z2),Math.max(w.z1,w.z2),b.minZ,b.maxZ);
  }
  function adjacentWalls(door,walls){
    const center=door.axis==="x"?door.x:door.z,constant=door.axis==="x"?door.z:door.x,half=door.width/2;
    return walls.filter(w=>{
      const same=door.axis==="x"?Math.abs(w.source.z1-constant)<EPS&&Math.abs(w.source.z2-constant)<EPS:Math.abs(w.source.x1-constant)<EPS&&Math.abs(w.source.x2-constant)<EPS;
      if(!same)return false;
      const ends=door.axis==="x"?[w.source.x1,w.source.x2]:[w.source.z1,w.source.z2];
      return ends.some(n=>Math.abs(n-(center-half))<0.05||Math.abs(n-(center+half))<0.05);
    }).map(w=>w.id);
  }
  function validateHandoff(value){
    const errors=[],warnings=[];
    if(value?.schema!=="formequa.bim-handoff"||value.schemaVersion!==1)errors.push("지원하지 않는 BIM 전달 스키마입니다.");
    if(value?.coordinateFrame?.units!=="metre"||value?.coordinateFrame?.pointMapping!=="[x, -z, height]")errors.push("좌표 단위·축 매핑이 일치하지 않습니다.");
    const frame=value?.coordinateFrame;
    if(!Number.isFinite(frame?.frameRotationRad))errors.push("좌표계 회전각이 유효하지 않습니다.");
    if(frame?.originWgs84!==null&&(!Array.isArray(frame?.originWgs84)||frame.originWgs84.length!==2||!frame.originWgs84.every(Number.isFinite)||Math.abs(frame.originWgs84[0])>180||Math.abs(frame.originWgs84[1])>90))errors.push("좌표계 WGS84 원점이 유효하지 않습니다.");
    if(frame?.projection!==null&&![frame?.projection?.metersPerDegreeLon,frame?.projection?.metersPerDegreeLat].every(n=>Number.isFinite(n)&&n>0))errors.push("좌표계 투영 비율이 유효하지 않습니다.");
    const lists=["storeys","rooms","walls","doors","relations"];
    for(const name of lists)if(!Array.isArray(value?.[name]))errors.push(name+" 배열이 없습니다.");
    if(errors.length)return {valid:false,status:"invalid",errors,warnings};
    const all=[...value.storeys,...value.rooms,...value.walls,...value.doors], ids=new Set();
    for(const o of all){if(typeof o.id!=="string"||!o.id||ids.has(o.id))errors.push("누락되거나 중복된 객체 ID: "+String(o.id));ids.add(o.id);}
    const storeyIds=new Set(value.storeys.map(s=>s.id)),roomIds=new Set(value.rooms.map(r=>r.id)),wallIds=new Set(value.walls.map(w=>w.id)),storeyById=new Map(value.storeys.map(s=>[s.id,s])),roomById=new Map(value.rooms.map(r=>[r.id,r])),wallById=new Map(value.walls.map(w=>[w.id,w]));
    const point=p=>Array.isArray(p)&&p.length===3&&p.every(n=>typeof n==="number"&&Number.isFinite(n));
    for(const s of value.storeys)if(!Number.isInteger(s.level)||!Number.isFinite(s.elevationM)||!Number.isFinite(s.heightM)||s.heightM<=0)errors.push("층 위치·높이가 유효하지 않습니다: "+s.id);
    for(const o of [...value.rooms,...value.walls,...value.doors])if(!storeyIds.has(o.storeyId))errors.push("존재하지 않는 층 참조: "+o.id);
    for(const r of value.rooms){
      if(!Array.isArray(r.boundaryBimM)||r.boundaryBimM.length!==5||!r.boundaryBimM.every(point)||!Number.isFinite(r.areaSqm)||r.areaSqm<=0)errors.push("실 경계·면적이 유효하지 않습니다: "+r.id);
      else {
        let area=0;for(let i=0;i<r.boundaryBimM.length-1;i++){const a=r.boundaryBimM[i],b=r.boundaryBimM[i+1];area+=a[0]*b[1]-b[0]*a[1];}
        if(Math.abs(Math.abs(area)/2-r.areaSqm)>0.01)errors.push("실 경계와 면적이 일치하지 않습니다: "+r.id);
        if(r.boundaryBimM.some(p=>Math.abs(p[2]-storeyById.get(r.storeyId)?.elevationM)>EPS))errors.push("실의 높이가 층 위치와 일치하지 않습니다: "+r.id);
        if(r.boundaryBimM[0].some((n,i)=>Math.abs(n-r.boundaryBimM[4][i])>EPS))errors.push("실 경계가 닫히지 않았습니다: "+r.id);
      }
    }
    for(const w of value.walls)if(!point(w.startBimM)||!point(w.endBimM)||Math.hypot(...w.startBimM.map((n,i)=>n-w.endBimM[i]))<EPS||!Number.isFinite(w.heightM)||w.heightM<=0||!Number.isFinite(w.thicknessM)||w.thicknessM<=0)errors.push("벽 형상이 유효하지 않습니다: "+w.id);
    for(const d of value.doors){
      if(!roomIds.has(d.roomId))errors.push("문이 존재하지 않는 실을 참조합니다: "+d.id);
      else if(roomById.get(d.roomId).storeyId!==d.storeyId)errors.push("문과 실이 서로 다른 층을 참조합니다: "+d.id);
      if(!point(d.centerBimM)||!Number.isFinite(d.widthM)||d.widthM<=0)errors.push("문 위치·폭이 유효하지 않습니다: "+d.id);
      else if(Math.abs(d.centerBimM[2]-storeyById.get(d.storeyId)?.elevationM)>EPS)errors.push("문의 높이가 층 위치와 일치하지 않습니다: "+d.id);
      if(!(d.adjacentWallIds||[]).every(w=>wallIds.has(w)))errors.push("문이 존재하지 않는 벽을 참조합니다: "+d.id);
      else if((d.adjacentWallIds||[]).some(w=>wallById.get(w).storeyId!==d.storeyId))errors.push("문과 인접 벽이 서로 다른 층을 참조합니다: "+d.id);
      if(!d.nativeHostVerified)warnings.push("문 호스트 벽 복원·패밀리 매핑이 필요합니다.");
    }
    for(const rel of value.relations)if(!ids.has(rel.fromId)||!ids.has(rel.toId))errors.push("관계가 존재하지 않는 객체를 참조합니다: "+rel.kind);
    for(const s of value.storeys)if(Number.isInteger(s.expectedGuestRoomCount)){
      const count=value.rooms.filter(r=>r.storeyId===s.id&&r.hotelModule?.status==="complete").length;
      if(count!==s.expectedGuestRoomCount)errors.push("호텔 평면 집계와 전달 객실 수가 다릅니다: "+s.id);
    }
    if(value.nativeExecution?.performed!==false)errors.push("실행되지 않은 native BIM 작업을 실행 완료로 표시할 수 없습니다.");
    return {valid:errors.length===0,status:errors.length?"invalid":"review-required",errors:[...new Set(errors)],warnings:[...new Set(warnings)]};
  }
  function buildHandoff(model,options={}){
    if(!model||!Array.isArray(model.floorPlates))throw new Error("계산된 층별 모델이 필요합니다.");
    const scope=hotelModules.studyScope(options,model);
    const createdAt=options.createdAt||new Date().toISOString();if(!Number.isFinite(Date.parse(createdAt)))throw new Error("유효한 생성 시각이 필요합니다.");
    const geo=model.parcelGeometry,rotation=geo?.frameRotationRad===undefined?0:finite(geo.frameRotationRad,"frameRotationRad");
    const center=geo?.centerWgs84||null;
    if(center!==null&&(!Array.isArray(center)||center.length!==2||!center.every(Number.isFinite)))throw new Error("WGS84 원점이 유효하지 않습니다.");
    const result={schema:"formequa.bim-handoff",schemaVersion:1,createdAt,project:{id:scope,title:String(options.title||"FORMEQUA Planning Study")},
      modelScope:"schematic-coordination",isPermitModel:false,isStructuralDesign:false,
      coordinateFrame:{units:"metre",sourceAxes:{x:"building local X",y:"height",z:"building local Z (south before frame rotation)"},
        bimAxes:{X:"source x",Y:"-source z",Z:"source y (height)"},pointMapping:"[x, -z, height]",originWgs84:center,frameRotationRad:rotation,
        trueNorthBim:[round(-Math.sin(rotation)),round(Math.cos(rotation)),0],projection:geo?.projection?{metersPerDegreeLon:geo.projection.metersPerDegreeLon,metersPerDegreeLat:geo.projection.metersPerDegreeLat}:null,
        elevationDatum:"unsurveyed local ground = 0 m",isSurveyed:false,revitInternalLengthUnit:"foot",metresPerFoot:0.3048},
      nativeExecution:{performed:false,adapterImplemented:false,target:"Revit/Dynamo (external environment required)",
        prerequisites:["사용 가능한 Revit 호스트와 적법한 라이선스","Revit·Dynamo 버전별 검증","프로젝트 좌표·단위 확인","Family/type 및 문 호스트 매핑","외부 실행을 사용자가 별도로 승인"]},
      storeys:[],rooms:[],walls:[],doors:[],relations:[],warnings:["JSON은 FORMEQUA 전용 협업 스키마이며 IFC·RVT 파일 또는 실행된 Revit 모델이 아닙니다.","벽은 개념 평면의 분절 선분입니다. 문 삽입 전에 개구부를 포함한 호스트 벽을 별도로 복원·검증해야 합니다."]};
    const plans=Array.isArray(options.plans)?options.plans:null,levels=new Set();
    for(const fp of model.floorPlates.slice().sort((a,b)=>a.level-b.level)){
      if(!Number.isInteger(fp.level)||levels.has(fp.level))throw new Error("층 번호는 중복 없는 정수여야 합니다.");levels.add(fp.level);
      const elevation=finite(fp.zBottom,"floor elevation"),height=positive(finite(fp.zTop,"floor top")-elevation,"floor height"),storeyId=id(scope,"storey",fp.level,"main");
      const plan=model.representation?.detailLevel==="massing"?null:plans?plans.find(p=>p.level===fp.level):options.planner?.generate(fp,{...(options.inputs||{}),coreLayout:model.coreLayout,detailLevel:"concept"});
      const storey={id:storeyId,level:fp.level,name:fp.level<0?"B"+-fp.level:fp.level+"F",use:fp.use,elevationM:elevation,heightM:height,
        planStatus:plan?.status||"not-supplied",expectedGuestRoomCount:plan?.use==="hotel"&&plan?.status==="generated"?plan.metrics?.guestRoomCount:null};
      result.storeys.push(storey);
      if(!plan||plan.status!=="generated"){result.warnings.push(storey.name+" 실내 객체는 생성되지 않아 전달하지 않았습니다.");continue;}
      const roomMap=new Map(),wallRows=[],wallKeys=new Set();
      for(const r of plan.rooms||[]){
        if(typeof r.id!=="string"||!r.id||roomMap.has(r.id))throw new Error("실 ID는 층 내에서 고유해야 합니다.");
        const b=boundsOf(r),roomId=id(scope,"room",fp.level,r.id);roomMap.set(r.id,roomId);
        const room={id:roomId,sourceId:r.id,moduleId:r.moduleId||null,type_id:r.type_id||null,storeyId,label:r.label,type:r.type,
          areaSqm:round((b.maxX-b.minX)*(b.maxZ-b.minZ)),boundaryBimM:outline(b,elevation),sourceBoundsM:b,hotelModule:r.hotelModule?JSON.parse(JSON.stringify(r.hotelModule)):null};
        if(Number.isFinite(r.areaSqm)&&Math.abs(r.areaSqm-room.areaSqm)>0.01)throw new Error("실 경계와 원본 면적이 다릅니다: "+r.id);
        result.rooms.push(room);result.relations.push({kind:"storey-contains",fromId:storeyId,toId:roomId});
      }
      for(const w of plan.walls||[]){
        ["x1","z1","x2","z2"].forEach(k=>finite(w[k],k));
        positive(Math.hypot(w.x2-w.x1,w.z2-w.z1),"wall length");positive(w.height,"wall height");positive(w.thickness,"wall thickness");
        const a=[w.x1,w.z1],b=[w.x2,w.z2],ends=[a,b].sort((x,y)=>x[0]-y[0]||x[1]-y[1]),signature=key([...ends[0],...ends[1],w.height,w.thickness]);
        if(wallKeys.has(signature))continue;wallKeys.add(signature);
        const wall={id:id(scope,"wall",fp.level,signature),storeyId,startBimM:toBimPoint({x:w.x1,z:w.z1,y:elevation}),endBimM:toBimPoint({x:w.x2,z:w.z2,y:elevation}),
          thicknessM:w.thickness,heightM:w.height,kind:"concept-partition-segment",isStructuralElement:false,nativeHostVerified:false};
        result.walls.push(wall);wallRows.push({id:wall.id,source:w});result.relations.push({kind:"storey-contains",fromId:storeyId,toId:wall.id});
        for(const r of plan.rooms||[])if(liesOnRect(w,r)||r.ensuite?.bounds&&liesOnRect(w,r.ensuite.bounds))result.relations.push({kind:"room-boundary-segment",fromId:roomMap.get(r.id),toId:wall.id});
      }
      for(const d of plan.doors||[]){
        if(!roomMap.has(d.roomId))throw new Error("문이 존재하지 않는 실을 참조합니다: "+d.roomId);
        finite(d.x,"door x");finite(d.z,"door z");positive(d.width,"door width");if(!["x","z"].includes(d.axis))throw new Error("문 축은 x 또는 z여야 합니다.");
        const door={id:id(scope,"door",fp.level,[d.roomId,d.kind||"entrance",key([d.x,d.z,d.width])].join("/")),storeyId,roomId:roomMap.get(d.roomId),
          kind:d.kind||"entrance",centerBimM:toBimPoint({x:d.x,z:d.z,y:elevation}),widthM:d.width,sourceAxis:d.axis,
          adjacentWallIds:adjacentWalls(d,wallRows),hostWallId:null,nativeHostVerified:false,hostResolution:"opening-gap-requires-wall-reconstruction"};
        result.doors.push(door);result.relations.push({kind:"room-door",fromId:door.roomId,toId:door.id},{kind:"storey-contains",fromId:storeyId,toId:door.id});
        for(const wallId of door.adjacentWallIds)result.relations.push({kind:"opening-adjacent-segment",fromId:door.id,toId:wallId});
      }
    }
    result.warnings=[...new Set(result.warnings)];result.validation=validateHandoff(result);
    if(!result.validation.valid)throw new Error("BIM 전달 정합 검증 실패: "+result.validation.errors.join(" / "));
    result.quantities={storeys:result.storeys.length,rooms:result.rooms.length,walls:result.walls.length,doors:result.doors.length,
      generatedHotelRooms:result.rooms.filter(r=>r.hotelModule?.status==="complete").length};
    return result;
  }
  function serialize(model,options){return JSON.stringify(buildHandoff(model,options),null,2);}
  return Object.freeze({buildHandoff,build:buildHandoff,validateHandoff,serialize,toBimPoint,toRevitFeet,version:"1.0.0"});
});
