/* Mecha Warfare — sound. Effects are built the way film and game sound designers build them: recorded layers
   (CC0 recordings in sfx/, see sfx/CREDITS.md) for the transient and body, synthesised sub and sci-fi sweeteners on
   top, an outdoor slapback for the tail, all through a saturating, limiting master. Music streams from sfx/ and
   crossfades with the phase of the war.
   SFX.play(name, opts) · SFX.music('menu' | 'build' | 'combat' | 'tense' | null) · SFX.sting(name) */
(function (root) {
'use strict';
const BASE = 'sfx/';
const STORE = 'mw-audio';
const prefs = (() => { const d = { master: 0.8, sfx: 0.9, music: 0.5, mute: false }; try { return Object.assign(d, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) { return d; } })();
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch (e) { /* storage unavailable */ } };

// every recording, by group: a group's members are interchangeable takes, picked at random without repeats
const GROUPS = {
  gun_rifle: 4, gun_round: 6, gun_shotgun: 3, gun_smg: 3, gun_auto: 3, expl: 4, boom_low: 2, laser_l: 3, laser_s: 2, field: 2,
  hit_metal_h: 3, hit_metal_m: 2, plate_h: 3, punch_h: 2, clang_low: 2, tin: 2
};
const SINGLES = ['expl_big', 'hiss_open', 'hiss_close', 'loop_thruster', 'loop_engine_low', 'loop_hover', 'loop_servo',
  'ui_click_002', 'ui_click_004', 'ui_select_002', 'ui_select_006', 'ui_confirmation_002', 'ui_confirmation_004', 'ui_error_004', 'ui_back_002',
  'ui_open_002', 'ui_close_002', 'ui_switch_002', 'ui_toggle_002', 'ui_drop_002', 'ui_maximize_002', 'ui_minimize_002', 'ui_tick_002', 'ui_glass_002', 'ui_pluck_001',
  'mus_victory', 'mus_defeat'];
const TRACKS = { menu: 'mus_menu', build: 'mus_build', combat: 'mus_combat', tense: 'mus_tense' };

let ctx = null, out = null, sfxBus = null, musBus = null, duckG = null, verbSend = null, slapSend = null, NOISE = null;
const BUF = {};
const AC = root.AudioContext || root.webkitAudioContext;
function init() {
  if (ctx || !AC) return !!ctx;
  ctx = new AC();
  // master: a touch of tape-style saturation for density, then a fast limiter so stacked explosions never clip
  const sat = ctx.createWaveShaper(), curve = new Float32Array(2048);
  for (let i = 0; i < 2048; i++) { const x = i / 1023.5 - 1; curve[i] = Math.tanh(1.6 * x) / Math.tanh(1.6); }
  sat.curve = curve; sat.oversample = '2x';
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -6; lim.knee.value = 4; lim.ratio.value = 12; lim.attack.value = 0.002; lim.release.value = 0.15;
  out = ctx.createGain(); out.connect(sat); sat.connect(lim); lim.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.connect(out);
  duckG = ctx.createGain(); duckG.connect(out);
  musBus = ctx.createGain(); musBus.connect(duckG);
  // a large space: decaying noise, darker as it fades
  const verb = ctx.createConvolver(), len = Math.floor(ctx.sampleRate * 2.6), ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); let lp = 0; for (let i = 0; i < len; i++) { const k = i / len; lp += ((Math.random() * 2 - 1) - lp) * (0.9 - 0.8 * k); d[i] = lp * Math.pow(1 - k, 2.6); } }
  verb.buffer = ir; verbSend = ctx.createGain(); verbSend.gain.value = 0.5; verbSend.connect(verb); verb.connect(out);
  // outdoor slapback: two dark echoes off distant walls, the tail every gunshot needs
  slapSend = ctx.createGain(); slapSend.gain.value = 1;
  [[0.13, 0.32, 2200], [0.29, 0.18, 1400]].forEach(([t, g, f]) => {
    const d = ctx.createDelay(1), lp = ctx.createBiquadFilter(), gg = ctx.createGain(), p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    d.delayTime.value = t; lp.type = 'lowpass'; lp.frequency.value = f; gg.gain.value = g;
    slapSend.connect(d); d.connect(lp); lp.connect(gg);
    if (p) { p.pan.value = t < 0.2 ? -0.5 : 0.5; gg.connect(p); p.connect(sfxBus); } else gg.connect(sfxBus);
  });
  const nl = ctx.sampleRate * 2; NOISE = ctx.createBuffer(1, nl, ctx.sampleRate);
  const nd = NOISE.getChannelData(0); for (let i = 0; i < nl; i++) nd[i] = Math.random() * 2 - 1;
  applyPrefs();
  loadAll();
  return true;
}
function loadAll() {
  const names = SINGLES.slice();
  for (const g in GROUPS) for (let i = 0; i < GROUPS[g]; i++) names.push(g + '_' + i);
  names.forEach(n => fetch(BASE + n + '.mp3').then(r => r.ok ? r.arrayBuffer() : Promise.reject(r.status))
    .then(a => new Promise((ok, no) => ctx.decodeAudioData(a, ok, no))).then(b => { BUF[n] = b; }).catch(() => { /* missing sound: the synth layers still play */ }));
}
function applyPrefs() {
  if (!ctx) return;
  const t = ctx.currentTime;
  out.gain.setTargetAtTime(prefs.mute ? 0 : prefs.master, t, 0.05);
  sfxBus.gain.setTargetAtTime(prefs.sfx, t, 0.05);
  musBus.gain.setTargetAtTime(prefs.music * 0.7, t, 0.05);
}
function unlock() {
  if (!init()) return;
  if (ctx.state === 'suspended') ctx.resume();
  if (want && cur !== want) music(want);
  for (const k in TRK) if (TRK[k].el.paused && TRK[k].on) TRK[k].el.play().catch(() => {});
}
['pointerdown', 'keydown', 'touchstart'].forEach(ev => root.addEventListener(ev, unlock, { capture: true, passive: true }));
const live = () => ctx && ctx.state === 'running' && !prefs.mute;
const now = () => ctx.currentTime;
const rnd = (a, b) => a + Math.random() * (b - a);

