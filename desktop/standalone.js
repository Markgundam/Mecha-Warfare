/* Mecha Warfare desktop build: stands in for the claude.ai runtime the page normally runs in.
   - db: documents live in this browser's localStorage. A match document lives with its host;
     the guest reads and writes it over a direct peer-to-peer link (PeerJS), so two copies of
     the game can play each other over the internet with just a match code.
   - user: a random id kept in this browser stands in for the signed-in account.
   Loaded before the game's own scripts. */
(function () {
  'use strict';
  const PREFIX = 'mecha-warfare-v1-';          // peer ids on the public PeerJS broker
  const LS = 'mwdb:';
  const now = () => Date.now();
  const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const err = (code, message) => Object.assign(new Error(message || code), { code });

  function lsGet(p) { try { const v = localStorage.getItem(LS + p); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lsSet(p, v) { try { if (v == null) localStorage.removeItem(LS + p); else localStorage.setItem(LS + p, JSON.stringify(v)); } catch (e) { /* storage full */ } }
  function lsKeys(prefix) {
    const out = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(LS + prefix)) out.push(k.slice(LS.length)); } } catch (e) { /* no storage */ }
    return out;
  }
  let ME;
  try { ME = localStorage.getItem('mw-standalone-id'); if (!ME) { ME = 'u' + Math.random().toString(36).slice(2, 10) + now().toString(36); localStorage.setItem('mw-standalone-id', ME); } }
  catch (e) { ME = 'u' + Math.random().toString(36).slice(2, 12); }

  const snap = (id, d) => ({ id, exists: d != null, data: () => (d == null ? undefined : clone(d)) });
  const isChild = (col, path) => path.startsWith(col + '/') && path.slice(col.length + 1).indexOf('/') < 0;
  const codeOf = p => { const m = /^matches\/([^/]+)$/.exec(p); return m ? m[1] : null; };
  const isHost = code => { const d = lsGet('matches/' + code); return !!d && d.hostId === ME; };
  // private history is already kept by the game's own local saves; no second copy here
  const skip = p => p.startsWith('data/users/');

  /* ---------- local subscribers ---------- */
  const docSubs = {};
  const colSubs = new Set();
  function fireCols(path) { colSubs.forEach(s => { if (isChild(s.col, path)) s.fire(); }); }
  function notify(path) {
    const d = lsGet(path), id = path.split('/').pop();
    (docSubs[path] || new Set()).forEach(f => { try { f(snap(id, d)); } catch (e) { console.error(e); } });
    fireCols(path);
    hostBroadcast(path, d);
  }

  /* ---------- hosting: this browser owns the match document and serves it to the guest ---------- */
  const hosts = {};
  const leases = {};
  function acquire(code, holder, ttl) {
    const l = leases[code];
    if (l && l.holder !== holder && l.until > now()) return { acquired: false };
    leases[code] = { holder, until: now() + (ttl || 8000) };
    return { acquired: true };
  }
  function hostUp(code) {
    if (hosts[code]) return hosts[code];
    const h = { peer: null, conns: new Set() };
    hosts[code] = h;
    const start = () => {
      const peer = new window.Peer(PREFIX + code);
      h.peer = peer;
      peer.on('connection', c => {
        c.on('open', () => h.conns.add(c));
        c.on('data', m => hostMsg(code, c, m));
        c.on('close', () => h.conns.delete(c));
        c.on('error', () => h.conns.delete(c));
      });
      peer.on('disconnected', () => { setTimeout(() => { if (!peer.destroyed) try { peer.reconnect(); } catch (e) { /* retry later */ } }, 2000); });
      peer.on('error', e => {
        // the broker still holds the id from a previous session for a few seconds: try again
        if (e.type === 'unavailable-id') { try { peer.destroy(); } catch (x) { /* gone */ } setTimeout(start, 4000); }
      });
    };
    start();
    return h;
  }
  function hostMsg(code, c, m) {
    if (!m || typeof m !== 'object') return;
    const path = 'matches/' + code;
    const reply = r => { try { c.send(Object.assign({ id: m.id }, r)); } catch (e) { /* link dropped */ } };
    if (m.op === 'get') return reply({ doc: lsGet(path) });
    if (m.op === 'sub') { c.subbed = true; try { c.send({ push: true, doc: lsGet(path) }); } catch (e) { /* link dropped */ } return; }
    if (m.op === 'update') {
      const d = lsGet(path);
      if (!d) return reply({ error: 'not_found' });
      lsSet(path, Object.assign(d, m.data || {})); notify(path);
      return reply({ ok: true });
    }
    if (m.op === 'acquire') return reply(acquire(code, m.holder, m.ttlMs));
    return reply({ error: 'permission_denied' });
  }
  function hostBroadcast(path, d) {
    const code = codeOf(path), h = code && hosts[code];
    if (!h || !isHostOrGone(code, d)) return;
    h.conns.forEach(c => { if (c.subbed) try { c.send({ push: true, doc: d }); } catch (e) { /* link dropped */ } });
  }
  const isHostOrGone = (code, d) => d == null || d.hostId === ME;

  /* ---------- joining: reach the host's copy of the match ---------- */
  const links = {};
  let peerP = null;
  function myPeer() {
    if (peerP) return peerP;
    peerP = new Promise((res, rej) => {
      const p = new window.Peer();
      let opened = false;
      p.on('open', () => { opened = true; res(p); });
      p.on('disconnected', () => { setTimeout(() => { if (!p.destroyed) try { p.reconnect(); } catch (e) { /* retry later */ } }, 2000); });
      p.on('error', e => {
        if (!opened) { peerP = null; rej(err('unavailable', 'connection service: ' + e.type)); return; }
        // the host is not online right now: fail whoever was waiting on that link
        if (e.type === 'peer-unavailable') for (const code in links) { const L = links[code]; if (L.fail && String(e.message || '').indexOf(PREFIX + code) >= 0) L.fail(err('host_offline', 'host offline')); }
      });
    });
    return peerP;
  }
  function linkOf(code) { return links[code] || (links[code] = { pend: {}, subs: new Set(), n: 0, open: false, p: null, conn: null, fail: null }); }
  function link(code) {
    const L = linkOf(code);
    if (L.open) return Promise.resolve(L);
    if (L.p) return L.p;
    L.p = myPeer().then(p => new Promise((res, rej) => {
      const c = p.connect(PREFIX + code, { reliable: true });
      L.conn = c;
      const done = () => { clearTimeout(to); L.fail = null; L.p = null; };
      const to = setTimeout(() => { done(); try { c.close(); } catch (e) { /* never opened */ } rej(err('host_offline', 'timeout')); }, 15000);
      L.fail = e => { done(); rej(e); };
      c.on('open', () => { done(); L.open = true; res(L); if (L.subs.size) c.send({ op: 'sub' }); });
      c.on('data', m => onLinkData(code, L, m));
      c.on('close', () => {
        L.open = false;
        Object.values(L.pend).forEach(f => f.rej(err('unavailable', 'closed'))); L.pend = {};
        if (L.subs.size) setTimeout(() => resub(code), 2000);
      });
      c.on('error', () => { /* close follows */ });
    }));
    return L.p;
  }
  function resub(code) {
    const L = linkOf(code);
    if (!L.subs.size || L.open) return;
    link(code).catch(() => setTimeout(() => resub(code), 4000));
  }
  function onLinkData(code, L, m) {
    if (!m || typeof m !== 'object') return;
    if (m.push) {
      cache('matches/' + code, m.doc);
      L.subs.forEach(f => { try { f(snap(code, m.doc)); } catch (e) { console.error(e); } });
      return;
    }
    const p = L.pend[m.id];
    if (!p) return;
    delete L.pend[m.id];
    if (m.error) p.rej(err(m.error)); else p.res(m);
  }
  // a host that has only just come online may not be reachable yet: try once more before giving up
  function rpc(code, msg, tries) {
    tries = tries == null ? 2 : tries;
    return rpc1(code, msg).catch(e => (e.code === 'host_offline' && tries > 1 ? new Promise(r => setTimeout(r, 3000)).then(() => rpc(code, msg, tries - 1)) : Promise.reject(e)));
  }
  function rpc1(code, msg) {
    return link(code).then(L => new Promise((res, rej) => {
      const id = ++L.n;
      L.pend[id] = { res, rej };
      try { L.conn.send(Object.assign({ id }, msg)); } catch (e) { delete L.pend[id]; rej(err('unavailable')); return; }
      setTimeout(() => { if (L.pend[id]) { delete L.pend[id]; rej(err('unavailable', 'timeout')); } }, 15000);
    }));
  }
  // a guest keeps a copy of the match so it shows in "Your matches" and can be resumed
  function cache(path, d) { lsSet(path, d); fireCols(path); }

  /* ---------- the db and user namespaces the game expects ---------- */
  function doc(path) {
    const id = path.split('/').pop(), code = codeOf(path);
    const remote = () => code && !isHost(code);
    return {
      id,
      async get() {
        if (skip(path)) return snap(id, null);
        if (remote()) { const r = await rpc(code, { op: 'get' }); cache(path, r.doc); return snap(id, r.doc); }
        if (code) hostUp(code);
        return snap(id, lsGet(path));
      },
      async set(data) {
        if (skip(path)) return;
        if (code && !(data && data.hostId === ME) && !isHost(code)) throw err('permission_denied');
        lsSet(path, clone(data)); notify(path);
        if (code) hostUp(code);
      },
      async update(data) {
        if (skip(path)) return;
        if (remote()) { await rpc(code, { op: 'update', data: clone(data) }); return; }
        const d = lsGet(path);
        if (!d) throw err('not_found');
        lsSet(path, Object.assign(d, clone(data))); notify(path);
      },
      async delete() {
        if (skip(path)) return;
        if (remote()) { cache(path, null); return; }
        lsSet(path, null); notify(path);
      },
      async acquire(o) {
        o = o || {};
        if (remote()) { const r = await rpc(code, { op: 'acquire', holder: o.holder, ttlMs: o.ttlMs }); return { acquired: !!r.acquired }; }
        return acquire(code, o.holder, o.ttlMs);
      },
      onSnapshot(cb, onErr) {
        if (remote()) {
          const L = linkOf(code);
          L.subs.add(cb);
          if (L.open) { try { L.conn.send({ op: 'sub' }); } catch (e) { /* resub on close */ } }
          else link(code).catch(e => { if (onErr && e.code !== 'host_offline') onErr(e); setTimeout(() => resub(code), 4000); });
          return () => L.subs.delete(cb);
        }
        if (code) hostUp(code);
        (docSubs[path] = docSubs[path] || new Set()).add(cb);
        setTimeout(() => cb(snap(id, lsGet(path))), 0);
        return () => docSubs[path].delete(cb);
      }
    };
  }
  function collection(col) {
    let ord = null, dir = 'asc', lim = Infinity;
    const docs = () => {
      if (skip(col + '/')) return [];
      let ds = lsKeys(col + '/').filter(p => isChild(col, p)).map(p => ({ id: p.split('/').pop(), d: lsGet(p) })).filter(x => x.d);
      if (ord) ds.sort((a, b) => ((a.d[ord] > b.d[ord]) ? 1 : (a.d[ord] < b.d[ord]) ? -1 : 0) * (dir === 'desc' ? -1 : 1));
      return ds.slice(0, lim);
    };
    const q = {
      orderBy(f, d) { ord = f; dir = d || 'asc'; return q; },
      limit(n) { lim = n; return q; },
      where() { return q; },
      async get() { return { docs: docs().map(x => snap(x.id, x.d)) }; },
      onSnapshot(cb) {
        const s = {
          col,
          fire: () => {
            const ds = docs();
            // matches this browser hosts stay reachable while the lobby is open
            if (col === 'matches') ds.forEach(x => { if (x.d.hostId === ME && x.d.status !== 'done') hostUp(x.id); });
            cb({ docs: ds.map(x => snap(x.id, x.d)) });
          }
        };
        colSubs.add(s);
        setTimeout(s.fire, 0);
        return () => colSubs.delete(s);
      }
    };
    return q;
  }
  const db = { doc, collection };
  const user = {
    async id() { return ME; },
    async me() { return { id: ME, name: 'You' }; },
    isOwner: () => true, canEdit: () => true, can: () => true,
    async profiles(ids) { const o = {}; (ids || []).forEach(i => { o[i] = { id: i, name: i === ME ? 'You' : 'Commander ' + String(i).slice(-4).toUpperCase() }; }); return o; },
    async search() { return []; }
  };
  window.MW_STANDALONE = true;
  window.claude = { use: async name => (name === 'db' && window.Peer ? db : name === 'user' ? user : null) };
})();
