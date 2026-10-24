/* Original lightweight JS walking-grid analysis. TopologicPy was researched;
 * its Python/kernel engines and source code are not executed or bundled here.
 * Local metre X/Z coordinates; conceptual internal access, not egress approval. */
(function(root,factory){"use strict";const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;if(root)root.AtelierSpatialNavigation=api;})(typeof window!=="undefined"?window:null,function(){
  "use strict";
  const EPS=1e-8,cache=new Map(),LIMIT={cells:15000,rooms:1000,obstacles:18000,doors:3000,nodes:20000,paths:2048,vertices:50000,operations:2500000};
  const finite=n=>typeof n==="number"&&Number.isFinite(n),round=n=>Math.round(n*1e6)/1e6;
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
  const hash=s=>{let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return(h>>>0).toString(36);};
  const rect=r=>r&&[r.minX,r.maxX,r.minZ,r.maxZ].every(finite)&&r.maxX>r.minX&&r.maxZ>r.minZ;
  const point=p=>p&&finite(p.x)&&finite(p.z);
  const freeze=o=>{if(o&&typeof o==="object"&&!Object.isFrozen(o)){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};
  function empty(plan,status,reason,warnings=[]){return{version:"1.0.0",engine:"lightweight-js-grid",topologicPyExecuted:false,status,reason,level:plan?.level??null,units:"metres",grid:null,endpoints:[],paths:[],ledger:[],warnings,
    egress:{status:"unverified",isEgressVerified:false,reason:"외부 출구·계단 입구·법정 유효폭·다층 피난을 검증하지 않은 내부 접근 분석입니다."},multiLevel:{status:"unverified",links:[],reason:"명시적으로 검증한 수직 연결이 없어 층간 경로를 만들지 않았습니다."}};}
  function segmentDistance(p,a,b){const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);}
  function crossing(a,b,c,d){const cross=(p,q,r)=>(q.x-p.x)*(r.z-p.z)-(q.z-p.z)*(r.x-p.x),x=cross(a,b,c),y=cross(a,b,d),u=cross(c,d,a),v=cross(c,d,b);return x*y<-EPS&&u*v<-EPS;}
  function lineDistance(a,b,c,d){return crossing(a,b,c,d)?0:Math.min(segmentDistance(a,c,d),segmentDistance(b,c,d),segmentDistance(c,a,b),segmentDistance(d,a,b));}
  function hitsRect(a,b,r,pad){let lo=0,hi=1;for(const[k,mn,mx]of[["x",r.minX-pad,r.maxX+pad],["z",r.minZ-pad,r.maxZ+pad]]){const d=b[k]-a[k];if(Math.abs(d)<EPS){if(a[k]<mn||a[k]>mx)return false;}else{let p=(mn-a[k])/d,q=(mx-a[k])/d;if(p>q)[p,q]=[q,p];lo=Math.max(lo,p);hi=Math.min(hi,q);if(lo>hi)return false;}}return hi>=0&&lo<=1;}
  function heap(){const h=[];return{push(v){h.push(v);let i=h.length-1;while(i){const p=(i-1)>>1;if(h[p][0]<=v[0])break;h[i]=h[p];i=p;}h[i]=v;},pop(){const v=h[0],last=h.pop();if(h.length){let i=0;while(i*2+1<h.length){let j=i*2+1;if(j+1<h.length&&h[j+1][0]<h[j][0])j++;if(h[j][0]>=last[0])break;h[i]=h[j];i=j;}h[i]=last;}return v;},get length(){return h.length;}};}
  function analyze(plan={},options={}){
    if(plan.status==="not-generated"||plan.metrics===null)return empty(plan,"not-generated",plan.reason||"interior-not-generated",["실내 형상이 생성되지 않아 보행 거리나 단절을 0으로 산정하지 않았습니다."]);
    if(!rect(plan.bounds))return empty(plan,"unavailable","invalid-bounds",["유효한 실내 보행 경계가 없습니다."]);
    const lists=["rooms","walls","doors","cores","voids","furniture","obstacles"];
    if(lists.some(k=>plan[k]!==undefined&&!Array.isArray(plan[k])))return empty(plan,"unavailable","invalid-geometry",["실내 형상 목록을 확인할 수 없습니다."]);
    if((plan.rooms?.length||0)>LIMIT.rooms||(plan.doors?.length||0)>LIMIT.doors||["walls","cores","voids","furniture","obstacles"].reduce((n,k)=>n+(plan[k]?.length||0),0)>LIMIT.obstacles)return empty(plan,"limited","geometry-limit",["실내 1,000실·문 3,000개·장애물 18,000개의 동기 분석 한도를 초과했습니다."]);
    let key;try{key=JSON.stringify([plan.level,plan.status,plan.bounds,...lists.map(k=>plan[k]||[]),plan.entry,options]);}catch(_){return empty(plan,"unavailable","invalid-input",["직렬화할 수 없는 경로 입력입니다."]);}
    if(key.length<1500000&&cache.has(key))return cache.get(key);
    const result=empty(plan,"analyzed",null,["TopologicPy Python 엔진 실행 결과가 아닌 독립 JavaScript 보행 격자 초안입니다.","문은 열려 있는 상태를 가정합니다. 실제 문 하드웨어·피난·무장애·보행 유효폭 적합성을 확정하지 않습니다."]);
    let operations=0;const tick=(n=1)=>{operations+=n;if(operations>LIMIT.operations)throw new Error("operation-limit");};
    try{
      const b=plan.bounds,W=b.maxX-b.minX,D=b.maxZ-b.minZ;
      const radius=options.clearanceM===undefined?.22:options.clearanceM,requested=options.cellSizeM===undefined?.25:options.cellSizeM;
      if(!finite(radius)||radius<.05||radius>1||!finite(requested)||requested<.1||requested>5||W>1000||D>1000)throw new Error("invalid-options");
      const maxCells=options.maxCells===undefined?LIMIT.cells:options.maxCells,maxPaths=options.maxPaths===undefined?LIMIT.paths:options.maxPaths;
      if(!Number.isInteger(maxCells)||maxCells<16||maxCells>LIMIT.cells||!Number.isInteger(maxPaths)||maxPaths<1||maxPaths>LIMIT.paths)throw new Error("invalid-options");
      let step=Math.max(requested,Math.sqrt(W*D/maxCells)),nx,nz;do{nx=Math.ceil(W/step);nz=Math.ceil(D/step);if(nx*nz>maxCells)step*=1.01;}while(nx*nz>maxCells);
      const sx=W/nx,sz=D/nz,bin=Math.max(1,step*3),spatial=new Map(),obstacles=[];
      const roomIds=new Set(),rooms=(plan.rooms||[]).map(r=>{if(!rect(r))throw new Error("invalid-room");const id=String(r.id||"room-"+hash(JSON.stringify(r)));if(roomIds.has(id))throw new Error("duplicate-room-id");roomIds.add(id);return{...r,id};}).sort((a,c)=>a.id.localeCompare(c.id));
      function binKeys(r,fn){const x0=Math.floor((Math.max(r.minX,b.minX-4)-b.minX)/bin),x1=Math.floor((Math.min(r.maxX,b.maxX+4)-b.minX)/bin),z0=Math.floor((Math.max(r.minZ,b.minZ-4)-b.minZ)/bin),z1=Math.floor((Math.min(r.maxZ,b.maxZ+4)-b.minZ)/bin);for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){tick();fn(x+":"+z);}}
      function obstacle(o){if(obstacles.length>=LIMIT.obstacles)throw new Error("obstacle-limit");const i=obstacles.length;obstacles.push(o);binKeys(o.box,k=>{if(!spatial.has(k))spatial.set(k,[]);spatial.get(k).push(i);});}
      for(const r of [...(plan.cores||[]),...(plan.voids||[]),...(plan.obstacles||[])]){if(!rect(r))throw new Error("invalid-obstacle");obstacle({kind:"rect",rect:r,box:r});}
      for(const f of plan.furniture||[]){if(!point(f)||![f.width,f.depth].every(v=>finite(v)&&v>0)||(f.rotationY!==undefined&&!finite(f.rotationY)))throw new Error("invalid-furniture");const angle=f.rotationY||0,c=Math.cos(angle),s=Math.sin(angle),hw=f.width/2,hd=f.depth/2,rx=Math.abs(c)*hw+Math.abs(s)*hd,rz=Math.abs(s)*hw+Math.abs(c)*hd;obstacle({kind:"furniture",x:f.x,z:f.z,c,s,rect:{minX:-hw,maxX:hw,minZ:-hd,maxZ:hd},box:{minX:f.x-rx,maxX:f.x+rx,minZ:f.z-rz,maxZ:f.z+rz}});}
      function wall(w){if(![w.x1,w.x2,w.z1,w.z2].every(finite)||(w.thickness!==undefined&&(!finite(w.thickness)||w.thickness<0)))throw new Error("invalid-wall");const half=(w.thickness||.12)/2;obstacle({kind:"wall",a:{x:w.x1,z:w.z1},c:{x:w.x2,z:w.z2},half,box:{minX:Math.min(w.x1,w.x2)-half,maxX:Math.max(w.x1,w.x2)+half,minZ:Math.min(w.z1,w.z2)-half,maxZ:Math.max(w.z1,w.z2)+half}});}
      (plan.walls||[]).forEach(wall);
      const doors=(plan.doors||[]).map(d=>{if(!point(d)||!finite(d.width)||d.width<=0||!["x","z"].includes(d.axis))throw new Error("invalid-door");const id=String(d.id||"door-"+hash(JSON.stringify([d.roomId,d.axis,d.x,d.z,d.width])));const a={x:d.x-(d.axis==="x"?d.width/2:0),z:d.z-(d.axis==="z"?d.width/2:0)},c={x:d.x+(d.axis==="x"?d.width/2:0),z:d.z+(d.axis==="z"?d.width/2:0)};
        // Restrict a known room-face opening to the provided door width. Door
        // metadata may narrow a real gap; it can never erase an existing wall.
        const room=rooms.find(r=>r.id===d.roomId),face=room&&(d.axis==="x"?Math.min(Math.abs(d.z-room.minZ),Math.abs(d.z-room.maxZ)):Math.min(Math.abs(d.x-room.minX),Math.abs(d.x-room.maxX)))<.0001;
        if(face){const lo=d.axis==="x"?room.minX:room.minZ,hi=d.axis==="x"?room.maxX:room.maxZ,mid=d.axis==="x"?d.x:d.z;for(const[start,end]of[[lo,mid-d.width/2],[mid+d.width/2,hi]])if(end>start)wall(d.axis==="x"?{x1:start,x2:end,z1:d.z,z2:d.z,thickness:.12}:{x1:d.x,x2:d.x,z1:start,z2:end,thickness:.12});}
        if(d.closed===true||d.passable===false||d.width<2*radius)wall({x1:a.x,z1:a.z,x2:c.x,z2:c.z,thickness:.12});return{...d,id,a,c};});
      const doorIndex=new Map();doors.forEach((d,i)=>binKeys({minX:Math.min(d.a.x,d.c.x),maxX:Math.max(d.a.x,d.c.x),minZ:Math.min(d.a.z,d.c.z),maxZ:Math.max(d.a.z,d.c.z)},k=>{if(!doorIndex.has(k))doorIndex.set(k,[]);doorIndex.get(k).push(i);}));
      function traverse(a,c,pad=radius){tick();if(!point(a)||!point(c))return false;for(const p of[a,c])if(p.x<b.minX+pad-EPS||p.x>b.maxX-pad+EPS||p.z<b.minZ+pad-EPS||p.z>b.maxZ-pad+EPS)return false;const found=new Set();binKeys({minX:Math.min(a.x,c.x)-pad,maxX:Math.max(a.x,c.x)+pad,minZ:Math.min(a.z,c.z)-pad,maxZ:Math.max(a.z,c.z)+pad},k=>(spatial.get(k)||[]).forEach(i=>found.add(i)));for(const i of found){tick();const o=obstacles[i];if(o.kind==="wall"){if(lineDistance(a,c,o.a,o.c)<pad+o.half-EPS)return false;}else{const local=p=>({x:o.c*(p.x-o.x)-o.s*(p.z-o.z),z:o.s*(p.x-o.x)+o.c*(p.z-o.z)});if(hitsRect(o.kind==="furniture"?local(a):a,o.kind==="furniture"?local(c):c,o.rect,pad-EPS))return false;}}return true;}
      const nodes=[],grid=new Int32Array(nx*nz).fill(-1),adj=[],anchorBins=new Map();
      function addNode(p,kind){if(nodes.length>=LIMIT.nodes)throw new Error("node-limit");const i=nodes.length;nodes.push({x:p.x,z:p.z,kind});adj.push(new Map());return i;}
      for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){const p={x:b.minX+(x+.5)*sx,z:b.minZ+(z+.5)*sz};if(traverse(p,p))grid[z*nx+x]=addNode(p,"grid");}
      const gridNodeCount=nodes.length;
      result.grid={cellSizeM:round(step),requestedCellSizeM:requested,columns:nx,rows:nz,cellCount:nx*nz,walkableCount:gridNodeCount,clearanceM:radius,coarsened:step>requested+EPS};
      if(result.grid.coarsened)result.warnings.push("동기 계산 한도에 맞춰 격자를 조정했습니다. 문 통과점을 보강했지만 표본망상 단절은 더 촘촘한 검토가 필요할 수 있습니다.");
      function link(i,j){if(i<0||j<0||i===j)return;if(adj[i].has(j))return;if(traverse(nodes[i],nodes[j])){const d=distance(nodes[i],nodes[j]);adj[i].set(j,d);adj[j].set(i,d);}}
      for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){const i=grid[z*nx+x];if(i<0)continue;for(const[dx,dz]of[[1,0],[0,1],[1,1],[-1,1]])if(x+dx>=0&&x+dx<nx&&z+dz<nz)link(i,grid[(z+dz)*nx+x+dx]);}
      function anchor(p){if(!point(p)||!traverse(p,p))return-1;const i=addNode(p,"anchor"),span=Math.max(step*2,.8);const x0=Math.max(0,Math.floor((p.x-span-b.minX)/sx)),x1=Math.min(nx-1,Math.ceil((p.x+span-b.minX)/sx)),z0=Math.max(0,Math.floor((p.z-span-b.minZ)/sz)),z1=Math.min(nz-1,Math.ceil((p.z+span-b.minZ)/sz));const near=[];for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){const j=grid[z*nx+x];if(j>=0&&distance(p,nodes[j])<=span)near.push(j);}near.sort((a,c)=>distance(p,nodes[a])-distance(p,nodes[c])||a-c).slice(0,24).forEach(j=>link(i,j));const bx=Math.floor((p.x-b.minX)/bin),bz=Math.floor((p.z-b.minZ)/bin);let linked=0;for(let z=bz-2;z<=bz+2;z++)for(let x=bx-2;x<=bx+2;x++)for(const j of anchorBins.get(x+":"+z)||[]){tick();if(distance(p,nodes[j])<=span&&linked<64){link(i,j);linked++;}}const k=bx+":"+bz;if(!anchorBins.has(k))anchorBins.set(k,[]);anchorBins.get(k).push(i);return i;}
      // Portal points bridge a narrow real opening even when its centre falls
      // between coarsened grid rows. An unbroken wall is never cut by a door tag.
      for(const d of doors)if(d.width>=2*radius&&d.closed!==true&&d.passable!==false){const off=radius+.13,normal=d.axis==="x"?{x:0,z:off}:{x:off,z:0};const ids=[anchor({x:d.x-normal.x,z:d.z-normal.z}),anchor(d),anchor({x:d.x+normal.x,z:d.z+normal.z})];link(ids[0],ids[1]);link(ids[1],ids[2]);}
      const endpoints=[],endpointMap=new Map(),groups=new Map();
      function endpoint(id,kind,p,meta={}){if(endpointMap.has(id))throw new Error("duplicate-endpoint-id");const node=anchor(p),item={id,kind,point:point(p)?{x:round(p.x),z:round(p.z)}:null,status:node<0?"blocked":"walkable",verification:"candidate",...meta};endpoints.push(item);endpointMap.set(id,{...item,node});return node;}
      const entryId="L"+(plan.level||1)+":entry-candidate";endpoint(entryId,"interior-entry-candidate",plan.entry,{label:"내부 진입 후보"});groups.set(entryId,[entryId]);
      const coreCandidates=[];
      for(const r of(plan.cores||[]).slice(0,8)){const id=String(r.id||"core-"+hash(JSON.stringify(r))),cx=(r.minX+r.maxX)/2,cz=(r.minZ+r.maxZ)/2,off=radius+.08;for(const[side,p]of[["west",{x:r.minX-off,z:cz}],["east",{x:r.maxX+off,z:cz}],["north",{x:cx,z:r.minZ-off}],["south",{x:cx,z:r.maxZ+off}]]){const eid="core:"+id+":"+side;endpoint(eid,"core-access-candidate",p,{coreId:id,label:"코어 외곽 접근 후보"});coreCandidates.push(eid);}}
      if(coreCandidates.length)groups.set("core-approach",coreCandidates);
      const custom=options.endpoints||[];if(!Array.isArray(custom)||custom.length>32)throw new Error("endpoint-limit");
      for(const e of custom){if(!e||typeof e.id!=="string"||!e.id||!point(e))throw new Error("invalid-endpoint");const verified=e.verified===true&&(typeof e.evidence==="string"&&e.evidence.trim().length>0||e.source&&typeof e.source.title==="string"&&typeof e.source.url==="string");endpoint(e.id,e.kind||"point",e,{verification:verified?"provided-evidence":"candidate",label:String(e.label||e.id).slice(0,160)});groups.set(e.id,[e.id]);}
      const roomEndpoints=[];
      for(const r of rooms){const center={x:(r.minX+r.maxX)/2,z:(r.minZ+r.maxZ)/2};let origin=traverse(center,center)?center:null,best=Infinity;if(!origin){const x0=Math.max(0,Math.floor((r.minX-b.minX)/sx)),x1=Math.min(nx-1,Math.floor((r.maxX-b.minX)/sx)),z0=Math.max(0,Math.floor((r.minZ-b.minZ)/sz)),z1=Math.min(nz-1,Math.floor((r.maxZ-b.minZ)/sz));for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){tick();const j=grid[z*nx+x];if(j<0)continue;const p=nodes[j],d=distance(p,center);if(p.x>r.minX+EPS&&p.x<r.maxX-EPS&&p.z>r.minZ+EPS&&p.z<r.maxZ-EPS&&d<best){origin=p;best=d;}}}const id="room:"+r.id;endpoint(id,"room-origin",origin,{roomId:r.id,label:String(r.label||r.id).slice(0,160),roomType:r.type||null});roomEndpoints.push(id);}
      result.endpoints=endpoints;
      const defaults=roomEndpoints.flatMap(id=>[{fromId:id,toId:entryId,kind:"room-to-entry-candidate"},...(coreCandidates.length?[{fromId:id,toId:"core-approach",kind:"room-to-core-candidate"}]:[])]);
      const customer=rooms.find(r=>/guest|showroom|lounge|meeting|dwelling|living/.test(r.type||""))||rooms[0],staff=rooms.find(r=>/service|office|storage|pantry|support/.test(r.type||""))||rooms[rooms.length-1];
      if(customer)defaults.push({fromId:entryId,toId:"room:"+customer.id,kind:"customer-representative"});
      if(staff)defaults.push({fromId:entryId,toId:"room:"+staff.id,kind:"staff-representative"});
      if(options.routes!==undefined&&!Array.isArray(options.routes))throw new Error("invalid-routes");
      const requests=(options.routes||defaults).slice(0,maxPaths),trees=new Map(),widthCache=new Map();
      if((options.routes||defaults).length>maxPaths){result.status="partial";result.warnings.push("경로 수 상한으로 일부 원장을 생략했습니다.");}
      function tree(target){if(trees.has(target))return trees.get(target);if(trees.size>=8)return null;const ids=groups.get(target)||[target],seeds=ids.map(id=>endpointMap.get(id)?.node).filter(n=>n>=0);if(!seeds.length)return{seeds:[],dist:[],next:[],owner:[]};const dist=new Float64Array(nodes.length).fill(Infinity),next=new Int32Array(nodes.length).fill(-1),owner=new Int32Array(nodes.length).fill(-1),q=heap();seeds.forEach(n=>{dist[n]=0;owner[n]=n;q.push([0,n]);});while(q.length){tick();const[d,i]=q.pop();if(d>dist[i]+EPS)continue;for(const[j,length]of adj[i])if(d+length<dist[j]-EPS){dist[j]=d+length;next[j]=i;owner[j]=owner[i];q.push([dist[j],j]);}}const t={seeds,dist,next,owner};trees.set(target,t);return t;}
      function edgeWidth(i,j){const k=Math.min(i,j)+":"+Math.max(i,j);if(widthCache.has(k))return widthCache.get(k);let lo=radius,hi=4;for(let t=0;t<8;t++){const mid=(lo+hi)/2;if(traverse(nodes[i],nodes[j],mid))lo=mid;else hi=mid;}widthCache.set(k,lo*2);return lo*2;}
      let vertexCount=0;const pathIds=new Set();
      for(const request of requests){if(!request||typeof request.fromId!=="string"||typeof request.toId!=="string")throw new Error("invalid-route");const id=String(request.id||"path-"+hash(JSON.stringify([plan.level,request.fromId,request.toId,request.kind||"custom"]))),from=endpointMap.get(request.fromId),t=tree(request.toId),p={id,fromId:request.fromId,toId:request.toId,kind:request.kind||"custom",status:"unresolved",points:[],distanceM:null,minClearWidthM:null,widthStatus:"unverified",doorIds:[],isEgressVerified:false,targetVerification:"candidate"};
        if(pathIds.has(id))throw new Error("duplicate-path-id");pathIds.add(id);
        if(!t){p.status="limited";}else if(from?.node>=0&&t.seeds.length){if(!Number.isFinite(t.dist[from.node]))p.status="disconnected";else{const ids=[from.node];let i=from.node;while(t.next[i]>=0&&ids.length<=nodes.length){i=t.next[i];ids.push(i);}const points=ids.map(i=>nodes[i]),simple=[];for(const v of points){while(simple.length>1){const a=simple[simple.length-2],c=simple[simple.length-1],cross=(c.x-a.x)*(v.z-c.z)-(c.z-a.z)*(v.x-c.x);if(Math.abs(cross)>EPS)break;simple.pop();}simple.push(v);}let minWidth=edgeWidth(ids[0],ids[0]);for(let k=1;k<ids.length;k++)minWidth=Math.min(minWidth,edgeWidth(ids[k-1],ids[k]));const crossedDoors=new Set();for(let k=1;k<simple.length;k++){const a=simple[k-1],c=simple[k];binKeys({minX:Math.min(a.x,c.x)-.001,maxX:Math.max(a.x,c.x)+.001,minZ:Math.min(a.z,c.z)-.001,maxZ:Math.max(a.z,c.z)+.001},key=>{for(const di of doorIndex.get(key)||[]){tick();const d=doors[di];if(lineDistance(a,c,d.a,d.c)<.001)crossedDoors.add(di);}});}p.doorCrossings=[];for(const di of crossedDoors){p.doorIds.push(doors[di].id);p.doorCrossings.push({id:doors[di].id,widthM:doors[di].width,assumption:"open"});minWidth=Math.min(minWidth,doors[di].width);}p.minDoorWidthM=crossedDoors.size?Math.min(...[...crossedDoors].map(di=>doors[di].width)):null;vertexCount+=simple.length;if(vertexCount>LIMIT.vertices){p.status="limited";}else{p.status="reachable";p.points=simple.map(v=>({x:round(v.x),z:round(v.z)}));p.distanceM=round(points.slice(1).reduce((sum,v,k)=>sum+distance(points[k],v),0));p.minClearWidthM=round(minWidth);p.widthStatus="conservative-centreline-estimate-not-statutory";const target=endpoints.find(e=>endpointMap.get(e.id).node===t.owner[from.node]);p.reachedEndpointId=target?.id||null;p.targetVerification=target?.verification||"candidate";}}}
        result.paths.push(p);
      }
      result.ledger=result.paths.map(p=>({pathId:p.id,fromId:p.fromId,toId:p.toId,kind:p.kind,status:p.status,distanceM:p.distanceM,minClearWidthM:p.minClearWidthM,minDoorWidthM:p.minDoorWidthM??null,widthStatus:p.widthStatus,targetVerification:p.targetVerification,isEgressVerified:false}));
      if(result.paths.some(p=>p.status==="limited")){result.status="partial";result.warnings.push("동기 경로/점/목적지 상한에 걸린 경로는 거리를 확정하지 않았습니다.");}
      result.grid.graphNodeCount=nodes.length;result.grid.operations=operations;
      result.warnings.push("최단거리는 장애물을 피해 연결한 보행 격자·문 통과점 그래프 안의 거리입니다. 전역 연속공간의 정확 최단거리나 법정 보행·피난거리 판정이 아닙니다.");
      result.warnings.push("코어 목적지는 불투과 코어 상자 바깥의 접근 후보입니다. 실제 계단·승강기 문 위치가 확인되지 않아 코어 내부나 다른 층으로 연결하지 않았습니다.");
    }catch(error){return empty(plan,error.message?.includes("limit")?"limited":"unavailable",error.message||"invalid-input",["경로 검토를 완료하지 못하여 거리·보행 가능 여부를 확정하지 않았습니다."]);}
    freeze(result);if(key.length<1500000){if(cache.size>=4)cache.delete(cache.keys().next().value);cache.set(key,result);}return result;
  }
  return Object.freeze({analyze,clearCache(){cache.clear();},cacheInfo(){return{entries:cache.size,maxEntries:4};},limits:Object.freeze(LIMIT),version:"1.0.0"});
});