/* ---------- building blocks ---------- */
function chain(o) {
  const g = ctx.createGain(); g.gain.value = 0;
  let head = g;
  if (o.pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); g.connect(p); head = p; }
  head.connect(o.bus || sfxBus);
  if (o.wet) { const s = ctx.createGain(); s.gain.value = o.wet; head.connect(s); s.connect(verbSend); }
  if (o.slap) { const s = ctx.createGain(); s.gain.value = o.slap; head.connect(s); s.connect(slapSend); }
  return g;
}
function filt(src, o) {
  let n = src;
  if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = o.q || 0.7; n.connect(f); n = f; }
  if (o.hp) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = o.hp; f.Q.value = 0.7; n.connect(f); n = f; }
  return n;
}
const lastPick = {};
// a recorded layer: a random take of a group, pitched, trimmed and shaped
function smp(name, o) {
  o = o || {};
  let id = name;
  if (GROUPS[name]) { let i; do { i = Math.floor(Math.random() * GROUPS[name]); } while (GROUPS[name] > 1 && i === lastPick[name]); lastPick[name] = i; id = name + '_' + i; }
  const b = BUF[id]; if (!b) return false;
  const t = o.at || now(), s = ctx.createBufferSource(), g = chain(o);
  s.buffer = b;
  const rate = (o.rate || 1) * (1 + (o.jit == null ? 0.04 : o.jit) * (Math.random() * 2 - 1));
  s.playbackRate.setValueAtTime(rate, t);
  if (o.rate1) s.playbackRate.exponentialRampToValueAtTime(o.rate1, t + (o.dur || b.duration / rate));
  if (o.loop) s.loop = true;
  filt(s, o).connect(g);
  const vol = o.gain == null ? 1 : o.gain, att = o.a || 0.001;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + att);
  const len = o.dur || (b.duration - (o.off || 0)) / rate;
  if (o.dur) { g.gain.setValueAtTime(vol, t + Math.max(att, len - (o.rel || 0.12))); g.gain.linearRampToValueAtTime(0.0001, t + len); }
  s.start(t, o.off || 0); s.stop(t + len + 0.05);
  return true;
}
function tone(o) {
  const t = o.at || now(), osc = ctx.createOscillator(), g = chain(o);
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(o.f0, t);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + (o.glide || o.dur));
  if (o.vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = o.vib; lg.gain.value = o.vibAmt || 20; l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + o.dur + 0.2); }
  filt(osc, o).connect(g);
  const a = o.a || 0.004;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain || 0.3), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + o.dur);
  osc.start(t); osc.stop(t + a + o.dur + 0.05);
}
function noise(o) {
  const t = o.at || now(), src = ctx.createBufferSource(), g = chain(o);
  src.buffer = NOISE; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = o.type || 'lowpass'; f.Q.value = o.q || 0.7;
  f.frequency.setValueAtTime(o.f0 || 1000, t);
  if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + (o.glide || o.dur));
  src.connect(f); f.connect(g);
  const a = o.a || 0.003;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain || 0.3), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + o.dur);
  src.start(t, Math.random() * 1.5); src.stop(t + a + o.dur + 0.05);
}
// the low-frequency weight under every big sound: a pitched-down sine kick, felt more than heard
const sub = (t, p, g, f0, dur) => tone({ at: t, f0: f0 || 72, f1: (f0 || 72) * 0.42, dur: dur || 0.35, gain: g, pan: p * 0.3, a: 0.003 });
// music dips under the biggest moments, then comes back
function duck(amount, hold) {
  const t = now(), g = duckG.gain;
  g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(1 - amount, t + 0.05);
  g.setValueAtTime(1 - amount, t + hold); g.linearRampToValueAtTime(1, t + hold + 1.2);
}

