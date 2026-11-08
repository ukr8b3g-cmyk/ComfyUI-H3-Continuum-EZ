import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject,saveProject,loadProject,MAX_PROJECT_BYTES} from '../web/project.js';
import {initial,registerReference} from '../web/state.js';
import {adoptEntry,dependencyPayload,sha256,canonical} from '../web/enhancer.js';

test('projects retain long text, IDs, media placement and editing settings without mutating the source',()=>{
 const p=initial();p.schema=2;p.prompt_enhancer={enabled:true,texts:[]};p.prompt_source='studio';p.global_prompt='共通\n'.repeat(10000);p.shots[0].prompt='本文\n'.repeat(10000);
 p.assets=[{id:'image-a',kind:'image',file:{name:'scene.png',subfolder:'images',type:'input'}},{id:'audio-a',kind:'audio',duration:60,file:{name:'song.mp3',type:'input'}}];
 registerReference(p,'image-a');p.global_refs=[1];p.shots[0].last_image='image-a';
 p.audio=[{id:'clip-a',asset_id:'audio-a',start:0,source_in:2,duration:50,volume:.25}];
 p.resolution={source:'studio',aspect:'2:3',megapixels:.5};p.chunking={enabled:true,seconds:7.5};
 const dep=dependencyPayload(p,{field:'prompt',shot_id:p.shots[0].id});
 adoptEntry(p,{target:{field:'prompt',shot_id:p.shots[0].id},text:'A person walks.',base_text_hash:sha256(dep.text),dependency_hash:sha256(canonical(dep)),dependencies:dep,images:[]});
 const before=JSON.stringify(p),restored=loadProject(saveProject(p));
 assert.deepEqual(restored,p);assert.equal(JSON.stringify(p),before);
 restored.shots[0].prompt='changed';assert.equal(JSON.stringify(p),before);
});
test('new project is independent and overrides connected external text with a blank Studio prompt',()=>{
 const a=newProject(),b=newProject();assert.equal(a.prompt_source,'studio');assert.equal(a.global_prompt,'');assert.notEqual(a.shots[0].id,b.shots[0].id);assert.equal(a.assets.length,0);
});
test('invalid, oversized and unsupported files never alter an existing project',()=>{
 const p=initial(),before=JSON.stringify(p);
 for(const text of ['{','{}',JSON.stringify({format:'h3-continuum-ez-project',version:2,plan:p}),JSON.stringify({format:'h3-continuum-ez-project',version:1,plan:{schema:1,shots:[]}})])assert.throws(()=>loadProject(text));
 assert.throws(()=>loadProject(' '.repeat(MAX_PROJECT_BYTES+1)));
 assert.equal(JSON.stringify(p),before);
});
test('project rejects unsafe media paths but accepts a UTF-8 BOM',()=>{
 const p=initial();assert.deepEqual(loadProject('\uFEFF'+saveProject(p)),p);
 p.assets=[{id:'image-a',kind:'image',file:{name:'x.png',subfolder:'../outside',type:'input'}}];assert.throws(()=>saveProject(p));
});
