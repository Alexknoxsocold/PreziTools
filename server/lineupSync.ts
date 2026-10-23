import type { IStorage } from './storage';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

interface APISportsTeam { id: number; name: string; code: string }
interface APISportsPlayer { id: number; name: string; pos: string }
interface APISportsLineup { team: APISportsTeam; formation: string; startingLineups: APISportsPlayer[] }
interface APISportsGame { id: number; league: { name: string }; teams: { away: APISportsTeam; home: APISportsTeam }; lineups?: { away: APISportsLineup; home: APISportsLineup } }
interface APISportsResponse { response: APISportsGame[] }
type ConfirmedLineup = { away: string[]; home: string[]; source: 'espn' | 'api-sports' | 'nba.com' };

let lastNbaDailyLineupProbeDate = '';
async function probeNbaDailyLineups(dateKey: string): Promise<void> {
  if (lastNbaDailyLineupProbeDate === dateKey) return;
  lastNbaDailyLineupProbeDate = dateKey;
  const url = `https://stats.nba.com/js/data/leaders/00_daily_lineups_${dateKey}.json`;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PreziTools/1.0)',
        'Referer': 'https://www.nba.com/',
        'Origin': 'https://www.nba.com',
        'Accept': 'application/json, text/plain, */*'
      },
      signal: AbortSignal.timeout(6000)
    });
    const contentType = response.headers.get('content-type') || 'unknown';
    if (!response.ok) {
      console.log(`[NBA Daily Lineups Probe] ${dateKey}: HTTP ${response.status}; content-type=${contentType}. No lineup data used.`);
      return;
    }
    const payload: any = await response.json();
    const topKeys = payload && typeof payload === 'object' ? Object.keys(payload).slice(0, 20).join(',') : typeof payload;
    const arrays = payload && typeof payload === 'object'
      ? Object.entries(payload).filter(([, value]) => Array.isArray(value)).map(([key, value]) => `${key}=${(value as unknown[]).length}`).join(',')
      : '';
    const firstArray = payload && typeof payload === 'object' ? Object.entries(payload).find(([, value]) => Array.isArray(value) && value.length > 0) : undefined;
    const firstItem = firstArray ? (firstArray[1] as unknown[])[0] : undefined;
    const entryKeys = firstItem && typeof firstItem === 'object' ? Object.keys(firstItem).slice(0, 30).join(',') : 'none';
    const nestedKeys = firstItem && typeof firstItem === 'object'
      ? Object.entries(firstItem).filter(([, value]) => value && typeof value === 'object').map(([key, value]) => Array.isArray(value) ? key + '[array:' + value.length + (value[0] && typeof value[0] === 'object' ? ';itemKeys:' + Object.keys(value[0]).slice(0, 12).join('|') : '') + ']' : key + '{' + Object.keys(value as object).slice(0, 12).join('|') + '}').slice(0, 15).join(';')
      : 'none';
    const teamDiagnostics = firstItem && typeof firstItem === 'object'
      ? ['homeTeam', 'awayTeam'].map((key) => {
          const team = (firstItem as any)[key];
          const players = Array.isArray(team?.players) ? team.players : [];
          const firstPlayerKeys = players[0] && typeof players[0] === 'object' ? Object.keys(players[0]).slice(0, 20).join('|') : 'none';
          const statusCounts = new Map<string, number>();
          for (const player of players) {
            const status = String(player?.lineupStatus ?? 'missing');
            statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
          }
          const statuses = [...statusCounts.entries()].map(([status, count]) => status + '=' + count).join('|') || 'none';
          const timestampSample = players[0]?.timestamp == null ? 'missing' : String(players[0].timestamp);
          return key + ':players=' + players.length + ';playerKeys=' + firstPlayerKeys + ';lineupStatusCounts=' + statuses + ';timestampSample=' + timestampSample;
        }).join(';')
      : 'none';
    const statusSummary = firstItem && typeof firstItem === 'object'
      ? 'gameStatus=' + String((firstItem as any).gameStatus ?? 'unknown') + ';gameStatusText=' + String((firstItem as any).gameStatusText ?? 'unknown')
      : 'unknown';
    console.log(`[NBA Daily Lineups Probe] ${dateKey}: HTTP ${response.status}; keys=${topKeys}; arrays=${arrays || 'none'}; firstArray=${firstArray?.[0] || 'none'}; entryKeys=${entryKeys}; nested=${nestedKeys || 'none'}; ${statusSummary}; ${teamDiagnostics}. Probe only; no lineup data used until schema is verified.`);
  } catch (error) {
    console.log(`[NBA Daily Lineups Probe] ${dateKey}: unavailable (${error instanceof Error ? error.message : String(error)}); no lineup data used.`);
  }
}