/* ---------- weapons ---------- */
// mech guns are rifles and shotguns played lower and heavier: a breech clank first, then the shot, a sub, the echo
const breech = (t, p, r) => smp('hit_metal_m', { at: t - 0.035, rate: r || 0.55, gain: 0.25, pan: p, lp: 2500 });
// a volley is rebuilt round by round, in step with the animation: every round but the last is cut short so the
// next one takes over, and only the last rings out into the echo
const each = (o, fn) => { const n = (o && o.n) || 1, gap = (o && o.gap) || 0; for (let i = 0; i < n; i++) fn(i, i * gap, i === n - 1, n); };
const FIRE = {
  ballistic: (t, p, o) => { breech(t, p); each(o, (i, d, last) => { smp('gun_rifle', { at: t + d, rate: 0.62, gain: i ? 0.8 : 1, pan: p, slap: last ? 0.6 : 0.25, dur: last ? 0 : 0.22, rel: 0.08 }); sub(t + d, p, i ? 0.3 : 0.55, 80, 0.25); }); },
  w_smg: (t, p, o) => { if ((o && o.n || 1) < 2) { smp('gun_smg', { at: t, rate: 0.86, gain: 0.9, pan: p, slap: 0.5 }); return; } each(o, (i, d, last) => { smp('gun_round', { at: t + d, rate: 1.08, gain: 0.75, pan: p, slap: last ? 0.5 : 0.15, dur: last ? 0 : 0.1, rel: 0.04 }); if (!(i % 2)) sub(t + d, p, 0.2, 95, 0.12); }); },
  w_gatling: (t, p, o) => {
    // the barrels spin up, every round cracks out at the cyclic rate, then the motor winds down
    const n = (o && o.n) || 1, span = (n - 1) * ((o && o.gap) || 0);
    smp('loop_servo', { at: t - 0.35, rate: 1.0, rate1: 2.6, dur: 0.4, gain: 0.3, pan: p, a: 0.2, rel: 0.05 });
    smp('loop_servo', { at: t - 0.02, loop: true, rate: 2.6, dur: span + 0.1, gain: 0.25, pan: p, a: 0.02, rel: 0.05 });
    smp('loop_servo', { at: t + span + 0.05, rate: 2.6, rate1: 0.9, dur: 0.6, gain: 0.28, pan: p, a: 0.02, rel: 0.4 });
    if (n < 2) { smp('gun_auto', { at: t, rate: 0.82, gain: 1, pan: p, slap: 0.5 }); return; }
    each(o, (i, d, last) => { smp('gun_round', { at: t + d, rate: 0.84, jit: 0.05, gain: 0.85, pan: p, slap: last ? 0.6 : 0.2, dur: last ? 0 : 0.11, rel: 0.04 }); if (i % 3 === 0) sub(t + d, p, 0.3, 82, 0.15); });
  },
  w_scatter: (t, p) => { breech(t, p, 0.45); smp('gun_shotgun', { at: t, rate: 0.74, gain: 1, pan: p, slap: 0.7 }); sub(t, p, 0.65, 66, 0.4); },
  w_rail: (t, p) => {
    // capacitors whine up, a magnetic crack, a heavy report and a supersonic tear
    tone({ at: t - 0.55, f0: 240, f1: 3400, dur: 0.55, gain: 0.07, type: 'sawtooth', lp: 4200, pan: p, a: 0.3 });
    smp('field', { at: t - 0.5, rate: 1.6, gain: 0.35, pan: p, dur: 0.5, a: 0.2 });
    noise({ at: t, f0: 7000, type: 'highpass', dur: 0.05, gain: 0.6, pan: p });
    smp('gun_rifle', { at: t, rate: 0.48, gain: 1, pan: p, slap: 0.9 }); smp('laser_l', { at: t, rate: 0.55, gain: 0.55, pan: p, wet: 0.3 });
    sub(t, p, 0.8, 60, 0.55);
  },
  energy: (t, p) => { smp('laser_l', { at: t, rate: 1.0, jit: 0.07, gain: 0.85, pan: p, wet: 0.25 }); tone({ at: t, f0: 1800, f1: 420, dur: 0.12, gain: 0.05, type: 'square', lp: 3000, pan: p }); sub(t, p, 0.2, 110, 0.12); },
  w_lance: (t, p) => { smp('field', { at: t - 0.3, rate: 1.2, gain: 0.3, pan: p, dur: 0.3, a: 0.2 }); smp('laser_l', { at: t, rate: 0.58, gain: 1, pan: p, wet: 0.4 }); smp('laser_l', { at: t + 0.01, rate: 0.72, gain: 0.5, pan: p }); sub(t, p, 0.6, 70, 0.4); },
  w_arc: (t, p) => { for (let i = 0; i < 10; i++) noise({ at: t + Math.random() * 0.3, f0: 2500 + Math.random() * 4000, type: 'bandpass', q: 5, dur: 0.02, gain: 0.4, pan: p }); smp('field', { at: t, rate: 2.0, gain: 0.5, pan: p, dur: 0.35 }); smp('laser_s', { at: t, rate: 0.8, gain: 0.5, pan: p }); },
  // each missile in the rack: an ignition pop as it leaves the tube, then its own motor roaring away
  missile: (t, p, o) => each(o, (i, d) => {
    smp('gun_shotgun', { at: t + d, rate: 0.55, jit: 0.08, gain: 0.4, pan: p, lp: 1800 });
    smp('loop_thruster', { at: t + d, rate: 1.05 + i * 0.06, jit: 0.05, dur: 0.6, gain: 0.55, pan: p, a: 0.015, rel: 0.4, slap: 0.3 });
    sub(t + d, p, i ? 0.2 : 0.4, 70, 0.25);
  }),
  artillery: (t, p) => { breech(t, p, 0.4); smp('gun_shotgun', { at: t, rate: 0.42, gain: 1, pan: p, slap: 1 }); smp('boom_low', { at: t, rate: 1.1, gain: 0.8, pan: p }); sub(t, p, 0.9, 55, 0.7); },
  turret: (t, p, o) => { smp('boom_low', { at: t, rate: 1.3, gain: 0.5, pan: p }); each(o, (i, d, last) => { smp('gun_rifle', { at: t + d, rate: 0.5, gain: i ? 0.8 : 1, pan: p, slap: last ? 0.8 : 0.3, dur: last ? 0 : 0.2, rel: 0.06 }); sub(t + d, p, i ? 0.35 : 0.7, 62, 0.3); }); },
  melee: (t, p) => { noise({ at: t, f0: 4200, f1: 700, dur: 0.18, type: 'bandpass', q: 1.2, gain: 0.45, pan: p }); smp('loop_servo', { at: t - 0.1, rate: 2.2, dur: 0.25, gain: 0.25, pan: p, a: 0.05 }); },
  siege: (t, p) => { smp('hiss_close', { at: t - 0.15, rate: 0.8, gain: 0.5, pan: p }); noise({ at: t, f0: 900, f1: 250, dur: 0.25, gain: 0.35, pan: p }); },
  support: (t, p) => { smp('field', { at: t, rate: 1.5, gain: 0.4, pan: p, wet: 0.5 }); [0, 0.07, 0.14].forEach((d, i) => tone({ at: t + d, f0: [880, 1175, 1480][i], dur: 0.3, gain: 0.05, type: 'triangle', pan: p, wet: 0.5 })); },
  incendiary: (t, p) => { smp('loop_thruster', { at: t, rate: 0.75, dur: 0.7, gain: 0.9, pan: p, a: 0.04, rel: 0.4, wet: 0.2 }); for (let i = 0; i < 6; i++) noise({ at: t + 0.1 + Math.random() * 0.5, f0: 4000, type: 'bandpass', q: 3, dur: 0.02, gain: 0.2, pan: p }); },
  cryo: (t, p) => { noise({ at: t, f0: 7000, f1: 2500, type: 'highpass', dur: 0.45, gain: 0.35, pan: p, wet: 0.3 }); smp('ui_glass_002', { at: t + 0.05, rate: 0.6, gain: 0.5, pan: p, wet: 0.5 }); smp('field', { at: t, rate: 1.8, gain: 0.3, pan: p }); },
  shock: (t, p) => { smp('field', { at: t, rate: 0.5, gain: 0.7, pan: p, wet: 0.4 }); tone({ at: t, f0: 60, f1: 30, dur: 0.6, gain: 0.3, type: 'sawtooth', lp: 400, pan: p }); }
};
const WID = { b_gun: 'ballistic', s_emp: 'shock', s_inferno: 'incendiary', s_cryo: 'cryo', w_howitzer: 'artillery', w_missile: 'missile', s_railgun: 'w_rail' };
function fire(o) {
  const t = now() + (o.delay || 0) + 0.04, p = o.pan || 0;
  (FIRE[o.wid] || FIRE[WID[o.wid]] || FIRE[o.cat] || FIRE.ballistic)(t, p, o);
}
function impact(o) {
  const t = now() + (o.delay || 0) + 0.04, p = o.pan || 0, cat = o.cat || 'ballistic';
  // a volley lands round by round: every missile its own fireball, every bullet its own strike
  if ((o.n || 1) > 1) {
    const missile = cat === 'missile';
    each(o, (i, d) => {
      const at = t + d, q = p + rnd(-0.08, 0.08);
      if (missile) {
        smp('expl', { at, rate: rnd(0.85, 1.1), gain: o.hit ? 0.8 : 0.55, pan: q, slap: 0.4, wet: 0.15, lp: o.hit ? 0 : 3200 });
        sub(at, q, i ? 0.35 : 0.6, 58, 0.5);
        if (o.hit) smp('hit_metal_h', { at, rate: 0.7, gain: 0.35, pan: q });
        if (!i) duck(0.3, 0.4 + (o.n - 1) * o.gap);
      } else if (o.hit) {
        smp(i % 2 ? 'hit_metal_m' : 'hit_metal_h', { at, rate: rnd(0.8, 1.1), gain: 0.45, pan: q });
        if (Math.random() < 0.3) smp('tin', { at: at + 0.03, rate: rnd(0.9, 1.3), gain: 0.18, pan: q });
      } else {
        smp('punch_h', { at, rate: rnd(1.3, 1.7), gain: 0.25, pan: q, lp: 1800 });
        if (Math.random() < 0.3) tone({ at, f0: rnd(2600, 3600), f1: rnd(900, 1300), dur: 0.22, gain: 0.03, pan: q, wet: 0.3 });
      }
    });
    return;
  }
  if (!o.hit) {
    // a near miss: a supersonic whip past, then dirt
    tone({ at: t, f0: rnd(2600, 3600), f1: rnd(900, 1300), dur: 0.25, gain: 0.04, pan: p, wet: 0.3 });
    smp('punch_h', { at: t + 0.04, rate: 1.4, gain: 0.35, pan: p, lp: 1800 });
    if (cat === 'missile' || cat === 'artillery') { smp('expl', { at: t, rate: 0.95, gain: 0.6, pan: p, slap: 0.5, lp: 3500 }); sub(t, p, 0.5, 55, 0.6); }
    return;
  }
  if (cat === 'energy' || cat === 'cryo') { smp('hit_metal_m', { at: t, rate: 1.15, gain: 0.7, pan: p }); noise({ at: t, f0: 4500, f1: 1200, type: 'bandpass', q: 1.3, dur: 0.3, gain: 0.3, pan: p }); }
  else if (cat === 'incendiary') { smp('loop_thruster', { at: t, rate: 0.6, dur: 0.8, gain: 0.7, pan: p, rel: 0.5 }); smp('hit_metal_m', { at: t, rate: 0.8, gain: 0.4, pan: p }); }
  else if (cat === 'missile' || cat === 'turret') { smp('expl', { at: t, rate: 1.0, gain: 1, pan: p, slap: 0.6, wet: 0.2 }); smp('hit_metal_h', { at: t, rate: 0.7, gain: 0.5, pan: p }); sub(t, p, 0.6, 60, 0.6); }
  else if (cat === 'artillery') { smp('expl', { at: t, rate: 0.85, gain: 1, pan: p, slap: 0.8, wet: 0.3 }); smp('boom_low', { at: t, rate: 0.9, gain: 0.8, pan: p }); smp('tin', { at: t + 0.35, rate: 0.7, gain: 0.3, pan: p }); sub(t, p, 0.8, 50, 0.9); duck(0.35, 0.3); }
  else if (cat === 'melee') { smp('clang_low', { at: t, rate: 0.9, gain: 0.9, pan: p, wet: 0.2 }); smp('hit_metal_h', { at: t, rate: 0.75, gain: 0.8, pan: p }); smp('punch_h', { at: t, rate: 0.7, gain: 0.6, pan: p }); }
  else if (cat === 'siege') { smp('punch_h', { at: t, rate: 0.55, gain: 1, pan: p }); smp('clang_low', { at: t + 0.01, rate: 0.6, gain: 0.8, pan: p, wet: 0.3 }); smp('boom_low', { at: t, rate: 1.4, gain: 0.5, pan: p }); }
  else if (cat === 'support') { smp('field', { at: t, rate: 1.8, gain: 0.3, pan: p, wet: 0.5 }); }
  else { smp('hit_metal_h', { at: t, rate: 0.85, gain: 0.85, pan: p }); smp('plate_h', { at: t, rate: 0.9, gain: 0.45, pan: p }); if (Math.random() < 0.5) smp('tin', { at: t + 0.06, rate: 1.1, gain: 0.25, pan: p }); }
}

