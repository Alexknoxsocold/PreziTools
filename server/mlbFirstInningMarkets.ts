import { propLineGet } from './propLineClient.js';
import { filterRfiMarketQuotes, hasCoherentTwoWayPrice } from './mlbMarketIntegrity.js';

const MARKET_CACHE_MS = 10 * 60 * 1000;

export type FirstInningBookQuote = {
  bookmaker: string;
  bookmakerKey: string;
  selection: 'NRFI' | 'YRFI';
  americanOdds: number;
  impliedProbability: number;
  updatedAt: string | null;
};

export type FirstInningMarket = {
  selection: 'NRFI' | 'YRFI';
  price: number;
  book: string;
  impliedProbability: number;
  noVigProbability: number;
  edge: number;
  ev: number;
  quotes: FirstInningBookQuote[];
  quoteCount: number;
  capturedAt: string;
};

export type FirstInningMarketFeed = {
  status: 'live' | 'unavailable' | 'disabled';
  source: 'PropLine';
  gamesMatched: number;
  markets: Map<string, { NRFI?: FirstInningMarket; YRFI?: FirstInningMarket }>;
};

type GameInput = { id: string; gameTime: string; awayName: string; homeName: string; nrfiProbability: number };
type PropLineEvent = { id?: string | number; event_id?: string | number; home_team?: string; away_team?: string; commence_time?: string };
type PropLineOutcome = { name?: string; price?: number; point?: number | null; book_updated_at?: string | null; last_change_at?: string | null };
type PropLineMarket = { key?: string; period?: string | null; team?: string | null; outcomes?: PropLineOutcome[] };
type PropLineBookmaker = { key?: string; title?: string; last_update?: string | null; markets?: PropLineMarket[] };
type PropLineOdds = { id?: string | number; event_id?: string | number; bookmakers?: PropLineBookmaker[] };

let cache: { key: string; expiresAt: number; value: FirstInningMarketFeed } | null = null;

function normalize(value: string): string { return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ''); }
function americanImplied(odds: number): number { if (!Number.isFinite(odds) || odds === 0) return NaN; return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100); }
function expectedValue(probability: number, odds: number): number { if (!Number.isFinite(probability) || !Number.isFinite(odds) || odds === 0) return NaN; const profit=odds>0?odds/100:100/Math.abs(odds); return (probability*profit-(1-probability))*100; }
function median(values: number[]): number { if (!values.length) return NaN; const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2); return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2; }
function asEvents(payload: unknown): PropLineEvent[] { if(Array.isArray(payload))return payload as PropLineEvent[]; if(payload&&typeof payload==='object'){const row=payload as Record<string,unknown>;if(Array.isArray(row.events))return row.events as PropLineEvent[];if(Array.isArray(row.data))return row.data as PropLineEvent[];}return []; }
function asOdds(payload: unknown): PropLineOdds[] { if(Array.isArray(payload))return payload as PropLineOdds[];if(payload&&typeof payload==='object'){const row=payload as Record<string,unknown>;if(Array.isArray(row.events))return row.events as PropLineOdds[];if(Array.isArray(row.data))return row.data as PropLineOdds[];return[payload as PropLineOdds];}return []; }
function eventMatches(game:GameInput,event:PropLineEvent):boolean{const home=normalize(event.home_team??''),away=normalize(event.away_team??''),gameHome=normalize(game.homeName),gameAway=normalize(game.awayName);if(!home||!away||!gameHome||!gameAway)return false;const teamsMatch=(home===gameHome||home.includes(gameHome)||gameHome.includes(home))&&(away===gameAway||away.includes(gameAway)||gameAway.includes(away));if(!teamsMatch)return false;if(!event.commence_time)return true;const eventTime=new Date(event.commence_time).getTime(),gameTime=new Date(game.gameTime).getTime();return !Number.isFinite(eventTime)||!Number.isFinite(gameTime)||Math.abs(eventTime-gameTime)<=3*60*60*1000;}

