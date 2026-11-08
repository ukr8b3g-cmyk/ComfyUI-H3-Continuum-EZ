// Isolate only the explicitly connected STRING ancestors, never the video graph.
export function instructionGraph(output,binding){
  if(!binding?.connected)return null;
  if(binding.error)throw new Error(binding.error);
  const values=binding.engineIds.map(id=>output[id]?.inputs?.ai_instruction);
  if(values.some(v=>v===undefined)||values.some(v=>JSON.stringify(v)!==JSON.stringify(values[0])))
    throw new Error('AI instruction connection changed / AI指示の接続が変更されました');
  const value=values[0];
  if(typeof value==='string')return {text:value};
  const isLink=v=>Array.isArray(v)&&v.length===2&&Number.isInteger(v[1])&&output[String(v[0])];
  if(!isLink(value))throw new Error('AI instruction must be STRING / AI指示にはSTRINGを接続してください');
  const graph={},visiting=new Set();
  function visit(id){
    id=String(id);if(visiting.has(id))throw new Error('Cyclic AI instruction input');
    if(graph[id])return;
    const node=output[id];if(!node)throw new Error('Missing AI instruction source');
    if(['H3ContinuumEZEngine','H3ContinuumEZTimeline'].includes(node.class_type))
      throw new Error('AI instruction cannot depend on video generation / AI指示から動画生成を呼び出す接続は使用できません');
    visiting.add(id);
    for(const v of Object.values(node.inputs||{}))if(isLink(v))visit(v[0]);
    visiting.delete(id);graph[id]=JSON.parse(JSON.stringify(node));
  }
  visit(value[0]);
  const outputId='h3ez_instruction_'+crypto.randomUUID().replaceAll('-','');
  graph[outputId]={class_type:'PreviewAny',inputs:{source:value}};
  return {graph,output_id:outputId,request_id:outputId};
}