/* ---------- movement ---------- */
// a mech step: a low thud, a heavy plate, a servo between steps and a hydraulic sigh on every other one
function walk(o) {
  const t0 = now() + (o.delay || 0), steps = Math.max(1, o.steps || 1), dur = o.dur || steps * 0.4, p = o.pan || 0, mode = o.mode;
  if (mode === 'hover') {
    smp('loop_hover', { at: t0, loop: true, dur: dur + 0.3, rate: 0.9, rate1: 1.05, gain: 0.55, pan: p, a: 0.15, rel: 0.3 });
    noise({ at: t0, f0: 600, f1: 1400, dur, gain: 0.08, type: 'bandpass', pan: p, a: 0.1 });
    return;
  }
  if (mode === 'tracks') {
    smp('loop_engine_low', { at: t0, loop: true, dur: dur + 0.3, rate: 0.85, gain: 0.7, pan: p, a: 0.2, rel: 0.3 });
    for (let i = 0; i < steps * 4; i++) smp('tin', { at: t0 + (i + 0.5) * dur / (steps * 4), rate: rnd(0.55, 0.7), gain: 0.18, pan: p, lp: 3000 });
    return;
  }
  const w = mode === 'entrench' ? 0.7 : o.heavy ? 0.8 : 1;   // heavier frames step lower
  for (let i = 0; i < steps; i++) {
    const t = t0 + (i + 0.55) * dur / steps;
    smp('loop_servo', { at: t - 0.22, rate: 1.1 / w, dur: 0.2, gain: 0.18, pan: p, a: 0.05, rel: 0.08 });
    smp('punch_h', { at: t, rate: 0.55 * w, gain: 0.7, pan: p });
    smp('plate_h', { at: t + 0.005, rate: 0.75 * w, gain: 0.55, pan: p, lp: 4500 });
    sub(t, p, 0.35 / w, 70 * w, 0.22);
    if (i % 2) smp('hiss_close', { at: t + 0.08, rate: 1.3, gain: 0.12, pan: p, hp: 1500 });
  }
}
function jump(o) {
  const t = now() + (o.delay || 0), dur = o.dur || 0.5, p = o.pan || 0;
  smp('loop_thruster', { at: t, rate: 1.0, dur: dur * 0.8 + 0.1, gain: 0.9, pan: p, a: 0.04, rel: 0.25, slap: 0.3 });
  sub(t, p, 0.3, 60, 0.3);
  smp('punch_h', { at: t + dur, rate: 0.5, gain: 0.9, pan: p }); smp('clang_low', { at: t + dur, rate: 0.8, gain: 0.5, pan: p }); sub(t + dur, p, 0.6, 62, 0.35);
}

