/* Mecha Warfare — 3D presentation layer (three.js r128).
   The battle map as an isometric floating diorama of a ruined colony city, the hangar gantry
   viewer, mecha models assembled from their fitted parts, and every combat effect.
   Rules live in engine.js; this file only draws what the state says. */
(function () {
'use strict';
const R3 = { ok: false };
window.R3 = R3;
const T = window.THREE;
if (!T) return;
try { const c = document.createElement('canvas'); if (!(c.getContext('webgl') || c.getContext('experimental-webgl'))) return; } catch (e) { return; }
R3.ok = true;

let LEVEL = 'full';
R3.setLevel = l => { LEVEL = l === 'low' ? 'low' : 'full'; };
const rand = (a, b) => a + Math.random() * (b - a);
const clock = () => performance.now() / 1000;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

/* ================= palette ================= */
const TEAM = [
  { main: 0xb4b6b4, second: 0x4a6a8a, accent: 0x7e4a40, trim: 0xb59a55, dark: 0x2f353d, eye: 0x9cc9b4, glow: 0x8fb8cc, ring: 0x6a90b4 },
  { main: 0x8a5145, second: 0x45484d, accent: 0xa87048, trim: 0xb59a55, dark: 0x2a2c30, eye: 0xc98a6a, glow: 0xc48a68, ring: 0xb87a58 }
];
const INK = 0x141920;
const GUN = 0x3b414a, GUN2 = 0x272b32;
const CORE_GLOW = { b_core: 0x9fd8b4, c_compact: 0x96cfd8, c_fusion: 0xd6e2e6, c_heavy: 0xd89a5c, c_sing: 0xa98cc4, s_core: 0xd8bf80 };
const FX_COL = { ballistic: 0xe8c98a, energy: 0x9cd6dc, missile: 0xe0a878, artillery: 0xe2b77e, melee: 0xd58fb8, siege: 0xd89a6e, support: 0x9fd8b4, incendiary: 0xe08548, cryo: 0xb8dce4, turret: 0xd88468 };

/* ================= materials and shapes ================= */
const gradMap = (() => {
  const d = new Uint8Array([128, 128, 128, 255, 186, 186, 186, 255, 238, 238, 238, 255]);
  const t = new T.DataTexture(d, 3, 1, T.RGBAFormat);
  t.minFilter = t.magFilter = T.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
})();
const MAT = {};
function toon(color) { return MAT['t' + color] || (MAT['t' + color] = new T.MeshToonMaterial({ color, gradientMap: gradMap })); }
// the same paint with a warm glow, for the part picked in the hangar
function lit(mat) { const k = 'l' + mat.uuid; if (!MAT[k]) { MAT[k] = mat.clone(); MAT[k].emissive = new T.Color(0x8a5c00); } return MAT[k]; }
function glow(color, op) { const k = 'g' + color + ':' + (op || 1); return MAT[k] || (MAT[k] = new T.MeshBasicMaterial({ color, transparent: op != null && op < 1, opacity: op == null ? 1 : op, depthWrite: !(op < 1) })); }
const GHOST = new T.MeshBasicMaterial({ color: 0x6fd8ff, transparent: true, opacity: 0.22, depthWrite: false });
const GHOST_SEL = new T.MeshBasicMaterial({ color: 0xffc83a, transparent: true, opacity: 0.4, depthWrite: false });
const GEO = {};
const geo = (k, make) => GEO[k] || (GEO[k] = make());
const box = (w, h, d) => geo('b' + w + ',' + h + ',' + d, () => new T.BoxGeometry(w, h, d));
const cyl = (rt, rb, h, s) => geo('c' + rt + ',' + rb + ',' + h + ',' + (s || 10), () => new T.CylinderGeometry(rt, rb, h, s || 10));
const cone = (r, h, s) => geo('o' + r + ',' + h + ',' + (s || 10), () => new T.ConeGeometry(r, h, s || 10));
const sph = (r, s) => geo('s' + r + ',' + (s || 12), () => new T.SphereGeometry(r, s || 12, Math.max(6, Math.round((s || 12) * 0.7))));
const tor = (r, t, arc) => geo('t' + r + ',' + t + ',' + (arc || 0), () => new T.TorusGeometry(r, t, 6, 28, arc || Math.PI * 2));
const oct = r => geo('x' + r, () => new T.OctahedronGeometry(r, 0));
function outline(m) { if (m.material !== GHOST) m.userData.ink = true; }

/* ================= silhouette ink =================
   Each object (a mech, a building, a crate) is drawn into a mask in its own flat ID colour; a screen pass
   then inks only the pixels where two different IDs meet. Parts of the same object never get lines
   between them, so only the outer silhouette is drawn. Ground pieces share one ID so tiles stay clean. */
const ID_MATS = new Map();
// blue channel marks the picked part, which gets its own gold silhouette
function idMat(id, hot) {
  const k = id * 2 + (hot ? 1 : 0);
  let m = ID_MATS.get(k);
  if (!m) { m = new T.MeshBasicMaterial({ color: new T.Color((id % 256) / 255, Math.floor(id / 256) % 256 / 255, hot ? 1 : 0), fog: false }); ID_MATS.set(k, m); }
  return m;
}
const INK_VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const INK_FS = [
  'uniform sampler2D tMask; uniform vec2 px; uniform vec3 ink; uniform float alpha; varying vec2 vUv;',
  'float idAt(vec2 o) { vec4 c = texture2D(tMask, vUv + o * px); return floor(c.r * 255.0 + 0.5) + floor(c.g * 255.0 + 0.5) * 256.0 + step(0.5, c.b) * 65536.0; }',
  'void main() {',
  '  float c = idAt(vec2(0.0)); float e = 0.0; float h = step(65536.0, c);',
  '  for (int i = 0; i < 8; i++) { float a = float(i) * 0.7853982; float n = idAt(vec2(cos(a), sin(a)));',
  '    if (abs(n - c) > 0.5) { e = 1.0; h = max(h, step(65536.0, n)); } }',
  '  for (int i = 0; i < 8; i++) { float a = float(i) * 0.7853982 + 0.39; float n = idAt(2.0 * vec2(cos(a), sin(a)));',
  '    if (abs(n - c) > 0.5 && (n >= 65536.0 || c >= 65536.0)) { e = 1.0; h = 1.0; } }',
  '  if (e < 0.5) discard;',
  '  gl_FragColor = vec4(mix(ink, vec3(1.0, 0.78, 0.23), h), max(alpha, h));',
  '}'].join('\n');
const inkV2 = new T.Vector2(), inkCol = new T.Color();
function inkPass(renderer, scene, cam, top, st) {
  renderer.getDrawingBufferSize(inkV2);
  if (!st.rt || st.rt.width !== inkV2.x || st.rt.height !== inkV2.y) {
    if (st.rt) st.rt.dispose();
    st.rt = new T.WebGLRenderTarget(inkV2.x, inkV2.y, { minFilter: T.NearestFilter, magFilter: T.NearestFilter, format: T.RGBAFormat });
    if (!st.quad) {
      st.mat = new T.ShaderMaterial({ uniforms: { tMask: { value: null }, px: { value: new T.Vector2() }, ink: { value: new T.Color(INK) }, alpha: { value: st.alpha || 1 } }, vertexShader: INK_VS, fragmentShader: INK_FS, depthTest: false, depthWrite: false, transparent: true });
      st.quad = new T.Mesh(new T.PlaneGeometry(2, 2), st.mat); st.quad.frustumCulled = false;
      st.qs = new T.Scene(); st.qs.add(st.quad); st.qc = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    }
    // line weight: about 1.5 css pixels whatever the screen density
    const w = Math.max(1, renderer.getPixelRatio() * (st.weight || 1.3));
    st.mat.uniforms.px.value.set(w / inkV2.x, w / inkV2.y);
    st.mat.uniforms.tMask.value = st.rt.texture;
  }
  const swaps = [], hidden = [];
  scene.traverse(o => {
    if (!o.visible) return;
    if (o.isMesh && !o.material.transparent && !o.userData.noInk) {
      let p = o; while (p.parent && p.parent !== top && p.parent !== scene) p = p.parent;
      const id = o.userData.ground || p.userData.ground ? 1 : 2 + (p.id % 60000);
      swaps.push(o, o.material); o.material = idMat(id, o.userData.hot);
    } else if (o.isMesh || o.isLine || o.isPoints || o.isSprite) { hidden.push(o); o.visible = false; }
  });
  const auto = renderer.shadowMap.autoUpdate, fog = scene.fog, bg = scene.background;
  renderer.getClearColor(inkCol); const ca = renderer.getClearAlpha();
  renderer.shadowMap.autoUpdate = false; scene.fog = null; scene.background = null;
  renderer.setRenderTarget(st.rt); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(scene, cam);
  renderer.setRenderTarget(null); renderer.setClearColor(inkCol, ca);
  renderer.shadowMap.autoUpdate = auto; scene.fog = fog; scene.background = bg;
  for (let i = 0; i < swaps.length; i += 2) swaps[i].material = swaps[i + 1];
  for (const o of hidden) o.visible = true;
  const ac = renderer.autoClear; renderer.autoClear = false; renderer.render(st.qs, st.qc); renderer.autoClear = ac;
}
// one mesh with an ink outline; pos/rot are [x,y,z]
function mesh(g, mat, parent, pos, rot, opt) {
  const m = new T.Mesh(g, mat);
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  m.castShadow = !(opt && opt.noShadow) && mat !== GHOST;
  m.receiveShadow = !!(opt && opt.recv);
  if (!(opt && opt.noOutline) && mat.type !== 'MeshBasicMaterial') outline(m);
  if (parent) parent.add(m);
  return m;
}
const flat = { noOutline: true, noShadow: true };

/* ================= particles ================= */
function radialTex(soft) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(soft ? 0.5 : 0.25, 'rgba(255,255,255,' + (soft ? 0.55 : 0.85) + ')');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new T.CanvasTexture(c);
}
const TEX_SPARK = radialTex(false), TEX_SMOKE = radialTex(true);
class Particles {
  constructor(parent, n) {
    this.free = []; this.live = [];
    for (let i = 0; i < n; i++) {
      const s = new T.Sprite(new T.SpriteMaterial({ map: TEX_SPARK, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
      s.visible = false; parent.add(s); this.free.push({ s, v: new T.Vector3(), c0: new T.Color(), c1: new T.Color(), add: true });
    }
    this.debris = [];
    this.parent = parent;
  }
  spawn(o) {
    const p = this.free.pop() || this.live.shift();
    if (!p) return;
    const add = o.add !== false;
    if (p.add !== add) { p.s.material.blending = add ? T.AdditiveBlending : T.NormalBlending; p.s.material.map = add ? TEX_SPARK : TEX_SMOKE; p.s.material.needsUpdate = true; p.add = add; }
    p.s.position.copy(o.pos); p.v.copy(o.vel || new T.Vector3());
    p.life = o.life || 0.5; p.age = 0; p.s0 = o.size || 0.1; p.s1 = o.size1 != null ? o.size1 : p.s0 * 0.2;
    p.c0.setHex(o.color != null ? o.color : 0xffffff); p.c1.setHex(o.color1 != null ? o.color1 : (o.color != null ? o.color : 0xffffff));
    p.o0 = o.op != null ? o.op : 1; p.o1 = o.op1 != null ? o.op1 : 0; p.grav = o.grav || 0; p.drag = o.drag != null ? o.drag : 1;
    p.s.visible = true; p.s.scale.setScalar(p.s0); p.s.material.color.copy(p.c0); p.s.material.opacity = p.o0;
    this.live.push(p);
  }
  burst(pos, n, o) {
    const k = LEVEL === 'low' ? Math.ceil(n / 2) : n;
    for (let i = 0; i < k; i++) {
      const dir = new T.Vector3(rand(-1, 1), rand(o.upMin != null ? o.upMin : -0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(o.spd * 0.4, o.spd));
      this.spawn(Object.assign({}, o, { pos: pos.clone().add(new T.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(o.spread || 0)), vel: dir, life: rand(o.life * 0.6, o.life) }));
    }
  }
  chunks(pos, n, color) {
    const k = LEVEL === 'low' ? Math.ceil(n / 2) : n;
    for (let i = 0; i < k; i++) {
      const m = new T.Mesh(box(0.05, 0.035, 0.05), toon(color || 0x4a4f57));
      m.position.copy(pos); m.castShadow = true;
      this.parent.add(m);
      this.debris.push({ m, v: new T.Vector3(rand(-1.4, 1.4), rand(1.2, 2.6), rand(-1.4, 1.4)), r: new T.Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8)), age: 0 });
    }
  }
  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) { p.s.visible = false; this.live.splice(i, 1); this.free.push(p); continue; }
      p.v.y -= p.grav * dt;
      if (p.drag !== 1) p.v.multiplyScalar(Math.pow(p.drag, dt));
      p.s.position.addScaledVector(p.v, dt);
      p.s.scale.setScalar(lerp(p.s0, p.s1, t));
      p.s.material.color.copy(p.c0).lerp(p.c1, t);
      p.s.material.opacity = lerp(p.o0, p.o1, t);
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.age += dt; d.v.y -= 6 * dt;
      d.m.position.addScaledVector(d.v, dt);
      d.m.rotation.x += d.r.x * dt; d.m.rotation.y += d.r.y * dt;
      if (d.m.position.y < 0.02) { d.m.position.y = 0.02; d.v.multiplyScalar(0.4); d.v.y = Math.abs(d.v.y) * 0.3; d.r.multiplyScalar(0.5); }
      if (d.age > 1.6) { d.m.scale.multiplyScalar(0.9); }
      if (d.age > 2.2) { this.parent.remove(d.m); this.debris.splice(i, 1); }
    }
  }
}

/* ================= mecha models ================= */
// Paint comes from the doctrine, not the side: every army reads at a glance. Sides are marked by the disc under each mech.
const PAL = {
  assault: { main: 0xa9a79c, second: 0x7e3d34, accent: 0x34373a, trim: 0xa88a45, dark: 0x2c2f32, metal: 0x585c60, eye: 0x9cc9c8, glow: 0x9cc4c8, thruster: 0xb0ccd2 },
  armored: { main: 0x5d6446, second: 0x434936, accent: 0x9c8a5e, trim: 0x8d5a3e, dark: 0x282b23, metal: 0x4d5049, eye: 0xc89a58, glow: 0xc49058, thruster: 0xccae84 },
  experimental: { main: 0x4f4c62, second: 0x67607f, accent: 0x9da0ad, trim: 0x74a39a, dark: 0x252330, metal: 0x4a4859, eye: 0xb27a9e, glow: 0x86b3aa, thruster: 0xa898bb }
};
// when both sides field the same doctrine, the second commander's machines wear the alternate scheme
const PAL_ALT = {
  assault: { main: 0x4f5256, second: 0x7e3d34, accent: 0xa9a79c, trim: 0xa88a45 },
  armored: { main: 0x857a5c, second: 0x5a523d, accent: 0x3b3e35, trim: 0x8d5a3e },
  experimental: { main: 0x5b6068, second: 0x4f7470, accent: 0xa6a9b4, trim: 0xa57a98, glow: 0xa57a98, eye: 0x86b3aa }
};
function palette(doctrine, owner) {
  const d = PAL[doctrine] ? doctrine : 'assault';
  const S = window.MW && window.MW.S, other = S && S.players[1 - owner];
  const mirror = owner === 1 && other && other.doctrine === d;
  return Object.assign({ ring: TEAM[owner] ? TEAM[owner].ring : 0xffffff }, PAL[d], mirror ? PAL_ALT[d] : {});
}
// a box whose top face is scaled (tx, tz) and pushed forward (sz): wedges, tapers and leaning plates
const wedge = (w, h, d, tx, tz, sz) => geo('w' + [w, h, d, tx, tz, sz || 0].join(), () => {
  const g = new T.BoxGeometry(w, h, d), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * tx); p.setZ(i, p.getZ(i) * tz + (sz || 0)); }
  g.computeVertexNormals(); return g;
});
const FRAME_DIM = { c_sing: [0.30, 0.27, 0.20], s_core: [0.34, 0.28, 0.22], b_torso: [0.30, 0.26, 0.20], t_heavy: [0.38, 0.28, 0.24], t_light: [0.26, 0.24, 0.17], t_assault: [0.32, 0.27, 0.21], t_fortress: [0.44, 0.30, 0.27], t_proto: [0.30, 0.27, 0.20], s_frame: [0.40, 0.29, 0.25], t_skirm: [0.24, 0.22, 0.16] };
const DEFS = () => window.MW.DEFS;
const isKO = i => !!i && i.hp <= 0;
const isHurt = i => !!i && i.hp > 0 && i.hp <= (DEFS()[i.id].hp || 1) / 2;
// a row of small slats: vents, grilles, rivets
function vents(parent, mat, n, w, gap, pos, rot) {
  const g = new T.Group(); g.position.set(pos[0], pos[1], pos[2]); if (rot) g.rotation.set(rot[0], rot[1], rot[2]); parent.add(g);
  for (let i = 0; i < n; i++) mesh(box(w, 0.008, 0.012), mat, g, [0, (i - (n - 1) / 2) * gap, 0], null, flat);
  return g;
}
function rivets(parent, mat, pts) { for (const p of pts) mesh(cyl(0.008, 0.008, 0.01, 6), mat, parent, p, [Math.PI / 2, 0, 0], flat); }

