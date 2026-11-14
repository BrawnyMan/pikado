import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {initialState,applyCommand,normalizeState} from './engine.js';
export class AppError extends Error {constructor(message,status=400){super(message);this.status=status;}}
export class TournamentStore {
 constructor(directory) {
  this.db=new DatabaseSync(path.join(directory,'darts.sqlite'));
  this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS tournaments(id TEXT PRIMARY KEY,title TEXT NOT NULL,phase TEXT NOT NULL,model_id TEXT NOT NULL,revision INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,state_json TEXT NOT NULL,undo_json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,uuid TEXT UNIQUE NOT NULL,tournament_id TEXT NOT NULL REFERENCES tournaments(id),revision INTEGER NOT NULL,type TEXT NOT NULL,message TEXT NOT NULL,match_id TEXT,match_uuid TEXT,payload_json TEXT NOT NULL,created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS manager_access(tournament_id TEXT PRIMARY KEY REFERENCES tournaments(id),salt TEXT NOT NULL,password_hash TEXT NOT NULL,version INTEGER NOT NULL,enabled INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS events_tournament_order ON events(tournament_id,id);`);
  // A committed marker prevents re-import even if the original backup remains in place.
  const legacy=path.join(directory,'tournament.json');
  if(!this.db.prepare('SELECT value FROM metadata WHERE key=?').get('legacy-import-checked')) {
   this.transaction(()=>{
    if(existsSync(legacy)) {
     const data=JSON.parse(readFileSync(legacy,'utf8'));
     this.insert(normalizeState(data.state),(data.history||[]).map(s=>normalizeState(s)),'legacy-import');
    }
    this.db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run('legacy-import-checked',new Date().toISOString());
   });
  }
 }
 transaction(fn) {this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 stamp(state,id,map=new Map()) {const next=structuredClone(state);next.id=id;for(const m of next.matches){m.uuid??=map.get(m.id)||randomUUID();map.set(m.id,m.uuid);}return next;}
 insert(state,history=[],type='create') {
  const id=randomUUID(),now=new Date().toISOString(),map=new Map();state=this.stamp(state,id,map);history=history.map(s=>this.stamp(s,id,map));state.archived=false;
  this.db.prepare('INSERT INTO tournaments(id,title,phase,model_id,revision,archived,created_at,updated_at,state_json,undo_json) VALUES(?,?,?,?,?,0,?,?,?,?)').run(id,state.title,state.phase,state.modelId,state.revision,now,now,JSON.stringify(state),JSON.stringify(history));
  const event=this.addEvent(id,state,type, type==='legacy-import'?'Imported existing JSON tournament':'Tournament created',{modelId:state.modelId});
  return {state,event};
 }
 create(input={}) {return this.transaction(()=>{
  let state=initialState();
  if(input.copyFrom){const old=this.get(input.copyFrom).state;state={...state,machines:old.machines,ads:old.ads,roundTargets:old.roundTargets,modelId:old.modelId,playerCount:old.playerCount,roundNames:old.roundNames};}
  if(input.modelId)state=applyCommand(state,{type:'select-model',modelId:input.modelId});
  if(typeof input.title!=='string'||!input.title.trim()||input.title.trim().length>80)throw new AppError('Enter a tournament name (1–80 characters).');
  state.title=input.title.trim();return this.insert(state);
 });}
 get(id) {
  if(typeof id!=='string'||!id)throw new AppError('A tournament id is required.',400);
  const row=this.db.prepare('SELECT * FROM tournaments WHERE id=?').get(id);
  if(!row)throw new AppError('Tournament not found. Check the ID in the link.',404);
  const state=JSON.parse(row.state_json);state.id=row.id;state.archived=!!row.archived;state.createdAt=row.created_at;
  return {state,history:JSON.parse(row.undo_json),createdAt:row.created_at,updatedAt:row.updated_at};
 }
 list() {return this.db.prepare(`SELECT t.id,t.title,t.phase,t.model_id AS modelId,t.revision,t.archived,t.created_at AS createdAt,t.updated_at AS updatedAt,(SELECT count(*) FROM events e WHERE e.tournament_id=t.id) AS eventCount FROM tournaments t ORDER BY t.updated_at DESC,t.id`).all().map(row=>({...row,archived:!!row.archived}));}
 addEvent(id,state,type,message,payload={},matchId=null) {
  const event={uuid:randomUUID(),tournamentId:id,revision:state.revision,type,message,matchId,matchUuid:state.matches.find(m=>m.id===matchId)?.uuid||null,payload,createdAt:new Date().toISOString()};
  const result=this.db.prepare('INSERT INTO events(uuid,tournament_id,revision,type,message,match_id,match_uuid,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(event.uuid,id,event.revision,type,message,event.matchId,event.matchUuid,JSON.stringify(payload),event.createdAt);
  return {id:Number(result.lastInsertRowid),...event};
 }
 commit(id,revision,fn) {return this.transaction(()=>{
  const record=this.get(id);if(record.state.revision!==revision)throw new AppError('Tournament changed on another screen. Review the latest state and try again.',409);
  const result=fn(record);const state=this.stamp(result.state,id);state.revision=revision+1;state.updatedAt=Date.now();
  const update=this.db.prepare('UPDATE tournaments SET title=?,phase=?,model_id=?,revision=?,archived=?,updated_at=?,state_json=?,undo_json=? WHERE id=? AND revision=?').run(state.title,state.phase,state.modelId,state.revision,state.archived?1:0,new Date().toISOString(),JSON.stringify(state),JSON.stringify(result.history),id,revision);
  if(Number(update.changes)!==1)throw new AppError('Tournament changed; retry with the latest revision.',409);
  const event=this.addEvent(id,state,result.type,result.message,result.payload,result.matchId);return {state,event};
 });}
 events(id,{before=0,after=0,limit=200,all=false}={}) {
  this.get(id);
  const rows=all?this.db.prepare('SELECT * FROM events WHERE tournament_id=? ORDER BY id').all(id):after?this.db.prepare('SELECT * FROM events WHERE tournament_id=? AND id>? ORDER BY id ASC LIMIT ?').all(id,after,limit):this.db.prepare('SELECT * FROM events WHERE tournament_id=? AND (?=0 OR id<?) ORDER BY id DESC LIMIT ?').all(id,before,before,limit);
  const events=rows.map(r=>({id:r.id,uuid:r.uuid,tournamentId:r.tournament_id,revision:r.revision,type:r.type,message:r.message,matchId:r.match_id,matchUuid:r.match_uuid,payload:JSON.parse(r.payload_json),createdAt:r.created_at}));return all||after?events:events.reverse();
 }
 managerAccess(id){const row=this.db.prepare('SELECT * FROM manager_access WHERE tournament_id=?').get(id);return row?{salt:row.salt,hash:row.password_hash,version:row.version,enabled:!!row.enabled}:null;}
 setManagerAccess(id,credentials){const previous=this.managerAccess(id),version=(previous?.version||0)+1;this.db.prepare('INSERT INTO manager_access(tournament_id,salt,password_hash,version,enabled) VALUES(?,?,?,?,?) ON CONFLICT(tournament_id) DO UPDATE SET salt=excluded.salt,password_hash=excluded.password_hash,version=excluded.version,enabled=excluded.enabled').run(id,credentials?.salt||'',credentials?.hash||'',version,credentials?1:0);return {enabled:!!credentials,version};}
 close(){this.db.close();}
}
export function commandDescription(command,state) {
 const m=state.matches.find(m=>m.id===command.matchId),names=m?m.players.map(id=>state.players.find(p=>p.id===id)?.name||'TBD'):[];
 switch(command.type){
  case 'start':return `${state.playerCount}-player tournament started · ${state.matches.length} matches`;
  case 'assign':return `${names.join(' vs ')} called to Machine ${command.machineId}`;
  case 'unassign':return `${m.id.toUpperCase()} returned to queue · clock paused`;
  case 'score':return `${m.id.toUpperCase()} · ${names[0]} ${m.score[0]}–${m.score[1]} ${names[1]} · leg scores updated`;
  case 'finish':return `${m.id.toUpperCase()} finished ${m.score.join('–')} · winner advances ${m.winnerTo?'to '+m.winnerTo.matchId.toUpperCase():'as champion'}`;
  case 'announce':return `Announcement: ${state.announcement.text}`;
  case 'clear-announcement':return 'Viewer announcement cleared';
  case 'undo':return 'Last action undone · event log retained';
  case 'match-settings':return `${m.id.toUpperCase()} player names / match settings updated`;
  default:return `${command.type.replaceAll('-',' ')} updated`;
 }
}
export function commandPayload(command) {const allowed=['type','modelId','names','title','matchId','machineId','score','legs','players','target','targets','plannedMachineId','enabled','intervalSeconds','text','seconds'];return Object.fromEntries(allowed.filter(k=>command[k]!==undefined).map(k=>[k,command[k]]));}