function nbaSeasonFor(date = new Date()): string { const y=date.getUTCFullYear(), m=date.getUTCMonth()+1, s=m>=7?y:y-1; return `${s}-${s+1}`; }
function normalizeTeam(raw: string): string { const v=raw.toUpperCase().trim(); const m:Record<string,string>={GSW:'GS',NOP:'NO',NYK:'NY',SAS:'SA',PHO:'PHX',UTA:'UTAH',WSH:'WAS'}; return m[v]||v; }
function cleanFive(names: string[]): string[] | null { const u=[...new Map(names.map(n=>[n.toLowerCase().replace(/[^a-z0-9]/g,''),n.trim()])).values()].filter(Boolean); return u.length===5?u:null; }

async function ensureLineupStateTable(): Promise<void> {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS nba_lineup_state (
    espn_game_id text PRIMARY KEY, away_team text NOT NULL, home_team text NOT NULL,
    away_starters text[] NOT NULL, home_starters text[] NOT NULL,
    status text NOT NULL CHECK (status IN ('confirmed')), source text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
}

async function fetchEspnConfirmedLineup(id:string, awayTeam:string, homeTeam:string):Promise<ConfirmedLineup|null>{
  try { const r=await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${id}`,{signal:AbortSignal.timeout(8000)}); if(!r.ok)return null; const d:any=await r.json(); const by=new Map<string,string[]>();
    for(const tb of d?.boxscore?.players||[]){const team=normalizeTeam(String(tb?.team?.abbreviation||'')); const names:string[]=[]; for(const g of tb?.statistics||[])for(const row of g?.athletes||[]){if(row?.starter!==true||row?.didNotPlay===true)continue; const n=String(row?.athlete?.displayName||'').trim(); if(n)names.push(n);} const five=cleanFive(names); if(team&&five)by.set(team,five);} const away=by.get(normalizeTeam(awayTeam)),home=by.get(normalizeTeam(homeTeam)); return away&&home?{away,home,source:'espn'}:null;
  } catch{return null;}
}

async function fetchNbaDailyConfirmedLineup(dateKey: string, awayTeam: string, homeTeam: string): Promise<ConfirmedLineup | null> {
  try {
    const response = await fetch(`https://stats.nba.com/js/data/leaders/00_daily_lineups_${dateKey}.json`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PreziTools/1.0)', 'Referer': 'https://www.nba.com/', 'Origin': 'https://www.nba.com', 'Accept': 'application/json, text/plain, */*' },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;
    const payload: any = await response.json();
    const games = Array.isArray(payload?.games) ? payload.games : [];
    for (const game of games) {
      if (normalizeTeam(String(game?.awayTeam?.teamAbbreviation ?? '')) !== normalizeTeam(awayTeam) || normalizeTeam(String(game?.homeTeam?.teamAbbreviation ?? '')) !== normalizeTeam(homeTeam)) continue;
      const confirmedNames = (team: any): string[] => (Array.isArray(team?.players) ? team.players : [])
        .filter((player: any) => {
          const status = String(player?.lineupStatus ?? '').trim().toLowerCase();
          const timestamp = String(player?.timestamp ?? '');
          return (status === 'confirmed' || status === 'confirmed starter') && timestamp.startsWith(`${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`);
        })
        .map((player: any) => String(player?.playerName ?? [player?.firstName, player?.lastName].filter(Boolean).join(' ')).trim())
        .filter(Boolean);
      const away = cleanFive(confirmedNames(game.awayTeam));
      const home = cleanFive(confirmedNames(game.homeTeam));
      if (away && home) return { away, home, source: 'nba.com' };
    }
    return null;
  } catch (error) {
    console.warn('[LineupSync] NBA.com confirmed-lineup fallback unavailable:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

export class LineupSync {
  private apiUrl='https://v1.basketball.api-sports.io'; private apiKey:string|undefined;
  constructor(private storage:IStorage){this.apiKey=process.env.APISPORTS_KEY?.trim()||undefined;}
  private async runFirstBasketLockPass(){try{const {lockUpcomingFirstBasketPredictions}=await import('./fbPredictionLedger.js'); const r=await lockUpcomingFirstBasketPredictions(); if(r.locked||r.eligible)console.log(`[FB Ledger] Daytime lock pass: ${r.locked} locked, ${r.eligible} eligible, ${r.skipped} skipped.`);}catch(e){console.warn('[FB Ledger] Daytime lock pass failed:',e);}}
  private async saveObservedLiveLineup(game:any,lineup:ConfirmedLineup){
    // Live box-score starters are accurate for display after tipoff, but must never
    // be written to the pregame-confirmed ledger used to lock predictions.
    await this.storage.updateGame(game.id,{awayStarters:lineup.away,homeStarters:lineup.home});
    console.log(`[LineupSync] Observed live ${game.awayTeam} @ ${game.homeTeam} starters via ESPN box score; pregame confirmation state unchanged.`);
  }
  private async saveConfirmedLineup(game:any,lineup:ConfirmedLineup){
    await this.storage.updateGame(game.id,{awayStarters:lineup.away,homeStarters:lineup.home});
    if(pool&&game.espnGameId){await ensureLineupStateTable(); await pool.query(`INSERT INTO nba_lineup_state (espn_game_id,away_team,home_team,away_starters,home_starters,status,source,updated_at) VALUES ($1,$2,$3,$4,$5,'confirmed',$6,now()) ON CONFLICT (espn_game_id) DO UPDATE SET away_team=EXCLUDED.away_team,home_team=EXCLUDED.home_team,away_starters=EXCLUDED.away_starters,home_starters=EXCLUDED.home_starters,status='confirmed',source=EXCLUDED.source,updated_at=now()`,[game.espnGameId,game.awayTeam,game.homeTeam,lineup.away,lineup.home,lineup.source]);}
    console.log(`[LineupSync] Confirmed ${game.awayTeam} @ ${game.homeTeam} starters via ${lineup.source}.`);
  }
  private async ensureEspnScheduleGames():Promise<any[]>{
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const y=parts.find(p=>p.type==='year')?.value,m=parts.find(p=>p.type==='month')?.value,d=parts.find(p=>p.type==='day')?.value;
    const dateISO=`${y}-${m}-${d}`;
    const dateKey=dateISO.replace(/-/g,'');
    await probeNbaDailyLineups(dateKey);
    try{
      const response=await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateKey}`,{headers:{'User-Agent':'PreziTools/1.0'},signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw new Error(`ESPN scoreboard status ${response.status}`);
      const data:any=await response.json();
      const stored=await this.storage.getGames();
      for(const event of data?.events||[]){
        const comp=event?.competitions?.[0], competitors=comp?.competitors||[];
        const home=competitors.find((c:any)=>c.homeAway==='home'),away=competitors.find((c:any)=>c.homeAway==='away');
        if(!event?.id||!home?.team?.abbreviation||!away?.team?.abbreviation)continue;
        const exists=stored.some(g=>String(g.espnGameId||'')===String(event.id));
        if(exists)continue;
        await this.storage.createGame({
          awayTeam:away.team.abbreviation,awayPlayer:'TBD',awayTipCount:0,awayTipPercent:50,awayScorePercent:50,awayStarters:[],
          homeTeam:home.team.abbreviation,homePlayer:'TBD',homeTipCount:0,homeTipPercent:50,homeScorePercent:50,homeStarters:[],
          h2h:'N/A',gameDate:dateISO,gameTime:event.date,status:'scheduled',espnGameId:String(event.id),lastSynced:new Date().toISOString()
        });
        console.log(`[FB Schedule] Added ESPN game ${away.team.abbreviation} @ ${home.team.abbreviation} (${event.id}) for ${dateISO}.`);
      }
    }catch(error){console.warn('[FB Schedule] ESPN schedule refresh failed; retaining stored games:',error);}
    const allGames=await this.storage.getGames();
    return allGames.filter(g=>{
      if(g.gameDate===dateISO||g.gameDate==='Today')return true;
      if(!g.gameTime)return false;
      const gameParts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(g.gameTime));
      return gameParts===dateISO;
    });
  }
  async syncStartingLineups():Promise<void>{
    // Create the confirmed-lineup state table before the prediction lock pass queries it.
    // Otherwise an empty table is mistaken for a missing lineup and every lock is skipped.
    await ensureLineupStateTable();
    const todayGames=await this.ensureEspnScheduleGames();
    const lineupDateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/-/g, '');
    for(const game of todayGames){
      if(!game.espnGameId||game.status==='completed')continue;
      const tipoff=game.gameTime?new Date(game.gameTime).getTime():NaN;
      if(!Number.isFinite(tipoff))continue;
      const started=tipoff<=Date.now();
      if(started){
        // Once tipoff has passed, the ESPN box score is the best source for the
        // actual five starters. Keep these names visible, but do not promote them
        // into the pregame-confirmed ledger or lock/rewrite any prediction.
        const live=await fetchEspnConfirmedLineup(game.espnGameId,game.awayTeam,game.homeTeam);
        if(live)await this.saveObservedLiveLineup(game,live);
        else console.log(`[LineupSync] ${game.awayTeam} @ ${game.homeTeam}: waiting for ESPN live box-score starter flags; no post-tipoff names written as confirmed.`);
        continue;
      }
      let l=await fetchEspnConfirmedLineup(game.espnGameId,game.awayTeam,game.homeTeam);
      if(!l)l=await fetchNbaDailyConfirmedLineup(lineupDateKey,game.awayTeam,game.homeTeam);
      if(l)await this.saveConfirmedLineup(game,l);
      else console.log(`[LineupSync] ${game.awayTeam} @ ${game.homeTeam}: no source has exposed five explicitly confirmed starters per team yet.`);
    }
    if(this.apiKey){try{const now=new Date(),today=now.toISOString().split('T')[0],season=nbaSeasonFor(now); const r=await fetch(`${this.apiUrl}/games?date=${today}&league=12&season=${encodeURIComponent(season)}`,{headers:{'x-apisports-key':this.apiKey},signal:AbortSignal.timeout(8000)}); if(!r.ok)throw new Error(`API-Sports.io responded with status ${r.status}`); const d:APISportsResponse=await r.json(); for(const ag of d.response||[]){const a=normalizeTeam(ag.teams.away.code),h=normalizeTeam(ag.teams.home.code),game=todayGames.find(g=>normalizeTeam(g.awayTeam)===a&&normalizeTeam(g.homeTeam)===h); if(!game||!game.gameTime||new Date(game.gameTime).getTime()<=Date.now()||!ag.lineups?.away?.startingLineups||!ag.lineups?.home?.startingLineups)continue; const away=cleanFive(ag.lineups.away.startingLineups.map(p=>p.name)),home=cleanFive(ag.lineups.home.startingLineups.map(p=>p.name)); if(away&&home)await this.saveConfirmedLineup(game,{away,home,source:'api-sports'});}}catch(e){console.warn('[LineupSync] API-Sports refresh failed; retaining any ESPN-confirmed lineup:',e);}}
    else console.log('[LineupSync] APISPORTS_KEY not configured; using ESPN and explicit NBA.com confirmation sources.');
    await this.runFirstBasketLockPass();
  }
}
