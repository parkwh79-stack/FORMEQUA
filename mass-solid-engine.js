/* Async display solids; canonical floor contours remain the calculation source. */
(()=>{
  'use strict';
  let worker,timer,revision=0,inflight=null,queued=null;
  const cache=new Map();
  const signal=status=>window.dispatchEvent(new CustomEvent('atelier:solid-status',{detail:{status}}));
  function finish(job,message){
    if(!message.error){cache.set(job.key,message.results);if(cache.size>8)cache.delete(cache.keys().next().value);}
    if(job.revision===revision){if(message.error)job.fail();else job.apply(message.results);}
    inflight=null;
    if(queued){const next=queued;queued=null;dispatch(next);}
  }
  function dispatch(job){
    if(inflight){queued=job;return;}
    try{
      if(!worker){
        worker=new Worker(new URL('mass-solid-worker.js?v=20261102-mass1',document.baseURI),{type:'module'});
        worker.onmessage=event=>{if(inflight&&event.data.id===inflight.revision)finish(inflight,event.data);};
        worker.onerror=()=>{worker?.terminate();worker=null;const job=queued||inflight;queued=null;inflight=null;if(job)job.fail();};
      }
      inflight=job;worker.postMessage({id:job.revision,items:job.items});
    }catch(_){inflight=null;job.fail();}
  }
  function apply(group,model,THREE){
    const current=++revision;clearTimeout(timer);queued=null;
    const targets=group.children.filter(mesh=>mesh.userData?.massSolid);
    if(!targets.length){signal('idle');return;}
    if(typeof Worker==='undefined'){signal('fallback');return;}
    signal('pending');
    const items=targets.map(mesh=>({key:mesh.uuid,...mesh.userData.massSolid}));
    // UUIDs identify this scene only; cache uses geometry, not appearances/finance.
    const key=JSON.stringify(items.map(({key,...shape})=>shape));
    const use=results=>{
      if(current!==revision||targets.some(mesh=>mesh.parent!==group))return;
      results.forEach((result,i)=>{
        const geometry=new THREE.BufferGeometry();
        geometry.setAttribute('position',new THREE.BufferAttribute(result.positions,3));
        geometry.setIndex(new THREE.BufferAttribute(result.indices,1));
        const flat=geometry.toNonIndexed();geometry.dispose();flat.computeVertexNormals();
        targets[i].geometry.dispose();targets[i].geometry=flat;targets[i].userData.solidEngine='manifold-3d-3.5.4';
      });
      group.userData.solidEngine='manifold-3d-3.5.4';
      signal('ready');
    };
    const fail=()=>{if(current===revision){group.userData.solidEngine='contour-fallback';signal('fallback');}};
    if(cache.has(key)){use(cache.get(key));return;}
    timer=setTimeout(()=>dispatch({revision:current,key,items,apply:use,fail}),160);
  }
  window.AtelierSolidEngine=Object.freeze({apply});
})();