function dedupeBestByBook(quotes: FirstInningBookQuote[]): FirstInningBookQuote[] {
  const byBook = new Map<string, FirstInningBookQuote>();
  for (const quote of quotes) {
    const key = (quote.bookmakerKey || quote.bookmaker).toLowerCase();
    const existing = byBook.get(key);
    if (!existing || quote.americanOdds > existing.americanOdds) byBook.set(key, quote);
  }
  return [...byBook.values()].sort((a,b)=>b.americanOdds-a.americanOdds);
}

function verifiedQuotesForSide(quotes: FirstInningBookQuote[], oppositeQuotes: FirstInningBookQuote[], now: Date): FirstInningBookQuote[] {
  const oppositeByBook = new Map(oppositeQuotes.map(quote => [(quote.bookmakerKey || quote.bookmaker).toLowerCase(), quote]));
  const coherent = quotes.filter(quote => {
    const opposite = oppositeByBook.get((quote.bookmakerKey || quote.bookmaker).toLowerCase());
    return !opposite || hasCoherentTwoWayPrice(quote.americanOdds, opposite.americanOdds);
  });
  return filterRfiMarketQuotes(coherent, now);
}

function readQuotes(payload: unknown, expectedEventId: string): { NRFI: FirstInningBookQuote[]; YRFI: FirstInningBookQuote[] } {
  const result: { NRFI: FirstInningBookQuote[]; YRFI: FirstInningBookQuote[] } = { NRFI: [], YRFI: [] };
  for (const event of asOdds(payload)) {
    const returnedEventId = event.id ?? event.event_id;
    if (returnedEventId !== undefined && returnedEventId !== null && String(returnedEventId) !== expectedEventId) continue;
    for (const book of event.bookmakers ?? []) {
      for (const market of book.markets ?? []) {
        if (market.key !== 'totals' || market.period !== 'i1' || market.team) continue;
        for (const outcome of market.outcomes ?? []) {
          const point = Number(outcome.point);
          if (!Number.isFinite(point) || Math.abs(point - 0.5) > 0.001) continue;
          const name = String(outcome.name ?? '').toLowerCase();
          const selection: 'NRFI' | 'YRFI' | null = name === 'under' ? 'NRFI' : name === 'over' ? 'YRFI' : null;
          const americanOdds = Number(outcome.price);
          if (!selection || !Number.isFinite(americanOdds) || americanOdds === 0) continue;
          const impliedProbability = americanImplied(americanOdds);
          if (!Number.isFinite(impliedProbability)) continue;
          result[selection].push({ bookmaker:String(book.title??book.key??'Sportsbook'), bookmakerKey:String(book.key??''), selection, americanOdds, impliedProbability, updatedAt:outcome.book_updated_at??outcome.last_change_at??book.last_update??null });
        }
      }
    }
  }
  return { NRFI: dedupeBestByBook(result.NRFI), YRFI: dedupeBestByBook(result.YRFI) };
}

function buildSideMarket(selection:'NRFI'|'YRFI',quotes:FirstInningBookQuote[],oppositeQuotes:FirstInningBookQuote[],modelProbabilityPct:number,now:Date):FirstInningMarket|undefined{const verified=verifiedQuotesForSide(quotes,oppositeQuotes,now),verifiedOpposite=verifiedQuotesForSide(oppositeQuotes,quotes,now);if(!verified.length)return undefined;const best=[...verified].sort((a,b)=>b.americanOdds-a.americanOdds)[0],sideConsensus=median(verified.map(q=>q.impliedProbability)),oppositeConsensus=median(verifiedOpposite.map(q=>q.impliedProbability));let noVig=sideConsensus;if(Number.isFinite(sideConsensus)&&Number.isFinite(oppositeConsensus)&&sideConsensus+oppositeConsensus>0)noVig=sideConsensus/(sideConsensus+oppositeConsensus);const modelProbability=Math.max(0,Math.min(1,modelProbabilityPct/100)),edge=(modelProbability-noVig)*100,ev=expectedValue(modelProbability,best.americanOdds);return{selection,price:best.americanOdds,book:best.bookmaker,impliedProbability:best.impliedProbability*100,noVigProbability:noVig*100,edge,ev,quotes:[...verified].sort((a,b)=>b.americanOdds-a.americanOdds),quoteCount:verified.length,capturedAt:best.updatedAt!};}