/* ---------- named effects ---------- */
function explosion(t, p, big) {
  smp(big ? 'expl_big' : 'expl', { at: t, rate: big ? 0.75 : 0.9, gain: 1, pan: p, slap: 0.8, wet: 0.35 });
  smp('expl', { at: t + 0.02, rate: 0.7, gain: 0.7, pan: -p * 0.3, lp: 2500 });
  smp('boom_low', { at: t, rate: big ? 0.75 : 0.95, gain: 1, pan: p });
  sub(t, p, 1, big ? 48 : 58, big ? 1.4 : 0.9);
  smp('clang_low', { at: t + 0.25, rate: 0.7, gain: 0.35, pan: p + 0.2 });
  for (let i = 0; i < 3; i++) smp('tin', { at: t + 0.5 + i * rnd(0.12, 0.3), rate: rnd(0.6, 1), gain: 0.15, pan: p + rnd(-0.3, 0.3) });
  duck(big ? 0.6 : 0.4, big ? 1.2 : 0.5);
}
const FX = {
  deploy: (t, p) => { smp('loop_thruster', { at: t, rate: 0.8, dur: 0.55, gain: 0.6, pan: p, a: 0.08, rel: 0.25 }); smp('punch_h', { at: t + 0.55, rate: 0.45, gain: 1, pan: p }); smp('clang_low', { at: t + 0.56, rate: 0.7, gain: 0.7, pan: p, wet: 0.2 }); sub(t + 0.55, p, 0.8, 55, 0.5); smp('hiss_open', { at: t + 0.75, rate: 0.9, gain: 0.35, pan: p }); },
  enter: (t, p) => { smp('hiss_close', { at: t, rate: 0.85, gain: 0.5, pan: p }); smp('loop_thruster', { at: t + 0.1, rate: 0.9, rate1: 1.3, dur: 0.6, gain: 0.45, pan: p, a: 0.1, rel: 0.3 }); },
  brace: (t, p) => { smp('hiss_close', { at: t, rate: 0.75, gain: 0.55, pan: p }); smp('clang_low', { at: t + 0.12, rate: 0.75, gain: 0.8, pan: p }); smp('plate_h', { at: t + 0.12, rate: 0.6, gain: 0.6, pan: p }); smp('hit_metal_h', { at: t + 0.3, rate: 0.6, gain: 0.5, pan: p }); sub(t + 0.12, p, 0.4, 70, 0.3); },
  boom: (t, p) => explosion(t, p, false),
  charge: (t, p) => { tone({ at: t, f0: 120, f1: 2400, dur: 0.75, gain: 0.08, type: 'sawtooth', lp: 3000, pan: p, a: 0.4, vib: 14, vibAmt: 40 }); smp('field', { at: t, rate: 0.8, rate1: 2, dur: 0.75, gain: 0.5, pan: p, a: 0.3 }); },
  nuke: (t, p) => { explosion(t, p, true); smp('expl', { at: t + 0.15, rate: 0.6, gain: 0.8, pan: 0, wet: 0.6 }); sub(t, 0, 1, 40, 2.2); },
  strip: (t, p) => { for (let i = 0; i < 5; i++) smp('tin', { at: t + i * 0.08, rate: rnd(0.9, 1.3), gain: 0.3, pan: p }); smp('hiss_open', { at: t + 0.1, gain: 0.3, pan: p }); smp('clang_low', { at: t + 0.45, rate: 1.1, gain: 0.5, pan: p }); },
  capture: (t, p, o) => { const mine = !o || o.mine !== false; smp(mine ? 'ui_confirmation_002' : 'ui_confirmation_004', { at: t, rate: mine ? 1 : 0.75, gain: 0.7, pan: p, wet: 0.4 }); smp('field', { at: t, rate: mine ? 0.9 : 0.6, gain: 0.35, pan: p, wet: 0.5 }); sub(t, p, 0.3, 90, 0.4); },
  drop: (t, p) => { tone({ at: t, f0: 1700, f1: 380, dur: 0.6, gain: 0.04, pan: p, wet: 0.3 }); smp('punch_h', { at: t + 0.62, rate: 0.6, gain: 0.9, pan: p }); smp('plate_h', { at: t + 0.63, rate: 0.8, gain: 0.6, pan: p }); sub(t + 0.62, p, 0.5, 70, 0.3); [0.85, 1.0].forEach(d => smp('ui_tick_002', { at: t + d, rate: 1.2, gain: 0.6, pan: p })); },
  vp: t => { smp('ui_confirmation_004', { at: t, rate: 1.2, gain: 0.6, wet: 0.4 }); smp('ui_glass_002', { at: t + 0.12, rate: 1.1, gain: 0.5, wet: 0.5 }); [1047, 1319, 1568].forEach((f, i) => tone({ at: t + 0.1 + i * 0.07, f0: f, dur: 0.5, gain: 0.03, type: 'triangle', wet: 0.6 })); },
  overclock: (t, p) => { smp('loop_servo', { at: t, rate: 0.8, rate1: 2.6, dur: 0.6, gain: 0.5, pan: p, a: 0.05, rel: 0.15 }); tone({ at: t, f0: 160, f1: 1300, dur: 0.6, gain: 0.05, type: 'sawtooth', lp: 3000, pan: p }); smp('hiss_open', { at: t + 0.55, rate: 1.3, gain: 0.3, pan: p }); },
  phase: (t, p) => { smp('field', { at: t, rate: 1.4, rate1: 0.5, dur: 0.35, gain: 0.7, pan: p, wet: 0.6 }); tone({ at: t, f0: 900, f1: 120, dur: 0.3, gain: 0.08, pan: p, vib: 25, vibAmt: 120, wet: 0.5 }); smp('field', { at: t + 0.32, rate: 0.5, rate1: 1.6, dur: 0.35, gain: 0.7, pan: p, wet: 0.6 }); smp('punch_h', { at: t + 0.6, rate: 0.7, gain: 0.5, pan: p }); },
  cloak: (t, p) => { smp('field', { at: t, rate: 1.1, rate1: 0.6, dur: 0.7, gain: 0.6, pan: p, wet: 0.6 }); noise({ at: t, f0: 9000, f1: 1500, type: 'highpass', dur: 0.7, gain: 0.1, pan: p, wet: 0.5 }); },
  overwatch: (t, p) => { smp('ui_switch_002', { at: t, gain: 0.7, pan: p }); smp('loop_servo', { at: t + 0.05, rate: 1.6, dur: 0.3, gain: 0.25, pan: p, a: 0.05 }); tone({ at: t + 0.35, f0: 1320, dur: 0.07, gain: 0.04, type: 'square', lp: 3000, pan: p }); tone({ at: t + 0.45, f0: 1320, dur: 0.07, gain: 0.04, type: 'square', lp: 3000, pan: p }); },
  heal: (t, p) => { smp('field', { at: t, rate: 1.7, gain: 0.35, pan: p, wet: 0.5 }); [659, 880, 1109].forEach((f, i) => tone({ at: t + i * 0.08, f0: f, dur: 0.35, gain: 0.035, type: 'triangle', pan: p, wet: 0.5 })); },
  pickup: (t, p) => { smp('ui_drop_002', { at: t, gain: 0.7, pan: p }); smp('ui_pluck_001', { at: t + 0.08, rate: 1.2, gain: 0.5, pan: p, wet: 0.3 }); },
  hot: (t, p) => { smp('hiss_open', { at: t, rate: 0.7, gain: 0.5, pan: p }); tone({ at: t, f0: 140, dur: 0.12, gain: 0.06, type: 'square', lp: 900, pan: p }); },
  // interface: recorded clicks with a soft low body so they feel physical
  click: t => smp('ui_click_002', { at: t, gain: 0.6 }),
  tab: t => smp('ui_tick_002', { at: t, gain: 0.6 }),
  select: t => smp('ui_select_002', { at: t, gain: 0.7 }),
  aim: t => smp('ui_switch_002', { at: t, gain: 0.6 }),
  confirm: t => { smp('ui_confirmation_002', { at: t, gain: 0.7 }); sub(t, 0, 0.15, 110, 0.15); },
  back: t => smp('ui_back_002', { at: t, gain: 0.6 }),
  error: t => smp('ui_error_004', { at: t, gain: 0.7 }),
  panel: t => smp('ui_open_002', { at: t, gain: 0.6 }),
  draw: t => { smp('ui_maximize_002', { at: t, gain: 0.5 }); noise({ at: t, f0: 2500, f1: 6000, dur: 0.12, gain: 0.08, type: 'bandpass', a: 0.02 }); },
  install: t => { smp('loop_servo', { at: t, rate: 1.8, dur: 0.18, gain: 0.3, a: 0.03 }); smp('clang_low', { at: t + 0.18, rate: 1.3, gain: 0.6 }); smp('hit_metal_m', { at: t + 0.18, rate: 1, gain: 0.5 }); smp('hiss_close', { at: t + 0.25, rate: 1.5, gain: 0.15, hp: 1500 }); },
  remove: t => { smp('ui_minimize_002', { at: t, gain: 0.5 }); smp('hit_metal_m', { at: t + 0.05, rate: 1.2, gain: 0.4 }); },
  repair: t => { for (let i = 0; i < 4; i++) smp('tin', { at: t + i * 0.09, rate: rnd(1.2, 1.6), gain: 0.3 }); FX.heal(t + 0.35, 0); },
  scrap: t => { smp('hit_metal_h', { at: t, rate: 0.7, gain: 0.6 }); smp('tin', { at: t + 0.08, rate: 0.8, gain: 0.4 }); smp('tin', { at: t + 0.2, rate: 0.9, gain: 0.3 }); }
};
function play(name, o) {
  if (!live()) return;
  o = o || {};
  try {
    if (name === 'fire') return fire(o);
    if (name === 'impact') return impact(o);
    if (name === 'walk') return walk(o);
    if (name === 'jump') return jump(o);
    const f = FX[name]; if (f) f(now() + (o.delay || 0) + 0.02, o.pan || 0, o);
  } catch (e) { /* a sound never breaks the game */ }
}

