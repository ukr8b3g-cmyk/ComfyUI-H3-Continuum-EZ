import test from 'node:test';import assert from 'node:assert/strict';
import {initial,clone,read,geometry,commonPrompt,editPrompt,effective,validate,registerReference,removeAsset,insertShot,moveShot,splitShot,splitAudio,parseScript,History} from '../web/state.js';
const asset=id=>({id,kind:'image',label:id,file:{name:id+'.png',type:'input',subfolder:''}});

test('combined edits synchronize common text but preserve other shot bodies',()=>{
  const p=initial();insertShot(p);p.shots[0].prompt='First action';p.shots[1].prompt='Second action';
  const long=('日本語「台詞」。\n\n  whitespace  \r\n').repeat(1200);
  editPrompt(p,0,'global',long);editPrompt(p,0,'shot','Changed first action');
  const restored=read(JSON.stringify(p));validate(restored);
  assert.equal(restored.global_prompt,long);assert.equal(restored.prompt_source,'studio');
  for(const i of [0,1])assert.ok(effective(restored,i,'stale external').text.includes(long));
  assert.equal(restored.shots[1].prompt,'Second action');
  assert.ok(!effective(restored,1).text.includes('Changed first action'));
  restored.shots[1].prompt_mode='replace';assert.ok(!effective(restored,1).text.includes(long));
});
test('external source is explicit, reversible and empty external text stays empty',()=>{
  let p=initial();p.global_prompt='saved';const h=new History();h.record(p);
  assert.equal(commonPrompt(p,'external'),'external');
  editPrompt(p,0,'global','local edit');assert.equal(commonPrompt(p,'external'),'local edit');
  p=h.undo(p);assert.equal(commonPrompt(p,'external'),'external');
  p=h.redo(p);assert.equal(commonPrompt(p,'external'),'local edit');
  p.prompt_source='external';assert.equal(commonPrompt(p,''),'');assert.equal(commonPrompt(p,null),'local edit');
  assert.equal(p.global_prompt,'local edit');p.prompt_source='bad';assert.throws(()=>validate(p),{key:'invalidPromptSource'});
});
test('5 second initial and continuation use original grid',()=>{const p=initial();insertShot(p);assert.equal(geometry(p)[0].frames,124);assert.equal(geometry(p)[1].frames,119);});
test('long Japanese prompt is not truncated',()=>{const p=initial();p.global_prompt='長文\n'.repeat(10000);assert.ok(effective(p,0).text.includes(p.global_prompt));assert.equal(effective(p,0).text.split(p.global_prompt).length,2);});
test('external common does not rewrite draft',()=>{const p=initial();p.global_prompt='saved';p.shots[0].prompt='motion';assert.ok(effective(p,0,'external').text.includes('external\n\nmotion'));assert.ok(!effective(p,0,'external').text.includes('saved'));assert.equal(p.global_prompt,'saved');});
test('references follow stable slots through reordering',()=>{const p=initial();p.assets.push(asset('a'),asset('b'));const r=registerReference(p,'b');p.global_refs=[r];p.first_image='a';p.global_prompt='@R1';assert.equal(effective(p,0).map['@R1'],'<Picture 2>');assert.ok(effective(p,0).text.includes('<Picture 2>'));p.first_image=null;assert.equal(effective(p,0).map['@R1'],'<Picture 1>');assert.ok(effective(p,0).text.includes('<Picture 1>'));});
test('inactive reference rejected',()=>{const p=initial();p.global_prompt='@R8';assert.throws(()=>effective(p,0));});
test('remove image unlinks without filesystem writes',()=>{const p=initial();p.assets.push(asset('a'));p.global_refs=[registerReference(p,'a')];p.first_image='a';removeAsset(p,'a');assert.deepEqual(p.global_refs,[]);assert.equal(p.first_image,null);assert.deepEqual(p.assets,[]);});
test('empty explicit refs differs from inherit',()=>{const p=initial();p.assets.push(asset('a'));p.global_refs=[registerReference(p,'a')];p.shots[0].refs=[];assert.doesNotThrow(()=>validate(p));});
test('audio split preserves source relationship',()=>{const p=initial();p.audio=[{id:'c',asset_id:'a',start:1,source_in:10,duration:4}];const b=splitAudio(p,'c',2.5);assert.equal(p.audio[0].duration,1.5);assert.equal(b.source_in,11.5);assert.equal(b.duration,2.5);});
test('invalid audio split leaves state',()=>{const p=initial();p.audio=[{id:'c',asset_id:'a',start:1,source_in:10,duration:4}];const before=clone(p);assert.throws(()=>splitAudio(p,'c',1));assert.deepEqual(p,before);});
test('shot split enforces 2 second minimum',()=>{const p=initial();assert.throws(()=>splitShot(p,p.shots[0].id,1));splitShot(p,p.shots[0].id,2);assert.equal(p.shots.length,2);assert.equal(p.shots[1].transition,'continue');});
test('move keeps identity',()=>{const p=initial(),id=p.shots[0].id,s=insertShot(p);moveShot(p,s.id,0);assert.equal(p.shots[1].id,id);assert.equal(p.shots[0].transition,'cut');});
test('import parses only explicit shots and does not mutate',()=>{const p=initial();insertShot(p);const text='[Shot 1]\n長文\n\n[Shot 2]\nOther';const result=parseScript(text,2);assert.equal(result[0].text,'長文\n');assert.equal(p.shots[0].prompt,'');});
test('import rejects duplicate/out-of-range headers',()=>{assert.throws(()=>parseScript('[Shot 1]\nA\n[Shot 1]\nB',2));assert.throws(()=>parseScript('[Shot 3]\nA',2));});
test('History undo/redo and branch invalidation',()=>{let p=initial();const h=new History();h.record(p);p.global_prompt='x';p=h.undo(p);assert.equal(p.global_prompt,'');p=h.redo(p);assert.equal(p.global_prompt,'x');h.record(p);assert.equal(h.forward.length,0);});
test('reference slots maximum',()=>{const p=initial();for(let i=0;i<9;i++)registerReference(p,'a'+i);assert.throws(()=>registerReference(p,'a10'));});
test('audio overlap is blocked',()=>{const p=initial();p.assets=[{id:'a',kind:'audio',duration:10,file:{name:'a.wav',type:'input'}}];p.audio=[{id:'1',asset_id:'a',start:0,source_in:0,duration:3},{id:'2',asset_id:'a',start:2,source_in:0,duration:2}];assert.throws(()=>validate(p),{key:'overlap'});});