function buildLegs(R, g, id, tc, style, ghost) {
  const M = c => ghost ? GHOST : toon(c);
  R.legs = []; R.stakes = []; R.boosters = [];
  if (id === 'l_treads') {
    R.kind = 'treads'; R.hipY = 0.29;
    for (const sx of [-1, 1]) {
      // large: the track pods
      mesh(wedge(0.12, 0.15, 0.4, 1, 0.82), M(tc.dark), g, [sx * 0.15, 0.08, 0]);
      // medium: road wheels and the armoured skirt
      for (const z of [-0.13, 0, 0.13]) mesh(cyl(0.052, 0.052, 0.125, 10), M(tc.metal), g, [sx * 0.15, 0.065, z], [0, 0, Math.PI / 2], { noOutline: true });
      mesh(wedge(0.03, 0.1, 0.36, 1, 0.9), M(tc.main), g, [sx * 0.215, 0.11, 0]);
      // small: hazard tab and bolts
      if (!ghost) { mesh(box(0.032, 0.03, 0.06), toon(tc.accent), g, [sx * 0.232, 0.12, 0.12], null, flat); rivets(g, toon(tc.dark), [[sx * 0.233, 0.13, -0.06], [sx * 0.233, 0.13, 0.02]]); }
    }
    mesh(wedge(0.26, 0.12, 0.2, 0.85, 0.85), M(tc.second), g, [0, 0.22, 0]);
    if (!ghost) vents(g, toon(tc.dark), 3, 0.12, 0.025, [0, 0.22, 0.102]);
    return;
  }
  if (id === 'l_hover') {
    R.kind = 'hover'; R.hipY = 0.35;
    mesh(cyl(0.11, 0.17, 0.2, 10), M(tc.main), g, [0, 0.22, 0]);
    mesh(cyl(0.18, 0.18, 0.035, 10), M(tc.second), g, [0, 0.12, 0]);
    if (!ghost) {
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; mesh(wedge(0.025, 0.09, 0.08, 0.5, 0.6), toon(tc.dark), g, [Math.cos(a) * 0.16, 0.18, Math.sin(a) * 0.16], [0, -a, 0]); }
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; mesh(sph(0.011, 6), glow(tc.glow), g, [Math.cos(a) * 0.182, 0.12, Math.sin(a) * 0.182], null, flat); }
      const d = new T.Mesh(new T.CircleGeometry(0.17, 16), glow(tc.glow, 0.55)); d.rotation.x = -Math.PI / 2; d.position.y = 0.04; g.add(d); R.hoverGlow = d;
    }
    return;
  }
  if (id === 'l_quad') {
    R.kind = 'quad'; R.hipY = 0.38;
    mesh(wedge(0.24, 0.09, 0.24, 0.8, 0.8), M(tc.second), g, [0, 0.35, 0]);
    if (!ghost) mesh(cyl(0.05, 0.05, 0.03, 8), toon(tc.accent), g, [0, 0.4, 0]);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const hip = new T.Group(); hip.position.set(sx * 0.1, 0.35, sz * 0.1); hip.rotation.y = Math.atan2(sx, sz); g.add(hip); R.legs.push(hip);
      mesh(wedge(0.06, 0.06, 0.22, 0.8, 1), M(tc.main), hip, [0, 0.03, 0.1], [-0.4, 0, 0]);
      mesh(sph(0.035, 8), M(tc.dark), hip, [0, 0.07, 0.2]);
      mesh(wedge(0.055, 0.32, 0.055, 1.3, 1.3), M(tc.second), hip, [0, -0.13, 0.2]);
      if (!ghost) mesh(cone(0.03, 0.05, 6), toon(tc.dark), hip, [0, -0.3, 0.2], [Math.PI, 0, 0]);
    }
    return;
  }
  R.kind = 'biped'; R.hipY = 0.42;
  const heavy = style === 'armored', exp = style === 'experimental';
  const k = (id === 'l_biped' ? 1.18 : id === 's_anchor' ? 1.42 : id === 'l_boost' ? 0.95 : 1) * (heavy ? 1.12 : exp ? 0.92 : 1.05);
  for (const sx of [-1, 1]) {
    const hip = new T.Group(); hip.position.set(sx * 0.09 * Math.max(1, k * 0.95), 0.42, 0); g.add(hip); R.legs.push(hip);
    // large: thigh
    mesh(wedge(0.085 * k, 0.2, 0.1 * k, heavy ? 1.1 : 1.15, 1.05), M(tc.main), hip, [0, -0.1, 0]);
    // small: hip joint and piston
    if (!ghost) { mesh(cyl(0.035 * k, 0.035 * k, 0.03, 10), toon(tc.dark), hip, [sx * 0.05 * k, -0.01, 0], [0, 0, Math.PI / 2]); mesh(cyl(0.008, 0.008, 0.16, 6), toon(tc.metal), hip, [0, -0.1, -0.055 * k], null, flat); }
    const knee = new T.Group(); knee.position.y = -0.2; hip.add(knee); hip.userData.knee = knee;
    // medium: knee guard, shaped per army
    if (exp) { if (!ghost) mesh(sph(0.03, 10), glow(tc.glow), knee, [0, 0, 0.02], null, flat); }
    else mesh(wedge(0.08 * k, 0.07, 0.05, heavy ? 1 : 0.6, 1, heavy ? 0 : 0.015), M(heavy ? tc.accent : tc.second), knee, [0, 0.0, 0.055 * k]);
    // large: shin, wide at the calf, narrow at the ankle (or a block for heavy armies)
    mesh(wedge(0.1 * k, 0.21, 0.115 * k, heavy ? 0.95 : 1.25, heavy ? 0.95 : 1.2), M(heavy ? tc.second : tc.main), knee, [0, -0.105, 0]);
    // medium: shin plate; small: vents
    mesh(wedge(0.07 * k, 0.12, 0.025, 1.1, 1), M(exp ? tc.second : heavy ? tc.main : tc.second), knee, [0, -0.09, 0.062 * k]);
    if (!ghost) vents(knee, toon(tc.dark), 3, 0.045 * k, 0.022, [0, -0.15, -0.06 * k]);
    // large: foot; small: toe cap and heel spur
    mesh(wedge(0.12 * k, 0.05, 0.19 * k, 0.8, 0.8), M(heavy ? tc.dark : tc.accent), knee, [0, -0.205, 0.025]);
    if (!ghost) { mesh(box(0.06 * k, 0.02, 0.03), toon(tc.trim), knee, [0, -0.21, 0.12 * k], null, flat); mesh(cone(0.015, 0.05, 4), toon(tc.dark), knee, [0, -0.2, -0.08 * k], [-Math.PI / 2, 0, 0], flat); }
    if (id === 'l_boost' && !ghost) {
      mesh(wedge(0.05, 0.1, 0.05, 0.7, 0.7), toon(tc.dark), knee, [0, -0.1, -0.075], [0.3, 0, 0]);
      const f = new T.Mesh(cone(0.024, 0.1, 8), glow(tc.thruster, 0.8)); f.position.set(0, -0.17, -0.1); f.rotation.x = -Math.PI / 2 - 0.3; knee.add(f); R.boosters.push(f);
    }
    if (id === 's_anchor') {
      const st = new T.Group(); st.position.set(sx * 0.09, -0.06, -0.02); knee.add(st);
      mesh(box(0.035, 0.2, 0.035), M(tc.trim), st, [0, -0.09, 0]);
      mesh(cone(0.026, 0.07, 6), M(tc.metal), st, [0, -0.215, 0], [Math.PI, 0, 0]);
      R.stakes.push({ g: st, sx });
    }
  }
}

function buildWeapon(p, id, tc, sx) {
  const D = toon(tc.metal), D2 = toon(tc.dark), mu = new T.Object3D();
  let z = 0.22, y = 0;
  // small, shared: a sight block on top of most guns
  const sight = (zz, yy) => mesh(box(0.016, 0.018, 0.04), toon(tc.trim), p, [0, yy, zz], null, flat);
  switch (id) {
    case 'b_gun':
      mesh(wedge(0.055, 0.075, 0.18, 0.85, 0.9), D, p, [0, 0, 0.06]);
      mesh(cyl(0.013, 0.013, 0.13, 8), D2, p, [0, 0.012, 0.2], [Math.PI / 2, 0, 0]);
      mesh(cyl(0.019, 0.019, 0.025, 8), D2, p, [0, 0.012, 0.26], [Math.PI / 2, 0, 0]);
      mesh(box(0.03, 0.065, 0.045), D2, p, [0, -0.055, 0.04]); sight(0.04, 0.05);
      z = 0.28; y = 0.012; break;
    case 'w_smg':
      for (const x of [-0.024, 0.024]) {
        mesh(box(0.034, 0.05, 0.13), D, p, [x, 0, 0.05]);
        mesh(cyl(0.009, 0.009, 0.09, 6), D2, p, [x, 0.008, 0.15], [Math.PI / 2, 0, 0]);
        mesh(box(0.02, 0.05, 0.025), toon(tc.second), p, [x, -0.045, 0.06]);
      }
      z = 0.2; y = 0.008; break;
    case 'w_scatter':
      mesh(wedge(0.09, 0.075, 0.16, 0.85, 0.9), D, p, [0, 0, 0.05]);
      for (const x of [-0.022, 0.022]) mesh(cyl(0.018, 0.018, 0.11, 8), D2, p, [x, 0.01, 0.17], [Math.PI / 2, 0, 0]);
      mesh(box(0.095, 0.02, 0.05), toon(tc.second), p, [0, 0.045, 0.03]); sight(0.0, 0.065);
      z = 0.24; y = 0.01; break;
    case 'w_gatling': {
      mesh(cyl(0.042, 0.042, 0.11, 10), D, p, [0, 0, 0.03], [Math.PI / 2, 0, 0]);
      mesh(box(0.05, 0.06, 0.06), toon(tc.second), p, [0, -0.05, 0.0]);
      const cl = new T.Group(); cl.position.z = 0.14; p.add(cl); p.userData.spin = cl;
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; mesh(cyl(0.008, 0.008, 0.16, 6), D2, cl, [Math.cos(a) * 0.022, Math.sin(a) * 0.022, 0], [Math.PI / 2, 0, 0], { noOutline: true }); }
      mesh(cyl(0.03, 0.03, 0.012, 10), D, cl, [0, 0, 0.06], [Math.PI / 2, 0, 0], flat);
      z = 0.23; break;
    }
    case 'w_rail':
      mesh(wedge(0.065, 0.075, 0.17, 0.8, 0.9), D, p, [0, 0, 0.04]);
      for (const x of [-0.024, 0.024]) mesh(box(0.013, 0.024, 0.36), toon(tc.trim), p, [x, 0.01, 0.27]);
      mesh(box(0.026, 0.012, 0.32), glow(FX_COL.energy), p, [0, 0.01, 0.27], null, flat);
      for (const zz of [0.14, 0.26, 0.38]) mesh(box(0.07, 0.012, 0.012), D2, p, [0, 0.01, zz], null, flat);
      z = 0.46; y = 0.01; break;
    case 'w_laser':
      mesh(wedge(0.05, 0.065, 0.21, 0.8, 0.9), toon(tc.main), p, [0, 0, 0.07]);
      mesh(box(0.022, 0.028, 0.07), D, p, [0, 0.045, 0.06]);
      mesh(box(0.054, 0.02, 0.05), toon(tc.second), p, [0, -0.03, 0.03]);
      mesh(cyl(0.017, 0.017, 0.06, 8), glow(FX_COL.energy), p, [0, 0, 0.2], [Math.PI / 2, 0, 0], flat);
      z = 0.24; break;
    case 'w_lance':
      mesh(cyl(0.013, 0.026, 0.46, 8), toon(tc.main), p, [0, 0, 0.21], [Math.PI / 2, 0, 0]);
      mesh(box(0.05, 0.05, 0.09), D, p, [0, 0, 0.02]);
      for (const zz of [0.1, 0.22, 0.34]) mesh(tor(0.03, 0.006), glow(FX_COL.energy), p, [0, 0, zz], null, flat);
      z = 0.46; break;
    case 'w_arc':
      mesh(cyl(0.032, 0.032, 0.13, 8), D, p, [0, 0, 0.05], [Math.PI / 2, 0, 0]);
      for (const zz of [0.04, 0.09]) mesh(tor(0.038, 0.008), glow(0xcfe8ff), p, [0, 0, zz], null, flat);
      for (const x of [-0.02, 0.02]) mesh(wedge(0.01, 0.01, 0.08, 1, 1), toon(tc.trim), p, [x, 0, 0.15]);
      z = 0.18; break;
    case 'w_blade':
      mesh(cyl(0.016, 0.016, 0.08, 8), D2, p, [0, 0, 0.03], [Math.PI / 2, 0, 0]);
      mesh(box(0.06, 0.016, 0.02), toon(tc.trim), p, [0, 0, 0.07], null, flat);
      mesh(cyl(0.012, 0.016, 0.33, 8), glow(FX_COL.melee), p, [0, 0, 0.24], [Math.PI / 2, 0, 0], flat);
      mesh(cyl(0.024, 0.028, 0.33, 8), glow(FX_COL.melee, 0.35), p, [0, 0, 0.24], [Math.PI / 2, 0, 0], flat);
      z = 0.39; break;
    case 'w_ram': {
      mesh(cyl(0.052, 0.052, 0.07, 10), D, p, [0, 0, 0.02], [Math.PI / 2, 0, 0]);
      mesh(tor(0.05, 0.01), toon(tc.trim), p, [0, 0, 0.05], null, flat);
      const dr = mesh(cone(0.056, 0.19, 8), toon(0x9aa0a8), p, [0, 0, 0.15], [Math.PI / 2, 0, 0]); p.userData.spin = dr;
      z = 0.24; break;
    }
    case 'w_shield': {
      const sp = new T.Group(); sp.position.set(sx * 0.07, -0.02, -0.03); p.add(sp);
      mesh(wedge(0.028, 0.29, 0.21, 1, 0.8), toon(tc.main), sp);
      mesh(box(0.03, 0.17, 0.05), toon(tc.second), sp);
      mesh(box(0.031, 0.04, 0.14), toon(tc.accent), sp, [0, 0.07, 0]);
      rivets(sp, toon(tc.dark), [[sx * 0.016, 0.12, 0.07], [sx * 0.016, 0.12, -0.07], [sx * 0.016, -0.12, 0.06], [sx * 0.016, -0.12, -0.06]].map(q => [q[0], q[1], q[2]]));
      z = 0.05; break;
    }
    case 'w_repair':
      mesh(box(0.045, 0.045, 0.13), D, p, [0, 0, 0.05]);
      for (const x of [-1, 1]) mesh(box(0.012, 0.012, 0.075), toon(tc.trim), p, [x * 0.019, 0, 0.13], [0, x * 0.4, 0]);
      mesh(sph(0.015, 8), glow(FX_COL.support), p, [0, 0, 0.15], null, flat); z = 0.16; break;
    case 'w_missile':
      mesh(wedge(0.12, 0.1, 0.15, 0.9, 0.85), toon(tc.second), p, [0, 0, 0]);
      for (const [x, yy] of [[-0.028, -0.022], [0.028, -0.022], [-0.028, 0.022], [0.028, 0.022]]) mesh(cyl(0.015, 0.015, 0.02, 8), toon(INK), p, [x, yy, 0.076], [Math.PI / 2, 0, 0], { noOutline: true });
      mesh(box(0.125, 0.015, 0.02), toon(tc.trim), p, [0, 0.055, 0.05], null, flat);
      z = 0.08; break;
    case 'w_howitzer': {
      mesh(wedge(0.09, 0.08, 0.12, 0.85, 0.85), toon(tc.second), p, [0, 0, 0]);
      const b = new T.Group(); b.position.set(0, 0.02, 0.03); b.rotation.x = -0.25; p.add(b);
      mesh(cyl(0.027, 0.031, 0.37, 10), D, b, [0, 0, 0.18], [Math.PI / 2, 0, 0]);
      mesh(cyl(0.036, 0.036, 0.055, 10), D2, b, [0, 0, 0.34], [Math.PI / 2, 0, 0]);
      mesh(box(0.012, 0.03, 0.12), toon(tc.trim), b, [0.03, 0.02, 0.1], null, flat);
      b.add(mu); mu.position.set(0, 0, 0.38); return mu;
    }
    case 's_inferno':
      mesh(wedge(0.065, 0.075, 0.16, 0.85, 0.9), D, p, [0, 0, 0.05]);
      mesh(cyl(0.032, 0.032, 0.11, 10), toon(0xe9892c), p, [0, -0.058, 0.05], [Math.PI / 2, 0, 0]);
      mesh(cone(0.034, 0.065, 8), D2, p, [0, 0.01, 0.17], [-Math.PI / 2, 0, 0]);
      mesh(sph(0.012, 6), glow(0xff7a2a), p, [0, 0.01, 0.2], null, flat);
      z = 0.21; y = 0.01; break;
    case 's_cryo':
      mesh(cyl(0.015, 0.019, 0.31, 8), toon(0xd8e2ea), p, [0, 0, 0.14], [Math.PI / 2, 0, 0]);
      mesh(box(0.05, 0.05, 0.08), D, p, [0, 0, 0.02]);
      mesh(oct(0.042), glow(FX_COL.cryo), p, [0, 0, 0.33], null, flat); z = 0.36; break;
    case 's_emp':
      mesh(cyl(0.032, 0.032, 0.09, 8), D, p, [0, 0, 0.03], [Math.PI / 2, 0, 0]);
      mesh(cyl(0.078, 0.02, 0.045, 12), toon(0xd8e2ea), p, [0, 0, 0.09], [-Math.PI / 2, 0, 0]);
      mesh(sph(0.019, 8), glow(FX_COL.energy), p, [0, 0, 0.1], null, flat);
      mesh(tor(0.06, 0.006), glow(FX_COL.energy), p, [0, 0, 0.1], null, flat); z = 0.12; break;
    case 's_railgun':
      mesh(wedge(0.1, 0.09, 0.15, 0.85, 0.85), D, p, [0, 0, 0]);
      for (const x of [-0.032, 0.032]) mesh(box(0.017, 0.032, 0.62), D2, p, [x, 0.01, 0.35]);
      for (const zz of [0.12, 0.24, 0.36, 0.48]) mesh(cyl(0.016, 0.016, 0.075, 8), glow(FX_COL.energy), p, [0, 0.04, zz], [0, 0, Math.PI / 2], flat);
      mesh(box(0.11, 0.02, 0.04), toon(tc.trim), p, [0, 0.055, 0.02], null, flat);
      z = 0.67; y = 0.01; break;
    default:
      mesh(box(0.05, 0.06, 0.15), D, p, [0, 0, 0.06]);
  }
  mu.position.set(0, y, z); p.add(mu);
  return mu;
}

function buildAux(bp, id, pos, tc) {
  const g = new T.Group(); g.position.set(pos[0], pos[1], pos[2]); bp.add(g);
  const D = toon(tc.metal), D2 = toon(tc.dark);
  switch (id) {
    case 'a_cool': mesh(box(0.075, 0.075, 0.055), D, g); for (let i = 0; i < 3; i++) mesh(box(0.077, 0.008, 0.057), toon(tc.trim), g, [0, -0.025 + i * 0.025, 0], null, flat); break;
    case 'a_sink': for (let i = 0; i < 4; i++) mesh(box(0.085, 0.012, 0.055), D2, g, [0, -0.03 + i * 0.02, 0]); mesh(box(0.02, 0.08, 0.06), D, g); break;
    case 'a_plate': mesh(wedge(0.095, 0.085, 0.035, 0.85, 1), toon(tc.second), g); mesh(box(0.055, 0.02, 0.037), toon(tc.trim), g, null, null, flat); break;
    case 'a_bulwark': mesh(wedge(0.11, 0.1, 0.045, 0.85, 1), toon(tc.main), g); mesh(box(0.1, 0.03, 0.05), toon(tc.accent), g, [0, -0.02, 0]); rivets(g, D2, [[-0.035, 0.03, 0.025], [0.035, 0.03, 0.025]]); break;
    case 'a_relay': mesh(cyl(0.02, 0.03, 0.06, 6), D, g); mesh(tor(0.04, 0.006), glow(tc.glow), g, [0, 0.04, 0], [Math.PI / 2, 0, 0], flat); mesh(sph(0.012, 6), glow(tc.glow), g, [0, 0.07, 0], null, flat); break;
    case 'a_jump': for (const x of [-0.022, 0.022]) { mesh(cyl(0.021, 0.027, 0.085, 8), D, g, [x, 0, 0]); mesh(cone(0.019, 0.055, 8), glow(tc.thruster, 0.7), g, [x, -0.065, 0], [Math.PI, 0, 0], flat); } break;
    case 'a_apu': mesh(cyl(0.032, 0.032, 0.085, 10), D, g); mesh(cyl(0.033, 0.033, 0.016, 10), glow(0x9dff8a), g, [0, 0.01, 0], null, flat); break;
    case 'a_nano': mesh(box(0.055, 0.055, 0.045), D, g); mesh(sph(0.023, 8), glow(0x7dffb2), g, [0, 0.032, 0], null, flat); break;
    case 'a_servo': for (const x of [-0.022, 0.022]) mesh(cyl(0.011, 0.011, 0.095, 6), toon(0xb8bec6), g, [x, 0, 0]); break;
    case 'a_shield': mesh(cyl(0.042, 0.042, 0.022, 12), D, g, [0, 0, 0], [Math.PI / 2, 0, 0]); mesh(tor(0.047, 0.007), glow(0x8fdcff), g, [0, 0, -0.013], null, flat); break;
    case 'a_over': for (const x of [-0.022, 0.022]) mesh(cyl(0.015, 0.015, 0.075, 8), glow(0xff4a4a), g, [x, 0, 0], null, flat); mesh(box(0.065, 0.022, 0.045), D, g, [0, -0.045, 0]); break;
    default: mesh(box(0.065, 0.065, 0.045), D, g);
  }
  return g;
}

