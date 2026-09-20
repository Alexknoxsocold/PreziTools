(() => {
  const TEAM_ALIASES={WAS:'WSH',WSH:'WSH',PHO:'PHX',PHX:'PHX',NYL:'NY',NY:'NY',GSV:'GS',GS:'GS',LVA:'LV',LV:'LV',LAS:'LA',LA:'LA'};
  const canon=v=>TEAM_ALIASES[String(v||'').trim().toUpperCase()]||String(v||'').trim().toUpperCase();
  let busy=false;

  function gameArticle(game){return [...document.querySelectorAll('article')].find(a=>{const t=a.textContent||'';return t.includes(game.awayTeam)&&t.includes(game.homeTeam)&&/Opening possession/i.test(t)})||null}
  function tipPanels(article){const title=[...article.querySelectorAll('div')].find(el=>el.textContent?.trim()==='Opening possession');const box=title?.closest('.rounded-xl.border');const grid=box?.querySelector('.grid.grid-cols-\[1fr_auto_1fr\]');if(!grid)return[];return [grid.children[0],grid.children[2]].filter(Boolean)}
  function playTeam(p){return canon(p?.team?.abbreviation||p?.team?.shortDisplayName||'')}
  async function resolveWinner(game){
    if(game.verifiedTipWinnerTeam)return canon(game.verifiedTipWinnerTeam);
    try{
      const r=await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=${encodeURIComponent(game.id)}`,{cache:'no-store'});if(!r.ok)return null;
      const body=await r.json();const plays=[...(body?.plays||[])];
      plays.sort((a,b)=>Number(a?.sequenceNumber??a?.id??0)-Number(b?.sequenceNumber??b?.id??0));
      const jump=plays.find(p=>/jump ball/i.test(String(p?.text||'')));if(!jump)return null;
      const direct=playTeam(jump);if(direct===canon(game.awayTeam)||direct===canon(game.homeTeam))return direct;
      const text=String(jump?.text||'');
      for(const team of [game.awayTeam,game.homeTeam])if(new RegExp(`\\b${team}\\b`,'i').test(text)&&/gains|controls|possession/i.test(text))return canon(team);
      return null;
    }catch{return null}
  }
  function decorate(game,winner){
    const article=gameArticle(game);if(!article)return;const panels=tipPanels(article);if(panels.length!==2)return;
    const awayWin=canon(winner)===canon(game.awayTeam),homeWin=canon(winner)===canon(game.homeTeam);if(!awayWin&&!homeWin)return;
    panels.forEach(p=>{p.classList.remove('wnba-verified-tip-winner');p.querySelector('.wnba-tip-winner-badge')?.remove()});
    const panel=awayWin?panels[0]:panels[1];panel.classList.add('wnba-verified-tip-winner');panel.setAttribute('data-tip-winner','true');
    const projected=canon(game?.tipSignal?.projectedFirstPossessionTeam||'');const hit=projected===canon(winner);
    const badge=document.createElement('div');badge.className='wnba-tip-winner-badge';badge.textContent=hit?'✓ VERIFIED TIP · MODEL HIT':'✓ VERIFIED TIP WINNER';panel.appendChild(badge);
    const opening=[...article.querySelectorAll('div')].find(el=>el.childElementCount>0&&/Projected first possession:/i.test(el.textContent||''));
    opening?.querySelector('.wnba-tip-grade')?.remove();if(opening){const grade=document.createElement('span');grade.className=`wnba-tip-grade ${hit?'is-hit':'is-miss'}`;grade.textContent=hit?' · GRADED ✓':' · GRADED ✕';opening.appendChild(grade)}
  }
  async function refresh(){
    if(busy||!location.pathname.toLowerCase().includes('wnba'))return;busy=true;
    try{const r=await fetch('/api/wnba/first-basket',{cache:'no-store'});if(!r.ok)return;const slate=await r.json();for(const game of slate.games||[]){if(!/final|in progress|halftime/i.test(String(game.status||''))&&!game.verifiedTipWinnerTeam)continue;const winner=await resolveWinner(game);if(winner)decorate(game,winner)}}catch(_){}finally{busy=false}
  }
  let timer;const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(refresh,200)});observer.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('load',refresh);window.addEventListener('popstate',refresh);setInterval(refresh,30000);setTimeout(refresh,600);
})();