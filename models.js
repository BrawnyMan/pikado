import model16 from './models/16.json' with { type: 'json' };
import model32 from './models/32.json' with { type: 'json' };
export const models = [model16, model32];
for(const model of models) {
  if(model.format!=='single-elimination'||![16,32].includes(model.playerCount)||model.id!==`single-${model.playerCount}`||model.roundNames.length!==Math.log2(model.playerCount)||model.defaultTargets.length!==model.roundNames.length||!model.defaultTargets.every(n=>Number.isInteger(n)&&n>=1&&n<=9))throw new Error('Invalid tournament model JSON.');
}
export function getModel(id) {
  const model=models.find(m=>m.id===id);
  if(!model)throw new Error('Choose a 16-player or 32-player knockout model.');
  return model;
}
export function targetsForModel(targets,model) {
  return model.roundNames.map((_,i)=>targets[i+targets.length-model.roundNames.length]??model.defaultTargets[i]);
}
export function createMatches(model,players,targets) {
  const matches=[];
  for(let round=0;round<model.roundNames.length;round++) {
    const count=model.playerCount/(2**(round+1)),target=targets[round];
    for(let i=0;i<count;i++)matches.push({id:`r${round+1}-${i+1}`,round:round+1,order:i+1,
      players:round===0?[players[i*2].id,players[i*2+1].id]:[null,null],
      sources:round===0?[{playerId:players[i*2].id},{playerId:players[i*2+1].id}]:[0,1].map(slot=>({matchId:`r${round}-${i*2+slot+1}`,outcome:'winner'})),
      score:[0,0],target,legs:Array.from({length:target*2-1},()=>({score:[null,null],winnerId:null})),
      status:round===0?'ready':'waiting',machineId:null,plannedMachineId:null,machineHistory:[],timing:{elapsedMs:0,runningSince:null},winnerId:null,
      winnerTo:round<model.roundNames.length-1?{matchId:`r${round+2}-${Math.floor(i/2)+1}`,slot:i%2}:null,loserTo:null});
  }
  return matches;
}
