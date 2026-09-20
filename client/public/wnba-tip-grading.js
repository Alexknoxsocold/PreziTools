(() => {
  const TEAM_ALIASES = { WAS:'WSH', WSH:'WSH', PHO:'PHX', PHX:'PHX', NYL:'NY', NY:'NY', GSV:'GS', GS:'GS', LVA:'LV', LV:'LV', LAS:'LA', LA:'LA' };
  const canon = v => TEAM_ALIASES[String(v || '').trim().toUpperCase()] || String(v || '').trim().toUpperCase();
  let busy = false;

  function exactText(root, text) {
    const wanted = canon(text);
    return [...root.querySelectorAll('span,div')].find(el => canon(el.textContent) === wanted) || null;
  }

  function tipPanelFromTeamNode(node) {
    let el = node;
    while (el && el.parentElement) {
      const txt = el.textContent || '';
      if (/verified tip rate/i.test(txt) && !/jump ball/i.test(txt) && el.querySelector('img')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function gameArticle(game) {
    return [...document.querySelectorAll('article')].find(article => {
      const txt = article.textContent || '';
      return txt.includes(game.awayTeam) && txt.includes(game.homeTeam) && /Opening possession/i.test(txt);
    }) || null;
  }

  function decorate(game) {
    if (!game.verifiedTipWinnerTeam) return;
    const article = gameArticle(game);
    if (!article) return;
    const winner = canon(game.verifiedTipWinnerTeam);
    const teamNode = exactText(article, winner);
    const panel = teamNode ? tipPanelFromTeamNode(teamNode) : null;
    if (!panel) return;
    panel.classList.add('wnba-verified-tip-winner');
    panel.setAttribute('data-tip-winner', 'true');
    if (!panel.querySelector('.wnba-tip-winner-badge')) {
      const badge = document.createElement('div');
      badge.className = 'wnba-tip-winner-badge';
      badge.textContent = game.tipPredictionWon === true ? '✓ VERIFIED TIP · MODEL HIT' : '✓ VERIFIED TIP WINNER';
      panel.appendChild(badge);
    }
    const opening = [...article.querySelectorAll('div')].find(el => el.childElementCount > 0 && /Projected first possession:/i.test(el.textContent || ''));
    if (opening && !opening.querySelector('.wnba-tip-grade')) {
      const grade = document.createElement('span');
      grade.className = `wnba-tip-grade ${game.tipPredictionWon === true ? 'is-hit' : 'is-miss'}`;
      grade.textContent = game.tipPredictionWon === true ? ' · GRADED ✓' : ' · GRADED ✕';
      opening.appendChild(grade);
    }
  }

  async function refresh() {
    if (busy || !location.pathname.toLowerCase().includes('wnba')) return;
    busy = true;
    try {
      const r = await fetch('/api/wnba/first-basket', { cache: 'no-store' });
      if (!r.ok) return;
      const slate = await r.json();
      for (const game of slate.games || []) decorate(game);
    } catch (_) {
    } finally {
      busy = false;
    }
  }

  const observer = new MutationObserver(() => { if (location.pathname.toLowerCase().includes('wnba')) refresh(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', refresh);
  window.addEventListener('popstate', refresh);
  setInterval(refresh, 30000);
  setTimeout(refresh, 800);
})();