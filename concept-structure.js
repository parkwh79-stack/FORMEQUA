/* Continuous reference axes for planning views. No member sizing or analysis. */
(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;if(root)root.AtelierConceptStructure=api;})(typeof window!=="undefined"?window:null,function(){
  "use strict";
  function generate(floors=[],options={}) {
    const result={status:"not-generated",columns:[],isStructuralDesign:false,loadsVerified:false,
      memberSizesVerified:false,foundationVerified:false,referenceOnly:true,warnings:[],assumptions:[
        "동일 수직축의 위치 참고선입니다. 부재 치수·보·내력벽·횡력저항·기초를 구조 설계한 결과가 아닙니다.",
        "층별로 그리드를 재분할하지 않으며 모든 층 외곽 교집합과 중정·공통 코어를 확인합니다."
      ]};
    if(!floors.length||floors.some(f=>![f.widthM,f.depthM,f.zBottom,f.zTop].every(Number.isFinite)||f.widthM<=2||f.depthM<=2||f.zTop<=f.zBottom))return result;
    const bounds={minX:Math.max(...floors.map(f=>-f.widthM/2+1)),maxX:Math.min(...floors.map(f=>f.widthM/2-1)),
      minZ:Math.max(...floors.map(f=>(f.northShiftM||0)-f.depthM/2+1)),maxZ:Math.min(...floors.map(f=>(f.northShiftM||0)+f.depthM/2-1))};
    if(bounds.maxX<=bounds.minX||bounds.maxZ<=bounds.minZ){result.warnings.push("전 층 공통 지지축 영역이 없어 참고 구조축을 생성하지 않았습니다.");return result;}
    const step=options.profile==="compact"?4.5:/공동주택|오피스텔|호텔/.test(options.buildingUse||"")?5.4:8.1;
    const ticks=(a,b)=>{const n=Math.max(1,Math.ceil((b-a)/step));return Array.from({length:n+1},(_,i)=>a+(b-a)*i/n);};
    const cores=options.coreLayout?.cores||[], xs=ticks(bounds.minX,bounds.maxX),zs=ticks(bounds.minZ,bounds.maxZ);
    for(const x of xs)for(const z of zs){
      if(cores.some(c=>x>=c.minX-.15&&x<=c.maxX+.15&&z>=c.minZ-.15&&z<=c.maxZ+.15))continue;
      if(floors.some(f=>f.hasAtrium&&Math.abs(x)<f.widthM*.175+.15&&Math.abs(z-(f.northShiftM||0))<f.depthM*.175+.15))continue;
      result.columns.push({id:`axis-${result.columns.length+1}`,x,z,levels:floors.map(f=>({level:f.level,zBottom:f.zBottom,zTop:f.zTop}))});
    }
    result.status=result.columns.length?"reference-only":"not-generated";
    result.bounds=bounds;result.grid={targetSpacingM:step,xSpacingM:xs[1]-xs[0],zSpacingM:zs[1]-zs[0],isCodeRequirement:false};
    if(floors.some(f=>Math.abs(f.widthM-floors[0].widthM)>.01||Math.abs(f.depthM-floors[0].depthM)>.01||Math.abs((f.northShiftM||0)-(floors[0].northShiftM||0))>.01))result.warnings.push("층별 외곽이 달라 포디움·테라스의 전이구조와 캔틸레버는 별도 계획이 필요합니다. 참고축만으로 지지 적합성을 확정하지 않습니다.");
    return result;
  }
  return Object.freeze({generate});
});
