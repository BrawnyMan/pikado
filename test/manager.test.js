import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {samplePlayers} from '../engine.js';
test('manager credentials restrict HTTP and WebSocket scope, persist hashed, rotate and revoke',{timeout:30000},async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'darts-manager-'));let child,origin,cookie='';const sockets=[];
 async function launch(){child=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',HOST:'127.0.0.1',ADMIN_PASSWORD:'admin-secret',DATA_DIR:dir,ADS_DIR:path.join(dir,'ads')},stdio:['ignore','pipe','pipe']});let output='';await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Startup timeout')),5000);child.stdout.on('data',c=>{output+=c;if(output.includes('Darts Live ready')){clearTimeout(timer);resolve();}});child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Exited ${code}`));});});origin=`http://127.0.0.1:${/localhost:(\d+)/.exec(output)[1]}`;}
 const post=(route,data)=>fetch(origin+route,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(data)});
 const get=route=>fetch(origin+route,{headers:{Cookie:cookie}});
 async function login(route,password){const r=await post(route,{password});if(r.ok)cookie=r.headers.get('set-cookie').split(';')[0];return r;}
 async function ws(route,allowed=true){const w=new WebSocket(origin.replace('http:','ws:')+route,{origin,headers:{Cookie:cookie}});sockets.push(w);if(allowed)await once(w,'message');else await once(w,'error');return w;}
 try{
 await launch();await login('/api/login','admin-secret');const adminCookie=cookie;
 const a=await(await post('/api/tournaments',{title:'Manager Cup',modelId:'single-16'})).json(),b=await(await post('/api/tournaments',{title:'Other Cup',modelId:'single-16'})).json();
 await post(`/api/command?id=${a.id}`,{type:'start',title:'Manager Cup',names:samplePlayers,revision:0});
 const grant=await(await post(`/api/manager-access?id=${a.id}`,{enabled:true,revision:1})).json();assert.ok(grant.password.length>=20);assert.equal(grant.managerUrl,`/manager?id=${a.id}`);
 assert.equal((await login(`/api/manager-login?id=${b.id}`,grant.password)).status,401);
 assert.equal((await login(`/api/manager-login?id=${a.id}`,grant.password)).status,200);const managerCookie=cookie;
 assert.deepEqual(await(await get('/api/session')).json(),{authenticated:true,role:'manager',tournamentId:a.id});
 for(const route of ['/api/tournaments',`/api/events?id=${a.id}`,`/api/events/export?id=${a.id}`,`/api/export?id=${a.id}`,`/api/export?id=${b.id}`,`/api/manager-access?id=${a.id}`,`/api/models/single-16`,`/api/state?id=${b.id}`])assert.equal((await get(route)).status,403,route);
 assert.equal((await get(`/api/state?id=${a.id}`)).status,200);
 assert.equal((await post('/api/tournaments',{title:'Forbidden',modelId:'single-16'})).status,403);
 assert.equal((await post(`/api/archive?id=${a.id}`,{archived:true,revision:2})).status,403);
 assert.equal((await post(`/api/manager-access?id=${a.id}`,{enabled:true,revision:2})).status,403);
 assert.equal((await post(`/api/command?id=${b.id}`,{type:'assign',matchId:'r1-1',machineId:1,revision:0})).status,403);
 for(const type of ['start','undo','select-model','add-machine','remove-machine','round-settings','match-settings','announce','clear-announcement','reset'])assert.equal((await post(`/api/command?id=${a.id}`,{type,revision:2})).status,403,type);
 await ws(`/live?id=${b.id}`,false);await ws(`/live?id=${a.id}&channel=monitor`,false);const managed=await ws(`/live?id=${a.id}&channel=manager`);
 assert.equal((await post(`/api/command?id=${a.id}`,{type:'assign',matchId:'r1-1',machineId:1,revision:2})).status,200);
 assert.equal((await post(`/api/command?id=${a.id}`,{type:'score',matchId:'r1-1',score:[1,1],revision:3})).status,200);
 assert.equal((await post(`/api/command?id=${a.id}`,{type:'finish',matchId:'r1-1',score:[2,1],revision:4})).status,200);
 assert.equal((await post(`/api/command?id=${a.id}`,{type:'assign',matchId:'r1-2',machineId:1,revision:5})).status,200);
 assert.equal((await post(`/api/command?id=${a.id}`,{type:'unassign',matchId:'r1-2',revision:6})).status,200);
 const redirect=await get('/admin');assert.ok(redirect.url.endsWith(`/manager?id=${a.id}`));
 cookie=adminCookie;const ended=once(managed,'close');const replacement=await(await post(`/api/manager-access?id=${a.id}`,{enabled:true,revision:7})).json();await ended;assert.notEqual(replacement.password,grant.password);
 cookie=managerCookie;assert.equal((await get(`/api/state?id=${a.id}`)).status,401);assert.equal((await login(`/api/manager-login?id=${a.id}`,grant.password)).status,401);
 assert.equal((await login(`/api/manager-login?id=${a.id}`,replacement.password)).status,200);
 for(const w of sockets)w.terminate();const exit=once(child,'exit');child.kill();await exit;await launch();
 assert.equal((await login(`/api/manager-login?id=${a.id}`,replacement.password)).status,200);const active=await ws(`/live?id=${a.id}&channel=manager`);
 await login('/api/login','admin-secret');const revoked=once(active,'close');assert.equal((await post(`/api/manager-access?id=${a.id}`,{enabled:false,revision:8})).status,200);await revoked;
 const events=await(await get(`/api/events/export?id=${a.id}`)).json();assert.ok(events.some(e=>e.payload.actorRole==='manager'));assert.ok(!JSON.stringify(events).includes(grant.password));assert.ok(!JSON.stringify(events).includes(replacement.password));
 assert.equal((await login(`/api/manager-login?id=${a.id}`,replacement.password)).status,401);
 }finally{for(const w of sockets)w.terminate();if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}rmSync(dir,{recursive:true,force:true});}
});