import {resolutionSize,ASPECT_RATIOS} from '../web/state.js';
test('plain prose automatically binds only selected images in encoder order',()=>{
  const p=initial();p.assets=[asset('orange'),asset('white'),asset('start')];
  p.reference_slots[1]='orange';p.reference_slots[8]='white';p.global_refs=[9,2];
  p.global_prompt='Two people in a garden.';p.shots[0].prompt='女性が「行こう」と話す。';
  const before=clone(p),out=effective(p,0);
  assert.deepEqual(p,before);assert.deepEqual(out.map,{'@R2':'<Picture 1>','@R9':'<Picture 2>'});
  assert.ok(out.text.includes('The reference sources are <Picture 1>, <Picture 2>.'));
  assert.ok(out.text.includes(p.global_prompt+'\n\n'+p.shots[0].prompt));
  assert.ok(!out.text.includes('@R'));assert.ok(!out.text.includes('<Subject'));
  p.first_image='start';insertShot(p);const next=effective(p,1);
  assert.deepEqual(next.map,{'@R2':'<Picture 2>','@R9':'<Picture 3>'});
  assert.ok(next.text.includes('preceding video context'));assert.ok(!next.text.includes('opening frame'));
  p.shots[1].transition='cut';p.shots[1].refs=[];
  assert.ok(!effective(p,1).text.includes('<Picture'));
});
test('existing complete H3 prose is not double wrapped; missing selected images are bound',()=>{
  const p=initial();p.assets=[asset('a')];p.global_refs=[registerReference(p,'a')];
  p.global_prompt='subject_definitions: @R1\nsummary: [reference generation] Test\nretention_analysis: Keep it\ndetailed_description: Dialogue\noverall_soundscape: Wind\nnon_diegetic_music: N/A';
  assert.equal(effective(p,0).text,p.global_prompt.replace('@R1','<Picture 1>'));
  p.global_prompt=p.global_prompt.replace('@R1','A person');
  assert.ok(effective(p,0).text.includes('<Picture 1>'));
  assert.equal(effective(p,0).text.split('subject_definitions:').length,2);
});
test('studio resolution defaults and rounding',()=>{assert.deepEqual(resolutionSize(initial().resolution),{width:736,height:416});for(const aspect of ASPECT_RATIOS){const r={source:'studio',aspect,megapixels:.6};const size=resolutionSize(r);assert.equal(size.width%32,0);assert.equal(size.height%32,0);const p=initial();p.resolution=r;assert.doesNotThrow(()=>validate(JSON.parse(JSON.stringify(p))));}assert.throws(()=>resolutionSize({source:'studio',aspect:'16:9',megapixels:NaN}));});

test('restores an existing EZ video for the requested workflow and Timeline only', async () => {
  const {findPreviousVideo} = await import('../web/result_preview.js');
  const workflowId = 'this-workflow';
  const record = (digit, node_id = 7) => ({
    filename: 'EZ_' + digit.repeat(32) + '.mp4',
    type: 'output', subfolder: 'h3_continuum_ez', node_id, plan: initial(),
  });
  const deleted = record('0');
  const previous = record('1', '7');
  const completedJob = (video, id = workflowId) => ({
    status: 'completed', workflow_id: id, outputs: {'8': {h3ez_video: [video]}},
  });
  const details = {
    deleted: completedJob(deleted),
    unrelated: completedJob(record('2', '9')),
    other: completedJob(record('3'), 'other-workflow'),
    previous: completedJob(previous),
  };
  const headRequests = [];
  const api = {
    apiURL: route => '/api' + route,
    async fetchApi(route, {method} = {}) {
      const url = new URL(route, 'http://fixture');
      if (url.pathname === '/jobs') {
        assert.equal(url.searchParams.get('workflow_id'), workflowId);
        assert.equal(url.searchParams.get('status'), 'completed');
        const offset = Number(url.searchParams.get('offset'));
        const ids = offset === 0 ? ['deleted', 'unrelated', 'other'] : ['previous'];
        return Response.json({
          jobs: ids.map(id => ({id, workflow_id: workflowId, outputs_count: 1})),
          pagination: {has_more: offset === 0},
        });
      }
      if (method === 'HEAD') {
        const filename = url.searchParams.get('filename');
        headRequests.push(filename);
        return new Response(null, {status: filename === deleted.filename ? 404 : 200});
      }
      return Response.json(details[url.pathname.split('/').at(-1)]);
    },
  };

  const found = await findPreviousVideo(api, workflowId, 7, new AbortController().signal);
  assert.deepEqual(headRequests, [deleted.filename, previous.filename]);
  assert.deepEqual(found.plan, previous.plan);
  assert.match(found.url, new RegExp(previous.filename));
});
