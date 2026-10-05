/* Builds dist/MechaWarfare.zip: a small Windows .exe that serves the game locally and opens the browser.
   Run from the repo root:  node desktop/build.js
   Needs network the first time (three.js and PeerJS are fetched). */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const D = __dirname, APP = path.join(D, 'app'), VENDOR = path.join(D, 'vendor'), DIST = path.join(D, 'dist');
const VENDOR_FILES = {
  'three.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  'peerjs.min.js': 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js'
};
const get = url => new Promise((res, rej) => https.get(url, r => {
  if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) return get(r.headers.location).then(res, rej);
  if (r.statusCode !== 200) return rej(new Error(url + ' ' + r.statusCode));
  const out = []; r.on('data', c => out.push(c)); r.on('end', () => res(Buffer.concat(out)));
}).on('error', rej));

(async () => {
  for (const d of [APP, VENDOR, DIST]) fs.mkdirSync(d, { recursive: true });
  for (const [name, url] of Object.entries(VENDOR_FILES)) {
    const f = path.join(VENDOR, name);
    if (!fs.existsSync(f)) { console.log('fetching', url); fs.writeFileSync(f, await get(url)); }
    fs.copyFileSync(f, path.join(APP, name));
  }
  // the page: wrapped in a full document, three.js served locally, the runtime stand-in loaded first
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const three = '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>';
  if (html.indexOf(three) < 0) throw new Error('three.js script tag not found in index.html');
  html = html.replace(three, '<script src="three.min.js"></script>\n<script src="peerjs.min.js"></script>\n<script src="standalone.js"></script>');
  html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n' + html + '\n</body></html>\n';
  fs.writeFileSync(path.join(APP, 'index.html'), html);
  for (const f of ['engine.js', 'render3d.js']) fs.copyFileSync(path.join(ROOT, f), path.join(APP, f));
  fs.copyFileSync(path.join(D, 'standalone.js'), path.join(APP, 'standalone.js'));

  // the launcher: a small C# program compiled with the .NET Framework compiler that ships with Windows,
  // with the game files embedded as resources (about 1 MB, nothing to install)
  const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const exe = path.join(DIST, 'MechaWarfare.exe');
  const res = fs.readdirSync(APP).map(f => '-resource:"' + path.join(APP, f) + '",' + f).join(' ');
  execSync('"' + csc + '" -nologo -target:exe -optimize+ -out:"' + exe + '" ' + res + ' "' + path.join(D, 'launcher', 'MechaWarfare.cs') + '"', { stdio: 'inherit' });

  fs.writeFileSync(path.join(DIST, 'README.txt'), [
    'MECHA WARFARE',
    '',
    'Double-click MechaWarfare.exe. The game opens in your web browser.',
    'Keep the small black window open while you play; close it to quit.',
    '',
    'If Windows shows "Windows protected your PC", click "More info" then "Run anyway".',
    'The program is not code-signed, so Windows does not recognise it yet.',
    '',
    'PLAYING ONLINE',
    '1. Both players run MechaWarfare.exe and pick Online match.',
    '2. One player picks a doctrine and map and presses Host a match.',
    '   A 5-letter code appears under Your matches. Send it to your opponent.',
    '3. The other player types the code under Join with a code and presses Join.',
    'Players connect directly over the internet (via the free PeerJS service).',
    'The host must keep the game open for the match to continue; either player',
    'can close it and resume later from Your matches.',
    '',
    'You can also play against the AI or with two players on one screen.',
    'Saved games are kept in your browser.',
    ''
  ].join('\r\n'));
  const zip = path.join(DIST, 'MechaWarfare.zip');
  if (fs.existsSync(zip)) fs.unlinkSync(zip);
  execSync('powershell -NoProfile -Command "Compress-Archive -Path \'' + exe + '\',\'' + path.join(DIST, 'README.txt') + '\' -DestinationPath \'' + zip + '\'"', { stdio: 'inherit' });
  console.log('built', zip, (fs.statSync(zip).size / 1048576).toFixed(1) + ' MB');
})().catch(e => { console.error(e); process.exit(1); });
