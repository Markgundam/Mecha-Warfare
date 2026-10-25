// Instrumented AI-vs-AI lab: node simlab.js [games] [map|all] [p0doctrine|any] [p1doctrine|any] [p0persona|any] [p1persona|any]
// Plays full wars and reports how the AI spends its rounds: empty fields, parts sold, what kills mecha,
// weapon accuracy, where victory points come from and how often an activation does nothing.
const MW = require('./engine.js');
const D = MW.DEFS;
const [N = 60, mapArg = 'all', d0 = 'any', d1 = 'any', per0 = 'any', per1 = 'any'] = process.argv.slice(2);
const docs = Object.keys(MW.DOCTRINES), maps = MW.MAP_IDS;
const pick = (v, list, i) => (v === 'any' || v === 'all' ? list[i % list.length] : v);
const T = () => ({ games: 0, wins: 0, winPoints: 0, winBase: 0, rounds: 0, emptyRounds: 0, fieldRounds: 0, fielded: 0, deployed: 0, lost: 0, kills: 0,
  sold: {}, soldWeaponThenUnarmed: 0, supplyEnd: 0, supplyIdle: 0, vp: {}, acts: {}, idleActs: 0, activations: 0, lifetimes: [], unbuiltRounds: 0 });
const by = {}, cause = {}, weapon = {}, perMap = {}, first = { wins: 0, games: 0 }, pair = {}, causeBy = {}, vsDoc = {};
const key = (doc, persona) => doc + (persona ? '/' + persona : '');
const bump = (o, k, n) => { o[k] = (o[k] || 0) + (n == null ? 1 : n); };
let stalled = 0;

