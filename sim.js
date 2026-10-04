// Headless AI-vs-AI balance check: node sim.js [games]
const MW = require('./engine.js');
const docs = Object.keys(MW.DOCTRINES);
const N = +process.argv[2] || 60;
const wins = {}, played = {};
let rounds = [], stalled = 0, p0wins = 0, kills = 0;
for (let g = 0; g < N; g++) {
  const a = docs[g % 3], b = docs[Math.floor(g / 3) % 3];
  MW.newGame({ players: [{ name: 'P1', doctrine: a, isAI: true }, { name: 'P2', doctrine: b, isAI: true }] });
  let steps = 0;
  while (MW.S.phase !== 'over' && MW.S.round <= 60 && steps++ < 20000) MW.aiStep();
  const S = MW.S;
  played[a] = (played[a] || 0) + 1; played[b] = (played[b] || 0) + 1;
  if (S.phase !== 'over') { stalled++; continue; }
  rounds.push(S.round);
  const w = S.players[S.winner];
  wins[w.doctrine] = (wins[w.doctrine] || 0) + 1;
  if (S.winner === 0) p0wins++;
  kills += S.players[0].kills + S.players[1].kills;
}
rounds.sort((x, y) => x - y);
console.log({ games: N, finished: rounds.length, stalled, medianRounds: rounds[rounds.length >> 1], min: rounds[0], max: rounds[rounds.length - 1], p0wins, killsPerGame: (kills / N).toFixed(1), wins, played });
if (process.argv[3]) console.log(MW.S.log.slice(-60).map(l => 'R' + l.r + ' ' + l.t).join('\n'));