/* ---------- music: recorded tracks, streamed, crossfading with the phase of the war ---------- */
const TRK = {};
let want = null, cur = null;
function track(k) {
  if (TRK[k]) return TRK[k];
  const el = new Audio(BASE + TRACKS[k] + '.mp3'); el.loop = true; el.preload = 'auto'; el.crossOrigin = 'anonymous';
  const g = ctx.createGain(); g.gain.value = 0;
  ctx.createMediaElementSource(el).connect(g); g.connect(musBus);
  return (TRK[k] = { el, g, on: false });
}
function music(m) {
  want = m || null;
  if (!ctx || ctx.state !== 'running') return;
  if (cur === want) return;
  const t = now();
  // the old track fades out and pauses; the new one fades in from where it last left off
  if (cur && TRK[cur]) { const o = TRK[cur]; o.on = false; o.g.gain.cancelScheduledValues(t); o.g.gain.setValueAtTime(o.g.gain.value, t); o.g.gain.linearRampToValueAtTime(0, t + 1.8); setTimeout(() => { if (!o.on) o.el.pause(); }, 2000); }
  cur = want;
  if (!want) return;
  const n = track(want); n.on = true;
  n.g.gain.cancelScheduledValues(t); n.g.gain.setValueAtTime(n.g.gain.value, t); n.g.gain.linearRampToValueAtTime(want === 'menu' ? 0.8 : 1, t + 2.2);
  n.el.play().catch(() => {});
}

