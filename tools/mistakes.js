// Mistake detector: plays AI vs AI wars step by step and flags play a human would call a blunder.
// node tools/mistakes.js . [wars] [examples file]   (first argument: the folder holding engine.js)
// Reports, per doctrine and per commander, how often each mistake happens per war, and writes example moments
// (with the log around them) so they can be read and judged by eye.
const path = require('path'), fs = require('fs');
const MW = require(path.resolve(process.argv[2], 'engine.js'));
const N = +process.argv[3] || 120, EX = process.argv[4] || null;
// AIX=a,b turns AI switches on for both sides
for (const k of (process.env.AIX || '').split(',').filter(Boolean)) MW.AIX[k] = true;
const docs = Object.keys(MW.DOCTRINES), maps = MW.MAP_IDS, C = MW.C;
const man = (a, b, c, d) => Math.abs(a - c) + Math.abs(b - d);

const KINDS = {
  passive: 'Ended an activation without firing though it could have (game targeting rules); overwatch, crates, salvage, digging in and tricks excluded',
  passiveBrace: '…of those, spent it bracing',
  wastedAp: 'Ended an activation with actions left unused (no fire, brace or overwatch)',
  outranged: 'Base hit from beyond its turret\'s reach (damage taken)',
  unanswered: '…shooters not hit back by the end of the next round',
  unfielded: 'Built mecha that never deployed before the war ended',
  fitsWasted: 'Parts fitted to mecha that never deployed',
  idleWeapon: 'Weapon on a mech fielded 2+ rounds that never fired',
  overheat: 'Overheated (core damage and shutdown)',
  slowArmy: 'Combat rounds with no fielded mech that moves 3+',
  lowOdds: 'Shots taken at under 45% to hit',
  freshLoss: 'Mecha lost within a round of deploying',
  baseLost: 'Base destroyed',
  cratesLost: 'Scrapyard: crates the enemy took beyond your own'
};
const agg = {};
const bucket = k => (agg[k] = agg[k] || { wars: 0, wins: 0, c: {} });
const add = (b, k, v) => { b.c[k] = (b.c[k] || 0) + (v == null ? 1 : v); };
const examples = {};
const keep = (k, text) => { const a = examples[k] = examples[k] || []; if (a.length < 6 && Math.random() < 0.35) a.push(text); };

// could this mech have fired this activation, by the game's own rules: from where it stands with one action, or
// after one move with the second; a Quad Walker by digging in first. Heat, ammo and line of fire all count
function canFire(m) {
  if (m.ap <= 0 || m.shutdown) return null;
  const st = MW.stats(m), ox = m.x, oy = m.y, oe = m.entrenched, legs = m.slots.legs && MW.DEFS[m.slots.legs.id];
  const keys = MW.weaponsOf(m).filter(wp => !wp.w.repair && MW.usable(m, wp.key) && m.heat + wp.w.heat + (st.shotHeat || 0) <= st.heatCap).map(wp => wp.key);
  if (!keys.length) return null;
  const test = () => { for (const k of keys) { const t = MW.validTargets(m, k); if (t.length) return t[0].type === 'base' ? 'the enemy base' : (MW.fieldMech(t[0].uid) || {}).name; } return null; };
  try {
    if (legs && legs.entrench && !m.entrenched) { if (m.ap < 2) return null; m.entrenched = true; return test(); }
    let r = test(); if (r) return r;
    if (m.ap < 2 || m.entrenched) return null;
    for (const k in MW.reachable(m)) { const [x, y] = k.split(',').map(Number); m.x = x; m.y = y; r = test(); if (r) return r; }
    return null;
  } finally { m.x = ox; m.y = oy; m.entrenched = oe; }
}
function reachOf(m, pos) {
  const st = MW.stats(m); let r = 0;
  for (const wp of MW.weaponsOf(m)) if (!wp.w.repair && wp.inst.hp > 0 && (wp.inst.ammo == null || wp.inst.ammo > 0)) r = Math.max(r, MW.effRange(wp.w, st));
  const legs = m.slots.legs && MW.DEFS[m.slots.legs.id], anchored = !!(legs && legs.entrench);
  return { range: r, move: anchored || m.entrenched ? 0 : st.move, anchored };
}

