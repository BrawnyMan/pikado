import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {models,createMatches} from '../models.js';
import {initialState,applyCommand,samplePlayers} from '../engine.js';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const fixtureId="11111111-1111-4111-8111-111111111111";
async function client(path='/view',state=initialState(),session={authenticated:true}) {
 const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:`http://localhost:3000${path}?id=${fixtureId}`,runScripts:'outside-only'});
 const {window:w}=dom,timers=[],requests=[];w.structuredClone=structuredClone;
 w.setInterval=(f,ms)=>{timers.push({f,ms});return timers.length;};w.setTimeout=()=>1;w.clearTimeout=()=>{};
 let time=Date.now();w.Date.now=()=>time;
 w.fetch=async(url,options)=>{requests.push({url,options});return {ok:true,status:200,json:async()=>url==='/api/models'?models.map(m=>({...m,preview:createMatches(m,Array.from({length:m.playerCount},(_,i)=>({id:`p${i+1}`})),m.defaultTargets)})):url==='/api/ads'?{left:['/ads/left/one.png','/ads/left/two.png'],right:['/ads/right/right.jpg']}:url==='/api/session'?session:structuredClone(state)};};
 w.WebSocket=class {constructor(url){w.socket=this;w.socketUrl=url;}};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.confirm=()=>true;
 w.AudioContext=class {currentTime=0;destination={};resume=async()=>{};createOscillator(){w.tones=(w.tones||0)+1;return {frequency:{},connect(){},start(){},stop(){}};}createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}};}};
 await vm.runInContext(`(async()=>{${source}\n})()`,dom.getInternalVMContext());
 const socket=w.socket;if(socket)socket.onopen();
 const receive=next=>socket.onmessage({data:JSON.stringify({type:'state',state:next})});
 if(socket)receive(state);
 return {dom,w,requests,timers,receive,advance(ms){time+=ms;},click(selector){const el=w.document.querySelector(selector);assert.ok(el,selector);el.click();},close(){dom.window.close();}};
}
const started=()=>applyCommand(initialState(),{type:'start',title:'Client Cup',names:samplePlayers});
const tick=()=>new Promise(r=>setImmediate(r));
test('viewer rotates independent ads, expires announcements, highlights calls and chimes only for queue changes',async()=>{
 const c=await client('/view',started());try{
  assert.equal(c.w.document.querySelectorAll('.ad-panel').length,2);assert.ok(c.w.socketUrl.includes('id='+fixtureId));
  const first=c.w.document.querySelector('[data-ad="left"] img').src;
  c.advance(5000);c.timers.find(t=>t.ms===500).f();assert.notEqual(c.w.document.querySelector('[data-ad="left"] img').src,first);
  c.click('[data-action="sound"]');await tick();assert.equal(c.w.tones,2);
  let next=applyCommand(started(),{type:'assign',matchId:'r1-1',machineId:1});
  c.receive(next);await tick();assert.equal(c.w.tones,4);assert.ok(c.w.document.querySelector('.machine.new-call'));assert.match(c.w.document.querySelector('#next-call').textContent,/Machine 01/);
  next=applyCommand(next,{type:'score',matchId:'r1-1',score:[1,0]});c.receive(next);await tick();assert.equal(c.w.tones,4);
  next=applyCommand(next,{type:'announce',text:'Finalists <report> now',seconds:0});c.receive(next);assert.equal(c.w.document.querySelector('#announcement p').textContent,'Finalists <report> now');assert.equal(c.w.document.querySelector('#announcement report'),null);
  next.announcement={id:'timed',text:'Timed message',expiresAt:c.w.Date.now()+1000};c.receive(next);c.advance(11000);c.timers.find(t=>t.ms===500).f();assert.equal(c.w.document.querySelector('#announcement'),null);assert.equal(c.w.document.querySelector('.new-call'),null);assert.equal(c.w.document.querySelector('#next-call'),null);
 }finally{c.close();}
});
test('admin renders seven machine controls, three leg inputs, and stable player IDs in game settings',async()=>{
 let s=started();while(s.machines.length<7)s=applyCommand(s,{type:'add-machine'});
 s=applyCommand(s,{type:'assign',matchId:'r1-1',machineId:1});
 const c=await client('/admin',s);try{
  assert.equal(c.w.document.querySelectorAll('.machine').length,7);
  c.click('[data-action="scores"][data-id="r1-1"]');
  assert.equal(c.w.document.querySelectorAll('#leg-editor input[type="number"]').length,6);
  assert.equal(c.w.document.querySelectorAll('#leg-editor select').length,3);
  const scores=c.w.document.querySelector('#leg-editor');
  scores.elements.namedItem('score-0-0').value='0';scores.elements.namedItem('score-0-1').value='35';scores.elements.namedItem('winner-0').value='p1';
  scores.dispatchEvent(new c.w.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:scores.querySelector('[value="score"]')}));await tick();
  const posted=JSON.parse(c.requests.at(-1).options.body);assert.equal(posted.type,'score');assert.deepEqual(posted.legs[0],{score:[0,35],winnerId:'p1'});assert.equal(c.w.document.querySelector('#editor').open,false);
  c.click('[data-action="match-settings"][data-id="r1-1"]');assert.equal(c.w.document.querySelector('#name-p1').value,'Alex Morgan');
  assert.match(c.w.document.querySelector('#match-editor').textContent,/p1/);c.w.document.querySelector('#editor').close();
  c.click('[data-tab="settings"]');assert.equal(c.w.document.querySelectorAll('[data-action="remove-machine"]').length,7);assert.equal(c.w.document.querySelector('[data-action="add-machine"]').disabled,true);
  assert.equal(c.w.document.querySelector('#ad-interval').value,'5');assert.equal(c.w.document.querySelector('#target-0').value,'2');
  assert.equal(c.w.document.querySelector('[data-action="remove-machine"][data-machine="1"]').disabled,true);
 }finally{c.close();}
});