function shoulderArmor(sh, sx, tc, style, k) {
  if (style === 'assault') {
    // large: swept pauldron; medium: red flare; small: yellow fin and black trim
    mesh(wedge(0.1 * k, 0.075 * k, 0.12 * k, 0.75, 0.85, -0.01), toon(tc.main), sh, [sx * 0.015, 0.02, 0], [0, 0, sx * -0.3]);
    mesh(wedge(0.05 * k, 0.05 * k, 0.13 * k, 0.6, 0.9), toon(tc.second), sh, [sx * 0.06 * k, 0.04, 0], [0, 0, sx * -0.55]);
    mesh(cone(0.016, 0.07, 4), toon(tc.trim), sh, [sx * 0.035, 0.1, -0.02], [0, 0, sx * -0.2], flat);
    mesh(box(0.012, 0.01, 0.1 * k), toon(tc.accent), sh, [sx * 0.06 * k, 0.005, 0], [0, 0, sx * -0.3], flat);
  } else if (style === 'armored') {
    // large: drum pauldron; medium: layered rim plate and hazard band; small: rivets
    mesh(cyl(0.075 * k, 0.075 * k, 0.13 * k, 12), toon(tc.main), sh, [sx * 0.025, 0.02, 0], [0, 0, Math.PI / 2]);
    mesh(cyl(0.08 * k, 0.08 * k, 0.03 * k, 12), toon(tc.second), sh, [sx * 0.085 * k, 0.02, 0], [0, 0, Math.PI / 2]);
    mesh(box(0.02, 0.03, 0.13 * k), toon(tc.accent), sh, [sx * 0.02, 0.09 * k, 0], null, flat);
    rivets(sh, toon(tc.dark), [[sx * 0.1 * k, 0.06, 0.03], [sx * 0.1 * k, 0.06, -0.03], [sx * 0.1 * k, -0.02, 0.05]].map(q => [q[0], q[1], q[2]]));
  } else {
    // large: smooth cowl; medium: tall fin; small: glowing edge
    mesh(sph(0.065 * k, 10), toon(tc.main), sh, [sx * 0.015, 0.02, 0]);
    mesh(wedge(0.018, 0.16, 0.07, 0.4, 0.6), toon(tc.second), sh, [sx * 0.07, 0.1, -0.04], [0, 0, sx * -0.35]);
    mesh(box(0.005, 0.13, 0.005), glow(tc.glow), sh, [sx * 0.08, 0.1, -0.003], [0, 0, sx * -0.35], flat);
    mesh(tor(0.06 * k, 0.005), glow(tc.glow), sh, [sx * 0.03, 0.02, 0], [0, Math.PI / 2, 0], flat);
  }
}

function buildHead(hd, tc, style) {
  if (style === 'assault') {
    // large: wedge helmet; medium: black faceplate and cheek guards; small: V-fin, twin eyes, red crest
    mesh(wedge(0.095, 0.085, 0.1, 0.8, 0.85, 0.008), toon(tc.main), hd, [0, 0.045, 0]);
    mesh(wedge(0.07, 0.04, 0.03, 0.9, 1), toon(tc.accent), hd, [0, 0.032, 0.05]);
    for (const sx of [-1, 1]) {
      mesh(box(0.02, 0.05, 0.06), toon(tc.second), hd, [sx * 0.052, 0.03, 0.02], null, flat);
      mesh(box(0.018, 0.011, 0.01), glow(tc.eye), hd, [sx * 0.017, 0.05, 0.066], null, flat);
      mesh(wedge(0.012, 0.09, 0.012, 0.3, 1), toon(tc.trim), hd, [sx * 0.032, 0.11, 0.042], [0, 0, -sx * 0.8]);
    }
    mesh(box(0.02, 0.02, 0.02), toon(tc.second), hd, [0, 0.09, 0.05]);
  } else if (style === 'armored') {
    // large: low armoured dome; medium: visor band and ear blocks; small: antenna and rivets
    mesh(wedge(0.13, 0.08, 0.12, 0.8, 0.8), toon(tc.second), hd, [0, 0.04, 0]);
    mesh(box(0.11, 0.022, 0.02), toon(tc.dark), hd, [0, 0.045, 0.058]);
    mesh(box(0.1, 0.012, 0.012), glow(tc.eye), hd, [0, 0.045, 0.067], null, flat);
    for (const sx of [-1, 1]) mesh(box(0.025, 0.05, 0.06), toon(tc.main), hd, [sx * 0.068, 0.035, 0]);
    mesh(cyl(0.006, 0.006, 0.09, 5), toon(INK), hd, [0.05, 0.11, -0.03]);
    mesh(box(0.04, 0.012, 0.03), toon(tc.accent), hd, [0, 0.085, 0.02], null, flat);
  } else {
    // large: ovoid sensor head; medium: crest fin and collar; small: mono-eye on its rail, whiskers
    mesh(sph(0.06, 14), toon(tc.main), hd, [0, 0.05, 0]);
    mesh(box(0.11, 0.028, 0.032), toon(tc.dark), hd, [0, 0.05, 0.046]);
    mesh(wedge(0.014, 0.07, 0.08, 0.3, 0.5), toon(tc.second), hd, [0, 0.115, -0.01]);
    mesh(tor(0.06, 0.008), toon(tc.accent), hd, [0, 0.0, 0], [Math.PI / 2, 0, 0], flat);
    for (const sx of [-1, 1]) mesh(cyl(0.003, 0.003, 0.06, 4), glow(tc.glow), hd, [sx * 0.05, 0.08, 0.02], [0, 0, sx * 0.6], flat);
    return mesh(sph(0.013, 8), glow(tc.eye), hd, [0, 0.05, 0.064], null, flat);
  }
  return null;
}

function buildChest(frame, tc, style, fid, w, h, dp, cy) {
  const big = fid === 't_heavy' || fid === 't_fortress' || fid === 's_frame';
  // waist: a medium joint block under every chest
  mesh(wedge(w * 0.5, 0.09, dp * 0.75, 1.2, 1.1), toon(tc.dark), frame, [0, 0.045, 0]);
  if (style === 'assault') {
    // large: V-shaped chest, broad at the shoulders and narrow at the waist
    mesh(wedge(w * 0.62, h, dp, 1.45, 1.1), toon(tc.main), frame, [0, cy, 0]);
    // medium: red chest plates and black collar
    for (const sx of [-1, 1]) mesh(wedge(w * 0.4, h * 0.55, dp * 0.22, 1.2, 1), toon(tc.second), frame, [sx * w * 0.2, cy + h * 0.14, dp * 0.5], [0, 0, sx * 0.18]);
    mesh(box(w * 0.42, h * 0.16, dp * 0.6), toon(tc.accent), frame, [0, cy + h * 0.48, -dp * 0.05]);
    // small: yellow intakes, vents and a centre stripe
    for (const sx of [-1, 1]) vents(frame, toon(tc.trim), 3, w * 0.14, 0.02, [sx * w * 0.3, cy - h * 0.2, dp * 0.47]);
    mesh(box(w * 0.08, h * 0.5, 0.012), toon(tc.accent), frame, [0, cy + h * 0.05, dp * 0.6], null, flat);
  } else if (style === 'armored') {
    // large: a thick block with a belly plate
    mesh(wedge(w, h, dp, 0.92, 0.92), toon(tc.main), frame, [0, cy, 0]);
    mesh(wedge(w * 0.8, h * 0.3, dp * 0.9, 1.1, 1), toon(tc.second), frame, [0, cy - h * 0.4, 0.01]);
    // medium: glacis slab across the chest, side bulkheads
    mesh(wedge(w * 0.9, h * 0.5, dp * 0.22, 0.85, 0.6, -0.01), toon(tc.second), frame, [0, cy + h * 0.15, dp * 0.5]);
    for (const sx of [-1, 1]) mesh(box(w * 0.08, h * 0.8, dp * 0.9), toon(tc.second), frame, [sx * w * 0.52, cy, 0]);
    // small: hazard stripes, rivets, unit number plate
    for (let i = 0; i < 4; i++) mesh(box(w * 0.08, h * 0.08, 0.012), toon(i % 2 ? tc.dark : tc.accent), frame, [-w * 0.3 + i * w * 0.08, cy - h * 0.32, dp * 0.47], [0, 0, 0.6], flat);
    rivets(frame, toon(tc.dark), [[-w * 0.38, cy + h * 0.32, dp * 0.6], [w * 0.38, cy + h * 0.32, dp * 0.6], [-w * 0.38, cy - h * 0.02, dp * 0.6], [w * 0.38, cy - h * 0.02, dp * 0.6]]);
    mesh(box(w * 0.18, h * 0.12, 0.012), toon(tc.trim), frame, [w * 0.22, cy - h * 0.32, dp * 0.47], null, flat);
  } else {
    // large: a sculpted, rounded shell, wider at the chest
    const shell = mesh(sph(w * 0.5, 14), toon(tc.main), frame, [0, cy + h * 0.05, 0]); shell.scale.set(1, h / w * 1.05, dp / w * 1.1);
    mesh(cyl(w * 0.2, w * 0.3, h * 0.35, 8), toon(tc.dark), frame, [0, cy - h * 0.36, 0]);
    // medium: rib plates sweeping round the chest
    for (const sx of [-1, 1]) mesh(wedge(w * 0.36, h * 0.18, dp * 0.25, 0.6, 1), toon(tc.second), frame, [sx * w * 0.2, cy - h * 0.08, dp * 0.36], [0, sx * 0.4, sx * 0.25]);
    // medium: violet cowl and a silver collar ring
    mesh(wedge(w * 0.75, h * 0.3, dp * 0.4, 0.7, 0.8), toon(tc.second), frame, [0, cy + h * 0.32, dp * 0.25]);
    mesh(tor(w * 0.22, 0.012), toon(tc.accent), frame, [0, cy + h * 0.5, 0], [Math.PI / 2, 0, 0], flat);
    // small: glowing seams and sensor dots
    for (const sx of [-1, 1]) mesh(box(w * 0.04, h * 0.8, 0.01), glow(tc.glow), frame, [sx * w * 0.22, cy, dp * 0.42], [0, 0, -sx * 0.2], flat);
    for (const sx of [-1, 0, 1]) mesh(sph(0.009, 6), glow(tc.glow), frame, [sx * w * 0.12, cy - h * 0.34, dp * 0.4], null, flat);
  }
  // heavier frames add a second layer of plate
  if (big) mesh(wedge(w * 0.9, h * 0.26, dp * 0.18, 0.9, 1), toon(style === 'armored' ? tc.accent : tc.second), frame, [0, cy - h * 0.26, dp * 0.58]);
  if (fid === 't_skirm' || fid === 't_light') mesh(box(w * 0.5, 0.012, dp * 0.4), toon(tc.trim), frame, [0, cy + h * 0.52, 0], null, flat);
  if (fid === 's_frame') mesh(cyl(0.05, 0.05, 0.02, 6), toon(tc.trim), frame, [0, cy - h * 0.05, dp * 0.68], [Math.PI / 2, 0, 0]);
  if (fid === 't_proto') mesh(box(0.016, h * 0.9, 0.01), glow(tc.glow), frame, [0, cy, -dp * 0.52], null, flat);
}

function buildPack(bp, tc, style, w, h, R) {
  R.thrusters = [];
  const thr = (x, y, z) => {
    mesh(cone(0.028, 0.065, 8), toon(INK), bp, [x, y, z], [Math.PI, 0, 0]);
    const f = new T.Mesh(cone(0.021, 0.11, 8), glow(tc.thruster, 0.75)); f.position.set(x, y - 0.075, z); f.rotation.x = Math.PI; f.visible = false; bp.add(f); R.thrusters.push(f);
  };
  if (style === 'assault') {
    // large: slim pack; medium: swept thruster wings; small: red tips and nozzles
    mesh(wedge(w * 0.5, h * 0.6, 0.07, 1.2, 1), toon(tc.accent), bp);
    for (const sx of [-1, 1]) {
      mesh(wedge(0.03, h * 0.9, 0.12, 0.4, 0.5, -0.04), toon(tc.main), bp, [sx * w * 0.28, h * 0.22, -0.04], [0.35, 0, sx * -0.55]);
      mesh(box(0.032, 0.05, 0.03), toon(tc.second), bp, [sx * w * 0.47, h * 0.5, -0.09], [0.35, 0, sx * -0.55], flat);
      thr(sx * w * 0.14, -h * 0.36, -0.01);
    }
  } else if (style === 'armored') {
    // large: boxy generator; medium: ammo drum and twin exhaust stacks; small: caps and hazard band
    mesh(wedge(w * 0.72, h * 0.72, 0.1, 0.9, 0.9), toon(tc.second), bp, [0, 0, -0.01]);
    mesh(cyl(0.05, 0.05, w * 0.5, 10), toon(tc.main), bp, [0, -h * 0.28, -0.03], [0, 0, Math.PI / 2]);
    for (const sx of [-1, 1]) {
      mesh(cyl(0.022, 0.022, h * 0.75, 8), toon(tc.metal), bp, [sx * w * 0.22, h * 0.42, -0.02]);
      mesh(cyl(0.028, 0.028, 0.02, 8), toon(INK), bp, [sx * w * 0.22, h * 0.8, -0.02], null, flat);
      thr(sx * w * 0.16, -h * 0.42, -0.02);
    }
    mesh(box(w * 0.6, 0.02, 0.105), toon(tc.accent), bp, [0, h * 0.2, -0.01], null, flat);
  } else {
    // large: smooth pod; medium: floating halo ring; small: glowing nodes on the halo
    mesh(sph(h * 0.32, 10), toon(tc.second), bp, [0, 0, -0.01]);
    const halo = new T.Group(); halo.position.set(0, h * 0.62, -0.05); bp.add(halo); R.halo = halo;
    mesh(tor(w * 0.42, 0.012), toon(tc.accent), halo, null, null, flat);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; mesh(sph(0.014, 6), glow(tc.glow), halo, [Math.cos(a) * w * 0.42, Math.sin(a) * w * 0.42, 0], null, flat); }
    for (const sx of [-1, 1]) thr(sx * w * 0.13, -h * 0.34, -0.01);
  }
}

