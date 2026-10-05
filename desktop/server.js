/* Mecha Warfare desktop launcher: serves the game on this computer and opens it in the default browser.
   Built into MechaWarfare.exe as a Node single executable; the game files ride along as embedded assets. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
let sea = null;
try { sea = require('node:sea'); } catch (e) { /* plain node */ }

const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/engine.js': ['engine.js', 'text/javascript; charset=utf-8'],
  '/render3d.js': ['render3d.js', 'text/javascript; charset=utf-8'],
  '/three.min.js': ['three.min.js', 'text/javascript; charset=utf-8'],
  '/peerjs.min.js': ['peerjs.min.js', 'text/javascript; charset=utf-8'],
  '/standalone.js': ['standalone.js', 'text/javascript; charset=utf-8']
};
const cache = {};
function asset(name) {
  if (cache[name]) return cache[name];
  const buf = sea && sea.isSea() ? Buffer.from(sea.getAsset(name)) : fs.readFileSync(path.join(__dirname, 'app', name));
  return (cache[name] = buf);
}

const server = http.createServer((req, res) => {
  const f = FILES[(req.url || '/').split('?')[0]];
  if (!f) { res.writeHead(404); res.end('Not found'); return; }
  try {
    res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': 'no-cache' });
    res.end(asset(f[0]));
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});

// a fixed port keeps saved games: the browser stores them per address
const PORTS = [47615, 47616, 47617, 47618, 47619];
function listen(i) {
  if (i >= PORTS.length) { console.log('Could not find a free port. Close other copies of Mecha Warfare and try again.'); setTimeout(() => process.exit(1), 8000); return; }
  server.once('error', () => listen(i + 1));
  server.listen(PORTS[i], '127.0.0.1', () => {
    const url = 'http://127.0.0.1:' + PORTS[i] + '/';
    console.log('');
    console.log('  MECHA WARFARE');
    console.log('  The game is open in your web browser: ' + url);
    console.log('  Keep this window open while you play. Close it to quit.');
    console.log('');
    console.log('  Online: one player hosts a match and shares its 5-letter code;');
    console.log('  the other joins with that code from their own copy of the game.');
    console.log('  The host must keep the game open for the match to continue.');
    if (!process.env.MW_NO_BROWSER) exec(process.platform === 'win32' ? 'start "" "' + url + '"' : (process.platform === 'darwin' ? 'open ' : 'xdg-open ') + url);
  });
}
listen(0);
