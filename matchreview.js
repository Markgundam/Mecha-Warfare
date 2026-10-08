// Review one saved match: node matchreview.js <history-doc.json>
// Reads a match document saved by the game (the player's history) and prints what each side did:
// result, deployments and losses, what destroyed mecha, shots by weapon and by aim, parts sold, empty-field rounds,
// where victory points came from, and the AI commander's stance changes. It ends with the simlab command that
// replays the same setup AI-vs-AI.
const fs = require('fs');
const MW = require('./engine.js');
const D = MW.DEFS;
const file = process.argv[2];
if (!file) { console.error('usage: node matchreview.js <history-doc.json>'); process.exit(1); }
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const doc = raw.data || raw.fields || raw;
const state = typeof doc.state === 'string' ? JSON.parse(doc.state) : doc.state;
const log = (doc.log || (state && state.log || []).map(l => 'R' + l.r + ' ' + l.t)).map(s => { const m = s.match(/^R(\d+) (.*)$/); return m ? { r: +m[1], t: m[2] } : { r: 0, t: s }; });
const P = doc.players || [];
const names = P.map(p => p.name);
const side = n => names.indexOf(n);
const T = () => ({ deployed: [], lost: [], sold: [], fits: 0, shots: {}, aim: {}, baseHits: 0, baseDmg: 0, vp: {}, stance: [], fieldByRound: {}, kills: {}, actions: {} });
const t = [T(), T()];
const owner = {};                                   // mech name -> side
const onField = [new Set(), new Set()];
const lastHit = {};
const bump = (o, k, n) => { o[k] = (o[k] || 0) + (n == null ? 1 : n); };
let persona = [null, null];
for (const { r, t: s } of log) {
  let m;
  if ((m = s.match(/^(\w+) is led by a (\w+) commander/))) { const i = side(m[1]); if (i >= 0) persona[i] = m[2].toLowerCase(); }
  else if ((m = s.match(/^(\w+) deploys (\w+) \(([^)]*)\)/))) { const i = side(m[1]); if (i >= 0) { owner[m[2]] = i; t[i].deployed.push('R' + r + ' ' + m[2] + ' (' + m[3] + ')'); onField[i].add(m[2]); } }
  else if ((m = s.match(/^(\w+) sells (.+) for/))) { const i = side(m[1]); if (i >= 0) t[i].sold.push('R' + r + ' ' + m[2]); }
  else if ((m = s.match(/^(\w+) fits /))) { const i = side(m[1]); if (i >= 0) t[i].fits++; }
  else if ((m = s.match(/^(\w+) \((\w+)\) (.+)\.$/))) { const i = side(m[1]); if (i >= 0) t[i].stance.push('R' + r + ' ' + m[3]); }
  else if ((m = s.match(/^(\w+) fires (.+) at (\w+) \((\d+)%\) and (hits|misses)/))) {
    const i = owner[m[1]]; if (i == null) continue;
    const w = t[i].shots[m[2]] = t[i].shots[m[2]] || { n: 0, hit: 0, exp: 0 };
    w.n++; w.exp += +m[4]; if (m[5] === 'hits') { w.hit++; lastHit[m[3]] = m[2]; }
    bump(t[i].actions, 'fire');
  }
  else if ((m = s.match(/^(\w+) takes (\d+) damage(?: to its ([a-z ]+?))?(?: \(| ?:)/))) { const v = owner[m[1]]; if (v != null) bump(t[1 - v].aim, m[3] || 'body'); }
  else if ((m = s.match(/^(\w+) hits (\w+)'s base with (.+) for (\d+)/))) { const i = owner[m[1]]; if (i != null) { t[i].baseHits++; t[i].baseDmg += +m[4]; bump(t[i].actions, 'hit base'); } }
  else if ((m = s.match(/base turret fires on (\w+)/))) lastHit[m[1]] = 'Base turret';
  else if ((m = s.match(/^(\w+) overheats/))) { lastHit[m[1]] = 'Overheating'; const i = owner[m[1]]; if (i != null) bump(t[i].actions, 'overheat'); }
  else if ((m = s.match(/^(\w+) is destroyed/))) { const v = owner[m[1]]; if (v != null) { t[v].lost.push('R' + r + ' ' + m[1] + ' ← ' + (lastHit[m[1]] || 'unknown')); bump(t[1 - v].kills, lastHit[m[1]] || 'unknown'); onField[v].delete(m[1]); } }
  else if ((m = s.match(/^(\w+) returns to base/))) { const i = owner[m[1]]; if (i != null) { onField[i].delete(m[1]); bump(t[i].actions, 'return to base'); } }
  else if ((m = s.match(/^(\w+) moves /))) { const i = owner[m[1]]; if (i != null) bump(t[i].actions, 'move'); }
  else if ((m = s.match(/^(\w+) (braces|digs in|goes on overwatch)/))) { const i = owner[m[1]]; if (i != null) bump(t[i].actions, m[2]); }
  else if ((m = s.match(/^(\w+) earns (\d+) victory points? for (.+?)\.?$/))) { const i = side(m[1]); if (i >= 0) bump(t[i].vp, m[3], +m[2]); }
  else if ((m = s.match(/^(\w+) captures the (\w+)/))) { const i = side(m[1]); if (i >= 0) bump(t[i].vp, 'captures (count)'); }
  else if (s === 'Combat begins.') [0, 1].forEach(i => { t[i].fieldByRound[r] = onField[i].size; });
}
const rounds = doc.round || Math.max(...log.map(l => l.r));
const out = [];
out.push('MATCH ' + (doc.id || file) + ' · map ' + (doc.map || (state && state.map) || '?') + ' · ' + rounds + ' rounds · ' + (doc.status || doc.phase || ''));
out.push('RESULT: ' + (doc.winner != null && P[doc.winner] ? P[doc.winner].name + ' (' + P[doc.winner].doctrine + ') wins by ' + doc.winReason : 'not finished'));
P.forEach((p, i) => {
  const x = t[i], empty = Object.entries(x.fieldByRound).filter(([r, n]) => +r > 1 && !n).map(([r]) => 'R' + r);
  out.push('');
  out.push('── ' + p.name + ' · ' + p.doctrine + ' · ' + (p.isAI ? 'AI' + (persona[i] ? ' (' + persona[i] + ')' : '') : 'HUMAN') + ' · VP ' + p.vp + ' · base ' + p.baseHp + ' · kills ' + p.kills + ' · lost ' + p.lost + ' · supply left ' + p.supply);
  out.push('  deployed ' + x.deployed.length + ': ' + x.deployed.join(', '));
  out.push('  lost ' + x.lost.length + ': ' + (x.lost.join(', ') || '—'));
  out.push('  on the field at the start of each round: ' + Object.entries(x.fieldByRound).map(([r, n]) => 'R' + r + ':' + n).join(' ') + (empty.length ? '  ⚠ empty field in ' + empty.join(', ') : ''));
  out.push('  actions: ' + (Object.entries(x.actions).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(' · ') || '—') + ' · parts fitted ' + x.fits);
  out.push('  weapons: ' + (Object.entries(x.shots).map(([k, w]) => k + ' ' + w.hit + '/' + w.n + ' hit (stated ' + Math.round(w.exp / w.n) + '%)').join(' · ') || '—'));
  out.push('  its hits landed on: ' + (Object.entries(x.aim).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(' · ') || '—'));
  out.push('  destroyed enemy mecha with: ' + (Object.entries(x.kills).map(([k, v]) => k + ' ' + v).join(' · ') || '—') + ' · base hits ' + x.baseHits + ' for ' + x.baseDmg);
  out.push('  victory points from: ' + (Object.entries(x.vp).map(([k, v]) => k + ' ' + v).join(' · ') || '—'));
  out.push('  sold ' + x.sold.length + ': ' + (x.sold.join(', ') || '—'));
  if (x.stance.length) out.push('  stance changes: ' + x.stance.join(', '));
});
const ai = P.findIndex(p => p.isAI), hu = P.findIndex(p => !p.isAI);
out.push('');
if (ai >= 0 && hu >= 0) {
  out.push('REPLAY THIS SETUP AI-vs-AI (the human\'s side played by a regular AI):');
  out.push('  node simlab.js 120 ' + (doc.map || 'all') + ' ' + P[0].doctrine + ' ' + P[1].doctrine + ' ' + (ai === 0 ? persona[0] || 'any' : 'any') + ' ' + (ai === 1 ? persona[1] || 'any' : 'any'));
}
out.push('OVERALL BALANCE CHECK:  node simlab.js 540 all any any');
console.log(out.join('\n'));