function pregameOnly(feed:FirstInningMarketFeed,games:GameInput[],now:Date):FirstInningMarketFeed{const pregameIds=new Set(games.filter(game=>new Date(game.gameTime).getTime()>now.getTime()).map(game=>game.id)),markets=new Map([...feed.markets].filter(([gameId])=>pregameIds.has(gameId)));return{...feed,status:markets.size?'live':'unavailable',markets};}

export async function fetchFirstInningMarkets(games:GameInput[]):Promise<FirstInningMarketFeed>{const apiKey=process.env.PROPLINE_API_KEY?.trim();if(!apiKey)return{status:'disabled',source:'PropLine',gamesMatched:0,markets:new Map()};if(!games.length)return{status:'live',source:'PropLine',gamesMatched:0,markets:new Map()};const now=new Date(),pregameGames=games.filter(game=>new Date(game.gameTime).getTime()>now.getTime()),cacheKey=games.map(g=>`${g.id}:${g.gameTime}:${g.nrfiProbability}`).sort().join('|');if(cache&&cache.key===cacheKey&&cache.expiresAt>Date.now())return pregameOnly(cache.value,games,now);if(!pregameGames.length)return{status:'unavailable',source:'PropLine',gamesMatched:0,markets:new Map()};try{const events=asEvents(await propLineGet<unknown>('/sports/baseball_mlb/events',{cacheMs:20*60*1000})),pairs=pregameGames.map(game=>({game,event:events.find(event=>eventMatches(game,event))})).filter((x):x is {game:GameInput;event:PropLineEvent}=>Boolean(x.event)),markets=new Map<string,{NRFI?:FirstInningMarket;YRFI?:FirstInningMarket}>();await Promise.all(pairs.map(async({game,event})=>{const eventId=event.id??event.event_id;if(eventId===undefined||eventId===null)return;const expectedEventId=String(eventId);try{const payload=await propLineGet<unknown>(`/sports/baseball_mlb/events/${encodeURIComponent(expectedEventId)}/odds?markets=totals&period=i1`,{cacheMs:MARKET_CACHE_MS}),quotes=readQuotes(payload,expectedEventId);const books=[...new Set([...quotes.NRFI,...quotes.YRFI].map(q=>q.bookmaker))];console.log(`[MLB NRFI][PropLine] ${game.awayName} @ ${game.homeName}: ${books.length} i1 book(s)`,books);const nrfi=buildSideMarket('NRFI',quotes.NRFI,quotes.YRFI,game.nrfiProbability,now),yrfi=buildSideMarket('YRFI',quotes.YRFI,quotes.NRFI,100-game.nrfiProbability,now);if(nrfi||yrfi)markets.set(game.id,{NRFI:nrfi,YRFI:yrfi});}catch(error){console.warn(`[MLB NRFI] PropLine first-inning odds unavailable for ${game.id}:`,error);}}));const value:FirstInningMarketFeed={status:markets.size?'live':'unavailable',source:'PropLine',gamesMatched:pairs.length,markets};cache={key:cacheKey,expiresAt:Date.now()+MARKET_CACHE_MS,value};return pregameOnly(value,games,now);}catch(error){console.warn('[MLB NRFI] PropLine market feed unavailable:',error);const value:FirstInningMarketFeed={status:'unavailable',source:'PropLine',gamesMatched:0,markets:new Map()};cache={key:cacheKey,expiresAt:Date.now()+5*60*1000,value};return value;}}
