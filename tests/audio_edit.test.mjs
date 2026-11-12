import test from 'node:test';
import assert from 'node:assert/strict';
import {initial,clone,validate,duration,removeAsset,splitAudio} from '../web/state.js';
import {placeAudio,editorDuration,duplicateAudio,audioTrimLength} from '../web/audio_edit.js';
function project(){const p=initial();p.shots[0].seconds=3;p.assets.push({id:'music',kind:'audio',label:'minute.mp3',duration:60,file:{name:'minute.mp3',type:'input'}});return p;}
test('a minute source stays a minute on a short video timeline',()=>{
 const p=project(),s=clone(p.shots),videoSeconds=duration(p);const c=placeAudio(p,'music',0);
 assert.equal(c.duration,60);assert.equal(editorDuration(p),60);assert.deepEqual(p.shots,s);
 validate(p);assert.equal(duration(p),videoSeconds);assert.equal(c.duration,60);
});
test('repeated placements keep the complete source and avoid overlap',()=>{
 const p=project();placeAudio(p,'music',0);const b=placeAudio(p,'music',1);assert.equal(b.start,60);assert.equal(b.duration,60);assert.equal(editorDuration(p),120);validate(p);
});
test('video trim applies only to a clip crossing the end and respects its timeline offset',()=>{
 const p=project(),end=duration(p),c=placeAudio(p,'music',1);c.source_in=2;c.duration=58;c.volume=.5;
 const before=clone(p);assert.equal(audioTrimLength(p,c),end-1);assert.deepEqual(p,before);
 c.duration=audioTrimLength(p,c);validate(p);assert.equal(c.start+c.duration,end);assert.equal(c.source_in,2);
 assert.equal(audioTrimLength(p,c),null);assert.equal(audioTrimLength(p,{...c,start:end+1}),null);
 assert.equal(p.assets[0].duration,60);
});
test('split and clip deletion keep the source available for another placement',()=>{
 const p=project();const a=placeAudio(p,'music',0);splitAudio(p,a.id,20);assert.equal(p.audio.length,2);assert.equal(p.audio[1].source_in,20);p.audio=p.audio.filter(c=>c.id!==a.id);assert.equal(p.assets.length,1);assert.equal(p.audio[0].duration,40);removeAsset(p,'music');assert.equal(p.audio.length,0);
});
test('duplicate keeps the selected trim and skips occupied intervals without touching shots',()=>{
 const p=project(),c=placeAudio(p,'music',0);c.source_in=12;c.duration=4;
 p.audio.push({id:'later',asset_id:'music',start:6,source_in:20,duration:5});const shots=clone(p.shots);
 const d=duplicateAudio(p,c.id);assert.equal(d.start,11);assert.equal(d.duration,4);assert.equal(d.source_in,12);assert.notEqual(d.id,c.id);assert.deepEqual(p.shots,shots);validate(p);
});
test('clip volume survives splitting, duplication and serialization, and invalid values are rejected',()=>{
 const p=project(),c=placeAudio(p,'music',0);c.volume=.25;splitAudio(p,c.id,20);
 assert.deepEqual(p.audio.map(c=>c.volume),[.25,.25]);assert.equal(duplicateAudio(p,c.id).volume,.25);
 const restored=JSON.parse(JSON.stringify(p));validate(restored);assert.equal(restored.audio[0].volume,.25);
 for(const value of [-.1,1.1,null,NaN,Infinity]){restored.audio[0].volume=value;assert.throws(()=>validate(restored),{key:'invalidVolume'});}
});
