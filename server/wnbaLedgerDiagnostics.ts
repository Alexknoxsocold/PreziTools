export function summarizeWnbaLedger(rows: any[]) {
  const groups = new Map<string, any[]>();
  for (const row of rows) groups.set(row.espn_game_id, [...(groups.get(row.espn_game_id) || []), row]);
  const valid: any[][] = [];
  const excluded: Record<string, number> = {};
  for (const game of groups.values()) {
    const top = game.filter(x => x.is_top_pick);
    const teams = new Map<string, number>();
    for (const x of game) teams.set(String(x.team).toUpperCase(), (teams.get(String(x.team).toUpperCase()) || 0) + 1);
    let reason = '';
    if (game.some(x => !(new Date(x.locked_at).getTime() < new Date(x.game_start_at).getTime()))) reason = 'lateOrMissingLock';
    else if (game.length !== 10 || top.length !== 1 || teams.size !== 2 || [...teams.values()].some(n => n !== 5) || new Set(game.map(x => `${String(x.player_name).toLowerCase()}|${String(x.team).toUpperCase()}`)).size !== 10 || new Set(game.map(x => x.model_version)).size !== 1) reason = 'incompleteSnapshot';
    else if (game.some(x => !Number.isFinite(Number(x.model_probability)) || Number(x.model_probability) < 0 || Number(x.model_probability) > 100)) reason = 'invalidProbabilities';
    else if (game.some(x => x.graded_at != null) && !game.every(x => x.graded_at != null && typeof x.won === 'boolean')) reason = 'partialGrade';
    if (reason) excluded[reason] = (excluded[reason] || 0) + 1;
    else valid.push(game);
  }
  const summarize = (games: any[][]) => {
    const graded = games.filter(g => g.every(x => x.graded_at != null && typeof x.won === 'boolean'));
    const tops = graded.map(g => g.find(x => x.is_top_pick));
    const wins = tops.filter(x => x.won).length;
    return {
      lockedGames: games.length, gradedGames: graded.length, topPickWins: wins,
      topPickAccuracy: tops.length ? Math.round(wins / tops.length * 1000) / 10 : null,
      expectedTopPickWins: tops.length ? +tops.reduce((n, x) => n + Number(x.model_probability) / 100, 0).toFixed(3) : null,
      probabilityMassWarnings: games.filter(g => Math.abs(g.reduce((n,x)=>n+Number(x.model_probability),0)-100)>1).length,
      candidateBrier: graded.length ? +(graded.flat().reduce((n, x) => n + (Number(x.model_probability) / 100 - Number(x.won)) ** 2, 0) / (graded.length * 10)).toFixed(4) : null,
    };
  };
  const source = (g: any[]) => g.every(x => x.lineup_status === 'confirmed' && !String(x.model_version).endsWith('-PROJECTED')) ? 'confirmed' : g.every(x => x.lineup_status === 'projected' || String(x.model_version).endsWith('-PROJECTED')) ? 'projected' : 'unknown';
  return { ...summarize(valid), rawLockedGames: groups.size, excludedGames: groups.size - valid.length, exclusionReasons: excluded,
    byLineup: Object.fromEntries(['confirmed','projected','unknown'].map(key => [key, summarize(valid.filter(g => source(g) === key))])),
    byModelVersion: Object.fromEntries([...new Set(valid.map(g => String(g[0].model_version)))].map(version => [version, summarize(valid.filter(g => g[0].model_version === version))])),
  };
}
