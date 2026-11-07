import assert from 'node:assert/strict';
import { offsets, handlers } from '../js/components/transcript.js';
import { scorePanelView } from '../js/components/score-panel.js';
import { store } from '../js/store.js';
import { SEED_CHECKLIST } from '../js/checklist.seed.js';
import { calculate } from '../js/scoring.js';

assert.deepEqual(offsets([{timestamp:'00:12'}, {timestamp:'01:30'}, {timestamp:'bad'}]), [12,90,null]);
assert.deepEqual(offsets([{timestamp:'2026-11-07T10:00:12Z'}, {timestamp:'2026-11-07T10:01:30Z'}]), [0,78]);
const audio = { currentTime:0, duration:120, readyState:1 };
let focused = false;
globalThis.document = { getElementById: (id) => id === 'call-audio' ? audio : { scrollIntoView(){}, focus(){ focused = true; } } };
const conv = {conversation_id:'call', audio_url:'audio.wav', transcript:[{timestamp:'00:12',speaker:'operator',text:'Hello'}]};
store.set({route:{name:'conversation',params:{id:'call'}},conversations:[conv]});
handlers.click.jump({dataset:{indices:'0'}});
assert.equal(audio.currentTime,12);
assert.equal(focused,true);
assert.deepEqual(store.get().highlight.indices,[0]);
const answers = {c1:'yes',c2:'yes',c3:'yes',c4:20,c5:'yes',c6:10,c7:'yes',c8:'no'};
const calc = calculate(SEED_CHECKLIST.criteria,answers);
const ev = {id:'ev-test',checklist_id:SEED_CHECKLIST.id,conversation_id:'call',created_at:new Date().toISOString(),
 total:calc.total,sections:calc.sections,gross_flag:false,items:SEED_CHECKLIST.criteria.map(c=>({criterion_id:c.id,answer:answers[c.id],evidence:[0],evidence_quotes:[{index:0,quote:'<script>bad</script>'}],explanation:'Explanation',points:0})),
 usage:{model:'gpt-6-luna',input_tokens:100,output_tokens:200,cost_usd:0.00011}};
const markup = String(scorePanelView({checklists:[SEED_CHECKLIST],appeals:[]},conv,ev));
assert.ok(markup.includes('$0.000110'));
assert.ok(markup.includes('00:12'));
assert.ok(markup.includes('&lt;script&gt;bad&lt;/script&gt;'));
assert.ok(!markup.includes('<script>bad</script>'));
console.log('Results checks passed: timestamp mapping, evidence seek/highlight, cost, escaped quotes');

const { finalResult } = await import('../js/results.js');
globalThis.window = {location:{search:''}};
const { reviewView } = await import('../js/components/appeals.js');
const appeal = {id:'AP-test',evaluation_id:ev.id,conversation_id:'call',checklist_id:ev.checklist_id,criterion_id:'c4',
 original_answer:20,status:'pending',comment:'Please review',created_at:ev.created_at};
const state = {checklists:[SEED_CHECKLIST],conversations:[conv],evaluations:{[ev.id]:ev},latest:{call:ev.id},
 appeals:[appeal],route:{name:'review',params:{id:appeal.id}},review:{appealId:appeal.id,answer:10,reason:'Partial resolution'}};
const preview = String(reviewView(state));
assert.ok(preview.includes('Итог после решения'));
assert.ok(preview.includes('90.00'));
state.appeals = [{...appeal,status:'resolved',resolution:{new_answer:10,reason:'Partial resolution',resolved_at:ev.created_at}}];
assert.equal(finalResult(state,ev).final.total,90);
assert.equal(ev.total,100);
assert.ok(String(reviewView(state)).includes('Partial resolution'));
state.appeals = [{...state.appeals[0],resolution:{...state.appeals[0].resolution,new_answer:20}}];
assert.equal(finalResult(state,ev).final.total,100);
assert.equal(finalResult(state,ev).hasDecisions,true);
console.log('Appeal checks passed: reviewer preview, override, original preservation, confirmation');
