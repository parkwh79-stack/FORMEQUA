'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
 const events=[],workers=[],timers=new Map();let next=0;
 class Worker{
  constructor(){workers.push(this);this.sent=[];}
  postMessage(job){this.sent.push(job);}
  terminate(){this.terminated=true;}
 }
 class Geometry{setAttribute(){return this;}setIndex(){return this;}toNonIndexed(){return new Geometry();}computeVertexNormals(){}dispose(){this.disposed=true;}}
 const THREE={BufferGeometry:Geometry,BufferAttribute:class{}};
 const context=vm.createContext({window:{dispatchEvent:event=>events.push(event.detail.status)},document:{baseURI:'https://example.test/model.html'},Worker,URL,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
  setTimeout:callback=>{timers.set(++next,callback);return next;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../mass-solid-engine.js'),'utf8'),context);
 const scene=id=>{const group={children:[],userData:{}},mesh={uuid:id,userData:{massSolid:{heightM:4,contours:[[[0,0],[10,0],[0,10]]]}},geometry:new Geometry(),parent:group};group.children.push(mesh);return {group,mesh};};
 const apply=s=>context.window.AtelierSolidEngine.apply(s.group,{},THREE);
 const flush=()=>{for(const [id,callback] of [...timers]){timers.delete(id);callback();}};
 const complete=(worker,job)=>worker.onmessage({data:{id:job.id,results:[{positions:new Float32Array([0,0,0,1,0,0,0,1,0]),indices:new Uint32Array([0,1,2])}]}});
 return {events,workers,scene,apply,flush,complete};
}
{
 const f=fixture(),first=f.scene('first'),latest=f.scene('latest');
 f.apply(first);f.flush();const worker=f.workers[0],old=worker.sent[0];
 f.apply(latest);f.flush();f.complete(worker,old);
 assert.equal(f.events.filter(e=>e==='ready').length,0,'stale results cannot announce success or clear the latest pending state');
 assert.equal(first.mesh.userData.solidEngine,undefined);assert.equal(worker.sent.length,2);
 f.complete(worker,worker.sent[1]);assert.equal(latest.mesh.userData.solidEngine,'manifold-3d-3.5.4');assert.equal(f.events.at(-1),'ready');
}
{
 const f=fixture(),first=f.scene('first'),latest=f.scene('latest');
 f.apply(first);f.flush();f.apply(latest);f.flush();f.workers[0].onerror();
 assert.equal(latest.group.userData.solidEngine,'contour-fallback','worker failure must settle the latest queued model');
 assert.equal(f.events.at(-1),'fallback');assert.equal(first.group.userData.solidEngine,undefined);
}
{
 const f=fixture(),first=f.scene('first');f.apply(first);f.flush();const worker=f.workers[0],job=worker.sent[0];
 f.apply({group:{children:[],userData:{}}});assert.equal(f.events.at(-1),'idle');f.complete(worker,job);assert.equal(f.events.at(-1),'idle','a stale worker must not restore a loading/ready state after an empty model');
}
console.log('UI feedback: latest-job status, stale success suppression, queued worker failure and empty-model settlement passed.');
