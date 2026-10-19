import assert from "node:assert/strict";
import { useStudio } from "../src/store.ts";

const state = () => useStudio.getState();
state().select("pocket-01");
state().toggle("geometry");
state().toggle("allPockets");
assert.equal(state().options.allPockets, true);
assert.equal(state().options.geometry, true);
assert.equal(state().selectedId, "pocket-01");
state().toggle("allPockets");
assert.equal(state().options.geometry, true);
assert.equal(state().options.allPockets, false);
state().toggle("allPockets");
state().toggle("geometry");
assert.equal(state().options.geometry, false);
assert.equal(state().options.allPockets, false);
assert.equal(state().selectedId, "pocket-01");
console.log(
  "Pocket overlay toggles preserve selection and geometry visibility.",
);

// A pane drag can emit many resize notifications between renderer frames.
const { resizeWithFrame } = await import('../src/molstar/resize.ts');
const events=[];
const plugin={handleResize:()=>events.push('clear'),canvas3d:{tick:(_time,options)=>events.push(options?.manualDraw?'skip':options?.isSynchronous?'draw-sync':'draw')}};
const originalResize=plugin.handleResize,originalTick=plugin.canvas3d.tick;
const restore=resizeWithFrame(plugin);
plugin.handleResize();plugin.handleResize();
assert.deepEqual(events,[],'Resize notifications must not clear the visible framebuffer');
plugin.canvas3d.tick(1,{manualDraw:true});
assert.deepEqual(events,['skip'],'A non-drawing tick must preserve the existing frame');
events.length=0;
plugin.canvas3d.tick(2);
assert.deepEqual(events,['clear','draw-sync'],'Coalesced resize must clear and draw in the same tick');
events.length=0;
plugin.canvas3d.tick(3);
assert.deepEqual(events,['draw'],'Ordinary rotation must keep the normal rendering path');
plugin.handleResize();restore();
assert.equal(plugin.handleResize,originalResize);assert.equal(plugin.canvas3d.tick,originalTick);
console.log('Canvas resize checks passed: coalescing, synchronous redraw, manual ticks and cleanup.');

state().setDockingScoring('vinardo');
state().setTab('docking');
assert.equal(state().dockingScoring,'vinardo','Model selection must carry into Docking');
state().setTab('model');
state().setDockingScoring('vina');
assert.equal(state().dockingScoring,'vina');
console.log('Docking method selection is shared across inspector tabs.');

// Relative scores preserve raw data, ties and missing predictions across each full analysis.
const { relativePocketScores } = await import('../src/pocketScores.ts');
const scored=(id,value)=>({id,prediction:value===null?null:{probability:value}});
const candidates=[scored('a',.06),scored('b',.03),scored('c',0),scored('d',null),scored('e',.06)];
const before=JSON.stringify(candidates);
assert.deepEqual([...relativePocketScores(candidates).values()],[1,.5,0,undefined,1]);
assert.equal(JSON.stringify(candidates),before,'Normalization cannot mutate scientific outputs');
assert.deepEqual([...relativePocketScores([scored('zero',0),scored('missing',null)]).values()],[0,undefined]);
assert.equal(relativePocketScores([scored('single',.01)]).get('single'),1);
assert.equal(relativePocketScores([scored('other',.6),scored('b',.03)]).get('b'),.05);
assert.equal(relativePocketScores([]).size,0);
console.log('Relative score checks passed: protein-local maximum, ties, zero, missing and untouched raw outputs.');