// assemble a mech from its fitted parts; opt.ghosts draws empty slots as translucent placeholders
function buildMech(m, owner, doctrine, opt) {
  opt = opt || {};
  const tc = palette(doctrine, owner);
  const style = doctrine === 'armored' ? 'armored' : doctrine === 'experimental' ? 'experimental' : 'assault';
  const S = m.slots, Dd = DEFS();
  const root = new T.Group();
  const R = { root, slots: {}, muzzles: {}, arms: {}, sparks: [], style, owner, kneel: isKO(S.legs) };
  const tag = (obj, key) => { obj.traverse(o => { if (o.isMesh && !o.userData.outline) o.userData.slot = key; }); (R.slots[key] = R.slots[key] || []).push(obj); };
  const legsG = new T.Group(); root.add(legsG);
  buildLegs(R, legsG, S.legs ? S.legs.id : null, tc, style, !S.legs);
  if (S.legs || opt.ghosts) tag(legsG, 'legs');
  if (!S.legs && !opt.ghosts) legsG.visible = false;
  if (isHurt(S.legs)) R.sparks.push(legsG);
  const hips = new T.Group(); hips.position.y = R.hipY; root.add(hips); R.hips = hips;
  const torso = new T.Group(); hips.add(torso); R.torso = torso;
  const fid = S.torso ? S.torso.id : 'b_torso';
  const [w0, h, dp] = FRAME_DIM[fid] || FRAME_DIM.b_torso;
  const w = w0 * (style === 'armored' ? 1.1 : style === 'experimental' ? 0.95 : 1);
  const k = (fid === 't_fortress' ? 1.3 : fid === 't_heavy' || fid === 's_frame' ? 1.15 : fid === 't_light' || fid === 't_skirm' ? 0.86 : 1) * (style === 'armored' ? 1.15 : 1);
  const cy = 0.08 + h / 2;
  const frame = new T.Group(); torso.add(frame);
  if (!S.torso) {
    if (opt.ghosts) { mesh(box(w, h + 0.08, dp), GHOST, frame, [0, cy, 0], null, flat); mesh(box(0.1, 0.09, 0.1), GHOST, frame, [0, 0.08 + h + 0.05, 0], null, flat); tag(frame, 'torso'); }
  } else {
    buildChest(frame, tc, style, fid, w, h, dp, cy);
    const hd = new T.Group(); hd.position.set(0, 0.08 + h + 0.01, style === 'armored' ? 0.02 : 0); frame.add(hd); R.head = hd;
    const eye = buildHead(hd, tc, style);
    if (eye) R.monoEye = eye;
    tag(frame, 'torso');
    if (isHurt(S.torso)) R.sparks.push(frame);
  }
  // core, set into the chest behind a ring
  if (S.core || opt.ghosts) {
    const cg = new T.Group(); cg.position.set(0, cy, dp / 2 + 0.016); torso.add(cg);
    if (S.core) {
      mesh(tor(0.034, 0.01), toon(tc.dark), cg, null, null, flat);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; mesh(box(0.012, 0.012, 0.012), toon(tc.trim), cg, [Math.cos(a) * 0.044, Math.sin(a) * 0.044, 0], null, flat); }
      R.core = mesh(sph(0.025, 10), glow(isKO(S.core) ? 0x333a42 : (CORE_GLOW[S.core.id] || CORE_GLOW[S.core.id.replace(/^r_/, '')] || CORE_GLOW.b_core)), cg, null, null, flat);
      R.coreLive = !isKO(S.core);
    } else mesh(sph(0.03, 10), GHOST, cg, null, null, flat);
    tag(cg, 'core');
  }
  if (!S.core && S.torso) {
    const ag = new T.Group(); ag.position.set(0, cy, dp / 2 + 0.018); torso.add(ag);
    mesh(new T.CircleGeometry(0.04, 18), glow(0x07090c), ag, null, null, flat);
    R.coreAlarm = mesh(tor(0.05, 0.008), glow(0xff3b30, 0.9), ag, null, null, flat);
  }
  // arms: upper arm, elbow, forearm with a plate, and the weapon in hand (or on the shoulder)
  for (const [key, sx] of [['armL', -1], ['armR', 1]]) {
    const sh = new T.Group(); sh.position.set(sx * (w / 2 + 0.055), cy + h * 0.3, 0); torso.add(sh);
    const inst = S[key];
    if (S.torso) shoulderArmor(sh, sx, tc, style, k);
    if (!inst) {
      if (opt.ghosts) { mesh(box(0.065, 0.15, 0.075), GHOST, sh, [0, -0.075, 0], null, flat); mesh(box(0.075, 0.075, 0.14), GHOST, sh, [0, -0.15, 0.07], null, flat); }
      tag(sh, key);
      continue;
    }
    if (isKO(inst)) {
      mesh(cyl(0.028, 0.034, 0.05, 8), toon(INK), sh, [0, -0.04, 0]);
      R.sparks.push(sh); tag(sh, key);
      continue;
    }
    const def = Dd[inst.id], cat = def.cat;
    const ak = style === 'armored' ? 1.2 : style === 'experimental' ? 0.85 : 1;
    const arm = new T.Group(); sh.add(arm);
    mesh(wedge(0.065 * ak, 0.15, 0.075 * ak, 1.15, 1.1), toon(style === 'experimental' ? tc.second : tc.main), arm, [0, -0.075, 0]);
    mesh(cyl(0.007, 0.007, 0.12, 5), toon(tc.metal), arm, [sx * 0.035 * ak, -0.08, -0.02], null, flat);
    const el = new T.Group(); el.position.y = -0.15; el.rotation.x = -Math.PI / 2; arm.add(el);
    mesh(sph(0.036 * ak, 8), toon(tc.dark), el, [0, 0, 0]);
    mesh(wedge(0.08 * ak, 0.14, 0.09 * ak, 1.2, 1.15), toon(style === 'armored' ? tc.second : tc.main), el, [0, -0.075, 0]);
    mesh(wedge(0.07 * ak, 0.09, 0.022, 1.1, 1), toon(style === 'assault' ? tc.second : style === 'armored' ? tc.accent : tc.accent), el, [sx * 0.0, -0.07, 0.048 * ak]);
    mesh(box(0.05 * ak, 0.04, 0.05 * ak), toon(tc.dark), el, [0, -0.152, 0]);
    if (style === 'experimental') mesh(box(0.006, 0.1, 0.006), glow(tc.glow), el, [sx * 0.04, -0.07, 0.02], null, flat);
    const hand = new T.Group(); hand.position.y = -0.165; hand.rotation.x = Math.PI / 2; el.add(hand);
    const onShoulder = cat === 'missile' || cat === 'artillery' || inst.id === 's_railgun';
    let wg = hand;
    if (onShoulder) { wg = new T.Group(); wg.position.set(sx * 0.01, 0.09, -0.02); sh.add(wg); }
    R.muzzles[key] = { o: buildWeapon(wg, inst.id, tc, sx), cat: cat || 'ballistic', spin: wg.userData.spin || null };
    R.arms[key] = { sh, arm, el };
    tag(sh, key);
    if (isHurt(inst)) R.sparks.push(sh);
  }
  // backpack and aux systems
  const bp = new T.Group(); bp.position.set(0, cy + h * 0.1, -dp / 2 - 0.04); torso.add(bp);
  if (S.torso) {
    buildPack(bp, tc, style, w, h, R);
    const n = S.torso ? (Dd[S.torso.id].auxSlots || 0) : 0;
    const spots = [[-w * 0.38, 0.05, -0.04], [w * 0.38, 0.05, -0.04], [0, -h * 0.05, -0.08]];
    for (let i = 0; i < n; i++) {
      const a = S.aux[i];
      if (a) tag(buildAux(bp, a.id, spots[i], tc), 'aux' + i);
      else if (opt.ghosts) { const gg = new T.Group(); gg.position.set(spots[i][0], spots[i][1], spots[i][2]); bp.add(gg); mesh(box(0.06, 0.06, 0.05), GHOST, gg, null, null, flat); tag(gg, 'aux' + i); }
    }
  }
  const scale = (fid === 't_fortress' ? 1.06 : 1) * (style === 'armored' ? 1.08 : style === 'assault' ? 0.96 : 1);
  root.scale.setScalar(scale);
  return R;
}
function signature(m) {
  const s = m.slots, f = i => i ? i.id + (i.hp <= 0 ? '!' : isHurt(i) ? '~' : '') : '-';
  return [f(s.torso), f(s.core), f(s.legs), f(s.armL), f(s.armR)].concat(s.aux.map(f)).join('|');
}
// gold outline (or gold ghost) on the selected slot's parts
function highlight(R, key) {
  for (const k in R.slots) for (const obj of R.slots[k]) obj.traverse(o => {
    if (o.isMesh) o.userData.hot = k === key;
    if (o.isMesh && o.material.isMeshToonMaterial) { const base = o.userData.mat0 || (o.userData.mat0 = o.material); o.material = k === key ? lit(base) : base; }
    else if (o.isMesh && (o.material === GHOST || o.material === GHOST_SEL)) o.material = k === key ? GHOST_SEL : GHOST;
  });
}

/* ================= battlefield ================= */
const ST = { hasBoard: false };
let BD = null;
function tp(x, y, h) { const W = window.MW.W, H = window.MW.H; return new T.Vector3(y - (H - 1) / 2, h || 0, (W - 1) / 2 - x); }
const key = (x, y) => x + ',' + y;

const EL_TOP = 1.3;  // close to straight down, like the 2D board, with a hint of depth
const EL_34 = 0.62;  // isometric: mechs and animations read best from here, so every zoom onto them uses it
const ISO_AZ = Math.PI / 4;
// swing to the isometric angle, 45 degrees off whichever way the board is turned
function iso(G) { G.el = EL_34; G.az = BD.viewAz + ISO_AZ; }
// straight down, for choosing tiles to move or deploy to
function topDown(G) { G.el = EL_TOP; G.az = BD.viewAz; }
R3.mount = function (el, onTap) {
  if (BD) { if (BD.el !== el) { el.appendChild(BD.renderer.domElement); BD.el = el; } BD.onTap = onTap; return; }
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.setClearColor(0x8e9a9f);
  el.appendChild(renderer.domElement);
  const scene = new T.Scene();
  scene.fog = new T.Fog(0x8e9a9f, 26, 60);
  const cam = new T.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  scene.add(new T.HemisphereLight(0xdfe3e0, 0x4f5250, 0.8));
  const sun = new T.DirectionalLight(0xf2ead8, 0.75);
  sun.position.set(-5, 11, 7); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
  sun.shadow.bias = -0.0015;
  scene.add(sun);
  const group = new T.Group(); scene.add(group);
  BD = { el, renderer, scene, cam, group, sun, onTap, recs: {}, tiles: {}, ov: {}, props: {}, labels: [], queue: [], anims: [], shake: 0, flip: false, crates: {}, wrecks: {}, objs: {}, sel: null, active: null,
    rig: { az: 0, el: EL_TOP, zoom: 1, tx: 0, tz: 0 }, rigT: { az: 0, el: EL_TOP, zoom: 1, tx: 0, tz: 0 }, viewEl: EL_TOP, viewAz: 0, userT: -9, intent: null, focusTok: 0, size: { w: 1, h: 1 } };
  BD.parts = new Particles(group, 260);
  const resize = () => { const w = el.clientWidth || 1, h = el.clientHeight || 1; renderer.setSize(w, h, false); BD.size = { w, h }; };
  if (window.ResizeObserver) new ResizeObserver(resize).observe(el); else window.addEventListener('resize', resize);
  resize();
  bindCameraInput(renderer.domElement);
  loop();
};
// half-size of the view that just fits the whole board at zoom 1, for the current angle
const qTmp = new T.Quaternion(), vTmp = new T.Vector3(), mTmp = new T.Matrix4();
function baseExtent(az, el) {
  const W = window.MW.W, H = window.MW.H;
  const dir = new T.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  mTmp.lookAt(dir, new T.Vector3(0, 0, 0), new T.Vector3(0, 1, 0));
  qTmp.setFromRotationMatrix(mTmp).invert();
  let mx = 0, my = 0;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const yy of [-0.25, 0.75]) {
    vTmp.set(sx * (H / 2 + 0.06), yy, sz * (W / 2 + 0.06)).applyQuaternion(qTmp);
    mx = Math.max(mx, Math.abs(vTmp.x)); my = Math.max(my, Math.abs(vTmp.y));
  }
  const a = BD.size.w / BD.size.h;
  let hw = mx * 1.02, hh = my * 1.02;
  if (hw / hh > a) hh = hw / a; else hw = hh * a;
  return { hw, hh };
}
function camUpdate(dt) {
  const C = BD.rig, G = BD.rigT, k = 1 - Math.exp(-dt * 6), cam = BD.cam;
  let da = G.az - C.az; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
  C.az += da * k; C.el += (G.el - C.el) * k; C.zoom += (G.zoom - C.zoom) * k; C.tx += (G.tx - C.tx) * k; C.tz += (G.tz - C.tz) * k;
  const P = new T.Vector3(C.tx, 0, C.tz);
  const dir = new T.Vector3(Math.sin(C.az) * Math.cos(C.el), Math.sin(C.el), Math.cos(C.az) * Math.cos(C.el));
  cam.position.copy(P).addScaledVector(dir, 30);
  if (BD.shake > 0.002) { cam.position.add(new T.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(BD.shake)); BD.shake *= 0.86; }
  cam.up.set(0, 1, 0);
  cam.lookAt(P);
  const e = baseExtent(C.az, C.el);
  cam.left = -e.hw; cam.right = e.hw; cam.top = e.hh; cam.bottom = -e.hh; cam.zoom = C.zoom;
  cam.updateProjectionMatrix();
}
// where a tile sits in the world, after the board is turned for the guest
function worldTile(x, y) { BD.group.updateMatrixWorld(); return tp(x, y).applyMatrix4(BD.group.matrixWorld); }
// frame a set of tiles: centre on them and zoom until they fit, within limits
function focusTiles(list, zMin, zMax) {
  if (!list.length) return;
  const G = BD.rigT, pts = list.map(([x, y]) => worldTile(x, y));
  // measure the tiles along the screen's axes for the angle the camera is heading to
  const right = new T.Vector3(Math.cos(G.az), 0, -Math.sin(G.az)), fwd = new T.Vector3(-Math.sin(G.az), 0, -Math.cos(G.az));
  let r0 = Infinity, r1 = -Infinity, f0 = Infinity, f1 = -Infinity;
  for (const p of pts) { const a = p.dot(right), b = p.dot(fwd); r0 = Math.min(r0, a); r1 = Math.max(r1, a); f0 = Math.min(f0, b); f1 = Math.max(f1, b); }
  const cr = (r0 + r1) / 2, cf = (f0 + f1) / 2;
  G.tx = right.x * cr + fwd.x * cf; G.tz = right.z * cr + fwd.z * cf;
  const e = baseExtent(G.az, G.el), sinE = Math.max(0.5, Math.sin(G.el));
  const needW = (r1 - r0) / 2 + 0.75, needH = ((f1 - f0) / 2 + 0.75) * sinE + 0.35;
  G.zoom = Math.max(zMin, Math.min(zMax, e.hw / needW, e.hh / needH));
  keepOnBoard(G);
}
// slide the target so a zoomed-in view stays over the board instead of showing the void past its edge
function keepOnBoard(G, slack) {
  const W = window.MW.W, H = window.MW.H, e = baseExtent(G.az, G.el);
  const hw = e.hw / G.zoom, hd = e.hh / G.zoom / Math.max(0.5, Math.sin(G.el));
  const ca = Math.abs(Math.cos(G.az)), sa = Math.abs(Math.sin(G.az));
  const ex = ca * hw + sa * hd, ez = sa * hw + ca * hd, bx = H / 2 + (slack || 0.3), bz = W / 2 + (slack || 0.3);
  // turned diagonally the view corners always overhang the board, so there only keep the centre over it
  const diag = Math.abs(Math.sin(2 * G.az)) > 0.1, lx = Math.max(bx - ex, diag ? H / 2 - 0.6 : 0), lz = Math.max(bz - ez, diag ? W / 2 - 0.6 : 0);
  G.tx = Math.max(-lx, Math.min(lx, G.tx));
  G.tz = Math.max(-lz, Math.min(lz, G.tz));
}
function overview() { Object.assign(BD.rigT, { tx: 0, tz: 0, zoom: 1, el: BD.viewEl, az: BD.viewAz + (BD.viewEl < 1 ? ISO_AZ : 0) }); }
// what the camera should rest on: deployment at your base, the selected mech, or the whole map
function applyIntent() {
  const c = BD.intentSpec || {};
  if (c.deploy != null) {
    const b = window.MW.S.players[c.deploy].base;
    topDown(BD.rigT);
    focusTiles([[b.x, b.y]].concat(window.MW.deployTiles(c.deploy)), 1.3, 1.9);
  } else if (c.plan && c.plan.length) {
    topDown(BD.rigT);
    focusTiles(c.plan, 1.1, 2.0);
  } else if (c.frame && c.frame.length) {
    // a weapon is chosen: fit every tile it can reach
    iso(BD.rigT);
    focusTiles(c.frame, 1.1, 2.4);
  } else if (c.sel != null && BD.recs[c.sel] && !BD.recs[c.sel].gone) {
    const r = BD.recs[c.sel]; iso(BD.rigT); focusTiles([[r.x, r.y]], 2.0, 2.3);
  } else overview();
}
// jump straight to where the camera is heading (used by tests)
R3.settle = () => { if (BD) Object.assign(BD.rig, BD.rigT); };
R3.cam = function (kind) {
  if (!BD) return;
  const G = BD.rigT;
  if (kind === 'overview') { BD.viewEl = EL_TOP; BD.viewAz = 0; Object.assign(G, { az: 0, el: EL_TOP, zoom: 1, tx: 0, tz: 0 }); BD.userT = clock(); }
  else if (kind === 'rotL' || kind === 'rotR') { const d = kind === 'rotL' ? Math.PI / 2 : -Math.PI / 2; BD.viewAz += d; G.az += d; }
  else if (kind === 'tilt') { const toIso = G.el > 1.0; BD.viewEl = toIso ? EL_34 : EL_TOP; G.el = BD.viewEl; G.az = BD.viewAz + (toIso ? ISO_AZ : 0); }
  else if (kind === 'in') G.zoom = Math.min(3.5, G.zoom * 1.3);
  else if (kind === 'out') G.zoom = Math.max(0.8, G.zoom / 1.3);
  if (kind !== 'overview') BD.userT = clock();
  if (kind !== 'overview') keepOnBoard(G, 1.2);
};
// one finger drags the map, two fingers pinch to zoom and twist to turn; mouse wheel zooms, right-drag turns and tilts; a tap selects
function bindCameraInput(cv) {
  const pts = new Map();
  let g = null;
  const ray = new T.Raycaster(), ndc = new T.Vector2();
  cv.style.touchAction = 'none';
  cv.addEventListener('contextmenu', e => e.preventDefault());
  const upp = () => (BD.cam.right - BD.cam.left) / BD.cam.zoom / BD.size.w;
  const two = () => { const [a, b] = [...pts.values()]; return { d: Math.hypot(b.x - a.x, b.y - a.y) }; };
  const startGesture = () => {
    const G = BD.rigT;
    if (pts.size === 1) { const p = [...pts.values()][0]; g = { mode: 'one', x: p.x, y: p.y, tx: G.tx, tz: G.tz, moved: false }; }
    else if (pts.size === 2) { const t = two(); g = { mode: 'two', d: t.d, zoom: G.zoom, moved: true }; }
  };
  cv.addEventListener('pointerdown', e => { try { cv.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); startGesture(); });
  cv.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId) || !g) return;
    const p = pts.get(e.pointerId); p.x = e.clientX; p.y = e.clientY;
    const G = BD.rigT, C = BD.rig;
    if (g.mode === 'one') {
      const dx = p.x - g.x, dy = p.y - g.y;
      if (!g.moved && Math.hypot(dx, dy) < 8) return;
      g.moved = true; BD.userT = clock();
      const u = upp(), az = C.az;
      const right = new T.Vector3(Math.cos(az), 0, -Math.sin(az)), fwd = new T.Vector3(-Math.sin(az), 0, -Math.cos(az));
      const t = new T.Vector3(g.tx, 0, g.tz).addScaledVector(right, -dx * u).addScaledVector(fwd, dy * u / Math.max(0.5, Math.sin(C.el)));
      G.tx = t.x; G.tz = t.z; keepOnBoard(G, 1.2); C.tx = G.tx; C.tz = G.tz;
    } else if (g.mode === 'two' && pts.size === 2) {
      const t = two(); BD.userT = clock();
      G.zoom = C.zoom = Math.max(0.8, Math.min(3.5, g.zoom * t.d / Math.max(20, g.d)));
      keepOnBoard(G, 1.2); C.tx = G.tx; C.tz = G.tz;
    }
  });
  const end = e => {
    const was = g; pts.delete(e.pointerId);
    if (pts.size) { startGesture(); if (g) g.moved = true; return; }
    g = null;
    if (!was || was.mode !== 'one' || was.moved) return;
    // a tap: pick the tile under it
    const r = cv.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    BD.scene.updateMatrixWorld(true); BD.cam.updateMatrixWorld();
    ray.setFromCamera(ndc, BD.cam);
    const hits = ray.intersectObjects(BD.group.children, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.tile && !o.userData.uid) o = o.parent;
      if (!o) continue;
      if (o.userData.uid) { const rec = BD.recs[o.userData.uid]; if (rec && !rec.gone) { BD.onTap && BD.onTap(rec.x, rec.y); return; } continue; }
      const [x, y] = o.userData.tile.split(',').map(Number);
      BD.onTap && BD.onTap(x, y); return;
    }
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', e => { pts.delete(e.pointerId); g = null; });
  cv.addEventListener('wheel', e => { e.preventDefault(); BD.userT = clock(); BD.rigT.zoom = Math.max(0.8, Math.min(3.5, BD.rigT.zoom * Math.exp(-e.deltaY * 0.0015))); keepOnBoard(BD.rigT, 1.2); }, { passive: false });
}

