import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor=ws;
const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL}):null;
let ready:Promise<void>|null=null;

export type FrozenSport='NFL'|'NBA'|'WNBA'|'MLB'|'NHL';
export type FrozenDisplaySnapshot<T=unknown>={
  sport:FrozenSport;slateDate:string;eventId:string;gameStartAt:string;market:string;
  modelVersion:string;payload:T;capturedAt:string;sourceUpdatedAt:string|null;
};
export type FrozenDisplayInput<T=unknown>=Omit<FrozenDisplaySnapshot<T>,'capturedAt'>;

function ensure(){
  if(ready)return ready;
  if(!pool)return Promise.resolve();
  ready=pool.query(`CREATE TABLE IF NOT EXISTS frozen_display_snapshots(
    id text PRIMARY KEY,sport text NOT NULL,slate_date date NOT NULL,event_id text NOT NULL,
    game_start_at timestamptz NOT NULL,market text NOT NULL,model_version text NOT NULL,
    payload jsonb NOT NULL,source_updated_at timestamptz,captured_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(sport,event_id,market,model_version)
  );CREATE INDEX IF NOT EXISTS frozen_display_slate_idx ON frozen_display_snapshots(sport,slate_date,game_start_at);
  CREATE INDEX IF NOT EXISTS frozen_display_event_idx ON frozen_display_snapshots(sport,event_id,market);`).then(()=>{}).catch(error=>{ready=null;throw error});
  return ready;
}
function clean(v:string){return v.trim().replace(/[^a-zA-Z0-9_.:-]/g,'_').slice(0,180)}
function idFor(x:FrozenDisplayInput){return`${x.sport}:${clean(x.eventId)}:${clean(x.market)}:${clean(x.modelVersion)}`}
function validDate(v:string){const time=new Date(v).getTime();return Number.isFinite(time)?time:null}

/**
 * Saves the latest legitimate pregame display payload. The row can update only
 * while the event is still in the future; it becomes immutable at game start.
 */
export async function freezeDisplaySnapshot<T>(input:FrozenDisplayInput<T>):Promise<boolean>{
  if(!pool)return false;
  const start=validDate(input.gameStartAt),source=input.sourceUpdatedAt?validDate(input.sourceUpdatedAt):null;
  if(start===null||start<=Date.now())return false;
  if(source!==null&&source>start)return false;
  await ensure();
  const result=await pool.query(`INSERT INTO frozen_display_snapshots(
    id,sport,slate_date,event_id,game_start_at,market,model_version,payload,source_updated_at,captured_at
  ) VALUES($1,$2,$3::date,$4,$5,$6,$7,$8::jsonb,$9,now())
  ON CONFLICT(sport,event_id,market,model_version) DO UPDATE SET
    slate_date=EXCLUDED.slate_date,game_start_at=EXCLUDED.game_start_at,payload=EXCLUDED.payload,
    source_updated_at=EXCLUDED.source_updated_at,captured_at=now()
  WHERE frozen_display_snapshots.game_start_at>now()
  RETURNING id`,[idFor(input),input.sport,input.slateDate,input.eventId,new Date(start),input.market,input.modelVersion,JSON.stringify(input.payload),source===null?null:new Date(source)]);
  return Boolean(result.rowCount);
}

export async function listFrozenDisplaySnapshots<T=unknown>(sport:FrozenSport,slateDate:string,market?:string):Promise<FrozenDisplaySnapshot<T>[]>{
  if(!pool)return[];
  await ensure();
  const result=await pool.query(`SELECT sport,slate_date::text,event_id,game_start_at,market,model_version,payload,source_updated_at,captured_at
    FROM frozen_display_snapshots WHERE sport=$1 AND slate_date=$2::date AND ($3::text IS NULL OR market=$3)
    ORDER BY game_start_at,event_id,market`,[sport,slateDate,market??null]);
  return result.rows.map(row=>({sport:row.sport,slateDate:row.slate_date,eventId:String(row.event_id),gameStartAt:new Date(row.game_start_at).toISOString(),market:String(row.market),modelVersion:String(row.model_version),payload:row.payload as T,sourceUpdatedAt:row.source_updated_at?new Date(row.source_updated_at).toISOString():null,capturedAt:new Date(row.captured_at).toISOString()}));
}

export async function frozenDisplaySummary(days=30){
  if(!pool)return{database:false,days,snapshots:0,bySport:[]};
  await ensure();
  const safe=Math.max(1,Math.min(365,Math.round(days)));
  const result=await pool.query(`SELECT sport,market,count(*)::int snapshots,count(DISTINCT event_id)::int events,
    min(captured_at) first_capture,max(captured_at) last_capture
    FROM frozen_display_snapshots WHERE slate_date>=((now() AT TIME ZONE 'America/New_York')::date-$1::int)
    GROUP BY sport,market ORDER BY sport,market`,[safe]);
  return{database:true,days:safe,snapshots:result.rows.reduce((sum,row)=>sum+Number(row.snapshots),0),bySport:result.rows};
}
