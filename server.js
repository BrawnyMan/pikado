import http from 'node:http';
import {randomBytes,timingSafeEqual,scryptSync} from 'node:crypto';
import {readFileSync,mkdirSync,readdirSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {WebSocketServer,WebSocket} from 'ws';
import {models,createMatches} from './models.js';
import {applyCommand} from './engine.js';
import {TournamentStore,AppError,commandDescription,commandPayload} from './store.js';
const root=path.dirname(fileURLToPath(import.meta.url));
const dataDir=path.resolve(process.env.DATA_DIR||path.join(root,'data'));mkdirSync(dataDir,{recursive:true});
const store=new TournamentStore(dataDir);
const adsRoot=path.resolve(process.env.ADS_DIR||path.join(root,'ads'));for(const side of ['left','right'])mkdirSync(path.join(adsRoot,side),{recursive:true});
const imageTypes={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'};
function adFiles(side){return readdirSync(path.join(adsRoot,side),{withFileTypes:true}).filter(f=>f.isFile()&&imageTypes[path.extname(f.name).toLowerCase()]).map(f=>f.name).sort();}
let password=process.env.ADMIN_PASSWORD;
if(!password){password=randomBytes(18).toString('base64url');console.log(`Temporary admin password: ${password}\nSet ADMIN_PASSWORD in .env for a stable password.`);}
const sessions=new Map(),attempts=new Map(),sockets=new WebSocketServer({noServer:true,maxPayload:1024});
const same=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
function send(res,status,value,extra={}){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...extra});res.end(JSON.stringify(value));}
function sessionToken(req){return /(?:^|;\s*)darts_session=([^;]+)/.exec(req.headers.cookie||'')?.[1];}
function tokenSession(token){
 const actor=sessions.get(token);if(!actor||actor.expiresAt<=Date.now())return null;
 if(actor.role==='manager'){const access=store.managerAccess(actor.tournamentId);if(!access?.enabled||access.version!==actor.version)return null;}
 return actor;
}
function validSession(token){return !!tokenSession(token);}
function adminToken(token){return tokenSession(token)?.role==='admin';}
function actor(req){return tokenSession(sessionToken(req));}
function requireAdmin(req){const user=actor(req);if(!user)throw new AppError('Please sign in as admin.',401);if(user.role!=='admin')throw new AppError('This action is restricted to admins.',403);return user;}
function requireOperator(req,id){const user=actor(req);if(!user)throw new AppError('Please sign in to manage this tournament.',401);if(user.role!=='admin'&&user.tournamentId!==id)throw new AppError('Your manager access is limited to your assigned tournament.',403);return user;}
function readScope(req,id){const raw=sessions.get(sessionToken(req));if(raw?.role==='manager')requireOperator(req,id);}
function publicSession(req){const user=actor(req);return {authenticated:!!user,role:user?.role||'viewer',tournamentId:user?.tournamentId||null};}
function sessionCookie(token){return `darts_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.COOKIE_SECURE==='true'?'; Secure':''}`;}
function issueSession(role,extra={}){const token=randomBytes(32).toString('hex');sessions.set(token,{role,expiresAt:Date.now()+43200000,...extra});return token;}
function passwordHash(secret,salt){return scryptSync(secret,salt,32).toString('hex');}
function trusted(req){try{return new URL(req.headers.origin).host===req.headers.host;}catch{return false;}}
function broadcast({state,event}){
 for(const ws of sockets.clients){
  if(ws.tournamentId!==state.id||ws.readyState!==WebSocket.OPEN)continue;
  if(ws.restricted&&!validSession(ws.token)){ws.close(4001,'Manager access ended');continue;}
  if(ws.monitor){if(!adminToken(ws.token)){ws.close(4001,'Admin session expired');continue;}ws.send(JSON.stringify({type:'event',tournamentId:state.id,event}));}
  else ws.send(JSON.stringify({type:'state',tournamentId:state.id,state,event:{id:event.id,uuid:event.uuid,type:event.type,message:event.message,createdAt:event.createdAt}}));
 }
}
async function body(req){let value='';for await(const part of req){value+=part;if(value.length>32768)throw new AppError('Request too large.',413);}try{return JSON.parse(value);}catch{throw new AppError('Invalid JSON.');}}
function plan(state){if(state.phase!=='setup')return state;const model=models.find(m=>m.id===state.modelId),players=Array.from({length:model.playerCount},(_,i)=>({id:`p${i+1}`,name:`Player ${i+1}`}));return {...state,phase:'planning',isTemplatePreview:true,players,matches:createMatches(model,players,state.roundTargets)};}
function undo(record){
 const {state:current,history}=record;if(!history.length)throw new AppError('Nothing to undo.');
 const state=structuredClone(history.at(-1)),now=Date.now();state.archived=current.archived;
 for(const m of state.matches)if(m.status==='playing'&&m.timing?.runningSince!==null){
  const old=current.matches.find(n=>n.id===m.id);
  if(old?.status==='playing'&&old.machineId===m.machineId){m.timing=structuredClone(old.timing);m.machineHistory=structuredClone(old.machineHistory);}
  else{const end=old?.finishedAt?Date.parse(old.finishedAt):(old?.machineHistory?.at(-1)?.endedAt??current.updatedAt);m.timing.elapsedMs=(m.timing.elapsedMs??0)+Math.max(0,(end??now)-m.timing.runningSince);m.timing.runningSince=now;const visit=m.machineHistory.at(-1);if(visit&&visit.endedAt===null)visit.endedAt=end??now;m.machineHistory.push({machineId:m.machineId,machineName:state.machines.find(b=>b.id===m.machineId)?.name||`Machine ${m.machineId}`,startedAt:now,endedAt:null});}
 }
 return {state,history:history.slice(0,-1)};
}
const files={'/app.js':['app.js','text/javascript'],'/portal.js':['portal.js','text/javascript'],'/terminal.js':['terminal.js','text/javascript'],'/style.css':['style.css','text/css']};
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 const url=new URL(req.url,'http://localhost'),id=url.searchParams.get('id');
 try{
  if(req.method==='GET'){
   if(url.pathname==='/api/session')return send(res,200,publicSession(req));
   if(url.pathname==='/api/tournaments'){requireAdmin(req);return send(res,200,store.list());}
   if(url.pathname==='/api/state'){readScope(req,id);return send(res,200,store.get(id).state);}
   if(url.pathname==='/api/manager-access'){requireAdmin(req);store.get(id);const access=store.managerAccess(id);return send(res,200,{enabled:!!access?.enabled});}
   if(url.pathname==='/api/events'||url.pathname==='/api/events/export'){
    requireAdmin(req);const before=Number(url.searchParams.get('before')||0),after=Number(url.searchParams.get('after')||0);
    if(!Number.isSafeInteger(before)||before<0||!Number.isSafeInteger(after)||after<0)throw new AppError('Invalid event cursor.');
    const events=store.events(id,{before,after,all:url.pathname.endsWith('/export')});
    return send(res,200,events,url.pathname.endsWith('/export')?{'Content-Disposition':'attachment; filename="tournament-events.json"'}:{});
   }
   if(url.pathname==='/api/models')return send(res,200,models.map(m=>({...m,preview:createMatches(m,Array.from({length:m.playerCount},(_,i)=>({id:`p${i+1}`})),m.defaultTargets)})));
   if(url.pathname.startsWith('/api/models/')){requireAdmin(req);const model=models.find(m=>m.id===url.pathname.slice('/api/models/'.length));if(!model)throw new AppError('Model not found.',404);return send(res,200,model,{'Content-Disposition':`attachment; filename="${model.playerCount}.json"`});}
   if(url.pathname==='/api/export'){requireAdmin(req);return send(res,200,{schemaVersion:4,exportedAt:new Date().toISOString(),...plan(store.get(id).state)},{'Content-Disposition':'attachment; filename="tournament-plan.json"'});}
   if(url.pathname==='/api/ads')return send(res,200,Object.fromEntries(['left','right'].map(side=>[side,adFiles(side).map(name=>`/ads/${side}/${encodeURIComponent(name)}`)])));
   if(url.pathname.startsWith('/ads/')){const parts=url.pathname.split('/'),side=parts[2],name=decodeURIComponent(parts[3]||'');if(parts.length!==4||!['left','right'].includes(side)||!adFiles(side).includes(name))throw new AppError('Ad not found.',404);const parent=realpathSync(path.join(adsRoot,side)),filePath=realpathSync(path.join(parent,name));if(path.dirname(filePath)!==parent)throw new AppError('Ad not found.',404);res.writeHead(200,{'Content-Type':imageTypes[path.extname(name).toLowerCase()],'Cache-Control':'no-cache'});return res.end(readFileSync(filePath));}
  }
  if(req.method==='POST'){
   if(!trusted(req))throw new AppError('Request origin does not match this server.',403);
   if(url.pathname==='/api/login'||url.pathname==='/api/manager-login'){
    const key=`${req.socket.remoteAddress}:${url.pathname}`,now=Date.now(),a=attempts.get(key);
    if(attempts.size>10000)attempts.clear();
    if(a&&a.until>now&&a.count>=10)throw new AppError('Too many attempts. Try again in 15 minutes.',429);
    const input=await body(req),secret=typeof input.password==='string'?input.password:'';
    const manager=url.pathname==='/api/manager-login',access=manager?store.managerAccess(id):null;
    const valid=secret.length<=128&&(manager?access?.enabled&&same(passwordHash(secret,access.salt),access.hash):same(secret,password));
    if(!valid){attempts.set(key,{count:a&&a.until>now?a.count+1:1,until:a&&a.until>now?a.until:now+900000});throw new AppError(manager?'Incorrect manager password or manager access is disabled.':'Incorrect admin password.',401);}
    attempts.delete(key);for(const [token,s] of sessions)if(s.expiresAt<now)sessions.delete(token);
    const token=issueSession(manager?'manager':'admin',manager?{tournamentId:id,version:access.version}:{});
    return send(res,200,{ok:true,role:manager?'manager':'admin',tournamentId:manager?id:null},{'Set-Cookie':sessionCookie(token)});
   }
   if(url.pathname==='/api/command')requireOperator(req,id);else if(url.pathname!=='/api/logout')requireAdmin(req);
   if(url.pathname==='/api/logout'){
    sessions.delete(sessionToken(req));for(const ws of sockets.clients)if((ws.monitor&&!adminToken(ws.token))||(ws.restricted&&!validSession(ws.token)))ws.close(4001,'Signed out');
    return send(res,200,{ok:true},{'Set-Cookie':'darts_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
   }
   if(url.pathname==='/api/manager-access'){
    const input=await body(req);if(typeof input.enabled!=='boolean')throw new AppError('Choose to generate or revoke manager access.');
    const secret=input.enabled?randomBytes(18).toString('base64url'):null,salt=secret?randomBytes(16).toString('hex'):null;
    const credentials=secret?{salt,hash:passwordHash(secret,salt)}:null;
    const result=store.commit(id,input.revision,record=>{store.setManagerAccess(id,credentials);return {state:record.state,history:record.history,type:'manager-access',message:secret?'Manager access generated / rotated':'Manager access revoked',payload:{enabled:input.enabled,actorRole:'admin'}};});
    broadcast(result);return send(res,200,{ok:true,enabled:input.enabled,password:secret,managerUrl:`/manager?id=${encodeURIComponent(id)}`});
   }
   if(url.pathname==='/api/tournaments'){
    const input=await body(req),result=store.create(input);return send(res,201,{id:result.state.id,state:result.state});
   }
   if(url.pathname==='/api/archive'){
    const input=await body(req);if(typeof input.archived!=='boolean')throw new AppError('Choose archive or reopen.');
    const result=store.commit(id,input.revision,record=>{
     if(input.archived&&record.state.matches.some(m=>m.status==='playing'))throw new AppError('Return active matches to the queue before archiving.');
     return {state:{...record.state,archived:input.archived},history:record.history,type:input.archived?'archive':'reopen',message:input.archived?'Tournament archived · read only':'Tournament reopened',payload:{archived:input.archived}};
    });broadcast(result);return send(res,200,{ok:true});
   }
   if(url.pathname==='/api/command'){
    const command=await body(req),user=requireOperator(req,id);
    if(user.role==='manager'&&!['assign','unassign','score','finish'].includes(command.type))throw new AppError('Managers may only assign games, return them to the queue, enter scores and confirm winners.',403);
    if(command.type==='reset')throw new AppError('Create a new tournament to keep this event in history.');
    const result=store.commit(id,command.revision,record=>{
     if(record.state.archived)throw new AppError('This tournament is archived. Reopen it to make changes.',423);
     const next=command.type==='undo'?undo(record):{state:applyCommand(record.state,command),history:[...record.history,record.state].slice(-30)};
     return {...next,type:command.type,message:commandDescription(command,next.state),payload:{...commandPayload(command),actorRole:user.role},matchId:command.matchId||null};
    });broadcast(result);return send(res,200,{ok:true,revision:result.state.revision});
   }
  }
  if(req.method==='GET'){
   if(url.pathname==='/veiw'){res.writeHead(302,{Location:'/view'+url.search});return res.end();}
   const user=actor(req);if(user?.role==='manager'&&['/','/admin','/terminal'].includes(url.pathname)){res.writeHead(302,{Location:`/manager?id=${encodeURIComponent(user.tournamentId)}`});return res.end();}
   let file=files[url.pathname];
   if(['/','/admin','/manager','/view','/terminal'].includes(url.pathname))file=[!id?'portal.html':url.pathname==='/terminal'?'terminal.html':'index.html','text/html'];
   if(file){res.writeHead(200,{'Content-Type':`${file[1]}; charset=utf-8`,'Cache-Control':'no-store'});return res.end(readFileSync(path.join(root,'public',file[0])));}
  }
  throw new AppError('Not found.',404);
 }catch(error){send(res,error.status||400,{error:error.message});}
});
server.on('upgrade',(req,socket,head)=>{
 const url=new URL(req.url,'http://localhost'),id=url.searchParams.get('id'),monitor=url.searchParams.get('channel')==='monitor';
 if(url.pathname!=='/live'||!trusted(req))return socket.destroy();
 let record;try{record=store.get(id);readScope(req,id);if(monitor)requireAdmin(req);if(url.searchParams.get('channel')==='manager')requireOperator(req,id);}catch{return socket.destroy();}
 sockets.handleUpgrade(req,socket,head,ws=>{
  ws.tournamentId=id;ws.restricted=actor(req)?.role==='manager';ws.monitor=monitor;ws.token=sessionToken(req);ws.alive=true;ws.on('pong',()=>{ws.alive=true;});ws.on('error',()=>{});
  ws.send(JSON.stringify(monitor?{type:'hello',tournamentId:id,title:record.state.title,revision:record.state.revision}:{type:'state',tournamentId:id,state:record.state}));
 });
});
const heartbeat=setInterval(()=>{for(const ws of sockets.clients){if(!ws.alive||(ws.monitor&&!adminToken(ws.token))||(ws.restricted&&!validSession(ws.token))){ws.terminate();continue;}ws.alive=false;ws.ping();}},30000);
server.on('close',()=>{clearInterval(heartbeat);store.close();});
server.listen(Number(process.env.PORT||3000),process.env.HOST||'0.0.0.0',()=>console.log(`Darts Live ready: http://localhost:${server.address().port}/admin · SQLite tournament history enabled`));