function buildBoard(S) {
  const MW = window.MW, W = MW.W, H = MW.H, g = BD.group;
  // the floating island under the board
  const isl = mesh(box(H + 0.5, 1.6, W + 0.5), toon(0x6b6157), g, [0, -0.95, 0], null, { t: 0.03 });
  isl.receiveShadow = true; isl.userData.ground = true;
  mesh(box(H + 0.2, 0.5, W + 0.2), toon(0x564d45), g, [0, -1.9, 0], null, { t: 0.03 }).userData.ground = true;
  for (let i = 0; i < 26; i++) {
    const r = rand(0.25, 0.7), side = i % 4;
    const px = side < 2 ? rand(-H / 2, H / 2) : (side === 2 ? -1 : 1) * (H / 2 + 0.1);
    const pz = side >= 2 ? rand(-W / 2, W / 2) : (side === 0 ? -1 : 1) * (W / 2 + 0.1);
    mesh(cone(r, rand(0.8, 2.2), 5), toon(i % 2 ? 0x5d544b : 0x4f4740), g, [px, -2.1 - rand(0, 0.6), pz], [Math.PI, rand(0, 3), 0], { t: 0.025 });
  }
  // tiles
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
    const k = key(x, y), p = tp(x, y);
    const shade = ((x + y) % 2 ? 0x7f8892 : 0x757e88);
    const t = mesh(box(0.97, 0.22, 0.97), toon(shade), g, [p.x, -0.11, p.z], null, { t: 0.012, recv: true });
    t.castShadow = false; t.receiveShadow = true; t.userData.tile = k; t.userData.ground = true;
    if (Math.random() < 0.35) mesh(box(rand(0.2, 0.5), 0.005, 0.02), toon(0x5d646b), g, [p.x + rand(-0.25, 0.25), 0.004, p.z + rand(-0.25, 0.25)], [0, rand(0, 3), 0], flat).userData.ground = true;
    const ov = new T.Mesh(new T.PlaneGeometry(0.92, 0.92), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    ov.rotation.x = -Math.PI / 2; ov.position.set(p.x, 0.012, p.z); ov.userData.tile = k; ov.renderOrder = 2; g.add(ov);
    BD.ov[k] = ov; BD.tiles[k] = t;
    const ter = MW.terrain(x, y), base = MW.baseAt(x, y);
    if (ter === 'rock') buildRock(p, k);
    if (ter === 'ruins' || ter === 'rubble') buildRuin(p, k, ter === 'rubble');
    if (base != null) buildBase(p, k, base);
  }
  for (const o of S.objectives) buildObjective(o);
  BD.turretRings = [0, 1].map(pid => buildTurretRing(pid, S));
  ST.hasBoard = true;
}
function buildTurretRing(pid, S) {
  const MW = window.MW, inside = {}, g = new T.Group();
  for (const [x, y] of MW.turretTiles(pid)) inside[key(x, y)] = true;
  const b = S.players[pid].base; inside[key(b.x, b.y)] = true;
  const mat = new T.MeshBasicMaterial({ color: TEAM[pid].ring, transparent: true, opacity: 1, depthWrite: false });
  for (const k in inside) {
    const [x, y] = k.split(',').map(Number), p = tp(x, y);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (inside[key(x + dx, y + dy)]) continue;
      // the edge between this tile and the one outside, drawn as three dashes
      const q = tp(x + dx, y + dy), mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2, alongX = dy === 0;
      for (const o of [-0.32, 0, 0.32]) {
        const d = new T.Mesh(alongX ? new T.BoxGeometry(0.24, 0.016, 0.075) : new T.BoxGeometry(0.075, 0.016, 0.24), mat);
        d.position.set(alongX ? mx + o : mx, 0.02, alongX ? mz : mz + o);
        d.renderOrder = 3; g.add(d);
      }
    }
  }
  BD.group.add(g);
  return g;
}
function propGroup(k, p) { const pg = new T.Group(); pg.position.copy(p); pg.userData.tile = k; BD.group.add(pg); return pg; }
function windows(parent, w, h, d, y0, rows) {
  for (let r = 0; r < rows; r++) for (const sx of [-1, 1]) mesh(box(0.06, 0.05, 0.005), toon(0x2d3640), parent, [sx * w * 0.22, y0 + r * 0.16, d / 2 + 0.003], null, flat);
}
function buildRock(p, k) {
  const pg = propGroup(k, p), c = 0x8c8a82, c2 = 0x77756e;
  const h1 = rand(0.7, 1.1);
  const b = mesh(box(0.62, h1, 0.6), toon(c), pg, [0, h1 / 2, 0], [0, rand(-0.3, 0.3), rand(-0.08, 0.08)]);
  windows(b, 0.62, h1, 0.6, -h1 / 2 + 0.2, Math.floor(h1 / 0.18));
  mesh(box(0.66, 0.06, 0.5), toon(c2), pg, [0.06, h1 + 0.02, -0.02], [0.25, 0.2, 0.18]);
  mesh(box(0.34, 0.35, 0.3), toon(c2), pg, [0.22, 0.17, 0.25], [0, 0.4, 0.15]);
  for (let i = 0; i < 3; i++) mesh(cyl(0.008, 0.008, rand(0.15, 0.3), 4), toon(0x8a5a3c), pg, [rand(-0.2, 0.2), h1 + 0.08, rand(-0.2, 0.2)], [rand(-0.5, 0.5), 0, rand(-0.5, 0.5)], flat);
  for (let i = 0; i < 4; i++) mesh(box(rand(0.08, 0.16), 0.06, rand(0.08, 0.14)), toon(c2), pg, [rand(-0.4, 0.4), 0.03, rand(-0.4, 0.4)], [0, rand(0, 3), 0]);
  BD.props[k] = pg;
}
function buildRuin(p, k, rubble) {
  if (BD.props[k]) { BD.group.remove(BD.props[k]); }
  const pg = propGroup(k, p), c = 0x96938a, c2 = 0x7d7b74;
  if (rubble) {
    for (let i = 0; i < 9; i++) mesh(box(rand(0.08, 0.2), rand(0.04, 0.12), rand(0.08, 0.2)), toon(i % 2 ? c : c2), pg, [rand(-0.35, 0.35), 0.04, rand(-0.35, 0.35)], [rand(-0.3, 0.3), rand(0, 3), rand(-0.3, 0.3)]);
    pg.userData.rubble = true;
  } else {
    const wall = (x, z, ry, len) => {
      const g2 = new T.Group(); g2.position.set(x, 0, z); g2.rotation.y = ry; pg.add(g2);
      const steps = [0.42, 0.34, 0.22, 0.12];
      steps.forEach((hh, i) => { const seg = mesh(box(len / steps.length, hh, 0.08), toon(i % 2 ? c : c2), g2, [-len / 2 + (i + 0.5) * len / steps.length, hh / 2, 0]); if (i === 0) mesh(box(0.06, 0.07, 0.005), toon(0x2d3640), seg, [0, 0.06, 0.043], null, flat); });
    };
    wall(-0.05, -0.32, 0, 0.75); wall(-0.33, 0.02, Math.PI / 2, 0.6);
    for (let i = 0; i < 3; i++) mesh(box(rand(0.06, 0.12), 0.05, rand(0.06, 0.12)), toon(c2), pg, [rand(0, 0.35), 0.025, rand(0, 0.35)], [0, rand(0, 3), 0]);
  }
  BD.props[k] = pg;
}
function buildBase(p, k, pid) {
  const tc = TEAM[pid], pg = propGroup(k, p);
  const face = pid === 0 ? Math.PI : 0;
  pg.rotation.y = face;
  mesh(box(0.92, 0.5, 0.86), toon(tc.second), pg, [0, 0.25, 0]);
  mesh(box(0.94, 0.08, 0.88), toon(tc.main), pg, [0, 0.52, 0]);
  mesh(box(0.5, 0.36, 0.04), toon(INK), pg, [0, 0.18, 0.44]);
  mesh(box(0.54, 0.05, 0.05), toon(tc.trim), pg, [0, 0.38, 0.45]);
  for (const sx of [-1, 1]) mesh(box(0.12, 0.62, 0.12), toon(tc.main), pg, [sx * 0.42, 0.31, 0.38]);
  const tur = new T.Group(); tur.position.set(0, 0.56, -0.05); pg.add(tur);
  mesh(cyl(0.16, 0.2, 0.12, 10), toon(tc.main), tur, [0, 0.06, 0]);
  const bar = new T.Group(); bar.position.set(0, 0.12, 0); tur.add(bar);
  mesh(box(0.14, 0.1, 0.18), toon(tc.second), bar, [0, 0.03, 0]);
  for (const sx of [-1, 1]) mesh(cyl(0.022, 0.022, 0.32, 8), toon(GUN), bar, [sx * 0.04, 0.04, 0.24], [Math.PI / 2, 0, 0]);
  const mu = new T.Object3D(); mu.position.set(0, 0.04, 0.42); bar.add(mu);
  mesh(cyl(0.006, 0.006, 0.35, 4), toon(INK), pg, [0.3, 0.75, -0.3], null, flat);
  const lamp = new T.Mesh(sph(0.03, 8), glow(tc.ring)); lamp.position.set(0.3, 0.93, -0.3); pg.add(lamp);
  BD.props[k] = pg;
  BD['base' + pid] = { tur, mu, pg, lamp };
}
function ownerColor(o) { return o.owner == null ? 0xb8c0c8 : TEAM[o.owner].ring; }
function buildObjective(o) {
  const k = key(o.x, o.y), p = tp(o.x, o.y), pg = propGroup(k, p);
  const ring = new T.Mesh(new T.RingGeometry(0.36, 0.44, 32), new T.MeshBasicMaterial({ color: ownerColor(o), transparent: true, opacity: 0.85, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.015; pg.add(ring);
  const rec = { o, pg, ring, light: null };
  if (o.type === 'depot') {
    mesh(box(0.42, 0.22, 0.24), toon(0x6f7a55), pg, [-0.04, 0.11, 0.1]);
    mesh(box(0.42, 0.22, 0.24), toon(0x7d6a4a), pg, [0.06, 0.33, 0.08], [0, 0.3, 0]);
    mesh(box(0.42, 0.22, 0.24), toon(0x5b6d7a), pg, [0.02, 0.11, -0.18]);
    mesh(cyl(0.008, 0.008, 0.5, 4), toon(INK), pg, [-0.3, 0.25, -0.28], null, flat);
    rec.light = mesh(box(0.14, 0.09, 0.006), glow(ownerColor(o)), pg, [-0.23, 0.45, -0.28], null, flat);
  } else if (o.type === 'radar') {
    mesh(cyl(0.12, 0.16, 0.08, 8), toon(0x7c848c), pg, [0, 0.04, 0]);
    mesh(cyl(0.035, 0.05, 0.6, 8), toon(0x9aa2aa), pg, [0, 0.38, 0]);
    const dish = new T.Group(); dish.position.y = 0.7; pg.add(dish);
    mesh(cyl(0.22, 0.05, 0.08, 14), toon(0xd8dee4), dish, [0, 0, 0.04], [Math.PI / 2 - 0.5, 0, 0]);
    mesh(cyl(0.006, 0.006, 0.16, 4), toon(INK), dish, [0, 0.03, 0.1], [Math.PI / 2 - 0.5, 0, 0], flat);
    rec.dish = dish;
    rec.light = mesh(sph(0.03, 8), glow(ownerColor(o)), pg, [0, 0.98, 0], null, flat);
  } else if (o.type === 'uplink') {
    // a broad gold-trimmed plinth so it reads from above, a lattice mast, and a turning ring with a beacon
    mesh(cyl(0.42, 0.46, 0.12, 8), toon(0x5f676f), pg, [0, 0.06, 0], null, { recv: true });
    mesh(cyl(0.36, 0.4, 0.04, 8), toon(0xc39a3e), pg, [0, 0.14, 0]);
    mesh(cyl(0.22, 0.28, 0.14, 8), toon(0x858d95), pg, [0, 0.23, 0]);
    for (const a of [0, 2.09, 4.19]) mesh(box(0.04, 1.0, 0.04), toon(0x9aa2aa), pg, [Math.cos(a) * 0.11, 0.78, Math.sin(a) * 0.11], [Math.sin(a) * 0.08, 0, -Math.cos(a) * 0.08]);
    for (let i = 0; i < 3; i++) mesh(cyl(0.13 - i * 0.025, 0.13 - i * 0.025, 0.03, 6), toon(0x7c848c), pg, [0, 0.5 + i * 0.25, 0]);
    const spin = new T.Group(); spin.position.y = 1.18; pg.add(spin);
    mesh(tor(0.3, 0.035), toon(0xc39a3e), spin, [0, 0, 0], [Math.PI / 2, 0, 0]);
    mesh(box(0.66, 0.03, 0.06), toon(0xd8dee4), spin, [0, 0, 0]);
    rec.dish = spin;
    rec.light = mesh(sph(0.09, 10), glow(ownerColor(o)), pg, [0, 1.36, 0], null, flat);
    ring.scale.setScalar(1.12);
  } else {
    mesh(cyl(0.4, 0.42, 0.05, 20), toon(0x4a5058), pg, [0, 0.025, 0], null, { recv: true });
    mesh(box(0.38, 0.006, 0.09), glow(0x8fbf9c), pg, [0, 0.052, 0], null, flat);
    mesh(box(0.09, 0.006, 0.38), glow(0x8fbf9c), pg, [0, 0.052, 0], null, flat);
    mesh(box(0.06, 0.7, 0.06), toon(0xe0b43a), pg, [-0.36, 0.35, -0.36]);
    mesh(box(0.5, 0.05, 0.05), toon(0xe0b43a), pg, [-0.14, 0.68, -0.36]);
    mesh(cyl(0.004, 0.004, 0.3, 4), toon(INK), pg, [0.08, 0.52, -0.36], null, flat);
    ring.material.color.setHex(0x8fbf9c);
  }
  BD.objs[k] = rec;
}

/* ---------- mech records on the board ---------- */
let MS = 1.15; // mech scale on the map: about one tile tall, a little smaller on wide maps
function newRec(m, S) {
  const doc = S.players[m.owner] ? S.players[m.owner].doctrine : 'assault';
  const R = buildMech(m, m.owner, doc, {});
  R.root.scale.multiplyScalar(MS);
  R.root.userData.uid = m.uid;
  const rec = { uid: m.uid, owner: m.owner, R, sig: signature(m) + (m.entrenched ? '#E' : ''), x: m.x, y: m.y, pos: tp(m.x, m.y), face: m.owner === 0 ? Math.PI : 0, faceT: null, walk: null, anim: [], phase: rand(0, 6), shakeT: 0, gone: false, entr: !!m.entrenched };
  rec.R.root.position.copy(rec.pos);
  BD.group.add(rec.R.root);
  // rings under the mech: selection, active, overwatch
  const mk = (r1, r2, col, op) => { const rr = new T.Mesh(new T.RingGeometry(r1, r2, 36), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false })); rr.rotation.x = -Math.PI / 2; rr.position.y = 0.02; rr.visible = false; rr.renderOrder = 3; BD.group.add(rr); return rr; };
  rec.selRing = mk(0.34, 0.42, 0xffc83a, 0.95);
  rec.actRing = mk(0.3, 0.34, TEAM[m.owner].ring, 0.9);
  rec.owRing = mk(0.44, 0.47, 0xef4a3a, 0.9);
  // the disc under each mech marks whose it is
  const sh = new T.Mesh(new T.CircleGeometry(0.3, 24), new T.MeshBasicMaterial({ color: TEAM[m.owner] ? TEAM[m.owner].ring : 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.006; BD.group.add(sh); rec.blob = sh;
  rec.bubble = new T.Mesh(new T.IcosahedronGeometry(0.5, 1), new T.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0, wireframe: true, depthWrite: false }));
  BD.group.add(rec.bubble);
  return rec;
}
function dropRec(rec) {
  BD.group.remove(rec.R.root); BD.group.remove(rec.selRing); BD.group.remove(rec.actRing); BD.group.remove(rec.owRing); BD.group.remove(rec.blob); BD.group.remove(rec.bubble);
  delete BD.recs[rec.uid];
}
function rebuildRec(rec, m, S) {
  const old = rec.R.root, pos = old.position.clone(), rot = old.rotation.y;
  BD.group.remove(old);
  const doc = S.players[m.owner] ? S.players[m.owner].doctrine : 'assault';
  rec.R = buildMech(m, m.owner, doc, {});
  rec.R.root.scale.multiplyScalar(MS);
  rec.R.root.userData.uid = m.uid;
  rec.R.root.position.copy(pos); rec.R.root.rotation.y = rot;
  BD.group.add(rec.R.root);
  rec.sig = signature(m) + (m.entrenched ? '#E' : '');
  rec.entr = !!m.entrenched;
}

R3.sync = function (v) {
  if (!BD) return;
  const S = v.S;
  if (!ST.hasBoard) buildBoard(S);
  if (BD.flip !== !!v.flip) { BD.flip = !!v.flip; BD.group.rotation.y = BD.flip ? Math.PI : 0; }
  const t = clock();
  const seen = {};
  for (const m of S.mechs) {
    seen[m.uid] = true;
    let rec = BD.recs[m.uid];
    if (!rec || rec.gone) { if (rec) dropRec(rec); rec = BD.recs[m.uid] = newRec(m, S); }
    const sig = signature(m) + (m.entrenched ? '#E' : '');
    if (sig !== rec.sig) rebuildRec(rec, m, S);
    if (rec.x !== m.x || rec.y !== m.y) { rec.x = m.x; rec.y = m.y; rec.pos = tp(m.x, m.y); if (!rec.walk) rec.R.root.position.copy(rec.pos); }
    rec.m = m;
    rec.hot = m.heat > window.MW.stats(m).heatCap;
    rec.selRing.visible = v.sel === m.uid; rec.actRing.visible = v.active === m.uid; rec.owRing.visible = !!m.overwatch;
  }
  // mecha that left the field: kept briefly so a death, detonation, strip or return to base can play out
  for (const id in BD.recs) {
    const rec = BD.recs[id];
    if (!seen[id] && !rec.gone) { rec.gone = true; rec.goneAt = t; rec.selRing.visible = rec.actRing.visible = rec.owRing.visible = false; }
  }
  // objectives change hands
  for (const o of S.objectives) { const r = BD.objs[key(o.x, o.y)]; if (r && o.type !== 'repair' && r.owner !== o.owner) { r.owner = o.owner; const c = ownerColor(o); r.ring.material.color.setHex(c); if (r.light) r.light.material = glow(c); } }
  // ruins flattened by a blast
  for (const k of S.flat || []) { const pg = BD.props[k]; if (pg && !pg.userData.rubble) { const [x, y] = k.split(',').map(Number); buildRuin(tp(x, y), k, true); } }
  // wrecks and crates
  const wk = {};
  for (const w of S.wrecks) { const k = key(w.x, w.y); wk[k] = true; if (!BD.wrecks[k]) BD.wrecks[k] = buildWreck(w); }
  for (const k in BD.wrecks) if (!wk[k]) { BD.group.remove(BD.wrecks[k]); delete BD.wrecks[k]; }
  const ck = {};
  for (const c of S.crates || []) { const k = key(c.x, c.y); ck[k] = true; if (!BD.crates[k]) BD.crates[k] = buildCrate(c); }
  for (const k in BD.crates) if (!ck[k]) { const cr = BD.crates[k]; BD.parts.burst(cr.position.clone().setY(0.3), 10, { spd: 1.5, life: 0.5, size: 0.08, color: 0xffd27a }); BD.group.remove(cr); delete BD.crates[k]; }
  // tile highlights
  const zoneCol = [TEAM[0].ring, TEAM[1].ring];
  for (const k in BD.ov) {
    const ov = BD.ov[k], kind = v.overlay[k];
    ov.userData.kind = kind || null;
    if (!kind) {
      const z = v.zones[k], tz = v.turret ? v.turret[k] : null;
      if (z != null) { ov.material.color.setHex(zoneCol[z]); ov.material.opacity = 0.26; }
      else if (tz != null) { ov.material.color.setHex(zoneCol[tz]); ov.material.opacity = 0.17; }
      else ov.material.opacity = 0;
      continue;
    }
    ov.material.color.setHex(OV_COL[kind] || 0xffffff);
    ov.material.opacity = OV_OP[kind] || 0.35;
  }
  if (BD.turretRings) BD.turretRings.forEach((g, i) => { g.visible = v.S.players[i].base.hp > 0; });
  BD.labels = v.labels || [];
  BD.baseHp = v.baseHp;
  const c = v.cam || {};
  const intent = c.deploy != null ? 'd' + c.deploy : c.frame ? 'f' + c.key : c.plan ? 'p' + c.key : c.sel != null ? 's' + c.sel : 'o';
  if (intent !== BD.intent) { BD.intent = intent; BD.intentSpec = c; BD.focusTok++; applyIntent(); }
};
const OV_COL = { reach: 0xf2c230, dep: 0xf2c230, owd: 0xff7a3a, target: 0xef4a3a, threat: 0xef4a3a, 'ez-now': 0xef4a3a, 'ez-later': 0xef4a3a };
const OV_OP = { reach: 0.36, dep: 0.45, owd: 0.5, target: 0.5, threat: 0.2, 'ez-now': 0.42, 'ez-later': 0.18 };

function buildWreck(w) {
  const k = key(w.x, w.y), pg = propGroup(k, tp(w.x, w.y));
  for (let i = 0; i < 6; i++) mesh(box(rand(0.08, 0.2), rand(0.05, 0.12), rand(0.08, 0.2)), toon(i % 2 ? 0x3a3f46 : 0x4b4239), pg, [rand(-0.25, 0.25), 0.05, rand(-0.25, 0.25)], [rand(-0.5, 0.5), rand(0, 3), rand(-0.5, 0.5)]);
  mesh(cyl(0.03, 0.03, 0.28, 6), toon(0x5a5f66), pg, [0.1, 0.08, 0.05], [0.3, 0, 1.3]);
  const g = new T.Mesh(new T.RingGeometry(0.2, 0.42, 28), new T.MeshBasicMaterial({ color: 0xffa83a, transparent: true, opacity: 0.4, depthWrite: false }));
  g.rotation.x = -Math.PI / 2; g.position.y = 0.014; pg.add(g); pg.userData.glow = g;
  return pg;
}
function buildCrate(c) {
  const k = key(c.x, c.y), pg = propGroup(k, tp(c.x, c.y));
  const body = new T.Group(); pg.add(body); pg.userData.body = body;
  mesh(box(0.3, 0.22, 0.3), toon(0xd99a2b), body, [0, 0.11, 0]);
  mesh(box(0.31, 0.04, 0.31), toon(0x6b4a1c), body, [0, 0.11, 0]);
  if (c.kind !== 'supply') mesh(oct(0.05), glow(0xffd56a), body, [0, 0.3, 0], null, flat);
  const chute = new T.Group(); chute.position.y = 0.95; chute.visible = false; body.add(chute); pg.userData.chute = chute;
  mesh(new T.SphereGeometry(0.32, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xeef0f4), chute);
  for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) { const ln = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(x, 0, z), new T.Vector3(0, -0.72, 0)]), new T.LineBasicMaterial({ color: INK })); chute.add(ln); }
  return pg;
}

