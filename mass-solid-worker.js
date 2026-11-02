import {buildSolids} from './vendor/manifold/formequa-kernel.js';
self.onmessage=async event=>{
  const {id,items}=event.data||{};
  try{
    const results=await buildSolids(items);
    self.postMessage({id,results},results.flatMap(item=>[item.positions.buffer,item.indices.buffer]));
  }catch(_){self.postMessage({id,error:'SOLID_GENERATION_FAILED'});}
};