/* ---------- stings ---------- */
function sting(name) {
  if (!live()) return;
  const t = now() + 0.02;
  if (name === 'round') { smp('boom_low', { at: t, rate: 1.2, gain: 0.5 }); smp('hiss_open', { at: t, rate: 0.6, gain: 0.25, wet: 0.5 }); smp('ui_open_002', { at: t + 0.05, rate: 0.7, gain: 0.4, wet: 0.4 }); }
  else if (name === 'combat') { smp('boom_low', { at: t, rate: 0.9, gain: 0.9 }); smp('expl', { at: t, rate: 0.6, gain: 0.45, lp: 1800, wet: 0.5 }); smp('clang_low', { at: t + 0.02, rate: 0.6, gain: 0.6, wet: 0.5 }); sub(t, 0, 0.8, 50, 1.2); duck(0.5, 0.6); }
  else if (name === 'victory') smp('mus_victory', { at: t, gain: 0.8, bus: musBus });
  else if (name === 'defeat') smp('mus_defeat', { at: t, gain: 0.8, bus: musBus });
  else if (name === 'turn') smp('ui_select_006', { at: t, gain: 0.5 });
}

function set(k, v) { prefs[k] = v; save(); applyPrefs(); if (k === 'mute' && !v) unlock(); }
root.SFX = { play, music, sting, set, prefs, unlock, get ready() { return live(); }, get loaded() { return Object.keys(BUF).length; } };
})(typeof window !== 'undefined' ? window : globalThis);
