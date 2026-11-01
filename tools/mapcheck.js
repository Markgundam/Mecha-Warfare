// Per-map balance check: seeded AI-vs-AI wars on one map, every doctrine pairing from both seats, win rates with mirrors
// left out. node tools/mapcheck.js . <map> [wars] ['{"obj":[...],"ruins":[...]}']  (the JSON patches the map for a trial)
const path = require('path');
const MW = require(path.resolve(process.argv[2] || '.', 'engine.js'));
const map = process.argv[3] || 'open', N = +process.argv[4] || 360, patch = process.argv[5] ? JSON.parse(process.argv[5]) : null;
if (patch) Object.assign(MW.MAPS[map], patch);
function mul(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const docs = Object.keys(MW.DOCTRINES), pairs = [];
for (const a of docs) for (const b of docs) if (a !== b) pairs.push([a, b]);
const r = {}, seat = [0, 0];
let rounds = 0;
for (let g = 0; g < N; g++) {
  const [a, b] = pairs[g % pairs.length];
  MW.setRng(mul(g * 9973 + 17));
  MW.newGame({ map, players: [{ name: 'Azure', doctrine: a, isAI: true, learn: false }, { name: 'Ember', doctrine: b, isAI: true, learn: false }] });
  let n = 0; while (MW.S.phase !== 'over' && n++ < 30000) MW.aiStep();
  rounds += MW.S.round;
  MW.S.players.forEach((p, i) => { const x = r[p.doctrine] = r[p.doctrine] || [0, 0]; x[1]++; if (MW.S.winner === i) { x[0]++; seat[i]++; } });
}
console.log(map, N + ' wars', docs.map(d => d + ' ' + (100 * r[d][0] / r[d][1]).toFixed(0) + '%').join(' · '), '· Azure seat ' + (100 * seat[0] / N).toFixed(0) + '%', '· rounds ' + (rounds / N).toFixed(1));
