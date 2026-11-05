import test from 'node:test';import assert from 'node:assert/strict';
import {syncSeedControls} from '../web/seed_controls.js';
test('promoted EZ seed mode is mirrored without another randomizer or serialized widget',()=>{
  const control={value:'randomize',options:{values:['fixed','randomize','increment','decrement']}};
  const source={name:'seed',linkedWidgets:[control]},target={name:'seed'},node={type:'H3ContinuumEZEngine',getWidgetFromSlot:()=>source};
  const slot={name:'seed',linkIds:[1]},host={inputs:[{name:'seed',_subgraphSlot:slot,link:null}],widgets:[],
    subgraph:{getLink:()=>({resolve:()=>({inputNode:node,input:target})})},
    addWidget(type,name,value,callback,options){const w={type,name,value,callback,options};this.widgets.push(w);return w;},
    removeWidget(w){this.widgets=this.widgets.filter(x=>x!==w);}};
  syncSeedControls(host,'mode');const w=host.widgets[0];
  assert.equal(w.value,'randomize');assert.equal(w.options.serialize,false);assert.equal(w.serialize,false);
  assert.equal(w.beforeQueued,undefined);assert.equal(w.afterQueued,undefined);
  w.callback('fixed');assert.equal(control.value,'fixed');
  control.value='increment';assert.equal(w.value,'increment');
  syncSeedControls(host,'mode');assert.equal(host.widgets.length,1);
  host.inputs[0].link=20;syncSeedControls(host,'mode');assert.equal(host.widgets.length,0);
  assert.equal(control.value,'increment');
});