for (let w = 0; w < N; w++) {
  const pair = [[0, 1], [0, 2], [1, 2]][w % 3], seat = Math.floor(w / 3) % 2, map = maps[Math.floor(w / 6) % maps.length];
  const d = seat ? [docs[pair[1]], docs[pair[0]]] : [docs[pair[0]], docs[pair[1]]];
  MW.newGame({ map, players: d.map((x, k) => ({ name: k ? 'Ember' : 'Azure', doctrine: x, isAI: true, learn: false })) });
  const S0 = MW.S, side = [{ c: {} }, { c: {} }];
  const byName = name => S0.mechs.find(m => m.name === name) || S0.players.flatMap(p => p.hangar).find(m => m.name === name);
  const deployedAt = {}, firedW = {}, act = {}, fits = {}, siegeHits = [], crates = [0, 0];
  let seenN = MW.S.logN || 0, steps = 0;
  const lines = [];
  while (MW.S.phase !== 'over' && MW.S.round <= 60 && steps++ < 20000) {
    const S = MW.S, pre = { active: S.active, phase: S.phase, round: S.round, pos: {}, act: {} };
    for (const m of S.mechs) { pre.pos[m.uid] = [m.x, m.y]; pre.act[m.uid] = m.activated; }
    // before a fresh activation, what each of the acting side's mecha could have shot
    const could = {};
    if (S.phase === 'combat' && S.active == null) for (const m of S.mechs) if (m.owner === S.current && !m.activated) could[m.uid] = canFire(m);
    MW.aiStep();
    // an activation starts: note what it could have shot, before reading what it did
    if (pre.phase === 'combat') for (const m of MW.S.mechs) if (!act[m.name] && (MW.S.active === m.uid || (!pre.act[m.uid] && m.activated)))
      act[m.name] = { m, round: MW.S.round, near: could[m.uid] || null, armed: MW.hasWeapon(m), q: reachOf(m), from: lines.length };
    // new log lines
    const n = (MW.S.logN || 0) - seenN; seenN = MW.S.logN || 0;
    const fresh = n > 0 ? MW.S.log.slice(-Math.min(n, MW.S.log.length)) : [];
    for (const L of fresh) {
      const t = L.t; lines.push('R' + L.r + ' ' + t);
      let r;
      if ((r = /^(.+?) deploys (.+?) \(/.exec(t))) deployedAt[r[2]] = MW.S.round;
      else if ((r = /^(.+?) fits (.+?) to (.+?) \(/.exec(t))) { const o = t.startsWith('Azure') ? 0 : 1; (fits[r[3]] = fits[r[3]] || { n: 0, o }).n++; }
      if ((r = /^(.+?) fires (.+?) at (.+?) \((\d+)%\)/.exec(t))) { (firedW[r[1]] = firedW[r[1]] || new Set()).add(r[2]); if (act[r[1]]) act[r[1]].fired = true; const m = byName(r[1]); if (m && +r[4] < 45) { add(side[m.owner], 'lowOdds'); } if (m) add(side[m.owner], 'shots'); const tm = byName(r[3]); if (tm) siegeHits.forEach(h => { if (h.shooter === r[3] && /hits/.test(t)) h.answered = true; }); }
      if ((r = /^(.+?) hits (.+?)'s base with (.+?) for (\d+)/.exec(t))) {
        (firedW[r[1]] = firedW[r[1]] || new Set()).add(r[3]); if (act[r[1]]) act[r[1]].fired = true;
        const m = byName(r[1]); if (m) { const p = MW.S.players[1 - m.owner], dist = man(m.x, m.y, p.base.x, p.base.y);
          if (dist > C.TURRET_RANGE) { add(side[1 - m.owner], 'outranged', +r[4]); siegeHits.push({ shooter: r[1], victim: 1 - m.owner, round: MW.S.round, answered: false, at: lines.length }); keep('outranged', 'R' + MW.S.round + ' ' + t + ' (from ' + dist + ' tiles; turret reach ' + C.TURRET_RANGE + ')'); } }
      }
      if ((r = /^(.+?) takes \d+ damage/.exec(t))) siegeHits.forEach(h => { if (h.shooter === r[1]) h.answered = true; });
      if ((r = /^(.+?) braces/.exec(t)) && act[r[1]]) act[r[1]].braced = true;
      if ((r = /^(.+?) goes on overwatch/.exec(t)) && act[r[1]]) act[r[1]].ow = true;
      if ((r = /^(.+?) (grabs a .*crate|salvages|returns to base|emplaces|packs up|detonates|strips|overclocks|phases|cloaks)/.exec(t)) && act[r[1]]) act[r[1]].busy = true;
      if ((r = /^(.+?) overheats/.exec(t))) { const m = byName(r[1]); if (m) { add(side[m.owner], 'overheat'); keep('overheat', 'R' + L.r + ' ' + t); } }
      if ((r = /^(.+?) grabs a .*crate/.exec(t))) { const m = byName(r[1]); if (m) crates[m.owner]++; }
      if ((r = /^(.+?) is destroyed/.exec(t))) { const m = byName(r[1]); if (m && deployedAt[r[1]] != null && MW.S.round - deployedAt[r[1]] <= 1) { add(side[m.owner], 'freshLoss'); keep('freshLoss', 'R' + L.r + ' ' + t + ' (deployed R' + deployedAt[r[1]] + ')'); } }
    }
    if (pre.phase !== 'combat' && MW.S.phase === 'combat') {
      // a new combat: does each army have anything quick on the field?
      for (const p of MW.S.players) { const f = MW.fieldMechs(p.id); if (f.length && !f.some(m => { const q = reachOf(m); return !q.anchored && q.move >= 3; })) add(side[p.id], 'slowArmy'); }
    }
    if (pre.phase === 'combat') {
      for (const m of MW.S.mechs) {
        const a = act[m.name];
        if (a && !a.done && m.activated) {
          a.done = true;
          if (!a.fired && a.near && a.armed && !a.ow && !a.busy) {
            add(side[m.owner], 'passive'); if (a.braced) add(side[m.owner], 'passiveBrace');
            keep(a.braced ? 'passiveBrace' : 'passive', '[' + MW.S.players[m.owner].doctrine + ' / ' + ((MW.S.players[m.owner].ai || {}).persona) + '] ' + m.name + ' (' + MW.role(m) + ', range ' + a.q.range + ', move ' + a.q.move + ') could have shot ' + a.near + ':\n    ' + lines.slice(Math.max(a.from, 0), a.from + 5).join('\n    '));
          }
          if (!a.fired && !a.braced && !a.ow && !a.busy && m.ap > 0) { add(side[m.owner], 'wastedAp'); keep('wastedAp', '[' + MW.S.players[m.owner].doctrine + '] ' + m.name + ' (' + MW.role(m) + (m.entrenched ? ', dug in' : '') + ') ended with ' + m.ap + ' action(s) left' + (a.near ? ', could have shot ' + a.near : ', nothing to shoot') + ':\n    ' + lines.slice(Math.max(a.from, 0), a.from + 3).join('\n    ')); }
        }
      }
    }
    if (MW.S.phase !== 'combat' && pre.phase === 'combat') for (const k in act) delete act[k];
  }
  if (MW.S.phase !== 'over') continue;
  // end of the war: mecha that never got onto the field, weapons that never spoke, shelling nobody answered
  for (const p of MW.S.players) {
    for (const m of p.hangar) if (m.slots.torso && !MW.isBlank(m) && !MW.issues(m).length && deployedAt[m.name] == null) { add(side[p.id], 'unfielded'); add(side[p.id], 'fitsWasted', (fits[m.name] && fits[m.name].n) || 0); }
    if (p.base.hp <= 0) add(side[p.id], 'baseLost');
  }
  for (const m of MW.S.mechs) if (deployedAt[m.name] != null && MW.S.round - deployedAt[m.name] >= 2) for (const wp of MW.weaponsOf(m)) if (!wp.w.repair && !(firedW[m.name] && firedW[m.name].has(wp.def.name))) { add(side[m.owner], 'idleWeapon'); keep('idleWeapon', '[' + MW.S.players[m.owner].doctrine + '] ' + m.name + '\'s ' + wp.def.name + ' never fired in ' + (MW.S.round - deployedAt[m.name]) + ' rounds on the field (' + MW.role(m) + ')'); }
  for (const h of siegeHits) if (!h.answered) add(side[h.victim], 'unanswered');
  if (map === 'salvage') for (const i of [0, 1]) add(side[i], 'cratesLost', Math.max(0, crates[1 - i] - crates[i]));
  for (const i of [0, 1]) {
    const p = MW.S.players[i], keys = [p.doctrine, 'cmd:' + ((p.ai && p.ai.persona) || '?')];
    for (const k of keys) { const b = bucket(k); b.wars++; if (MW.S.winner === i) b.wins++; for (const c in side[i].c) add(b, c, side[i].c[c]); }
  }
  // keep the side's raw counters on the side objects for the next war
  side.forEach(s => { s.c = {}; });
}
// side objects double as counters: make add() work on them
function report() {
  const cols = Object.keys(KINDS);
  const rows = Object.entries(agg).sort((a, b) => (a[0].startsWith('cmd') - b[0].startsWith('cmd')) || a[0].localeCompare(b[0]));
  console.log('Per war, per side (' + N + ' wars):');
  console.log('who'.padEnd(18) + 'win%  ' + cols.map(c => c.slice(0, 10).padStart(11)).join(''));
  for (const [k, b] of rows) console.log(k.padEnd(18) + String(Math.round(100 * b.wins / b.wars)).padStart(4) + '  ' + cols.map(c => ((b.c[c] || 0) / b.wars).toFixed(2).padStart(11)).join(''));
  console.log('\nlowOdds is per shot: ' + Object.entries(agg).filter(([k]) => !k.startsWith('cmd')).map(([k, b]) => k + ' ' + Math.round(100 * (b.c.lowOdds || 0) / Math.max(1, b.c.shots || 0)) + '% of ' + (b.c.shots || 0)).join(' · '));
  console.log('\nKey:'); for (const c of cols) console.log('  ' + c.padEnd(13) + KINDS[c]);
  if (EX) { let s = ''; for (const k in examples) s += '\n## ' + k + ' — ' + KINDS[k] + '\n' + examples[k].join('\n') + '\n'; fs.writeFileSync(EX, s); console.log('\nexamples written to ' + EX); }
}
report();
