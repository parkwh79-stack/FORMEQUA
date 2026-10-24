/** Shared editable planning assumptions. These are not statutory minima. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.AtelierSpatialSettings=api;})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const enums={officeDeskType:['single','back-to-back','bench','standing'],officeOrientation:['auto','0','90']};
  const numbers={officeDeskWidthM:[1.2,2],officeDeskDepthM:[.6,1],officeAisleWidthM:[.9,2.4],officeRowGapM:[.7,2],officeBackClearanceM:[.6,1.8],officeCollaborationPct:[0,40],officeTargetSeats:[0,1000,true],hotelTwinPct:[0,100],hotelSuitePct:[0,100],hotelServiceEveryRooms:[0,50,true],hotelTwinAdrFactor:[.5,3],hotelSuiteAdrFactor:[1,5],navigationClearanceM:[.15,.4]};
  const defaults=Object.freeze({officeDeskType:'single',officeOrientation:'auto',officeDeskWidthM:1.4,officeDeskDepthM:.7,officeAisleWidthM:1.2,officeRowGapM:.9,officeBackClearanceM:.9,officeCollaborationPct:0,officeTargetSeats:0,hotelTwinPct:33,hotelSuitePct:0,hotelServiceEveryRooms:12,hotelTwinAdrFactor:1.1,hotelSuiteAdrFactor:1.8,navigationClearanceM:.22,layoutObstacles:[],officeRoomRequirements:{}});
  const collections=['layoutObstacles','officeRoomRequirements'];
  const keys=[...Object.keys(enums),...Object.keys(numbers),...collections];
  const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const validNumber=(v,range)=>typeof v==='number'&&Number.isFinite(v)&&v>=range[0]&&v<=range[1]&&(!range[2]||Number.isInteger(v));
  const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_.:-]{1,80}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
  const roomKeys={deskType:'officeDeskType',orientation:'officeOrientation',deskWidthM:'officeDeskWidthM',deskDepthM:'officeDeskDepthM',aisleWidthM:'officeAisleWidthM',rowGapM:'officeRowGapM',backClearanceM:'officeBackClearanceM',collaborationPct:'officeCollaborationPct',targetSeats:'officeTargetSeats'};
  function validate(input={}) {
    for(const key of Object.keys(enums))if(Object.hasOwn(input,key)&&!enums[key].includes(input[key]))throw new Error(key+' 값이 올바르지 않습니다.');
    for(const key of Object.keys(numbers))if(Object.hasOwn(input,key)&&!validNumber(input[key],numbers[key]))throw new Error(key+' 범위를 확인하세요.');
    if((input.hotelTwinPct??defaults.hotelTwinPct)+(input.hotelSuitePct??defaults.hotelSuitePct)>100)throw new Error('트윈·스위트 비율 합계는 100% 이하여야 합니다.');
    if(Object.hasOwn(input,'layoutObstacles')) {
      if(!Array.isArray(input.layoutObstacles)||input.layoutObstacles.length>64)throw new Error('고정 장애물은 최대 64개입니다.');
      const seen=new Set();
      for(const o of input.layoutObstacles){
        if(!record(o)||Object.keys(o).some(k=>!['id','level','minX','maxX','minZ','maxZ','kind'].includes(k))||!id(o.id)||seen.has(o.id)||!Number.isInteger(o.level)||o.level<1||o.level>35||!['column','fixed'].includes(o.kind)||!['minX','maxX','minZ','maxZ'].every(k=>validNumber(o[k],[-500,500]))||o.minX>=o.maxX||o.minZ>=o.maxZ)throw new Error('고정 장애물의 식별자·층·좌표를 확인하세요.');
        seen.add(o.id);
      }
    }
    if(Object.hasOwn(input,'officeRoomRequirements')) {
      if(!record(input.officeRoomRequirements)||Object.keys(input.officeRoomRequirements).length>128)throw new Error('실별 배치 조건 형식을 확인하세요.');
      for(const [roomId,settings] of Object.entries(input.officeRoomRequirements)){
        if(!id(roomId)||!record(settings))throw new Error('실별 배치 조건 식별자를 확인하세요.');
        for(const [key,v] of Object.entries(settings)){
          const mapped=roomKeys[key];
          if(!mapped||(enums[mapped]?!enums[mapped].includes(v):!validNumber(v,numbers[mapped])))throw new Error('실별 배치 조건 '+key+' 값을 확인하세요.');
        }
      }
    }
    return true;
  }
  function select(input={}){return Object.fromEntries(keys.filter(k=>Object.hasOwn(input,k)).map(k=>[k,JSON.parse(JSON.stringify(input[k]))]));}
  function normalized(input={}) {const result={...defaults,...select(input)};validate(result);return result;}
  function officeOptions(input={}){const s=normalized(input);return Object.fromEntries(Object.entries(roomKeys).map(([key,mapped])=>[key,key==='orientation'&&s[mapped]!=='auto'?Number(s[mapped]):s[mapped]]));}
  function forFloor(input={},level){const s=normalized(input);return {...s,office:officeOptions(s),layoutObstacles:s.layoutObstacles.filter(o=>o.level===level)};}
  return Object.freeze({enums,numbers,defaults,collections,keys,validate,select,normalized,officeOptions,forFloor});
});
