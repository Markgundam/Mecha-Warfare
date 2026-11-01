// AI audit: plays seeded AI-vs-AI wars and reports how each doctrine and commander plays and wins, as JSON plus a
// text summary. node tools/audit.js . [wars] [out.json]
const path = require('path'), fs = require('fs');
const MW = require(path.resolve(process.argv[2] || '.', 'engine.js'));
const N = +process.argv[3] || 720, OUT = process.argv[4] || null;
const D = MW.DEFS, C = MW.C, docs = Object.keys(MW.DOCTRINES), maps = MW.MAP_IDS;
const NAMES = [['Vanguard', 'Hammer', 'Lancer', 'Bulwark', 'Kestrel', 'Anvil', 'Warden', 'Javelin', 'Mastiff', 'Halberd', 'Osprey', 'Granite'],
  ['Ashfall', 'Cinder', 'Ravager', 'Brand', 'Vulture', 'Scoria', 'Furnace', 'Harrier', 'Magma', 'Reaver', 'Slag', 'Pyre']];
const ownerOf = name => NAMES[0].includes(name) ? 0 : NAMES[1].includes(name) ? 1 : -1;
const byName = {}; for (const id in D) byName[D[id].name] = id;
function mul(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const inc = (o, k, n) => { o[k] = (o[k] || 0) + (n == null ? 1 : n); };
const A = {};   // per bucket (doctrine, cmd:x, map:doctrine)
const bucket = k => A[k] = A[k] || { wars: 0, wins: 0, winBy: {}, lossBy: {}, rounds: 0, vpFor: 0, vpAg: 0, vpSrc: {}, acts: {}, actPat: {}, activations: 0,
  fits: {}, scraps: {}, events: {}, eventNoop: 0, req: 0, draws: 0, drawRounds: 0, drawShort: 0, wsFull: 0, deckEmpty: 0,
  epLeft: 0, epRounds: 0, epLost: 0, fuelBought: 0, fuelBurnt: 0, stranded: 0, mechRounds: 0, fieldRounds: 0, fielded: 0,
  deployed: 0, lost: 0, kills: 0, designs: {}, chassis: {}, legs: {}, weapons: {}, wFired: {}, wFielded: {}, shots: 0, hits: 0, lowShots: 0,
  dmgDealt: 0, baseDmg: 0, overheats: 0, crates: 0, salvages: 0, returns: 0, detonates: 0, strips: 0, objRounds: 0, objHeld: 0,
  r3lead: [0, 0], r3behind: [0, 0], firstBlood: [0, 0], unfielded: 0, idleTurns: 0, braceOnly: 0, owShots: 0, turretKills: 0, tiebreaks: 0 };
const metaW = {}, metaC = {};
const pairs = {};
const earlyR1 = { radars: [0, 0] };
const allW = {};   // weapon: shots/hits/dmg/kills
const tbl = [];
for (let g = 0; g < N; g++) {
  const a = docs[g % 3], b = docs[Math.floor(g / 3) % 3], map = maps[Math.floor(g / 9) % maps.length], swap = Math.floor(g / 36) % 2;
  const d = swap ? [b, a] : [a, b];
  MW.setRng(mul(g * 7349 + 101));
  MW.newGame({ map, players: [{ name: 'Azure', doctrine: d[0], isAI: true, learn: false }, { name: 'Ember', doctrine: d[1], isAI: true, learn: false }] });
  const S0 = MW.S, P = S0.players;
  const keys = P.map(p => [p.doctrine, 'cmd:' + p.ai.persona, 'map:' + map + ':' + p.doctrine]);
  const B = keys.map(ks => ks.map(bucket));
  const each = (pid, f) => B[pid].forEach(f);
  let seen = MW.S.logN || 0, steps = 0, lastRound = 0, firstBlood = -1;
  const cur = {}, fieldedNames = new Set(), mechW = {}, firedW = {}, deployedRound = {};
  const vpAt = {};
  const finish = name => { const c = cur[name]; if (!c) return; delete cur[name]; const o = ownerOf(name); if (o < 0) return; const pat = c.v.length ? c.v.join('+') : 'nothing'; each(o, x => { inc(x.actPat, pat); x.activations++; }); };
  while (MW.S.phase !== 'over' && steps++ < 30000) {
    const S = MW.S, prePhase = S.phase, preRound = S.round;
    const preAct = {}; for (const m of S.mechs) preAct[m.uid] = m.activated;
    // the build is over: what each side kept unspent, and what tanks stand empty going into combat
    MW.aiStep();
    if (prePhase === 'build' && MW.S.phase !== 'build') for (const p of MW.S.players) each(p.id, x => { x.epLeft += p.ep; x.epRounds++; x.epLost += Math.max(0, p.ep - C.CARRY_MAX); });
    if (MW.S.phase === 'combat' && MW.S.round !== lastRound) {
      lastRound = MW.S.round;
      for (const p of MW.S.players) {
        const f = MW.fieldMechs(p.id);
        each(p.id, x => { x.fieldRounds++; x.fielded += f.length; x.mechRounds += f.length; });
        for (const m of f) {
          if (MW.needsFuel(m) && !(m.fuel > 0) && !MW.anchoredLegs(m)) each(p.id, x => x.stranded++);
          fieldedNames.add(m.name);
          for (const wp of MW.weaponsOf(m)) { mechW[m.name] = mechW[m.name] || {}; mechW[m.name][wp.def.name] = (mechW[m.name][wp.def.name] || 0) + 1; }
        }
        each(p.id, x => { x.objRounds++; x.objHeld += MW.S.objectives.filter(o => o.type !== 'repair' && o.owner === p.id).length; });
      }
    }
    const n = (MW.S.logN || 0) - seen; seen = MW.S.logN || 0;
    const fresh = n > 0 ? MW.S.log.slice(-Math.min(n, MW.S.log.length)) : [];
    for (const L of fresh) {
      const t = L.t, pk = /^p[01]$/.test(L.k) ? +L.k[1] : -1;
      let r;
      const verb = (name, v) => { const o = ownerOf(name); if (o < 0) return; (cur[name] = cur[name] || { v: [] }).v.push(v); each(o, x => inc(x.acts, v)); };
      if ((r = /^(\w+) receives (\d+) cards? from the Arsenal/.exec(t)) && pk >= 0) each(pk, x => { x.draws += +r[2]; x.drawRounds++; if (+r[2] < MW.trait(pk, 'draw')) x.drawShort++; });
      else if (/Workshop is full. Nothing drawn/.test(t) && pk >= 0) each(pk, x => { x.wsFull++; x.drawRounds++; x.drawShort++; });
      else if (/Arsenal is empty/.test(t) && pk >= 0) each(pk, x => { x.deckEmpty++; x.drawRounds++; x.drawShort++; });
      else if ((r = /^\w+ fits (.+?) to (\w+) \(/.exec(t)) && pk >= 0) each(pk, x => inc(x.fits, r[1]));
      else if ((r = /^\w+ scraps (.+?) for/.exec(t)) && pk >= 0) each(pk, x => inc(x.scraps, r[1]));
      else if ((r = /^\w+ plays (.+?)[:.]/.exec(t)) && pk >= 0) each(pk, x => { inc(x.events, r[1]); if (/nothing needed fixing|0 extra cards/.test(t)) x.eventNoop++; });
      else if (/requisitions a card/.test(t) && pk >= 0) each(pk, x => x.req++);
      else if (/^\w+ fuels /.test(t) && pk >= 0) each(pk, x => x.fuelBought++);
      else if ((r = /^\w+ deploys (\w+) \(/.exec(t)) && pk >= 0) {
        deployedRound[r[1]] = MW.S.round;
        const m = MW.S.mechs.find(q => q.name === r[1]);
        if (m) {
          const ws = MW.weaponsOf(m).map(wp => wp.def.name).sort();
          const des = D[m.slots.torso.id].name + ' / ' + D[m.slots.legs.id].name + ' / ' + (ws.join(' + ') || 'unarmed');
          each(pk, x => { x.deployed++; inc(x.designs, des); inc(x.chassis, D[m.slots.torso.id].name); inc(x.legs, D[m.slots.legs.id].name); ws.forEach(w => inc(x.weapons, w)); });
        }
      }
      if ((r = /^(\w+) moves .*?(, burning 1 fuel)?/.exec(t)) && ownerOf(r[1]) >= 0) { verb(r[1], 'move'); if (/burning 1 fuel/.test(t)) each(ownerOf(r[1]), x => x.fuelBurnt++); }
      if ((r = /^(\w+) phase-jumps/.exec(t))) verb(r[1], 'phase');
      if ((r = /^(Overwatch! )?(\w+) fires (.+?) at (\w+) \((\d+)%\)( and (hits|misses))?/.exec(t)) && ownerOf(r[2]) >= 0) {
        const o = ownerOf(r[2]);
        if (!r[1]) verb(r[2], 'fire'); else each(o, x => x.owShots++);
        (firedW[r[2]] = firedW[r[2]] || new Set()).add(r[3]);
        each(o, x => { x.shots++; if (+r[5] < 45) x.lowShots++; inc(x.wFired, r[3]); });
        const w = allW[r[3]] = allW[r[3]] || { shots: 0, hits: 0, dmg: 0, kills: 0, pct: 0 };
        w.shots++; w.pct += +r[5];
        // an overwatch shot reports its miss on the next line: count it as a hit until then
        if (/and hits/.test(t) || r[1]) { w.hits++; each(o, x => x.hits++); }
        cur._lastShooter = { name: r[2], weapon: r[3], ow: !!r[1] };
      }
      if ((r = /^(\w+) misses\.$/.exec(t)) && cur._lastShooter && cur._lastShooter.ow && cur._lastShooter.name === r[1]) {
        const w = allW[cur._lastShooter.weapon]; if (w) w.hits--; const o = ownerOf(r[1]); if (o >= 0) each(o, x => x.hits--); cur._lastShooter.ow = false;
      }
      if ((r = /^(\w+) hits (\w+)'s base with (.+?) for (\d+)/.exec(t)) && ownerOf(r[1]) >= 0) {
        verb(r[1], 'base'); (firedW[r[1]] = firedW[r[1]] || new Set()).add(r[3]);
        each(ownerOf(r[1]), x => { x.baseDmg += +r[4]; x.shots++; x.hits++; inc(x.wFired, r[3]); });
        const w = allW[r[3]] = allW[r[3]] || { shots: 0, hits: 0, dmg: 0, kills: 0, pct: 0 }; w.shots++; w.hits++; w.pct += 100; w.dmg += +r[4];
      }
      if ((r = /^(\w+) takes (\d+) damage/.exec(t)) && cur._lastShooter) {
        const w = allW[cur._lastShooter.weapon]; if (w) w.dmg += +r[2];
        const o = ownerOf(cur._lastShooter.name); if (o >= 0) each(o, x => x.dmgDealt += +r[2]);
      }
      if ((r = /^(\w+) is destroyed at/.exec(t))) {
        const victim = ownerOf(r[1]);
        if (victim >= 0) {
          each(victim, x => x.lost++);
          if (cur._lastShooter && ownerOf(cur._lastShooter.name) === 1 - victim) { const w = allW[cur._lastShooter.weapon]; if (w) w.kills++; each(1 - victim, x => x.kills++); if (firstBlood < 0) firstBlood = 1 - victim; }
        }
      }
      if (/base turret (fires|returns)/.test(t)) cur._lastShooter = { name: 'turret', weapon: 'Base turret' };
      if ((r = /^(\w+) braces/.exec(t))) verb(r[1], 'brace');
      if ((r = /^(\w+) goes on overwatch/.exec(t))) verb(r[1], 'overwatch');
      if ((r = /^(\w+) emplaces/.exec(t))) verb(r[1], 'emplace');
      if ((r = /^(\w+) packs up/.exec(t))) verb(r[1], 'packup');
      if ((r = /^(\w+) grabs a/.exec(t))) { verb(r[1], 'crate'); each(ownerOf(r[1]), x => x.crates++); }
      if ((r = /^(\w+) salvages/.exec(t))) { verb(r[1], 'salvage'); each(ownerOf(r[1]), x => x.salvages++); }
      if ((r = /^(\w+) returns to base/.exec(t))) { verb(r[1], 'return'); each(ownerOf(r[1]), x => x.returns++); }
      if ((r = /^(\w+) strips/.exec(t))) { const nm = t.split(' strips ')[1].split(' ')[0]; verb(nm, 'strip'); each(ownerOf(nm), x => x.strips++); }
      if ((r = /^(\w+) (overclocks|cloaks)/.exec(t))) verb(r[1], r[2] === 'overclocks' ? 'overclock' : 'cloak');
      if ((r = /^(\w+)'s core (detonates|blasts)|^(\w+) detonates/.exec(t))) { const nm = r[1] || r[3]; verb(nm, 'detonate'); each(ownerOf(nm), x => x.detonates++); }
      if ((r = /^(\w+) overheats/.exec(t)) && ownerOf(r[1]) >= 0) each(ownerOf(r[1]), x => x.overheats++);
      if ((r = /^(\w+) earns (\d+) (?:victory|bounty) points? for (.+?)\./.exec(t))) { const pid = r[1] === 'Azure' ? 0 : 1; each(pid, x => inc(x.vpSrc, r[3], +r[2])); }
      if ((r = /^(\w+) scores (\d+) victory points?/.exec(t))) {
        const pid = r[1] === 'Azure' ? 0 : 1;
        // objective points are what is left once the earned extras are taken away
        const extras = MW.S.log.slice(-12).filter(l => l.r === MW.S.round && new RegExp('^' + r[1] + ' earns (\\d+)').test(l.t)).reduce((s, l) => s + +/earns (\d+)/.exec(l.t)[1], 0);
        if (+r[2] - extras > 0) each(pid, x => inc(x.vpSrc, 'objectives', +r[2] - extras));
      }
      if (/^Tied at .* wins the war/.test(t)) each(MW.S.winner, x => x.tiebreaks++);
    }
    // activations that ended this step
    for (const m of MW.S.mechs) if (preAct[m.uid] === false && m.activated) { if (!cur[m.name]) cur[m.name] = { v: [] }; finish(m.name); }
    if (MW.S.round !== preRound) { vpAt[preRound] = MW.S.players.map(p => p.vp || 0); for (const k in cur) if (k !== '_lastShooter') finish(k); }
  }
  const S = MW.S, w = S.winner;
  vpAt[S.round] = S.players.map(p => p.vp || 0);
  const r3 = vpAt[3];
  for (const p of S.players) {
    const won = w === p.id, o = S.players[1 - p.id];
    const why = S.winReason === 'base' ? 'base' : S.log.some(l => /^Tied at .* wins the war/.test(l.t)) ? 'tiebreak' : S.winReason || 'other';
    each(p.id, x => {
      x.wars++; if (won) { x.wins++; inc(x.winBy, why); } else inc(x.lossBy, why);
      x.rounds += S.round; x.vpFor += p.vp || 0; x.vpAg += o.vp || 0;
      if (r3) { if (r3[p.id] > r3[1 - p.id]) { x.r3lead[0]++; if (won) x.r3lead[1]++; } else if (r3[p.id] < r3[1 - p.id]) { x.r3behind[0]++; if (won) x.r3behind[1]++; } }
      if (firstBlood === p.id) { x.firstBlood[0]++; if (won) x.firstBlood[1]++; }
      x.unfielded += p.hangar.filter(m => !MW.isBlank(m)).length;
    });
    // weapons that sat on a fielded mech and never fired
    for (const nm of fieldedNames) if (ownerOf(nm) === p.id) for (const wn in (mechW[nm] || {})) { each(p.id, x => { inc(x.wFielded, wn); }); if (!(firedW[nm] && firedW[nm].has(wn))) each(p.id, x => inc(x.idleW = x.idleW || {}, wn)); }
  }
  const pk = S.players[0].doctrine + ' v ' + S.players[1].doctrine;
  const pr = pairs[pk] = pairs[pk] || { g: 0, w0: 0 }; pr.g++; if (w === 0) pr.w0++;
  tbl.push({ g, map, d: S.players.map(p => p.doctrine + '/' + p.ai.persona), w, why: S.winReason, rounds: S.round, vp: S.players.map(p => p.vp), base: S.players.map(p => p.base.hp), first: firstBlood });
}
const out = { N, buckets: A, weapons: allW, pairs, wars: tbl };
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
// a short text summary
const pct = (a, b) => b ? (100 * a / b).toFixed(0) + '%' : '-';
const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
for (const k of Object.keys(A).filter(k => !k.startsWith('map:')).sort()) {
  const x = A[k];
  console.log(k.padEnd(16), 'wars', x.wars, 'win', pct(x.wins, x.wars), 'rounds', f1(x.rounds / x.wars), 'vp', f1(x.vpFor / x.wars) + '-' + f1(x.vpAg / x.wars),
    'epLeft/rd', f1(x.epLeft / x.epRounds), 'epLost/rd', f1(x.epLost / x.epRounds), 'drawShort', pct(x.drawShort, x.drawRounds), 'deployed', f1(x.deployed / x.wars), 'lost', f1(x.lost / x.wars), 'kills', f1(x.kills / x.wars));
}
