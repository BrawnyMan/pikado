import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const id='11111111-1111-4111-8111-111111111111',otherId='22222222-2222-4222-8222-222222222222';
const tick=()=>new Promise(r=>setImmediate(r));
async function ui(file,url,answers){
 const name=file==='portal'?'portal':'terminal';const dom=new JSDOM(`<div id="${name}"></div><div id="toast"></div>`,{url,runScripts:'outside-only'}),w=dom.window;
 const timers=[],requests=[];w.setInterval=(f,ms)=>{timers.push({f,ms});return timers.length;};w.setTimeout=()=>1;w.clearTimeout=()=>{};w.fetch=async(path,options)=>{requests.push({path,options});return {ok:true,status:200,json:async()=>answers(path,options)};};
 w.WebSocket=class {constructor(url){w.socket=this;w.socketUrl=url;}close(){}};
 await vm.runInContext(`(async()=>{${readFileSync(new URL(`../public/${file}.js`,import.meta.url),'utf8')}\n})()`,dom.getInternalVMContext());
 return {dom,w,timers,requests,close(){dom.window.close();}};
}
test('admin history lists saved UUID links and filters archives without exposing a public list',async()=>{
 const records=[{id,title:'Cup Alpha',modelId:'single-16',phase:'running',revision:5,archived:false,createdAt:'2026-11-14T12:00:00Z',updatedAt:'2026-11-14T13:00:00Z',eventCount:6},{id:otherId,title:'Cup Beta',modelId:'single-32',phase:'complete',revision:40,archived:true,createdAt:'2026-11-13T12:00:00Z',updatedAt:'2026-11-13T16:00:00Z',eventCount:41}];
 const c=await ui('portal','http://localhost/admin',p=>p==='/api/session'?{authenticated:true}:records);try{
 assert.equal(c.w.document.querySelectorAll('.event-card').length,2);assert.ok(c.w.document.querySelector(`a[href="/view?id=${id}"]`));assert.ok(c.w.document.querySelector(`a[href="/terminal?id=${id}"]`));
 const filter=c.w.document.querySelector('#history-filter');filter.value='archived';filter.dispatchEvent(new c.w.Event('change',{bubbles:true}));assert.equal(c.w.document.querySelectorAll('.event-card').length,1);assert.match(c.w.document.querySelector('.event-card').textContent,/Cup Beta/);
 }finally{c.close();}
 const requests=[];const viewer=await ui('portal','http://localhost/view',p=>{requests.push(p);return {authenticated:true};});try{assert.equal(viewer.w.document.querySelector('#create-event'),null);assert.ok(!requests.includes('/api/tournaments'));assert.ok(viewer.w.document.querySelector('#join-event'));}finally{viewer.close();}
});
test('green terminal merges saved and live events, isolates its room, filters safely and pauses its display',async()=>{
 const first={id:1,uuid:'event-1',tournamentId:id,type:'create',revision:0,message:'Tournament created',matchId:null,matchUuid:null,payload:{},createdAt:'2026-11-14T12:00:00Z'};
 const c=await ui('terminal',`http://localhost/terminal?id=${id}`,p=>p==='/api/session'?{authenticated:true}:p.startsWith('/api/state')?{title:'Terminal Cup'}:[first]);try{
 assert.match(c.w.socketUrl,/channel=monitor/);c.w.socket.onopen();await tick();assert.equal(c.w.document.querySelectorAll('.log-entry').length,1);
 const decorative=c.w.document.querySelector('#ambient-output').textContent,count=c.requests.length;c.timers.find(t=>t.ms===5000).f();assert.notEqual(c.w.document.querySelector('#ambient-output').textContent,decorative);assert.equal(c.requests.length,count);assert.equal(c.w.document.querySelector('#log-count').textContent,'1');assert.equal(c.w.document.querySelectorAll('.log-entry').length,1);
 const receive=event=>c.w.socket.onmessage({data:JSON.stringify({type:'event',tournamentId:event.tournamentId,event})});
 receive({...first,id:2,uuid:'event-2',type:'assign',revision:1,message:'Alex <script> vs Jamie assigned',payload:{matchId:'r1-1'}});assert.equal(c.w.document.querySelectorAll('.log-entry').length,2);assert.equal(c.w.document.querySelector('#log-output script'),null);
 receive({...first,id:3,tournamentId:otherId});assert.equal(c.w.document.querySelectorAll('.log-entry').length,2);
 const pause=c.w.document.querySelector('[data-action="pause"]');pause.click();receive({...first,id:4,type:'score',revision:2,message:'Score updated'});assert.equal(c.w.document.querySelectorAll('.log-entry').length,2);assert.equal(c.w.document.querySelector('#log-count').textContent,'3');pause.click();assert.equal(c.w.document.querySelectorAll('.log-entry').length,3);
 const search=c.w.document.querySelector('#log-filter');search.value='assigned';search.dispatchEvent(new c.w.Event('input',{bubbles:true}));assert.equal(c.w.document.querySelectorAll('.log-entry').length,1);assert.match(c.w.document.querySelector('.log-entry').textContent,/Alex <script>/);
 }finally{c.close();}
});
