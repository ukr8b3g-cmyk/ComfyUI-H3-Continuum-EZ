export function referenceCounts(plan){
 const images=new Set(plan.assets.filter(a=>a.kind==='image').map(a=>a.id));
 const count=slots=>new Set(slots.map(n=>plan.reference_slots[n-1]).filter(id=>images.has(id))).size;
 return {individual:count(plan.shots.flatMap(s=>s.refs??[])),shared:count(plan.global_refs)};
}
