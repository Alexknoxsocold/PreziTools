type SlateGame = { id:string; awayTeam:string; homeTeam:string; status:string };
type Slate = { games?: SlateGame[] };

const norm=(v:string)=>v.toUpperCase().replace(/[^A-Z0-9]/g,'');
const canonical=(v:string)=>({GSV:'GS',LVA:'LV',LAS:'LA',NYL:'NY',WAS:'WSH',PHO:'PHX'} as Record<string,string>)[norm(v)]||norm(v);

async function verifiedTipWinner(gameId:string):Promise<string|null>{
  try{
    const r=await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=${encodeURIComponent(gameId)}`);
    if(!r.ok)return null;
    const body:any=await r.json();
    const plays=[...(body?.plays||[])].sort((a:any,b:any)=>Number(a?.sequenceNumber??a?.id??0)-Number(b?.sequenceNumber??b?.id??0));
    const jump=plays.find((p:any)=>/jump ball/i.test(String(p?.text||'')));
    if(!jump)return null;
    const direct=canonical(String(jump?.team?.abbreviation||jump?.team?.shortDisplayName||''));
    if(direct)return direct;
    const text=String(jump?.text||'');
    const possession=text.match(/\((.+?)\s+(?:gains|controls|gets)\s+possession\)/i)||text.match(/(?:controlled by|possession to)\s+(.+?)(?:\.|$)/i);
    if(!possession)return null;
    return null;
  }catch{return null;}
}

function findGameArticle(game:SlateGame):HTMLElement|null{
  const articles=[...document.querySelectorAll<HTMLElement>('#main-content article')];
  return articles.find(a=>{
    const text=a.innerText||'';
    return text.includes(game.awayTeam)&&text.includes(game.homeTeam)&&text.includes('Opening possession');
  })||null;
}

function markWinner(game:SlateGame,winner:string){
  const article=findGameArticle(game); if(!article)return;
  const opening=[...article.querySelectorAll<HTMLElement>('div')].find(el=>el.textContent?.trim()==='Opening possession');
  const box=opening?.closest('.rounded-xl.border') as HTMLElement|null; if(!box)return;
  const grid=box.querySelector<HTMLElement>('.grid.grid-cols-\[1fr_auto_1fr\]'); if(!grid)return;
  const sides=[...grid.children].filter((_,i)=>i===0||i===2) as HTMLElement[];
  const target=canonical(winner)===canonical(game.awayTeam)?sides[0]:canonical(winner)===canonical(game.homeTeam)?sides[1]:null;
  if(!target)return;
  sides.forEach(s=>{s.classList.remove('wnba-verified-tip-winner');s.querySelector('.wnba-tip-winner-badge')?.remove();});
  target.classList.add('wnba-verified-tip-winner');
  if(!target.querySelector('.wnba-tip-winner-badge')){
    const badge=document.createElement('div'); badge.className='wnba-tip-winner-badge'; badge.textContent='✓ VERIFIED TIP WINNER'; target.appendChild(badge);
  }
}

async function refresh(){
  if(!location.pathname.toLowerCase().includes('wnba'))return;
  try{
    const r=await fetch('/api/wnba/first-basket',{cache:'no-store'}); if(!r.ok)return;
    const slate:Slate=await r.json();
    for(const game of slate.games||[]){
      if(!/final|in progress|halftime/i.test(game.status||''))continue;
      const winner=await verifiedTipWinner(game.id); if(winner)markWinner(game,winner);
    }
  }catch{}
}

const observer=new MutationObserver(()=>{window.clearTimeout((window as any).__wnbaTipGlowTimer);(window as any).__wnbaTipGlowTimer=window.setTimeout(refresh,250);});
observer.observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('popstate',refresh);window.setInterval(refresh,30000);window.setTimeout(refresh,800);
