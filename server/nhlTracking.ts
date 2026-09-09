export const NHL_LEDGER_VERSION='nhl-v1-ledger';
export type NhlTrackedMarket='anytime-goal'|'first-goal'|'moneyline';
export type NhlTrackedPrediction={id:string;eventId:string;eventDate:string;market:NhlTrackedMarket;selection:string;team?:string;opponent?:string;americanOdds:number;bookmaker:string;modelProbability:number;marketProbability:number;edgePoints:number;expectedValue:number;modelVersion:string;recordedAt:string;status:'pending'|'won'|'lost'|'push'|'void';gradedAt?:string};
const ledger=new Map<string,NhlTrackedPrediction>();
function key(p:Pick){return[p.eventId,p.market,p.selection,p.modelVersion].join('|').toLowerCase()}
type Pick=Omit<NhlTrackedPrediction,'id'|'recordedAt'|'status'>;
export function recordNhlPrediction(p:Pick){const k=key(p),existing=ledger.get(k);if(existing)return existing;const recordedAt=new Date().toISOString();const row:NhlTrackedPrediction={...p,id:`nhl-${Buffer.from(k).toString('base64url').slice(0,40)}`,recordedAt,status:'pending'};ledger.set(k,row);return row}
export function listNhlPredictions(){return[...ledger.values()].sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt))}
export function gradeNhlPrediction(id:string,status:'won'|'lost'|'push'|'void'){const row=ledger.get([...ledger.entries()].find(([,v])=>v.id===id)?.[0]??'');if(!row||row.status!=='pending')return row??null;row.status=status;row.gradedAt=new Date().toISOString();return row}
export function nhlLedgerSummary(){const rows=listNhlPredictions(),graded=rows.filter(r=>r.status!=='pending'),won=graded.filter(r=>r.status==='won').length,lost=graded.filter(r=>r.status==='lost').length;return{version:NHL_LEDGER_VERSION,total:rows.length,pending:rows.length-graded.length,graded:graded.length,won,lost,hitRate:won+lost?+((won/(won+lost))*100).toFixed(1):null,rows}}