/* ---------- effects ---------- */
function muzzleWorld(rec, cat, slotKey) {
  const R = rec.R, pick = (slotKey && R.muzzles[slotKey] ? slotKey : null) || Object.keys(R.muzzles).find(k => R.muzzles[k].cat === cat) || Object.keys(R.muzzles)[0];
  const mz = pick && R.muzzles[pick];
  rec.R.root.updateMatrixWorld(true);
  if (!mz) return rec.R.root.position.clone().add(new T.Vector3(0, 0.5, 0));
  const v = new T.Vector3(); mz.o.getWorldPosition(v);
  BD.group.worldToLocal(v);
  rec.lastArm = pick;
  return v;
}
function recAt(x, y, wantGone) { for (const id in BD.recs) { const r = BD.recs[id]; if (r.x === x && r.y === y && (!!r.gone === !!wantGone)) return r; } return null; }
function schedule(at, fn) { BD.queue.push({ t: clock() + at, fn }); }
function faceTo(rec, p) { const d = p.clone().sub(rec.R.root.position); rec.faceT = Math.atan2(d.x, d.z); }
function flash(pos, col, size, life) { BD.parts.spawn({ pos, size: size || 0.35, size1: (size || 0.35) * 1.4, life: life || 0.12, color: col || 0xffffff, op: 1, op1: 0 }); }
function sparks(pos, col, n) { BD.parts.burst(pos, n || 10, { spd: 2.2, life: 0.35, size: 0.06, size1: 0.01, color: col || 0xffe2a0, color1: 0xff7a2a, grav: 4, upMin: 0 }); }
function smoke(pos, n, big) { BD.parts.burst(pos, LEVEL === 'low' ? Math.ceil(n / 2) : n, { add: false, spd: big ? 0.6 : 0.3, life: big ? 1.6 : 1, size: big ? 0.3 : 0.16, size1: big ? 0.7 : 0.4, color: 0x5d6168, color1: 0x9aa0a8, op: 0.6, op1: 0, grav: -0.6, upMin: 0.3, drag: 0.5 }); }
function shake(a) { if (LEVEL === 'low') return; BD.shake = Math.max(BD.shake, a); }
function explosion(pos, scale) {
  scale = scale || 1;
  flash(pos.clone(), 0xffffff, 0.9 * scale, 0.16);
  BD.parts.burst(pos, 16, { spd: 1.6 * scale, life: 0.55, size: 0.28 * scale, size1: 0.05, color: 0xffe08a, color1: 0xff4a1a, grav: -0.5, spread: 0.08 * scale });
  smoke(pos.clone().add(new T.Vector3(0, 0.2, 0)), 10, true);
  sparks(pos, 0xffe2a0, 14);
  BD.parts.chunks(pos.clone(), 7, 0x3a3f46);
  const ring = new T.Mesh(new T.RingGeometry(0.1, 0.18, 32), new T.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.9, depthWrite: false, side: T.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(pos.x, 0.03, pos.z); BD.group.add(ring);
  const t0 = clock();
  BD.anims.push(t => { const k = (t - t0) / 0.5; if (k >= 1) { BD.group.remove(ring); return false; } ring.scale.setScalar(1 + k * 6 * scale); ring.material.opacity = 0.9 * (1 - k); return true; });
  shake(0.12 * scale);
}

function projectile(from, to, opt) {
  const m = new T.Mesh(opt.geo || box(0.025, 0.025, 0.16), new T.MeshBasicMaterial({ color: opt.color, transparent: true, opacity: 1, blending: T.AdditiveBlending, depthWrite: false }));
  BD.group.add(m);
  const t0 = clock() + (opt.delay || 0), dur = opt.dur, arc = opt.arc || 0;
  const prev = from.clone();
  BD.anims.push(t => {
    if (t < t0) { m.visible = false; return true; }
    m.visible = true;
    const k = Math.min(1, (t - t0) / dur);
    const p = from.clone().lerp(to, k); p.y += Math.sin(k * Math.PI) * arc;
    m.position.copy(p); m.lookAt(BD.group.localToWorld(p.clone().add(p.clone().sub(prev)))); prev.copy(p);
    if (opt.trail && Math.random() < (LEVEL === 'low' ? 0.4 : 0.9)) BD.parts.spawn({ pos: p.clone(), vel: new T.Vector3(rand(-0.1, 0.1), 0.2, rand(-0.1, 0.1)), add: opt.trail === 'fire', life: 0.6, size: 0.07, size1: 0.2, color: opt.trail === 'fire' ? 0xffb066 : 0x8a9098, color1: 0xb0b6be, op: 0.7, op1: 0 });
    if (k >= 1) { BD.group.remove(m); return false; }
    return true;
  });
}
function beam(from, to, col, width, life, delay) {
  const len = from.distanceTo(to);
  const g = new T.CylinderGeometry(width, width, len, 8, 1, true);
  const m = new T.Mesh(g, new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, blending: T.AdditiveBlending, depthWrite: false }));
  const core = new T.Mesh(new T.CylinderGeometry(width * 0.4, width * 0.4, len, 6, 1, true), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, blending: T.AdditiveBlending, depthWrite: false }));
  const grp = new T.Group(); grp.add(m); grp.add(core);
  grp.position.copy(from).lerp(to, 0.5);
  grp.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  grp.visible = false; BD.group.add(grp);
  const t0 = clock() + (delay || 0);
  BD.anims.push(t => {
    if (t < t0) return true;
    grp.visible = true;
    const k = (t - t0) / life;
    if (k >= 1) { BD.group.remove(grp); g.dispose(); return false; }
    const s = 1 - k; grp.scale.set(s, 1, s); m.material.opacity = 0.95 * s; core.material.opacity = s;
    return true;
  });
}
function lightning(from, to, col, life, delay) {
  const pts = [];
  for (let i = 0; i <= 8; i++) { const p = from.clone().lerp(to, i / 8); if (i && i < 8) p.add(new T.Vector3(rand(-0.08, 0.08), rand(-0.08, 0.08), rand(-0.08, 0.08))); pts.push(p); }
  const ln = new T.Line(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: col, transparent: true, blending: T.AdditiveBlending }));
  ln.visible = false; BD.group.add(ln);
  const t0 = clock() + (delay || 0);
  BD.anims.push(t => { if (t < t0) return true; ln.visible = Math.random() > 0.2; const k = (t - t0) / life; if (k >= 1) { BD.group.remove(ln); return false; } ln.material.opacity = 1 - k; return true; });
}
function slash(at, col, delay, flipArc) {
  const m = new T.Mesh(new T.TorusGeometry(0.32, 0.03, 4, 20, Math.PI * 0.9), new T.MeshBasicMaterial({ color: col, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
  m.position.copy(at); m.rotation.set(rand(-0.4, 0.4), rand(0, 3), flipArc ? 2.2 : 0.6); m.visible = false; BD.group.add(m);
  const t0 = clock() + delay;
  BD.anims.push(t => { if (t < t0) return true; m.visible = true; const k = (t - t0) / 0.25; if (k >= 1) { BD.group.remove(m); return false; } m.scale.setScalar(0.6 + k * 0.6); m.material.opacity = 1 - k; m.rotation.z += 0.25; return true; });
}

// fire one weapon: returns the time (s) from now until it lands
const ANTICIPATION = 0.42;  // wind-up before any weapon goes off
// wind-up glow gathering at the weapon that is about to fire, with sparks drawn in toward it
function charge(att, cat, dur, slotKey) {
  if (!att) return;
  const col = FX_COL[cat] || 0xffffff;
  const m = new T.Mesh(sph(0.05, 10), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false }));
  BD.group.add(m);
  const t0 = clock();
  BD.anims.push(t => {
    const k = (t - t0) / dur;
    if (k >= 1 || att.gone) { BD.group.remove(m); m.material.dispose(); return false; }
    const p = muzzleWorld(att, cat, slotKey);
    m.position.copy(p); m.scale.setScalar(0.5 + k * 1.8 + Math.sin(t * 45) * 0.18); m.material.opacity = 0.2 + 0.75 * k;
    if (LEVEL !== 'low' && Math.random() < 0.6) {
      const o = new T.Vector3(rand(-0.3, 0.3), rand(-0.2, 0.3), rand(-0.3, 0.3));
      BD.parts.spawn({ pos: p.clone().add(o), vel: o.clone().multiplyScalar(-3.2), life: 0.28, size: 0.035, size1: 0.01, color: col, op: 0.95, op1: 0 });
    }
    return true;
  });
}
// a lock-on ring tightening round the target while the attacker winds up
function reticle(p, dur) {
  const m = new T.Mesh(new T.RingGeometry(0.33, 0.39, 36), new T.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.position.set(p.x, 0.035, p.z); m.renderOrder = 3; BD.group.add(m);
  const t0 = clock();
  BD.anims.push(t => {
    const k = (t - t0) / dur;
    if (k >= 1) { BD.group.remove(m); m.geometry.dispose(); m.material.dispose(); return false; }
    m.scale.setScalar(1.6 - 0.6 * Math.min(1, k * 1.8)); m.rotation.z = k * 2;
    m.material.opacity = 0.9 * Math.min(1, k * 5) * (k > 0.85 ? (1 - k) / 0.15 : 1);
    return true;
  });
}
function shoot(f, start) {
  const att = (f.uid && BD.recs[f.uid]) || recAt(f.x0, f.y0, false) || recAt(f.x0, f.y0, true);
  const tgtRec = recAt(f.x1, f.y1, false);
  let to = tp(f.x1, f.y1, 0.45);
  if (tgtRec) to = tgtRec.R.root.position.clone().add(new T.Vector3(0, 0.45, 0));
  if (window.MW.baseAt(f.x1, f.y1) != null) to = tp(f.x1, f.y1, 0.35);
  if (!f.hit) to.add(new T.Vector3(rand(-0.45, 0.45), -0.25, rand(-0.45, 0.45)));
  const cat = f.cat || 'ballistic', col = FX_COL[cat] || 0xffffff;
  let from;
  if (cat === 'turret') {
    const b = BD['base' + window.MW.baseAt(f.x0, f.y0)];
    if (b) { const bp = b.pg.position; const d = to.clone().sub(bp); b.tur.rotation.y = Math.atan2(d.x, d.z) - b.pg.rotation.y; b.pg.updateMatrixWorld(true); from = new T.Vector3(); b.mu.getWorldPosition(from); BD.group.worldToLocal(from); }
    else from = tp(f.x0, f.y0, 0.7);
  } else if (att) {
    from = null;
  } else from = tp(f.x0, f.y0, 0.5);
  schedule(start, () => {
    if (att) { faceTo(att, to); charge(att, cat, ANTICIPATION, f.key); }
    else if (cat === 'turret') flash(from.clone(), 0xff7050, 0.25, ANTICIPATION);
    reticle(tp(f.x1, f.y1), ANTICIPATION + 0.25);
  });
  let travel = 0.2;
  const go = () => {
    if (!from) from = muzzleWorld(att, cat, f.key);
    if (att) { att.recoil = clock(); const mz = att.R.muzzles[att.lastArm]; if (mz && mz.spin) att.spin = clock(); }
    if (cat === 'ballistic' || cat === 'turret') {
      flash(from.clone(), 0xffe9a8, 0.22, 0.08);
      for (let i = 0; i < 3; i++) projectile(from, to, { color: col, dur: 0.16, delay: i * 0.05 });
    } else if (cat === 'energy' || cat === 'support') {
      flash(from.clone(), col, 0.3, 0.15);
      if (Math.random() < 0.5 && cat === 'energy' && f.arc) lightning(from, to, col, 0.3); else beam(from, to, col, cat === 'support' ? 0.025 : 0.045, 0.4);
    } else if (cat === 'cryo') {
      beam(from, to, col, 0.04, 0.45);
      for (let i = 0; i < 8; i++) BD.parts.spawn({ pos: from.clone().lerp(to, Math.random()), vel: new T.Vector3(rand(-0.3, 0.3), rand(0, 0.4), rand(-0.3, 0.3)), life: 0.6, size: 0.06, size1: 0.01, color: 0xe8fbff, op: 0.9 });
    } else if (cat === 'incendiary') {
      for (let i = 0; i < (LEVEL === 'low' ? 10 : 22); i++) {
        const d = to.clone().sub(from); const sp = d.length() / 0.32;
        BD.parts.spawn({ pos: from.clone(), vel: d.normalize().multiplyScalar(sp * rand(0.85, 1.1)).add(new T.Vector3(rand(-0.3, 0.3), rand(-0.1, 0.3), rand(-0.3, 0.3))), life: 0.36, size: 0.06, size1: 0.22, color: 0xfff0a0, color1: 0xff4a1a, op: 1, op1: 0 });
      }
    } else if (cat === 'missile') {
      for (let i = 0; i < 2; i++) projectile(from.clone().add(new T.Vector3(rand(-0.05, 0.05), 0, 0)), to, { geo: cyl(0.015, 0.015, 0.09, 6), color: 0xffe2b0, dur: 0.55, arc: 0.6, delay: i * 0.08, trail: 'smoke' });
    } else if (cat === 'artillery') {
      flash(from.clone(), 0xffe9a8, 0.35, 0.12); smoke(from.clone(), 4, false);
      projectile(from, to, { geo: sph(0.035, 6), color: 0xffd27a, dur: 0.75, arc: 1.6, trail: 'smoke' });
    } else if (cat === 'melee' || cat === 'siege') {
      slash(to, col, 0.12, false); if (cat === 'melee') slash(to, col, 0.2, true);
    }
  };
  if (cat === 'missile') travel = 0.62; else if (cat === 'artillery') travel = 0.8; else if (cat === 'incendiary') travel = 0.34; else if (cat === 'melee' || cat === 'siege') travel = 0.18; else if (cat === 'energy' || cat === 'support' || cat === 'cryo') travel = 0.08;
  if ((cat === 'melee' || cat === 'siege') && att) att.lunge = { t0: clock() + start + ANTICIPATION - 0.12, to };
  schedule(start + ANTICIPATION, go);
  schedule(start + ANTICIPATION + travel, () => {
    if (f.hit) {
      if (cat === 'artillery' || cat === 'missile') explosion(to, cat === 'artillery' ? 0.8 : 0.5);
      else if (cat === 'incendiary') { BD.parts.burst(to, 12, { spd: 0.8, life: 0.6, size: 0.12, size1: 0.3, color: 0xffd27a, color1: 0xff3a1a, grav: -1.5 }); }
      else if (cat === 'cryo') { BD.parts.burst(to, 12, { spd: 1.2, life: 0.6, size: 0.07, size1: 0.01, color: 0xe8fbff, color1: 0x8fdcff, grav: 1 }); }
      else { sparks(to, col, 12); flash(to.clone(), col, 0.3, 0.1); }
      if (tgtRec) { tgtRec.hitT = clock(); }
      shake(cat === 'artillery' || cat === 'siege' ? 0.06 : 0.025);
      const bpid = window.MW.baseAt(f.x1, f.y1); if (bpid != null) smoke(to.clone(), 4, false);
    } else {
      smoke(to.clone(), 3, false); BD.parts.burst(to, 6, { spd: 1, life: 0.4, size: 0.05, color: 0xc8c0a8, grav: 3, upMin: 0.3 });
    }
  });
  return ANTICIPATION + travel;
}

R3.fx = function (list) {
  if (!BD) return [];
  const spots = [];
  for (const f of list) {
    if (f.k === 'move' && f.path) spots.push(f.path[0], f.path[f.path.length - 1]);
    else if (f.k === 'shot') spots.push([f.x0, f.y0], [f.x1, f.y1]);
    else if (f.k === 'deploy' || f.k === 'nuke' || f.k === 'boom' || f.k === 'strip') spots.push([f.x, f.y]);
  }
  // the player moving the camera by hand in the last moment wins over the automatic framing
  // the camera gets there first; the action only starts once it has (nearly) arrived
  let lead = 0, tok = null;
  if (spots.length && clock() - BD.userT > 1.2) {
    const was = Object.assign({}, BD.rig);
    iso(BD.rigT);
    focusTiles(spots, 1.6, 2.5);
    const G = BD.rigT;
    let da = G.az - was.az; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    const travel = Math.hypot(G.tx - was.tx, G.tz - was.tz) + Math.abs(G.zoom - was.zoom) * 1.5 + Math.abs(da) * 2 + Math.abs(G.el - was.el) * 2;
    lead = travel > 0.3 ? 0.6 : 0.2;
    tok = ++BD.focusTok;
  }
  const delays = list.map(() => 0);
  const combat = [], res = [];
  list.forEach((f, i) => (f.res ? res : combat).push(i));
  let end = lead;
  const runPass = (idx, base) => {
  const sub = idx.map(i => list[i]);
  let tShot = base, endP = base;
  const impact = {};
  sub.forEach(f => {
    if (f.k === 'move') {
      const rec = BD.recs[f.uid]; if (!rec || f.path.length < 2) return;
      const all = f.path.map(p => tp(p[0], p[1]));
      // a jump is a single hop, high enough to clear what it passes over
      const pts = f.jump ? [all[0], all[all.length - 1]] : all;
      rec.walk = { pts, t0: clock() + base, dur: f.jump ? 0.35 + 0.12 * (all.length - 1) : 0.26 * (pts.length - 1), hop: f.jump ? 1.1 + 0.1 * (all.length - 1) : 0 };
      rec.R.root.position.copy(pts[0]);
      tShot = Math.max(tShot, base + rec.walk.dur + 0.1);
    } else if (f.k === 'deploy') {
      const rec = BD.recs[f.uid]; if (!rec) return;
      rec.drop = { t0: clock() + base, dur: 0.6 };
      tShot = Math.max(tShot, base + 0.7);
    } else if (f.k === 'enter') {
      const rec = Object.values(BD.recs).find(r => r.uid === f.uid);
      if (rec) { rec.claimed = true; const b = window.MW.S.players[f.owner].base; rec.leave = { t0: clock() + base, dur: 0.7, to: tp(b.x, b.y) }; tShot = Math.max(tShot, base + 0.75); }
    } else if (f.k === 'boom' || f.k === 'nuke' || f.k === 'strip') {
      const rec = (f.uid && BD.recs[f.uid]) || recAt(f.x, f.y, true);
      if (rec) rec.claimed = true;
    }
  });
  const pairN = {};
  sub.forEach(f => {
    if (f.k !== 'shot') return;
    const pk = [f.x0, f.y0, f.x1, f.y1].join();
    const n = pairN[pk] = (pairN[pk] || 0) + 1;
    const start = tShot + (n - 1) * 0.3;
    const travel = shoot(f, start);
    const k = key(f.x1, f.y1);
    impact[k] = Math.max(impact[k] || 0, start + travel);
  });
  endP = Math.max(endP, tShot, ...Object.values(impact));
  sub.forEach((f, j) => {
    const i = idx[j], k = key(f.x, f.y);
    if (f.k === 'float') { delays[i] = Math.round(1000 * (impact[k] != null ? impact[k] : tShot)); return; }
    const at = (impact[k] != null ? impact[k] + 0.15 : tShot) + 0.05;
    if (f.k === 'boom' || f.k === 'nuke') endP = Math.max(endP, at + (f.k === 'nuke' ? 2 : 1.1));
    if (f.k === 'boom') {
      delays[i] = at * 1000;
      const rec = (f.uid && BD.recs[f.uid]) || recAt(f.x, f.y, true) || null;
      schedule(at, () => {
        const p = tp(f.x, f.y, 0.4);
        explosion(p, 1.1);
        if (rec) { rec.dying = { t0: clock() }; }
      });
    } else if (f.k === 'nuke') {
      const rec = (f.uid && BD.recs[f.uid]) || recAt(f.x, f.y, true);
      if (rec) rec.charging = clock();
      schedule(at + 0.7, () => nuke(f, rec));
    } else if (f.k === 'strip') {
      const rec = (f.uid && BD.recs[f.uid]) || recAt(f.x, f.y, true);
      schedule(at, () => { if (rec) rec.strip = { t0: clock() }; sparks(tp(f.x, f.y, 0.4), 0xffe2a0, 10); });
    } else if (f.k === 'brace') {
      const rec = recAt(f.x, f.y, false);
      schedule(at, () => { if (rec) rec.braceT = clock(); });
    } else if (f.k === 'capture') {
      // "Captured" shows with its light pillar, not before
      delays[i] = Math.round(tShot * 1000);
      schedule(tShot, () => pillar(tp(f.x, f.y), TEAM[f.owner].ring));
      endP = Math.max(endP, tShot + 0.8);
    } else if (f.k === 'drop') {
      delays[i] = Math.round(tShot * 1000);
      const cr = BD.crates[k];
      // the crate stays out of sight until its drop begins
      if (cr) { cr.visible = false; schedule(tShot, () => { cr.visible = true; cr.userData.dropT = clock(); cr.userData.body.position.y = 4; cr.userData.chute.visible = true; }); }
      endP = Math.max(endP, tShot + 1);
    }
  });
  return endP;
  };
  end = runPass(combat, lead);
  if (res.length) end = runPass(res, end + (combat.length ? 0.35 : 0));
  // hold the shot for a beat after the last hit, then hand the camera back
  delays.total = Math.round((end + 0.35) * 1000);
  if (tok != null) schedule(end + 0.6, () => { if (BD.focusTok === tok) applyIntent(); });
  return delays;
};
R3.setLabels = arr => { if (BD) BD.labels = arr || []; };
function pillar(p, col) {
  const m = new T.Mesh(new T.CylinderGeometry(0.32, 0.32, 3, 16, 1, true), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
  m.position.set(p.x, 1.5, p.z); BD.group.add(m);
  const t0 = clock();
  BD.anims.push(t => { const k = (t - t0) / 1.1; if (k >= 1) { BD.group.remove(m); return false; } m.material.opacity = 0.5 * (1 - k); m.scale.set(1 - k * 0.6, 1, 1 - k * 0.6); return true; });
  BD.parts.burst(p.clone().setY(0.1), 14, { spd: 1.2, life: 0.8, size: 0.06, color: col, grav: -1.5, upMin: 0.6 });
}
function nuke(f, rec) {
  const p = tp(f.x, f.y, 0.4);
  if (rec) rec.dying = { t0: clock(), vapor: true };
  flash(p.clone(), 0xffffff, 2.2, 0.25);
  BD.parts.burst(p, 30, { spd: 2.6, life: 0.8, size: 0.4, size1: 0.08, color: 0xfff2b0, color1: 0xff3a10, grav: -0.8, spread: 0.2 });
  smoke(p.clone().add(new T.Vector3(0, 0.4, 0)), 18, true);
  BD.parts.chunks(p.clone(), 14, 0x4b4239);
  const sw = new T.Mesh(new T.SphereGeometry(0.5, 20, 12), new T.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.6, blending: T.AdditiveBlending, depthWrite: false }));
  sw.position.copy(p); BD.group.add(sw);
  const t0 = clock();
  BD.anims.push(t => { const k = (t - t0) / 0.7; if (k >= 1) { BD.group.remove(sw); return false; } sw.scale.setScalar(1 + k * 4.5); sw.material.opacity = 0.6 * (1 - k); return true; });
  const ring = new T.Mesh(new T.RingGeometry(0.2, 0.32, 40), new T.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 1, depthWrite: false, side: T.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, 0.04, p.z); BD.group.add(ring);
  BD.anims.push(t => { const k = (t - t0) / 0.8; if (k >= 1) { BD.group.remove(ring); return false; } ring.scale.setScalar(1 + k * 9); ring.material.opacity = 1 - k; return true; });
  shake(0.35);
}

// a fresh battle: clear everything the last one left on the board
R3.reset = function () {
  if (!BD) return;
  MS = window.MW.W > 10 ? 0.98 : window.MW.W > 9 ? 1.06 : 1.15;
  while (BD.group.children.length) BD.group.remove(BD.group.children[0]);
  Object.assign(BD, { recs: {}, tiles: {}, ov: {}, props: {}, objs: {}, wrecks: {}, crates: {}, queue: [], anims: [], labels: [], shake: 0, base0: null, base1: null });
  BD.parts = new Particles(BD.group, 260);
  ST.hasBoard = false;
};

/* ---------- the frame loop ---------- */
let last = clock();
let looping = false;
function loop() {
  if (looping) return; looping = true;
  const step = () => {
    requestAnimationFrame(step);
    const t = clock(), dt = Math.min(0.05, t - last); last = t;
    if (document.hidden) return;
    if (BD && BD.el.isConnected && BD.el.offsetParent !== null) { updateBoard(t, dt); renderBoardFrame(dt); }
    if (HV && HV.canvas.isConnected && HV.canvas.offsetParent !== null) { updateViewer(t, dt); HV.renderer.render(HV.scene, HV.cam); inkPass(HV.renderer, HV.scene, HV.cam, HV.scene, HV.ink || (HV.ink = {})); }
  };
  requestAnimationFrame(step);
}
function renderBoardFrame(dt) {
  camUpdate(dt);
  BD.renderer.render(BD.scene, BD.cam);
  inkPass(BD.renderer, BD.scene, BD.cam, BD.group, BD.ink || (BD.ink = { weight: 0.55, alpha: 0.7 }));
  positionLabels();
}
const tmpV = new T.Vector3();
function project(v) {
  tmpV.copy(v); BD.group.localToWorld(tmpV); tmpV.project(BD.cam);
  return { x: (tmpV.x + 1) / 2 * BD.size.w, y: (1 - tmpV.y) / 2 * BD.size.h };
}
R3.project = (x, y, h) => BD ? project(tp(x, y, h || 0)) : { x: 0, y: 0 };
function positionLabels() {
  // zoomed out to the overview, labels shrink to just the HP bar; zoomed in they show everything
  const box0 = BD.labels.length && BD.labels[0].el && BD.labels[0].el.parentNode;
  if (box0) box0.classList.toggle('compact', BD.rig.zoom < 1.3 && window.MW.W > 9);
  for (const L of BD.labels) {
    let p;
    if (L.uid != null) { const rec = BD.recs[L.uid]; if (!rec) { L.el.style.display = 'none'; continue; } p = rec.R.root.position.clone(); p.y += L.h; }
    else p = tp(L.x, L.y, L.h || 0);
    const s = project(p);
    // tags just past the edge are nudged inside the stage; ones far off screen are hidden rather than pinned to the edge
    const W2 = BD.size.w, H2 = BD.size.h;
    if (s.x < -50 || s.x > W2 + 50 || s.y < -40 || s.y > H2 + 40) { L.el.style.display = 'none'; continue; }
    s.x = Math.max(26, Math.min(W2 - 26, s.x)); s.y = Math.max(22, Math.min(H2 - 4, s.y));
    L.el.style.display = '';
    L.el.style.transform = 'translate(' + s.x.toFixed(1) + 'px,' + s.y.toFixed(1) + 'px)';
  }
}

function updateBoard(t, dt) {
  for (let i = BD.queue.length - 1; i >= 0; i--) if (BD.queue[i].t <= t) { const q = BD.queue.splice(i, 1)[0]; try { q.fn(); } catch (e) { /* keep animating */ } }
  for (let i = BD.anims.length - 1; i >= 0; i--) { let keep = false; try { keep = BD.anims[i](t); } catch (e) { keep = false; } if (!keep) BD.anims.splice(i, 1); }
  BD.parts.update(dt);
  const pulse = 0.5 + 0.5 * Math.sin(t * 5);
  for (const k in BD.ov) { const ov = BD.ov[k], kd = ov.userData.kind; if (kd === 'target' || kd === 'dep') ov.material.opacity = (OV_OP[kd] || 0.4) * (0.6 + 0.5 * pulse); }
  for (const k in BD.objs) { const r = BD.objs[k]; if (r.dish) r.dish.rotation.y = t * 0.8; }
  for (const k in BD.wrecks) {
    const w = BD.wrecks[k];
    w.userData.glow.material.opacity = 0.2 + 0.35 * (0.5 + 0.5 * Math.sin(t * 3.5));
    if (Math.random() < dt * (LEVEL === 'low' ? 1 : 3)) smoke(w.position.clone().setY(0.12), 1, false);
  }
  for (const k in BD.crates) {
    const c = BD.crates[k], b = c.userData.body;
    if (c.userData.dropT != null) {
      const q = (t - c.userData.dropT) / 1.1;
      if (q >= 1) { b.position.y = 0; c.userData.dropT = null; c.userData.chute.visible = false; BD.parts.burst(c.position.clone().setY(0.05), 10, { add: false, spd: 0.8, life: 0.7, size: 0.1, size1: 0.25, color: 0xb8ad98, op: 0.7, upMin: 0 }); }
      else { b.position.y = 4 * (1 - ease(q)); b.rotation.z = Math.sin(t * 4) * 0.08; }
    } else b.position.y = 0.02 * Math.sin(t * 2);
  }
  if (BD.base0) BD.base0.lamp.visible = Math.sin(t * 4) > -0.2;
  if (BD.base1) BD.base1.lamp.visible = Math.sin(t * 4 + 1) > -0.2;
  for (const id in BD.recs) updateRec(BD.recs[id], t, dt);
}

function updateRec(rec, t, dt) {
  const R = rec.R, root = R.root;
  // leaving the field without an effect to play: remove
  if (rec.gone && !rec.claimed && t - rec.goneAt > 0.3) { dropRec(rec); return; }
  let y = 0;
  // drop-in deployment
  if (rec.drop) {
    const q = (t - rec.drop.t0) / rec.drop.dur;
    if (q >= 1) { rec.drop = null; BD.parts.burst(root.position.clone().setY(0.05), 14, { add: false, spd: 1, life: 0.7, size: 0.1, size1: 0.3, color: 0xb8ad98, op: 0.7, upMin: 0 }); shake(0.05); }
    else { y = 5 * Math.pow(1 - q, 2); if (R.thrusters) R.thrusters.forEach(f => { f.visible = true; f.scale.y = 1 + Math.random(); }); }
  }
  // walking along a path
  let moving = false;
  if (rec.walk) {
    const w = rec.walk, q = Math.max(0, Math.min(1, (t - w.t0) / w.dur)), n = w.pts.length - 1;
    const f = q * n, i = Math.min(n - 1, Math.floor(f)), u = f - i;
    const a = w.pts[i], b = w.pts[i + 1];
    root.position.lerpVectors(a, b, u);
    rec.faceT = Math.atan2(b.x - a.x, b.z - a.z);
    moving = q > 0;
    if (w.hop) y += Math.sin(q * Math.PI) * w.hop;
    if (q >= 1) { rec.walk = null; root.position.copy(rec.pos); moving = false; }
  }
  // returning to base
  if (rec.leave) {
    const q = (t - rec.leave.t0) / rec.leave.dur;
    if (q >= 1) { dropRec(rec); return; }
    root.position.lerpVectors(rec.pos, rec.leave.to, ease(q)); y = q * 0.6; root.scale.setScalar(MS * (1 - q * 0.7)); moving = true;
    rec.faceT = Math.atan2(rec.leave.to.x - rec.pos.x, rec.leave.to.z - rec.pos.z);
  }
  // lunge for melee
  let lungeOff = null;
  if (rec.lunge) {
    const q = (t - rec.lunge.t0) / 0.36;
    if (q >= 0 && q < 1) { const d = rec.lunge.to.clone().setY(0).sub(rec.pos.clone().setY(0)); lungeOff = d.multiplyScalar(Math.sin(q * Math.PI) * 0.5); }
    if (q >= 1) rec.lunge = null;
  }
  if (!rec.walk && !rec.leave) root.position.copy(rec.pos);
  if (lungeOff) root.position.add(lungeOff);
  // turning
  if (rec.faceT != null) {
    let d = rec.faceT - rec.face; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    rec.face += d * Math.min(1, dt * 10);
  }
  root.rotation.y = rec.face;
  // hit reaction
  if (rec.hitT && t - rec.hitT < 0.35) { const q = (t - rec.hitT) / 0.35; root.position.x += Math.sin(q * 40) * 0.03 * (1 - q); root.rotation.z = Math.sin(q * 30) * 0.06 * (1 - q); } else root.rotation.z = 0;
  // stripping in the field: parts lift away
  if (rec.strip) {
    const q = (t - rec.strip.t0) / 0.9;
    if (q >= 1) { dropRec(rec); return; }
    R.torso.position.y = q * 0.6; R.torso.rotation.y = q * 2; root.scale.setScalar(MS * (1 - q));
  }
  // charging a core detonation
  if (rec.charging && !rec.dying) {
    const q = Math.min(1, (t - rec.charging) / 0.7);
    if (R.core) R.core.scale.setScalar(1 + q * 3 + Math.sin(t * 40) * 0.3 * q);
    root.position.x += rand(-1, 1) * 0.02 * q;
    if (Math.random() < 0.6) BD.parts.spawn({ pos: root.position.clone().add(new T.Vector3(rand(-0.3, 0.3), rand(0.1, 0.8), rand(-0.3, 0.3))), vel: new T.Vector3(0, 0, 0), life: 0.3, size: 0.06, color: 0xfff0a0 });
  }
  // dying: topple, sink and go
  if (rec.dying) {
    const q = (t - rec.dying.t0) / (rec.dying.vapor ? 0.25 : 1.2);
    if (q >= 1) { dropRec(rec); return; }
    if (rec.dying.vapor) { root.scale.setScalar(MS * (1 - q)); }
    else { R.torso.rotation.x = -q * 1.2; R.hips.position.y = R.hipY * (1 - q * 0.7); y -= q * 0.15; if (Math.random() < 0.5) smoke(root.position.clone().setY(0.4), 1, false); if (Math.random() < 0.3) sparks(root.position.clone().setY(0.4), 0xffe2a0, 3); }
  } else if (!rec.strip && !rec.charging) {
    // idle and walk cycles
    const ph = t * (moving ? 9 : 1.6) + rec.phase;
    const kneel = R.kneel;
    const entr = rec.entr;
    let hipY = R.hipY * (kneel ? 0.62 : entr ? 0.9 : 1);
    if (R.kind === 'hover') { hipY += 0.03 * Math.sin(t * 2.2 + rec.phase); if (R.hoverGlow) R.hoverGlow.material.opacity = 0.4 + 0.3 * Math.sin(t * 6); }
    R.hips.position.y = hipY + (moving ? Math.abs(Math.sin(ph)) * 0.02 : Math.sin(ph) * 0.006);
    R.torso.rotation.y = moving ? 0 : Math.sin(t * 0.6 + rec.phase) * 0.08;
    if (R.head) R.head.rotation.y = Math.sin(t * 0.9 + rec.phase * 2) * 0.35;
    if (R.halo) R.halo.rotation.z = t * 0.7;
    if (R.monoEye) R.monoEye.position.x = Math.sin(t * 1.7 + rec.phase) * 0.032;
    if (R.kind === 'biped') R.legs.forEach((hip, i) => {
      const s = i ? 1 : -1;
      if (kneel) { hip.rotation.x = i ? -1.2 : 0.2; hip.userData.knee.rotation.x = i ? 1.6 : 0.9; return; }
      if (entr) { hip.rotation.x = -0.25; hip.userData.knee.rotation.x = 0.5; return; }
      hip.rotation.x = moving ? Math.sin(ph) * 0.55 * s : 0;
      hip.userData.knee.rotation.x = moving ? Math.max(0, Math.sin(ph + (i ? 0 : Math.PI))) * 0.7 : 0;
    });
    if (R.kind === 'quad') R.legs.forEach((hip, i) => { hip.rotation.x = moving ? Math.sin(ph + i * 1.6) * 0.3 : 0; });
    if (R.stakes) R.stakes.forEach(st => { st.g.rotation.z = entr ? st.sx * 0.6 : 0; st.g.position.y = entr ? -0.14 : -0.06; });
    if (R.boosters) R.boosters.forEach(f => { f.visible = moving; f.scale.y = 1 + Math.random() * 0.8; });
    if (R.thrusters && !rec.drop) R.thrusters.forEach(f => { f.visible = moving && R.kind !== 'treads'; f.scale.y = 1 + Math.random(); });
  }
  // weapons: recoil and spinning barrels
  for (const k in R.arms) {
    const a = R.arms[k];
    let rx = 0;
    if (rec.recoil && rec.lastArm === k) { const q = (t - rec.recoil) / 0.25; if (q < 1) rx = Math.sin(q * Math.PI) * 0.35; }
    a.arm.rotation.x = -rx - (moving ? 0 : Math.sin(t * 1.3 + rec.phase) * 0.03);
  }
  for (const k in R.muzzles) { const sp = R.muzzles[k].spin; if (sp) sp.rotation.z += dt * (rec.spin && t - rec.spin < 0.8 ? 40 : 0.8); }
  // core pulse
  if (R.core && R.coreLive && !rec.charging) R.core.scale.setScalar(1 + 0.15 * Math.sin(t * 4 + rec.phase));
  root.position.y = y;
  // brace shield shimmer
  if (rec.braceT && t - rec.braceT < 0.7) { const q = (t - rec.braceT) / 0.7; rec.bubble.material.opacity = 0.6 * (1 - q); rec.bubble.scale.setScalar(0.8 + q * 0.3); }
  else rec.bubble.material.opacity = rec.m && rec.m.braced ? 0.12 : 0;
  rec.bubble.position.copy(root.position).setY(root.position.y + 0.4);
  // rings and shadow follow
  for (const r of [rec.selRing, rec.actRing, rec.owRing, rec.blob]) { r.position.x = root.position.x; r.position.z = root.position.z; }
  rec.actRing.rotation.z = t * 2;
  rec.owRing.rotation.z = -t * 1.5;
  rec.selRing.material.opacity = 0.6 + 0.35 * Math.sin(t * 6);
  rec.blob.material.opacity = rec.gone ? 0 : 0.45;
  // ongoing effects: damage sparks, burning, frost, shock, overheating
  const m = rec.m;
  if (!rec.gone && m && LEVEL === 'full') {
    const hp = new T.Vector3();
    for (const s of R.sparks) if (Math.random() < dt * 2.5) { s.getWorldPosition(hp); BD.group.worldToLocal(hp); sparks(hp, 0xffe2a0, 3); if (Math.random() < 0.5) smoke(hp, 1, false); }
    const c = root.position.clone().setY(root.position.y + 0.45);
    if (m.burn > 0 && Math.random() < dt * 14) BD.parts.spawn({ pos: c.clone().add(new T.Vector3(rand(-0.15, 0.15), rand(-0.2, 0.2), rand(-0.15, 0.15))), vel: new T.Vector3(0, rand(0.6, 1), 0), life: 0.5, size: 0.08, size1: 0.18, color: 0xffd27a, color1: 0xff3a10 });
    if (m.slow > 0 && Math.random() < dt * 8) BD.parts.spawn({ pos: c.clone().add(new T.Vector3(rand(-0.2, 0.2), rand(-0.3, 0.2), rand(-0.2, 0.2))), vel: new T.Vector3(0, -0.2, 0), life: 0.8, size: 0.05, size1: 0.01, color: 0xe8fbff });
    if (m.shock && Math.random() < dt * 6) lightning(c.clone().add(new T.Vector3(rand(-0.2, 0.2), 0.2, rand(-0.2, 0.2))), c.clone().add(new T.Vector3(rand(-0.2, 0.2), -0.2, rand(-0.2, 0.2))), 0x9fe8ff, 0.15);
    if (rec.hot && Math.random() < dt * 6) BD.parts.spawn({ pos: c.clone().add(new T.Vector3(0, 0.15, -0.1)), vel: new T.Vector3(rand(-0.1, 0.1), 0.8, rand(-0.1, 0.1)), add: false, life: 0.8, size: 0.06, size1: 0.2, color: 0xdfe4ea, op: 0.6 });
  }
}

/* ================= hangar gantry viewer ================= */
let HV = null;
function makeViewer() {
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x1b232c);
  const canvas = renderer.domElement; canvas.className = 'h3d-canvas';
  const scene = new T.Scene();
  const cam = new T.PerspectiveCamera(34, 1, 0.1, 50);
  cam.position.set(0, 1.45, 4.3); cam.lookAt(0, 0.95, 0);
  scene.add(new T.HemisphereLight(0xdfe8f5, 0x30363e, 0.8));
  const key2 = new T.DirectionalLight(0xffffff, 0.75); key2.position.set(2, 4, 3); scene.add(key2);
  const rim = new T.DirectionalLight(0xb8c8cc, 0.35); rim.position.set(-3, 2, -3); scene.add(rim);
  // gantry: hazard-striped plate, scaffold towers, catwalk, back wall with lamps
  const env = new T.Group(); scene.add(env);
  mesh(cyl(1.25, 1.3, 0.12, 24), toon(0x3a414a), env, [0, -0.06, 0], null, { t: 0.02 });
  for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; mesh(box(0.18, 0.012, 0.08), toon(i % 2 ? 0xb59a55 : INK), env, [Math.cos(a) * 1.18, 0.005, Math.sin(a) * 1.18], [0, -a, 0], flat); }
  for (const sx of [-1, 1]) {
    for (const z of [-0.45, 0.25]) mesh(box(0.06, 2.6, 0.06), toon(0x9aa2aa), env, [sx * 1.05, 1.3, z]);
    for (const yy of [0.6, 1.3, 2.0]) { mesh(box(0.06, 0.06, 0.76), toon(0xe0b43a), env, [sx * 1.05, yy, -0.1]); mesh(box(0.06, 0.04, 0.8), toon(0x7a828a), env, [sx * 1.05, yy - 0.2, -0.1], [0.75, 0, 0], flat); }
    mesh(box(0.5, 0.05, 0.7), toon(0x6a727a), env, [sx * 1.32, 1.55, -0.1]);
  }
  mesh(box(4.4, 3.2, 0.1), toon(0x26303a), env, [0, 1.5, -1.35], null, { t: 0.02 });
  for (let i = 0; i < 5; i++) mesh(box(0.7, 0.04, 0.02), glow(0xffd88a), env, [-1.6 + i * 0.8, 2.6, -1.29], null, flat);
  for (let i = 0; i < 6; i++) mesh(box(0.02, 2.6, 0.02), toon(0x1a2128), env, [-2 + i * 0.8, 1.4, -1.29], null, flat);
  const holder = new T.Group(); scene.add(holder);
  HV = { renderer, canvas, scene, cam, holder, rot: 0, rotT: null, drag: null, R: null, sig: null, onPick: null, lastInput: 0,
    dist: 4.3, distT: 4.3, look: new T.Vector3(0, 0.95, 0), lookT: new T.Vector3(0, 0.95, 0), zoomU: 1, sel: null };
  canvas.addEventListener('wheel', e => { e.preventDefault(); HV.zoomU = Math.max(0.45, Math.min(1.4, HV.zoomU * Math.exp(e.deltaY * 0.0015))); }, { passive: false });
  // drag to turn the mech, tap to pick a part
  const ray = new T.Raycaster(), ndc = new T.Vector2();
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', e => { HV.drag = { x: e.clientX, y: e.clientY, rot: HV.rot, moved: false }; try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }; });
  const touches = new Map();
  canvas.addEventListener('pointermove', e => {
    if (touches.has(e.pointerId)) touches.get(e.pointerId).x = e.clientX, touches.get(e.pointerId).y = e.clientY;
    if (touches.size === 2) { const [a, b] = [...touches.values()], d = Math.hypot(b.x - a.x, b.y - a.y); if (HV.pinch) HV.zoomU = Math.max(0.45, Math.min(1.4, HV.pinch.z * HV.pinch.d / Math.max(20, d))); else HV.pinch = { d, z: HV.zoomU }; if (HV.drag) HV.drag.moved = true; return; }
    if (!HV.drag) return;
    const dx = e.clientX - HV.drag.x; if (Math.abs(dx) > 6) HV.drag.moved = true;
    HV.rot = HV.drag.rot + dx * 0.012; HV.rotT = null; HV.lastInput = clock();
  });
  canvas.addEventListener('pointerdown', e => { touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); HV.pinch = null; });
  canvas.addEventListener('pointercancel', e => { touches.delete(e.pointerId); HV.pinch = null; });
  canvas.addEventListener('pointerup', e => { touches.delete(e.pointerId); if (touches.size < 2) HV.pinch = null; });
  canvas.addEventListener('pointerup', e => {
    const d = HV.drag; HV.drag = null;
    if (!d || d.moved || !HV.onPick || !HV.R) return;
    const r = canvas.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    HV.scene.updateMatrixWorld(true); cam.updateMatrixWorld();
    ray.setFromCamera(ndc, cam);
    const hit = pickSlot(ray);
    HV.lastInput = clock();
    // tapping empty space lets go of the chosen part and the camera backs out
    if (hit) HV.onPick(hit.object.userData.slot); else if (HV.sel) HV.onPick(null);
  });
  return HV;
}
function updateViewer(t, dt) {
  const w = HV.canvas.clientWidth, h = HV.canvas.clientHeight;
  if (w && h && (HV.w !== w || HV.h !== h)) { HV.w = w; HV.h = h; HV.renderer.setSize(w, h, false); HV.cam.aspect = w / h; HV.cam.updateProjectionMatrix(); }
  const k = 1 - Math.exp(-dt * 5);
  if (HV.rotT != null) { let d = HV.rotT - HV.rot; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; HV.rot += d * k; }
  // idle: sway gently about the front view instead of spinning round, so left and right stay where the Workshop says they are
  else if (!HV.drag && !HV.sel && t - HV.lastInput > 2.5) HV.rot += (0.3 * Math.sin(t * 0.45) - HV.rot) * Math.min(1, dt * 1.2);
  HV.holder.rotation.y = HV.rot;
  HV.dist += (HV.distT - HV.dist) * k; HV.look.lerp(HV.lookT, k);
  const dir = new T.Vector3(0, 0.12, 1).normalize();
  HV.cam.position.copy(HV.look).addScaledVector(dir, HV.dist * HV.zoomU);
  HV.cam.lookAt(HV.look);
  if (HV.R) {
    const R = HV.R;
    R.hips.position.y = R.hipY + Math.sin(t * 1.6) * 0.006;
    if (R.head) R.head.rotation.y = Math.sin(t * 0.9) * 0.3;
    if (R.halo) R.halo.rotation.z = t * 0.7;
    if (R.monoEye) R.monoEye.position.x = Math.sin(t * 1.7) * 0.032;
    if (R.core && R.coreLive) R.core.scale.setScalar(1 + 0.15 * Math.sin(t * 4));
    if (R.coreAlarm) { const k = 0.5 + 0.5 * Math.sin(t * 6); R.coreAlarm.scale.setScalar(1 + 0.35 * k); R.coreAlarm.material.opacity = 0.45 + 0.5 * k; }
    if (R.hoverGlow) R.hips.position.y += 0.03 * Math.sin(t * 2.2);
  }
}
// a padded, invisible tap zone round each part of the mech on the gantry, so small parts are easy to hit
const ZONE_MAT = new T.MeshBasicMaterial({ visible: false });
function measureSlots() {
  HV.zones = [];
  if (!HV.R) return;
  const rot = HV.holder.rotation.y; HV.holder.rotation.y = 0; HV.scene.updateMatrixWorld(true);
  for (const key in HV.R.slots) {
    const bb = new T.Box3(); HV.R.slots[key].forEach(o => bb.expandByObject(o));
    if (bb.isEmpty()) continue;
    const c = new T.Vector3(), sz = new T.Vector3(); bb.getCenter(c); bb.getSize(sz);
    // small parts get a much bigger zone than their size; the core is a fingertip-sized ball proud of the chest
    const pad = key === 'torso' ? 0.16 : /^aux/.test(key) ? 0.12 : 0.06;
    const zone = new T.Mesh(key === 'core' ? sph(0.2, 12) : box(sz.x + pad, sz.y + pad, sz.z + pad), ZONE_MAT);
    zone.position.copy(c); if (key === 'core') zone.position.z = bb.max.z + 0.04;
    zone.userData.slot = key; zone.userData.noInk = true; zone.userData.zone = true;
    zone.userData.vol = key === 'core' ? 0 : (sz.x + pad) * (sz.y + pad) * (sz.z + pad);
    HV.holder.add(zone); HV.zones.push(zone);
  }
  HV.holder.rotation.y = rot; HV.scene.updateMatrixWorld(true);
}
// what a tap means: the core ball first, then the part actually under the finger, then the nearest padded zone for near misses
function pickSlot(ray) {
  const zones = ray.intersectObjects(HV.zones || [], false);
  const core = zones.find(h => h.object.userData.slot === 'core');
  if (core) return core;
  const exact = ray.intersectObjects(HV.holder.children, true).find(h => h.object.userData.slot && !h.object.userData.zone);
  if (exact) return exact;
  return zones.sort((a, b) => a.object.userData.vol - b.object.userData.vol)[0] || null;
}
/* ================= doctrine portraits ================= */
// a typical machine of each army, drawn once to an image for the doctrine picker
const ARCHETYPE = {
  assault: { torso: 't_assault', core: 'r_t_assault', legs: 'l_boost', armL: 'w_blade', armR: 'w_scatter', aux: ['a_jump', 'a_cool'] },
  armored: { torso: 't_fortress', core: 'r_t_fortress', legs: 'l_treads', armL: 'w_shield', armR: 'w_howitzer', aux: ['a_plate', 'a_bulwark'] },
  experimental: { torso: 't_proto', core: 'r_t_proto', legs: 'l_hover', armL: 'w_lance', armR: 's_emp', aux: ['a_relay', 'a_nano', 'a_shield'] }
};
const PORTRAITS = {};
let PR = null;
R3.portrait = function (doctrine) {
  if (PORTRAITS[doctrine]) return PORTRAITS[doctrine];
  const L = ARCHETYPE[doctrine];
  if (!L) return null;
  try {
    if (!PR) {
      const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1); renderer.setSize(240, 300, false); renderer.setClearColor(0x000000, 0);
      const scene = new T.Scene();
      scene.add(new T.HemisphereLight(0xdfe3e0, 0x3a3e42, 0.85));
      const key = new T.DirectionalLight(0xf2ead8, 0.8); key.position.set(2, 4, 3); scene.add(key);
      const rim = new T.DirectionalLight(0xb8c8cc, 0.45); rim.position.set(-3, 2, -3); scene.add(rim);
      const cam = new T.PerspectiveCamera(30, 240 / 300, 0.1, 50);
      const holder = new T.Group(); scene.add(holder);
      PR = { renderer, scene, cam, holder, ink: { weight: 1.2 } };
    }
    const D = DEFS(), mk = id => ({ id, hp: D[id].hp });
    const m = { owner: 0, slots: { torso: mk(L.torso), core: mk(L.core), legs: mk(L.legs), armL: mk(L.armL), armR: mk(L.armR), aux: L.aux.map(mk) } };
    while (PR.holder.children.length) PR.holder.remove(PR.holder.children[0]);
    const R = buildMech(m, 0, doctrine, {});
    R.root.rotation.y = 0.55;
    // a slight stride and raised weapon arm so the pose reads as ready for battle
    if (R.legs[0] && R.kind === 'biped') { R.legs[0].rotation.x = -0.18; R.legs[1].rotation.x = 0.14; }
    if (R.arms.armR) R.arms.armR.sh.rotation.x = -0.35;
    PR.holder.add(R.root);
    // frame the whole machine
    PR.scene.updateMatrixWorld(true);
    const bb = new T.Box3().setFromObject(R.root), c = new T.Vector3(), sz = new T.Vector3(); bb.getCenter(c); bb.getSize(sz);
    const dist = Math.max(sz.y, sz.x * 1.25) / (2 * Math.tan(15 * Math.PI / 180)) * 1.12;
    PR.cam.position.set(c.x + dist * 0.18, c.y + dist * 0.16, c.z + dist); PR.cam.lookAt(c);
    PR.renderer.render(PR.scene, PR.cam);
    inkPass(PR.renderer, PR.scene, PR.cam, PR.holder, PR.ink);
    PORTRAITS[doctrine] = PR.renderer.domElement.toDataURL('image/png');
    return PORTRAITS[doctrine];
  } catch (e) { return null; }
};
// show a mech on the gantry inside `el`; opt: { sel, ghosts, onPick }
R3.hangar = function (el, m, owner, doctrine, opt) {
  if (!HV) makeViewer();
  if (HV.canvas.parentNode !== el) el.appendChild(HV.canvas);
  opt = opt || {};
  const sig = m ? signature(m) + '|' + owner + '|' + doctrine + '|' + !!opt.ghosts + '|' + m.uid : '';
  if (sig !== HV.sig) {
    while (HV.holder.children.length) HV.holder.remove(HV.holder.children[0]);
    HV.R = null;
    if (m) {
      const R = buildMech(m, owner, doctrine, { ghosts: !!opt.ghosts }); R.root.scale.multiplyScalar(2.05); HV.holder.add(R.root); HV.R = R;
      const ry = HV.holder.rotation.y; HV.holder.rotation.y = 0; HV.scene.updateMatrixWorld(true);
      const bb = new T.Box3().setFromObject(R.root);
      HV.holder.rotation.y = ry;
      // farthest reach from the turning axis, and height under the lamps
      const reach = Math.max(...[bb.min.x, bb.max.x].flatMap(x => [bb.min.z, bb.max.z].map(z => Math.hypot(x, z))));
      const k = Math.min(1, 0.98 / Math.max(0.01, reach), 2.4 / Math.max(0.01, bb.max.y));
      if (k < 1) R.root.scale.multiplyScalar(k);
    }
    HV.sig = sig;
    measureSlots();
  }
  if (HV.R) highlight(HV.R, opt.sel || null);
  // zoom onto the chosen part: turn it to face the camera and move in; deselecting backs out to the whole mech
  const sel = opt.sel || null;
  if (sel !== HV.sel || sig !== HV.focusSig) {
    HV.sel = sel; HV.focusSig = sig;
    const objs = HV.R && sel ? HV.R.slots[sel] : null;
    if (objs && objs.length) {
      HV.scene.updateMatrixWorld(true);
      const bb = new T.Box3(); objs.forEach(o => bb.expandByObject(o));
      const c = new T.Vector3(); bb.getCenter(c);
      const local = HV.holder.worldToLocal(c.clone());
      HV.rotT = Math.atan2(-local.x, local.z);
      const r = Math.hypot(local.x, local.z);
      HV.lookT.set(0, Math.max(0.35, local.y), r * 0.6);
      HV.distT = 2.1;
    } else { HV.rotT = null; HV.lookT.set(0, 0.95, 0); HV.distT = 4.3; }
  }
  HV.onPick = opt.onPick || null;
  loop();
};
})();