for (let g = 0; g < +N; g++) {
  const map = pick(mapArg, maps, g), a = pick(d0, docs, g), b = pick(d1, docs, Math.floor(g / 3));
  MW.newGame({ map, players: [{ name: 'Azure', doctrine: a, isAI: true, persona: per0 === 'any' ? undefined : per0, learn: false }, { name: 'Ember', doctrine: b, isAI: true, persona: per1 === 'any' ? undefined : per1, learn: false }] });
  const S0 = MW.S, tags = S0.players.map(p => key(p.doctrine, per0 === 'any' && per1 === 'any' ? '' : p.ai.persona));
  const t = tags.map(k => (by[k] = by[k] || T()));
  const born = {}, lastHit = {};
  let steps = 0, logAt = 0, lastRound = 0, seenCombat = false;
  const owner = name => { for (const p of MW.S.players) if (p.name === name) return p.id; return -1; };
  const mechOwner = {};
  while (MW.S.phase !== 'over' && MW.S.round <= 60 && steps++ < 20000) {
    const S = MW.S, before = S.phase, act = S.active;
    // once per round, when combat opens: who has anything on the field, and who has a mech still unbuilt
    if (S.phase === 'combat' && S.round !== lastRound) {
      lastRound = S.round;
      S.players.forEach((p, i) => {
        const f = MW.fieldMechs(i).length;
        t[i].fieldRounds++; t[i].fielded += f;
        if (!f && S.round > 1) t[i].emptyRounds++;
        if (p.hangar.some(m => !MW.isBlank(m) && (MW.issues(m).length || !m.slots.armL && !m.slots.armR))) t[i].unbuiltRounds++;
        t[i].supplyIdle += p.ep;
      });
    }
    MW.fieldMechs(0).concat(MW.fieldMechs(1)).forEach(m => { mechOwner[m.name] = m.owner; if (born[m.uid] == null) { born[m.uid] = S.round; t[m.owner].deployed++; } });
    MW.aiStep();
    // read the new log lines
    const L = MW.S.log;
    for (; logAt < L.length; logAt++) {
      const s = L[logAt].t, k = L[logAt].k, pid = k === 'p0' ? 0 : k === 'p1' ? 1 : -1;
      let m;
      if ((m = s.match(/^(\w+) (?:sells|scraps) (.+) for/))) { const o = owner(m[1]); const def = Object.values(D).find(x => x.name === m[2]); if (o >= 0 && def) bump(t[o].sold, def.slot === 'arm' ? 'weapon' : def.slot); }
      else if ((m = s.match(/^(\w+) fires (.+) at (\w+) \((\d+)%\) and (hits|misses)/))) {
        const w = weapon[m[2]] = weapon[m[2]] || { shots: 0, hits: 0, exp: 0, dmg: 0, kills: 0 };
        w.shots++; w.exp += +m[4] / 100; if (m[5] === 'hits') { w.hits++; lastHit[m[3]] = { src: m[2], w }; }
        { const td = mechOwner[m[3]] != null ? MW.S.players[mechOwner[m[3]]].doctrine : null; if (td) { const v = (vsDoc[m[2]] = vsDoc[m[2]] || {}); const c = (v[td] = v[td] || { shots: 0, dmg: 0 }); c.shots++; if (m[5] === 'hits') lastHit[m[3]].vs = c; } }
        if (mechOwner[m[1]] != null) bump(t[mechOwner[m[1]]].acts, 'fire');
      }
      else if ((m = s.match(/^(\w+) rams (\w+)/))) { lastHit[m[2]] = { src: 'Ram' }; if (mechOwner[m[1]] != null) bump(t[mechOwner[m[1]]].acts, 'ram'); }
      else if ((m = s.match(/base turret fires on (\w+)/))) lastHit[m[1]] = { src: 'Base turret' };
      else if ((m = s.match(/^(\w+) slams into/))) lastHit[m[1]] = { src: 'Ram into obstacle' };
      else if ((m = s.match(/^(\w+) takes (\d+) damage/))) { const h = lastHit[m[1]]; if (h && h.w) h.w.dmg += +m[2]; if (h && h.vs) { h.vs.dmg += +m[2]; h.vs = null; } }
      else if ((m = s.match(/^(\w+) is destroyed/))) {
        const h = lastHit[m[1]]; const cz = h ? (h.w ? 'Weapon' : h.src) : 'Other'; bump(cause, cz); if (h && h.w) h.w.kills++;
        { const o2 = mechOwner[m[1]]; if (o2 != null) { const dd = MW.S.players[o2].doctrine; bump(causeBy[dd] = causeBy[dd] || {}, cz); } if (!h) bump(causeBy.__other = causeBy.__other || {}, (L[logAt - 1] || {}).t.replace(/[A-Z]w+/g, 'X').slice(0, 50)); }
        const o = mechOwner[m[1]]; if (o != null) { t[o].lost++; t[1 - o].kills++; }
      }
      else if ((m = s.match(/^(\w+) moves /))) { if (mechOwner[m[1]] != null) bump(t[mechOwner[m[1]]].acts, 'move'); }
      else if ((m = s.match(/^(\w+) (emplaces|braces|goes on overwatch|returns to base|hits \w+'s base)/))) { if (mechOwner[m[1]] != null) bump(t[mechOwner[m[1]]].acts, m[2].replace(/ \w+'s base/, ' base')); }
      else if ((m = s.match(/^(\w+) earns (\d+) victory points? for (.+?)\.?$/))) { const o = owner(m[1]); if (o >= 0) bump(t[o].vp, m[3], +m[2]); }
      else if ((m = s.match(/^(\w+) captures/))) { const o = owner(m[1]); if (o >= 0) bump(t[o].vp, 'captures (count)'); }
    }
  }
  const S = MW.S;
  if (S.phase !== 'over') { stalled++; continue; }
  S.players.forEach((p, i) => { t[i].games++; t[i].rounds += S.round; t[i].supplyEnd += p.ep; });
  const w = S.winner; t[w].wins++; if (S.winReason === 'points') t[w].winPoints++; else t[w].winBase++;
  first.games++; if (w === S0.first) first.wins++;
  { const pk = S.players[0].doctrine + ' v ' + S.players[1].doctrine; const pp = pair[pk] = pair[pk] || { g: 0, w0: 0 }; pp.g++; if (w === 0) pp.w0++; }
  const pm = perMap[map] = perMap[map] || { games: 0, rounds: 0, base: 0, wins: {} };
  pm.games++; pm.rounds += S.round; if (S.winReason !== 'points') pm.base++; bump(pm.wins, S.players[w].doctrine);
}

const pct = (a, b) => (b ? (100 * a / b).toFixed(0) + '%' : '-');
const f1 = x => (Math.round(x * 10) / 10).toFixed(1);
console.log('\n=== ' + N + ' wars · map ' + mapArg + ' · ' + d0 + ' vs ' + d1 + ' · personas ' + per0 + ' vs ' + per1 + ' · stalled ' + stalled + ' ===');
console.log('Opening side wins: ' + pct(first.wins, first.games));
console.log('\nSIDE                    games  win%  byPts/byBase  rounds  emptyField%  unbuilt%  fielded/rd  deployed  lost  actsIdle  sold(w/chassis/legs/aux)');
for (const k of Object.keys(by).sort()) {
  const x = by[k]; if (!x.games) continue;
  console.log(k.padEnd(22), String(x.games).padStart(5), pct(x.wins, x.games).padStart(5), (x.winPoints + '/' + x.winBase).padStart(12), f1(x.rounds / x.games).padStart(7),
    pct(x.emptyRounds, x.fieldRounds).padStart(11), pct(x.unbuiltRounds, x.fieldRounds).padStart(9), f1(x.fielded / x.fieldRounds).padStart(10), f1(x.deployed / x.games).padStart(9), f1(x.lost / x.games).padStart(5), f1(x.supplyIdle / x.fieldRounds).padStart(10),
    '  ' + [x.sold.weapon, x.sold.torso, x.sold.legs, x.sold.aux].map(v => f1((v || 0) / x.games)).join('/'));
}
console.log('\nACTIONS per game');
for (const k of Object.keys(by).sort()) { const x = by[k]; if (x.games) console.log(k.padEnd(22), Object.entries(x.acts).sort((a, b) => b[1] - a[1]).map(([n, v]) => n + ' ' + f1(v / x.games)).join(' · ')); }
console.log('\nVICTORY POINTS per game, by source');
for (const k of Object.keys(by).sort()) { const x = by[k]; if (x.games) console.log(k.padEnd(22), Object.entries(x.vp).sort((a, b) => b[1] - a[1]).map(([n, v]) => n + ' ' + f1(v / x.games)).join(' · ')); }
const tot = Object.values(cause).reduce((a, b) => a + b, 0);
console.log('\nWHAT DESTROYS MECHA: ' + Object.entries(cause).sort((a, b) => b[1] - a[1]).map(([n, v]) => n + ' ' + pct(v, tot)).join(' · '));
console.log('\nWEAPON                 shots  hit%  stated%  dmg/shot  kills');
for (const [n, w] of Object.entries(weapon).sort((a, b) => b[1].shots - a[1].shots)) console.log(n.padEnd(22), String(w.shots).padStart(5), pct(w.hits, w.shots).padStart(5), pct(w.exp, w.shots).padStart(8), f1(w.dmg / w.shots).padStart(9), String(w.kills).padStart(6));
console.log('\nMAP            games  rounds  baseKills  wins');
for (const [n, m] of Object.entries(perMap)) console.log(n.padEnd(14), String(m.games).padStart(5), f1(m.rounds / m.games).padStart(7), pct(m.base, m.games).padStart(10), '  ' + JSON.stringify(m.wins));
console.log('\nMATCHUPS (first-named side win%): ' + Object.entries(pair).map(([k, v]) => k + ' ' + pct(v.w0, v.g) + ' (' + v.g + ')').join(' · '));
console.log('\nDEATHS BY VICTIM: ' + Object.entries(causeBy).filter(([k]) => k[0] !== '_').map(([k, v]) => k + ' {' + Object.entries(v).map(([n, c]) => n + ' ' + c).join(', ') + '}').join(' · '));
console.log('OTHER causes (line before): ' + JSON.stringify(Object.entries(causeBy.__other || {}).sort((a, b) => b[1] - a[1]).slice(0, 6)));
console.log('\nDAMAGE PER SHOT by target doctrine');
for (const [n, v] of Object.entries(vsDoc)) console.log(n.padEnd(22), ['assault', 'armored', 'experimental'].map(d => d.slice(0, 3) + ' ' + (v[d] ? f1(v[d].dmg / v[d].shots) + ' (' + v[d].shots + ')' : '-')).join('   '));
