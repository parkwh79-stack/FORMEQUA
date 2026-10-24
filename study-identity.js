/* Shared planning identity. A cadastral identifier is not a survey or title check. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.AtelierStudyIdentity=api;})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const pnus=values=>[...new Set((values||[]).filter(v=>typeof v==='string'&&/^\d{19}$/.test(v)))].sort();
  function hash(text){let h=14695981039346656037n;for(let i=0;i<text.length;i++){h^=BigInt(text.charCodeAt(i));h=BigInt.asUintN(64,h*1099511628211n);}return h.toString(16).padStart(16,'0');}
  function ringKey(ring){
    const pts=(ring||[]).map(p=>p.map(n=>Number(Number(n).toFixed(8))));
    if(pts.length>1&&JSON.stringify(pts[0])===JSON.stringify(pts[pts.length-1]))pts.pop();
    if(!pts.length)return '';
    const candidates=[];
    for(const sequence of [pts,pts.slice().reverse()]){
      const keys=sequence.map(p=>JSON.stringify(p)),first=keys.reduce((a,b)=>a<b?a:b);
      for(let i=0;i<keys.length;i++)if(keys[i]===first)candidates.push(keys.slice(i).concat(keys.slice(0,i)).join(';'));
    }
    return candidates.sort()[0];
  }
  function geometryKey(geometry){
    if(!geometry||!['Polygon','MultiPolygon'].includes(geometry.type))return '';
    const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
    return polygons.map(p=>JSON.stringify([ringKey(p[0]),p.slice(1).map(ringKey).sort()])).sort().join('|');
  }
  function describe(params={},model={}){
    const inputs=params.inputs||params,explicit=params.projectId||inputs.projectId;
    if(typeof explicit==='string'&&explicit.trim())return {base:explicit,basis:'explicit-project-id'};
    const data=params.parcelData||inputs.parcelData,geo=model.parcelGeometry;
    const source=data?.source||geo?.source;
    const features=Array.isArray(data?.features)?data.features:[];
    const identifiers=pnus(features.length?features.map(f=>f.properties?.pnu):geo?.pnus);
    const count=features.length||geo?.featureCount||identifiers.length;
    if(source!=='import'&&identifiers.length&&identifiers.length===count)return {base:'pnu/'+identifiers.join('+'),basis:'sorted-pnu-set',pnus:identifiers};
    const geometries=features.map(f=>geometryKey(f.geometry)).filter(Boolean).sort();
    // Raw WGS84 features are preferred so model origin/rotation choices do not
    // rename a parcel. Legacy models without them use their stated local frame.
    const fallback=geometries.length?geometries.join('|'):geo?.outlines?JSON.stringify([geo.centerWgs84,geo.frameRotationRad,geo.outlines]):'';
    if(fallback)return {base:(source==='import'?'import-geometry/':'geometry/')+hash(fallback)+(identifiers.length?'/'+identifiers.join('+'):''),basis:source==='import'?'imported-geometry-fingerprint':'geometry-fingerprint',pnus:identifiers};
    return {base:String(params.parcelKey||inputs.parcelKey||'study'),basis:'preset-or-unspecified'};
  }
  function scope(params={},model={}){return describe(params,model).base+'/'+String(params.option||params.inputs?.option||'A');}
  return Object.freeze({scope,describe,version:'1.0.0'});
});