test('live clock ticks without a server update and completed game keeps its duration and machine',async()=>{
 const now=Date.now();let s=applyCommand(started(),{type:'assign',matchId:'r1-1',machineId:1},now);
 const c=await client('/view',s);try{
  assert.equal(c.w.document.querySelector('[data-timer="r1-1"]').textContent,'00:00');
  c.advance(65000);c.timers.find(t=>t.ms===500).f();assert.equal(c.w.document.querySelector('[data-timer="r1-1"]').textContent,'01:05');
  s=applyCommand(s,{type:'finish',matchId:'r1-1',score:[2,1]},now+65000);c.receive(s);c.advance(5000);c.timers.find(t=>t.ms===500).f();
  c.click('[data-tab="plan"]');const row=c.w.document.querySelector('#plan-r1-1');assert.match(row.textContent,/Played · Machine 01/);assert.match(row.textContent,/01:05/);
  assert.match(c.w.document.querySelector('#plan-r2-1').textContent,/Winner of R1-2/);
 }finally{c.close();}
});
test('32-player model preview and player-route filters show future winners without changing the event',async()=>{
 const s=applyCommand(initialState(),{type:'select-model',modelId:'single-32'});
 const c=await client('/admin',s);try{
  c.click('[data-tab="plan"]');assert.equal(c.w.document.querySelectorAll('.plan-table tbody tr').length,31);
  assert.match(c.w.document.querySelector('#plan-r2-1').textContent,/Winner of R1-1/);assert.match(c.w.document.querySelector('#plan-r5-1').textContent,/Champion/);
  const select=c.w.document.querySelector('#plan-player');select.value='p1';select.dispatchEvent(new c.w.Event('change',{bubbles:true}));
  assert.equal(c.w.document.querySelectorAll('.plan-table tbody tr').length,5);assert.match(c.w.document.querySelector('.player-route').textContent,/if previous games are won/);
  assert.equal(c.requests.filter(r=>r.options?.method==='POST').length,0);
  c.click('[data-action="focus-match"][data-id="r2-1"]');assert.ok(c.w.document.querySelector('#plan-r2-1.focused-game'));
 }finally{c.close();}
});

test('manager view offers match operations without admin settings, history or exports',async()=>{
 const s=applyCommand(started(),{type:'assign',matchId:'r1-1',machineId:1});
 const c=await client('/manager',s,{authenticated:true,role:'manager',tournamentId:fixtureId});try{
  assert.match(c.w.socketUrl,/channel=manager/);assert.ok(c.w.document.querySelector('[data-action="scores"]'));assert.ok(c.w.document.querySelector('[data-action="finish"]'));assert.ok(c.w.document.querySelector('[data-action="assign"]'));
  for(const selector of ['[data-tab="settings"]','[data-action="match-settings"]','[data-action="undo"]','[data-action="new-event"]','[data-action="archive"]','a[href="/admin"]','a[href^="/terminal"]'])assert.equal(c.w.document.querySelector(selector),null,selector);
  c.click('[data-tab="plan"]');assert.equal(c.w.document.querySelector('.plan-downloads'),null);assert.equal(c.w.document.querySelector('[data-action="match-settings"]'),null);
  c.click('[data-tab="floor"]');c.click('[data-action="scores"]');assert.equal(c.w.document.querySelectorAll('#leg-editor select').length,3);c.w.document.querySelector('#editor').close();
  c.w.socket.onclose({code:4001});assert.match(c.w.document.querySelector('#login').textContent,/Manager password/);assert.equal(c.w.document.querySelector('[data-action="finish"]'),null);
 }finally{c.close();}
});
test('unsigned manager sees only its tournament login and waits before opening a manager socket',async()=>{
 const c=await client('/manager',started(),{authenticated:false,role:'viewer'});try{assert.match(c.w.document.querySelector('h2').textContent,/Manager sign in/);assert.equal(c.w.socket,undefined);assert.equal(c.w.document.querySelector('[data-action="finish"]'),null);}finally{c.close();}
});
