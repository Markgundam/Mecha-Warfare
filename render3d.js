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
// low effects also lighten the board's rendering: native pixel density and a smaller shadow map
R3.setLevel = l => { LEVEL = l === 'low' ? 'low' : 'full'; applyLevel(); };
function applyLevel() {
  if (!BD) return;
  const low = LEVEL === 'low', sz = low ? 1024 : 2048;
  BD.renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  if (BD.sun.shadow.mapSize.x !== sz) { BD.sun.shadow.mapSize.set(sz, sz); if (BD.sun.shadow.map) { BD.sun.shadow.map.dispose(); BD.sun.shadow.map = null; } }
  if (BD.resize) BD.resize();
}
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
/* Surfaces. Every solid is physically shaded and carries a generated texture: painted armour with grain, scuffs and
   bare-metal scratches; brushed gunmetal; and a ground for each biome. Textures are greyscale and tinted by the
   material's own colour, so one set serves every part. Bevelled boxes have UVs in world units, so the grain stays
   the same size on every plate. */
// periodic value noise, n×n, from a list of [cells, weight] octaves; tiles seamlessly
function pnoise(n, octaves) {
  const out = new Float32Array(n * n);
  let tot = 0;
  for (const [cells, a] of octaves) {
    const lat = new Float32Array(cells * cells).map(() => Math.random());
    for (let y = 0; y < n; y++) {
      const fy = y / n * cells, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty), y1 = (y0 + 1) % cells;
      for (let x = 0; x < n; x++) {
        const fx = x / n * cells, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx), x1 = (x0 + 1) % cells;
        out[y * n + x] += a * (lat[y0 * cells + x0] * (1 - sx) * (1 - sy) + lat[y0 * cells + x1] * sx * (1 - sy) + lat[y1 * cells + x0] * (1 - sx) * sy + lat[y1 * cells + x1] * sx * sy);
      }
    }
    tot += a;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
// a canvas from a per-pixel grey value, then optional strokes drawn over it (wrapped so the tile stays seamless)
function greyCanvas(n, val, strokes) {
  const c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), img = g.createImageData(n, n);
  for (let i = 0; i < n * n; i++) { const v = Math.max(0, Math.min(255, val(i))); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  if (strokes) for (const ox of [-n, 0, n]) for (const oy of [-n, 0, n]) { g.save(); g.translate(ox, oy); strokes(g, n); g.restore(); }
  return c;
}
function texOf(c, rep) { const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 4; return t; }
// a fixed sequence, so the marks are the same on every map of a texture and between strokes passes
const seeded = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(91);
// scratches: short bright nicks and a few longer drags; grime: soft dark blooms
const SCR = Array.from({ length: 70 }, () => ({ x: seeded(), y: seeded(), a: seeded() * Math.PI, l: 4 + seeded() * (seeded() < 0.2 ? 40 : 12), w: seeded() < 0.8 ? 1 : 2 }));
const GRIME = Array.from({ length: 14 }, () => ({ x: seeded(), y: seeded(), r: 6 + seeded() * 22 }));
function marks(g, n, light, dark) {
  for (const d of GRIME) { const gr = g.createRadialGradient(d.x * n, d.y * n, 0, d.x * n, d.y * n, d.r); gr.addColorStop(0, dark); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(d.x * n - d.r, d.y * n - d.r, d.r * 2, d.r * 2); }
  g.strokeStyle = light; g.lineCap = 'round';
  for (const k of SCR) { g.lineWidth = k.w; g.beginPath(); g.moveTo(k.x * n, k.y * n); g.lineTo(k.x * n + Math.cos(k.a) * k.l, k.y * n + Math.sin(k.a) * k.l); g.stroke(); }
}
const SURF = (() => {
  const n = 256, N = pnoise(n, [[4, 0.45], [16, 0.35], [64, 0.2]]), F = pnoise(n, [[128, 1]]);
  const paint = greyCanvas(n, i => 238 + (N[i] - 0.5) * 16 + (F[i] - 0.5) * 4, (g, n) => marks(g, n, 'rgba(255,255,255,0.32)', 'rgba(40,30,20,0.18)'));
  const paintR = greyCanvas(n, i => 165 + (N[i] - 0.5) * 70, (g, n) => marks(g, n, 'rgba(70,70,70,0.9)', 'rgba(230,230,230,0.35)'));
  const bump = greyCanvas(n, i => 128 + (F[i] - 0.5) * 14 + (N[i] - 0.5) * 22, (g, n) => marks(g, n, 'rgba(60,60,60,0.8)', 'rgba(0,0,0,0)'));
  // brushed metal: a random value per row, smeared along the row, over fine grain
  const rows = Array.from({ length: n }, () => Math.random());
  const metal = greyCanvas(n, i => 214 + (rows[Math.floor(i / n)] - 0.5) * 26 + (F[i] - 0.5) * 12 + (N[i] - 0.5) * 18, (g, n) => marks(g, n, 'rgba(255,255,255,0.4)', 'rgba(20,20,20,0.22)'));
  const metalR = greyCanvas(n, i => 105 + (rows[Math.floor(i / n)] - 0.5) * 40 + (N[i] - 0.5) * 50);
  return { paint: texOf(paint, 3), paintR: texOf(paintR, 3), bump: texOf(bump, 3), metal: texOf(metal, 3), metalR: texOf(metalR, 3) };
})();
// one ground texture per biome, tinted by each tile's colour; it spans two tiles so neighbours don't repeat exactly
const GROUND = {};
function groundTex(kind) {
  if (GROUND[kind]) return GROUND[kind];
  const n = 256, N = pnoise(n, [[4, 0.5], [12, 0.3], [48, 0.2]]), F = pnoise(n, [[96, 1]]);
  let val, strokes;
  if (kind === 'meadow') {
    val = i => 205 + (N[i] - 0.5) * 70 + (F[i] - 0.5) * 30;
    strokes = (g, n) => { for (let k = 0; k < 900; k++) { const x = seeded() * n, y = seeded() * n, l = 3 + seeded() * 6, a = -Math.PI / 2 + (seeded() - 0.5) * 0.9; g.strokeStyle = seeded() < 0.5 ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.16)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); } };
  } else if (kind === 'desert') {
    val = i => { const y = Math.floor(i / n); return 215 + Math.sin((y + N[i] * 60) / n * Math.PI * 2 * 7) * 14 + (F[i] - 0.5) * 26 + (N[i] - 0.5) * 30; };
  } else if (kind === 'snow') {
    val = i => 236 + (N[i] - 0.5) * 30 + (F[i] - 0.5) * 10;
    strokes = (g, n) => { g.fillStyle = 'rgba(255,255,255,0.7)'; for (let k = 0; k < 120; k++) g.fillRect(seeded() * n, seeded() * n, 1, 1); };
  } else if (kind === 'yard') {
    val = i => 200 + (N[i] - 0.5) * 60 + (F[i] - 0.5) * 50;
    strokes = (g, n) => {
      for (let k = 0; k < 9; k++) { const x = seeded() * n, y = seeded() * n, r = 8 + seeded() * 26, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(15,12,10,0.45)'); gr.addColorStop(1, 'rgba(15,12,10,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
      for (let k = 0; k < 500; k++) { g.fillStyle = seeded() < 0.5 ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'; const r = 1 + seeded() * 2; g.fillRect(seeded() * n, seeded() * n, r, r); }
    };
  } else {
    // rock: layered strata for the island's cliffs
    val = i => { const y = Math.floor(i / n); return 200 + Math.sin((y + N[i] * 90) / n * Math.PI * 2 * 5) * 18 + (N[i] - 0.5) * 60 + (F[i] - 0.5) * 24; };
  }
  const t = texOf(greyCanvas(n, val, strokes), 0.5);
  return (GROUND[kind] = t);
}
const MAT = {};
// dark, unsaturated colours are bare metal (gun barrels, frames, joints); everything else is painted plate
const isMetal = c => { const hsl = {}; new T.Color(c).getHSL(hsl); return hsl.s < 0.16 && hsl.l < 0.36; };
function toon(color) {
  const k = 't' + color;
  if (MAT[k]) return MAT[k];
  const metal = isMetal(color);
  const m = new T.MeshStandardMaterial({ color, map: metal ? SURF.metal : SURF.paint, roughnessMap: metal ? SURF.metalR : SURF.paintR, bumpMap: SURF.bump, bumpScale: 0.0018,
    roughness: metal ? 0.9 : 1, metalness: metal ? 0.72 : 0.08, envMapIntensity: metal ? 1.1 : 0.55 });
  m.userData.paint = true;
  return (MAT[k] = m);
}
// the ground: rough, never metallic, with the biome's surface
function soil(color, kind) {
  const k = 's' + color + kind;
  if (MAT[k]) return MAT[k];
  const t = groundTex(kind);
  const m = new T.MeshStandardMaterial({ color, map: t, bumpMap: t, bumpScale: 0.012, roughness: 0.96, metalness: 0, envMapIntensity: 0.35 });
  m.userData.paint = true;
  return (MAT[k] = m);
}
// three-point lighting for every close-up render (hangar, previews, portraits, part pictures): a warm key high on
// the right, a soft cool fill low on the left to lift the shadows, and a bright rim from behind that traces the
// silhouette, over a dim sky light and the reflection dome
function threePoint(scene, renderer, shadows) {
  scene.environment = envFor(renderer);
  scene.add(new T.HemisphereLight(0xdfe8f5, 0x30363e, 0.32));
  const key = new T.DirectionalLight(0xfff2de, 1.1); key.position.set(2.2, 4, 3); scene.add(key);
  const fill = new T.DirectionalLight(0xbcd4ee, 0.38); fill.position.set(-3, 1.2, 2.4); scene.add(fill);
  const rim = new T.DirectionalLight(0xd6e8ff, 1.05); rim.position.set(-1.5, 2.6, -3.5); scene.add(rim);
  const rim2 = new T.DirectionalLight(0xd6e8ff, 0.5); rim2.position.set(2.5, 1.8, -3); scene.add(rim2);
  if (shadows) {
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 3; key.shadow.bias = -0.002;
    Object.assign(key.shadow.camera, { left: -2, right: 2, top: 3, bottom: -1, near: 0.5, far: 12 });
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  }
  return { key, fill, rim };
}
// image-based light: a soft sky dome with a sun and a softbox, so metal has something to reflect
const ENVS = new WeakMap();
function envFor(renderer) {
  if (ENVS.has(renderer)) return ENVS.get(renderer);
  let tex = null;
  try {
    const pm = new T.PMREMGenerator(renderer), sc = new T.Scene();
    const g = new T.SphereGeometry(10, 32, 16), pos = g.attributes.position, cols = [];
    const sky = new T.Color(0xa9c3d6), hor = new T.Color(0xe4e8e6), gnd = new T.Color(0x3c3f42), c = new T.Color();
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 10; if (y > 0) c.copy(hor).lerp(sky, Math.pow(y, 0.6)); else c.copy(hor).lerp(gnd, Math.min(1, -y * 3)); cols.push(c.r, c.g, c.b); }
    g.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    sc.add(new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide })));
    const sun = new T.Mesh(new T.SphereGeometry(1.1, 12, 8), new T.MeshBasicMaterial({ color: 0xffffff })); sun.position.set(-4, 7, 5); sc.add(sun);
    const soft = new T.Mesh(new T.PlaneGeometry(7, 3), new T.MeshBasicMaterial({ color: 0xdfe6ea, side: T.DoubleSide })); soft.position.set(6, 3, -4); soft.lookAt(0, 0, 0); sc.add(soft);
    tex = pm.fromScene(sc, 0.03).texture; pm.dispose();
  } catch (e) { tex = null; }
  ENVS.set(renderer, tex);
  return tex;
}
// the same paint with a warm glow, for the part picked in the hangar
function lit(mat) { const k = 'l' + mat.uuid; if (!MAT[k]) { MAT[k] = mat.clone(); MAT[k].emissive = new T.Color(0x8a5c00); } return MAT[k]; }
function glow(color, op) { const k = 'g' + color + ':' + (op || 1); return MAT[k] || (MAT[k] = new T.MeshBasicMaterial({ color, transparent: op != null && op < 1, opacity: op == null ? 1 : op, depthWrite: !(op < 1) })); }
const GHOST = new T.MeshBasicMaterial({ color: 0x6fd8ff, transparent: true, opacity: 0.22, depthWrite: false });
const GHOST_SEL = new T.MeshBasicMaterial({ color: 0xffc83a, transparent: true, opacity: 0.4, depthWrite: false });
const GEO = {};
const geo = (k, make) => GEO[k] || (GEO[k] = make());
// a box with chamfered edges: hard-surface panels instead of razor-edged blocks (tiny parts stay plain)
function bevelBox(w, h, d) {
  const b = Math.min(0.012, Math.min(w, h, d) * 0.14);
  if (b < 0.0025) return new T.BoxGeometry(w, h, d);
  const a = w / 2 - b, c = h / 2 - b, sh = new T.Shape();
  sh.moveTo(-a, -c); sh.lineTo(a, -c); sh.lineTo(a, c); sh.lineTo(-a, c); sh.lineTo(-a, -c);
  const g = new T.ExtrudeGeometry(sh, { depth: Math.max(0.0001, d - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: 0, bevelSegments: 1, curveSegments: 1, steps: 1 });
  g.translate(0, 0, -(d - 2 * b) / 2);
  g.computeVertexNormals();
  return g;
}
const box = (w, h, d) => geo('b' + w + ',' + h + ',' + d, () => { const g = bevelBox(w, h, d); g.userData.plate = [w, h, d, 1, 1, 0]; return g; });
// round parts get enough sides to read as round; deliberate hexes and thin rods keep their facets
const segs = s => (!s ? 18 : s < 8 ? s : Math.max(s, 16));
const cyl = (rt, rb, h, s) => geo('c' + rt + ',' + rb + ',' + h + ',' + segs(s), () => new T.CylinderGeometry(rt, rb, h, segs(s)));
const cone = (r, h, s) => geo('o' + r + ',' + h + ',' + (s || 10), () => new T.ConeGeometry(r, h, s || 10));
const sph = (r, s) => { const n = !s ? 18 : s < 8 ? s : Math.max(s, 16); return geo('s' + r + ',' + n, () => new T.SphereGeometry(r, n, Math.max(6, Math.round(n * 0.7)))); };
const tor = (r, t, arc) => geo('t' + r + ',' + t + ',' + (arc || 0), () => new T.TorusGeometry(r, t, 8, 40, arc || Math.PI * 2));
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
/* ================= ambient occlusion =================
   Screen-space, from the depth the ink mask already draws: each pixel looks around a small disc for nearby surfaces
   that rise in front of it (a foot on the ground, a wall against a container) and darkens by how much they close it
   in. Multiplied over the frame before the ink goes on. The board camera is orthographic, so depth is linear. */
const AO_FS = [
  'uniform sampler2D tDepth; uniform vec2 fr; uniform vec2 px; uniform float near; uniform float far; uniform float radius; uniform float power; varying vec2 vUv;',
  'vec3 pos(vec2 uv) { return vec3((uv - 0.5) * fr, -(near + texture2D(tDepth, uv).x * (far - near))); }',
  'void main() {',
  '  if (texture2D(tDepth, vUv).x >= 1.0) discard;',
  '  vec3 P = pos(vUv);',
  '  vec3 a = pos(vUv + vec2(px.x, 0.0)) - P, b = P - pos(vUv - vec2(px.x, 0.0)), c = pos(vUv + vec2(0.0, px.y)) - P, d = P - pos(vUv - vec2(0.0, px.y));',
  '  vec3 N = normalize(cross(abs(a.z) < abs(b.z) ? a : b, abs(c.z) < abs(d.z) ? c : d)); if (N.z < 0.0) N = -N;',
  '  float spin = fract(sin(dot(floor(gl_FragCoord.xy / 2.0), vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853, ao = 0.0;',
  '  for (int i = 0; i < 16; i++) {',
  '    float t = (float(i) + 0.5) / 16.0, ang = spin + float(i) * 2.3999632;',
  '    vec3 v = pos(vUv + vec2(cos(ang), sin(ang)) * sqrt(t) * radius / fr) - P;',
  '    float l = length(v);',
  '    ao += max(0.0, dot(v, N) / (l + 1e-4) - 0.12) * max(0.0, 1.0 - l / (radius * 1.6));',
  '  }',
  '  gl_FragColor = vec4(vec3(clamp(1.0 - power * ao / 16.0, 0.0, 1.0)), 1.0);',
  '}'].join('\n');
function aoQuad(renderer, cam, st) {
  if (!st.aoMat) {
    st.aoMat = new T.ShaderMaterial({ uniforms: { tDepth: { value: null }, fr: { value: new T.Vector2() }, px: { value: new T.Vector2() }, near: { value: 0 }, far: { value: 1 }, radius: { value: st.aoRadius || 0.26 }, power: { value: st.aoPower || 2.2 } },
      vertexShader: INK_VS, fragmentShader: AO_FS, depthTest: false, depthWrite: false, transparent: true,
      blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.ZeroFactor, blendDst: T.SrcColorFactor });
    st.aoQuad = new T.Mesh(new T.PlaneGeometry(2, 2), st.aoMat); st.aoQuad.frustumCulled = false;
    st.aoScene = new T.Scene(); st.aoScene.add(st.aoQuad);
  }
  const u = st.aoMat.uniforms;
  u.tDepth.value = st.rt.depthTexture;
  u.fr.value.set((cam.right - cam.left) / cam.zoom, (cam.top - cam.bottom) / cam.zoom);
  u.px.value.set(1 / inkV2.x, 1 / inkV2.y);
  u.near.value = cam.near; u.far.value = cam.far;
  const ac = renderer.autoClear; renderer.autoClear = false; renderer.render(st.aoScene, st.qc); renderer.autoClear = ac;
}
const inkV2 = new T.Vector2(), inkCol = new T.Color();
function inkPass(renderer, scene, cam, top, st) {
  renderer.getDrawingBufferSize(inkV2);
  if (!st.rt || st.rt.width !== inkV2.x || st.rt.height !== inkV2.y) {
    if (st.rt) st.rt.dispose();
    st.rt = new T.WebGLRenderTarget(inkV2.x, inkV2.y, { minFilter: T.NearestFilter, magFilter: T.NearestFilter, format: T.RGBAFormat });
    // the mask's depth doubles as the input to ambient occlusion
    if (st.ao) { st.rt.depthTexture = new T.DepthTexture(inkV2.x, inkV2.y); st.rt.depthTexture.type = T.UnsignedIntType; }
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
  if (st.ao && LEVEL !== 'low' && cam.isOrthographicCamera && st.rt.depthTexture) aoQuad(renderer, cam, st);
  const ac = renderer.autoClear; renderer.autoClear = false; renderer.render(st.qs, st.qc); renderer.autoClear = ac;
}
// one mesh with an ink outline; pos/rot are [x,y,z]
function layered(mat, L) {
  if (!L || mat === GHOST || mat === GHOST_SEL) return mat;
  const k = 'z' + mat.uuid + ':' + L;
  if (!MAT[k]) { MAT[k] = mat.clone(); MAT[k].polygonOffset = true; MAT[k].polygonOffsetFactor = -1; MAT[k].polygonOffsetUnits = -4; }
  return MAT[k];
}
// surface detail for big plates: a recessed panel seam across the front face, and corner bolts on the largest
const darker = c => { const col = new T.Color(c); col.multiplyScalar(0.55); return col.getHex(); };
function panelDetail(m, g, mat) {
  const [w, h, d, tx, tz, sz] = g.userData.plate;
  if (w < 0.13 || h < 0.11 || d < 0.04 || !mat.userData.paint) return;
  const ink = toon(darker(mat.color.getHex()));
  const front = t => (d / 2) * (1 + (tz - 1) * t) + sz * t + 0.003;   // the front face at height fraction t
  if (w >= h) { const t = 0.38; mesh(box(w * (1 + (tx - 1) * t) * 0.82, 0.006, 0.006), ink, m, [0, -h / 2 + h * t, front(t)], null, flat); }
  else { const t = 0.5; mesh(box(0.006, h * 0.7, 0.006), ink, m, [w * 0.18, 0, front(t)], [Math.atan2((d / 2) * (1 - tz) - sz, h), 0, 0], flat); }
  if (w >= 0.2 && h >= 0.15) for (const sx of [-1, 1]) { const t = 0.82; mesh(cyl(0.008, 0.008, 0.008, 6), ink, m, [sx * (w / 2) * (1 + (tx - 1) * t) * 0.78, -h / 2 + h * t, front(t)], [Math.PI / 2, 0, 0], flat); }
}
// every part is built a hair larger than drawn: its faces move out by a tiny distance unique to it (0.5 to 4
// thousandths of a unit, spread by the golden ratio), so two parts that meet flush or overlap never share a face
// plane and no pair of faces can z-fight. The distance is fixed rather than a percentage so small parts separate too.
let JIT = 0;
function jitter(g) {
  if (g.userData.exact) return 1;
  if (!g.boundingSphere) g.computeBoundingSphere();
  const d = 0.0005 + 0.0035 * ((++JIT * 0.6180339887) % 1), x = d / (0.08 * Math.max(0.003, g.boundingSphere.radius));
  // growth stays under 15% on the smallest bolts, and never flattens out, so every part's offset stays its own
  return 1 + 0.15 * x / (1 + x);
}
function mesh(g, mat, parent, pos, rot, opt) {
  // decals and trim laid flat on a surface get a small, constant depth bias so they win over the surface
  // underneath; solid parts get none, so nothing behind a part can ever poke through it as the view turns
  if (opt && opt.noOutline) mat = layered(mat, 1);
  const m = new T.Mesh(g, mat);
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  if (mat !== GHOST && mat !== GHOST_SEL) m.scale.setScalar(jitter(g));
  m.castShadow = !(opt && opt.noShadow) && mat !== GHOST;
  m.receiveShadow = !!(opt && opt.recv);
  if (!(opt && opt.noOutline) && mat.type !== 'MeshBasicMaterial') outline(m);
  if (parent) parent.add(m);
  if (g.userData.plate && !(opt && opt.noOutline) && mat !== GHOST) panelDetail(m, g, mat);
  return m;
}
const flat = { noOutline: true, noShadow: true };
/* Curved parts. A gun is drawn the way a concept artist draws it: as a side profile, then given thickness.
   profile(): a 2D outline in side view, points as [z, y] (z forward, y up), with ['q', cz, cy, z, y] for a
   curve through a control point and ['c', c1z, c1y, c2z, c2y, z, y] for an S-curve; extruded w wide with
   rounded bevels. turned(): a round part spun from [radius, z] pairs, back to front, like a lathe.
   tube(): a round section swept along a 3D path, for hoses, cables and belts. */
function profile(key, w, cmds, bevel) {
  const b = bevel == null ? Math.min(0.006, w * 0.16) : bevel;
  return geo('pf:' + key + ':' + w + ':' + b, () => {
    const sh = new T.Shape();
    cmds.forEach((c, i) => {
      if (typeof c[0] === 'number') { if (i) sh.lineTo(c[0], c[1]); else sh.moveTo(c[0], c[1]); }
      else if (c[0] === 'q') sh.quadraticCurveTo(c[1], c[2], c[3], c[4]);
      else if (c[0] === 'c') sh.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
    });
    const depth = Math.max(0.001, w - 2 * b);
    const g = new T.ExtrudeGeometry(sh, { depth, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: 32, steps: 1 });
    g.rotateY(-Math.PI / 2);
    g.translate(depth / 2, 0, 0);
    g.computeVertexNormals(); g.userData.exact = true;
    return g;
  });
}
function turned(key, pts, seg) {
  return geo('la:' + key, () => {
    // outlines drawn front to back would turn the faces inward; spin them in one direction always
    const ps = pts[pts.length - 1][1] < pts[0][1] ? pts.slice().reverse() : pts;
    const g = new T.LatheGeometry(ps.map(([r, z]) => new T.Vector2(Math.max(0.0005, r), z)), seg || 36);
    g.rotateX(Math.PI / 2);
    g.computeVertexNormals(); g.userData.exact = true;
    return g;
  });
}
function slab(key, d, cmds, bevel) {
  const b = bevel == null ? Math.min(0.006, d * 0.16) : bevel;
  return geo('sl:' + key + ':' + d + ':' + b, () => {
    const sh = new T.Shape();
    cmds.forEach((c, i) => {
      if (typeof c[0] === 'number') { if (i) sh.lineTo(c[0], c[1]); else sh.moveTo(c[0], c[1]); }
      else if (c[0] === 'q') sh.quadraticCurveTo(c[1], c[2], c[3], c[4]);
      else if (c[0] === 'c') sh.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
    });
    const depth = Math.max(0.001, d - 2 * b);
    const g = new T.ExtrudeGeometry(sh, { depth, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: 24, steps: 1 });
    g.translate(0, 0, -depth / 2);
    g.computeVertexNormals(); g.userData.exact = true; return g;
  });
}
function bend(key, g0, k) {
  return geo('bd:' + key + ':' + k, () => {
    const g = g0.clone(), a = g.attributes.position;
    for (let i = 0; i < a.count; i++) a.setX(i, a.getX(i) - k * a.getZ(i) * a.getZ(i));
    g.computeVertexNormals(); g.userData.exact = true; return g;
  });
}
function tube(key, pts, r, seg) {
  return geo('tu:' + key, () => { const g = new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(q => new T.Vector3(q[0], q[1], q[2]))), seg || 40, r, 10, false); g.userData.exact = true; return g; });
}

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
  chunks(pos, n, color, o) {
    o = o || {};
    const k = LEVEL === 'low' ? Math.ceil(n / 2) : n;
    for (let i = 0; i < k; i++) {
      const m = new T.Mesh(box(0.05, 0.035, 0.05), toon(color || 0x4a4f57));
      m.position.copy(pos); m.castShadow = true;
      this.parent.add(m);
      const sp = o.spd || 1;
      this.debris.push({ m, v: new T.Vector3(rand(-1.4, 1.4) * sp, rand(1.2, 2.6) * sp, rand(-1.4, 1.4) * sp), r: new T.Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8)), age: 0, fire: o.fire && Math.random() < 0.6, life: 2.2 });
    }
  }
  // a whole part torn off and thrown: keeps its place in the world, tumbles, bounces, trails fire and smoke
  fling(obj, v, life) {
    this.parent.attach(obj);
    this.debris.push({ m: obj, v, r: new T.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)), age: 0, fire: true, life: life || 2.8 });
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
      // burning debris trails flame while it flies and smoke once it has landed
      if (d.fire && LEVEL !== 'low' && Math.random() < 0.55) {
        const air = d.m.position.y > 0.05;
        this.spawn({ pos: d.m.position.clone(), vel: new T.Vector3(rand(-0.1, 0.1), air ? 0.1 : 0.35, rand(-0.1, 0.1)), add: air, life: air ? 0.4 : 1.6, size: air ? 0.07 : 0.1, size1: air ? 0.02 : 0.32, color: air ? 0xffc060 : 0x2e2a28, color1: air ? 0xc8320f : 0x6d6862, op: air ? 1 : 0.6, op1: 0, drag: 0.6 });
      }
      if (d.age > d.life - 0.6) { d.m.scale.multiplyScalar(0.9); }
      if (d.age > d.life) { this.parent.remove(d.m); this.debris.splice(i, 1); }
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
  // a chamfered box tapered from bottom to top, so the bevels follow the slope
  const g = bevelBox(w, h, d), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.max(0, (p.getY(i) + h / 2) / h));
    p.setX(i, p.getX(i) * (1 + (tx - 1) * t)); p.setZ(i, p.getZ(i) * (1 + (tz - 1) * t) + (sz || 0) * t);
  }
  g.computeVertexNormals(); g.userData.plate = [w, h, d, tx, tz, sz || 0]; return g;
});
const FRAME_DIM = { c_sing: [0.28, 0.26, 0.22], s_core: [0.32, 0.30, 0.20], b_torso: [0.30, 0.26, 0.20], t_heavy: [0.40, 0.27, 0.27], t_light: [0.24, 0.25, 0.16], t_assault: [0.33, 0.28, 0.21], t_fortress: [0.48, 0.31, 0.30], t_proto: [0.29, 0.29, 0.19], s_frame: [0.38, 0.30, 0.24], t_skirm: [0.22, 0.21, 0.15] };
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
    // a tank base: two long track units set wide apart, a low hull deck between them and a waist pedestal on a turret ring
    R.kind = 'treads'; R.hipY = 0.34;
    for (const sx of [-1, 1]) {
      const x = sx * 0.2;
      // large: the track loop seen from the side: a long run with a sloped glacis at the front and a shorter slope
      // at the back, its ends rounded over the idler and the sprocket
      mesh(profile('tr-track', 0.14, [[-0.2, 0.0], [0.17, 0.0], ['q', 0.24, 0.0, 0.26, 0.07], [0.22, 0.17], [-0.21, 0.18], ['q', -0.27, 0.16, -0.26, 0.08], ['q', -0.25, 0.0, -0.2, 0.0]], 0.012), M(tc.dark), g, [x, 0.0, 0]);
      if (!ghost) {
        // medium: road wheels and the drive sprocket on the outer face, and tread bars across the top run
        for (const z of [-0.15, -0.05, 0.05, 0.15]) mesh(turned('tr-wheel', [[0.0, -0.02], [0.05, -0.02], [0.058, -0.012], [0.058, 0.012], [0.05, 0.02], [0.018, 0.028], [0.0, 0.028]], 28), toon(tc.metal), g, [x + sx * 0.062, 0.064, z], [0, sx * Math.PI / 2, 0], { noOutline: true });
        mesh(turned('tr-sprocket', [[0.0, -0.02], [0.056, -0.02], [0.064, -0.01], [0.064, 0.01], [0.056, 0.02], [0.02, 0.03], [0.0, 0.03]], 12), toon(tc.accent), g, [x + sx * 0.062, 0.09, 0.21], [0, sx * Math.PI / 2, 0], { noOutline: true });
        for (let i = 0; i < 8; i++) mesh(box(0.142, 0.012, 0.022), toon(INK), g, [x, 0.181, -0.17 + i * 0.05], null, flat);
      }
      // the armoured fender over the top run and the side skirt hanging over the upper half of the wheels
      mesh(profile('tr-fender', 0.16, [[-0.23, 0.2], [0.19, 0.2], [0.25, 0.17], [-0.25, 0.17]], 0.008), M(tc.main), g, [x, 0.0, 0]);
      mesh(profile('tr-skirt', 0.016, [[-0.2, 0.2], [0.18, 0.2], [0.21, 0.15], [-0.2, 0.14]], 0.004), M(tc.main), g, [x + sx * 0.085, 0.0, 0]);
      // small: a hazard tab and bolts on each skirt
      if (!ghost) { mesh(box(0.008, 0.026, 0.07), toon(tc.accent), g, [x + sx * 0.094, 0.175, 0.12], null, flat); rivets(g, toon(tc.dark), [[x + sx * 0.094, 0.18, -0.08], [x + sx * 0.094, 0.18, 0.0], [x + sx * 0.094, 0.18, -0.16]]); }
    }
    // the hull deck between the tracks, sloped at the front
    mesh(profile('tr-deck', 0.28, [[-0.22, 0.12], [0.16, 0.12], [0.26, 0.15], [0.2, 0.19], [-0.22, 0.19]], 0.01), M(tc.second), g);
    if (!ghost) vents(g, toon(tc.dark), 3, 0.14, 0.022, [0, 0.19, -0.14], [-Math.PI / 2, 0, 0]);
    // the waist pedestal on its turret ring
    mesh(turned('tr-ring', [[0.0, 0.19], [0.15, 0.19], [0.15, 0.21], [0.13, 0.23], [0.0, 0.23]], 32), M(tc.dark), g, null, [-Math.PI / 2, 0, 0]);
    mesh(turned('tr-ped', [[0.0, 0.22], [0.11, 0.22], [0.11, 0.25], [0.09, 0.27], [0.09, 0.33], [0.1, 0.34], [0.1, 0.36], [0.0, 0.36]], 32), M(tc.second), g, null, [-Math.PI / 2, 0, 0]);
    return;
  }
  if (id === 'l_hover') {
    R.kind = 'hover'; R.hipY = 0.35;
    mesh(turned('hv-bell', [[0.0, 0.36], [0.11, 0.36], [0.125, 0.32], [0.152, 0.22], [0.188, 0.14], [0.205, 0.11], [0.205, 0.1], [0.0, 0.1]], 40), M(tc.main), g, null, [-Math.PI / 2, 0, 0]);
    mesh(turned('hv-hem', [[0.0, 0.07], [0.205, 0.07], [0.212, 0.085], [0.205, 0.105], [0.0, 0.105]], 40), M(tc.dark), g, null, [-Math.PI / 2, 0, 0]);
    mesh(turned('hv-waist', [[0.0, 0.33], [0.118, 0.33], [0.122, 0.345], [0.116, 0.37], [0.0, 0.37]], 40), M(tc.second), g, null, [-Math.PI / 2, 0, 0]);
    if (!ghost) {
      // armour seams running down the bell, and thruster nozzles round the underside
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + Math.PI / 8; const sg = new T.Group(); sg.rotation.y = -a; g.add(sg); mesh(box(0.006, 0.19, 0.006), toon(INK), sg, [0, 0.215, 0.166], [-0.34, 0, 0], flat); }
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; mesh(turned('hv-noz', [[0.0, 0.0], [0.022, 0.0], [0.018, 0.03], [0.0, 0.03]], 16), toon(tc.dark), g, [Math.cos(a) * 0.13, 0.04, Math.sin(a) * 0.13], [Math.PI / 2, 0, 0]); mesh(sph(0.012, 8), glow(tc.glow), g, [Math.cos(a) * 0.13, 0.04, Math.sin(a) * 0.13], null, flat); }
      const d = new T.Mesh(new T.CircleGeometry(0.17, 16), glow(tc.glow, 0.55)); d.rotation.x = -Math.PI / 2; d.position.y = 0.04; g.add(d); R.hoverGlow = d;
    }
    return;
  }
  if (id === 'l_quad') {
    // a chunky four-legged walker: an armoured hub on a turret ring, legs with big round joints,
    // thick thighs, ball knees and broad armoured shin plates on blocky feet. Each leg is rigged hip (yaw) > thigh > knee > ankle
    // so IK can plant the feet and walk it like a heavy spider
    R.kind = 'quad'; R.hipY = 0.4;
    mesh(turned('qd-hub', [[0.0, 0.28], [0.16, 0.28], [0.185, 0.31], [0.185, 0.37], [0.16, 0.4], [0.0, 0.4]], 8), M(tc.second), g, null, [-Math.PI / 2, 0, Math.PI / 8]);
    mesh(turned('qd-top', [[0.0, 0.4], [0.13, 0.4], [0.13, 0.42], [0.11, 0.445], [0.0, 0.445]], 8), M(tc.main), g, null, [-Math.PI / 2, 0, Math.PI / 8]);
    mesh(cyl(0.085, 0.095, 0.035, 18), M(tc.dark), g, [0, 0.46, 0]);
    if (!ghost) { for (const r2 of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) vents(g, toon(tc.dark), 3, 0.08, 0.022, [Math.sin(r2) * 0.172, 0.34, Math.cos(r2) * 0.172], [0, r2, 0]); }
    const LF = 0.24, LT = 0.42, HY = 0.34;
    R.quad = { LF, LT, hy: HY, sole: 0.03, stride: 0.2, lift: 0.08, legs: [] };
    for (const [sx, sz] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
      const hx = sx * 0.12, hz = sz * 0.12;
      const coxa = new T.Group(); coxa.position.set(hx, HY, hz); coxa.rotation.y = Math.atan2(sx, sz); g.add(coxa); R.legs.push(coxa);
      // hip: a big round joint with a capped disc
      mesh(cyl(0.06, 0.06, 0.09, 18), M(tc.dark), coxa, [0, 0, 0.02], [0, 0, Math.PI / 2]);
      if (!ghost) for (const x of [-1, 1]) { mesh(cyl(0.045, 0.045, 0.012, 18), toon(tc.main), coxa, [x * 0.048, 0, 0.02], [0, 0, Math.PI / 2], flat); mesh(cyl(0.014, 0.014, 0.014, 12), toon(tc.dark), coxa, [x * 0.05, 0, 0.02], [0, 0, Math.PI / 2], flat); }
      // thigh: the thick block from the hip out to the knee
      const femur = new T.Group(); coxa.add(femur);
      mesh(profile('qd-thigh', 0.1, [[0.0, 0.05], [0.04, 0.06], [LF - 0.03, 0.04], [LF + 0.005, 0.0], [LF - 0.03, -0.04], [0.04, -0.05], [0.0, -0.04]], 0.01), M(tc.main), femur);
      if (!ghost) mesh(profile('qd-thighp', 0.07, [[0.05, 0.058], [LF - 0.05, 0.042], [LF - 0.06, 0.056], [0.06, 0.07]], 0.004), toon(tc.second), femur);
      // knee: a ball joint with a side cap
      const tibia = new T.Group(); tibia.position.z = LF; femur.add(tibia);
      mesh(sph(0.06, 16), M(tc.dark), tibia, [0, 0, 0]);
      if (!ghost) mesh(cyl(0.035, 0.035, 0.012, 16), toon(tc.second), tibia, [0.06, 0, 0], [0, 0, Math.PI / 2], flat);
      // shin: a broad armoured plate, wider at the knee, with a grid of vent holes on its outer face
      // the shin tapers down into a turned ankle sleeve, so the foot hangs from a joint and not from a slab end
      mesh(profile('qd-shin', 0.12, [[0.0, 0.05], [0.07, 0.075], [0.2, 0.06], [LT - 0.17, 0.04], [LT - 0.13, 0.03], [LT - 0.13, -0.03], [LT - 0.17, -0.04], [0.07, -0.05], [0.0, -0.05]], 0.01), M(tc.second), tibia);
      mesh(turned('qd-lshin', [[0.0, LT - 0.15], [0.05, LT - 0.15], [0.046, LT - 0.12], [0.042, LT - 0.04], [0.0, LT - 0.03]], 16), M(tc.dark), tibia);
      mesh(turned('qd-sleeve', [[0.0, LT - 0.11], [0.054, LT - 0.11], [0.058, LT - 0.095], [0.054, LT - 0.07], [0.0, LT - 0.07]], 16), M(tc.main), tibia);
      mesh(profile('qd-shinp', 0.1, [[0.06, 0.07], [0.22, 0.056], [0.21, 0.074], [0.08, 0.088]], 0.004), M(tc.main), tibia);
      if (!ghost) for (const x of [-0.022, 0, 0.022]) for (const zz of [0.08, 0.055]) mesh(cyl(0.007, 0.007, 0.01, 8), toon(tc.dark), tibia, [x, 0.092, zz], null, flat);
      // foot: a blocky pad that stays flat on the ground
      const ankle = new T.Group(); ankle.position.z = LT; tibia.add(ankle);
      const foot = new T.Group(); foot.scale.setScalar(0.825); foot.position.y = 0.03 * (0.825 - 1); ankle.add(foot);
      // a mech foot after hard-surface robot feet: the ankle rides on a raised hub, and three articulated toes reach
      // down from it, two splayed forward and one behind. Each toe is two chamfered plates on a hinge pin, the outer
      // one lying flat on the ground, with a piston running from the hub to the hinge
      mesh(sph(0.04, 14), M(tc.dark), foot);
      mesh(turned('qd-fhub', [[0.0, -0.012], [0.04, -0.012], [0.05, 0.0], [0.05, 0.022], [0.04, 0.034], [0.0, 0.034]], 12), M(tc.second), foot, null, [-Math.PI / 2, 0, 0]);
      for (const [a, len] of [[0.34, 1], [-0.34, 1], [Math.PI, 0.7]]) {
        const toe = new T.Group(); toe.rotation.y = a; toe.scale.set(1, 1, len); foot.add(toe);
        mesh(profile('qd-toe1', 0.07, [[0.02, 0.026], [0.072, 0.008], [0.086, -0.006], [0.076, -0.02], [0.03, -0.006], [0.016, 0.008]], 0.006), M(tc.main), toe);
        mesh(profile('qd-toe2', 0.084, [[0.064, -0.004], [0.128, -0.01], [0.148, -0.018], [0.148, -0.03], [0.06, -0.03], [0.056, -0.016]], 0.006), M(tc.second), toe);
        mesh(profile('qd-toe3', 0.068, [[0.09, -0.004], [0.13, -0.008], [0.14, -0.014], [0.09, -0.008]], 0.003), M(tc.main), toe);
        if (!ghost) {
          mesh(cyl(0.013, 0.013, 0.094, 12), M(tc.dark), toe, [0, -0.014, 0.074], [0, 0, Math.PI / 2]);
          mesh(tube('qd-piston', [[0, 0.03, 0.01], [0, 0.016, 0.07]], 0.006, 2), toon(tc.metal), toe);
        }
      }
      R.quad.legs.push({ coxa, femur, tibia, ankle, hx, hz, fx: hx + sx * 0.19, fz: hz + sz * 0.19 });
    }
    quadStep({}, R, 0, 0);
    return;
  }
  R.kind = 'biped'; R.hipY = 0.42;
  const heavy = style === 'armored', exp = style === 'experimental';
  // the leg rig: thigh and shin lengths, ankle-to-sole height, stride and step height (leg units)
  R.rig = { L1: 0.2, L2: 0.2, sole: heavy ? 0.04 : 0.03, hipH: 0.42, stride: heavy ? 0.22 : style === 'assault' ? 0.28 : 0.25, lift: heavy ? 0.05 : 0.07 };
  const k = (id === 'l_biped' ? 1.18 : id === 's_anchor' || id === 'l_quad' ? 1.12 : id === 'l_boost' ? 0.95 : 1) * (heavy ? 1.12 : exp ? 0.92 : 1.05);
  for (const sx of [-1, 1]) {
    const hip = new T.Group(); hip.position.set(sx * (style === 'assault' ? 0.105 : 0.09) * Math.max(1, k * 0.95), 0.42, 0); g.add(hip); R.legs.push(hip);
    if (style === 'assault') hip.rotation.z = sx * 0.07;   // a planted, slightly wide stance
    const as = style === 'assault', kk = k.toFixed(3);
    // large: thigh
    if (exp) mesh(profile('ex-thigh' + kk, 0.08 * k, [[-0.04 * k, 0.02], [0.038 * k, 0.02], ['q', 0.05 * k, -0.09, 0.04 * k, -0.19], [-0.04 * k, -0.19], ['q', -0.05 * k, -0.09, -0.04 * k, 0.02]], 0.01), M(tc.main), hip);
    else if (heavy) mesh(profile('ar-thigh' + kk, 0.1 * k, [[-0.05 * k, 0.02], [0.05 * k, 0.02], [0.062 * k, -0.02], [0.056 * k, -0.18], [0.042 * k, -0.205], [-0.046 * k, -0.205], [-0.062 * k, -0.17], [-0.062 * k, -0.02]], 0.01), M(tc.main), hip);
    else if (as) mesh(profile('as-thigh' + kk, 0.085 * k, [[-0.045 * k, 0.02], [0.04 * k, 0.02], ['q', 0.056 * k, -0.08, 0.046 * k, -0.18], [0.036 * k, -0.205], [-0.04 * k, -0.205], ['q', -0.056 * k, -0.1, -0.045 * k, 0.02]], 0.01), M(tc.main), hip);
    else mesh(wedge(0.085 * k, 0.2, 0.1 * k, heavy ? 1.1 : 1.15, 1.05), M(tc.main), hip, [0, -0.1, 0]);
    // small: hip joint and piston
    if (!ghost) { mesh(cyl(0.035 * k, 0.035 * k, 0.03, 10), toon(tc.dark), hip, [sx * 0.05 * k, -0.01, 0], [0, 0, Math.PI / 2]); mesh(cyl(0.008, 0.008, 0.16, 6), toon(tc.metal), hip, [0, -0.1, -0.055 * k], null, flat); }
    const knee = new T.Group(); knee.position.y = -0.2; hip.add(knee); hip.userData.knee = knee;
    // the ankle joint: the foot hangs from it so IK can keep it flat on the ground or roll it
    const ankle = new T.Group(); ankle.position.y = -0.2; knee.add(ankle); hip.userData.ankle = ankle;
    // medium: knee guard, shaped per army
    if (exp) { mesh(sph(0.036 * k, 12), M(tc.dark), knee); mesh(profile('ex-knee' + kk, 0.07 * k, [[0.02 * k, 0.03], [0.048 * k, 0.024], ['q', 0.066 * k, -0.01, 0.05 * k, -0.05], [0.02 * k, -0.05]], 0.006), M(tc.second), knee); if (!ghost) mesh(sph(0.008, 8), glow(tc.glow), knee, [0, -0.01, 0.062 * k], null, flat); }
    else if (heavy) { mesh(sph(0.04 * k, 12), M(tc.dark), knee); mesh(slab('ar-knee' + kk, 0.04, [[-0.046 * k, 0.045], [0.046 * k, 0.045], [0.058 * k, 0.0], [0.042 * k, -0.055], [-0.042 * k, -0.055], [-0.058 * k, 0.0]], 0.008), M(tc.accent), knee, [0, 0, 0.066 * k]); if (!ghost) rivets(knee, toon(tc.dark), [[0, -0.005, 0.09 * k]]); }
    else if (as) { mesh(sph(0.036 * k, 12), M(tc.dark), knee); mesh(profile('as-knee' + kk, 0.078 * k, [[0.016 * k, 0.04], [0.05 * k, 0.034], ['q', 0.08 * k, 0.0, 0.064 * k, -0.05], [0.034 * k, -0.062], [0.018 * k, -0.02]], 0.008), M(tc.main), knee); }
    else mesh(wedge(0.08 * k, 0.07, 0.05, heavy ? 1 : 0.6, 1, heavy ? 0 : 0.015), M(heavy ? tc.accent : tc.second), knee, [0, 0.0, 0.055 * k]);
    // large: shin, wide at the calf, narrow at the ankle (or a block for heavy armies)
    if (as) {
      // a shin that runs straight down the front and swells into a calf at the back, a slotted front plate,
      // calf vents, and a long wedge foot with a toe cap in the second colour
      mesh(profile('as-shin' + kk, 0.1 * k, [[0.036 * k, -0.01], [0.05 * k, -0.06], [0.046 * k, -0.2], [-0.036 * k, -0.212], ['q', -0.074 * k, -0.13, -0.066 * k, -0.06], ['q', -0.058 * k, -0.005, -0.036 * k, -0.01]], 0.01), M(tc.main), knee);
      mesh(profile('as-shpl' + kk, 0.06 * k, [[0.05 * k, -0.07], [0.058 * k, -0.08], [0.054 * k, -0.17], [0.046 * k, -0.17]], 0.003), M(tc.second), knee);
      if (!ghost) vents(knee, toon(tc.dark), 3, 0.05 * k, 0.022, [0, -0.13, -0.07 * k]);
      mesh(profile('as-foot' + kk, 0.12 * k, [[-0.055 * k, 0.014], [0.035 * k, 0.014], ['q', 0.07 * k, 0.008, 0.12 * k, -0.014], [0.136 * k, -0.03], [-0.066 * k, -0.03], ['q', -0.072 * k, -0.01, -0.055 * k, 0.014]], 0.008), M(tc.main), ankle);
      mesh(profile('as-toe' + kk, 0.124 * k, [[0.084 * k, 0.003], ['q', 0.11 * k, -0.004, 0.128 * k, -0.017], [0.14 * k, -0.031], [0.084 * k, -0.031]], 0.006), M(tc.second), ankle);
    } else if (exp) {
      // the Zaku's bell calf: a turned shin that flares out wide toward the ankle, a band where it starts to flare,
      // and a rounded foot
      mesh(turned('ex-calf' + kk, [[0.0, 0.0], [0.04 * k, 0.0], [0.044 * k, -0.06], [0.058 * k, -0.13], [0.072 * k, -0.18], [0.074 * k, -0.2], [0.0, -0.2]], 32), M(tc.main), knee, [0, 0, -0.008], [-Math.PI / 2, 0, 0]);
      mesh(turned('ex-cband' + kk, [[0.0, -0.06], [0.047 * k, -0.06], [0.05 * k, -0.07], [0.047 * k, -0.08], [0.0, -0.08]], 32), M(tc.second), knee, [0, 0, -0.008], [-Math.PI / 2, 0, 0]);
      mesh(profile('ex-foot' + kk, 0.11 * k, [[-0.06 * k, 0.014], [0.04 * k, 0.014], ['q', 0.11 * k, 0.012, 0.12 * k, -0.03], [-0.07 * k, -0.03], ['q', -0.075 * k, -0.01, -0.06 * k, 0.014]], 0.008), M(tc.dark), ankle);
    } else if (heavy) {
      // a thick shin with a plated front, and a wide foot with a brass toe plate
      mesh(profile('ar-shin' + kk, 0.11 * k, [[0.046 * k, 0.0], [0.062 * k, -0.04], [0.058 * k, -0.19], [0.046 * k, -0.212], [-0.05 * k, -0.212], [-0.064 * k, -0.17], [-0.064 * k, -0.03], [-0.046 * k, 0.0]], 0.01), M(tc.second), knee);
      mesh(profile('ar-shpl' + kk, 0.084 * k, [[0.058 * k, -0.06], [0.072 * k, -0.07], [0.068 * k, -0.17], [0.056 * k, -0.18]], 0.004), M(tc.main), knee);
      if (!ghost) vents(knee, toon(tc.dark), 3, 0.06 * k, 0.022, [0, -0.13, -0.066 * k]);
      mesh(profile('ar-foot' + kk, 0.16 * k, [[-0.07 * k, 0.022], [0.05 * k, 0.022], [0.1 * k, 0.0], [0.13 * k, -0.04], [-0.082 * k, -0.04], [-0.088 * k, -0.01]], 0.01), M(tc.dark), ankle);
      mesh(profile('ar-toe' + kk, 0.166 * k, [[0.078 * k, 0.012], [0.1 * k, 0.002], [0.132 * k, -0.041], [0.078 * k, -0.041]], 0.006), M(tc.accent), ankle);
    } else {
    mesh(wedge(0.1 * k, 0.21, 0.115 * k, heavy ? 0.95 : 1.25, heavy ? 0.95 : 1.2), M(heavy ? tc.second : tc.main), knee, [0, -0.105, 0]);
    // medium: shin plate; small: vents
    mesh(wedge(0.07 * k, 0.12, 0.025, 1.1, 1), M(exp ? tc.second : heavy ? tc.main : tc.second), knee, [0, -0.09, 0.062 * k]);
    if (!ghost) vents(knee, toon(tc.dark), 3, 0.045 * k, 0.022, [0, -0.15, -0.06 * k]);
    // large: foot; small: toe cap and heel spur
    mesh(wedge(heavy ? 0.16 * k : 0.12 * k, heavy ? 0.07 : 0.05, heavy ? 0.24 * k : 0.19 * k, 0.8, 0.8), M(heavy ? tc.dark : tc.accent), ankle, [0, -0.005, 0.025]);
    if (heavy && !ghost) { mesh(cyl(0.058 * k, 0.058 * k, 0.03, 6), M(tc.second), knee, [0, -0.01, 0.07 * k], [Math.PI / 2, Math.PI / 6, 0]); mesh(cyl(0.022 * k, 0.022 * k, 0.034, 12), toon(tc.dark), knee, [0, -0.01, 0.075 * k], [Math.PI / 2, 0, 0], flat); }
    if (!ghost) { mesh(box(0.06 * k, 0.02, 0.03), toon(tc.trim), ankle, [0, -0.01, 0.12 * k], null, flat); mesh(cone(0.015, 0.05, 4), toon(tc.dark), ankle, [0, 0, -0.08 * k], [-Math.PI / 2, 0, 0], flat); }
    }
    if (id === 'l_boost' && !ghost) {
      mesh(wedge(0.05, 0.1, 0.05, 0.7, 0.7), toon(tc.dark), knee, [0, -0.1, -0.075], [0.3, 0, 0]);
      const f = new T.Mesh(cone(0.024, 0.1, 8), glow(tc.thruster, 0.8)); f.position.set(0, -0.17, -0.1); f.rotation.x = -Math.PI / 2 - 0.3; knee.add(f); R.boosters.push(f);
    }
    // reinforced legs: armour skirts on the thighs, big knee pads and clawed feet
    if (id === 'l_biped' && !ghost && !as && !heavy && !exp) {
      mesh(wedge(0.03, 0.17, 0.12 * k, 0.8, 1), M(tc.second), hip, [sx * 0.058 * k, -0.09, 0]);
      mesh(cyl(0.048 * k, 0.048 * k, 0.035, 10), M(heavy ? tc.accent : tc.trim), knee, [0, 0, 0.07 * k], [Math.PI / 2, 0, 0]);
      for (const tx of [-1, 0, 1]) mesh(cone(0.016, 0.06, 4), toon(tc.dark), ankle, [tx * 0.035 * k, -0.015, 0.14 * k], [Math.PI / 2, 0, 0], flat);
    }
    // booster legs: big calf thruster pods and thigh fins
    if (id === 'l_boost' && !ghost) {
      // pods hang off the outside of each calf, so they read from the front
      mesh(cyl(0.04, 0.052, 0.17, 10), toon(tc.dark), knee, [sx * 0.085, -0.1, -0.03], [0.2, 0, 0]);
      mesh(cyl(0.054, 0.054, 0.018, 10), toon(tc.trim), knee, [sx * 0.085, -0.02, -0.015], [0.2, 0, 0], flat);
      mesh(tor(0.04, 0.008), glow(tc.thruster, 0.9), knee, [sx * 0.085, -0.19, -0.05], [Math.PI / 2 + 0.2, 0, 0], flat);
      mesh(wedge(0.018, 0.2, 0.12, 0.3, 1), M(tc.second), hip, [sx * 0.085, -0.06, -0.02], [0.15, 0, sx * 0.45]);
    }
    if (id === 's_anchor') {
      const st = new T.Group(); st.position.set(sx * 0.09, -0.06, -0.02); knee.add(st);
      mesh(box(0.035, 0.2, 0.035), M(tc.trim), st, [0, -0.09, 0]);
      mesh(cone(0.026, 0.07, 6), M(tc.metal), st, [0, -0.215, 0], [Math.PI, 0, 0]);
      R.stakes.push({ g: st, sx });
    }
  }
}

/* ---------- walking: two-bone IK on each leg, driven by a gait cycle ---------- */
// place the ankle of a hip > knee > ankle chain at (ty, tz) from the hip (in the leg's plane); returns the shin angle
function legIK(hip, ty, tz, L1, L2) {
  const d = Math.min(L1 + L2 - 1e-4, Math.max(Math.abs(L1 - L2) + 1e-3, Math.hypot(ty, tz)));
  const phi = Math.atan2(-tz, -ty);                                   // direction from hip to the ankle target
  const a = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
  const k = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2))));
  hip.rotation.x = phi - a;                                           // thigh swings forward of the line ...
  hip.userData.knee.rotation.x = Math.PI - k;                         // ... and the knee bends, shin back
  return hip.rotation.x + hip.userData.knee.rotation.x;
}
const smooth = x => x * x * (3 - 2 * x);
// spider legs: each foot target (leg-group space) is reached by yawing the hip toward it, then a two-bone IK with the knee up
function quadSolve(L, Q, x, y, z) {
  const dx = x - L.hx, dz = z - L.hz;
  L.coxa.rotation.y = Math.atan2(dx, dz);
  const h = Math.hypot(dx, dz), v = y - Q.hy, d = Math.min(Q.LF + Q.LT - 1e-4, Math.max(0.05, Math.hypot(h, v)));
  const t1 = Math.atan2(v, h) + Math.acos(Math.max(-1, Math.min(1, (Q.LF * Q.LF + d * d - Q.LT * Q.LT) / (2 * Q.LF * d))));
  const k = Math.acos(Math.max(-1, Math.min(1, (Q.LF * Q.LF + Q.LT * Q.LT - d * d) / (2 * Q.LF * Q.LT))));
  L.femur.rotation.x = -t1; L.tibia.rotation.x = Math.PI - k;
  if (L.ankle) L.ankle.rotation.x = -(L.femur.rotation.x + L.tibia.rotation.x);
}
// a wave gait: one leg in the air at a time, rippling front-left, front-right, back-right... while the other three
// stay planted and slide back under the body; the hub sways and dips toward the lifted leg
const QUAD_ORDER = [0, 0.5, 0.25, 0.75];
function quadStep(st, R, dt, speed) {
  const Q = R.quad; if (!Q) return null;
  const ws = R.legsG ? R.legsG.getWorldScale(new T.Vector3()).z || 1 : 1, k = R.legsG ? R.legsG.scale.x : 1;
  st.w = (st.w || 0) + ((speed > 0.02 ? 1 : 0) - (st.w || 0)) * Math.min(1, dt * 4);
  st.phase = ((st.phase || 0) + Math.min(0.55, (speed / ws) * 0.75 / Q.stride) * dt) % 1;
  const w = st.w, legDig = st.digLegs || [0, 1, 2, 3].map(() => st.dig || 0);
  const planted = legDig.map(e => smooth(Math.max(0, Math.min(1, (e - 0.6) / 0.4))));
  const drop = (st.crouch || 0) + 0.17 * planted.reduce((a, b) => a + b, 0) / 4;
  // the hub: before each leg lifts it slides over the other three and sinks a little onto them, then eases back
  let shx = 0, shz = 0, load = 0;
  Q.legs.forEach((L, i) => {
    const p = (st.phase + QUAD_ORDER[i]) % 1, f = p > 0.6 ? Math.sin(Math.PI * (p - 0.6) / 0.4) : 0;
    shx -= Math.sign(L.hx) * f; shz -= Math.sign(L.hz) * f; load += f;
  });
  shx *= 0.05 * w; shz *= 0.05 * w;
  const hubY = -0.012 * w * load - drop;
  Q.legs.forEach((L, i) => {
    const p = (st.phase + QUAD_ORDER[i]) % 1;
    let z, y;
    if (p < 0.75) { z = Q.stride * (0.5 - p / 0.75); y = 0; }
    else { const s2 = (p - 0.75) / 0.25; z = Q.stride * (-0.5 + smooth(s2)); y = Q.lift * Math.sin(Math.PI * Math.min(1, Math.pow(s2, 0.6))); }
    // digging in: the leg lifts and swings out to its wide stance, then stamps down and drives a little into the ground
    const e = legDig[i], lift = e > 0 && e < 0.6 ? Math.sin(Math.PI * e / 0.6) * 0.13 : 0, splay = 1 + 0.55 * smooth(Math.min(1, e / 0.6)), sink = 0.035 * planted[i];
    // feet are offset against the hub's motion so they stay planted on the ground
    quadSolve(L, Q, L.hx + (L.fx - L.hx) * splay - shx, Q.sole + y * w + lift - sink - hubY, L.hz + (L.fz - L.hz) * splay + z * w - shz);
  });
  // the upper body is fixed to the hub at the waist; only its lean follows the weight shift, on a slow soft spring
  // that lags, overshoots and settles, pivoting at the waist joint
  const sp = st.sp || (st.sp = { x: [0, 0], z: [0, 0] }), h = Math.min(0.05, dt), om = 4.2, ze = 0.32;
  for (const [c, tgt] of [['x', shx], ['z', shz]]) { const a = sp[c]; a[1] += (om * om * (tgt - a[0]) - 2 * ze * om * a[1]) * h; a[0] += a[1] * h; }
  return {
    hubX: shx * k, hubY: hubY * k, hubZ: shz * k,
    bodyX: shx * k, bodyZ: shz * k, bob: (hubY + (st.crouch || 0)) * k,
    // the body tips toward where its weight is going, and the lag swings it a little further
    roll: -sp.x[0] * 1.6 - sp.x[1] * 0.25, pitch: sp.z[0] * 1.3 + sp.z[1] * 0.2,
    yaw: 0.03 * w * Math.sin(st.phase * Math.PI * 2),
  };
}


// one step of the gait. st keeps the phase and blend between frames; speed is the body's ground speed (world units/s).
// Each leg: 60% stance with the foot planted (sliding back under the hips at exactly the body's speed), heel strike
// and toe-off; 40% swing, lifting and arcing forward. The pelvis dips at "down" and rises at "passing", twice a cycle.
function gaitStep(st, R, dt, speed) {
  const rg = R.rig; if (!rg || !R.legsG) return null;
  const ws = R.legsG.getWorldScale(new T.Vector3()).z || 1;
  const vLocal = speed / ws;
  st.w = (st.w || 0) + ((speed > 0.02 ? 1 : 0) - (st.w || 0)) * Math.min(1, dt * 7);
  st.phase = ((st.phase || 0) + Math.min(2.2, vLocal * 0.6 / rg.stride) * dt) % 1;
  const w = st.w, ph = st.phase, out = { swing: [0, 0], bob: 0 };
  // knees soft at rest and bent while walking: the pelvis drops so the feet can reach a full stride
  const drop = 0.015 + 0.04 * w + (st.crouch || 0);
  R.legs.forEach((hip, i) => {
    const p = (ph + (i ? 0.5 : 0)) % 1;
    let z, y, pitch;
    if (p < 0.6) {                                                    // stance: planted, rolling heel to toe
      const s2 = p / 0.6;
      z = rg.stride * (0.5 - s2); y = 0;
      pitch = s2 < 0.12 ? -0.3 * (1 - s2 / 0.12) : s2 > 0.82 ? 0.45 * (s2 - 0.82) / 0.18 : 0;
    } else {                                                          // swing: lift, arc forward, reach for the heel strike
      const s2 = (p - 0.6) / 0.4;
      z = rg.stride * (-0.5 + smooth(s2)); y = rg.lift * Math.sin(Math.PI * s2);
      pitch = 0.45 * (1 - s2) - 0.3 * smooth(s2);
    }
    z *= w; y *= w; pitch *= w;
    const hipY = rg.hipH - drop + (st.bob || 0);
    const shin = legIK(hip, (rg.sole + y) - hipY, z, rg.L1, rg.L2);
    if (hip.userData.ankle) hip.userData.ankle.rotation.x = -shin + pitch;
    out.swing[i] = z / rg.stride;                                     // -0.5 (back) .. 0.5 (forward)
  });
  // pelvis: lowest just after each heel strike (down), highest at passing (up)
  st.bob = -0.012 * w * Math.cos(4 * Math.PI * (ph - 0.1));
  R.legs.forEach(hip => { hip.position.y = rg.hipH - drop + st.bob; });
  out.bob = (st.bob - drop) * R.legsG.scale.y;
  out.roll = Math.sin(2 * Math.PI * ph) * 0.03 * w;
  out.twist = Math.sin(2 * Math.PI * ph) * 0.09 * w;
  return out;
}

// the weapon kit's own paint, shared by every army: a dark body, grey barrels, orange caps and a red sight
const KIT = { body: 0x2c2f34, grey: 0x7d8288, light: 0xa7acb1, orange: 0xd9892e, red: 0xb63a30 };
// weapons a mech carries in its hand; the rest are built onto the forearm or the shoulder
const HANDHELD = new Set(['b_gun', 'w_smg', 'w_scatter', 'w_gatling', 'w_rail', 'w_laser', 'w_lance', 's_inferno', 's_cryo', 'w_blade']);
function buildWeapon(p, id, tc, sx) {
  const D = toon(tc.metal), D2 = toon(tc.dark), mu = new T.Object3D();
  let z = 0.22, y = 0;
  // small, shared: a sight block on top of most guns
  const sight = (zz, yy) => mesh(box(0.016, 0.018, 0.04), toon(tc.trim), p, [0, yy, zz], null, flat);
  switch (id) {
    case 'b_gun': {
      // the receiver: a long body that steps down at the front into the handguard
      mesh(profile('ac-rcv', 0.05, [[-0.08, 0.026], [0.07, 0.026], ['q', 0.1, 0.026, 0.1, 0.006], [0.1, -0.026], [-0.06, -0.026], ['q', -0.08, -0.026, -0.08, -0.006]]), toon(KIT.body), p);
      // the top rail and a hooded sight
      mesh(profile('ac-rail', 0.034, [[-0.06, 0.026], [0.06, 0.026], [0.064, 0.04], [-0.056, 0.04]]), toon(KIT.grey), p);
      for (let i = 0; i < 6; i++) mesh(box(0.036, 0.004, 0.006), toon(INK), p, [0, 0.042, -0.045 + i * 0.019], null, flat);
      mesh(profile('ac-sight', 0.024, [[-0.01, 0.04], [0.03, 0.04], ['q', 0.034, 0.064, 0.012, 0.064], [-0.006, 0.062]]), toon(KIT.light), p);
      mesh(cyl(0.007, 0.007, 0.006, 12), glow(tc.eye), p, [0, 0.054, 0.034], [Math.PI / 2, 0, 0], flat);
      // the stock: a swept skeleton stock with a butt pad
      mesh(profile('ac-stock', 0.04, [[-0.08, 0.022], ['q', -0.14, 0.024, -0.19, 0.016], [-0.205, -0.034], ['q', -0.17, -0.044, -0.15, -0.024], ['q', -0.115, -0.006, -0.08, -0.02]]), toon(KIT.body), p);
      mesh(profile('ac-pad', 0.042, [[-0.19, 0.018], [-0.205, 0.016], [-0.218, -0.034], [-0.205, -0.036]]), toon(KIT.orange), p);
      // the pistol grip, raked back
      mesh(profile('ac-grip', 0.028, [[-0.05, -0.026], [-0.018, -0.026], ['q', -0.022, -0.06, -0.04, -0.1], [-0.07, -0.098], ['q', -0.054, -0.06, -0.05, -0.026]]), toon(KIT.body), p);
      // the banana magazine, one smooth curve
      mesh(profile('ac-mag', 0.026, [[0.0, -0.026], [0.038, -0.026], ['c', 0.044, -0.07, 0.062, -0.104, 0.092, -0.128], [0.064, -0.146], ['c', 0.038, -0.122, 0.016, -0.084, 0.0, -0.026]]), toon(KIT.grey), p);
      mesh(profile('ac-magb', 0.028, [[0.066, -0.118], [0.09, -0.13], [0.078, -0.144], [0.06, -0.138]]), toon(KIT.orange), p);
      // the handguard, vented, then the turned barrel with a gas tube over it and a flared, ported brake
      mesh(profile('ac-hg', 0.042, [[0.1, 0.02], [0.2, 0.016], ['q', 0.214, 0.0, 0.2, -0.016], [0.1, -0.02]]), toon(KIT.grey), p);
      for (const zz of [0.12, 0.14, 0.16, 0.18]) mesh(box(0.044, 0.005, 0.009), toon(INK), p, [0, 0.0, zz], null, flat);
      mesh(turned('ac-brl', [[0.0, 0.2], [0.012, 0.2], [0.012, 0.29], [0.0145, 0.295], [0.0145, 0.31], [0.011, 0.315], [0.011, 0.4], [0.0, 0.4]]), D2, p);
      mesh(turned('ac-gas', [[0.0, 0.2], [0.0062, 0.2], [0.0062, 0.33], [0.0, 0.335]]), toon(KIT.grey), p, [0, 0.021, 0]);
      mesh(box(0.016, 0.022, 0.01), toon(KIT.body), p, [0, 0.011, 0.33], null, flat);
      mesh(turned('ac-brk', [[0.0, 0.395], [0.016, 0.395], [0.019, 0.41], [0.019, 0.44], [0.016, 0.45], [0.0, 0.45]]), toon(KIT.body), p);
      for (const x of [-1, 1]) for (const zz of [0.415, 0.432]) mesh(box(0.006, 0.02, 0.009), toon(INK), p, [x * 0.0185, 0, zz], null, flat);
      mesh(turned('ac-ring', [[0.0, 0.448], [0.017, 0.448], [0.017, 0.456], [0.0, 0.456]]), toon(KIT.orange), p);
      z = 0.46; y = 0; break;
    }
    case 'w_smg': {
      mesh(profile('sm-brk', 0.11, [[-0.03, 0.026], [0.06, 0.026], ['q', 0.07, 0.026, 0.07, 0.034], [0.06, 0.04], [-0.03, 0.04]], 0.003), toon(KIT.grey), p);
      for (const x of [-0.034, 0.034]) {
        mesh(profile('sm-rcv', 0.034, [[-0.05, 0.026], [0.07, 0.026], ['q', 0.09, 0.026, 0.09, 0.008], [0.09, -0.018], [-0.03, -0.022], ['q', -0.05, -0.022, -0.05, 0.0]]), toon(KIT.body), p, [x, 0, 0]);
        mesh(profile('sm-jkt', 0.03, [[0.09, 0.016], [0.15, 0.014], ['q', 0.158, 0.006, 0.15, -0.006], [0.09, -0.01]]), toon(KIT.light), p, [x, 0, 0]);
        for (const zz of [0.105, 0.12, 0.135]) mesh(box(0.032, 0.005, 0.007), toon(INK), p, [x, 0.012, zz], null, flat);
        mesh(turned('sm-brl', [[0.0, 0.15], [0.009, 0.15], [0.009, 0.18], [0.012, 0.183], [0.012, 0.195], [0.0, 0.195]]), D2, p, [x, 0.004, 0]);
        mesh(turned('sm-mz', [[0.0, 0.19], [0.0125, 0.19], [0.0125, 0.198], [0.0, 0.198]]), toon(KIT.orange), p, [x, 0.004, 0]);
        mesh(profile('sm-grip', 0.024, [[-0.03, -0.02], [-0.006, -0.02], ['q', -0.01, -0.05, -0.022, -0.075], [-0.044, -0.073], ['q', -0.034, -0.05, -0.03, -0.02]]), D2, p, [x, 0, 0]);
        mesh(profile('sm-mag', 0.02, [[0.02, -0.018], [0.042, -0.018], ['q', 0.05, -0.06, 0.07, -0.088], [0.05, -0.098], ['q', 0.032, -0.064, 0.02, -0.018]]), toon(KIT.grey), p, [x, 0, 0]);
        mesh(box(0.022, 0.008, 0.024), toon(KIT.orange), p, [x, -0.092, 0.06], [0.6, 0, 0], flat);
      }
      z = 0.2; y = 0.004; break;
    }
    case 'w_scatter': {
      mesh(profile('sc-rcv', 0.074, [[-0.08, 0.0], ['q', -0.08, 0.04, -0.05, 0.04], [0.07, 0.04], [0.08, 0.02], [0.08, -0.03], [-0.04, -0.034], ['q', -0.08, -0.034, -0.08, 0.0]]), toon(KIT.body), p);
      mesh(profile('sc-top', 0.078, [[-0.05, 0.04], [0.06, 0.04], [0.054, 0.054], [-0.044, 0.054]], 0.004), toon(KIT.grey), p);
      mesh(profile('sc-grip', 0.03, [[-0.06, -0.03], [-0.03, -0.032], ['q', -0.034, -0.065, -0.05, -0.1], [-0.08, -0.098], ['q', -0.064, -0.065, -0.06, -0.03]]), toon(KIT.body), p);
      mesh(turned('sc-brl', [[0.0, 0.07], [0.03, 0.07], [0.03, 0.22], [0.0, 0.22]]), D2, p, [0, 0.012, 0]);
      mesh(profile('sc-shield', 0.072, [[0.07, 0.03], [0.22, 0.028], ['q', 0.232, 0.028, 0.232, 0.04], [0.22, 0.056], [0.07, 0.058]]), toon(KIT.light), p);
      for (const zz of [0.1, 0.13, 0.16, 0.19]) mesh(box(0.074, 0.006, 0.012), toon(INK), p, [0, 0.057, zz], null, flat);
      mesh(turned('sc-tubemag', [[0.0, 0.06], [0.016, 0.06], [0.016, 0.21], [0.012, 0.218], [0.0, 0.218]]), toon(KIT.grey), p, [0, -0.03, 0]);
      mesh(profile('sc-pump', 0.05, [[0.12, -0.016], [0.2, -0.016], ['q', 0.21, -0.03, 0.2, -0.05], [0.12, -0.05], ['q', 0.11, -0.03, 0.12, -0.016]]), toon(KIT.body), p);
      for (const zz of [0.135, 0.15, 0.165, 0.18]) mesh(box(0.052, 0.034, 0.004), toon(INK), p, [0, -0.033, zz], null, flat);
      mesh(box(0.052, 0.008, 0.08), toon(KIT.orange), p, [0, -0.05, 0.16], null, flat);
      mesh(turned('sc-mz', [[0.0, 0.215], [0.033, 0.215], [0.048, 0.25], [0.05, 0.262], [0.036, 0.262], [0.03, 0.24], [0.0, 0.24]]), toon(KIT.body), p, [0, 0.012, 0]);
      mesh(turned('sc-mzr', [[0.0, 0.258], [0.051, 0.258], [0.051, 0.266], [0.0, 0.266]]), toon(KIT.orange), p, [0, 0.012, 0]);
      z = 0.27; y = 0.012; break;
    }
    case 'w_gatling': {
      mesh(profile('gt-body', 0.1, [[-0.06, 0.0], ['q', -0.06, 0.05, -0.02, 0.05], [0.07, 0.05], ['q', 0.09, 0.05, 0.09, 0.03], [0.09, -0.03], ['q', 0.09, -0.05, 0.07, -0.05], [-0.02, -0.05], ['q', -0.06, -0.05, -0.06, 0.0]]), toon(KIT.body), p);
      for (const zz of [-0.02, 0.0, 0.02, 0.04]) mesh(box(0.104, 0.005, 0.01), toon(INK), p, [0, 0.03, zz], null, flat);
      mesh(box(0.104, 0.014, 0.04), toon(KIT.orange), p, [0, -0.036, -0.03], null, flat);
      // the ammo drum on the outside, and the belt chute curving up into the housing
      mesh(turned('gt-drum', [[0.0, -0.035], [0.05, -0.035], [0.055, -0.025], [0.055, 0.025], [0.05, 0.035], [0.0, 0.035]]), toon(KIT.grey), p, [0.09, -0.02, -0.01], [0, Math.PI / 2, 0]);
      mesh(turned('gt-hub', [[0.0, -0.038], [0.02, -0.038], [0.02, 0.038], [0.0, 0.038]]), toon(KIT.body), p, [0.09, -0.02, -0.01], [0, Math.PI / 2, 0]);
      mesh(tube('gt-chute', [[0.08, 0.02, 0.02], [0.075, 0.05, 0.05], [0.05, 0.055, 0.08], [0.03, 0.04, 0.09]], 0.012, 24), toon(KIT.light), p);
      // the heat shroud: a curved hood over the barrels, slotted on top
      mesh(profile('gt-shroud', 0.084, [[0.09, 0.048], [0.27, 0.042], ['q', 0.29, 0.042, 0.29, 0.032], [0.29, 0.028], [0.09, 0.034]]), toon(KIT.grey), p);
      for (const zz of [0.13, 0.17, 0.21, 0.25]) mesh(box(0.086, 0.005, 0.012), toon(INK), p, [0, 0.046, zz], null, flat);
      const cl = new T.Group(); cl.position.z = 0.17; p.add(cl); p.userData.spin = cl;
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; mesh(turned('gt-brl', [[0.0, -0.08], [0.011, -0.08], [0.011, 0.12], [0.014, 0.125], [0.014, 0.14], [0.009, 0.14], [0.0, 0.135]]), D2, cl, [Math.cos(a) * 0.028, Math.sin(a) * 0.028, 0], null, { noOutline: true }); }
      mesh(turned('gt-axle', [[0.0, -0.08], [0.013, -0.08], [0.013, 0.13], [0.0, 0.13]]), toon(KIT.body), cl, [0, 0, 0], null, flat);
      for (const zz of [-0.05, 0.03, 0.11]) mesh(turned('gt-clamp', [[0.0, -0.008], [0.042, -0.008], [0.046, 0.0], [0.042, 0.008], [0.0, 0.008]], 6), toon(KIT.light), cl, [0, 0, zz], null, flat);
      z = 0.31; break;
    }
    case 'w_rail': {
      // the receiver: a humped, finned housing that runs back into a capacitor pack
      mesh(profile('rc-rcv', 0.056, [[-0.17, 0.0], ['q', -0.17, 0.04, -0.12, 0.042], [0.02, 0.042], ['q', 0.06, 0.042, 0.08, 0.02], [0.08, -0.03], [-0.05, -0.034], ['q', -0.17, -0.036, -0.17, 0.0]]), toon(KIT.body), p);
      for (let i = 0; i < 6; i++) mesh(profile('rc-fin', 0.06, [[0, 0], [0.012, 0], [0.016, 0.012], [0.004, 0.012]], 0.002), toon(KIT.grey), p, [0, 0.04, -0.1 + i * 0.024]);
      for (const zz of [-0.155, -0.14, -0.125]) mesh(box(0.058, 0.03, 0.005), glow(FX_COL.energy), p, [0, 0.0, zz], null, flat);
      mesh(profile('rc-grip', 0.028, [[-0.04, -0.03], [-0.012, -0.03], ['q', -0.016, -0.06, -0.03, -0.092], [-0.058, -0.09], ['q', -0.044, -0.06, -0.04, -0.03]]), toon(KIT.body), p);
      mesh(box(0.058, 0.01, 0.03), toon(KIT.orange), p, [0, -0.026, 0.05], null, flat);
      // the scope: a turned tube with a flared objective, on a riser
      mesh(turned('rc-scope', [[0.0, -0.07], [0.012, -0.07], [0.012, 0.02], [0.016, 0.04], [0.016, 0.07], [0.0, 0.07]]), toon(KIT.light), p, [0, 0.074, 0]);
      mesh(profile('rc-riser', 0.016, [[-0.02, 0.042], [0.02, 0.042], [0.012, 0.064], [-0.012, 0.064]], 0.002), toon(KIT.body), p);
      mesh(cyl(0.012, 0.012, 0.004, 12), glow(tc.eye), p, [0, 0.074, 0.071], [Math.PI / 2, 0, 0], flat);
      // the rail barrel: a long tapering upper rail and a slimmer lower rail, the charge line glowing between
      mesh(profile('rc-up', 0.026, [[0.08, 0.026], [0.54, 0.02], ['q', 0.56, 0.02, 0.56, 0.008], [0.56, 0.0], [0.08, 0.002]]), D2, p);
      mesh(profile('rc-lo', 0.02, [[0.08, -0.012], [0.53, -0.012], ['q', 0.55, -0.012, 0.55, -0.02], [0.55, -0.028], [0.08, -0.03]]), toon(KIT.grey), p);
      mesh(box(0.006, 0.01, 0.46), glow(FX_COL.energy), p, [0, -0.006, 0.31], null, flat);
      for (const zz of [0.17, 0.31, 0.45]) mesh(profile('rc-band', 0.036, [[-0.007, 0.032], [0.007, 0.032], [0.009, -0.036], [-0.009, -0.036]], 0.003), toon(KIT.body), p, [0, 0, zz]);
      mesh(box(0.03, 0.01, 0.03), toon(KIT.orange), p, [0, 0.026, 0.545], null, flat);
      z = 0.57; y = 0.0; break;
    }
    case 'w_laser': {
      mesh(profile('lr-body', 0.054, [[-0.08, 0.03], [0.1, 0.034], ['q', 0.13, 0.034, 0.14, 0.014], [0.14, -0.01], [0.04, -0.022], ['q', 0.0, -0.03, -0.04, -0.03], [-0.08, -0.02]]), toon(KIT.body), p);
      mesh(profile('lr-top', 0.058, [[-0.06, 0.03], [0.09, 0.034], [0.1, 0.048], [-0.04, 0.046]]), toon(KIT.light), p);
      mesh(profile('lr-grip', 0.028, [[-0.03, -0.028], [0.0, -0.03], ['q', -0.004, -0.06, -0.02, -0.095], [-0.048, -0.092], ['q', -0.034, -0.06, -0.03, -0.028]]), D2, p);
      // the energy cap, a capsule at the rear with its charge window
      mesh(turned('lr-cap', [[0.0, -0.17], [0.018, -0.165], [0.026, -0.15], [0.026, -0.095], [0.018, -0.08], [0.0, -0.075]]), toon(KIT.grey), p, [0, 0.0, 0]);
      mesh(box(0.012, 0.024, 0.05), glow(FX_COL.energy), p, [0.024, 0.0, -0.122], null, flat);
      mesh(box(0.056, 0.012, 0.016), toon(KIT.orange), p, [0, -0.022, -0.075], null, flat);
      // the sensor scope, offset to the side
      mesh(turned('lr-scope', [[0.0, -0.03], [0.014, -0.03], [0.016, 0.0], [0.016, 0.05], [0.019, 0.06], [0.0, 0.062]]), toon(KIT.light), p, [-0.038, 0.058, 0]);
      mesh(cyl(0.015, 0.015, 0.004, 12), glow(tc.eye), p, [-0.038, 0.058, 0.064], [Math.PI / 2, 0, 0], flat);
      // the barrel: collimator rings, then a flared emitter
      mesh(turned('lr-brl', [[0.0, 0.13], [0.016, 0.13], [0.016, 0.33], [0.0, 0.33]]), D2, p, [0, 0.008, 0]);
      for (const zz of [0.18, 0.215, 0.25, 0.285]) mesh(turned('lr-ring', [[0.0, -0.004], [0.024, -0.004], [0.026, 0.0], [0.024, 0.004], [0.0, 0.004]]), toon(KIT.grey), p, [0, 0.008, zz], null, flat);
      mesh(turned('lr-emit', [[0.0, 0.32], [0.017, 0.32], [0.026, 0.345], [0.026, 0.36], [0.012, 0.36], [0.0, 0.35]]), toon(KIT.orange), p, [0, 0.008, 0]);
      mesh(cyl(0.011, 0.011, 0.006, 12), glow(FX_COL.energy), p, [0, 0.008, 0.358], [Math.PI / 2, 0, 0], flat);
      z = 0.37; y = 0.008; break;
    }
    case 'w_lance': {
      mesh(profile('pl-house', 0.07, [[-0.09, 0.0], ['q', -0.09, 0.036, -0.05, 0.036], [0.06, 0.03], ['q', 0.09, 0.028, 0.09, 0.0], ['q', 0.09, -0.028, 0.06, -0.03], [-0.05, -0.036], ['q', -0.09, -0.036, -0.09, 0.0]]), toon(KIT.body), p);
      for (const x of [-1, 1]) {
        mesh(turned('pl-cap', [[0.0, -0.07], [0.014, -0.07], [0.02, -0.06], [0.02, 0.04], [0.014, 0.05], [0.0, 0.05]]), toon(KIT.grey), p, [x * 0.046, -0.01, 0]);
        mesh(box(0.006, 0.026, 0.08), glow(0xc8a0ff), p, [x * 0.066, -0.01, -0.01], null, flat);
      }
      mesh(turned('pl-noz', [[0.0, -0.13], [0.03, -0.13], [0.022, -0.1], [0.018, -0.085], [0.0, -0.085]]), toon(INK), p);
      mesh(box(0.074, 0.012, 0.04), toon(KIT.orange), p, [0, 0.036, -0.03], null, flat);
      mesh(turned('pl-lance', [[0.0, 0.08], [0.028, 0.08], [0.026, 0.2], [0.02, 0.36], [0.014, 0.5], [0.0, 0.5]]), toon(KIT.grey), p);
      for (const zz of [0.15, 0.26, 0.37]) {
        mesh(turned('pl-ring' + zz, [[0.0, -0.012], [0.04 - zz * 0.03, -0.012], [0.044 - zz * 0.03, 0.0], [0.04 - zz * 0.03, 0.012], [0.0, 0.012]]), toon(KIT.body), p, [0, 0, zz], null, flat);
        mesh(tor(0.036 - zz * 0.03, 0.006), glow(0xc8a0ff), p, [0, 0, zz + 0.014], null, flat);
      }
      mesh(turned('pl-tip', [[0.0, 0.49], [0.016, 0.49], [0.0, 0.55]]), toon(KIT.orange), p);
      mesh(sph(0.012, 10), glow(0xe8d0ff), p, [0, 0, 0.555], null, flat);
      z = 0.56; break;
    }
    case 'w_arc': {
      mesh(profile('ar-house', 0.07, [[-0.05, 0.0], ['q', -0.05, 0.034, -0.02, 0.034], [0.05, 0.032], ['q', 0.07, 0.03, 0.07, 0.0], ['q', 0.07, -0.03, 0.05, -0.032], [-0.02, -0.034], ['q', -0.05, -0.034, -0.05, 0.0]]), toon(KIT.body), p);
      mesh(box(0.05, 0.02, 0.06), glow(0xcfe8ff, 0.9), p, [0, 0.03, 0.01], null, flat);
      for (const x of [-1, 1]) vents(p, toon(INK), 3, 0.04, 0.016, [x * 0.036, 0, -0.005], [0, Math.PI / 2, 0]);
      mesh(turned('ar-ins', [[0.0, 0.07], [0.03, 0.07], [0.033, 0.076], [0.022, 0.082], [0.03, 0.088], [0.033, 0.094], [0.022, 0.1], [0.03, 0.106], [0.033, 0.112], [0.022, 0.118], [0.0, 0.118]]), toon(0xe8ecf0), p);
      mesh(turned('ar-core', [[0.0, 0.11], [0.012, 0.11], [0.012, 0.19], [0.006, 0.2], [0.0, 0.2]]), D2, p);
      for (const yy of [-1, 1]) {
        mesh(tube('ar-prong' + yy, [[0, yy * 0.012, 0.12], [0, yy * 0.03, 0.16], [0, yy * 0.036, 0.2], [0, yy * 0.026, 0.235]], 0.006, 24), toon(KIT.grey), p);
        mesh(sph(0.013, 10), glow(0xcfe8ff), p, [0, yy * 0.026, 0.238], null, flat);
      }
      mesh(box(0.072, 0.012, 0.03), toon(KIT.orange), p, [0, -0.032, -0.025], null, flat);
      z = 0.24; break;
    }
    case 'w_blade': {
      mesh(profile('bl-house', 0.046, [[-0.06, 0.0], ['q', -0.06, 0.026, -0.03, 0.028], [0.0, 0.024], ['q', 0.02, 0.02, 0.02, 0.0], ['q', 0.02, -0.02, 0.0, -0.024], [-0.03, -0.028], ['q', -0.06, -0.026, -0.06, 0.0]]), toon(KIT.body), p);
      mesh(box(0.006, 0.016, 0.05), glow(FX_COL.melee), p, [0.023, 0, -0.02], null, flat);
      mesh(turned('bl-hilt', [[0.0, 0.0], [0.014, 0.0], [0.015, 0.006], [0.015, 0.1], [0.0, 0.1]]), toon(KIT.light), p);
      for (const zz of [0.03, 0.045, 0.06, 0.075]) mesh(turned('bl-groove', [[0.0, -0.002], [0.0155, -0.002], [0.0155, 0.002], [0.0, 0.002]], 24), toon(INK), p, [0, 0, zz], null, flat);
      mesh(turned('bl-emit', [[0.0, 0.098], [0.016, 0.098], [0.019, 0.112], [0.019, 0.12], [0.0, 0.12]]), toon(KIT.grey), p);
      mesh(turned('bl-band', [[0.0, 0.01], [0.0158, 0.01], [0.0158, 0.02], [0.0, 0.02]], 24), toon(KIT.orange), p, null, null, flat);
      mesh(turned('bl-core', [[0.0, 0.118], [0.004, 0.13], [0.006, 0.32], [0.004, 0.5], [0.0, 0.56]], 16), glow(0xfff6fb, 0.95), p, null, null, flat);
      mesh(turned('bl-mid', [[0.0, 0.116], [0.009, 0.13], [0.012, 0.32], [0.008, 0.5], [0.0, 0.57]], 20), glow(FX_COL.melee, 0.75), p, null, null, flat);
      mesh(turned('bl-out', [[0.0, 0.114], [0.016, 0.13], [0.021, 0.32], [0.014, 0.5], [0.0, 0.58]], 24), glow(FX_COL.melee, 0.28), p, null, null, flat);
      z = 0.56; break;
    }
    case 'w_ram': {
      mesh(profile('rm-house', 0.1, [[-0.06, 0.0], ['q', -0.06, 0.046, -0.02, 0.046], [0.03, 0.044], ['q', 0.05, 0.042, 0.05, 0.0], ['q', 0.05, -0.042, 0.03, -0.044], [-0.02, -0.046], ['q', -0.06, -0.046, -0.06, 0.0]]), toon(KIT.body), p);
      for (const x of [-1, 1]) vents(p, toon(INK), 3, 0.06, 0.02, [x * 0.051, 0, -0.01], [0, Math.PI / 2, 0]);
      mesh(box(0.104, 0.014, 0.05), toon(KIT.orange), p, [0, 0.046, -0.02], null, flat);
      for (const x of [-1, 1]) {
        mesh(turned('rm-pist', [[0.0, 0.02], [0.013, 0.02], [0.013, 0.08], [0.0, 0.08]], 20), toon(KIT.light), p, [x * 0.034, 0.03, 0]);
        mesh(turned('rm-rod', [[0.0, 0.08], [0.008, 0.08], [0.008, 0.12], [0.0, 0.12]], 16), toon(INK), p, [x * 0.034, 0.03, 0]);
      }
      mesh(turned('rm-collar', [[0.0, 0.04], [0.05, 0.04], [0.064, 0.052], [0.064, 0.072], [0.058, 0.082], [0.0, 0.082]]), toon(KIT.grey), p);
      mesh(turned('rm-ring', [[0.0, -0.004], [0.0655, -0.004], [0.0655, 0.004], [0.0, 0.004]], 32), toon(KIT.orange), p, [0, 0, 0.062], null, flat);
      const dr = new T.Group(); dr.position.z = 0.08; p.add(dr); p.userData.spin = dr;
      mesh(turned('rm-bit', [[0.0, 0.0], [0.054, 0.0], [0.052, 0.03], [0.04, 0.1], [0.024, 0.18], [0.008, 0.24], [0.0, 0.255]], 36), toon(0x9aa0a8), dr);
      for (const ph of [0, 2.094, 4.189]) {
        const pts = [];
        for (let i = 0; i <= 36; i++) { const k = i / 36, zz = 0.012 + k * 0.226, r = 0.054 - k * 0.05, a = ph + k * Math.PI * 5; pts.push([Math.cos(a) * r, Math.sin(a) * r, zz]); }
        mesh(tube('rm-flute' + ph, pts, 0.008 - 0.004 * 0, 140), toon(KIT.body), dr);
      }
      z = 0.34; break;
    }
    case 'w_shield': {
      const sp = new T.Group(); sp.position.set(sx * 0.07, -0.02, -0.03); p.add(sp);
      const flip = [0, sx < 0 ? Math.PI : 0, 0];
      const outline = (k) => [[-0.07 * k, 0.17 * k], [0.07 * k, 0.17 * k], [0.1 * k, 0.13 * k], [0.1 * k, -0.1 * k], [0.0, -0.19 * k], [-0.1 * k, -0.1 * k], [-0.1 * k, 0.13 * k]];
      mesh(bend('sh-plate', profile('sh-plate', 0.024, outline(1), 0.006), 2.4), toon(tc.main), sp, null, flip);
      mesh(bend('sh-rim', profile('sh-rim', 0.024, outline(1.07), 0.005), 2.4), toon(KIT.light), sp, [-sx * 0.006, 0, 0], flip);
      mesh(bend('sh-cap', profile('sh-cap', 0.03, [[-0.07, 0.17], [0.07, 0.17], [0.1, 0.13], [0.1, 0.1], [-0.1, 0.1], [-0.1, 0.13]], 0.005), 2.4), toon(KIT.light), sp, [sx * 0.002, 0, 0], flip);
      mesh(box(0.008, 0.02, 0.05), glow(FX_COL.energy), sp, [sx * 0.018, 0.135, 0.0], null, flat);
      mesh(bend('sh-star', profile('sh-star', 0.008, [[0.0, 0.07], [0.012, 0.022], [0.06, 0.01], [0.012, -0.002], [0.0, -0.12], [-0.012, -0.002], [-0.06, 0.01], [-0.012, 0.022]], 0.002), 2.4), toon(KIT.orange), sp, [sx * 0.014, 0.0, 0], flip, flat);
      mesh(box(0.03, 0.06, 0.05), toon(tc.dark), sp, [-sx * 0.024, 0.0, 0.0]);
      rivets(sp, toon(tc.dark), [[sx * 0.014, 0.08, 0.07], [sx * 0.014, 0.08, -0.07], [sx * 0.006, -0.09, 0.075], [sx * 0.006, -0.09, -0.075]]);
      z = 0.05; break;
    }
    case 'w_repair': {
      mesh(profile('rp-body', 0.06, [[-0.03, 0.0], ['q', -0.03, 0.028, 0.0, 0.028], [0.07, 0.026], ['q', 0.09, 0.024, 0.09, 0.0], ['q', 0.09, -0.024, 0.07, -0.026], [0.0, -0.028], ['q', -0.03, -0.028, -0.03, 0.0]]), toon(KIT.body), p);
      for (const x of [-1, 1]) vents(p, toon(INK), 3, 0.06, 0.016, [x * 0.031, 0, 0.03], [0, Math.PI / 2, 0]);
      mesh(box(0.062, 0.012, 0.05), toon(KIT.orange), p, [0, 0.028, 0.0], null, flat);
      mesh(turned('rp-collar', [[0.0, 0.084], [0.02, 0.084], [0.022, 0.092], [0.016, 0.1], [0.0, 0.1]]), toon(KIT.grey), p, [0, 0.01, 0]);
      mesh(tube('rp-neck', [[0, 0.01, 0.095], [0, 0.03, 0.12], [0, 0.04, 0.16], [0, 0.03, 0.19]], 0.008, 32), toon(KIT.grey), p);
      mesh(turned('rp-noz', [[0.0, 0.0], [0.011, 0.0], [0.009, 0.025], [0.005, 0.04], [0.0, 0.04]], 20), toon(0xc87a3a), p, [0, 0.03, 0.19], [0.4, 0, 0]);
      mesh(sph(0.009, 10), glow(FX_COL.support), p, [0, 0.0125, 0.232], null, flat);
      mesh(tube('rp-hose', [[0.026, 0.0, -0.02], [0.04, 0.02, 0.04], [0.02, 0.036, 0.11], [0.006, 0.042, 0.15]], 0.005, 28), toon(INK), p);
      for (const x of [-1, 1]) mesh(tube('rp-clamp' + x, [[x * 0.016, -0.016, 0.08], [x * 0.02, -0.022, 0.11], [x * 0.012, -0.024, 0.14], [x * 0.005, -0.018, 0.155]], 0.005, 20), toon(KIT.light), p);
      z = 0.232; y = 0.012; break;
    }
    case 'w_missile': {
      mesh(profile('ms-pod', 0.16, [[-0.08, -0.06], [-0.08, 0.03], ['q', -0.08, 0.065, -0.045, 0.065], [0.05, 0.065], [0.085, 0.045], [0.085, -0.045], [0.05, -0.065], [-0.06, -0.065], ['q', -0.08, -0.065, -0.08, -0.06]]), toon(tc.second), p);
      mesh(box(0.14, 0.1, 0.01), toon(KIT.body), p, [0, 0, 0.083], null, flat);
      for (const x of [-0.042, 0, 0.042]) for (const yy of [-0.032, 0, 0.032]) {
        mesh(turned('ms-tube', [[0.0, -0.01], [0.015, -0.01], [0.015, 0.006], [0.017, 0.01], [0.0, 0.01]]), toon(INK), p, [x, yy, 0.085], null, flat);
        mesh(turned('ms-war', [[0.0, -0.01], [0.011, -0.01], [0.011, 0.0], [0.006, 0.012], [0.0, 0.016]]), toon(0xd8503f), p, [x, yy, 0.088], null, flat);
      }
      for (const x of [-1, 1]) mesh(profile('ms-door', 0.012, [[0, -0.06], [0.07, -0.05], [0.07, 0.05], [0, 0.06]], 0.003), toon(tc.main), p, [x * 0.085, 0, 0.085], [0, x * 0.55, 0]);
      for (const x of [-1, 1]) vents(p, toon(INK), 4, 0.05, 0.018, [x * 0.081, 0, -0.03], [0, Math.PI / 2, 0]);
      mesh(box(0.164, 0.016, 0.04), toon(KIT.orange), p, [0, -0.058, -0.04], null, flat);
      mesh(profile('ms-sens', 0.05, [[-0.04, 0.065], [0.02, 0.065], ['q', 0.03, 0.065, 0.03, 0.08], [0.02, 0.092], [-0.03, 0.092]]), toon(KIT.light), p, [0.04, 0, 0]);
      mesh(cyl(0.01, 0.01, 0.006, 12), glow(tc.eye), p, [0.04, 0.08, 0.031], [Math.PI / 2, 0, 0], flat);
      z = 0.1; break;
    }
    case 'w_howitzer': {
      mesh(turned('hw-ring', [[0.0, -0.016], [0.07, -0.016], [0.076, -0.006], [0.076, 0.006], [0.07, 0.016], [0.0, 0.016]]), toon(KIT.body), p, [0, -0.045, 0], [-Math.PI / 2, 0, 0]);
      mesh(profile('hw-mount', 0.11, [[-0.07, -0.04], [-0.07, 0.01], ['q', -0.07, 0.05, -0.03, 0.05], [0.04, 0.05], [0.07, 0.02], [0.07, -0.04]]), toon(tc.second), p);
      for (const x of [-1, 1]) vents(p, toon(INK), 3, 0.06, 0.02, [x * 0.056, 0.005, -0.01], [0, Math.PI / 2, 0]);
      mesh(profile('hw-load', 0.05, [[-0.06, -0.03], [0.02, -0.03], [0.02, 0.03], ['q', 0.02, 0.04, 0.01, 0.04], [-0.05, 0.04], ['q', -0.06, 0.04, -0.06, 0.03]]), toon(KIT.grey), p, [-0.075, 0, 0]);
      mesh(box(0.052, 0.012, 0.06), toon(KIT.orange), p, [-0.075, 0.036, -0.02], null, flat);
      const b = new T.Group(); b.position.set(0, 0.025, 0.03); b.rotation.x = -0.25; p.add(b);
      mesh(profile('hw-breech', 0.08, [[-0.05, -0.035], [-0.05, 0.025], ['q', -0.05, 0.04, -0.035, 0.04], [0.05, 0.035], [0.05, -0.035]]), toon(tc.main), b);
      mesh(turned('hw-brl', [[0.0, 0.04], [0.032, 0.04], [0.032, 0.07], [0.028, 0.075], [0.028, 0.34], [0.0, 0.34]]), D, b);
      for (const zz of [0.1, 0.14, 0.18, 0.22]) mesh(turned('hw-rib', [[0.0, -0.005], [0.035, -0.005], [0.037, 0.0], [0.035, 0.005], [0.0, 0.005]]), toon(KIT.body), b, [0, 0, zz], null, flat);
      for (const x of [-0.042, 0.042]) mesh(turned('hw-recoil', [[0.0, 0.03], [0.012, 0.03], [0.012, 0.15], [0.008, 0.155], [0.008, 0.21], [0.0, 0.21]]), toon(KIT.light), b, [x, -0.016, 0]);
      mesh(turned('hw-brake', [[0.0, 0.33], [0.034, 0.33], [0.038, 0.345], [0.038, 0.41], [0.032, 0.42], [0.0, 0.42]]), toon(KIT.body), b);
      for (const x of [-1, 1]) for (const zz of [0.355, 0.375, 0.395]) mesh(box(0.008, 0.032, 0.012), toon(INK), b, [x * 0.037, 0, zz], null, flat);
      mesh(box(0.012, 0.03, 0.12), toon(tc.trim), b, [0.036, 0.034, 0.08], null, flat);
      b.add(mu); mu.position.set(0, 0, 0.43); return mu;
    }
    case 's_inferno': {
      mesh(profile('in-body', 0.072, [[-0.04, 0.0], ['q', -0.04, 0.05, 0.0, 0.05], [0.09, 0.046], ['q', 0.12, 0.044, 0.12, 0.02], [0.12, -0.016], [0.0, -0.024], ['q', -0.04, -0.024, -0.04, 0.0]]), toon(KIT.body), p);
      for (const x of [-1, 1]) {
        mesh(turned('in-tank', [[0.0, -0.04], [0.012, -0.036], [0.02, -0.028], [0.023, -0.016], [0.023, 0.09], [0.02, 0.102], [0.012, 0.11], [0.0, 0.114]], 24), toon(0xe9892c), p, [x * 0.024, -0.052, 0]);
        for (const zz of [0.0, 0.06]) mesh(turned('in-band', [[0.0, -0.006], [0.0245, -0.006], [0.0245, 0.006], [0.0, 0.006]], 24), toon(INK), p, [x * 0.024, -0.052, zz], null, flat);
      }
      mesh(turned('in-gauge', [[0.0, -0.004], [0.017, -0.004], [0.017, 0.006], [0.0, 0.006]], 20), toon(KIT.light), p, [0.036, 0.034, 0.02], [0, Math.PI / 2, 0]);
      mesh(box(0.003, 0.012, 0.002), toon(0xd8503f), p, [0.043, 0.037, 0.02], [0, 0, -0.6], flat);
      mesh(tube('in-hose', [[0.0, -0.06, 0.08], [0.0, -0.05, 0.13], [0.0, -0.02, 0.15], [0.0, 0.0, 0.16]], 0.008, 20), toon(INK), p);
      mesh(turned('in-noz', [[0.0, 0.11], [0.026, 0.11], [0.022, 0.16], [0.018, 0.25], [0.0, 0.25]]), D2, p, [0, 0.012, 0]);
      for (const zz of [0.14, 0.165, 0.19, 0.215]) mesh(turned('in-fin', [[0.0, -0.004], [0.034, -0.004], [0.036, 0.0], [0.034, 0.004], [0.0, 0.004]], 24), toon(KIT.grey), p, [0, 0.012, zz], null, flat);
      mesh(turned('in-tip', [[0.0, 0.245], [0.02, 0.245], [0.03, 0.27], [0.032, 0.28], [0.022, 0.28], [0.0, 0.272]]), toon(KIT.orange), p, [0, 0.012, 0]);
      mesh(sph(0.011, 10), glow(0xff7a2a), p, [0, 0.036, 0.275], null, flat);
      z = 0.29; y = 0.012; break;
    }
    case 's_cryo': {
      mesh(profile('cr-body', 0.064, [[-0.06, 0.0], ['q', -0.06, 0.034, -0.03, 0.034], [0.05, 0.03], ['q', 0.07, 0.028, 0.07, 0.0], ['q', 0.07, -0.026, 0.05, -0.028], [-0.03, -0.032], ['q', -0.06, -0.032, -0.06, 0.0]]), toon(KIT.body), p);
      mesh(box(0.066, 0.012, 0.03), toon(KIT.orange), p, [0, -0.03, -0.03], null, flat);
      for (const x of [-1, 1]) {
        mesh(turned('cr-glass', [[0.0, -0.05], [0.017, -0.05], [0.017, 0.05], [0.0, 0.05]], 24), glow(FX_COL.cryo, 0.75), p, [x * 0.024, 0.044, 0], null, flat);
        for (const zz of [-0.056, 0.056]) mesh(turned('cr-capc', [[0.0, -0.008], [0.019, -0.008], [0.02, 0.0], [0.019, 0.008], [0.0, 0.008]], 24), toon(INK), p, [x * 0.024, 0.044, zz]);
      }
      mesh(turned('cr-brl', [[0.0, 0.06], [0.022, 0.06], [0.02, 0.23], [0.0, 0.23]]), toon(KIT.grey), p);
      for (const zz of [0.09, 0.11, 0.13, 0.15, 0.17]) mesh(turned('cr-fin', [[0.0, -0.004], [0.04, -0.004], [0.042, 0.0], [0.04, 0.004], [0.0, 0.004]], 32), toon(KIT.light), p, [0, 0, zz]);
      mesh(turned('cr-cham', [[0.0, 0.22], [0.026, 0.22], [0.026, 0.29], [0.0, 0.29]], 28), glow(FX_COL.cryo, 0.8), p, null, null, flat);
      for (const zz of [0.215, 0.295]) mesh(turned('cr-band', [[0.0, -0.007], [0.029, -0.007], [0.03, 0.0], [0.029, 0.007], [0.0, 0.007]], 28), toon(INK), p, [0, 0, zz]);
      for (let i = 0; i < 3; i++) {
        const g = new T.Group(); g.position.set(0, 0, 0.3); g.rotation.z = i / 3 * Math.PI * 2; p.add(g);
        mesh(tube('cr-prong', [[0, 0.022, 0.0], [0, 0.03, 0.03], [0, 0.022, 0.06], [0, 0.012, 0.075]], 0.005, 16), toon(KIT.grey), g);
      }
      mesh(sph(0.016, 14), glow(0xe8fbff), p, [0, 0, 0.365], null, flat);
      z = 0.38; break;
    }
    case 's_emp': {
      mesh(profile('em-body', 0.072, [[-0.05, 0.0], ['q', -0.05, 0.034, -0.02, 0.034], [0.03, 0.032], ['q', 0.05, 0.03, 0.05, 0.0], ['q', 0.05, -0.03, 0.03, -0.032], [-0.02, -0.034], ['q', -0.05, -0.034, -0.05, 0.0]]), toon(KIT.body), p);
      for (const x of [-1, 1]) vents(p, toon(INK), 3, 0.04, 0.016, [x * 0.036, 0, -0.005], [0, Math.PI / 2, 0]);
      mesh(box(0.074, 0.012, 0.03), toon(KIT.orange), p, [0, 0.034, -0.025], null, flat);
      mesh(turned('em-drum', [[0.0, 0.03], [0.04, 0.03], [0.046, 0.04], [0.046, 0.13], [0.0, 0.13]], 40), toon(KIT.grey), p);
      for (const zz of [0.055, 0.08, 0.105]) mesh(turned('em-coil', [[0.0, -0.007], [0.048, -0.007], [0.05, 0.0], [0.048, 0.007], [0.0, 0.007]], 40), toon(0xc87a3a), p, [0, 0, zz]);
      for (const zz of [0.0675, 0.0925]) mesh(turned('em-gap', [[0.0, -0.0035], [0.0475, -0.0035], [0.0475, 0.0035], [0.0, 0.0035]], 40), glow(FX_COL.energy), p, [0, 0, zz], null, flat);
      mesh(turned('em-dish', [[0.0, 0.135], [0.03, 0.13], [0.05, 0.126], [0.054, 0.134], [0.034, 0.142], [0.0, 0.146]], 40), toon(KIT.light), p);
      for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + Math.PI / 4; mesh(turned('em-prong', [[0.0, 0.12], [0.006, 0.12], [0.004, 0.17], [0.0, 0.176]], 12), toon(KIT.grey), p, [Math.cos(a) * 0.044, Math.sin(a) * 0.044, 0]); }
      mesh(sph(0.022, 16), glow(FX_COL.energy), p, [0, 0, 0.145], null, flat);
      z = 0.16; break;
    }
    case 's_railgun': {
      mesh(profile('rg-breech', 0.12, [[-0.1, -0.02], ['q', -0.1, 0.05, -0.05, 0.056], [0.06, 0.05], ['q', 0.1, 0.048, 0.1, 0.02], [0.1, -0.04], ['q', 0.1, -0.056, 0.07, -0.056], [-0.07, -0.056], ['q', -0.1, -0.056, -0.1, -0.02]]), toon(KIT.body), p);
      for (const x of [-1, 1]) vents(p, toon(INK), 4, 0.07, 0.016, [x * 0.061, 0, -0.01], [0, Math.PI / 2, 0]);
      mesh(profile('rg-hump', 0.07, [[-0.06, 0.05], ['q', -0.06, 0.1, -0.02, 0.1], [0.02, 0.1], ['q', 0.05, 0.1, 0.05, 0.05]]), toon(KIT.grey), p);
      for (const zz of [-0.03, -0.01, 0.01]) mesh(box(0.072, 0.008, 0.006), glow(FX_COL.energy), p, [0, 0.094, zz], null, flat);
      mesh(box(0.124, 0.014, 0.05), toon(KIT.orange), p, [0, 0.05, -0.075], null, flat);
      mesh(profile('rg-ur', 0.05, [[0.08, 0.05], [0.6, 0.04], ['q', 0.67, 0.04, 0.69, 0.022], [0.69, 0.012], [0.08, 0.012]]), D2, p);
      mesh(profile('rg-lr', 0.05, [[0.08, -0.012], [0.69, -0.012], [0.69, -0.022], ['q', 0.67, -0.036, 0.6, -0.038], [0.08, -0.046]]), D2, p);
      mesh(box(0.03, 0.022, 0.6), glow(FX_COL.energy), p, [0, 0, 0.39], null, flat);
      for (let i = 0; i < 10; i++) mesh(profile('rg-fin', 0.074, [[-0.003, 0.058], [0.003, 0.058], [0.003, -0.062], [-0.003, -0.062]], 0.0015), toon(i % 3 === 2 ? KIT.orange : KIT.grey), p, [0, 0, 0.11 + i * 0.022]);
      for (const zz of [0.4, 0.54]) mesh(profile('rg-yoke', 0.066, [[-0.016, 0.052], [0.016, 0.052], ['q', 0.022, 0.052, 0.022, 0.04], [0.022, -0.044], ['q', 0.022, -0.056, 0.016, -0.056], [-0.016, -0.056], ['q', -0.022, -0.056, -0.022, -0.044], [-0.022, 0.04], ['q', -0.022, 0.052, -0.016, 0.052]], 0.005), toon(KIT.body), p, [0, 0, zz]);
      for (const yy of [0.028, -0.03]) mesh(box(0.052, 0.012, 0.03), toon(KIT.orange), p, [0, yy + (yy > 0 ? 0.005 : -0.005), 0.67], null, flat);
      for (const x of [-1, 1]) mesh(tube('rg-cable' + x, [[x * 0.05, -0.044, 0.04], [x * 0.044, -0.054, 0.14], [x * 0.036, -0.05, 0.3], [x * 0.03, -0.046, 0.38]], 0.008, 32), toon(INK), p);
      z = 0.69; y = 0; break;
    }
    default:
      mesh(box(0.05, 0.06, 0.15), D, p, [0, 0, 0.06]);
  }
  mu.position.set(0, y, z); p.add(mu);
  return mu;
}

function buildAux(bp, id, pos, tc) {
  const g = new T.Group(); g.position.set(pos[0], pos[1], pos[2]); bp.add(g);
  const D = toon(tc.metal), D2 = toon(tc.dark);
  const U = [-Math.PI / 2, 0, 0], X = [0, Math.PI / 2, 0], Z = [0, Math.PI, 0];   // turned parts: up, sideways, facing back
  switch (id) {
    // Cooling System: a chamfered housing with a round fan shroud on its back face, fan blades and a hub
    case 'a_cool':
      mesh(slab('ax-coolh', 0.05, [[-0.04, 0.04], [0.04, 0.04], [0.045, 0.03], [0.045, -0.03], [0.04, -0.04], [-0.04, -0.04], [-0.045, -0.03], [-0.045, 0.03]], 0.006), D, g);
      mesh(turned('ax-shroud', [[0.026, 0.0], [0.036, 0.0], [0.036, 0.012], [0.03, 0.016], [0.026, 0.016]], 32), toon(tc.trim), g, [0, 0, -0.024], Z);
      for (let i = 0; i < 6; i++) mesh(box(0.006, 0.026, 0.004), D2, g, [Math.cos(i * 1.047) * 0.014, Math.sin(i * 1.047) * 0.014, -0.03], [0, 0.4, i * 1.047 + Math.PI / 2], flat);
      mesh(turned('ax-hub', [[0.0, 0.0], [0.008, 0.0], [0.006, 0.01], [0.0, 0.012]], 16), toon(tc.trim), g, [0, 0, -0.026], Z);
      break;
    // Heat Sink: a base block carrying a stack of thin chamfered fins, capped at each end in the trim colour
    case 'a_sink':
      mesh(slab('ax-sinkb', 0.05, [[-0.045, -0.02], [0.045, -0.02], [0.045, -0.04], [-0.045, -0.04]], 0.005), D, g);
      for (let i = 0; i < 6; i++) mesh(profile('ax-fin', 0.006, [[-0.024, -0.02], [0.024, -0.02], [0.02, 0.04], [-0.02, 0.04]], 0.0015), D2, g, [-0.035 + i * 0.014, 0, 0]);
      for (const x of [-1, 1]) mesh(profile('ax-sinkc', 0.008, [[-0.026, -0.04], [0.026, -0.04], [0.022, 0.045], [-0.022, 0.045]], 0.002), toon(tc.trim), g, [x * 0.048, 0, 0]);
      break;
    // Armor Plating: a chamfered hexagonal add-on plate with a trim stripe and four bolts
    case 'a_plate':
      mesh(slab('ax-plate', 0.03, [[-0.034, 0.045], [0.034, 0.045], [0.05, 0.0], [0.034, -0.045], [-0.034, -0.045], [-0.05, 0.0]], 0.007), toon(tc.second), g);
      mesh(box(0.07, 0.012, 0.004), toon(tc.trim), g, [0, 0.0, -0.016], null, flat);
      rivets(g, D2, [[-0.025, 0.03, -0.016], [0.025, 0.03, -0.016], [-0.025, -0.03, -0.016], [0.025, -0.03, -0.016]]);
      break;
    // Bulwark Plating: two layered slabs, the outer one smaller, with an accent band and heavy bolts
    case 'a_bulwark':
      mesh(slab('ax-bulw1', 0.03, [[-0.05, 0.05], [0.05, 0.05], [0.058, 0.03], [0.058, -0.04], [0.045, -0.055], [-0.045, -0.055], [-0.058, -0.04], [-0.058, 0.03]], 0.007), toon(tc.main), g);
      mesh(slab('ax-bulw2', 0.02, [[-0.036, 0.036], [0.036, 0.036], [0.044, 0.02], [0.044, -0.03], [-0.044, -0.03], [-0.044, 0.02]], 0.005), toon(tc.second), g, [0, 0, -0.022]);
      mesh(box(0.1, 0.014, 0.004), toon(tc.accent), g, [0, -0.044, -0.016], null, flat);
      rivets(g, D2, [[-0.032, 0.024, -0.033], [0.032, 0.024, -0.033], [-0.032, -0.02, -0.033], [0.032, -0.02, -0.033]]);
      break;
    // Quantum Relay: a turned base, a mast, a small dish turned up and back, a glowing ring and tip
    case 'a_relay':
      mesh(turned('ax-rbase', [[0.0, -0.04], [0.028, -0.04], [0.03, -0.03], [0.02, -0.015], [0.0, -0.012]], 8), D, g, null, U);
      mesh(turned('ax-mast', [[0.0, -0.015], [0.006, -0.015], [0.004, 0.07], [0.0, 0.07]], 12), D2, g, null, U);
      mesh(turned('ax-dish', [[0.0, 0.0], [0.006, 0.0], [0.022, 0.008], [0.03, 0.018], [0.026, 0.02], [0.0, 0.008]], 24), D, g, [0, 0.02, -0.006], [Math.PI * 0.75, 0, 0]);
      mesh(tor(0.016, 0.004), glow(tc.glow), g, [0, 0.05, 0], [Math.PI / 2, 0, 0], flat);
      mesh(sph(0.009, 10), glow(tc.glow), g, [0, 0.074, 0], null, flat);
      break;
    // Jump Booster: twin thruster pods, each a turned capsule ending in a dark bell nozzle with a glow inside
    case 'a_jump':
      for (const x of [-0.024, 0.024]) {
        mesh(turned('ax-jpod', [[0.0, -0.035], [0.018, -0.03], [0.023, -0.015], [0.023, 0.03], [0.016, 0.045], [0.0, 0.048]], 20), D, g, [x, 0, 0], U);
        mesh(turned('ax-jbell', [[0.0, -0.035], [0.014, -0.035], [0.022, -0.06], [0.026, -0.068], [0.02, -0.066], [0.012, -0.045], [0.0, -0.045]], 20), D2, g, [x, 0, 0], U);
        mesh(cone(0.017, 0.04, 12), glow(tc.thruster, 0.7), g, [x, -0.07, 0], [Math.PI, 0, 0], flat);
      }
      mesh(box(0.072, 0.012, 0.03), toon(tc.trim), g, [0, 0.02, 0], null, flat);
      break;
    // Auxiliary Power Unit: a power cell lying on its side, ribbed, with domed end caps and a glowing window band
    case 'a_apu':
      mesh(turned('ax-cell', [[0.0, -0.055], [0.018, -0.052], [0.028, -0.042], [0.03, -0.03], [0.03, 0.03], [0.028, 0.042], [0.018, 0.052], [0.0, 0.055]], 24), D, g, null, X);
      for (const x of [-0.03, 0.03]) mesh(turned('ax-rib', [[0.0, -0.004], [0.033, -0.004], [0.034, 0.0], [0.033, 0.004], [0.0, 0.004]], 24), D2, g, [x, 0, 0], X);
      mesh(turned('ax-win', [[0.0, -0.014], [0.0315, -0.014], [0.0315, 0.014], [0.0, 0.014]], 24), glow(0x9dff8a), g, null, X, flat);
      break;
    // Nano-Repair Module: a chamfered base with a glass dome of glowing nanites on top
    case 'a_nano':
      mesh(slab('ax-nanob', 0.05, [[-0.03, 0.0], [0.03, 0.0], [0.035, -0.01], [0.035, -0.035], [-0.035, -0.035], [-0.035, -0.01]], 0.005), D, g);
      mesh(turned('ax-dome', [[0.0, 0.0], [0.024, 0.0], [0.024, 0.01], [0.02, 0.026], [0.01, 0.034], [0.0, 0.036]], 24), glow(0x7dffb2, 0.75), g, null, U, flat);
      mesh(turned('ax-domer', [[0.0, -0.004], [0.027, -0.004], [0.027, 0.004], [0.0, 0.004]], 24), D2, g, null, U);
      break;
    // Servo Struts: two hydraulic rams, each a turned cylinder with a polished rod and eye ends
    case 'a_servo':
      for (const x of [-0.022, 0.022]) {
        mesh(turned('ax-ram', [[0.0, -0.05], [0.012, -0.05], [0.013, -0.044], [0.013, 0.01], [0.0, 0.01]], 16), D, g, [x, 0, 0], U);
        mesh(turned('ax-rod', [[0.0, 0.0], [0.006, 0.0], [0.006, 0.045], [0.0, 0.045]], 12), toon(0xb8bec6), g, [x, 0, 0], U);
        for (const y of [-0.052, 0.048]) mesh(tor(0.007, 0.003), D2, g, [x, y, 0], [0, Math.PI / 2, 0], flat);
      }
      break;
    // Shield Generator: a chamfered emitter disc facing back, a glowing ring set into it and a lens in the middle
    case 'a_shield':
      mesh(turned('ax-sdisc', [[0.0, 0.0], [0.04, 0.0], [0.046, 0.008], [0.046, 0.016], [0.036, 0.024], [0.0, 0.024]], 36), D, g, [0, 0, 0.012], Z);
      mesh(turned('ax-sring', [[0.024, 0.0], [0.034, 0.0], [0.034, 0.004], [0.024, 0.004]], 36), glow(0x8fdcff), g, [0, 0, -0.012], Z, flat);
      mesh(turned('ax-lens', [[0.0, 0.0], [0.012, 0.0], [0.008, 0.008], [0.0, 0.01]], 16), glow(0xd8f2ff), g, [0, 0, -0.012], Z, flat);
      break;
    // Overcharger: a chamfered block carrying two glass capacitor tubes of red light in dark caps
    case 'a_over':
      mesh(slab('ax-overb', 0.045, [[-0.035, -0.035], [0.035, -0.035], [0.04, -0.045], [0.04, -0.06], [-0.04, -0.06], [-0.04, -0.045]], 0.005), D, g);
      for (const x of [-0.02, 0.02]) {
        mesh(turned('ax-cap', [[0.0, -0.035], [0.016, -0.035], [0.016, 0.03], [0.0, 0.03]], 16), glow(0xff4a4a, 0.85), g, [x, 0, 0], U, flat);
        for (const y of [-0.038, 0.032]) mesh(turned('ax-capend', [[0.0, -0.005], [0.018, -0.005], [0.019, 0.0], [0.018, 0.005], [0.0, 0.005]], 16), D2, g, [x, y, 0], U);
      }
      break;
    default: mesh(box(0.065, 0.065, 0.045), D, g);
  }
  return g;
}

/* Shoulders belong to the weapon, not the chassis: each arm slot is one module (shoulder, arm and weapon) and the
   chassis only offers a bare socket. The weapon's family picks the shoulder's shape; the doctrine still paints it. */
const SHOULDER = { b_gun: 'gun', w_smg: 'gun', w_scatter: 'gun', w_rail: 'gun', w_gatling: 'rotary', w_laser: 'energy', w_lance: 'energy', w_arc: 'energy', s_emp: 'energy', s_cryo: 'energy', w_missile: 'mount', w_howitzer: 'mount', s_railgun: 'mount', w_blade: 'melee', w_ram: 'melee', w_shield: 'guard', w_repair: 'tool', s_inferno: 'tool' };
// the chassis' socket: a dark collar the arm module plugs into, all that is left when the arm is gone
function shoulderSocket(sh, sx, tc, k, reach) {
  // the socket sits in the chest side: a chamfered flange in the hull colour set into the armour, a dark collar
  // standing a little proud of it, and the empty bore where the arm module locks in
  const kk = k.toFixed(3), r = [0, sx * Math.PI / 2, 0];
  const back = -Math.max(0.075, (reach || 0.055) + 0.02), rk = kk + ':' + back.toFixed(3);
  mesh(turned('sock-fl' + rk, [[0.0, back], [0.05 * k, back], [0.056 * k, back + 0.015], [0.056 * k, -0.035], [0.046 * k, -0.025], [0.0, -0.025]], 24), toon(tc.second), sh, null, r);
  mesh(turned('sock-col' + kk, [[0.0, -0.03], [0.036 * k, -0.03], [0.038 * k, -0.006], [0.032 * k, 0.0], [0.0, 0.0]], 24), toon(tc.dark), sh, null, r);
  mesh(turned('sock-bore' + kk, [[0.0, -0.004], [0.02 * k, -0.004], [0.02 * k, 0.002], [0.0, 0.002]], 16), toon(INK), sh, null, r, flat);
}
function armShoulder(sh, sx, tc, style, id, k) {
  const fam = SHOULDER[id] || 'gun', wt = (DEFS()[id] && DEFS()[id].wt) || 2;
  k *= Math.min(1.25, 0.9 + wt * 0.04);
  const kk = k.toFixed(3), cx = sx * 0.032 * k;
  if (fam === 'gun') {
    // a rifleman's shoulder, after the RX-78-2: a big rounded block standing proud of the chest, a raised panel on
    // its outer face and a dark seam where it opens over the arm
    mesh(profile('sh-gun' + kk, 0.11 * k, [[-0.058 * k, 0.062 * k], [0.058 * k, 0.062 * k], ['q', 0.078 * k, 0.062 * k, 0.078 * k, 0.04 * k], [0.072 * k, -0.07 * k], [-0.072 * k, -0.07 * k], [-0.078 * k, 0.04 * k], ['q', -0.078 * k, 0.062 * k, -0.058 * k, 0.062 * k]], 0.014 * k), toon(tc.main), sh, [cx, 0.0, 0]);
    mesh(profile('sh-gunp' + kk, 0.012, [[-0.05 * k, 0.04 * k], [0.05 * k, 0.04 * k], [0.046 * k, -0.05 * k], [-0.046 * k, -0.05 * k]], 0.003), toon(tc.second), sh, [cx + sx * 0.056 * k, 0.0, 0]);
    mesh(box(0.11 * k, 0.008, 0.15 * k), toon(INK), sh, [cx, -0.058 * k, 0], null, flat);
  } else if (fam === 'rotary') {
    // a gunner's shoulder: a drum housing with chamfered rims under a hood, and an ammo box on the back feeding it
    mesh(turned('sh-rdrum' + kk, [[0.0, -0.05 * k], [0.066 * k, -0.05 * k], [0.08 * k, -0.036 * k], [0.08 * k, 0.036 * k], [0.066 * k, 0.05 * k], [0.0, 0.05 * k]], 36), toon(tc.dark), sh, [cx, 0.0, 0], [0, Math.PI / 2, 0]);
    mesh(profile('sh-rhood' + kk, 0.12 * k, [[-0.09 * k, 0.03 * k], [-0.07 * k, 0.09 * k], [0.07 * k, 0.09 * k], [0.09 * k, 0.03 * k], [0.08 * k, 0.0], [-0.08 * k, 0.0]], 0.01), toon(tc.main), sh, [cx, 0.02 * k, 0]);
    mesh(slab('sh-ammo' + kk, 0.07 * k, [[-0.04 * k, 0.05 * k], [0.04 * k, 0.05 * k], [0.04 * k, -0.04 * k], [-0.04 * k, -0.04 * k]], 0.008), toon(tc.second), sh, [cx, 0.02 * k, -0.11 * k]);
    for (let i = 0; i < 3; i++) mesh(box(0.084 * k, 0.006, 0.006), toon(INK), sh, [cx, (0.0 + i * 0.025) * k, -0.146 * k], null, flat);
    mesh(tube('sh-feed' + kk + sx, [[cx, -0.01 * k, -0.08 * k], [cx + sx * 0.03 * k, -0.04 * k, -0.06 * k], [cx + sx * 0.05 * k, -0.06 * k, -0.02 * k]], 0.012 * k, 16), toon(INK), sh);
  } else if (fam === 'energy') {
    // a capacitor shoulder: a domed cowl, a tall fin with a glowing edge standing off the top, and a ring of light
    // round the arm root where the power runs down to the weapon
    mesh(profile('sh-ecowl' + kk, 0.1 * k, [[-0.072 * k, 0.0], ['q', -0.072 * k, 0.074 * k, 0.0, 0.078 * k], ['q', 0.072 * k, 0.074 * k, 0.072 * k, 0.0], [0.062 * k, -0.06 * k], [-0.062 * k, -0.06 * k]], 0.012), toon(tc.main), sh, [cx, 0.0, 0]);
    mesh(profile('sh-efin' + kk, 0.016, [[-0.05 * k, 0.05 * k], [0.03 * k, 0.05 * k], [0.0, 0.16 * k], [-0.04 * k, 0.15 * k]], 0.004), toon(tc.second), sh, [cx + sx * 0.03 * k, 0.0, 0], [0, 0, sx * -0.3]);
    mesh(box(0.005, 0.1 * k, 0.005), glow(tc.glow || tc.eye), sh, [cx + sx * 0.062 * k, 0.1 * k, -0.01 * k], [0, 0, sx * -0.3], flat);
    mesh(tor(0.052 * k, 0.005), glow(tc.glow || tc.eye), sh, [cx + sx * 0.02 * k, -0.04 * k, 0], [0, Math.PI / 2, 0], flat);
  } else if (fam === 'mount') {
    // a weapons mount: no pauldron, a low armoured saddle across the shoulder carrying a turret ring for the launcher
    // that sits on top, braced down the outside
    mesh(profile('sh-saddle' + kk, 0.12 * k, [[-0.08 * k, 0.05 * k], [0.08 * k, 0.05 * k], [0.09 * k, 0.03 * k], [0.07 * k, -0.04 * k], [-0.07 * k, -0.04 * k], [-0.09 * k, 0.03 * k]], 0.01), toon(tc.main), sh, [cx, 0.0, 0]);
    mesh(turned('sh-ring' + kk, [[0.0, 0.0], [0.05 * k, 0.0], [0.05 * k, 0.012 * k], [0.04 * k, 0.02 * k], [0.0, 0.02 * k]], 32), toon(tc.dark), sh, [sx * 0.01, 0.05 * k, -0.02], [-Math.PI / 2, 0, 0]);
    mesh(profile('sh-brace' + kk, 0.014, [[-0.05 * k, 0.04 * k], [0.05 * k, 0.04 * k], [0.03 * k, -0.08 * k], [-0.03 * k, -0.08 * k]], 0.004), toon(tc.second), sh, [cx + sx * 0.062 * k, 0.0, 0]);
    mesh(box(0.09 * k, 0.01, 0.12 * k), toon(tc.accent), sh, [cx, 0.052 * k, 0.06 * k], null, flat);
  } else if (fam === 'melee') {
    // a duellist's pauldron: two swept plates raked up and back with a horn standing off the outer edge
    mesh(profile('sh-mel1' + kk, 0.12 * k, [[-0.085 * k, -0.03 * k], [0.075 * k, -0.03 * k], [0.095 * k, 0.03 * k], [0.03 * k, 0.09 * k], [-0.085 * k, 0.07 * k]], 0.01), toon(tc.main), sh, [cx, 0.0, 0], [0, 0, sx * -0.25]);
    mesh(profile('sh-mel2' + kk, 0.06 * k, [[-0.07 * k, 0.0], [0.05 * k, 0.0], [0.07 * k, 0.04 * k], [0.02 * k, 0.08 * k], [-0.07 * k, 0.06 * k]], 0.006), toon(tc.second), sh, [cx + sx * 0.05 * k, 0.0, 0], [0, 0, sx * -0.45]);
    mesh(turned('sh-horn' + kk, [[0.0, 0.0], [0.016 * k, 0.0], [0.0, 0.09 * k]], 12), toon(tc.trim), sh, [cx + sx * 0.06 * k, 0.07 * k, -0.02 * k], [-Math.PI / 2 + 0.3, sx * 0.6, 0]);
  } else if (fam === 'guard') {
    // a shield-bearer's shoulder, after the Dreadnought: a heavy drum housing chamfered at both rims, a bolted round
    // plate on its outer face, and a domed armour cap with a brass edge strip
    mesh(turned('sh-gdrum' + kk, [[0.0, -0.055 * k], [0.072 * k, -0.055 * k], [0.09 * k, -0.037 * k], [0.09 * k, 0.037 * k], [0.072 * k, 0.055 * k], [0.0, 0.055 * k]], 40), toon(tc.dark), sh, [cx, 0.0, 0], [0, Math.PI / 2, 0]);
    mesh(turned('sh-gplate' + kk, [[0.0, 0.0], [0.06 * k, 0.0], [0.06 * k, 0.008], [0.05 * k, 0.016], [0.0, 0.016]], 40), toon(tc.second), sh, [cx + sx * 0.054 * k, 0.0, 0], [0, sx * Math.PI / 2, 0]);
    for (let i = 0; i < 8; i++) { const a2 = i / 8 * Math.PI * 2; mesh(cyl(0.006, 0.006, 0.008, 6), toon(tc.metal), sh, [cx + sx * 0.072 * k, Math.cos(a2) * 0.046 * k, Math.sin(a2) * 0.046 * k], [0, 0, Math.PI / 2], flat); }
    mesh(profile('sh-gcap' + kk, 0.15 * k, [[-0.12 * k, 0.03 * k], ['q', -0.11 * k, 0.13 * k, 0.0, 0.135 * k], ['q', 0.11 * k, 0.13 * k, 0.12 * k, 0.03 * k], [0.1 * k, 0.0], [-0.1 * k, 0.0]], 0.012), toon(tc.main), sh, [cx + sx * 0.01 * k, 0.03 * k, 0]);
    mesh(profile('sh-gstrip' + kk, 0.155 * k, [[-0.122 * k, 0.03 * k], [0.122 * k, 0.03 * k], [0.104 * k, 0.012 * k], [-0.104 * k, 0.012 * k]], 0.004), toon(tc.accent), sh, [cx + sx * 0.01 * k, 0.03 * k, 0]);
  } else {
    // a utility shoulder: a squat block in hazard stripes with a warning light and a feed hose running down the back
    mesh(profile('sh-tool' + kk, 0.1 * k, [[-0.06 * k, 0.055 * k], [0.06 * k, 0.055 * k], [0.072 * k, 0.03 * k], [0.068 * k, -0.06 * k], [-0.068 * k, -0.06 * k], [-0.072 * k, 0.03 * k]], 0.01), toon(tc.main), sh, [cx, 0.0, 0]);
    for (let i = 0; i < 4; i++) mesh(box(0.012, 0.03 * k, 0.026 * k), toon(i % 2 ? INK : KIT.orange), sh, [cx + sx * 0.051 * k, -0.01 * k, (-0.045 + i * 0.03) * k], [0.6, 0, 0], flat);
    mesh(sph(0.012 * k, 10), glow(KIT.orange), sh, [cx, 0.066 * k, -0.03 * k], null, flat);
    mesh(tube('sh-hose' + kk + sx, [[cx, 0.04 * k, -0.06 * k], [cx + sx * 0.02 * k, 0.0, -0.09 * k], [cx + sx * 0.03 * k, -0.07 * k, -0.06 * k]], 0.009 * k, 16), toon(INK), sh);
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
      mesh(wedge(0.016, 0.14, 0.014, 0.3, 1), toon(tc.trim), hd, [sx * 0.045, 0.12, 0.05], [0, 0, -sx * 0.85]);
    }
    mesh(box(0.02, 0.02, 0.02), toon(tc.second), hd, [0, 0.09, 0.05]);
    for (const sx of [-1, 1]) { mesh(cyl(0.007, 0.007, 0.03, 8), toon(INK), hd, [sx * 0.04, 0.072, 0.072], [Math.PI / 2, 0, 0]); }
  } else if (style === 'armored') {
    // a low armoured sensor hood: a sloped cowl with a vent grille, three round lenses in a dark band
    mesh(wedge(0.15, 0.085, 0.13, 0.75, 0.7, -0.01), toon(tc.second), hd, [0, 0.03, -0.01]);
    mesh(box(0.13, 0.04, 0.025), toon(tc.dark), hd, [0, 0.035, 0.056]);
    for (const x of [-0.035, 0, 0.035]) { mesh(cyl(0.013, 0.013, 0.012, 14), toon(tc.metal), hd, [x, 0.035, 0.07], [Math.PI / 2, 0, 0], flat); mesh(cyl(0.008, 0.008, 0.013, 12), glow(tc.eye), hd, [x, 0.035, 0.071], [Math.PI / 2, 0, 0], flat); }
    vents(hd, toon(tc.dark), 4, 0.07, 0.011, [0, 0.074, 0.02], [-0.6, 0, 0]);
    mesh(cyl(0.006, 0.006, 0.08, 5), toon(INK), hd, [0.055, 0.1, -0.04]);
  } else {
    // after the Zaku II: a domed helmet with a dark visor slot running round it, the mono-eye riding a rail inside the
    // slot, a crest fin on top and two cheek pipes running down to the collar
    mesh(turned('ex-dome', [[0.0, -0.012], [0.058, -0.012], [0.064, 0.012], [0.062, 0.05], [0.05, 0.08], [0.026, 0.096], [0.0, 0.1]], 36), toon(tc.main), hd, [0, 0.0, 0], [-Math.PI / 2, 0, 0]);
    mesh(turned('ex-visor', [[0.055, 0.028], [0.066, 0.03], [0.066, 0.054], [0.055, 0.056]], 36), toon(tc.dark), hd, [0, 0.0, 0], [-Math.PI / 2, 0, 0]);
    mesh(profile('ex-crest', 0.012, [[-0.05, 0.09], [0.0, 0.112], [0.036, 0.1], [-0.02, 0.082]], 0.003), toon(tc.second), hd);
    for (const sx of [-1, 1]) mesh(tube('ex-cheek' + sx, [[sx * 0.03, 0.0, 0.05], [sx * 0.05, -0.02, 0.04], [sx * 0.06, -0.04, 0.02]], 0.008, 12), toon(tc.dark), hd);
    return mesh(sph(0.012, 10), glow(tc.eye), hd, [0, 0.042, 0.064], null, flat);
  }
  return null;
}

// the chassis as built, measured in its own space: the highest point under a footprint (where a head can rest) and
// the widest point within a height band (where an arm can hang clear). Parts marked noRest are ones a head is meant
// to sit down inside, like the Zaku's collar and pipes
function frameBoxes(frame) {
  frame.updateMatrixWorld(true);
  const inv = new T.Matrix4().copy(frame.matrixWorld).invert(), out = [];
  frame.traverse(o => { if (o.isMesh && !o.userData.outline && !o.userData.noRest) out.push(new T.Box3().setFromObject(o).applyMatrix4(inv)); });
  return out;
}
function restTop(boxes, x0, x1, z0, z1, floor) {
  let top = floor;
  for (const b of boxes) if (b.max.x > x0 && b.min.x < x1 && b.max.z > z0 && b.min.z < z1) top = Math.max(top, b.max.y);
  return top;
}
function sideExtent(boxes, y0, y1, floor) {
  let ext = floor;
  for (const b of boxes) if (b.max.y > y0 && b.min.y < y1) ext = Math.max(ext, Math.abs(b.min.x), Math.abs(b.max.x));
  return ext;
}
function buildChest(frame, tc, style, fid, w, h, dp, cy, legKind) {
  // skirt armour hangs over a biped's thighs; a quad hub, tracks and a hover bell carry the hull without it
  const thighs = legKind !== 'treads' && legKind !== 'hover' && legKind !== 'quad';
  // waist: a medium joint block under every chest
  if (style !== 'armored') mesh(wedge(w * 0.5, 0.09, dp * 0.75, 1.2, 1.1), toon(tc.dark), frame, [0, 0.045, 0]);
  if (style === 'assault') {
    // after the RX-78-2: a broad upper chest with rounded shoulders that tucks in under the pecs, a raised chest
    // block in the second colour with two yellow vent grilles, a narrow dark abdomen with the cockpit hatch, a
    // waist belt with its buckle, and the front and side skirts over the hips
    const K = [w, h, dp].map(v => v.toFixed(3)).join();
    mesh(slab('as-chest' + K, dp, [[-w * 0.4, h * 0.5], [w * 0.4, h * 0.5], ['q', w * 0.5, h * 0.5, w * 0.5, h * 0.38], [w * 0.46, h * 0.02], ['q', w * 0.44, -h * 0.12, w * 0.3, -h * 0.12], [-w * 0.3, -h * 0.12], ['q', -w * 0.44, -h * 0.12, -w * 0.46, h * 0.02], [-w * 0.5, h * 0.38], ['q', -w * 0.5, h * 0.5, -w * 0.4, h * 0.5]], 0.012), toon(tc.main), frame, [0, cy, 0]);
    mesh(slab('as-plate' + K, 0.04, [[-w * 0.34, h * 0.44], [w * 0.34, h * 0.44], ['q', w * 0.43, h * 0.44, w * 0.42, h * 0.32], [w * 0.37, h * 0.04], ['q', w * 0.35, -h * 0.05, w * 0.25, -h * 0.05], [-w * 0.25, -h * 0.05], ['q', -w * 0.35, -h * 0.05, -w * 0.37, h * 0.04], [-w * 0.42, h * 0.32], ['q', -w * 0.43, h * 0.44, -w * 0.34, h * 0.44]], 0.008), toon(tc.second), frame, [0, cy, dp * 0.5]);
    for (const sx of [-1, 1]) {
      mesh(slab('as-vent' + K, 0.016, [[-w * 0.1, h * 0.1], [w * 0.1, h * 0.1], [w * 0.09, -h * 0.1], [-w * 0.1, -h * 0.1]], 0.003), toon(tc.trim), frame, [sx * w * 0.19, cy + h * 0.24, dp * 0.5 + 0.022]);
      for (let i = 0; i < 4; i++) mesh(box(w * 0.16, 0.007, 0.006), toon(INK), frame, [sx * w * 0.19, cy + h * 0.165 + i * h * 0.05, dp * 0.5 + 0.031], null, flat);
    }
    mesh(slab('as-abs' + K, dp * 0.78, [[-w * 0.3, -h * 0.08], [w * 0.3, -h * 0.08], [w * 0.24, -h * 0.5], [-w * 0.24, -h * 0.5]], 0.01), toon(tc.accent), frame, [0, cy, 0]);
    mesh(slab('as-hatch' + K, 0.026, [[-w * 0.12, -h * 0.14], [w * 0.12, -h * 0.14], ['q', w * 0.13, -h * 0.38, 0, -h * 0.43], ['q', -w * 0.13, -h * 0.38, -w * 0.12, -h * 0.14]], 0.006), toon(tc.second), frame, [0, cy, dp * 0.39]);
    mesh(slab('as-belt' + K, dp * 0.86, [[-w * 0.33, 0.05], [w * 0.33, 0.05], ['q', w * 0.36, 0.05, w * 0.36, 0.03], [w * 0.33, 0.0], [-w * 0.33, 0.0], [-w * 0.36, 0.03], ['q', -w * 0.36, 0.05, -w * 0.33, 0.05]], 0.008), toon(tc.main), frame, [0, 0.035, 0]);
    mesh(slab('as-buckle' + K, 0.02, [[-w * 0.07, 0.045], [w * 0.07, 0.045], [0, -0.005]], 0.004), toon(tc.trim), frame, [0, 0.035, dp * 0.44]);
    if (thighs) for (const sx of [-1, 1]) {
      mesh(slab('as-skirt' + K, 0.03, [[-w * 0.14, 0], [w * 0.14, 0], [w * 0.13, -h * 0.42], ['q', w * 0.1, -h * 0.5, 0, -h * 0.5], [-w * 0.13, -h * 0.42]], 0.006), toon(tc.main), frame, [sx * w * 0.17, 0.04, dp * 0.42], [0.12, 0, 0]);
      mesh(box(w * 0.1, h * 0.1, 0.012), toon(tc.trim), frame, [sx * w * 0.17, 0.04 - h * 0.2, dp * 0.42 + 0.034], [0.12, 0, 0], flat);
      mesh(profile('as-sskirt' + K, 0.03, [[-dp * 0.3, 0], [dp * 0.3, 0], [dp * 0.26, -h * 0.4], ['q', 0, -h * 0.46, -dp * 0.22, -h * 0.4]], 0.006), toon(tc.main), frame, [sx * w * 0.4, 0.04, 0], [0, 0, sx * -0.12]);
    }
  } else if (style === 'armored') {
    // after the Dreadnought: a hull with its corners cut off, wider at the shoulders than the waist, an armoured
    // cowl across the top, bulkheads down each side and, on the front, the tall sarcophagus: an arched plate set in
    // a brass frame with a dark inset down its middle
    const K = [w, h, dp].map(v => v.toFixed(3)).join();
    mesh(slab('ar-hull' + K, dp, [[-w * 0.42, h * 0.5], [w * 0.42, h * 0.5], [w * 0.5, h * 0.4], [w * 0.5, -h * 0.1], [w * 0.4, -h * 0.5], [-w * 0.4, -h * 0.5], [-w * 0.5, -h * 0.1], [-w * 0.5, h * 0.4]], 0.014), toon(tc.main), frame, [0, cy, 0]);
    // the pelvis, after the Dreadnought: a ribbed waist joint under the hull, a chamfered pelvis block over the hip
    // joints, and two armoured tassets hanging over the front of the thighs, trimmed in brass
    mesh(turned('ar-joint' + K, [[0.0, 0.03], [w * 0.22, 0.03], [w * 0.25, 0.045], [w * 0.22, 0.06], [w * 0.25, 0.075], [w * 0.22, 0.09], [0.0, 0.09]], 24), toon(tc.dark), frame, null, [-Math.PI / 2, 0, 0]);
    mesh(slab('ar-pelvis' + K, dp * 0.72, [[-w * 0.3, 0.05], [w * 0.3, 0.05], [w * 0.36, 0.01], [w * 0.33, -0.04], [-w * 0.33, -0.04], [-w * 0.36, 0.01]], 0.012), toon(tc.second), frame);
    if (thighs) for (const sx of [-1, 1]) {
      const ts = new T.Group(); ts.position.set(sx * w * 0.19, 0.04, dp * 0.36); ts.rotation.x = 0.14; frame.add(ts);
      mesh(slab('ar-tasset' + K, 0.03, [[-w * 0.15, 0.0], [w * 0.15, 0.0], [w * 0.15, -h * 0.34], [w * 0.1, -h * 0.42], [-w * 0.1, -h * 0.42], [-w * 0.15, -h * 0.34]], 0.008), toon(tc.main), ts);
      mesh(slab('ar-tstrip' + K, 0.034, [[-w * 0.15, -h * 0.34], [w * 0.15, -h * 0.34], [w * 0.1, -h * 0.42], [-w * 0.1, -h * 0.42]], 0.004), toon(tc.accent), ts);
      rivets(ts, toon(tc.dark), [[-w * 0.09, -h * 0.08, 0.018], [w * 0.09, -h * 0.08, 0.018]]);
    }
    mesh(slab('ar-cowl' + K, dp * 1.06, [[-w * 0.36, h * 0.58], [w * 0.36, h * 0.58], [w * 0.44, h * 0.46], [-w * 0.44, h * 0.46]], 0.012), toon(tc.second), frame, [0, cy, 0]);
    for (const sx of [-1, 1]) mesh(profile('ar-bulk' + K, w * 0.09, [[-dp * 0.45, h * 0.4], [dp * 0.4, h * 0.4], [dp * 0.52, h * 0.28], [dp * 0.52, -h * 0.28], [dp * 0.4, -h * 0.42], [-dp * 0.45, -h * 0.42]], 0.01), toon(tc.second), frame, [sx * w * 0.5, cy, 0]);
    const sar = k => [[-w * 0.2 * k, h * 0.28 * k], ['q', -w * 0.2 * k, h * 0.46 * k, 0, h * 0.48 * k], ['q', w * 0.2 * k, h * 0.46 * k, w * 0.2 * k, h * 0.28 * k], [w * 0.2 * k, -h * 0.3 * k], [0, -h * 0.46 * k], [-w * 0.2 * k, -h * 0.3 * k]];
    mesh(slab('ar-sarf' + K, 0.03, sar(1.0), 0.008), toon(tc.accent), frame, [0, cy, dp * 0.5 + 0.008]);
    mesh(slab('ar-sarp' + K, 0.03, sar(0.84), 0.008), toon(tc.second), frame, [0, cy, dp * 0.5 + 0.02]);
    mesh(slab('ar-sari' + K, 0.02, [[-w * 0.07, h * 0.3], [w * 0.07, h * 0.3], [w * 0.07, -h * 0.24], [0, -h * 0.3], [-w * 0.07, -h * 0.24]], 0.004), toon(tc.dark), frame, [0, cy, dp * 0.5 + 0.034]);
    mesh(box(w * 0.1, 0.012, 0.01), glow(tc.eye), frame, [0, cy + h * 0.24, dp * 0.5 + 0.046], null, flat);
    // small: hazard stripes, rivets, unit number plate
    for (let i = 0; i < 4; i++) mesh(box(w * 0.06, h * 0.08, 0.012), toon(i % 2 ? tc.dark : tc.accent), frame, [-w * 0.39 + i * w * 0.06, cy - h * 0.3, dp * 0.5], [0, 0, 0.6], flat);
    rivets(frame, toon(tc.dark), [[-w * 0.32, cy + h * 0.32, dp * 0.5], [w * 0.32, cy + h * 0.32, dp * 0.5], [-w * 0.32, cy - h * 0.02, dp * 0.5], [w * 0.32, cy - h * 0.02, dp * 0.5]]);
    mesh(box(w * 0.14, h * 0.1, 0.012), toon(tc.trim), frame, [w * 0.32, cy - h * 0.3, dp * 0.5], null, flat);
  } else {
    // after the Zaku II: a rounded hull that bulges at the chest, a chest plate in the second colour, a high collar
    // the head sits down inside, power pipes curving from the collar round to the chest sides, a turned dark waist
    // and a flared skirt
    const K = [w, h, dp].map(v => v.toFixed(3)).join();
    mesh(slab('ex-hull' + K, dp, [[-w * 0.3, h * 0.5], [w * 0.3, h * 0.5], ['q', w * 0.5, h * 0.48, w * 0.5, h * 0.15], ['q', w * 0.48, -h * 0.3, w * 0.3, -h * 0.42], [-w * 0.3, -h * 0.42], ['q', -w * 0.48, -h * 0.3, -w * 0.5, h * 0.15], ['q', -w * 0.5, h * 0.48, -w * 0.3, h * 0.5]], 0.014), toon(tc.main), frame, [0, cy, 0]);
    mesh(slab('ex-plate' + K, 0.03, [[-w * 0.3, h * 0.36], [w * 0.3, h * 0.36], ['q', w * 0.42, h * 0.16, w * 0.28, -h * 0.22], [-w * 0.28, -h * 0.22], ['q', -w * 0.42, h * 0.16, -w * 0.3, h * 0.36]], 0.008), toon(tc.second), frame, [0, cy, dp * 0.5 + 0.004]);
    mesh(turned('ex-collar' + K, [[w * 0.18, 0.0], [w * 0.34, 0.0], [w * 0.38, h * 0.14], [w * 0.33, h * 0.3], [w * 0.24, h * 0.3]], 36), toon(tc.second), frame, [0, cy + h * 0.44, 0], [-Math.PI / 2, 0, 0]).userData.noRest = true;
    for (const sx of [-1, 1]) {
      const pipe = [[sx * w * 0.16, cy + h * 0.6, dp * 0.3], [sx * w * 0.34, cy + h * 0.46, dp * 0.66], [sx * w * 0.47, cy + h * 0.14, dp * 0.54], [sx * w * 0.5, cy - h * 0.12, dp * 0.2]];
      mesh(tube('ex-pipe' + K + sx, pipe, 0.016, 32), toon(tc.dark), frame).userData.noRest = true;
      // ribbed like a hose: rings along the pipe
      const cv = new T.CatmullRomCurve3(pipe.map(q => new T.Vector3(q[0], q[1], q[2])));
      for (let i = 1; i < 8; i++) { const t = i / 8, pt = cv.getPoint(t), tg = cv.getTangent(t); const r = mesh(tor(0.018, 0.004), toon(tc.metal), frame, [pt.x, pt.y, pt.z], null, flat); r.userData.noRest = true; r.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), tg); }
    }
    mesh(turned('ex-waist' + K, [[0.0, 0.0], [w * 0.26, 0.0], [w * 0.3, h * 0.05], [w * 0.3, h * 0.2], [w * 0.24, h * 0.25], [0.0, h * 0.25]], 32), toon(tc.dark), frame, [0, 0.03, 0], [-Math.PI / 2, 0, 0]);
    if (thighs) mesh(slab('ex-skirt' + K, 0.03, [[-w * 0.3, 0], [w * 0.3, 0], [w * 0.38, -h * 0.34], ['q', 0, -h * 0.42, -w * 0.38, -h * 0.34]], 0.006), toon(tc.main), frame, [0, 0.07, dp * 0.4], [0.16, 0, 0]);
    if (thighs) for (const sx of [-1, 1]) mesh(profile('ex-sskirt' + K, 0.03, [[-dp * 0.3, 0], [dp * 0.3, 0], [dp * 0.34, -h * 0.36], ['q', 0, -h * 0.42, -dp * 0.3, -h * 0.36]], 0.006), toon(tc.main), frame, [sx * w * 0.42, 0.07, 0], [0, 0, sx * -0.16]);
    for (const sx of [-1, 1]) mesh(sph(0.009, 8), glow(tc.glow), frame, [sx * w * 0.12, cy - h * 0.14, dp * 0.5 + 0.022], null, flat);
  }
  if (fid === 't_skirm' || fid === 't_light') mesh(box(w * 0.5, 0.012, dp * 0.4), toon(tc.trim), frame, [0, cy + h * 0.52, 0], null, flat);
  if (fid === 's_frame') mesh(cyl(0.05, 0.05, 0.02, 6), toon(tc.trim), frame, [0, cy - h * 0.05, dp * 0.68], [Math.PI / 2, 0, 0]);
  if (fid === 't_proto') mesh(box(0.016, h * 0.9, 0.01), glow(tc.glow), frame, [0, cy, -dp * 0.52], null, flat);
}

// what makes each chassis recognisable at a glance, drawn in its doctrine's shape language
const HEAD_TYPE = { t_skirm: 'visor', t_light: 'mast', t_assault: 'horns', t_heavy: 'sunk', t_fortress: 'none', c_sing: 'small', s_core: 'crystal', s_frame: 'crest' };
// a panel shaped the doctrine's way: angular for Assault, a slab for Armored, rounded for Experimental
function sigPlate(style, w, h, d, mat, parent, pos, rot) {
  if (style === 'assault') return mesh(wedge(w, h, d, 0.6, 1), mat, parent, pos, rot);
  if (style === 'armored') return mesh(box(w, h, d), mat, parent, pos, rot);
  const m = mesh(sph(0.5, 12), mat, parent, pos, rot); m.scale.set(w, h, d); return m;
}
function buildSignature(frame, tc, style, fid, w, h, dp, cy, R) {
  const M = c => toon(c), G = tc.glow || tc.eye;
  if (fid === 't_skirm') {
    // a long dorsal spine fin and twin tail stabilisers: built for speed
    sigPlate(style, 0.026, h * 1.5, dp * 1.2, M(tc.second), frame, [0, cy + h * 0.45, -dp * 0.5], [-0.55, 0, 0]);
    for (const sx of [-1, 1]) sigPlate(style, 0.02, h * 0.9, dp * 0.7, M(tc.trim), frame, [sx * w * 0.32, cy - h * 0.05, -dp * 0.65], [-0.95, 0, sx * 0.45]);
  } else if (fid === 't_light') {
    // a big sensor dish on the left shoulder and a whip antenna on the right
    const dish = new T.Group(); dish.position.set(-w * 0.42, cy + h * 0.85, -dp * 0.15); dish.rotation.set(-0.45, 0.55, 0); frame.add(dish);
    mesh(cyl(0.012, 0.012, h * 0.7, 6), M(tc.dark), dish, [0, -h * 0.35, 0]);
    if (style === 'armored') { mesh(box(0.2, 0.15, 0.025), M(tc.second), dish); for (let i = 0; i < 3; i++) mesh(box(0.18, 0.006, 0.006), M(tc.accent), dish, [0, -0.05 + i * 0.05, 0.016], null, flat); }
    else if (style === 'assault') mesh(cone(0.11, 0.06, 6), M(tc.second), dish, null, [Math.PI / 2, 0, 0]);
    else mesh(sph(0.1, 14), M(tc.second), dish).scale.set(1, 1, 0.3);
    mesh(sph(0.018, 6), glow(tc.eye), dish, [0, 0, 0.035], null, flat);
    mesh(cyl(0.005, 0.005, h * 1.5, 5), M(INK), frame, [w * 0.32, cy + h * 1.1, -dp * 0.3], [0, 0, -0.18], flat);
  } else if (fid === 't_heavy') {
    // a thick armoured collar the head sinks into, and a sloped front glacis
    sigPlate(style, w * 1.1, h * 0.26, dp * 1.12, M(tc.second), frame, [0, cy + h * 0.5, 0]);
    for (const sx of [-1, 1]) sigPlate(style, w * 0.16, h * 0.42, dp * 0.9, M(tc.main), frame, [sx * w * 0.38, cy + h * 0.72, -dp * 0.05]);
  } else if (fid === 't_fortress') {
    // no head: a cockpit slit in a raised roof, a bulwark apron over the hips, twin smokestacks
    sigPlate(style, w * 1.02, h * 0.45, dp * 1.02, M(tc.main), frame, [0, cy + h * 0.68, 0]);
    mesh(box(w * 0.55, 0.028, 0.02), glow(tc.eye), frame, [0, cy + h * 0.66, dp * 0.52], null, flat);
    for (const sx of [-1, 1]) sigPlate(style, w * 0.5, h * 0.62, dp * 0.2, M(tc.second), frame, [sx * w * 0.28, cy - h * 0.42, dp * 0.66], [-0.12, sx * 0.18, 0]);
    for (const sx of [-1, 1]) { mesh(cyl(0.032, 0.038, h * 1.1, 8), M(tc.dark), frame, [sx * w * 0.24, cy + h * 0.95, -dp * 0.42]); mesh(cyl(0.04, 0.04, 0.02, 8), M(INK), frame, [sx * w * 0.24, cy + h * 1.5, -dp * 0.42], null, flat); }
  } else if (fid === 't_proto') {
    // an open chest with the reactor tube on show, and twin energy fins
    mesh(cyl(0.042, 0.042, h * 0.95, 10), glow(G, 0.85), frame, [0, cy, dp * 0.55], null, flat);
    for (const sx of [-1, 1]) mesh(box(0.016, h, 0.016), M(tc.dark), frame, [sx * 0.055, cy, dp * 0.6], null, flat);
    for (const sx of [-1, 1]) sigPlate(style, 0.022, h * 0.9, dp * 0.9, M(tc.second), frame, [sx * w * 0.36, cy + h * 0.7, -dp * 0.62], [-1.0, 0, sx * -0.55]);
  } else if (fid === 's_frame') {
    // floating shield plates held above the shoulders
    R.floaters = [];
    for (const sx of [-1, 1]) {
      const g = new T.Group(); g.position.set(sx * w * 0.78, cy + h * 0.85, 0); frame.add(g); R.floaters.push(g);
      if (style === 'armored') mesh(box(0.03, 0.2, 0.2), M(tc.second), g); else mesh(cyl(0.12, 0.12, 0.024, 6), M(tc.second), g, null, [0, 0, Math.PI / 2]);
      mesh(tor(0.1, 0.007), glow(G), g, null, [0, Math.PI / 2, 0], flat);
    }
  } else if (fid === 'c_sing') {
    // a gyro ring round the chest about a dark singularity
    const ring = new T.Group(); ring.position.set(0, cy, 0); frame.add(ring); R.gyro = ring;
    mesh(tor(w * 0.82, 0.02), M(tc.second), ring);
    mesh(tor(w * 0.82, 0.008), glow(G), ring, null, [Math.PI / 2, 0, 0], flat);
    mesh(sph(0.065, 12), toon(0x0b0d12), frame, [0, cy, dp * 0.55]);
    mesh(tor(0.075, 0.008), glow(G), frame, [0, cy, dp * 0.57], null, flat);
  } else if (fid === 's_core') {
    // crystal growths on the shoulders and back
    for (const [x, y, z, rr] of [[-w * 0.42, h * 0.78, -dp * 0.2, 0.06], [w * 0.42, h * 0.85, -dp * 0.25, 0.07], [0, h * 1.0, -dp * 0.45, 0.085], [w * 0.15, h * 0.65, -dp * 0.55, 0.05], [-w * 0.18, h * 0.6, -dp * 0.55, 0.045]]) {
      const c = mesh(oct(rr), glow(G, 0.9), frame, [x, cy + y, z]); c.scale.y = 1.9;
    }
  }
}
// the head, shaped by the chassis
function shapeHead(hd, tc, style, type, h) {
  const G = tc.glow || tc.eye;
  if (type === 'sunk') hd.scale.setScalar(0.9);
  else if (type === 'visor') { hd.scale.setScalar(0.78); mesh(box(0.16, 0.018, 0.02), glow(tc.eye), hd, [0, 0.05, 0.075], null, flat); mesh(box(0.012, 0.012, 0.14), toon(tc.trim), hd, [0, 0.09, -0.02], [0.3, 0, 0], flat); }
  else if (type === 'mast') { hd.scale.setScalar(0.85); mesh(cyl(0.008, 0.008, 0.16, 5), toon(INK), hd, [-0.03, 0.15, -0.02], null, flat); mesh(sph(0.016, 6), glow(tc.eye), hd, [-0.03, 0.235, -0.02], null, flat); }
  else if (type === 'horns') { for (const sx of [-1, 1]) mesh(cone(0.018, 0.14, 5), toon(tc.trim), hd, [sx * 0.06, 0.12, 0.0], [0.25, 0, sx * -0.55]); }
  else if (type === 'small') hd.scale.setScalar(0.62);
  else if (type === 'crest') mesh(style === 'assault' ? wedge(0.016, 0.12, 0.12, 0.3, 0.6) : box(0.016, 0.1, 0.12), toon(tc.second), hd, [0, 0.13, -0.01]);
  else if (type === 'crystal') { while (hd.children.length) hd.remove(hd.children[0]); const c = mesh(oct(0.06), glow(G, 0.9), hd, [0, 0.07, 0]); c.scale.y = 1.6; mesh(sph(0.014, 6), glow(tc.eye), hd, [0, 0.07, 0.05], null, flat); return null; }
  return undefined;
}

function buildPack(bp, tc, style, w, h, R) {
  R.thrusters = [];
  const thr = (x, y, z) => {
    mesh(cone(0.028, 0.065, 8), toon(INK), bp, [x, y, z], [Math.PI, 0, 0]);
    const f = new T.Mesh(cone(0.021, 0.11, 8), glow(tc.thruster, 0.75)); f.position.set(x, y - 0.075, z); f.rotation.x = Math.PI; f.visible = false; bp.add(f); R.thrusters.push(f);
  };
  if (style === 'assault') {
    // twin booster pods angled up and out over the shoulders, each with a dark nozzle mouth and a glowing
    // exhaust inside, a side stripe and vents, joined by a spine block; thrusters underneath
    mesh(wedge(w * 0.42, h * 0.75, 0.08, 1.1, 1), toon(tc.accent), bp, [0, 0, -0.01]);
    for (const sx of [-1, 1]) {
      // flat against the back and low: the top of each pod stays under the shoulder line, below the head
      const pod = new T.Group(); pod.position.set(sx * w * 0.24, -h * 0.45, -0.02); pod.rotation.set(-0.12, 0, sx * -0.18); bp.add(pod);
      const L2 = h * 1.0, P = 0.13;
      mesh(box(P, L2, P * 0.45), toon(tc.main), pod, [0, L2 * 0.35, 0]);
      mesh(box(P * 1.04, L2 * 0.5, P * 0.25), toon(tc.second), pod, [0, L2 * 0.3, -P * 0.12], null, flat);
      mesh(box(P * 0.82, 0.03, P * 0.36), toon(INK), pod, [0, L2 * 0.85 + 0.002, 0], null, flat);
      mesh(box(P * 0.6, 0.012, P * 0.24), glow(tc.thruster, 0.9), pod, [0, L2 * 0.85 + 0.004, 0], null, flat);
      mesh(box(P * 1.06, 0.03, P * 0.5), toon(tc.dark), pod, [0, L2 * 0.82, 0]);
      vents(pod, toon(tc.dark), 4, P * 0.6, 0.022, [0, L2 * 0.42, -P * 0.23], [0, Math.PI, 0]);
      mesh(box(0.012, L2 * 0.6, 0.012), toon(tc.trim), pod, [sx * P * 0.51, L2 * 0.38, -P * 0.1], null, flat);
      mesh(box(P * 0.9, 0.05, P * 0.4), toon(tc.dark), pod, [0, -L2 * 0.15, 0]);
      mesh(box(P * 0.7, 0.01, P * 0.28), glow(tc.thruster, 0.8), pod, [0, -L2 * 0.18, 0], null, flat);
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
  const [w0, h0, dp] = FRAME_DIM[fid] || FRAME_DIM.b_torso;
  const h = h0 * (style === 'armored' ? 1.2 : 1);   // armoured hulls stand tall, like a dreadnought sarcophagus
  const w = w0 * (style === 'armored' ? 1.1 : style === 'experimental' ? 0.95 : 1);
  const k = (fid === 't_fortress' ? 1.3 : fid === 't_heavy' || fid === 's_frame' ? 1.15 : fid === 't_light' || fid === 't_skirm' ? 0.86 : 1) * (style === 'armored' ? 1.15 : 1);
  const cy = 0.08 + h / 2;
  const frame = new T.Group(); torso.add(frame);
  if (!S.torso) {
    if (opt.ghosts) { mesh(box(w, h + 0.08, dp), GHOST, frame, [0, cy, 0], null, flat); mesh(box(0.1, 0.09, 0.1), GHOST, frame, [0, 0.08 + h + 0.05, 0], null, flat); tag(frame, 'torso'); }
  } else {
    buildChest(frame, tc, style, fid, w, h, dp, cy, R.kind);
    const before = new Set(frame.children);
    buildSignature(frame, tc, style, fid, w, h, dp, cy, R);
    // fins, dishes, stacks and the like stand behind or beside the head: only the heavy collar is somewhere it rests
    if (fid !== 't_heavy') frame.children.forEach(c => { if (!before.has(c)) c.traverse(o => { o.userData.noRest = true; }); });
    const htype = HEAD_TYPE[fid];
    if (htype !== 'none') {
      const hz = style === 'armored' ? 0.02 : 0, boxes = frameBoxes(frame);
      const hd = new T.Group(); hd.position.set(0, restTop(boxes, -0.06, 0.06, hz - 0.06, hz + 0.07, 0.08 + h) + 0.004, hz); frame.add(hd); R.head = hd;
      let eye = buildHead(hd, tc, style);
      if (shapeHead(hd, tc, style, htype, h) === null) eye = null;
      if (eye) R.monoEye = eye;
    }
    tag(frame, 'torso');
    if (isHurt(S.torso)) R.sparks.push(frame);
  }
  // core, set into the chest behind a ring
  if (S.core || opt.ghosts) {
    const cg = new T.Group(); cg.position.set(0, cy, dp / 2 + (style === 'assault' ? 0.046 : style === 'armored' ? 0.058 : 0.036)); torso.add(cg);
    if (S.core) {
      mesh(tor(0.034, 0.01), toon(tc.dark), cg, null, null, flat);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; mesh(box(0.012, 0.012, 0.012), toon(tc.trim), cg, [Math.cos(a) * 0.044, Math.sin(a) * 0.044, 0], null, flat); }
      R.core = mesh(sph(0.025, 10), glow(isKO(S.core) ? 0x333a42 : (CORE_GLOW[S.core.id] || CORE_GLOW[S.core.id.replace(/^r_/, '')] || CORE_GLOW.b_core)), cg, null, null, flat);
      R.coreLive = !isKO(S.core);
    } else mesh(sph(0.03, 10), GHOST, cg, null, null, flat);
    tag(cg, 'core');
  }
  if (!S.core && S.torso) {
    const ag = new T.Group(); ag.position.set(0, cy, dp / 2 + (style === 'assault' ? 0.048 : style === 'armored' ? 0.06 : 0.038)); torso.add(ag);
    mesh(new T.CircleGeometry(0.04, 18), glow(0x07090c), ag, null, null, flat);
    R.coreAlarm = mesh(tor(0.05, 0.008), glow(0xff3b30, 0.9), ag, null, null, flat);
  }
  // arms: upper arm, elbow, forearm with a plate, and the weapon in hand (or on the shoulder)
  root.updateMatrixWorld(true);
  const sideBoxes = S.torso ? frameBoxes(frame) : [];
  for (const [key, sx] of [['armL', -1], ['armR', 1]]) {
    const armHalf = style === 'armored' ? 0.066 : style === 'experimental' ? 0.042 : 0.044;
    const bodyX = S.torso ? sideExtent(sideBoxes, cy - h * 0.5, cy + h * 0.32, w / 2) : w / 2;
    const shX = Math.max(w / 2 + 0.055, bodyX + armHalf + 0.012);
    const sh = new T.Group(); sh.position.set(sx * shX, cy + h * 0.3, 0); torso.add(sh);
    const inst = S[key];
    const sk = fid === 't_skirm' ? k * 0.6 : k;
    if (S.torso) shoulderSocket(sh, sx, tc, sk, shX - bodyX);
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
    armShoulder(sh, sx, tc, style, inst.id, sk);
    const ak = style === 'armored' ? 1.45 : style === 'experimental' ? 0.85 : 1;
    const arm = new T.Group(); sh.add(arm);
    if (style === 'assault') mesh(profile('as-uarm', 0.064, [[-0.034, 0.0], [0.034, 0.0], ['q', 0.04, -0.075, 0.034, -0.15], [-0.034, -0.15], ['q', -0.04, -0.075, -0.034, 0.0]], 0.012), toon(tc.main), arm);
    else mesh(wedge(0.065 * ak, 0.15, 0.075 * ak, 1.15, 1.1), toon(style === 'experimental' ? tc.second : tc.main), arm, [0, -0.075, 0]);
    mesh(cyl(0.007, 0.007, 0.12, 5), toon(tc.metal), arm, [sx * 0.035 * ak, -0.08, -0.02], null, flat);
    // Assault stands at ease: arms hang a little out from the body, elbows slightly bent, guns held low. Only a gun
    // in the hand on walking legs, though: a weapon built onto the forearm, or a hull riding low on tracks, a hover
    // skirt or a quad hub, would carry it down into the legs, so those hold the forearm up like everyone else
    const atEase = style === 'assault' && HANDHELD.has(inst.id) && cat !== 'melee' && R.kind === 'biped';
    const rest = atEase ? -0.85 : -Math.PI / 2;
    if (style === 'assault') arm.rotation.z = sx * 0.14;
    const el = new T.Group(); el.position.y = -0.15; el.rotation.x = rest; arm.add(el);
    mesh(sph(0.036 * ak, 8), toon(tc.dark), el, [0, 0, 0]);
    if (style === 'assault') mesh(profile('as-farm', 0.082, [[-0.038, -0.01], [0.036, -0.01], ['q', 0.054, -0.07, 0.05, -0.14], [-0.046, -0.145], ['q', -0.054, -0.07, -0.038, -0.01]], 0.012), toon(tc.main), el);
    else mesh(wedge(0.08 * ak, 0.14, 0.09 * ak, 1.2, 1.15), toon(style === 'armored' ? tc.second : tc.main), el, [0, -0.075, 0]);
    mesh(wedge(0.07 * ak, 0.09, 0.022, 1.1, 1), toon(style === 'assault' ? tc.second : style === 'armored' ? tc.accent : tc.accent), el, [sx * 0.0, -0.07, 0.048 * ak]);
    mesh(box(0.05 * ak, 0.04, 0.05 * ak), toon(tc.dark), el, [0, -0.152, 0]);
    if (style === 'experimental') mesh(box(0.006, 0.1, 0.006), glow(tc.glow), el, [sx * 0.04, -0.07, 0.02], null, flat);
    const hand = new T.Group(); hand.position.y = -0.165; hand.rotation.x = Math.PI / 2; el.add(hand);
    const onShoulder = cat === 'missile' || cat === 'artillery' || inst.id === 's_railgun';
    let wg = hand;
    if (onShoulder) { wg = new T.Group(); wg.position.set(sx * 0.01, 0.09, -0.02); sh.add(wg); }
    else if (HANDHELD.has(inst.id)) {
      // a fist closed round the grip: guns ride above it, barrel forward; a blade is held by its hilt and raised
      const fm = style === 'armored' ? tc.second : tc.dark;
      mesh(box(0.05, 0.05, 0.055), toon(fm), hand, [0, 0, 0.02]);
      mesh(box(0.054, 0.018, 0.026), toon(tc.metal), hand, [0, 0.022, 0.044]);
      mesh(box(0.016, 0.03, 0.032), toon(fm), hand, [sx * 0.031, 0.006, 0.028]);
      wg = new T.Group(); hand.add(wg);
      if (cat === 'melee') { wg.position.set(0, 0.0, -0.005); wg.rotation.x = -0.55; }
      else { wg.position.set(0, 0.048, -0.05); mesh(box(0.024, 0.06, 0.03), toon(KIT.body), wg, [0, -0.04, 0.072], [0.3, 0, 0]); }
    }
    R.muzzles[key] = { o: buildWeapon(wg, inst.id, tc, sx), id: inst.id, cat: cat || 'ballistic', spin: wg.userData.spin || null };
    wg.userData.weapon = true;
    R.arms[key] = { sh, arm, el, rest };
    tag(sh, key);
    if (isHurt(inst)) R.sparks.push(sh);
  }
  // backpack and aux systems
  const bp = new T.Group(); bp.position.set(0, cy + h * 0.1, -dp / 2 - 0.02); torso.add(bp);
  if (S.torso) {
    buildPack(bp, tc, style, w, h, R);
    const n = S.torso ? (Dd[S.torso.id].auxSlots || 0) : 0;
    // aux modules bolt onto the outside of the backpack, measured from its rear face, never inside the hull
    root.updateMatrixWorld(true);
    const pb = new T.Box3().setFromObject(bp).applyMatrix4(new T.Matrix4().copy(bp.matrixWorld).invert());
    const back = Math.min(-0.04, pb.min.z) - 0.034;
    const spots = [[-w * 0.3, h * 0.45, back], [w * 0.3, h * 0.45, back], [0, -h * 0.3, back]];
    for (let i = 0; i < n; i++) {
      const a = S.aux[i];
      if (a) { const ag = buildAux(bp, a.id, spots[i], tc); ag.scale.setScalar(1.5); tag(ag, 'aux' + i); }
      else if (opt.ghosts) { const gg = new T.Group(); gg.position.set(spots[i][0], spots[i][1], spots[i][2]); bp.add(gg); mesh(box(0.06, 0.06, 0.05), GHOST, gg, null, null, flat); tag(gg, 'aux' + i); }
    }
  }
  // legs in proportion to the body they carry, the way each army builds them:
  // Assault stands like a person (legs a little longer than torso and head), Armored sits on a base wider than its hull,
  // Experimental keeps its drive a touch narrower than the body
  if ((S.legs || opt.ghosts) && S.torso) {
    root.updateMatrixWorld(true);
    const ls = new T.Vector3(), fs2 = new T.Vector3();
    new T.Box3().setFromObject(legsG).getSize(ls); new T.Box3().setFromObject(frame).getSize(fs2);
    // every chassis stands on the same legs, in proportion: the doctrine sizes its legs for the reference frame (the
    // Assault Chassis), then they grow or shrink with the body's overall size, width and height together, so a broad
    // hull never ends up on stubby legs and a slim one never on stilts
    const [rw, rh] = FRAME_DIM.t_assault, refH = rh * (h / h0), refW = rw * (w / w0) * 1.05;
    const size = (w0 + h0) / (rw + rh);
    // splayed quad legs and the hover bell are far wider than the body by design, so they keep their own build
    let grow = R.kind === 'treads' ? (refW * 1.55) / Math.max(0.01, ls.x) : style === 'assault' ? ((0.08 + refH + 0.1) * 1.15) / R.hipY : R.kind === 'quad' || R.kind === 'hover' ? 1 : style === 'armored' ? (refW * 1.1) / Math.max(0.01, ls.x) : (refW * 0.95 * 1.25) / Math.max(0.01, ls.x);
    grow = Math.min(1.8, Math.max(0.55, grow * size));
    // humanoid legs get longer, not much thicker: slim under a broad chest
    if (style === 'assault' && R.kind !== 'treads') legsG.scale.set(0.82 + (grow - 1) * 0.3, grow, 0.82 + (grow - 1) * 0.3); else legsG.scale.setScalar(grow);
    R.hipY *= grow; hips.position.y = R.hipY;
  }
  R.legsG = legsG;
  // the whole machine fits inside one tile on the map: body and legs shrink together if it would not
  let scale = (fid === 't_fortress' ? 1.06 : 1) * (style === 'armored' ? 1.08 : style === 'assault' ? 0.96 : 1);
  root.updateMatrixWorld(true);
  const body = new T.Box3().setFromObject(legsG); if (S.torso) body.union(new T.Box3().setFromObject(frame));
  const bs = new T.Vector3(); body.getSize(bs);
  const foot = Math.max(bs.x, bs.z);
  if (foot > 0) scale = Math.min(scale, 0.8 / foot);
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
    if (o.isMesh && o.material.userData.paint) { const base = o.userData.mat0 || (o.userData.mat0 = o.material); o.material = k === key ? lit(base) : base; }
    else if (o.isMesh && (o.material === GHOST || o.material === GHOST_SEL)) o.material = k === key ? GHOST_SEL : GHOST;
  });
}

/* ================= battlefield ================= */
const ST = { hasBoard: false };
let BD = null;
function tp(x, y, h) { const W = window.MW.W, H = window.MW.H; return new T.Vector3(y - (H - 1) / 2, h || 0, (W - 1) / 2 - x); }
const key = (x, y) => x + ',' + y;

// the map is always seen from the three-quarter angle: mechs, cover and animations all read best from here
const EL_34 = 0.62;
const ISO_AZ = Math.PI / 4;
// swing to the isometric angle, 45 degrees off whichever way the board is turned
// on a tall screen (a phone held upright) the board is seen from behind your own base instead, still at a
// three-quarter angle, so its long side runs up the screen and it fills the width
const EL_TALL = 0.8, AZ_TALL = 0.14;
// judged on the whole canvas, so a panel opening over the map never swings the camera round
function tall() { return !!BD && BD.size.w / Math.max(1, BD.size.h) < 0.85; }
function iso(G) { const t = tall(); G.el = t ? EL_TALL : EL_34; G.az = BD.viewAz + (t ? AZ_TALL : ISO_AZ); }
R3.mount = function (el, onTap) {
  if (BD) {
    if (BD.el !== el) { if (BD.ro) { BD.ro.unobserve(BD.el); BD.ro.observe(el); } el.appendChild(BD.renderer.domElement); BD.el = el; BD.resize(); }
    BD.onTap = onTap; return;
  }
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.setClearColor(0x8e9a9f);
  el.appendChild(renderer.domElement);
  const scene = new T.Scene();
  scene.fog = new T.Fog(0x8e9a9f, 26, 60);
  const cam = new T.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  // a strong, fairly low key sun so everything throws a long, readable shadow; sky and fill stay dim so the shade
  // side keeps its depth, and the sky dome only adds reflections
  scene.environment = envFor(renderer);
  const hemi = new T.HemisphereLight(0xdfe3e0, 0x4f5250, 0.26); scene.add(hemi);
  const sun = new T.DirectionalLight(0xf2ead8, 1.75);
  sun.position.set(-8, 7.5, 6); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 3;
  const fill = new T.DirectionalLight(0xb9cde0, 0.14); fill.position.set(6, 5, -6); scene.add(fill);
  // a rim from low behind the board, so mecha and scenery keep a bright edge against the ground
  const rim = new T.DirectionalLight(0xdfeaff, 0.35); rim.position.set(4, 3.5, -9); scene.add(rim);
  // wide enough for the largest board's shadows at this lower sun angle
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
  sun.shadow.bias = -0.0015;
  scene.add(sun);
  const group = new T.Group(); scene.add(group);
  BD = { el, renderer, scene, cam, group, sun, hemi, onTap, recs: {}, tiles: {}, ov: {}, props: {}, labels: [], queue: [], anims: [], shake: 0, flip: false, crates: {}, wrecks: {}, objs: {}, sel: null, active: null,
    rig: { az: ISO_AZ, el: EL_34, zoom: 1, tx: 0, tz: 0 }, rigT: { az: ISO_AZ, el: EL_34, zoom: 1, tx: 0, tz: 0 }, viewAz: 0, userT: -9, intent: null, focusTok: 0, size: { w: 1, h: 1 }, pad: { t: 0, r: 0, b: 0, l: 0 } };
  BD.parts = new Particles(group, 900);
  const resize = () => { const e = BD.el, w = e.clientWidth || 1, h = e.clientHeight || 1; renderer.setSize(w, h, false); BD.size = { w, h }; };
  BD.resize = resize;
  if (window.ResizeObserver) { BD.ro = new ResizeObserver(resize); BD.ro.observe(el); } else window.addEventListener('resize', resize);
  resize();
  bindCameraInput(renderer.domElement);
  applyLevel();
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
  const P = BD.pad, a = Math.max(1, BD.size.w - P.l - P.r) / Math.max(1, BD.size.h - P.t - P.b);
  let hw = mx * 1.02, hh = my * 1.02;
  if (hw / hh > a) hh = hw / a; else hw = hh * a;
  return { hw, hh };
}
// the camera rides along with a mech that is walking or jumping, then eases into the view the game asked for
function follow() {
  const F = BD.follow, rec = BD.recs[F.uid];
  if (rec && rec.walk) {
    F.seen = true;
    if (clock() >= rec.walk.t0) { const w = BD.group.localToWorld(rec.R.root.position.clone()); BD.rigT.tx = w.x; BD.rigT.tz = w.z; }
  } else if (F.seen || !rec || clock() - F.t0 > 4) { BD.follow = null; applyIntent(); }
}
function camUpdate(dt) {
  if (BD.follow) follow();
  const C = BD.rig, G = BD.rigT, k = 1 - Math.exp(-dt * (BD.camRate || 6)), cam = BD.cam;
  let da = G.az - C.az; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
  C.az += da * k; C.el += (G.el - C.el) * k; C.zoom += (G.zoom - C.zoom) * k; C.tx += (G.tx - C.tx) * k; C.tz += (G.tz - C.tz) * k;
  if (BD.padT) for (const s of ['t', 'r', 'b', 'l']) BD.pad[s] += (BD.padT[s] - BD.pad[s]) * k;
  // turning the screen between tall and wide swaps the battle camera's angle
  const tl = tall();
  if (BD.tall !== tl) { if (BD.tall !== undefined && !BD.previewMap) { iso(G); keepOnBoard(G); } BD.tall = tl; }
  const P = new T.Vector3(C.tx, 0, C.tz);
  const dir = new T.Vector3(Math.sin(C.az) * Math.cos(C.el), Math.sin(C.el), Math.cos(C.az) * Math.cos(C.el));
  cam.position.copy(P).addScaledVector(dir, 30);
  if (BD.shake > 0.002) { cam.position.add(new T.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(BD.shake)); BD.shake *= 0.86; }
  cam.up.set(0, 1, 0);
  cam.lookAt(P);
  // the board is framed in the part of the canvas the HUD leaves clear; the view still runs under the HUD to the edges
  const e = baseExtent(C.az, C.el), Z = BD.size, Q = BD.pad;
  const iw = Math.max(1, Z.w - Q.l - Q.r), ih = Math.max(1, Z.h - Q.t - Q.b);
  const fw = e.hw / C.zoom * Z.w / iw, fh = e.hh / C.zoom * Z.h / ih;
  cam.left = -(Q.l + iw / 2) * 2 * fw / Z.w; cam.right = cam.left + 2 * fw;
  cam.top = (Q.t + ih / 2) * 2 * fh / Z.h; cam.bottom = cam.top - 2 * fh; cam.zoom = 1;
  cam.updateProjectionMatrix();
}
// where a tile sits in the world, after the board is turned for the guest
function worldTile(x, y) { BD.group.updateMatrixWorld(); return tp(x, y).applyMatrix4(BD.group.matrixWorld); }
// frame a set of tiles: centre on them and zoom until they fit, within limits
function focusTiles(list, zMin, zMax, hop) {
  if (!list.length) return;
  const G = BD.rigT, pts = list.map(([x, y]) => worldTile(x, y));
  // measure the tiles along the screen's axes for the angle the camera is heading to
  const right = new T.Vector3(Math.cos(G.az), 0, -Math.sin(G.az)), fwd = new T.Vector3(-Math.sin(G.az), 0, -Math.cos(G.az));
  let r0 = Infinity, r1 = -Infinity, f0 = Infinity, f1 = -Infinity;
  for (const p of pts) { const a = p.dot(right), b = p.dot(fwd); r0 = Math.min(r0, a); r1 = Math.max(r1, a); f0 = Math.min(f0, b); f1 = Math.max(f1, b); }
  const cr = (r0 + r1) / 2, cf = (f0 + f1) / 2;
  G.tx = right.x * cr + fwd.x * cf; G.tz = right.z * cr + fwd.z * cf;
  const e = baseExtent(G.az, G.el), sinE = Math.max(0.5, Math.sin(G.el));
  // a jump rises above the tiles: the view must be tall enough to keep its top in frame
  const needW = (r1 - r0) / 2 + 0.75, needH = ((f1 - f0) / 2 + 0.75) * sinE + 0.35 + (hop || 0) * Math.cos(G.el);
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
function overview() { Object.assign(BD.rigT, { tx: 0, tz: 0, zoom: 1 }); iso(BD.rigT); }
// what the camera should rest on: deployment at your base, the selected mech, or the whole map
function applyIntent() {
  const c = BD.intentSpec || {};
  if (c.aim != null) {
    // aiming at a mech: close in on it, at the three-quarter angle, so its parts can be picked one by one, with the
    // middle of its body (not the tile it stands on) in the centre of the clear part of the screen
    const G = BD.rigT;
    iso(G);
    focusTiles([[c.x, c.y]], 2.9, 3.4);
    const rec = BD.recs[c.aim];
    if (rec) {
      const bb = new T.Box3().setFromObject(rec.R.root), mid = new T.Vector3(); bb.getCenter(mid);
      // a point h above the ground sits where the ground h / tan(elevation) further away would be
      const back = Math.max(0, mid.y) / Math.tan(G.el);
      G.tx = mid.x - Math.sin(G.az) * back; G.tz = mid.z - Math.cos(G.az) * back;
    }
  } else if (c.deploy != null) {
    const b = window.MW.S.players[c.deploy].base;
    iso(BD.rigT);
    focusTiles([[b.x, b.y]].concat(window.MW.deployTiles(c.deploy)), 1.3, 1.9);
  } else if (c.plan && c.plan.length) {
    iso(BD.rigT);
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
// the screen edges covered by the HUD, in CSS pixels: the board is fitted inside what is left
R3.pad = (p, now) => { if (!BD) return; BD.padT = { t: p.t || 0, r: p.r || 0, b: p.b || 0, l: p.l || 0 }; if (now) BD.pad = Object.assign({}, BD.padT); };
R3.settle = () => { if (BD) Object.assign(BD.rig, BD.rigT); };
R3.cam = function (kind) {
  if (!BD) return;
  const G = BD.rigT;
  if (kind === 'overview') { BD.viewAz = 0; Object.assign(G, { zoom: 1, tx: 0, tz: 0 }); iso(G); BD.userT = clock(); }
  else if (kind === 'rotL' || kind === 'rotR') { const d = kind === 'rotL' ? Math.PI / 2 : -Math.PI / 2; BD.viewAz += d; G.az += d; }
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
  cv.addEventListener('pointerdown', e => { if (BD.inputOff) return; try { cv.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); startGesture(); });
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
    // aiming: the part of the target under the finger, or nothing
    if (BD.aimUid != null) {
      const rec = BD.recs[BD.aimUid];
      if (!rec || !BD.onAim) return;
      for (const h of ray.intersectObject(rec.R.root, true)) {
        const sl = h.object.userData.slot;
        if (!sl) continue;
        const part = Object.keys(PART_SLOTS).find(k => PART_SLOTS[k].includes(sl));
        if (part) { BD.onAim(part); return; }
      }
      return;
    }
    const hits = ray.intersectObjects(BD.group.children, true), cands = [];
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.tile && !o.userData.uid) o = o.parent;
      if (!o) continue;
      if (o.userData.uid) { const rec = BD.recs[o.userData.uid]; if (rec && !rec.gone) cands.push([rec.x, rec.y]); continue; }
      cands.push(o.userData.tile.split(',').map(Number));
    }
    const isTarget = c => BD.ov[key(c[0], c[1])] && BD.ov[key(c[0], c[1])].userData.kind === 'target';
    let pick = cands.find(isTarget);
    if (!pick) {
      // nothing on the line is a target: take the nearest target within a finger's width of the tap
      let best = 34;
      for (const k in BD.ov) {
        if (BD.ov[k].userData.kind !== 'target') continue;
        const [x, y] = k.split(',').map(Number), w = worldTile(x, y); w.y = 0.45; w.project(BD.cam);
        const d = Math.hypot((w.x - ndc.x) / 2 * r.width, (w.y - ndc.y) / 2 * r.height);
        if (d < best) { best = d; pick = [x, y]; }
      }
    }
    if (!pick) pick = cands[0];
    if (pick && BD.onTap) BD.onTap(pick[0], pick[1]);
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', e => { pts.delete(e.pointerId); g = null; });
  cv.addEventListener('wheel', e => { if (BD.inputOff) return; e.preventDefault(); BD.userT = clock(); BD.rigT.zoom = Math.max(0.8, Math.min(3.5, BD.rigT.zoom * Math.exp(-e.deltaY * 0.0015))); keepOnBoard(BD.rigT, 1.2); }, { passive: false });
}

/* Every map has its own biome: ground, sky and light, what its blocking terrain is made of, how its ruins have weathered,
   and the small things scattered on the ground. Layout and rules are the engine's; only the look changes here. */
const BIOMES = {
  // Open Field: a green meadow, tree clumps for cover
  open: { sky: 0xa9cbdc, isle: [0x6b5a44, 0x54473a], spike: [0x5f5142, 0x4d4236], tile: [0x6f9457, 0x678b50], scuff: 0x567a41,
    hemi: [0xeaf4e0, 0x4c5c3e], sun: 0xfff2d2, ruin: [0x9c9a8e, 0x84817a], rock: 'trees', deco: 'meadow' },
  // Three Lanes: a sandstone canyon, mesas for walls
  lanes: { sky: 0xe6cfa6, isle: [0x9c6c46, 0x7e5537], spike: [0x8a5e3c, 0x714c31], tile: [0xc6a273, 0xbd9868], scuff: 0xa5804f,
    hemi: [0xfff2da, 0x8c6c4a], sun: 0xffe4b4, ruin: [0xcba67a, 0xb28c60], rock: 'mesa', deco: 'desert' },
  // Uplink: an arctic relay station, ice and snow
  uplink: { sky: 0xb9cad8, isle: [0x70808e, 0x5a6875], spike: [0x9db4c6, 0x86a0b4], tile: [0xbccbd8, 0xb1c1cf], scuff: 0x9db0c1,
    hemi: [0xe6eef6, 0x64748a], sun: 0xe6eeff, ruin: [0xaab5bf, 0x8f9ba7], rock: 'ice', deco: 'snow' },
  // Scrapyard: rust, oil and stacked containers
  salvage: { sky: 0x8f867a, isle: [0x4f463e, 0x3e3731], spike: [0x4a423b, 0x3a342f], tile: [0x6e655c, 0x655c54], scuff: 0x4b443e,
    hemi: [0xdad2c6, 0x403c38], sun: 0xffdcae, ruin: [0x8c705a, 0x715c4b], rock: 'scrap', deco: 'yard' }
};
let BIO = BIOMES.open;
// Value and colour separate the armies from the field: the battlefield is painted greyer and lighter, the mecha on it
// a step darker, so in black and white the mecha read as dark shapes on a light ground
const ENV_SAT = 0.5, ENV_LIFT = 0.3, MECH_VAL = 0.78, DULL = {}, DARK = {}, hslTmp = {};
const dullHex = (c, lift) => { const k = new T.Color(c); k.getHSL(hslTmp); return k.setHSL(hslTmp.h, hslTmp.s * ENV_SAT, hslTmp.l + (1 - hslTmp.l) * (lift || 0)).getHex(); };
function dull(mat) {
  if (!mat.userData.paint) return mat;
  if (DULL[mat.uuid]) return DULL[mat.uuid];
  const m = mat.clone(); m.userData = { paint: true, dull: true }; m.color.setHex(dullHex(mat.color.getHex(), ENV_LIFT));
  return (DULL[mat.uuid] = m);
}
function darken(mat) {
  if (!mat.userData.paint) return mat;
  if (DARK[mat.uuid]) return DARK[mat.uuid];
  const m = mat.clone(); m.userData = { paint: true, dark: true }; m.color.multiplyScalar(MECH_VAL);
  return (DARK[mat.uuid] = m);
}
function darkMech(root) { root.traverse(o => { if (o.isMesh) o.material = darken(o.material); }); }
function dullScenery(root) {
  root.traverse(o => {
    if (o.userData.base) return o.traverse(q => { q.userData.keep = true; });
    if (o.isMesh && !o.userData.keep && !(o.parent && o.parent.userData.keep)) o.material = dull(o.material);
  });
}
const q = v => Math.round(v * 20) / 20;                       // keeps random sizes to a few shared shapes
function buildBoard(S) {
  const MW = window.MW, W = MW.W, H = MW.H, g = BD.group;
  BIO = BIOMES[S.map] || BIOMES.open;
  BD.renderer.setClearColor(dullHex(BIO.sky, ENV_LIFT));
  if (BD.scene.fog) BD.scene.fog.color.setHex(dullHex(BIO.sky, ENV_LIFT));
  if (BD.hemi) { BD.hemi.color.setHex(dullHex(BIO.hemi[0])); BD.hemi.groundColor.setHex(dullHex(BIO.hemi[1])); }
  BD.sun.color.setHex(BIO.sun);
  // the floating island under the board
  const isl = mesh(box(H + 0.5, 1.6, W + 0.5), soil(BIO.isle[0], 'rock'), g, [0, -0.95, 0], null, { t: 0.03 });
  isl.receiveShadow = true; isl.userData.ground = true;
  mesh(box(H + 0.2, 0.5, W + 0.2), soil(BIO.isle[1], 'rock'), g, [0, -1.9, 0], null, { t: 0.03 }).userData.ground = true;
  for (let i = 0; i < 26; i++) {
    const r = rand(0.25, 0.7), side = i % 4;
    const px = side < 2 ? rand(-H / 2, H / 2) : (side === 2 ? -1 : 1) * (H / 2 + 0.1);
    const pz = side >= 2 ? rand(-W / 2, W / 2) : (side === 0 ? -1 : 1) * (W / 2 + 0.1);
    mesh(cone(r, rand(0.8, 2.2), 5), soil(BIO.spike[i % 2], 'rock'), g, [px, -2.1 - rand(0, 0.6), pz], [Math.PI, rand(0, 3), 0], { t: 0.025 });
  }
  // tiles
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
    const k = key(x, y), p = tp(x, y);
    const shade = BIO.tile[(x + y) % 2];
    const t = mesh(box(0.97, 0.22, 0.97), soil(shade, BIO.deco), g, [p.x, -0.11, p.z], null, { t: 0.012, recv: true });
    t.castShadow = false; t.receiveShadow = true; t.userData.tile = k; t.userData.ground = true;
    const ter0 = MW.terrain(x, y);
    if (ter0 !== 'rock' && MW.baseAt(x, y) == null) groundDeco(p, S.objectives.some(o => o.x === x && o.y === y) || ter0 === 'ruins' || ter0 === 'rubble');
    const ov = new T.Mesh(new T.PlaneGeometry(0.92, 0.92), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    ov.rotation.x = -Math.PI / 2; ov.position.set(p.x, 0.012, p.z); ov.userData.tile = k; ov.renderOrder = 2; g.add(ov);
    BD.ov[k] = ov; BD.tiles[k] = t;
    const ter = MW.terrain(x, y), base = MW.baseAt(x, y);
    if (ter === 'rock') buildRock(p, k);
    if (ter === 'ruins' || ter === 'rubble') buildRuin(p, k, ter === 'rubble');
    if (base != null) buildBase(p, k, base);
  }
  for (const o of S.objectives) buildObjective(o);
  dullScenery(BD.group);
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
// small things on open ground: low and flat so they never hide a mech or block a tap
function groundDeco(p, busy) {
  const g = BD.group, at = (dx, dz) => [p.x + dx, 0, p.z + dz];
  const put = (geo, col, pos, rot, y) => { const m = mesh(geo, toon(col), g, [pos[0], y, pos[2]], rot || null, flat); m.userData.ground = true; return m; };
  const n = busy ? 1 : 3;
  for (let i = 0; i < n; i++) {
    if (Math.random() > 0.55) continue;
    const pos = at(rand(-0.36, 0.36), rand(-0.36, 0.36)), ry = rand(0, 3);
    if (BIO.deco === 'meadow') {
      if (Math.random() < 0.7) for (let j = 0; j < 3; j++) put(cone(0.02, q(rand(0.06, 0.12)), 4), j % 2 ? 0x5f8a45 : 0x6f9a52, [pos[0] + rand(-0.04, 0.04), 0, pos[2] + rand(-0.04, 0.04)], [rand(-0.2, 0.2), ry, rand(-0.2, 0.2)], 0.04);
      else put(sph(0.018, 6), Math.random() < 0.5 ? 0xf2e6a0 : 0xe9eef2, pos, null, 0.03);
    } else if (BIO.deco === 'desert') {
      if (Math.random() < 0.6) put(box(q(rand(0.05, 0.1)), 0.03, q(rand(0.05, 0.09))), 0xb9925e, pos, [0, ry, 0], 0.015);
      else { put(cyl(0.006, 0.006, 0.08, 4), 0x8a6a44, pos, [0.3, ry, 0.2], 0.04); put(cyl(0.006, 0.006, 0.07, 4), 0x8a6a44, pos, [-0.3, ry + 1, 0.3], 0.035); }
    } else if (BIO.deco === 'snow') {
      if (Math.random() < 0.65) { const m = put(sph(q(rand(0.07, 0.13)), 8), 0xffffff, pos, null, 0); m.scale.y = 0.3; }
      else put(box(q(rand(0.12, 0.2)), 0.004, q(rand(0.1, 0.16))), 0xbfd8ea, pos, [0, ry, 0], 0.004);
    } else {
      if (Math.random() < 0.5) { const m = put(cyl(q(rand(0.07, 0.13)), q(rand(0.07, 0.13)), 0.003, 10), 0x38322e, pos, null, 0.003); m.scale.z = rand(0.6, 1); }
      else if (Math.random() < 0.6) put(box(q(rand(0.05, 0.12)), 0.025, 0.03), Math.random() < 0.5 ? 0x8c5a3a : 0x7a7f84, pos, [0, ry, 0], 0.013);
      else put(tor(0.045, 0.016), 0x2c2a29, pos, [Math.PI / 2, 0, 0], 0.016);
    }
  }
  // the old scuff marks stay as wear on the ground
  if (Math.random() < 0.3) mesh(box(q(rand(0.2, 0.5)), 0.005, 0.02), toon(BIO.scuff), g, [p.x + rand(-0.25, 0.25), 0.004, p.z + rand(-0.25, 0.25)], [0, rand(0, 3), 0], flat).userData.ground = true;
}
// a low-poly pine after stylised tree sets: a turned trunk and three faceted tiers, each a cone whose rim curls down
// into a lip, stacked a little off true
function pine(parent, x, z, sc, cols, snow) {
  const tr = new T.Group(); tr.position.set(x, 0, z); tr.scale.setScalar(sc); tr.rotation.y = rand(0, 3); parent.add(tr);
  mesh(turned('pn-trunk', [[0.0, 0.0], [0.045, 0.0], [0.035, 0.26], [0.0, 0.26]], 6), toon(0x6a4a32), tr, null, [-Math.PI / 2, 0, 0]);
  [[0.2, 0.2, 0.34], [0.16, 0.4, 0.3], [0.11, 0.58, 0.26]].forEach(([r, y, h], i) => {
    mesh(turned('pn-tier' + i, [[0.0, y + h], [r * 0.12, y + h * 0.9], [r * 0.85, y + 0.05], [r, y], [r * 0.7, y + 0.03], [0.0, y + 0.03]], 7), toon(cols[i]), tr, [rand(-0.01, 0.01), 0, rand(-0.01, 0.01)], [-Math.PI / 2, 0, i * 0.4]);
    if (snow) mesh(turned('pn-snow' + i, [[0.0, y + h + 0.004], [r * 0.12, y + h * 0.9 + 0.004], [r * 0.45, y + h * 0.5], [0.0, y + h * 0.5]], 7), toon(0xffffff), tr, null, [-Math.PI / 2, 0, i * 0.4], flat);
  });
  return tr;
}
// a faceted boulder: a low-poly lump squashed and turned at random
function boulder(parent, pos, r, col, squash) {
  const m = mesh(geo('bldr', () => { const g = new T.DodecahedronGeometry(1, 0); g.userData.exact = true; return g; }), toon(col), parent, pos, [rand(0, 3), rand(0, 3), rand(0, 3)]);
  m.scale.set(r * rand(0.9, 1.15), r * (squash || 0.65), r * rand(0.9, 1.15));
  return m;
}
function buildRock(p, k) {
  const pg = propGroup(k, p);
  if (BIO.rock === 'trees') {
    // a clump of low-poly pines round a mossy boulder
    boulder(pg, [0.16, 0.08, 0.18], 0.2, 0x7d8078, 0.6);
    mesh(sph(0.1, 6), toon(0x6f9a52), pg, [0.2, 0.19, 0.14], null, flat).scale.y = 0.35;
    for (const [x, z, sc] of [[-0.2, -0.18, 1.15], [0.2, -0.24, 0.9], [-0.24, 0.24, 0.8], [0.02, 0.02, 1.3]]) pine(pg, x + rand(-0.04, 0.04), z + rand(-0.04, 0.04), sc * rand(0.9, 1.1), [0x3f6b3c, 0x4a7a44, 0x578a4e]);
  } else if (BIO.rock === 'mesa') {
    // a sandstone mesa after stylised desert rock sets: turned strata, each one bulging out and tucking in again so
    // the stack reads as eroded bands, with a cap rock overhanging the top and a cactus at its foot
    const cols = [0xc98f58, 0xb97d49, 0xd6a36b, 0xa96f40, 0xc98f58];
    let y = 0;
    [[0.36, 0.26], [0.3, 0.22], [0.26, 0.2], [0.2, 0.18], [0.24, 0.07]].forEach(([r, h], i) => {
      mesh(turned('ms-band' + i, [[0.0, 0.0], [r * 0.92, 0.0], [r, h * 0.3], [r * 1.02, h * 0.55], [r * 0.9, h * 0.85], [r * 0.82, h], [0.0, h]], 7), toon(cols[i]), pg, [rand(-0.02, 0.02), y, rand(-0.02, 0.02)], [-Math.PI / 2, 0, rand(0, 3)]);
      y += h;
    });
    const cx = 0.36, cz = 0.34;
    mesh(turned('ms-cactus', [[0.0, 0.0], [0.04, 0.0], [0.045, 0.24], [0.03, 0.3], [0.0, 0.31]], 8), toon(0x5f8a4c), pg, [cx, 0, cz], [-Math.PI / 2, 0, 0]);
    mesh(tube('ms-arm', [[cx, 0.14, cz], [cx + 0.08, 0.15, cz], [cx + 0.1, 0.26, cz]], 0.022, 12), toon(0x5f8a4c), pg);
    for (let i = 0; i < 3; i++) boulder(pg, [rand(-0.4, 0.1), 0.03, rand(0.24, 0.42)], q(rand(0.05, 0.08)), cols[i], 0.6);
  } else if (BIO.rock === 'ice') {
    // ice shards breaking out of a faceted rock bed in a snow drift, after stylised ice-crystal rocks, and a frosted pine
    mesh(sph(0.36, 10), toon(0xe9f1f7), pg, [0, 0, 0]).scale.set(1, 0.3, 1);
    boulder(pg, [0.02, 0.06, 0.0], 0.24, 0x6f7a86, 0.45);
    for (const [x, z, h, rr, tilt] of [[0, 0, 1.0, 0.16, 0.05], [-0.2, 0.12, 0.66, 0.12, 0.35], [0.2, -0.1, 0.76, 0.13, -0.32], [0.08, 0.24, 0.48, 0.1, 0.45], [-0.14, -0.22, 0.54, 0.1, -0.4]])
      mesh(turned('ic-shard' + h, [[0.0, 0.0], [rr, 0.0], [rr * 1.05, h * 0.55], [rr * 0.5, h * 0.85], [0.0, h]], 6), toon(h > 0.7 ? 0x8fcdea : 0x6fb6dc), pg, [x, 0.04, z], [-Math.PI / 2 + tilt, 0, tilt * 0.6]);
    pine(pg, -0.32, -0.3, 0.75, [0x3d5f55, 0x47695f, 0x52746a], true);
  } else if (BIO.rock === 'scrap') {
    // stacked shipping containers, one skewed, after container-yard models: chamfered boxes with corrugated sides,
    // corner posts and lock bars on the doors, and junk piled against them
    const cols = [0xa6533a, 0x3f7f86, 0xc79a3a, 0x6b7a52];
    const can = (x, y, z, ry, c) => {
      const b = new T.Group(); b.position.set(x, y - 0.15, z); b.rotation.y = ry; pg.add(b);
      mesh(slab('ct-body', 0.34, [[-0.36, 0.0], [0.36, 0.0], [0.36, 0.3], [-0.36, 0.3]], 0.01), toon(c), b);
      for (let i = -6; i <= 6; i++) for (const sz of [-1, 1]) mesh(box(0.024, 0.25, 0.008), toon(c), b, [i * 0.05, 0.15, sz * 0.172], null, flat);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(box(0.03, 0.3, 0.03), toon(0x2f2b28), b, [sx * 0.345, 0.15, sz * 0.155], null, flat);
      for (const zz of [-0.06, 0.06]) mesh(box(0.006, 0.26, 0.012), toon(0x2f2b28), b, [0.362, 0.15, zz], null, flat);
    };
    can(0, 0.15, -0.1, 0.1, cols[0]); can(0.02, 0.15, 0.26, -0.12, cols[1]); can(-0.02, 0.45, 0.06, 0.5, cols[2]);
    if (Math.random() < 0.6) can(0.04, 0.75, 0.04, 0.2, cols[3]);
    mesh(tor(0.09, 0.035), toon(0x2a2827), pg, [-0.36, 0.09, 0.38], [0.3, 0.4, 0]);
    for (let i = 0; i < 4; i++) boulder(pg, [rand(-0.42, 0.42), 0.03, rand(0.3, 0.44)], q(rand(0.04, 0.07)), i % 2 ? 0x8c5a3a : 0x70757a, 0.6);
  }
  BD.props[k] = pg;
}
function buildRuin(p, k, rubble) {
  if (BD.props[k]) { BD.group.remove(BD.props[k]); }
  const pg = propGroup(k, p), c = BIO.ruin[0], c2 = BIO.ruin[1];
  // what has settled on the stonework: moss, sand, snow or rust
  const cap = { meadow: 0x6f9a52, desert: 0xdcb983, snow: 0xffffff, yard: 0x8c5a3a }[BIO.deco];
  if (rubble) {
    for (let i = 0; i < 9; i++) boulder(pg, [rand(-0.35, 0.35), 0.04, rand(-0.35, 0.35)], rand(0.05, 0.1), i % 2 ? c : c2, 0.7);
    pg.userData.rubble = true;
  } else {
    const wall = (x, z, ry, len) => {
      const g2 = new T.Group(); g2.position.set(x, 0, z); g2.rotation.y = ry; pg.add(g2);
      const course = 0.07, n = 6;
      for (let row = 0; row < n; row++) {
        // each course is shorter than the one under it, so the wall breaks off in steps toward one end
        const reach = len * (1 - row * 0.15) * rand(0.92, 1);
        let at = -len / 2 + (row % 2 ? 0.03 : 0);
        while (at < -len / 2 + reach - 0.04) {
          const w = Math.min(rand(0.09, 0.16), -len / 2 + reach - at);
          const st = mesh(geo('rn-stone', () => { const g = bevelBox(1, 1, 1); g.userData.exact = true; return g; }), toon((row + Math.round(at * 20)) % 3 ? c : c2), g2, [at + w / 2, row * course + course / 2, rand(-0.006, 0.006)], [0, rand(-0.05, 0.05), 0]);
          st.scale.set(w - 0.008, course - 0.006, rand(0.08, 0.095));
          at += w;
        }
        if (row === n - 1 || BIO.deco === 'snow') mesh(box(reach * 0.9, 0.02, 0.1), toon(cap), g2, [-len / 2 + reach * 0.45, (row + 1) * course + 0.004, 0], null, flat);
      }
      mesh(box(0.06, 0.07, 0.005), toon(0x2d3640), g2, [-len / 2 + 0.1, 0.16, 0.05], null, flat);
    };
    wall(-0.05, -0.32, 0, 0.75); wall(-0.33, 0.02, Math.PI / 2, 0.6);
    for (let i = 0; i < 3; i++) mesh(box(rand(0.06, 0.12), 0.05, rand(0.06, 0.12)), toon(c2), pg, [rand(0, 0.35), 0.025, rand(0, 0.35)], [0, rand(0, 3), 0]);
    // a drift of whatever the biome leaves in a sheltered corner
    const d = mesh(sph(0.2, 8), toon(cap), pg, [-0.18, 0, -0.18], null, flat); d.scale.set(1, 0.22, 1);
  }
  BD.props[k] = pg;
}
function buildBase(p, k, pid) {
  const tc = TEAM[pid], pg = propGroup(k, p);
  const face = pid === 0 ? Math.PI : 0;
  pg.rotation.y = face;
  // after sci-fi command bunkers: a low hull with sloped, chamfered walls on a plinth, a recessed blast door with
  // a cross brace, buttresses at the front corners, a turret on a turned ring on the roof and a mast with the lamp
  mesh(slab('bs-plinth', 0.94, [[-0.48, 0.0], [0.48, 0.0], [0.48, 0.04], [0.45, 0.06], [-0.45, 0.06], [-0.48, 0.04]], 0.01), toon(tc.main), pg);
  mesh(profile('bs-hull', 0.84, [[-0.42, 0.06], [0.42, 0.06], [0.33, 0.47], [-0.35, 0.47]], 0.016), toon(tc.second), pg);
  mesh(profile('bs-roof', 0.86, [[-0.36, 0.46], [0.34, 0.46], [0.3, 0.53], [-0.32, 0.53]], 0.01), toon(tc.main), pg);
  const door = new T.Group(); door.position.set(0, 0.0, 0.392); door.rotation.x = -0.215; pg.add(door);
  mesh(slab('bs-frame', 0.03, [[-0.24, 0.06], [0.24, 0.06], [0.24, 0.32], [0.17, 0.39], [-0.17, 0.39], [-0.24, 0.32]], 0.008), toon(tc.trim), door);
  mesh(slab('bs-door', 0.04, [[-0.19, 0.06], [0.19, 0.06], [0.19, 0.3], [0.14, 0.35], [-0.14, 0.35], [-0.19, 0.3]], 0.006), toon(INK), door, [0, 0, 0.004]);
  for (const sx of [-1, 1]) mesh(box(0.016, 0.38, 0.012), toon(tc.trim), door, [0, 0.2, 0.026], [0, 0, sx * 0.86], flat);
  for (const sx of [-1, 1]) mesh(profile('bs-butt', 0.12, [[0.16, 0.06], [0.47, 0.06], [0.47, 0.13], [0.22, 0.6], [0.16, 0.6]], 0.012), toon(tc.main), pg, [sx * 0.41, 0, 0]);
  for (const sx of [-1, 1]) vents(pg, toon(INK), 4, 0.2, 0.05, [sx * 0.425, 0.26, -0.12], [0, sx * Math.PI / 2, 0]);
  const tur = new T.Group(); tur.position.set(0, 0.53, -0.05); pg.add(tur);
  mesh(turned('bs-tring', [[0.0, 0.0], [0.2, 0.0], [0.2, 0.03], [0.17, 0.05], [0.0, 0.05]], 10), toon(tc.main), tur, null, [-Math.PI / 2, 0, 0]);
  mesh(turned('bs-tdome', [[0.0, 0.04], [0.16, 0.04], [0.16, 0.08], [0.12, 0.14], [0.05, 0.16], [0.0, 0.16]], 10), toon(tc.second), tur, null, [-Math.PI / 2, 0, 0]);
  const bar = new T.Group(); bar.position.set(0, 0.12, 0); tur.add(bar);
  mesh(slab('bs-mantle', 0.16, [[-0.08, -0.04], [0.08, -0.04], [0.09, 0.02], [0.06, 0.06], [-0.06, 0.06], [-0.09, 0.02]], 0.01), toon(tc.second), bar, [0, 0.0, 0.08]);
  for (const sx of [-1, 1]) {
    mesh(turned('bs-brl', [[0.0, 0.12], [0.024, 0.12], [0.022, 0.4], [0.0, 0.4]], 16), toon(GUN), bar, [sx * 0.04, 0.02, 0]);
    mesh(turned('bs-brk', [[0.0, 0.38], [0.03, 0.38], [0.032, 0.39], [0.032, 0.42], [0.0, 0.42]], 16), toon(INK), bar, [sx * 0.04, 0.02, 0]);
  }
  const mu = new T.Object3D(); mu.position.set(0, 0.02, 0.43); bar.add(mu);
  mesh(turned('bs-mast', [[0.0, 0.5], [0.03, 0.5], [0.02, 0.56], [0.008, 0.58], [0.006, 0.9], [0.0, 0.9]], 10), toon(INK), pg, [0.3, 0, -0.3], [-Math.PI / 2, 0, 0]);
  const lamp = new T.Mesh(sph(0.03, 10), glow(tc.ring)); lamp.position.set(0.3, 0.93, -0.3); pg.add(lamp);
  pg.userData.base = true;
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
    // after field supply depots: rugged cases with chamfered lids, ribs round the middle and dark corner bumpers,
    // stacked on a pallet, and a pole carrying the owner's light
    const caseAt = (w, h, d, col, pos, ry) => {
      const c = new T.Group(); c.position.set(pos[0], pos[1], pos[2]); c.rotation.y = ry || 0; pg.add(c);
      mesh(slab('dp-case' + [w, h, d].join(), d, [[-w / 2, 0], [w / 2, 0], [w / 2, h * 0.8], [w / 2 - 0.03, h], [-w / 2 + 0.03, h], [-w / 2, h * 0.8]], 0.014), toon(col), c);
      mesh(slab('dp-rib' + [w, d].join(), d + 0.012, [[-w / 2 - 0.006, h * 0.38], [w / 2 + 0.006, h * 0.38], [w / 2 + 0.006, h * 0.5], [-w / 2 - 0.006, h * 0.5]], 0.003), toon(0x2f3236), c);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(box(0.03, h * 0.9, 0.03), toon(0x2a2c2f), c, [sx * (w / 2 - 0.008), h * 0.45, sz * (d / 2 - 0.008)], null, flat);
    };
    mesh(slab('dp-pallet', 0.52, [[-0.3, 0.0], [0.3, 0.0], [0.3, 0.035], [-0.3, 0.035]], 0.006), toon(0x7a6244), pg, [0.0, 0, -0.02]);
    caseAt(0.42, 0.2, 0.24, 0x6f7a55, [-0.04, 0.035, 0.1]);
    caseAt(0.42, 0.2, 0.24, 0x5b6d7a, [0.02, 0.035, -0.17]);
    caseAt(0.34, 0.18, 0.22, 0x7d6a4a, [0.04, 0.235, -0.02], 0.3);
    mesh(turned('dp-pole', [[0.0, 0.0], [0.012, 0.0], [0.008, 0.52], [0.0, 0.52]], 8), toon(INK), pg, [-0.3, 0, -0.28], [-Math.PI / 2, 0, 0]);
    rec.light = mesh(box(0.14, 0.09, 0.006), glow(ownerColor(o)), pg, [-0.23, 0.45, -0.28], null, flat);
  } else if (o.type === 'radar') {
    // after radar stations: a stepped, chamfered pedestal, a mast, and a deep parabolic dish whose feed horn is held
    // out in front on three struts
    mesh(turned('rd-base', [[0.0, 0.0], [0.17, 0.0], [0.17, 0.04], [0.14, 0.07], [0.1, 0.07], [0.1, 0.12], [0.07, 0.15], [0.0, 0.15]], 8), toon(0x7c848c), pg, null, [-Math.PI / 2, 0, 0]);
    mesh(turned('rd-mast', [[0.0, 0.14], [0.05, 0.14], [0.035, 0.66], [0.0, 0.66]], 12), toon(0x9aa2aa), pg, null, [-Math.PI / 2, 0, 0]);
    const dish = new T.Group(); dish.position.y = 0.7; pg.add(dish);
    const face = new T.Group(); face.rotation.x = -0.5; dish.add(face);
    mesh(turned('rd-dish', [[0.0, -0.01], [0.06, -0.006], [0.14, 0.02], [0.22, 0.07], [0.235, 0.085], [0.22, 0.08], [0.14, 0.034], [0.06, 0.008], [0.0, 0.004]], 40), toon(0xd8dee4), face);
    mesh(turned('rd-hub', [[0.0, -0.05], [0.05, -0.05], [0.05, 0.0], [0.0, 0.0]], 12), toon(0x7c848c), face);
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; mesh(tube('rd-strut' + i, [[Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.07], [Math.cos(a) * 0.08, Math.sin(a) * 0.08, 0.14], [0, 0, 0.19]], 0.006, 12), toon(INK), face); }
    mesh(turned('rd-horn', [[0.0, 0.17], [0.022, 0.17], [0.03, 0.2], [0.0, 0.21]], 12), toon(0x7c848c), face);
    rec.dish = dish;
    rec.light = mesh(sph(0.03, 8), glow(ownerColor(o)), pg, [0, 0.98, 0], null, flat);
  } else if (o.type === 'uplink') {
    // a broad gold-trimmed plinth so it reads from above, a tapering mast with lattice legs, and a turning ring with
    // a beacon on top
    mesh(turned('up-plinth', [[0.0, 0.0], [0.46, 0.0], [0.46, 0.08], [0.42, 0.12], [0.0, 0.12]], 8), toon(0x5f676f), pg, null, [-Math.PI / 2, 0, 0], { recv: true });
    mesh(turned('up-gold', [[0.0, 0.12], [0.4, 0.12], [0.4, 0.14], [0.37, 0.16], [0.0, 0.16]], 8), toon(0xc39a3e), pg, null, [-Math.PI / 2, 0, 0]);
    mesh(turned('up-step', [[0.0, 0.16], [0.28, 0.16], [0.28, 0.24], [0.22, 0.3], [0.0, 0.3]], 8), toon(0x858d95), pg, null, [-Math.PI / 2, 0, 0]);
    for (const a of [0, 2.09, 4.19]) mesh(tube('up-leg' + a, [[Math.cos(a) * 0.2, 0.3, Math.sin(a) * 0.2], [Math.cos(a) * 0.12, 0.8, Math.sin(a) * 0.12], [Math.cos(a) * 0.05, 1.2, Math.sin(a) * 0.05]], 0.022, 16), toon(0x9aa2aa), pg);
    for (let i = 0; i < 3; i++) mesh(turned('up-band' + i, [[0.0, -0.015], [0.15 - i * 0.03, -0.015], [0.16 - i * 0.03, 0.0], [0.15 - i * 0.03, 0.015], [0.0, 0.015]], 8), toon(0x7c848c), pg, [0, 0.5 + i * 0.25, 0], [-Math.PI / 2, 0, 0]);
    const spin = new T.Group(); spin.position.y = 1.18; pg.add(spin);
    mesh(tor(0.3, 0.035), toon(0xc39a3e), spin, [0, 0, 0], [Math.PI / 2, 0, 0]);
    mesh(slab('up-bar', 0.06, [[-0.33, -0.015], [0.33, -0.015], [0.34, 0.0], [0.33, 0.015], [-0.33, 0.015], [-0.34, 0.0]], 0.004), toon(0xd8dee4), spin);
    rec.dish = spin;
    rec.light = mesh(sph(0.09, 12), glow(ownerColor(o)), pg, [0, 1.36, 0], null, flat);
    ring.scale.setScalar(1.12);
  } else {
    // a repair pad: a chamfered landing disc with a glowing cross, under two curved gantry arches carrying a hoist
    mesh(turned('rp-pad', [[0.0, 0.0], [0.42, 0.0], [0.42, 0.03], [0.39, 0.05], [0.0, 0.05]], 20), toon(0x4a5058), pg, null, [-Math.PI / 2, 0, 0], { recv: true });
    mesh(box(0.38, 0.006, 0.09), glow(0x8fbf9c), pg, [0, 0.052, 0], null, flat);
    mesh(box(0.09, 0.006, 0.38), glow(0x8fbf9c), pg, [0, 0.052, 0], null, flat);
    for (const z of [-0.3, 0.3]) {
      const arch = []; for (let i = 0; i <= 12; i++) { const a = Math.PI * i / 12; arch.push([Math.cos(a) * 0.38, 0.05 + Math.sin(a) * 0.62, z]); }
      mesh(tube('rp-arch' + z, arch, 0.03, 48), toon(0xe0b43a), pg);
      for (const sx of [-1, 1]) mesh(slab('rp-foot', 0.1, [[-0.05, 0.0], [0.05, 0.0], [0.04, 0.06], [-0.04, 0.06]], 0.008), toon(0x5a6068), pg, [sx * 0.38, 0.0, z]);
    }
    mesh(tube('rp-beam', [[0, 0.67, -0.3], [0, 0.67, 0.3]], 0.022, 4), toon(0xe0b43a), pg);
    mesh(turned('rp-hoist', [[0.0, 0.58], [0.04, 0.58], [0.04, 0.64], [0.0, 0.66]], 10), toon(0x5a6068), pg, null, [-Math.PI / 2, 0, 0]);
    mesh(turned('rp-cable', [[0.0, 0.34], [0.004, 0.34], [0.004, 0.58], [0.0, 0.58]], 6), toon(INK), pg, null, [-Math.PI / 2, 0, 0], flat);
    mesh(tor(0.025, 0.007), toon(0x5a6068), pg, [0, 0.32, 0], [0, 0, 0]);
    ring.material.color.setHex(0x8fbf9c);
  }
  BD.objs[k] = rec;
}

/* ---------- mech records on the board ---------- */
let MS = 1.15; // mech scale on the map: about one tile tall, a little smaller on wide maps
function newRec(m, S) {
  const doc = S.players[m.owner] ? S.players[m.owner].doctrine : 'assault';
  const R = buildMech(m, m.owner, doc, {});
  darkMech(R.root);
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
  // an emplaced mech stands in a hazard-striped ring, so a turret reads as one at a glance
  rec.empRing = new T.Mesh(new T.RingGeometry(0.36, 0.5, 48, 1), new T.MeshBasicMaterial({ map: hazardTex(), transparent: true, opacity: 0.95, depthWrite: false }));
  rec.empRing.rotation.x = -Math.PI / 2; rec.empRing.position.y = 0.015; rec.empRing.visible = false; rec.empRing.renderOrder = 3; BD.group.add(rec.empRing);
  // the disc under each mech marks whose it is
  const sh = new T.Mesh(new T.CircleGeometry(0.3, 24), new T.MeshBasicMaterial({ color: TEAM[m.owner] ? TEAM[m.owner].ring : 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.006; BD.group.add(sh); rec.blob = sh;
  rec.bubble = new T.Mesh(new T.IcosahedronGeometry(0.5, 1), new T.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0, wireframe: true, depthWrite: false }));
  BD.group.add(rec.bubble);
  return rec;
}
// yellow and black hazard stripes, wrapped round a ring
let HAZ = null;
function hazardTex() {
  if (HAZ) return HAZ;
  const c = document.createElement('canvas'); c.width = 256; c.height = 16;
  const g = c.getContext('2d');
  g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, 256, 16);
  g.fillStyle = '#f4c431';
  for (let x = -16; x < 272; x += 16) { g.beginPath(); g.moveTo(x, 16); g.lineTo(x + 8, 16); g.lineTo(x + 16, 0); g.lineTo(x + 8, 0); g.closePath(); g.fill(); }
  HAZ = new T.CanvasTexture(c); HAZ.wrapS = T.RepeatWrapping;
  return HAZ;
}
function dropRec(rec) {
  BD.group.remove(rec.R.root); BD.group.remove(rec.selRing); BD.group.remove(rec.actRing); BD.group.remove(rec.owRing); BD.group.remove(rec.empRing); BD.group.remove(rec.blob); BD.group.remove(rec.bubble);
  delete BD.recs[rec.uid];
}
function rebuildRec(rec, m, S) {
  const old = rec.R.root, pos = old.position.clone(), rot = old.rotation.y;
  BD.group.remove(old);
  const doc = S.players[m.owner] ? S.players[m.owner].doctrine : 'assault';
  rec.R = buildMech(m, m.owner, doc, {});
  darkMech(rec.R.root);
  rec.R.root.scale.multiplyScalar(MS);
  rec.R.root.userData.uid = m.uid;
  rec.R.root.position.copy(pos); rec.R.root.rotation.y = rot;
  BD.group.add(rec.R.root);
  rec.sig = signature(m) + (m.entrenched ? '#E' : '');
  rec.entr = !!m.entrenched;
}

// enemies the selected mech can hit glow red, after targeting-HUD references: a hologram twin of every part with fine
// scanlines drifting up, a brighter sweep band and a hot fresnel rim, plus four bracket arcs turning on the ground.
// 'now' is in range from where it stands; 'reach' only after a move, drawn fainter
const TGT_U = { uTime: { value: 0 } };
const TGT_MAT = {};
function tgtMat(tier) {
  if (TGT_MAT[tier]) return TGT_MAT[tier];
  return (TGT_MAT[tier] = new T.ShaderMaterial({
    uniforms: { uTime: TGT_U.uTime, uStr: { value: tier === 'now' ? 1 : 0.42 } },
    vertexShader: 'varying vec3 vW; varying vec3 vN; varying vec3 vV;\n' +
      'void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(normalMatrix * normal); vec4 mv = viewMatrix * w; vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform float uTime; uniform float uStr; varying vec3 vW; varying vec3 vN; varying vec3 vV;\n' +
      'void main() {\n' +
      '  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);\n' +
      '  float f = fract(vW.y * 22.0 - uTime * 1.8);\n' +
      '  float scan = smoothstep(0.0, 0.18, f) * (1.0 - smoothstep(0.32, 0.5, f));\n' +
      '  float g = fract(vW.y * 1.3 - uTime * 0.55);\n' +
      '  float band = smoothstep(0.0, 0.06, g) * (1.0 - smoothstep(0.06, 0.2, g));\n' +
      '  float pulse = 0.8 + 0.2 * sin(uTime * 6.0);\n' +
      '  float a = (0.14 + 0.5 * scan + 1.1 * rim + 0.7 * band) * pulse * uStr;\n' +
      '  gl_FragColor = vec4(vec3(1.0, 0.13, 0.08) * a, a);\n' +
      '}',
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  }));
}
function setTarget(rec, tier) {
  if (rec.tgtTier === tier && rec.tgtFor === rec.R.root) return;
  if (rec.tgt) { rec.tgt.forEach(o => { if (o.parent) o.parent.remove(o); }); rec.tgt = null; }
  rec.tgtTier = tier; rec.tgtFor = rec.R.root;
  if (!rec.tgtRing) {
    const g = new T.Group();
    for (let i = 0; i < 4; i++) {
      const arc = new T.Mesh(new T.RingGeometry(0.46, 0.53, 10, 1, i * Math.PI / 2 + 0.2, Math.PI / 2 - 0.4), new T.MeshBasicMaterial({ color: 0xff3a24, transparent: true, opacity: 0.95, depthWrite: false }));
      arc.rotation.x = -Math.PI / 2; g.add(arc);
    }
    g.position.y = 0.02; g.renderOrder = 4; BD.group.add(g); rec.tgtRing = g;
  }
  rec.tgtRing.visible = !!tier;
  rec.tgtRing.children.forEach(a => { a.material.opacity = tier === 'now' ? 0.95 : 0.45; });
  if (!tier) return;
  const parts = [];
  rec.R.root.traverse(o => { if (o.isMesh && o.geometry && !o.userData.tgtTwin && !(o.material && (Array.isArray(o.material) || o.material.transparent))) parts.push(o); });
  rec.tgt = parts.map(o => { const tw = new T.Mesh(o.geometry, tgtMat(tier)); tw.userData.tgtTwin = true; tw.renderOrder = 5; tw.raycast = () => {}; o.add(tw); return tw; });
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
    rec.empRing.visible = !!m.entrenched;
    setTarget(rec, (v.targets && v.targets[m.uid]) || null);
  }
  // mecha that left the field: kept briefly so a death, detonation, strip or return to base can play out
  for (const id in BD.recs) {
    const rec = BD.recs[id];
    if (!seen[id] && !rec.gone) { rec.gone = true; rec.goneAt = t; rec.selRing.visible = rec.actRing.visible = rec.owRing.visible = rec.empRing.visible = false; setTarget(rec, null); }
  }
  // objectives change hands
  for (const o of S.objectives) {
    const r = BD.objs[key(o.x, o.y)];
    if (!r || o.type === 'repair') continue;
    if (r.owner !== o.owner) { r.owner = o.owner; const c = ownerColor(o); r.ring.material.color.setHex(c); if (r.light) r.light.material = glow(c); }
    // a held objective stands in a column of its holder's colour
    if (o.owner != null && !r.column) r.column = holdColumn(r.pg.position);
    if (r.column) { r.column.visible = o.owner != null; if (o.owner != null) { r.column.userData.mats.forEach(mm => mm.color.setHex(TEAM[o.owner].ring)); } }
  }
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
  BD.aimUid = v.aim != null ? v.aim : null; BD.onAim = v.onAim || null;
  const c = v.cam || {};
  const intent = c.aim != null ? 'a' + c.aim : c.deploy != null ? 'd' + c.deploy : c.frame ? 'f' + c.key : c.plan ? 'p' + c.key : c.sel != null ? 's' + c.sel : 'o';
  if (intent !== BD.intent) { BD.intent = intent; BD.intentSpec = c; BD.focusTok++; if (!BD.follow) applyIntent(); }
};
const OV_COL = { reach: 0xf2c230, dep: 0xf2c230, owd: 0xff7a3a, target: 0xef4a3a, threat: 0xef4a3a, 'ez-now': 0xef4a3a, 'ez-later': 0xef4a3a };
const OV_OP = { reach: 0.36, dep: 0.45, owd: 0.5, target: 0.5, threat: 0.2, 'ez-now': 0.42, 'ez-later': 0.18 };

function buildWreck(w) {
  const k = key(w.x, w.y), pg = propGroup(k, tp(w.x, w.y));
  // torn armour: a few chamfered plate shards, a bent pipe and a scorched hub
  const shards = [[[-0.08, 0.0], [0.08, 0.0], [0.1, 0.05], [0.02, 0.09], [-0.09, 0.06]], [[-0.1, 0.0], [0.07, 0.0], [0.05, 0.06], [-0.06, 0.07]], [[-0.06, 0.0], [0.06, 0.0], [0.03, 0.1], [-0.05, 0.08]]];
  for (let i = 0; i < 6; i++) { const m = mesh(slab('wk-shard' + (i % 3), 0.03, shards[i % 3], 0.006), toon(i % 2 ? 0x3a3f46 : 0x4b4239), pg, [rand(-0.25, 0.25), 0.02, rand(-0.25, 0.25)], [rand(-1.2, -0.4), rand(0, 3), rand(-0.4, 0.4)]); m.scale.setScalar(rand(0.8, 1.6)); }
  mesh(tube('wk-pipe', [[-0.12, 0.03, -0.02], [0.0, 0.08, 0.02], [0.06, 0.12, 0.12], [0.16, 0.06, 0.16]], 0.022, 20), toon(0x5a5f66), pg);
  mesh(turned('wk-hub', [[0.0, 0.0], [0.06, 0.0], [0.07, 0.02], [0.05, 0.05], [0.0, 0.05]], 10), toon(0x2a2c30), pg, [-0.1, 0, 0.12], [-Math.PI / 2 + 0.3, 0, 0.2]);
  const g = new T.Mesh(new T.RingGeometry(0.2, 0.42, 28), new T.MeshBasicMaterial({ color: 0xffa83a, transparent: true, opacity: 0.4, depthWrite: false }));
  g.rotation.x = -Math.PI / 2; g.position.y = 0.014; pg.add(g); pg.userData.glow = g;
  return pg;
}
function buildCrate(c) {
  const k = key(c.x, c.y), pg = propGroup(k, tp(c.x, c.y));
  const body = new T.Group(); pg.add(body); pg.userData.body = body;
  // a rugged drop case: chamfered body, dark bumpers on every vertical edge, a strap round the middle and a stencil
  mesh(slab('cr-body', 0.3, [[-0.15, 0.0], [0.15, 0.0], [0.15, 0.17], [0.12, 0.22], [-0.12, 0.22], [-0.15, 0.17]], 0.014), toon(0xd99a2b), body);
  mesh(slab('cr-strap', 0.312, [[-0.156, 0.09], [0.156, 0.09], [0.156, 0.13], [-0.156, 0.13]], 0.003), toon(0x6b4a1c), body);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(box(0.035, 0.2, 0.035), toon(0x3a2c18), body, [sx * 0.14, 0.1, sz * 0.14], null, flat);
  for (const sz of [-1, 1]) mesh(box(0.1, 0.03, 0.004), toon(0x2a2010), body, [0, 0.16, sz * 0.153], null, flat);
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
// dust that hangs, after game dust VFX: tan clouds that swell slowly, drift outward and take seconds to settle
const dustCol = () => (BIO && BIO.deco === 'snow' ? [0xf4f8fb, 0xdde6ee] : BIO && BIO.deco === 'yard' ? [0xb8aa98, 0x9a8e80] : [0xe2d6bc, 0xc8baa0]);
function dust(pos, n, r, spd) {
  const k = LEVEL === 'low' ? Math.ceil(n / 2) : n, [c0, c1] = dustCol();
  for (let i = 0; i < k; i++) {
    const a = rand(0, Math.PI * 2), d = rand(0, r || 0.3), v = rand(0.15, 0.5) * (spd || 1);
    BD.parts.spawn({ pos: new T.Vector3(pos.x + Math.cos(a) * d, Math.max(0.04, pos.y) + rand(0, 0.08), pos.z + Math.sin(a) * d), vel: new T.Vector3(Math.cos(a) * v, rand(0.03, 0.16), Math.sin(a) * v), add: false, life: rand(2.6, 4.4), size: rand(0.16, 0.28), size1: rand(0.65, 1.05), color: c0, color1: c1, op: 0.65 * (BD.dustK || 1), op1: 0, drag: 0.35 });
  }
}
// a ring of dust thrown out along the ground by a blast, a big gun firing or a heavy landing
function dustRing(pos, n, spd) {
  const k = LEVEL === 'low' ? Math.ceil(n / 2) : n, [c0, c1] = dustCol();
  for (let i = 0; i < k; i++) {
    const a = (i / k) * Math.PI * 2 + rand(-0.15, 0.15), v = rand(0.8, 1.4) * (spd || 1);
    BD.parts.spawn({ pos: new T.Vector3(pos.x + Math.cos(a) * 0.1, 0.06, pos.z + Math.sin(a) * 0.1), vel: new T.Vector3(Math.cos(a) * v, rand(0.02, 0.12), Math.sin(a) * v), add: false, life: rand(2.4, 3.8), size: 0.22, size1: rand(0.75, 1.1), color: c0, color1: c1, op: 0.7 * (BD.dustK || 1), op1: 0, drag: 0.22 });
  }
}
// a blackened patch on the ground that fades over several seconds
function scorch(pos, r) {
  const m = new T.Mesh(new T.CircleGeometry(r, 20), new T.MeshBasicMaterial({ color: 0x14110f, transparent: true, opacity: 0.55, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(pos.x, 0.012, pos.z); m.renderOrder = 2; BD.group.add(m);
  const t0 = clock();
  BD.anims.push(t => { const k = (t - t0) / 7; if (k >= 1) { BD.group.remove(m); m.geometry.dispose(); m.material.dispose(); return false; } m.material.opacity = 0.55 * (1 - k * k); return true; });
}
// a fireball, after stylised explosion VFX: a white flash, a hot core blooming outward and climbing as it cools
// from yellow through orange to deep red, dark smoke rolling up out of it and hanging, embers, burning debris,
// a scorch mark and dust thrown out along the ground
function fireball(pos, s) {
  s = s || 1;
  flash(pos.clone(), 0xfff4d0, 0.55 * s, 0.1);
  flash(pos.clone(), 0xff9a30, 1.3 * s, 0.3);
  BD.parts.burst(pos, Math.round(22 * s), { spd: 1.2 * s, life: 0.85, size: 0.2 * s, size1: 0.5 * s, color: 0xff9a2a, color1: 0x7a1606, op: 0.85, grav: -1.3, spread: 0.08 * s, drag: 0.22 });
  BD.parts.burst(pos, Math.round(8 * s), { spd: 0.5 * s, life: 0.45, size: 0.22 * s, size1: 0.08 * s, color: 0xffd060, color1: 0xff5a10, op: 0.9, grav: -0.6, spread: 0.05 * s });
  for (let i = 0; i < Math.round(12 * s); i++) BD.parts.spawn({ pos: pos.clone().add(new T.Vector3(rand(-0.15, 0.15) * s, rand(0, 0.2) * s, rand(-0.15, 0.15) * s)), vel: new T.Vector3(rand(-0.25, 0.25), rand(0.35, 0.8), rand(-0.25, 0.25)).multiplyScalar(Math.sqrt(s)), add: false, life: rand(2.2, 3.8), size: 0.24 * s, size1: 0.85 * s, color: 0x2e2826, color1: 0x6d6862, op: 0.7, op1: 0, drag: 0.45 });
  BD.parts.burst(pos, Math.round(20 * s), { spd: 3.2 * Math.sqrt(s), life: 1, size: 0.045, size1: 0.01, color: 0xffe2a0, color1: 0xff5a1a, grav: 3.5, upMin: 0.2 });
  BD.parts.chunks(pos.clone(), Math.round(5 * s), 0x3a3f46, { fire: true, spd: Math.sqrt(s) });
  shockRing(pos.clone().setY(0.04), 0xffc46b, 0.55 * s, 0.5);
  scorch(pos, 0.3 * s);
  dust(pos.clone().setY(0.05), Math.round(6 * s), 0.2 * s);
}
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
// a missile in flight, after missile-launch references: a pale body with a red nose cone, a flickering rocket
// flame and white-hot nozzle glow behind it, a short fire trail and a long smoke trail that billows and hangs;
// each one bursts into its own fireball where it lands
function missile(from, to, o) {
  const g = new T.Group(); g.scale.setScalar(1.9);
  mesh(cyl(0.016, 0.016, 0.11, 8), toon(0xd8dce0), g, [0, 0, 0], [Math.PI / 2, 0, 0], flat);
  mesh(cone(0.016, 0.04, 8), toon(0xd8382a), g, [0, 0, 0.075], [Math.PI / 2, 0, 0], flat);
  for (const a of [0, 1, 2, 3]) mesh(box(0.004, 0.03, 0.03), toon(0x5a5f66), g, [Math.cos(a * Math.PI / 2) * 0.018, Math.sin(a * Math.PI / 2) * 0.018, -0.045], [0, 0, a * Math.PI / 2], flat);
  const flame = new T.Mesh(cone(0.024, 0.22, 8), new T.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.95, blending: T.AdditiveBlending, depthWrite: false }));
  flame.rotation.x = -Math.PI / 2; flame.position.z = -0.16; g.add(flame);
  const inner = new T.Mesh(cone(0.012, 0.12, 8), new T.MeshBasicMaterial({ color: 0xffe8a0, transparent: true, opacity: 1, blending: T.AdditiveBlending, depthWrite: false }));
  inner.rotation.x = -Math.PI / 2; inner.position.z = -0.11; g.add(inner);
  const hot = new T.Mesh(sph(0.022, 8), new T.MeshBasicMaterial({ color: 0xfff4d0, transparent: true, opacity: 1, blending: T.AdditiveBlending, depthWrite: false }));
  hot.position.z = -0.06; g.add(hot);
  g.visible = false; BD.group.add(g);
  const t0 = clock() + (o.delay || 0), dur = o.dur, arc = o.arc || 0, prev = from.clone(), tail = new T.Vector3();
  BD.anims.push(t => {
    if (t < t0) return true;
    g.visible = true;
    const k = Math.min(1, (t - t0) / dur);
    // the launch is slow for a moment, then the motor catches and it accelerates
    const e = k < 0.15 ? k * k / 0.15 * 0.5 : 0.075 + (k - 0.15) / 0.85 * 0.925;
    const p = from.clone().lerp(to, e); p.y += Math.sin(e * Math.PI) * arc;
    g.position.copy(p); g.lookAt(BD.group.localToWorld(p.clone().add(p.clone().sub(prev).multiplyScalar(4))));
    flame.scale.set(1 + rand(-0.2, 0.2), 1 + rand(-0.25, 0.5), 1); inner.scale.y = 1 + rand(-0.2, 0.3);
    tail.copy(p).sub(prev).normalize().multiplyScalar(-0.22).add(p); prev.copy(p);
    for (let j = 0; j < (LEVEL === 'low' ? 1 : 2); j++) {
      BD.parts.spawn({ pos: tail.clone(), vel: new T.Vector3(rand(-0.08, 0.08), rand(-0.02, 0.06), rand(-0.08, 0.08)), life: 0.3, size: 0.11, size1: 0.03, color: 0xffc060, color1: 0xc8280c, op: 1, op1: 0 });
      BD.parts.spawn({ pos: tail.clone(), vel: new T.Vector3(rand(-0.06, 0.06), rand(0.04, 0.14), rand(-0.06, 0.06)), add: false, life: rand(1.8, 2.8), size: 0.1, size1: 0.42, color: 0xe2ded8, color1: 0x8f8a84, op: 0.6, op1: 0, drag: 0.5 });
    }
    if (k >= 1) { BD.group.remove(g); fireball(to.clone(), o.blast || 0.5); shake(0.08); return false; }
    return true;
  });
}
// electric arcs crawling along a beam, after laser-and-lightning VFX: jagged bolts that hug the beam, re-strike
// every few frames and wander along its length, with sparks thrown off where they jump
function beamArcs(from, to, col, life, amp, n, delay) {
  const dir = to.clone().sub(from), len = dir.length(); dir.normalize();
  const u = new T.Vector3(0, 1, 0).cross(dir); if (u.lengthSq() < 1e-4) u.set(1, 0, 0); u.normalize();
  const v = dir.clone().cross(u).normalize();
  // each bolt is a thin glowing tube: a white-hot core inside a wider coloured glow, so it reads at any zoom
  const mats = [[new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: T.AdditiveBlending, depthWrite: false }), 0.007], [new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.6, blending: T.AdditiveBlending, depthWrite: false }), 0.02]];
  const t0 = clock() + (delay || 0); let next = 0; const lines = [];
  const clear = () => { lines.forEach(l => { BD.group.remove(l); l.geometry.dispose(); }); lines.length = 0; };
  BD.anims.push(t => {
    if (t < t0) return true;
    const k = (t - t0) / life;
    if (k >= 1) { clear(); mats.forEach(([m]) => m.dispose()); return false; }
    if (t >= next) {
      next = t + 0.04; clear();
      for (let j = 0; j < n; j++) {
        const a = rand(0, 0.75), b = Math.min(1, a + rand(0.18, 0.4)), seg = 12, pts = [];
        for (let i = 0; i <= seg; i++) {
          const q = a + (b - a) * i / seg, taper = Math.sin(Math.PI * i / seg), w = amp * (0.4 + taper);
          pts.push(from.clone().addScaledVector(dir, q * len).addScaledVector(u, rand(-w, w)).addScaledVector(v, rand(-w, w)));
        }
        const path = new T.CurvePath(); for (let i = 1; i < pts.length; i++) path.add(new T.LineCurve3(pts[i - 1], pts[i]));
        for (const [m, r] of mats) { const l = new T.Mesh(new T.TubeGeometry(path, pts.length - 1, r, 4, false), m); BD.group.add(l); lines.push(l); }
        if (Math.random() < 0.5) BD.parts.spawn({ pos: pts[(Math.random() * pts.length) | 0].clone(), vel: new T.Vector3(rand(-0.6, 0.6), rand(-0.2, 0.8), rand(-0.6, 0.6)), life: 0.25, size: 0.04, size1: 0.01, color: 0xffffff, color1: col, op: 1, op1: 0 });
      }
    }
    mats.forEach(([m], i) => { m.opacity = (1 - k) * (i ? 0.6 : 1) * (Math.random() < 0.15 ? 0.3 : 1); });
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

// fire one weapon. Every weapon has a profile: how long it winds up and how (the arm pulled back, raised,
// a barrel spinning up, coils charging), what leaves the muzzle, how long it takes to land, and how hard it hits.
// Returns { fire, land }: seconds from `start` until it goes off and until it lands.
const ANTICIPATION = 0.42;  // the wind-up of anything without a profile of its own
// effects: the whole battle can run faster (AI vs AI on fast); the wind-ups shrink with it
R3.setPace = function (k) { if (BD) BD.pace = k; PACE = k; };
let PACE = 1;
const paced = s => s * PACE;

// small helpers for the effects below
function casing(from, dir) {
  if (LEVEL === 'low') return;
  const side = new T.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(rand(0.6, 1.1));
  BD.parts.spawn({ pos: from.clone(), vel: side.add(new T.Vector3(0, rand(1, 1.6), 0)), add: false, life: 0.5, size: 0.03, size1: 0.025, color: 0xd9a441, color1: 0x8a6a2a, op: 1, op1: 0.6, grav: 6 });
}
function shockRing(pos, col, r, life, vertical, dir) {
  const m = new T.Mesh(new T.RingGeometry(0.06, 0.1, 32), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
  m.position.copy(pos);
  if (vertical && dir) m.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), dir.clone().normalize()); else m.rotation.x = -Math.PI / 2;
  BD.group.add(m);
  const t0 = clock();
  BD.anims.push(t => { const k = (t - t0) / life; if (k >= 1) { BD.group.remove(m); m.geometry.dispose(); m.material.dispose(); return false; } m.scale.setScalar(1 + k * r * 10); m.material.opacity = 0.95 * (1 - k); return true; });
}
function screenFlash(op, col) {
  if (LEVEL === 'low' || typeof document === 'undefined') return;
  const host = BD.el; if (!host) return;
  const d = document.createElement('div');
  d.style.cssText = 'position:absolute;inset:0;pointer-events:none;background:' + (col || '#fff') + ';opacity:' + op + ';transition:opacity .35s ease-out;z-index:5';
  host.appendChild(d); requestAnimationFrame(() => { d.style.opacity = '0'; }); setTimeout(() => d.remove(), 420);
}
// crackling arcs round a point, while something charges
function arcsAround(getP, col, dur, n) {
  const t0 = clock();
  BD.anims.push(t => {
    const k = (t - t0) / dur; if (k >= 1) return false;
    if (Math.random() < 0.35 + k * 0.5) { const p = getP(); const q = p.clone().add(new T.Vector3(rand(-0.25, 0.25), rand(-0.2, 0.25), rand(-0.25, 0.25)).multiplyScalar(0.6 + k)); lightning(p, q, col, 0.08); }
    return true;
  });
}
// a heavy shell landing, after artillery-impact references: a big fireball, a column of dirt thrown straight up
// that rains back down, debris, a wide ring of dust rolling out along the ground and hanging, and a hard shake
function artilleryImpact(to, hit) {
  const g = to.clone().setY(0.08);
  fireball(hit ? to.clone() : g.clone(), 2.1);
  for (let i = 0; i < (LEVEL === 'low' ? 10 : 22); i++) BD.parts.spawn({ pos: g.clone().add(new T.Vector3(rand(-0.1, 0.1), 0, rand(-0.1, 0.1))), vel: new T.Vector3(rand(-0.25, 0.25), rand(2.2, 3.6), rand(-0.25, 0.25)), life: rand(0.4, 0.7), size: 0.22, size1: 0.45, color: 0xffb040, color1: 0x8a1a06, op: 0.9, op1: 0, grav: 1.5, drag: 0.4 });
  const [c0] = dustCol();
  for (let i = 0; i < (LEVEL === 'low' ? 16 : 36); i++) BD.parts.spawn({ pos: g.clone().add(new T.Vector3(rand(-0.15, 0.15), 0, rand(-0.15, 0.15))), vel: new T.Vector3(rand(-0.7, 0.7), rand(2.4, 4.4), rand(-0.7, 0.7)), add: false, life: rand(1.2, 1.9), size: rand(0.12, 0.24), size1: 0.32, color: 0x4a3a2c, color1: c0, op: 0.9, op1: 0, grav: 4.5 });
  BD.parts.chunks(g.clone(), 10, 0x4b4239, { spd: 1.5 });
  dustRing(g, 26, 1.3);
  shockRing(g.clone().setY(0.05), 0xffffff, 1.2, 0.6);
  shake(0.42); screenFlash(0.3, '#ffb060');
}
// a rail slug punching through, after rail-gun impact references: a white-hot pierce flash, rings of light
// along the shot line, sparks sprayed out of the far side, a burst of fire and dust, and a hard shake
function railImpact(to, col) {
  flash(to.clone(), 0xffffff, 1.6, 0.2);
  sparks(to, 0xffffff, 40); sparks(to, col, 26);
  shockRing(to.clone(), col, 0.7, 0.55); shockRing(to.clone(), 0xffffff, 0.45, 0.4);
  fireball(to.clone(), 0.8);
  dustRing(to.clone().setY(0.06), 16, 1);
  shake(0.36); screenFlash(0.4);
}
// what a hit does, by weight: sparks for light rounds, fire, frost, a shock pulse, or a real explosion
function impactFx(to, kind, col, hit) {
  if (kind === 'missile') { shake(0.14); dust(to.clone().setY(0.05), 6, 0.3); return; }
  if (kind === 'artillery') { artilleryImpact(to, hit); return; }
  if (kind === 'rail' && hit) { railImpact(to, col); return; }
  if (!hit) { smoke(to.clone(), 3, false); dust(to.clone().setY(0.05), 4, 0.15); BD.parts.burst(to, 8, { spd: 1.2, life: 0.45, size: 0.05, color: 0xc8c0a8, grav: 3, upMin: 0.3 }); return; }
  if (kind === 'light') { sparks(to, col, 10); flash(to.clone(), col, 0.28, 0.1); }
  else if (kind === 'medium') { sparks(to, col, 18); flash(to.clone(), 0xffffff, 0.45, 0.12); smoke(to.clone(), 2, false); shake(0.03); }
  else if (kind === 'heavy') { fireball(to, 0.7); sparks(to, 0xffe2a0, 16); shake(0.09); }
  else if (kind === 'blast') { fireball(to, 1.1); shake(0.14); }
  else if (kind === 'pierce') { flash(to.clone(), 0xffffff, 0.8, 0.14); sparks(to, 0xffffff, 26); sparks(to, col, 14); shockRing(to.clone(), col, 0.35, 0.4); shake(0.1); }
  else if (kind === 'rail') railImpact(to, col);
  else if (kind === 'fire') { BD.parts.burst(to, 22, { spd: 1, life: 0.7, size: 0.14, size1: 0.36, color: 0xffd27a, color1: 0xff3a1a, grav: -1.5 }); smoke(to.clone(), 3, false); shake(0.03); }
  else if (kind === 'frost') { BD.parts.burst(to, 22, { spd: 1.4, life: 0.7, size: 0.08, size1: 0.01, color: 0xffffff, color1: 0x8fdcff, grav: 1 }); flash(to.clone(), 0xbfefff, 0.6, 0.18); shockRing(to.clone(), 0xbfefff, 0.3, 0.45); }
  else if (kind === 'shock') { flash(to.clone(), 0x9fe8ff, 0.7, 0.2); shockRing(to.clone(), 0x9fe8ff, 0.5, 0.5); for (let i = 0; i < 4; i++) lightning(to, to.clone().add(new T.Vector3(rand(-0.5, 0.5), rand(-0.1, 0.5), rand(-0.5, 0.5))), 0x9fe8ff, 0.25, i * 0.05); shake(0.05); }
  else if (kind === 'slash') { sparks(to, col, 22); flash(to.clone(), 0xffffff, 0.5, 0.1); shake(0.06); }
  else if (kind === 'crush') { sparks(to, 0xffe2a0, 24); smoke(to.clone(), 4, false); BD.parts.chunks(to.clone(), 4, 0x3a3f46); shockRing(to.clone().setY(0.04), 0xffd08a, 0.4, 0.4); shake(0.12); }
  else { sparks(to, col, 12); flash(to.clone(), col, 0.3, 0.1); }
}

/* The profiles. wind: seconds of anticipation. pose: what the arm does while winding up
   ('aim' raise and steady, 'pull' cock back, 'raise' lift high like a mortar, 'brace' lean back and plant).
   charge: the glow gathering at the muzzle (colour and how big it gets). spin: barrels spin up first.
   fire(ctx): what leaves the muzzle; returns seconds until it lands. impact: impactFx kind. */
const FIRE = {
  b_gun: { wind: 0.55, pose: 'aim', charge: { col: 0xffd890, size: 1 }, impact: 'light',
    fire: c => { for (let i = 0; i < 3; i++) schedule(i * 0.07, () => { flash(c.from.clone(), 0xffe9a8, 0.3, 0.07); projectile(c.from, c.to, { color: c.col, dur: 0.14 }); casing(c.from, c.dir); c.kick(0.6); }); return 0.3; } },
  w_smg: { wind: 0.45, pose: 'aim', charge: { col: 0xffd890, size: 0.7 }, impact: 'light',
    fire: c => { for (let i = 0; i < 6; i++) schedule(i * 0.045, () => { flash(c.from.clone(), 0xffe9a8, 0.2, 0.05); projectile(c.from, c.jitter(0.12), { color: c.col, dur: 0.12 }); if (i % 2) casing(c.from, c.dir); c.kick(0.3); }); return 0.38; } },
  w_gatling: { wind: 0.95, pose: 'brace', spin: true, charge: { col: 0xffb060, size: 0.8, heat: true }, impact: 'medium',
    fire: c => { for (let i = 0; i < 12; i++) schedule(i * 0.045, () => { flash(c.from.clone(), 0xffe9a8, 0.26, 0.05); projectile(c.from, c.jitter(0.15), { color: 0xffe6a0, dur: 0.12 }); casing(c.from, c.dir); c.kick(0.35); if (i % 3 === 0) sparks(c.jitter(0.2), 0xffe2a0, 4); }); schedule(0.55, () => smoke(c.from.clone(), 3, false)); return 0.62; } },
  w_scatter: { wind: 0.6, pose: 'pull', charge: { col: 0xffd890, size: 0.9 }, impact: 'medium',
    fire: c => { flash(c.from.clone(), 0xfff2c0, 0.6, 0.12); smoke(c.from.clone(), 4, false); c.kick(1.6); shake(0.04); for (let i = 0; i < 9; i++) projectile(c.from, c.jitter(0.3), { color: 0xffe6a0, dur: 0.13, geo: box(0.02, 0.02, 0.08) }); casing(c.from, c.dir); return 0.16; } },
  w_rail: { wind: 2.0, pose: 'brace', long: true, charge: { col: 0x9fd8ff, size: 2.6, coil: true, ground: true }, impact: 'rail',
    fire: c => { longShot(c, 0x9fd8ff, 0.8); beam(c.from, c.to, 0x9fd8ff, 0.09, 0.6); beam(c.from, c.to, 0xffffff, 0.04, 0.35); beamArcs(c.from, c.to, 0xbfe8ff, 0.55, 0.12, 3); c.kick(2.6); return 0.06; } },
  s_railgun: { wind: 2.6, pose: 'brace', long: true, charge: { col: 0xbfe8ff, size: 3.6, coil: true, ground: true }, impact: 'rail',
    fire: c => { longShot(c, 0xbfe8ff, 1.2); beam(c.from, c.to, 0xbfe8ff, 0.14, 0.8); beam(c.from, c.to, 0xffffff, 0.06, 0.45); beamArcs(c.from, c.to, 0xdff4ff, 0.7, 0.16, 4); c.kick(3.4); return 0.06; } },
  w_missile: { wind: 0.7, pose: 'raise', charge: { col: 0xffb070, size: 0.9 }, impact: 'missile',
    fire: c => { for (let i = 0; i < 4; i++) schedule(i * 0.1, () => { const o = c.from.clone().add(new T.Vector3(rand(-0.06, 0.06), 0, rand(-0.06, 0.06))); flash(o.clone(), 0xffd8a0, 0.35, 0.08); backBlast(c, o); missile(o, c.jitter(0.16), { dur: 0.62, arc: rand(0.5, 0.85), blast: 0.45 }); c.kick(0.5); shake(0.03); }); return 0.95; } },
  w_howitzer: { wind: 2.0, pose: 'raise', long: true, charge: { col: 0xffd08a, size: 1.8, ground: true }, impact: 'artillery',
    fire: c => { longShot(c, 0xffd08a, 1); projectile(c.from, c.to, { geo: sph(0.05, 10), color: 0xffd27a, dur: 0.85, arc: 1.8, trail: 'fire' }); c.kick(3); return 0.88; } },
  w_laser: { wind: 0.7, pose: 'aim', charge: { col: 0x9cf0ff, size: 1.6 }, impact: 'medium',
    fire: c => { flash(c.from.clone(), 0x9cf0ff, 0.55, 0.2); beam(c.from, c.to, 0x7fe8ff, 0.055, 0.55); beam(c.from, c.to, 0xffffff, 0.022, 0.45); beamArcs(c.from, c.to, 0xbff6ff, 0.75, 0.15, 4); c.kick(0.6); shake(0.03); return 0.06; } },
  w_lance: { wind: 1.05, pose: 'brace', charge: { col: 0xc8a0ff, size: 2.6, coil: true }, impact: 'pierce',
    fire: c => { flash(c.from.clone(), 0xe8d0ff, 0.9, 0.22); beam(c.from, c.to, 0xb08cff, 0.09, 0.65); beam(c.from, c.to, 0xffffff, 0.035, 0.5); beamArcs(c.from, c.to, 0xd8b8ff, 0.85, 0.2, 5); for (let i = 0; i < 14; i++) BD.parts.spawn({ pos: c.from.clone().lerp(c.to, Math.random()), vel: new T.Vector3(rand(-0.4, 0.4), rand(-0.2, 0.5), rand(-0.4, 0.4)), life: 0.5, size: 0.05, size1: 0.01, color: 0xe0c8ff, op: 1, op1: 0 }); c.kick(1.4); shake(0.08); return 0.06; } },
  w_arc: { wind: 0.75, pose: 'aim', charge: { col: 0x9fe8ff, size: 1.4, coil: true }, impact: 'shock',
    fire: c => { for (let i = 0; i < 4; i++) lightning(c.from, c.jitter(0.1), 0x9fe8ff, 0.32, i * 0.06); flash(c.from.clone(), 0x9fe8ff, 0.5, 0.2); c.kick(0.7); return 0.12; } },
  s_emp: { wind: 0.95, pose: 'aim', charge: { col: 0x7fd4ff, size: 2.4, coil: true, ring: true }, impact: 'shock',
    fire: c => { flash(c.from.clone(), 0xcff4ff, 0.7, 0.2); projectile(c.from, c.to, { geo: sph(0.09, 12), color: 0x8fe0ff, dur: 0.3 }); shockRing(c.from.clone(), 0x7fd4ff, 0.3, 0.35, true, c.dir); c.kick(1); return 0.32; } },
  s_inferno: { wind: 0.8, pose: 'brace', charge: { col: 0xff8a3a, size: 1.4, flame: true }, impact: 'fire',
    fire: c => { const d = c.to.clone().sub(c.from), sp = d.length() / 0.32; for (let i = 0; i < (LEVEL === 'low' ? 16 : 40); i++) schedule(i * 0.012, () => BD.parts.spawn({ pos: c.from.clone(), vel: d.clone().normalize().multiplyScalar(sp * rand(0.85, 1.1)).add(new T.Vector3(rand(-0.35, 0.35), rand(-0.1, 0.35), rand(-0.35, 0.35))), life: 0.38, size: 0.08, size1: 0.3, color: 0xfff0a0, color1: 0xff4a1a, op: 1, op1: 0 })); c.kick(0.8); shake(0.03); return 0.5; } },
  s_cryo: { wind: 0.9, pose: 'aim', charge: { col: 0xcff4ff, size: 2, mist: true }, impact: 'frost',
    fire: c => { flash(c.from.clone(), 0xffffff, 0.5, 0.2); beam(c.from, c.to, 0xbfefff, 0.06, 0.55); for (let i = 0; i < 16; i++) BD.parts.spawn({ pos: c.from.clone().lerp(c.to, Math.random()), vel: new T.Vector3(rand(-0.3, 0.3), rand(0, 0.4), rand(-0.3, 0.3)), life: 0.7, size: 0.07, size1: 0.01, color: 0xffffff, color1: 0x8fdcff, op: 0.95 }); c.kick(0.9); return 0.08; } },
  w_blade: { wind: 0.6, pose: 'pull', charge: { col: 0xff9adf, size: 1.2 }, impact: 'slash', melee: true,
    fire: c => { slash(c.to, 0xff9adf, 0.02, false); slash(c.to, 0xffffff, 0.1, true); slash(c.to, 0xff9adf, 0.18, false); return 0.2; } },
  w_ram: { wind: 0.7, pose: 'pull', charge: { col: 0xffc080, size: 1 }, spin: true, impact: 'crush', melee: true,
    fire: c => { slash(c.to, 0xffd08a, 0.05, false); return 0.22; } },
  w_repair: { wind: 0.5, pose: 'aim', charge: { col: 0x9fd8b4, size: 1 }, impact: 'light',
    fire: c => { beam(c.from, c.to, 0x9fd8b4, 0.03, 0.5); return 0.08; } }
};
// a long gun going off, after artillery-firing references: a fireball blown out of the muzzle along the shot,
// a shock ring at the muzzle, a ring of dust blasted out along the ground under the shooter, a massive shake and
// a flash across the screen
function longShot(c, col, s) {
  const d = c.to.clone().sub(c.from).normalize();
  flash(c.from.clone(), 0xffffff, 1.6 * s, 0.22);
  for (let i = 0; i < Math.round(22 * s); i++) BD.parts.spawn({ pos: c.from.clone(), vel: d.clone().multiplyScalar(rand(1.2, 3.2)).add(new T.Vector3(rand(-0.5, 0.5), rand(-0.2, 0.6), rand(-0.5, 0.5))), life: rand(0.25, 0.45), size: 0.12 * s, size1: 0.4 * s, color: 0xfff0c0, color1: 0xd8481a, op: 1, op1: 0, drag: 0.15 });
  for (let i = 0; i < Math.round(10 * s); i++) BD.parts.spawn({ pos: c.from.clone(), vel: d.clone().multiplyScalar(rand(0.4, 1.2)).add(new T.Vector3(rand(-0.3, 0.3), rand(0, 0.4), rand(-0.3, 0.3))), add: false, life: rand(1.8, 3), size: 0.18 * s, size1: 0.7 * s, color: 0x8f8a84, color1: 0x5d5a56, op: 0.6, op1: 0, drag: 0.4 });
  shockRing(c.from.clone(), col, 0.7 * s, 0.5, true, c.dir);
  if (c.att) { const g = c.att.R.root.position.clone().setY(0.05); dustRing(g, Math.round(22 * s), 1.1); shockRing(g, 0xffffff, 0.8 * s, 0.5); }
  shake(0.32 + 0.12 * s); screenFlash(0.35);
}
// a rocket leaving its tube: a jet of flame and a cloud of smoke blown out behind the rack
function backBlast(c, o) {
  const back = c.to.clone().sub(c.from).setY(0).normalize().multiplyScalar(-1);
  for (let i = 0; i < 4; i++) BD.parts.spawn({ pos: o.clone(), vel: back.clone().multiplyScalar(rand(0.6, 1.4)).add(new T.Vector3(rand(-0.2, 0.2), rand(0, 0.3), rand(-0.2, 0.2))), life: 0.25, size: 0.08, size1: 0.18, color: 0xffd27a, color1: 0xd8381a, op: 1, op1: 0 });
  for (let i = 0; i < 4; i++) BD.parts.spawn({ pos: o.clone(), vel: back.clone().multiplyScalar(rand(0.3, 0.8)).add(new T.Vector3(rand(-0.2, 0.2), rand(0.05, 0.3), rand(-0.2, 0.2))), add: false, life: rand(1.6, 2.6), size: 0.1, size1: 0.45, color: 0xd8d4ce, color1: 0x8f8a84, op: 0.55, op1: 0, drag: 0.45 });
}
// seconds from the shot leaving the muzzle to the impact, per weapon
const FLIGHT = { b_gun: 0.3, w_smg: 0.38, w_gatling: 0.62, w_scatter: 0.16, w_rail: 0.06, s_railgun: 0.06, w_missile: 0.95, w_howitzer: 0.88, w_laser: 0.06, w_lance: 0.06, w_arc: 0.12, s_emp: 0.32, s_inferno: 0.5, s_cryo: 0.08, w_blade: 0.2, w_ram: 0.22, w_repair: 0.08 };
// volleys, as the profiles above fire them: how many rounds, seconds between them, and each one's flight time
const SALVO = { w_missile: [4, 0.1, 0.62], w_gatling: [12, 0.045, 0.12], w_smg: [6, 0.045, 0.12], b_gun: [3, 0.07, 0.14], turret: [3, 0.05, 0.16] };
// fallbacks by weapon class, for anything without its own profile
const FIRE_CAT = { ballistic: 'b_gun', energy: 'w_laser', missile: 'w_missile', artillery: 'w_howitzer', melee: 'w_blade', siege: 'w_ram', support: 'w_repair', incendiary: 's_inferno', cryo: 's_cryo' };

// the wind-up: a glow gathering at the muzzle (bigger for bigger guns), coils crackling round railguns and lances,
// frost mist, a pilot flame, a ring tightening, or dust kicked up as a big gun plants itself
function charge(att, cat, dur, slotKey, P) {
  if (!att) return;
  att.aimT = clock(); att.aimKey = slotKey || null;
  P = P || {};
  const ch = P.charge || {}, col = ch.col || FX_COL[cat] || 0xffffff, big = ch.size || 1;
  att.wind = { t0: clock(), dur, pose: P.pose || 'aim', key: slotKey, spin: !!P.spin };
  const m = new T.Mesh(sph(0.05, 12), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false }));
  const core = new T.Mesh(sph(0.025, 8), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false }));
  BD.group.add(m); BD.group.add(core);
  const t0 = clock();
  if (ch.coil) arcsAround(() => muzzleWorld(att, cat, slotKey), col, dur);
  if (ch.ground) schedule(dur * 0.35, () => { const p = att.R.root.position.clone().setY(0.05); dust(p, 8, 0.3, 0.6); shockRing(p, 0xcbbf9e, 0.45, 0.6); shake(0.05); });
  if (P.long) for (let i = 1; i < 10; i++) schedule(dur * i / 10, () => { if (att.gone) return; const p = att.R.root.position.clone().setY(0.05); shake(0.01 + 0.035 * i / 10); if (i % 3 === 0) dust(p, 3, 0.35, 0.4); });
  BD.anims.push(t => {
    const k = (t - t0) / dur;
    if (k >= 1 || att.gone) { BD.group.remove(m); BD.group.remove(core); m.material.dispose(); core.material.dispose(); return false; }
    const p = muzzleWorld(att, cat, slotKey), e = k * k;
    m.position.copy(p); core.position.copy(p);
    m.scale.setScalar((0.5 + e * 2.2 * big) * (1 + Math.sin(t * (30 + 40 * k)) * 0.15)); m.material.opacity = 0.15 + 0.8 * k;
    core.scale.setScalar(0.5 + e * 1.6 * big); core.material.opacity = k > 0.3 ? (k - 0.3) / 0.7 : 0;
    if (LEVEL !== 'low' && Math.random() < 0.5 + k * 0.4) {
      if (ch.mist) BD.parts.spawn({ pos: p.clone(), vel: new T.Vector3(rand(-0.3, 0.3), rand(-0.1, 0.2), rand(-0.3, 0.3)), add: false, life: 0.7, size: 0.06, size1: 0.22, color: 0xeaf8ff, op: 0.6, op1: 0 });
      else if (ch.flame) BD.parts.spawn({ pos: p.clone(), vel: new T.Vector3(rand(-0.1, 0.1), rand(0.2, 0.5), rand(-0.1, 0.1)), life: 0.3, size: 0.05, size1: 0.12, color: 0xffd27a, color1: 0xff3a1a, op: 1, op1: 0 });
      else if (ch.heat) BD.parts.spawn({ pos: p.clone(), vel: new T.Vector3(rand(-0.2, 0.2), rand(0.2, 0.6), rand(-0.2, 0.2)), life: 0.3, size: 0.025, size1: 0.005, color: 0xffd27a, color1: 0xff5a1a, op: 1, op1: 0 });
      const o = new T.Vector3(rand(-0.35, 0.35), rand(-0.2, 0.35), rand(-0.35, 0.35)).multiplyScalar(0.7 + big * 0.3);
      BD.parts.spawn({ pos: p.clone().add(o), vel: o.clone().multiplyScalar(-3.4), life: 0.28, size: 0.035 * (0.8 + big * 0.3), size1: 0.01, color: col, op: 0.95, op1: 0 });
    }
    return true;
  });
  if (ch.ring) shockRing(muzzleWorld(att, cat, slotKey), col, -0.06, dur);
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
// follow: the second and later rounds of a multi-shot weapon fire straight away, without winding up again
function shoot(f, start, follow) {
  const att = (f.uid && BD.recs[f.uid]) || recAt(f.x0, f.y0, false) || recAt(f.x0, f.y0, true);
  const tgtRec = recAt(f.x1, f.y1, false);
  let to = tp(f.x1, f.y1, 0.45);
  // aim at the middle of the target's body, whatever its size, not a fixed height that can land on its legs
  if (tgtRec) { const bb = new T.Box3().setFromObject(tgtRec.R.root); to = bb.isEmpty() ? tgtRec.R.root.position.clone().add(new T.Vector3(0, 0.45, 0)) : bb.getCenter(new T.Vector3()).setY(bb.min.y + (bb.max.y - bb.min.y) * 0.6); }
  if (window.MW.baseAt(f.x1, f.y1) != null) to = tp(f.x1, f.y1, 0.35);
  if (!f.hit) to.add(new T.Vector3(rand(-0.45, 0.45), -0.25, rand(-0.45, 0.45)));
  const cat = f.cat || 'ballistic', col = FX_COL[cat] || 0xffffff;
  const mz = att && f.key && att.R.muzzles[f.key];
  const wid = (mz && mz.id) || FIRE_CAT[cat];
  const P = cat === 'turret' ? null : FIRE[wid] || FIRE[FIRE_CAT[cat]];
  const wind = follow ? 0.05 : paced(P ? P.wind : ANTICIPATION);
  let from;
  if (cat === 'turret') {
    const b = BD['base' + window.MW.baseAt(f.x0, f.y0)];
    if (b) { const bp = b.pg.position; const d = to.clone().sub(bp); b.tur.rotation.y = Math.atan2(d.x, d.z) - b.pg.rotation.y; b.pg.updateMatrixWorld(true); from = new T.Vector3(); b.mu.getWorldPosition(from); BD.group.worldToLocal(from); }
    else from = tp(f.x0, f.y0, 0.7);
  } else if (att) from = null;
  else from = tp(f.x0, f.y0, 0.5);
  if (!follow) schedule(start, () => {
    if (att) { faceTo(att, to); charge(att, cat, wind, f.key, P); }
    else if (cat === 'turret') { flash(from.clone(), 0xff7050, 0.35, wind); arcsAround(() => from, 0xff7050, wind); }
    reticle(tp(f.x1, f.y1), wind + 0.3);
  });
  if (P && P.melee && att) att.lunge = { t0: clock() + start + wind - 0.12, to };
  let travel = 0.2;
  // the flight time is known up front for each profile, so impacts and damage numbers line up
  const est = FLIGHT;
  if (P) travel = follow ? Math.min(0.2, est[wid] || 0.2) : est[wid] || 0.2;
  schedule(start + wind, () => {
    if (!from) from = muzzleWorld(att, cat, f.key);
    const dir = to.clone().sub(from).setY(0);
    if (att) { att.recoil = clock(); att.recoilAmp = 1; att.wind = null; const m2 = att.R.muzzles[att.lastArm]; if (m2 && m2.spin) att.spin = clock(); }
    if (cat === 'turret') { flash(from.clone(), 0xffe9a8, 0.4, 0.1); for (let i = 0; i < 3; i++) projectile(from, to, { color: col, dur: 0.16, delay: i * 0.05 }); smoke(from.clone(), 2, false); return; }
    const ctx = { att, from, to, col, dir, f,
      jitter: s => to.clone().add(new T.Vector3(rand(-s, s), rand(-s, s) * 0.6, rand(-s, s))),
      kick: a => { if (att) { att.recoil = clock(); att.recoilAmp = a; } } };
    if (follow) { flash(from.clone(), 0xffe9a8, 0.25, 0.06); projectile(from, to, { color: col, dur: 0.14 }); if (att) att.recoil = clock(); return; }
    P.fire(ctx);
  });
  schedule(start + wind + travel, () => {
    impactFx(to, P ? (follow ? 'light' : P.impact) : 'medium', col, f.hit);
    if (f.hit && tgtRec) tgtRec.hitT = clock();
    const bpid = window.MW.baseAt(f.x1, f.y1); if (f.hit && bpid != null) smoke(to.clone(), 4, false);
  });
  return { fire: wind, land: wind + travel };
}

// sound rides the same timeline as the pictures: a cue at the moment its animation happens, panned to its column
const sfx = (at, name, o) => { const S = window.SFX; if (S) S.play(name, Object.assign({ delay: Math.max(0, at) }, o)); };
const panX = x => { const W = window.MW.W || 9; return W > 1 ? (x / (W - 1) * 2 - 1) * 0.7 : 0; };
const legMode = uid => { const m = window.MW.fieldMech(uid), l = m && m.slots.legs && window.MW.DEFS[m.slots.legs.id]; return { mode: l ? (l.entrench ? 'entrench' : l.mode) : null, heavy: !!(m && m.slots.torso && window.MW.DEFS[m.slots.torso.id].size >= 3) }; };
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
  const mv = list.find(f => f.k === 'move' && f.path && f.path.length > 1);
  const hop = mv && mv.jump ? 1.1 + 0.1 * (mv.path.length - 1) : 0;
  if (spots.length && clock() - BD.userT > 1.2) {
    const was = Object.assign({}, BD.rig);
    iso(BD.rigT);
    focusTiles(spots, hop ? 1 : 1.6, 2.5, hop);
    // a move is followed all the way: the camera travels with the mech and only settles once it has landed
    if (mv) BD.follow = { uid: mv.uid, t0: clock(), seen: false };
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
      rec.walk = { pts, t0: clock() + base, dur: f.jump ? 0.35 + 0.12 * (all.length - 1) : 0.4 * (pts.length - 1), hop: f.jump ? 1.1 + 0.1 * (all.length - 1) : 0 };
      const lm = legMode(f.uid), ex = f.path[f.path.length - 1][0];
      sfx(base, f.phase ? 'phase' : f.jump ? 'jump' : 'walk', Object.assign({ steps: f.path.length - 1, dur: rec.walk.dur, pan: panX(ex) }, lm));
      rec.R.root.position.copy(pts[0]);
      tShot = Math.max(tShot, base + rec.walk.dur + 0.1);
    } else if (f.k === 'deploy') {
      const rec = BD.recs[f.uid]; if (!rec) return;
      rec.drop = { t0: clock() + base, dur: 0.6 };
      sfx(base, 'deploy', { pan: panX(f.x) });
      tShot = Math.max(tShot, base + 0.7);
    } else if (f.k === 'enter') {
      const rec = Object.values(BD.recs).find(r => r.uid === f.uid);
      if (rec) { rec.claimed = true; const b = window.MW.S.players[f.owner].base; rec.leave = { t0: clock() + base, dur: 0.7, to: tp(b.x, b.y) }; tShot = Math.max(tShot, base + 0.75); }
      sfx(base, 'enter', { pan: panX(f.x) });
    } else if (f.k === 'boom' || f.k === 'nuke' || f.k === 'strip') {
      const rec = (f.uid && BD.recs[f.uid]) || recAt(f.x, f.y, true);
      if (rec) rec.claimed = true;
    }
  });
  const pairN = {}, fired = {};
  sub.forEach(f => {
    if (f.k !== 'shot') return;
    const pk = [f.x0, f.y0, f.x1, f.y1, f.key || ''].join();
    const n = pairN[pk] = (pairN[pk] || 0) + 1, prev = fired[pk];
    // the same weapon firing again at the same target: straight on from the last round; anything else waits its turn
    const follow = n > 1 && prev != null;
    const start = follow ? prev + 0.18 : Math.max(tShot, ...Object.values(fired).map(v => v + 0.35));
    const r = shoot(f, follow ? start - 0.05 : start, follow);
    const att = f.uid && window.MW.fieldMech(f.uid), wi = att && f.key && window.MW.getSlot(att, f.key);
    // one sound per projectile the animation launches, each landing when its own round or missile does
    const wid = f.cat === 'turret' ? 'turret' : (wi && wi.id) || FIRE_CAT[f.cat || 'ballistic'], sv = !follow && SALVO[wid];
    const t0 = (follow ? start - 0.05 : start) + r.fire, so = { cat: f.cat, wid: wi && wi.id, n: sv ? sv[0] : 1, gap: sv ? sv[1] : 0 };
    sfx(t0, 'fire', Object.assign({ pan: panX(f.x0) }, so));
    sfx(sv ? t0 + sv[2] : (follow ? start - 0.05 : start) + r.land, 'impact', Object.assign({ hit: f.hit, pan: panX(f.x1) }, so));
    fired[pk] = start + r.fire;
    const k = key(f.x1, f.y1);
    impact[k] = Math.max(impact[k] || 0, start + r.land);
  });
  endP = Math.max(endP, tShot, ...Object.values(impact));
  sub.forEach((f, j) => {
    const i = idx[j], k = key(f.x, f.y);
    if (f.k === 'float') {
      delays[i] = Math.round(1000 * (impact[k] != null ? impact[k] : tShot));
      const cue = { Overclock: 'overclock', Cloaked: 'cloak', Overwatch: 'overwatch' }[f.t] || (f.c === 'good' && impact[k] == null ? (/HP/.test(f.t) ? 'heal' : 'pickup') : null);
      if (cue) sfx(delays[i] / 1000, cue, { pan: panX(f.x) });
      return;
    }
    const at = (impact[k] != null ? impact[k] + 0.15 : tShot) + 0.05;
    if (f.k === 'boom' || f.k === 'nuke') endP = Math.max(endP, at + (f.k === 'nuke' ? 2 : 2.2));
    if (f.k === 'boom') {
      delays[i] = at * 1000;
      const rec = (f.uid && BD.recs[f.uid]) || recAt(f.x, f.y, true) || null;
      schedule(at, () => destroyMech(rec, tp(f.x, f.y, 0.4)));
      sfx(at, 'boom', { pan: panX(f.x) });
    } else if (f.k === 'nuke') {
      const rec = (f.uid && BD.recs[f.uid]) || recAt(f.x, f.y, true);
      if (rec) rec.charging = clock();
      schedule(at + 0.7, () => nuke(f, rec));
      sfx(at, 'charge', { pan: panX(f.x) }); sfx(at + 0.7, 'nuke', { pan: panX(f.x) });
    } else if (f.k === 'strip') {
      const rec = (f.uid && BD.recs[f.uid]) || recAt(f.x, f.y, true);
      schedule(at, () => { if (rec) rec.strip = { t0: clock() }; sparks(tp(f.x, f.y, 0.4), 0xffe2a0, 10); });
      sfx(at, 'strip', { pan: panX(f.x) });
    } else if (f.k === 'brace') {
      const rec = recAt(f.x, f.y, false);
      schedule(at, () => { if (rec) rec.braceT = clock(); });
      sfx(at, 'brace', { pan: panX(f.x) });
    } else if (f.k === 'capture') {
      // "Captured" shows with its light pillar, not before
      delays[i] = Math.round(tShot * 1000);
      schedule(tShot, () => pillar(tp(f.x, f.y), TEAM[f.owner].ring));
      sfx(tShot, 'capture', { pan: panX(f.x), mine: window.SFX_ME == null || f.owner === window.SFX_ME });
      endP = Math.max(endP, tShot + 0.8);
    } else if (f.k === 'drop') {
      delays[i] = Math.round(tShot * 1000);
      const cr = BD.crates[k];
      // the crate stays out of sight until its drop begins
      sfx(tShot, 'drop', { pan: panX(f.x) });
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
// the column over a held objective: a faint see-through shaft that fades upward, with a band of light rising up it
// every few seconds
let COLTEX = null;
function columnTex() {
  if (COLTEX) return COLTEX;
  const c = document.createElement('canvas'); c.width = 4; c.height = 64;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 64, 0, 0);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
  COLTEX = new T.CanvasTexture(c);
  return COLTEX;
}
function holdColumn(pos) {
  const H = 2.2, grp = new T.Group();
  const mk = (r, op) => new T.MeshBasicMaterial({ color: 0xffffff, map: columnTex(), transparent: true, opacity: op, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide });
  const shaft = new T.Mesh(new T.CylinderGeometry(0.4, 0.42, H, 24, 1, true), mk(0.42, 0.22)); shaft.position.y = H / 2;
  const band = new T.Mesh(new T.CylinderGeometry(0.43, 0.43, 0.22, 24, 1, true), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
  grp.add(shaft); grp.add(band);
  grp.position.set(pos.x, 0, pos.z); grp.renderOrder = 4;
  grp.userData = { shaft, band, mats: [shaft.material, band.material], H, phase: Math.random() * 3 };
  BD.group.add(grp);
  return grp;
}
function pillar(p, col) {
  const m = new T.Mesh(new T.CylinderGeometry(0.32, 0.32, 3, 16, 1, true), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
  m.position.set(p.x, 1.5, p.z); BD.group.add(m);
  const t0 = clock();
  BD.anims.push(t => { const k = (t - t0) / 1.1; if (k >= 1) { BD.group.remove(m); return false; } m.material.opacity = 0.5 * (1 - k); m.scale.set(1 - k * 0.6, 1, 1 - k * 0.6); return true; });
  BD.parts.burst(p.clone().setY(0.1), 14, { spd: 1.2, life: 0.8, size: 0.06, color: col, grav: -1.5, upMin: 0.6 });
}
// a mech destroyed, after cinematic mech-death references: small explosions pop across the body as it buckles,
// then a big fireball engulfs it with a flash and a hard shake; the head and arms are torn off and thrown, burning,
// a ring of dust rolls out, and a column of dark smoke and embers keeps rising from the wreck
function destroyMech(rec, p) {
  if (rec) rec.dying = { t0: clock(), long: true };
  const at = () => (rec ? rec.R.root.position.clone() : p.clone().setY(0));
  [0, 0.22, 0.42].forEach((d, i) => schedule(d, () => { const q = at().add(new T.Vector3(rand(-0.2, 0.2), rand(0.25, 0.75), rand(-0.2, 0.2))); fireball(q, 0.32); sparks(q, 0xffe2a0, 10); shake(0.08 + i * 0.03); }));
  schedule(0.7, () => {
    const c = at().setY(0.4);
    fireball(c, 1.8);
    BD.parts.chunks(c.clone(), 10, 0x3a3f46, { fire: true, spd: 1.4 });
    dustRing(c.clone().setY(0.05), 24, 1.2);
    shake(0.45); screenFlash(0.35, '#ffb060');
    if (rec && LEVEL !== 'low') {
      const R = rec.R, parts = [R.head].concat(Object.values(R.arms).map(a => a.sh)).filter(Boolean);
      parts.forEach(o => { const out = new T.Vector3(); o.getWorldPosition(out); BD.group.worldToLocal(out); const d = out.sub(c).setY(0).normalize(); BD.parts.fling(o, new T.Vector3(d.x * rand(1, 2), rand(2.2, 3.4), d.z * rand(1, 2)), 2.8); });
    }
    // the wreck burns: a column of smoke and embers rising for a few seconds
    const base = c.clone().setY(0.15), t0 = clock();
    BD.anims.push(t => {
      const k = (t - t0) / 4.5; if (k >= 1) return false;
      if (Math.random() < 0.7 * (1 - k)) BD.parts.spawn({ pos: base.clone().add(new T.Vector3(rand(-0.15, 0.15), rand(0, 0.1), rand(-0.15, 0.15))), vel: new T.Vector3(rand(-0.08, 0.08), rand(0.45, 0.8), rand(-0.08, 0.08)), add: false, life: rand(2.2, 3.2), size: 0.2, size1: 0.8, color: 0x2a2624, color1: 0x5d5a56, op: 0.7, op1: 0, drag: 0.6 });
      if (Math.random() < 0.4 * (1 - k)) BD.parts.spawn({ pos: base.clone().add(new T.Vector3(rand(-0.12, 0.12), 0, rand(-0.12, 0.12))), vel: new T.Vector3(rand(-0.2, 0.2), rand(0.4, 1.0), rand(-0.2, 0.2)), life: rand(0.8, 1.4), size: 0.035, size1: 0.01, color: 0xffd27a, color1: 0xff4a1a, op: 1, op1: 0, grav: -0.3 });
      if (Math.random() < 0.3 * (1 - k)) BD.parts.spawn({ pos: base.clone().add(new T.Vector3(rand(-0.1, 0.1), 0, rand(-0.1, 0.1))), vel: new T.Vector3(0, rand(0.2, 0.4), 0), life: 0.5, size: 0.12, size1: 0.04, color: 0xffb040, color1: 0xc8320f, op: 0.9, op1: 0 });
      return true;
    });
  });
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
  BD.parts = new Particles(BD.group, 900);
  ST.hasBoard = false;
};

/* ---------- battlefield preview and tour, for the setup screen ----------
   The same board the battle uses, built from the map alone, with a camera that can be walked round it. */
function mapState(id) {
  const M = window.MW.MAPS[id];
  return { map: id, objectives: M.obj.map(([x, y, type]) => ({ x, y, type, owner: null })), players: M.bases.map(([x, y]) => ({ base: { x, y, hp: 1 } })), mechs: [], wrecks: [], crates: [], flat: [] };
}
R3.mapPreview = function (el, id) {
  if (!BD || !window.MW.MAPS[id]) return false;
  R3.mount(el, null);
  BD.pad = { t: 0, r: 0, b: 0, l: 0 }; BD.padT = null;
  BD.inputOff = true; BD.renderer.domElement.style.touchAction = 'pan-y';
  if (BD.previewMap !== id || !ST.hasBoard) {
    clearTour();
    window.MW.setMap(id);
    R3.reset();
    buildBoard(mapState(id));
    BD.flip = false; BD.group.rotation.y = 0;
    BD.turretRings.forEach(g => { g.visible = false; });
    BD.previewMap = id;
    BD.intent = 'preview';
    R3.mapTour(null);
    Object.assign(BD.rig, BD.rigT);
  }
  return true;
};
function clearTour() {
  if (!BD || !BD.tour) return;
  const tr = BD.tour;
  tr.lit.forEach(m => { m.material = m.userData.m0; delete m.userData.m0; });
  tr.extra.forEach(o => BD.group.remove(o));
  tr.tiles.forEach(k => { const ov = BD.ov[k]; if (ov) { ov.userData.kind = null; ov.material.opacity = 0; } });
  if (BD.turretRings) BD.turretRings.forEach(g => { g.visible = false; });
  BD.tour = null;
}
// spec: { focus: tiles to frame, tiles: tiles to light, col: 'gold' | 'p0' | 'p1', models: tiles whose models glow, rings: bases whose reach is outlined, crates: tiles to drop a crate on, step }
R3.mapTour = function (spec) {
  if (!BD || !BD.previewMap) return;
  clearTour();
  const G = BD.rigT;
  BD.camRate = 2.6;
  if (!spec) { BD.orbit = 0.12; Object.assign(G, { tx: 0, tz: 0, zoom: 1, el: EL_34, az: BD.rig.az }); return; }
  const tr = BD.tour = { lit: [], extra: [], tiles: [] };
  const col = spec.col === 'p0' ? TEAM[0].ring : spec.col === 'p1' ? TEAM[1].ring : 0xffc83a;
  for (const [x, y] of spec.tiles || []) { const k = key(x, y), ov = BD.ov[k]; if (!ov) continue; ov.material.color.setHex(col); ov.userData.kind = 'tour'; tr.tiles.push(k); }
  for (const [x, y] of spec.models || []) {
    const k = key(x, y), pg = (BD.objs[k] && BD.objs[k].pg) || BD.props[k];
    if (pg) pg.traverse(o => { if (o.isMesh && o.material && o.material.userData.paint && !o.userData.m0) { o.userData.m0 = o.material; o.material = lit(o.material); tr.lit.push(o); } });
    // a marker bobbing over each thing the tour is pointing at
    const top = BD.objs[k] && BD.objs[k].o.type === 'uplink' ? 1.75 : BD.objs[k] && BD.objs[k].o.type === 'radar' ? 1.35 : pg && pg.userData.base ? 1.35 : 1.15;
    const mk = new T.Group(), p = tp(x, y); mk.position.set(p.x, top, p.z);
    mesh(cone(0.13, 0.26, 4), glow(0xffc83a), mk, [0, 0, 0], [Math.PI, 0, 0], flat);
    BD.group.add(mk); tr.extra.push(mk);
    const t0 = clock() + Math.random();
    BD.anims.push(t => { if (!mk.parent) return false; mk.position.y = top + 0.08 * Math.sin((t - t0) * 4); mk.rotation.y = t * 1.5; return true; });
  }
  for (const pid of spec.rings || []) if (BD.turretRings[pid]) BD.turretRings[pid].visible = true;
  (spec.crates || []).forEach(([x, y], i) => {
    const c = buildCrate({ x, y, kind: i % 2 ? 'special' : 'supply' });
    c.userData.dropT = clock() + 0.5 + i * 0.25; c.userData.chute.visible = true; c.userData.body.position.y = 4;
    BD.crates['tour' + i] = c; tr.extra.push(c);
    BD.anims.push(() => { if (c.parent) return true; delete BD.crates['tour' + i]; return false; });
  });
  BD.orbit = 0;
  if (spec.focus && spec.focus.length) {
    G.el = 0.7; G.az = (spec.step % 2 ? 0.45 : -0.45);
    focusTiles(spec.focus, 1.1, 2.3);
  } else Object.assign(G, { tx: 0, tz: 0, zoom: 1, el: EL_34, az: BD.rig.az });
};
// back to the battle: drop the preview so the next battle builds its own board and camera
R3.mapPreviewEnd = function () {
  if (!BD || !BD.previewMap) return;
  clearTour();
  BD.previewMap = null; BD.inputOff = false; BD.orbit = 0; BD.camRate = 0; BD.intent = null;
  BD.renderer.domElement.style.touchAction = 'none';
  R3.reset();
  BD.viewAz = 0;
  Object.assign(BD.rigT, { zoom: 1, tx: 0, tz: 0 }); iso(BD.rigT); Object.assign(BD.rig, BD.rigT);
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
    if (HV && HV.canvas.isConnected && HV.canvas.offsetParent !== null) { updateViewer(t, dt); placeBadges(); HV.renderer.render(HV.scene, HV.cam); inkPass(HV.renderer, HV.scene, HV.cam, HV.scene, HV.ink || (HV.ink = {})); }
  };
  requestAnimationFrame(step);
}
// while aiming, everything but the target mech and the ground is hidden; it all comes back when aiming ends
function aimView() {
  if (BD.aimFor === BD.aimUid) return;
  for (const o of BD.aimHid || []) o.visible = true;
  BD.aimHid = []; BD.aimFor = BD.aimUid;
  const rec = BD.aimUid != null ? BD.recs[BD.aimUid] : null;
  if (!rec) return;
  // the ground and the tile highlights stay; scenery, other mecha and effects go
  const keep = new Set([rec.R.root, rec.blob, rec.selRing].concat(Object.values(BD.ov)));
  for (const o of BD.group.children) if (o.visible && !keep.has(o) && !o.userData.ground) { o.visible = false; BD.aimHid.push(o); }
}
// the screen centre of one part of a mech, in board space, for the aiming tags
const PART_SLOTS = { torso: ['torso', 'core', 'aux0', 'aux1', 'aux2'], armL: ['armL'], armR: ['armR'], legs: ['legs'] };
function partCentre(rec, part) {
  const bb = new T.Box3(), want = PART_SLOTS[part] || [part];
  rec.R.root.updateMatrixWorld(true);
  rec.R.root.traverse(o => { if (o.isMesh && o.visible && want.includes(o.userData.slot)) bb.expandByObject(o); });
  if (bb.isEmpty()) return null;
  const c = new T.Vector3(); bb.getCenter(c);
  return BD.group.worldToLocal(c);
}
// the target's outline on screen, so the aiming tags can stand clear of it
function screenBox(rec) {
  const bb = new T.Box3().setFromObject(rec.R.root), b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
    const s = project(BD.group.worldToLocal(new T.Vector3(x, y, z)));
    b.x0 = Math.min(b.x0, s.x); b.x1 = Math.max(b.x1, s.x); b.y0 = Math.min(b.y0, s.y); b.y1 = Math.max(b.y1, s.y);
  }
  return b;
}
function renderBoardFrame(dt) {
  aimView();
  camUpdate(dt);
  BD.renderer.render(BD.scene, BD.cam);
  inkPass(BD.renderer, BD.scene, BD.cam, BD.group, BD.ink || (BD.ink = { weight: 0.55, alpha: 0.7, ao: true }));
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
  let aimBox = null;
  for (const L of BD.labels) {
    let p;
    if (L.uid != null && L.part) {
      // an aiming tag: the body's above the mech, the legs' below it, each arm's out to the side it is on
      const rec = BD.recs[L.uid]; p = rec ? partCentre(rec, L.part) : null;
      if (!p) { L.el.style.display = 'none'; continue; }
      const s = project(p), b = aimBox || (aimBox = screenBox(rec)), cx = (b.x0 + b.x1) / 2, w = L.el.offsetWidth || 120, h = L.el.offsetHeight || 50;
      if (L.part === 'torso') { s.x = cx; s.y = b.y0 - h / 2 - 6; }
      else if (L.part === 'legs') { s.x = cx; s.y = b.y1 + h / 2 + 6; }
      else { const side = Math.sign(s.x - cx) || (L.part === 'armL' ? -1 : 1); s.x = side < 0 ? b.x0 - w / 2 - 6 : b.x1 + w / 2 + 6; }
      // kept inside the part of the screen the HUD leaves clear
      const P = BD.pad;
      s.x = Math.max(P.l + w / 2 + 4, Math.min(BD.size.w - P.r - w / 2 - 4, s.x)); s.y = Math.max(P.t + h / 2 + 4, Math.min(BD.size.h - P.b - h / 2 - 4, s.y));
      L.el.style.display = '';
      L.el.style.transform = 'translate(' + s.x.toFixed(1) + 'px,' + s.y.toFixed(1) + 'px)';
      continue;
    }
    else if (L.uid != null) { const rec = BD.recs[L.uid]; if (!rec) { L.el.style.display = 'none'; continue; } p = rec.R.root.position.clone(); p.y += L.h; }
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
  TGT_U.uTime.value = t;
  for (let i = BD.queue.length - 1; i >= 0; i--) if (BD.queue[i].t <= t) { const q = BD.queue.splice(i, 1)[0]; try { q.fn(); } catch (e) { /* keep animating */ } }
  for (let i = BD.anims.length - 1; i >= 0; i--) { let keep = false; try { keep = BD.anims[i](t); } catch (e) { keep = false; } if (!keep) BD.anims.splice(i, 1); }
  BD.parts.update(dt);
  const pulse = 0.5 + 0.5 * Math.sin(t * 5);
  for (const k in BD.ov) { const ov = BD.ov[k], kd = ov.userData.kind; if (kd === 'target' || kd === 'dep') ov.material.opacity = (OV_OP[kd] || 0.4) * (0.6 + 0.5 * pulse); else if (kd === 'tour') ov.material.opacity = 0.25 + 0.4 * pulse; }
  if (BD.orbit) BD.rigT.az += dt * BD.orbit;
  for (const k in BD.objs) {
    const r = BD.objs[k]; if (r.dish) r.dish.rotation.y = t * 0.8;
    // the held column breathes, and every 2.6s a band of light climbs it
    const c = r.column;
    if (c && c.visible) {
      const u = c.userData, q = ((t + u.phase) % 2.6) / 2.6;
      u.shaft.material.opacity = 0.16 + 0.08 * Math.sin(t * 2 + u.phase) + (q < 0.25 ? 0.18 * (1 - q / 0.25) : 0);
      u.band.position.y = 0.1 + q * u.H; u.band.material.opacity = q < 0.85 ? 0.55 * (1 - q / 0.85) : 0;
    }
  }
  {
    const tg = [];
    for (const k in BD.ov) if (BD.ov[k].userData.kind === 'target') tg.push(k);
    const az = BD.rig.az, cx = Math.sin(az), cz = Math.cos(az), tilted = BD.rig.el < 1.2;
    const hides = k => {
      if (!tg.length) return false;
      const [x, y] = k.split(',').map(Number), p = worldTile(x, y);
      for (const tk of tg) {
        if (tk === k) return true;
        if (!tilted) continue;
        const [ax, ay] = tk.split(',').map(Number), q = worldTile(ax, ay);
        const dx = p.x - q.x, dz = p.z - q.z, along = dx * cx + dz * cz, across = Math.abs(dx * cz - dz * cx);
        if (along > 0.4 && along < 1.7 && across < 0.8) return true;      // between the target and the camera
      }
      return false;
    };
    const ease = Math.min(1, dt * 9);
    const sink = (g, k) => { if (!g || g.userData.base) return; const want = hides(k) ? 0.16 : 1; if (Math.abs(g.scale.y - want) > 0.002) g.scale.y += (want - g.scale.y) * ease; };
    for (const k in BD.props) sink(BD.props[k], k);
    for (const k in BD.objs) sink(BD.objs[k].pg, k);
  }
  for (const k in BD.wrecks) {
    const w = BD.wrecks[k];
    w.userData.glow.material.opacity = 0.2 + 0.35 * (0.5 + 0.5 * Math.sin(t * 3.5));
    if (LEVEL !== 'low' && Math.random() < 0.06) BD.parts.spawn({ pos: w.position.clone().add(new T.Vector3(rand(-0.15, 0.15), 0.1, rand(-0.15, 0.15))), vel: new T.Vector3(rand(-0.05, 0.05), rand(0.25, 0.45), rand(-0.05, 0.05)), add: false, life: rand(2, 3), size: 0.12, size1: 0.5, color: 0x3a3634, color1: 0x6d6862, op: 0.45, op1: 0, drag: 0.6 });
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
    if (q >= 1) { rec.drop = null; dustRing(root.position.clone().setY(0.05), 14, 0.7); shake(0.06); }
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
  let lungeOff = null, lean = 0;
  if (rec.lunge) {
    const q = (t - rec.lunge.t0) / 0.36;
    if (q >= 0 && q < 1) { const d = rec.lunge.to.clone().setY(0).sub(rec.pos.clone().setY(0)); lungeOff = d.multiplyScalar(kf(q, [[0, 0], [0.3, -0.12, 'in'], [0.5, 0.55, 'out'], [0.7, 0.45], [1, 0]])); lean = kf(q, [[0, 0], [0.3, -0.15, 'in'], [0.5, 0.35, 'out'], [1, 0]]); }
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
  if (rec.hitT && t - rec.hitT < 0.6) {
    const q = (t - rec.hitT) / 0.6, kb = kf(q, [[0, 0], [0.12, -0.12, 'out'], [0.6, -0.04], [1, 0]]);
    root.position.x += Math.sin(rec.face) * kb + Math.sin(q * 40) * 0.025 * Math.max(0, 1 - q * 2); root.position.z += Math.cos(rec.face) * kb;
    root.rotation.z = Math.sin(q * 30) * 0.06 * Math.max(0, 1 - q * 2); lean += kf(q, [[0, 0], [0.12, -0.35, 'out'], [0.45, -0.08], [0.7, -0.12], [1, 0]]);
  } else root.rotation.z = 0;
  // a shot kicks the whole body back, harder for heavier guns
  const amp = Math.min(2.4, rec.recoilAmp || 1);
  if (rec.recoil && t - rec.recoil < 0.45 + 0.1 * amp) lean += amp * kf((t - rec.recoil) / (0.45 + 0.1 * amp), [[0, 0], [0.1, -0.14, 'out'], [0.5, 0.03], [1, 0]]);
  // winding up: heavy guns plant and lean back, melee draws back, mortars rock back to lift the barrel
  if (rec.wind) {
    const wk = Math.min(1, (t - rec.wind.t0) / rec.wind.dur), e = wk * wk * (3 - 2 * wk);
    const ps = rec.wind.pose;
    lean += ps === 'brace' ? -0.12 * e + Math.sin(t * 55) * 0.012 * wk : ps === 'pull' ? -0.16 * e : ps === 'raise' ? -0.08 * e : -0.04 * e;
    if (wk >= 1 && t - rec.wind.t0 > rec.wind.dur + 0.6) rec.wind = null;
  }
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
    const q = (t - rec.dying.t0) / (rec.dying.vapor ? 0.25 : rec.dying.long ? 2.0 : 1.2);
    if (q >= 1) { dropRec(rec); return; }
    if (rec.dying.vapor) { root.scale.setScalar(MS * (1 - q)); }
    else { R.torso.rotation.x = kf(q, [[0, 0], [0.08, -0.35, 'out'], [0.3, 0.2], [0.6, 0.3]]); R.hips.position.y = R.hipY * kf(q, [[0, 1], [0.3, 0.92], [0.55, 0.6, 'in']]); root.rotation.z = (R.kind === 'treads' ? 0.28 : 1) * kf(q, [[0, 0], [0.3, 0.06], [0.62, -1.35, 'in'], [0.72, -1.18, 'out'], [0.82, -1.38]]); y += kf(q, [[0, 0], [0.62, -0.05], [0.72, 0.03, 'out'], [0.82, -0.05], [1, -0.2, 'in']]); if (Math.random() < 0.5) smoke(root.position.clone().setY(0.4), 1, false); if (Math.random() < 0.3) sparks(root.position.clone().setY(0.4), 0xffe2a0, 3); }
  } else if (!rec.strip && !rec.charging) {
    // idle and walk cycles
    const ph = t * (moving ? 9 : 1.6) + rec.phase;
    const kneel = R.kneel;
    const entr = rec.entr;
    // dig-in transition: starts when the entrenched state changes (not when a mech first appears already dug in)
    if (rec.entrSeen === undefined) rec.entrSeen = entr;
    if (rec.entrSeen !== entr) { rec.entrSeen = entr; rec.digT = t; rec.digFx = false; }
    // a quad takes its time: each leg in turn lifts, swings out, stamps down and drives into the ground
    const digDur = R.kind === 'quad' ? (entr ? 3.4 : 1.8) : 0.85;
    const dq = rec.digT != null ? (t - rec.digT) / digDur : 1;
    const dig = dq < 1 ? digPose(entr ? dq * 0.85 : dq * 0.65, entr) : (entr ? 1 : 0);
    if (R.kind === 'quad') {
      const qs = rec.gait || (rec.gait = {});
      if (dq < 1) {
        qs.digLegs = [0, 1, 2, 3].map(i => { const e = Math.max(0, Math.min(1, (dq - 0.06 - i * 0.21) / 0.27)); return entr ? e : 1 - e; });
        // each foot that stamps home throws up dust, a crack of sparks and a thump through the ground
        rec.digStamp = rec.digStamp || [];
        if (entr) qs.digLegs.forEach((e, i) => { if (e >= 0.62 && !rec.digStamp[i]) { rec.digStamp[i] = true; const L = R.quad.legs[i], p = new T.Vector3(); L.ankle.getWorldPosition(p); BD.group.worldToLocal(p); p.y = 0.05; dust(p, 7, 0.12, 0.6); sparks(p, 0xcbbf9e, 6); shockRing(p.clone(), 0xcbbf9e, 0.25, 0.4); shake(0.07); } });
      } else { qs.digLegs = null; rec.digStamp = null; }
    }
    if (dq < 1 && entr && R.kind !== 'quad' && dq * 0.85 >= 0.42 && !rec.digFx) {
      rec.digFx = true;
      const feet = R.kind === 'quad' ? R.quad.legs.map(L => L.ankle) : (R.stakes && R.stakes.length ? R.stakes.map(x => x.g) : []);
      feet.forEach(o => { const p = new T.Vector3(); o.getWorldPosition(p); BD.group.worldToLocal(p); p.y = 0.05; smoke(p, 2, false); sparks(p, 0xcbbf9e, 4); });
      smoke(root.position.clone().setY(0.05), 3, false);
    }
    if (dq < 1) lean += entr ? kf(dq * 0.85, [[0, 0], [0.25, -0.07], [0.42, 0.13, 'out'], [0.7, 0.02], [0.85, 0]]) : kf(dq * 0.65, [[0, 0], [0.15, 0.08], [0.45, -0.05, 'out'], [0.65, 0]]);
    let hipY = R.hipY * (kneel ? 0.62 : R.kind === 'biped' ? 1 - 0.15 * Math.max(0, dig) : 1);
    if (R.kind === 'hover') { hipY += 0.03 * Math.sin(t * 2.2 + rec.phase); if (R.hoverGlow) R.hoverGlow.material.opacity = 0.4 + 0.3 * Math.sin(t * 6); }
    R.hips.position.y = hipY + (moving ? Math.abs(Math.sin(ph)) * 0.02 : Math.sin(ph) * 0.006);
    // walking like a person: the torso counter-twists against the stride and the hips sway a little
    R.torso.rotation.y = moving ? 0 : Math.sin(t * 0.6 + rec.phase) * 0.08;
    R.hips.rotation.z = 0; R.armSwing = null;
    if (R.head) R.head.rotation.y = Math.sin(t * 0.9 + rec.phase * 2) * 0.35;
    if (R.halo) R.halo.rotation.z = t * 0.7;
    if (R.monoEye) R.monoEye.position.x = Math.sin(t * 1.7 + rec.phase) * 0.032;
    if (R.gyro) { R.gyro.rotation.y = t * 1.1; R.gyro.rotation.x = 0.4 * Math.sin(t * 0.7); }
    if (R.floaters) R.floaters.forEach((g, i) => { g.position.y += (Math.sin(t * 2 + i * 2) * 0.004); g.rotation.x = 0.15 * Math.sin(t * 1.3 + i); });
    if (R.kind === 'biped') {
      if (kneel || entr || dq < 1) R.legs.forEach((hip, i) => {
        if (kneel) { hip.rotation.x = i ? -1.2 : 0.2; hip.userData.knee.rotation.x = i ? 1.6 : 0.9; }
        else { hip.rotation.x = -0.4 * dig; hip.userData.knee.rotation.x = 0.8 * dig; }
        if (hip.userData.ankle) hip.userData.ankle.rotation.x = -(hip.rotation.x + hip.userData.knee.rotation.x);
      });
      else {
        // ground speed from how far the body moved this frame
        const p0 = rec.gaitPos || root.position.clone(), sp = moving && dt > 0 ? Math.hypot(root.position.x - p0.x, root.position.z - p0.z) / dt : 0;
        rec.gaitPos = root.position.clone();
        const g = gaitStep(rec.gait || (rec.gait = {}), R, dt, sp), gk = R.style === 'armored' ? 0.7 : 1;
        if (g) { R.hips.position.y += g.bob; R.hips.rotation.z = g.roll * gk; R.torso.rotation.y = g.twist * gk; R.armSwing = g.swing; }
      }
    }
    if (R.kind === 'quad') {
      const p0 = rec.gaitPos || root.position.clone(), sp = moving && dt > 0 ? Math.hypot(root.position.x - p0.x, root.position.z - p0.z) / dt : 0;
      rec.gaitPos = root.position.clone();
      const qs = rec.gait || (rec.gait = {}); qs.dig = Math.max(0, Math.min(1, entr ? 1 : 0)); if (dq < 1) qs.dig = null;
      const g = quadStep(qs, R, dt, sp);
      if (g) { R.legsG.position.set(g.hubX, g.hubY, g.hubZ); R.hips.position.x = g.bodyX; R.hips.position.z = g.bodyZ; R.hips.position.y += g.bob; R.hips.rotation.z = g.roll; R.torso.rotation.y += g.yaw; lean += g.pitch; }
    }
    if (R.stakes) R.stakes.forEach(st => { const e = Math.max(0, Math.min(1, dig)); st.g.rotation.z = st.sx * 0.95 * e; st.g.position.y = -0.06 - 0.11 * e; });
    if (R.boosters) R.boosters.forEach(f => { f.visible = moving; f.scale.y = 1 + Math.random() * 0.8; });
    if (R.thrusters && !rec.drop) R.thrusters.forEach(f => { f.visible = moving && R.kind !== 'treads'; f.scale.y = 1 + Math.random(); });
  }
  // weapons: recoil and spinning barrels
  for (const k in R.arms) {
    const a = R.arms[k];
    let rx = 0;
    if (rec.recoil && rec.lastArm === k) { const q = (t - rec.recoil) / (0.22 + 0.06 * amp); if (q < 1) rx = Math.sin(q * Math.PI) * 0.3 * (0.7 + 0.5 * amp); }
    // the wind-up on the arm that is about to fire: cocked back, lifted, or trembling as it charges
    if (rec.wind && (!rec.wind.key || rec.wind.key === k)) {
      const wk = Math.min(1, (t - rec.wind.t0) / rec.wind.dur), e = wk * wk * (3 - 2 * wk), ps = rec.wind.pose;
      rx += ps === 'pull' ? 0.75 * e : ps === 'raise' ? 0.45 * e : ps === 'brace' ? 0.08 * e + Math.sin(t * 70) * 0.03 * wk : 0.1 * e;
    }
    const swing = R.armSwing && !(rec.aimT && t - rec.aimT < 1.5) ? (k === 'armL' ? -R.armSwing[1] : -R.armSwing[0]) * (R.style === 'armored' ? 0.5 : 0.75) : 0;
    a.arm.rotation.x = -rx - (moving ? 0 : Math.sin(t * 1.3 + rec.phase) * 0.03) + swing;
    // raise to aim while attacking, then drop back to the rest pose
    const aiming = rec.aimT && t - rec.aimT < 1.5 && (!rec.aimKey || rec.aimKey === k);
    const want = aiming ? -Math.PI / 2 : (a.rest != null ? a.rest : -Math.PI / 2);
    a.el.rotation.x += (want - a.el.rotation.x) * Math.min(1, dt * 10);
  }
  // spinning barrels (Gatling, drill): spin up through the wind-up, scream while firing, then wind down
  for (const k in R.muzzles) {
    const sp = R.muzzles[k].spin; if (!sp) continue;
    let v = 0.8;
    if (rec.wind && rec.wind.spin && (!rec.wind.key || rec.wind.key === k)) { const wk = Math.min(1, (t - rec.wind.t0) / rec.wind.dur); v = 0.8 + 60 * wk * wk; }
    else if (rec.spin && rec.lastArm === k && t - rec.spin < 1.4) { const q = (t - rec.spin) / 1.4; v = q < 0.45 ? 60 : 60 * (1 - (q - 0.45) / 0.55) + 0.8; }
    sp.rotation.z += dt * v;
  }
  // core pulse
  if (R.core && R.coreLive && !rec.charging) R.core.scale.setScalar(1 + 0.15 * Math.sin(t * 4 + rec.phase));
  root.position.y = y;
  if (!rec.dying && !rec.strip) R.torso.rotation.x = lean;
  // brace shield shimmer
  if (rec.braceT && t - rec.braceT < 0.7) { const q = (t - rec.braceT) / 0.7; rec.bubble.material.opacity = 0.6 * (1 - q); rec.bubble.scale.setScalar(0.8 + q * 0.3); }
  else rec.bubble.material.opacity = rec.m && rec.m.braced ? 0.12 : 0;
  rec.bubble.position.copy(root.position).setY(root.position.y + 0.4);
  // rings and shadow follow
  for (const r of [rec.selRing, rec.actRing, rec.owRing, rec.empRing, rec.blob, rec.tgtRing]) if (r) { r.position.x = root.position.x; r.position.z = root.position.z; }
  if (rec.tgtRing && rec.tgtRing.visible) { rec.tgtRing.rotation.y = t * 0.9; rec.tgtRing.scale.setScalar(1 + 0.06 * Math.sin(t * 6)); }
  // the emplacement ring grows in as the mech digs in, then breathes slowly
  if (rec.empRing.visible) { const g = rec.digT != null ? Math.min(1, (t - rec.digT) / 0.6) : 1; rec.empRing.scale.setScalar(0.6 + 0.4 * g); rec.empRing.material.opacity = (0.75 + 0.2 * Math.sin(t * 2.4)) * g; }
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
  const cam = new T.PerspectiveCamera(34, 1, 0.25, 50);
  cam.position.set(0, 1.45, 4.3); cam.lookAt(0, 0.95, 0);
  threePoint(scene, renderer, true);
  // gantry: hazard-striped plate, scaffold towers, catwalk, back wall with lamps
  const env = new T.Group(); scene.add(env);
  mesh(cyl(1.25, 1.3, 0.12, 24), toon(0x3a414a), env, [0, -0.06, 0], null, { t: 0.02, recv: true });
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
  // no idle motion: the mech stands still, facing the way it was last left
  HV.holder.rotation.y = HV.rot;
  if (!HV.sel && HV.fit && HV.h) {
    const f = HV.fit, tv = Math.tan(HV.cam.fov * Math.PI / 360), th = tv * HV.cam.aspect;
    const top = HV.topEl && HV.topEl.isConnected ? HV.topEl.offsetTop + HV.topEl.offsetHeight + 6 : 8, bot = 10;
    const u = Math.max(0.45, 1 - (top + bot) / HV.h);
    const hh = (f.hi - f.lo) / 2 * 1.1, rr = f.r * 1.12;
    // parts swing toward the camera as the mech turns: leave a little extra room for them
    const d = Math.max(hh / (tv * u), rr / th) + f.r * 0.35;
    HV.distT = Math.max(1.6, d);
    HV.lookT.set(0, (f.lo + f.hi) / 2 + (top - bot) / (2 * HV.h) * 2 * HV.distT * tv, 0);
  }
  // a newly shown mech appears already framed; after that the camera eases
  if (HV.snapUntil && t < HV.snapUntil) { HV.dist = HV.distT; HV.look.copy(HV.lookT); }
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
    if (R.gyro) { R.gyro.rotation.y = t * 1.1; R.gyro.rotation.x = 0.4 * Math.sin(t * 0.7); }
    if (R.floaters) R.floaters.forEach((g, i) => { g.position.y += (Math.sin(t * 2 + i * 2) * 0.004); g.rotation.x = 0.15 * Math.sin(t * 1.3 + i); });
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
  assault: { torso: 'b_torso', core: 'r_b_torso', legs: 'l_boost', armL: 'w_gatling', armR: 'w_blade', aux: ['a_jump', 'a_cool'] },
  armored: { torso: 't_heavy', core: 'r_t_heavy', legs: 'l_quad', armL: 'w_rail', armR: 'w_howitzer', aux: [] },
  experimental: { torso: 't_proto', core: 'r_t_proto', legs: 'l_hover', armL: 'w_lance', armR: 's_emp', aux: [] }
};
const PORTRAITS = {};
let PR = null;
R3.portrait = function (doctrine, owner) {
  owner = owner ? 1 : 0;
  const key = doctrine + '|' + owner;
  if (PORTRAITS[key]) return PORTRAITS[key];
  const L = ARCHETYPE[doctrine];
  if (!L) return null;
  return (PORTRAITS[key] = R3.snapshot(L, doctrine, owner, { w: 480, h: 600 }));
};
// a picture of any loadout: { torso, core, legs, armL, armR, aux: [] }, missing parts left off
// one part on its own, for the cards: the part is fitted to a stand-in mech of the army, everything else is hidden,
// and the camera frames what is left. Cached per part and army.
const PART_SHOTS = {};
R3.partShot = function (id, doctrine, owner) {
  const D = DEFS(), d = D[id];
  if (!d || !['torso', 'core', 'legs', 'arm', 'aux'].includes(d.slot)) return null;
  const style = ARCHETYPE[doctrine] ? doctrine : 'assault', ck = id + ':' + style + ':' + (owner || 0);
  if (ck in PART_SHOTS) return PART_SHOTS[ck];
  const A = ARCHETYPE[style];
  const auxFrame = Object.keys(D).find(k => D[k].slot === 'torso' && (D[k].auxSlots || 0) > 0) || A.torso;
  const L = d.slot === 'torso' ? { torso: id } : d.slot === 'core' ? { torso: A.torso, core: id } : d.slot === 'legs' ? { torso: A.torso, legs: id }
    : d.slot === 'arm' ? { torso: A.torso, armR: id } : { torso: auxFrame, aux: [id] };
  const want = d.slot === 'arm' ? 'armR' : d.slot === 'aux' ? 'aux0' : d.slot;
  PART_SHOTS[ck] = R3.snapshot(L, style, owner || 0, { w: 200, h: 140, only: want, rot: d.slot === 'arm' ? 1.15 : d.slot === 'legs' ? 0.7 : 0.6 });
  return PART_SHOTS[ck];
};
R3.snapshot = function (L, doctrine, owner, opt) {
  opt = opt || {};
  try {
    if (!PR) {
      const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1); renderer.setSize(240, 300, false); renderer.setClearColor(0x000000, 0);
      const scene = new T.Scene();
      threePoint(scene, renderer, false);
      const cam = new T.PerspectiveCamera(30, 240 / 300, 0.25, 50);
      const holder = new T.Group(); scene.add(holder);
      PR = { renderer, scene, cam, holder, ink: { weight: 1.2 } };
    }
    const D = DEFS();
    const mk = id => (id ? { id, hp: D[id].hp } : null);
    const m = { owner: owner || 0, slots: { torso: mk(L.torso), core: mk(L.core), legs: mk(L.legs), armL: mk(L.armL), armR: mk(L.armR), aux: (L.aux || []).map(mk) } };
    while (PR.holder.children.length) PR.holder.remove(PR.holder.children[0]);
    const R = buildMech(m, owner || 0, doctrine, {});
    R.root.rotation.y = opt.rot != null ? opt.rot : 0.55;
    const sw = opt.w || 240, shh = opt.h || 300;
    PR.renderer.setSize(sw, shh, false); PR.cam.aspect = sw / shh; PR.cam.updateProjectionMatrix();
    // a slight stride and raised weapon arm so the pose reads as ready for battle
    if (R.legs[0] && R.kind === 'biped') { R.legs[0].rotation.x = -0.18; R.legs[1].rotation.x = 0.14; }
    if (R.arms.armR && R.style !== 'assault') R.arms.armR.sh.rotation.x = -0.35;
    PR.holder.add(R.root);
    PR.scene.updateMatrixWorld(true);
    let bb;
    if (opt.only) {
      // a single part: hide the rest of the machine; a weapon is shown without the arm that holds it
      bb = new T.Box3();
      R.root.traverse(o => {
        if (!o.isMesh) return;
        let inWeapon = false; for (let q = o; q; q = q.parent) if (q.userData.weapon) { inWeapon = true; break; }
        o.visible = o.userData.slot === opt.only && (opt.only.startsWith('arm') ? inWeapon : true);
        if (o.visible) bb.expandByObject(o);
      });
      if (bb.isEmpty()) return null;
    } else bb = new T.Box3().setFromObject(R.root);
    // frame the whole machine, or the part
    const c = new T.Vector3(), sz = new T.Vector3(); bb.getCenter(c); bb.getSize(sz);
    const dist = (opt.only ? Math.max(sz.y, Math.max(sz.x, sz.z) / PR.cam.aspect) * 1.02 : Math.max(sz.y, sz.x * 1.25) * 1.12) / (2 * Math.tan(15 * Math.PI / 180));
    PR.cam.position.set(c.x + dist * 0.18, c.y + dist * (opt.only ? 0.3 : 0.16), c.z + dist); PR.cam.lookAt(c);
    PR.renderer.render(PR.scene, PR.cam);
    inkPass(PR.renderer, PR.scene, PR.cam, PR.holder, PR.ink);
    return PR.renderer.domElement.toDataURL('image/png');
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
      // its extent once scaled: height span, and the farthest reach from the turning axis (any part, any angle)
      const kk = Math.min(1, k);
      HV.fit = { lo: Math.max(0, bb.min.y * kk), hi: bb.max.y * kk, r: reach * kk };
    } else HV.fit = null;
    // a different mech appears already framed; the same mech rebuilt (a part fitted, removed or repaired) eases instead
    if (!m || m.uid !== HV.uid) HV.snapUntil = clock() + 0.6;
    HV.sig = sig; HV.uid = m ? m.uid : null;
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
      // the body and legs are shown from the front; an arm turns its side toward the camera, no further than a
      // three-quarter turn; aux systems sit on the back, so the mech turns round for those
      HV.rotT = sel === 'torso' || sel === 'core' || sel === 'legs' ? 0 : sel.startsWith('arm') ? Math.max(-1.1, Math.min(1.1, Math.atan2(-local.x, local.z))) : Math.atan2(-local.x, local.z);
      const r = Math.hypot(local.x, local.z);
      HV.lookT.set(0, Math.max(0.35, local.y), r * 0.6);
      HV.distT = 2.1;
    } else { HV.rotT = HV.rotT != null ? 0 : null; }
  }
  HV.onPick = opt.onPick || null;
  HV.topEl = el.querySelector('.h3d-top');
  // floating badges pinned to parts of the mech (empty arms show what they take)
  let bx = el.querySelector('.hvb-box');
  if (!bx) { bx = document.createElement('div'); bx.className = 'hvb-box'; el.appendChild(bx); }
  const bsig = JSON.stringify(opt.badges || {});
  if (bx.dataset.sig !== bsig) {
    bx.dataset.sig = bsig; bx.innerHTML = '';
    HV.badges = {};
    for (const k in (opt.badges || {})) { const w = document.createElement('div'); w.innerHTML = opt.badges[k]; const b = w.firstElementChild; b.style.display = 'none'; bx.appendChild(b); HV.badges[k] = b; }
  }
  loop();
};
function placeBadges() {
  if (!HV.badges || !HV.R) return;
  for (const k in HV.badges) {
    const b = HV.badges[k], objs = HV.R.slots[k];
    if (!objs || !objs.length) { b.style.display = 'none'; continue; }
    const bb = new T.Box3(); objs.forEach(o => bb.expandByObject(o));
    if (bb.isEmpty()) { b.style.display = 'none'; continue; }
    const c = new T.Vector3(); bb.getCenter(c); c.project(HV.cam);
    b.style.display = '';
    b.style.left = ((c.x + 1) / 2 * 100) + '%'; b.style.top = ((1 - c.y) / 2 * 100) + '%';
  }
}

/* ================= live preview: any loadout, playing any action (used by the parts gallery) ================= */
let PV = null;
function makePreview() {
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setClearColor(0x000000, 0);
  const scene = new T.Scene();
  threePoint(scene, renderer, false);
  const cam = new T.PerspectiveCamera(30, 1, 0.25, 50);
  const holder = new T.Group(); scene.add(holder);
  const fx = new T.Group(); scene.add(fx);
  const ground = new T.Mesh(new T.CircleGeometry(0.6, 40), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12, depthWrite: false }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = 0.002; scene.add(ground); ground.scale.setScalar(1);
  const bubble = new T.Mesh(sph(0.62, 24), new T.MeshBasicMaterial({ color: 0x8fdcff, transparent: true, opacity: 0, depthWrite: false }));
  scene.add(bubble);
  PV = { ground, view: 'front', renderer, scene, cam, holder, fx, bubble, R: null, sig: '', act: 'idle', t0: 0, rot: 0.55, ink: { weight: 1.2 }, parts: [], frame: null, fired: false };
  // the battle effects play in the preview exactly as on the board: the same particles, timings, shake and flashes
  PV.ctx = { group: fx, parts: new Particles(fx, 700), anims: [], queue: [], shake: 0, el: null, recs: {}, dustK: 0.45 };
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:grab';
  // drag to turn
  let drag = null;
  renderer.domElement.addEventListener('pointerdown', e => { drag = { x: e.clientX, r: PV.rot }; try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) { /* gone */ } });
  renderer.domElement.addEventListener('pointermove', e => { if (drag) { PV.rot = drag.r + (e.clientX - drag.x) * 0.012; if (PV.onRot) PV.onRot(PV.rot); } });
  renderer.domElement.addEventListener('pointerup', () => { drag = null; });
  return PV;
}
// show a loadout in el: L = { torso, core, legs, armL, armR, aux: [] }
R3.preview = function (el, L, doctrine, owner) {
  if (!PV) makePreview();
  PV.auto = null;
  if (PV.renderer.domElement.parentNode !== el) el.appendChild(PV.renderer.domElement);
  const D = DEFS(), mk = id => (id ? { id, hp: D[id].hp } : null);
  const m = { owner: owner || 0, slots: { torso: mk(L.torso), core: mk(L.core), legs: mk(L.legs), armL: mk(L.armL), armR: mk(L.armR), aux: (L.aux || []).map(mk) } };
  const sig = signature(m) + '|' + doctrine;
  if (sig !== PV.sig) {
    while (PV.holder.children.length) PV.holder.remove(PV.holder.children[0]);
    PV.R = buildMech(m, owner || 0, doctrine, {}); PV.holder.add(PV.R.root); PV.sig = sig; PV.base = PV.R.root.scale.x; PV.gait = {};
    PV.holder.rotation.y = 0; PV.holder.updateMatrixWorld(true);
    const bb = new T.Box3().setFromObject(PV.R.root), c = new T.Vector3(), sz = new T.Vector3(); bb.getCenter(c); bb.getSize(sz);
    PV.frame = { c, h: Math.max(sz.y, sz.x * 1.1, sz.z * 1.1), ht: sz.y, w: Math.max(sz.x, sz.z) };
  }
  pvLoop();
};
// the doctrine picker's showroom: the army's typical machine, idling, turned by dragging, and now and then showing off
// one of its moves
R3.showcase = function (el, doctrine, owner) {
  R3.preview(el, ARCHETYPE[doctrine] || ARCHETYPE.assault, doctrine, owner);
  PV.view = 'show'; PV.rot = 0.5; PV.act = 'idle';
  PV.auto = { next: clock() + 2.5 };
};
function pvAutoAct(t) {
  const R = PV.R, acts = ['jump', 'brace'];
  for (const k of ['armL', 'armR']) if (R.muzzles[k]) acts.push(R.muzzles[k].cat === 'melee' ? 'melee' : k === 'armL' ? 'fireL' : 'fireR');
  PV.act = acts[Math.floor(Math.random() * acts.length)]; PV.t0 = t; PV.done = {};
  PV.auto.next = t + 4 + Math.random() * 3;
}
R3.previewPlay = function (act) { if (PV) { PV.act = act; PV.t0 = clock(); PV.done = {}; } };
R3.previewTurn = function (rot) { if (PV) PV.rot = rot; };
R3.previewView = function (v) { if (PV) PV.view = v; };
R3.previewOnTurn = function (fn) { if (PV) PV.onRot = fn; };
let pvLooping = false;
function pvLoop() {
  if (pvLooping) return; pvLooping = true;
  let last = clock();
  const step = () => {
    if (!PV || !PV.renderer.domElement.isConnected) { pvLooping = false; return; }
    requestAnimationFrame(step);
    const t = clock(), dt = Math.min(0.05, t - last); last = t;
    const el = PV.renderer.domElement, w = el.clientWidth, h = el.clientHeight;
    if (w && h && (PV.w !== w || PV.h !== h)) { PV.w = w; PV.h = h; PV.renderer.setSize(w, h, false); PV.cam.aspect = w / h; PV.cam.updateProjectionMatrix(); }
    if (!PV.R || !PV.frame) return;
    if (PV.auto && PV.act === 'idle' && t > PV.auto.next) pvAutoAct(t);
    const host = el.parentNode;
    if (host && PV.ctx.el !== host) { PV.ctx.el = host; if (getComputedStyle(host).position === 'static') host.style.position = 'relative'; }
    withPV(() => {
      pvAnimate(t, dt);
      const C = PV.ctx;
      for (let i = C.queue.length - 1; i >= 0; i--) if (C.queue[i].t <= t) { const q = C.queue.splice(i, 1)[0]; try { q.fn(); } catch (e) { /* keep animating */ } }
      for (let i = C.anims.length - 1; i >= 0; i--) { let keep = false; try { keep = C.anims[i](t); } catch (e) { keep = false; } if (!keep) C.anims.splice(i, 1); }
      C.parts.update(dt);
    });
    // camera: a showroom 3/4 view, the board's isometric angle, or straight down like the overview
    // the doctrine showroom ('show') fills the view with the mech, centred, whatever the box's shape, with a little
    // headroom for a jump
    const show = PV.view === 'show', tn = 2 * Math.tan(15 * Math.PI / 180);
    // while a weapon fires or the mech is destroyed the camera eases back, so the shot, its impact and the blast stay in view
    const wide = !show && (PV.act === 'fireL' || PV.act === 'fireR' || PV.act === 'destroyed' || PV.act === 'melee');
    PV.zoomK = (PV.zoomK || 1) + ((wide ? 1.75 : 1) - (PV.zoomK || 1)) * Math.min(1, dt * 2.5);
    const f = PV.frame, dist = (show ? Math.max(f.ht * 1.12, f.w * 1.05 / PV.cam.aspect) / tn * 1.15 : f.h / tn * (PV.view === 'front' ? 1.5 : 1.7)) * (show ? 1 : PV.zoomK);
    const el2 = PV.view === 'top' ? 1.35 : PV.view === 'iso' ? 0.62 : show ? 0.12 : 0.18, az = PV.view === 'front' || show ? 0 : 0.785;
    PV.cam.position.set(f.c.x + Math.sin(az) * Math.cos(el2) * dist, f.c.y + Math.sin(el2) * dist, f.c.z + Math.cos(az) * Math.cos(el2) * dist); PV.cam.lookAt(f.c.x, show ? f.c.y : f.c.y * 0.8, f.c.z);
    if (PV.ctx.shake > 0.002) { PV.cam.position.add(new T.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(PV.ctx.shake * 0.6)); PV.ctx.shake *= 0.86; }
    PV.renderer.render(PV.scene, PV.cam);
    inkPass(PV.renderer, PV.scene, PV.cam, PV.holder, PV.ink);
  };
  requestAnimationFrame(step);
}
// run battle effects against the preview's own context instead of the board's
function withPV(fn) { const saved = BD; BD = PV.ctx; try { return fn(); } finally { BD = saved; } }
// a stand-in for the board's mech record, so charge() and the weapon profiles can find the muzzle
function pvAtt() { return PV.att && PV.att.R === PV.R ? PV.att : (PV.att = { R: PV.R, gone: false }); }
// one-shot effects: a flash, a tracer, sparks
function pvFlash(pos, col, size, life) {
  const m = new T.Mesh(sph(size, 12), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 1, blending: T.AdditiveBlending, depthWrite: false }));
  m.position.copy(pos); PV.fx.add(m); PV.parts.push({ m, t0: clock(), life, grow: 2.2 });
}
function pvTracer(from, dir, col) {
  const to = from.clone().addScaledVector(dir, 2.4);
  const g = new T.BufferGeometry().setFromPoints([from, to]);
  const l = new T.Line(g, new T.LineBasicMaterial({ color: col, transparent: true, opacity: 1 }));
  PV.fx.add(l); PV.parts.push({ m: l, t0: clock(), life: 0.35 });
}
function pvSparks(pos, col) {
  for (let i = 0; i < 12; i++) {
    const m = new T.Mesh(box(0.025, 0.025, 0.025), new T.MeshBasicMaterial({ color: col, transparent: true }));
    m.position.copy(pos); PV.fx.add(m);
    PV.parts.push({ m, t0: clock(), life: 0.6, v: new T.Vector3((Math.random() - 0.5) * 1.6, Math.random() * 1.4, (Math.random() - 0.2) * 1.6) });
  }
}
// keyframes: [[time, value, ease?], ...]; ease 'out' snaps in fast, 'in' starts slow, default eases both ways
function kf(q, keys) {
  if (q <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (q <= keys[i][0]) {
      const [t0, v0] = keys[i - 1], [t1, v1, e] = keys[i], u = (q - t0) / (t1 - t0);
      const k = e === 'out' ? 1 - Math.pow(1 - u, 3) : e === 'in' ? u * u * u : e === 'lin' ? u : u * u * (3 - 2 * u);
      return v0 + (v1 - v0) * k;
    }
  }
  return keys[keys.length - 1][1];
}
// digging in: a short rise (anticipation), a hard drop that overshoots (the slam), a settle (follow-through)
const DIG_IN = [[0, 0], [0.25, -0.28, 'in'], [0.42, 1.18, 'out'], [0.62, 0.92], [0.85, 1]];
// packing up: a push down to break free, then a lift back to standing with a small overshoot
const DIG_OUT = [[0, 1], [0.15, 1.08], [0.45, -0.1, 'out'], [0.65, 0]];
const digPose = (q, into) => kf(q, into ? DIG_IN : DIG_OUT);
// a ring that spreads on the ground: dust, shockwaves, shield pops; reads well from straight above
function pvRing(x, z, col, size, life) {
  const m = new T.Mesh(new T.RingGeometry(0.8, 1, 36), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, side: T.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.01, z); m.scale.setScalar(0.05); PV.fx.add(m);
  PV.parts.push({ m, t0: clock(), life, ring: size });
}
// a slash trail: a flat arc swept around the body at chest height
function pvArc(c, r, a0, sweep, col, y) {
  const m = new T.Mesh(new T.RingGeometry(r * 0.72, r, 28, 1, a0, sweep), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, side: T.DoubleSide, blending: T.AdditiveBlending, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(c.x, y, c.z); PV.fx.add(m);
  PV.parts.push({ m, t0: clock(), life: 0.35 });
}
function pvSmoke(p) {
  for (let i = 0; i < 6; i++) {
    const m = new T.Mesh(sph(0.06 + Math.random() * 0.05, 8), new T.MeshBasicMaterial({ color: 0x3a3f45, transparent: true, opacity: 0.7, depthWrite: false }));
    m.position.copy(p).add(new T.Vector3((Math.random() - 0.5) * 0.25, Math.random() * 0.1, (Math.random() - 0.5) * 0.25)); PV.fx.add(m);
    PV.parts.push({ m, t0: clock() + i * 0.05, life: 1.4, grow: 1.6, v: new T.Vector3((Math.random() - 0.5) * 0.15, 0.35 + Math.random() * 0.2, (Math.random() - 0.5) * 0.15), smoke: true });
  }
}
const pvArmKey = (R, want) => (want && R.arms[want] ? want : R.arms.armR ? 'armR' : R.arms.armL ? 'armL' : null);
// the body's facing in the scene, so ground effects land in front of it
function pvFwd() { return new T.Vector3(Math.sin(PV.rot), 0, Math.cos(PV.rot)); }
function pvAnimate(t, dt) {
  const R = PV.R, root = R.root, act = PV.act, q = t - PV.t0, base = PV.base || 1;
  PV.holder.rotation.y = PV.rot;
  root.rotation.set(0, 0, 0); root.position.set(0, 0, 0); root.scale.setScalar(base);
  R.torso.rotation.set(0, 0, 0); R.hips.rotation.z = 0;
  let hipY = R.hipY, moving = false, crouch = 0, speed = 0;
  // rest pose first; each action then layers its own keyframes on top
  for (const k in R.arms) { const a = R.arms[k]; a.arm.rotation.x = -Math.sin(t * 1.3) * 0.03; a.arm.rotation.z = R.style === 'assault' ? (k === 'armL' ? -0.14 : 0.14) : 0; a.el.rotation.x = a.rest != null ? a.rest : -Math.PI / 2; }
  if (R.legs && R.kind !== 'biped') R.legs.forEach(hip => { hip.rotation.x = 0; if (hip.userData.knee) hip.userData.knee.rotation.x = 0; });
  if (R.stakes && act !== 'entrench') R.stakes.forEach(st2 => { st2.g.rotation.z = 0; st2.g.position.y = -0.06; });
  PV.bubble.material.opacity = 0; PV.bubble.scale.setScalar(1);
  const c = PV.frame.c, fwd = pvFwd(), side = k => (k === 'armL' ? -1 : 1);
  const once = (key, fn) => { if (!PV.done) PV.done = {}; if (!PV.done[key]) { PV.done[key] = true; PV.scene.updateMatrixWorld(true); fn(); } };
  const muzzleAt = k => { const p = new T.Vector3(); R.muzzles[k].o.getWorldPosition(p); return p; };
  if (act === 'walk') {
    moving = true; speed = R.legsG && (R.rig || R.quad) ? 1.4 * (R.rig || R.quad).stride * R.legsG.getWorldScale(new T.Vector3()).z / 0.6 : 0;
    root.rotation.x = 0.05;                                              // lean into the walk
    // hover banks and pitches into the glide; treads rumble with a nose-down surge
    if (R.kind === 'hover') { hipY += 0.03 * Math.sin(t * 2.2); root.rotation.x = 0.14; root.rotation.z = 0.08 * Math.sin(t * 1.8); R.torso.rotation.y = -0.15 * Math.sin(t * 1.8); }
    if (R.kind === 'treads') { root.rotation.x = 0.035 + 0.012 * Math.sin(t * 24); hipY += 0.006 * Math.sin(t * 31); }
  } else if (act === 'fireL' || act === 'fireR') {
    // anticipation: turn into the shot and raise the weapon; a beat of aim; the kick; follow-through and settle.
    // The timing is the weapon's own: a long gun winds up for seconds, a pistol barely at all
    const k = pvArmKey(R, act === 'fireL' ? 'armL' : 'armR');
    const mz0 = k && R.muzzles[k], P = mz0 && mz0.cat !== 'melee' ? (FIRE[mz0.id] || FIRE[FIRE_CAT[mz0.cat]]) : null;
    const wind = P ? P.wind : 0.42, flight = P ? (FLIGHT[mz0.id] || 0.2) : 0;
    // the pose keyframes are written for a 0.42s wind-up; stretch them to this weapon's
    const qq = q < wind ? q / wind * 0.42 : 0.42 + (q - wind);
    if (k && P) {
      if (q >= 0) once('charge', () => charge(pvAtt(), mz0.cat, wind, k, P));
      if (q >= wind) once('shot', () => {
        const from = muzzleAt(k), col = FX_COL[mz0.cat] || 0xffffff;
        const dir = new T.Vector3(0, 0, 1).applyQuaternion(mz0.o.getWorldQuaternion(new T.Quaternion())).setY(0).normalize();
        // a target in front of the mech: the ground for shells and missiles, chest height for everything else
        const lob = mz0.cat === 'missile' || mz0.cat === 'artillery';
        const to = from.clone().addScaledVector(dir, lob ? 1.05 : 1.0); to.y = lob ? 0.08 : Math.max(0.25, from.y * 0.85);
        // keep the impact inside the frame whichever way the mech is turned
        to.x = c.x + Math.max(-0.55, Math.min(0.55, to.x - c.x));
        const ctx = { att: pvAtt(), from, to, col, dir, f: {}, jitter: sz => to.clone().add(new T.Vector3(rand(-sz, sz), rand(-sz, sz) * 0.6, rand(-sz, sz))), kick: () => {} };
        P.fire(ctx);
        schedule(flight, () => impactFx(to, P.impact, col, true));
      });
    }
    if (k) {
      const a = R.arms[k], sd = side(k), mz = R.muzzles[k], q0 = q; { const q = qq;
      R.torso.rotation.y = kf(q, [[0, 0], [0.25, -0.35 * sd], [0.38, -0.35 * sd], [0.42, 0.05 * sd, 'out'], [0.7, -0.22 * sd], [1.3, 0]]);
      a.el.rotation.x = kf(q, [[0, a.rest != null ? a.rest : -Math.PI / 2], [0.25, -Math.PI / 2 - 0.08], [1.0, -Math.PI / 2], [1.4, a.rest != null ? a.rest : -Math.PI / 2]]);
      a.arm.rotation.x = kf(q, [[0, 0], [0.25, -0.15], [0.38, -0.12], [0.42, -0.75, 'out'], [0.62, 0.1], [0.85, -0.08], [1.2, 0]]);
      a.arm.rotation.z = kf(q, [[0, a.arm.rotation.z], [0.25, -0.12 * sd], [1.2, a.arm.rotation.z]]);
      root.position.z = kf(q, [[0, 0], [0.38, 0.02], [0.42, -0.09, 'out'], [0.75, 0.01], [1.2, 0]]);
      root.rotation.x = kf(q, [[0, 0], [0.38, 0.06], [0.42, -0.12, 'out'], [0.75, 0.03], [1.2, 0]]);
      crouch = kf(q, [[0, 0], [0.3, 0.035], [0.42, 0.06, 'out'], [0.9, 0.01], [1.3, 0]]);
      if (mz && mz.spin) mz.spin.rotation.z += dt * (q0 > wind * 0.4 && q0 < wind + 0.6 ? 45 : 0.5);
      // a weapon with no battle profile still shows a muzzle flash
      if (mz && !P && q >= 0.42) once('fire', () => { const p = muzzleAt(k), col = FX_COL[mz.cat] || 0xffffff; pvFlash(p, col, 0.14, 0.35); pvFlash(p, 0xffffff, 0.07, 0.15); });
    } }
    if (q > wind + flight + 1.8) PV.act = 'idle';
  } else if (act === 'melee') {
    // anticipation: crouch and coil away; the strike: lunge and sweep; follow-through: overswing, then recover
    const k = Object.keys(R.muzzles).find(kk => R.muzzles[kk].cat === 'melee' || R.muzzles[kk].cat === 'siege') || pvArmKey(R);
    if (k) {
      const a = R.arms[k], sd = side(k);
      R.torso.rotation.y = kf(q, [[0, 0], [0.32, 0.75 * sd, 'in'], [0.44, -0.85 * sd, 'out'], [0.7, -0.55 * sd], [1.25, 0]]);
      a.arm.rotation.x = kf(q, [[0, 0], [0.32, 0.9, 'in'], [0.44, -1.5, 'out'], [0.62, -1.1], [1.25, 0]]);
      a.arm.rotation.z = kf(q, [[0, a.arm.rotation.z], [0.32, 0.55 * sd], [0.44, -0.45 * sd, 'out'], [1.25, a.arm.rotation.z]]);
      a.el.rotation.x = kf(q, [[0, a.rest != null ? a.rest : -Math.PI / 2], [0.32, -2.1], [0.44, -1.2, 'out'], [1.25, a.rest != null ? a.rest : -Math.PI / 2]]);
      root.position.z = kf(q, [[0, 0], [0.32, -0.05], [0.44, 0.2, 'out'], [0.8, 0.16], [1.25, 0]]);
      root.rotation.x = kf(q, [[0, 0], [0.32, -0.08], [0.44, 0.2, 'out'], [0.8, 0.1], [1.25, 0]]);
      crouch = kf(q, [[0, 0], [0.32, 0.07, 'in'], [0.44, 0.03, 'out'], [0.8, 0.05], [1.25, 0]]);
      if (q >= 0.36) once('slash', () => {
        const wp = new T.Vector3(); root.getWorldPosition(wp);
        const yaw = Math.atan2(fwd.x, fwd.z);
        pvArc(wp, 0.55, -yaw + Math.PI / 2 - 1.3 * sd - (sd < 0 ? 1.4 : 0), 2.6, FX_COL.melee, c.y * 1.05);
      });
      if (q >= 0.44) once('hit', () => {
        const mz = R.muzzles[k], P = mz && (FIRE[mz.id] || FIRE[FIRE_CAT[mz.cat]]), p = muzzleAt(k).addScaledVector(fwd, 0.2);
        if (P && P.fire) { P.fire({ att: pvAtt(), from: p, to: p, col: FX_COL[mz.cat] || FX_COL.melee, dir: fwd, f: {}, jitter: () => p.clone(), kick: () => {} }); schedule(FLIGHT[mz.id] || 0.2, () => impactFx(p, P.impact, FX_COL[mz.cat] || FX_COL.melee, true)); }
        else { pvSparks(p, FX_COL.melee); pvFlash(p, 0xffffff, 0.06, 0.15); }
      });
    }
    if (q > 1.4) PV.act = 'idle';
  } else if (act === 'jump') {
    // crouch, stretch on launch, a tucked arc with the shadow shrinking, squash on landing and recover
    moving = q > 0.3 && q < 1.15;
    const air = q < 0.32 ? 0 : q > 1.12 ? 0 : Math.sin((q - 0.32) / 0.8 * Math.PI);
    root.position.y = air * Math.min(0.5, PV.frame.h * 0.3);
    root.position.z = kf(q, [[0, 0], [0.32, 0], [1.12, 0.12], [1.6, 0]]);
    crouch = kf(q, [[0, 0], [0.3, 0.1, 'in'], [0.38, 0, 'out'], [0.7, 0.07], [1.08, 0.02], [1.16, 0.11, 'out'], [1.6, 0]]);
    const sq = kf(q, [[0, 1], [0.3, 0.9], [0.38, 1.1, 'out'], [0.6, 1], [1.12, 1.04], [1.16, 0.86, 'out'], [1.45, 1]]);
    root.scale.set(base / Math.sqrt(sq), base * sq, base / Math.sqrt(sq));
    for (const k in R.arms) { R.arms[k].arm.rotation.x = kf(q, [[0, 0], [0.3, 0.7], [0.4, -0.9, 'out'], [1.1, -0.3], [1.2, 0.5], [1.6, 0]]); }
    if (q >= 0.33) once('launch', () => { const wp = new T.Vector3(); root.getWorldPosition(wp); pvRing(wp.x, wp.z, 0xd9d2c3, 0.75, 0.5); dust(new T.Vector3(wp.x, 0.05, wp.z), 6, 0.2); });
    if (q >= 1.13) once('land', () => { const wp = new T.Vector3(); root.getWorldPosition(wp); dustRing(new T.Vector3(wp.x, 0.05, wp.z), 14, 0.7); sparks(new T.Vector3(wp.x, 0.05, wp.z), 0xcbbf9e, 6); shake(0.06); });
    if (q > 1.7) PV.act = 'idle';
  } else if (act === 'brace') {
    // a small rise, then drop into a guard with both arms crossed; the shield pops with an overshoot
    crouch = kf(q, [[0, 0], [0.12, -0.015], [0.3, 0.08, 'out'], [2.0, 0.07], [2.4, 0]]);
    for (const k in R.arms) {
      const a = R.arms[k], sd = side(k);
      a.arm.rotation.x = kf(q, [[0, 0], [0.3, -1.05, 'out'], [2.0, -1.0], [2.4, 0]]);
      a.arm.rotation.z = kf(q, [[0, a.arm.rotation.z], [0.3, -0.55 * sd, 'out'], [2.0, -0.5 * sd], [2.4, a.arm.rotation.z]]);
      a.el.rotation.x = kf(q, [[0, a.rest != null ? a.rest : -Math.PI / 2], [0.3, -1.9, 'out'], [2.0, -1.9], [2.4, a.rest != null ? a.rest : -Math.PI / 2]]);
    }
    root.rotation.x = kf(q, [[0, 0], [0.3, 0.12, 'out'], [2.0, 0.1], [2.4, 0]]);
    const pop = kf(q, [[0, 0], [0.28, 0], [0.38, 1.18, 'out'], [0.5, 0.96], [0.6, 1], [2.0, 1], [2.3, 0]]);
    PV.bubble.scale.setScalar(Math.max(0.01, pop)); PV.bubble.material.opacity = 0.3 * Math.min(1, pop) * (0.85 + 0.15 * Math.sin(t * 6));
    PV.bubble.position.copy(c);
    if (q >= 0.3) once('pop', () => pvRing(c.x, c.z, 0x8fdcff, 0.85, 0.5));
    if (q > 2.5) PV.act = 'idle';
  } else if (act === 'entrench') {
    // rise, slam down into the ground with dust at every foot, hold dug in, then pack up. A quad takes its time: each
    // leg in turn lifts, swings out, stamps down and drives in, then they pack up in the same order, faster
    const quad = R.kind === 'quad', IN = quad ? 3.4 : 0.85, HOLD = quad ? 4.4 : 2.1, OUT = quad ? 1.8 : 0.65;
    const into = q < HOLD, dg = into ? digPose(Math.min(1, q / IN) * 0.85, true) : digPose(Math.min(1, (q - HOLD) / OUT) * 0.65, false);
    if (quad) {
      const st = PV.gait || (PV.gait = {});
      const g = into ? Math.min(1, q / IN) : Math.min(1, (q - HOLD) / OUT);
      st.digLegs = [0, 1, 2, 3].map(i => { const e = Math.max(0, Math.min(1, (g - 0.06 - i * 0.21) / 0.27)); return into ? e : 1 - e; });
      if (into) st.digLegs.forEach((e, i) => { if (e >= 0.62) once('stamp' + i, () => { const L = R.quad.legs[i], p = new T.Vector3(); L.ankle.getWorldPosition(p); p.y = 0.05; dust(p, 7, 0.12, 0.6); sparks(p, 0xcbbf9e, 6); shockRing(p.clone(), 0xcbbf9e, 0.25, 0.4); shake(0.07); }); });
    }
    else crouch = 0.16 * dg;
    root.rotation.x = into ? kf(q, [[0, 0], [0.25, -0.07], [0.42, 0.13, 'out'], [0.7, 0.02], [0.85, 0.03]]) : kf(q - 2.1, [[0, 0.03], [0.15, 0.08], [0.45, -0.05, 'out'], [0.65, 0]]);
    root.position.y = into ? kf(q, [[0, 0], [0.25, 0.03, 'in'], [0.42, 0, 'out']]) : kf(q - 2.1, [[0, 0], [0.45, 0.025, 'out'], [0.65, 0]]);
    for (const k in R.arms) { const a = R.arms[k]; a.arm.rotation.x = kf(q, [[0, 0], [0.25, 0.35], [0.42, -0.25, 'out'], [0.8, -0.1], [2.1, -0.1], [2.75, 0]]); }
    if (R.stakes) R.stakes.forEach(st2 => { const e = Math.max(0, Math.min(1, dg)); st2.g.rotation.z = st2.sx * 0.95 * e; st2.g.position.y = -0.06 - 0.11 * e; });
    if (!quad && q >= 0.42) once('slam', () => {
      const feet = R.stakes && R.stakes.length ? R.stakes.map(x => x.g) : (R.legs || []).map(h => h.userData.ankle).filter(Boolean);
      feet.forEach(o => { const p = new T.Vector3(); o.getWorldPosition(p); pvRing(p.x, p.z, 0xcbbf9e, 0.38, 0.55); pvSparks(new T.Vector3(p.x, 0.04, p.z), 0xcbbf9e); });
      pvRing(c.x, c.z, 0xd9d2c3, 1.0, 0.7);
    });
    if (q >= HOLD + OUT * 0.7) once('lift', () => pvRing(c.x, c.z, 0xd9d2c3, 0.7, 0.45));
    if (q > HOLD + OUT + 0.3) PV.act = 'idle';
  } else if (act === 'hit') {
    // knocked back and twisted, arms flung out, then a staggered recovery
    root.position.z = kf(q, [[0, 0], [0.08, -0.2, 'out'], [0.4, -0.14], [0.9, 0]]);
    root.rotation.x = kf(q, [[0, 0], [0.08, -0.42, 'out'], [0.3, -0.14], [0.45, -0.22], [0.9, 0]]);
    R.torso.rotation.y = kf(q, [[0, 0], [0.08, 0.6, 'out'], [0.35, -0.15], [0.6, 0.06], [0.9, 0]]);
    crouch = kf(q, [[0, 0], [0.12, 0.06, 'out'], [0.5, 0.03], [0.9, 0]]);
    for (const k in R.arms) { const sd = side(k); R.arms[k].arm.rotation.x = kf(q, [[0, 0], [0.08, 0.6, 'out'], [0.5, 0.1], [0.9, 0]]); R.arms[k].arm.rotation.z = kf(q, [[0, R.arms[k].arm.rotation.z], [0.08, 0.5 * sd, 'out'], [0.9, R.arms[k].arm.rotation.z]]); }
    once('impact', () => { const p = new T.Vector3(c.x, c.y * 1.1, c.z).addScaledVector(fwd, 0.12); impactFx(p, 'heavy', 0xffc46a, true); });
    if (q > 1.0) PV.act = 'idle';
  } else if (act === 'destroyed') {
    // stagger, knees buckle, topple, a bounce on impact and a blast with smoke
    root.position.z = kf(q, [[0, 0], [0.1, -0.16, 'out'], [0.4, 0.04], [1.0, 0.06]]);
    root.rotation.x = kf(q, [[0, 0], [0.1, -0.4, 'out'], [0.4, 0.25], [0.7, 0.15], [1.0, 0.1]]);
    R.torso.rotation.y = kf(q, [[0, 0], [0.1, 0.6, 'out'], [0.4, -0.3], [0.8, 0.35]]);
    crouch = kf(q, [[0, 0], [0.1, 0.05], [0.4, 0.03], [0.65, 0.17, 'in']]);
    const tk = R.kind === 'treads' ? 0.28 : 1; root.rotation.z = tk * kf(q, [[0, 0], [0.55, 0.08], [0.95, -1.4, 'in'], [1.07, -1.22, 'out'], [1.2, -1.4]]);
    if (tk < 1) R.torso.rotation.x = kf(q, [[0, 0], [0.55, 0.1], [0.95, 0.75, 'in'], [1.07, 0.6, 'out'], [1.2, 0.72]]);
    const fx = Math.max(0.34, PV.frame.h * 0.42) * tk; root.position.x = kf(q, [[0, 0], [0.55, 0], [0.95, -fx, 'in'], [1.2, -fx - 0.04]]);
    root.position.y = kf(q, [[0, 0], [0.95, -0.06], [1.07, 0.03, 'out'], [1.2, -0.07]]);
    for (const k in R.arms) R.arms[k].arm.rotation.x = kf(q, [[0, 0], [0.1, 0.7, 'out'], [0.4, -0.5], [0.95, -1.1], [1.1, -0.7]]);
    if (q >= 0.1) once('stagger', () => { pvSparks(new T.Vector3(c.x, c.y, c.z), 0xffb04a); pvFlash(c.clone(), 0xff9a3a, 0.08, 0.25); });
    if (q >= 0.25) once('blast', () => destroyMech(null, new T.Vector3(c.x, c.y * 0.6, c.z)));
    if (q > 5.2) PV.act = 'idle';
  }
  // the legs: IK keeps the feet planted through every crouch, and walks on the spot
  if (R.kind === 'biped') {
    const st = PV.gait || (PV.gait = {});
    st.crouch = crouch;
    const g = gaitStep(st, R, dt, speed), gk = R.style === 'armored' ? 0.7 : 1;
    if (g) {
      hipY += g.bob; R.hips.rotation.z += g.roll * gk; R.torso.rotation.y += g.twist * gk;
      if (act === 'walk') for (const k in R.arms) R.arms[k].arm.rotation.x += -(k === 'armL' ? g.swing[1] : g.swing[0]) * (R.style === 'armored' ? 0.55 : 0.85);
    }
  } else if (R.kind === 'quad') {
    const st = PV.gait || (PV.gait = {}); st.crouch = crouch * 1.3; if (act !== 'entrench') { st.dig = 0; st.digLegs = null; }
    const g = quadStep(st, R, dt, speed);
    if (g) { R.legsG.position.set(g.hubX, g.hubY, g.hubZ); R.hips.position.x = g.bodyX; R.hips.position.z = g.bodyZ; hipY += g.bob - st.crouch * R.legsG.scale.y; R.hips.rotation.z += g.roll; R.hips.rotation.x = g.pitch; R.torso.rotation.y += g.yaw; }
  } else hipY -= crouch * (R.legsG ? R.legsG.scale.y : 1);
  if (R.hips) R.hips.position.y = hipY + (moving ? 0 : Math.sin(t * 1.6) * 0.004);
  if (R.head) R.head.rotation.y = Math.sin(t * 0.9) * 0.3 + R.torso.rotation.y * -0.4;
  if (R.halo) R.halo.rotation.z = t * 0.7;
  if (R.gyro) { R.gyro.rotation.y = t * 1.1; R.gyro.rotation.x = 0.4 * Math.sin(t * 0.7); }
  if (R.core && R.coreLive) R.core.scale.setScalar(1 + 0.15 * Math.sin(t * 4));
  if (R.thrusters) R.thrusters.forEach(f => { f.visible = moving && R.kind !== 'treads'; f.scale.y = 1 + Math.random() * (act === 'jump' ? 2 : 1); });
  if (R.boosters) R.boosters.forEach(f => { f.visible = moving; f.scale.y = 1 + Math.random() * 0.8; });
  for (const k in R.muzzles) { const sp = R.muzzles[k].spin; if (sp && act !== 'fireL' && act !== 'fireR') sp.rotation.z += dt * 0.8; }
  // the shadow follows the body and shrinks as it leaves the ground
  if (PV.ground) { const wp = new T.Vector3(); root.getWorldPosition(wp); PV.ground.position.x = wp.x; PV.ground.position.z = wp.z; const hgt = Math.max(0, root.position.y); PV.ground.scale.setScalar(1 - Math.min(0.55, hgt * 0.9)); PV.ground.material.opacity = 0.14 * (1 - Math.min(0.6, hgt)); }

  // effects age out
  for (let i = PV.parts.length - 1; i >= 0; i--) {
    const p = PV.parts[i], k = (t - p.t0) / p.life;
    if (k >= 1) { PV.fx.remove(p.m); PV.parts.splice(i, 1); continue; }
    if (k < 0) { p.m.visible = false; continue; } p.m.visible = true;
    if (p.m.material) p.m.material.opacity = (p.smoke ? 0.7 : p.ring ? 0.9 : 1) * (1 - k);
    if (p.grow) p.m.scale.setScalar(1 + k * p.grow);
    if (p.ring) p.m.scale.setScalar(0.05 + p.ring * (1 - Math.pow(1 - k, 2)));
    if (p.v) { p.m.position.addScaledVector(p.v, dt); if (!p.smoke) p.v.y -= dt * 3; }
  }
}
})();
