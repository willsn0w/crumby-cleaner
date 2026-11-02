'use strict';
/* Crumby — renderer: the floor, the robot, the dock and the control panel. */

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

const PREVIEW = !window.crumby; // opened outside the app (browser preview / tests)

// ---------- geometry ----------
const R = 44;                       // robot radius (px)
const DOCK_W = 112;
const DOCK_K = DOCK_W / 140;        // dock.svg units -> px
const DOCK_H = 190 * DOCK_K;
const SPEED = 175;
const ITEM_BOX_W = 76;

const cv = $('floor');
const ctx = cv.getContext('2d');
let W = innerWidth, H = innerHeight, DPR = window.devicePixelRatio || 1;

function resize() {
  W = innerWidth; H = innerHeight; DPR = window.devicePixelRatio || 1;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  sizeMap();
}

// ---------- sprites ----------
function loadImg(src) { return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }); }
function raster(img, w, h) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * DPR * 1.15); c.height = Math.ceil(h * DPR * 1.15);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}
let robotSprite = null, dockSprite = null;

function genericIcon(kind, size = 48) {
  const c = document.createElement('canvas'); c.width = c.height = size * 2;
  const g = c.getContext('2d'); g.scale(2 * size / 48, 2 * size / 48);
  if (kind === 'folder') {
    g.fillStyle = '#e8a93a'; g.beginPath(); g.roundRect(4, 10, 18, 8, 2); g.fill();
    g.fillStyle = '#f7c64f'; g.beginPath(); g.roundRect(4, 14, 40, 26, 3); g.fill();
    g.fillStyle = '#ffd969'; g.beginPath(); g.roundRect(4, 18, 40, 22, 3); g.fill();
  } else if (kind === 'system') {
    g.fillStyle = '#d6dbe1'; g.beginPath(); g.roundRect(9, 6, 30, 36, 4); g.fill();
    g.strokeStyle = '#8a929b'; g.lineWidth = 2; g.stroke();
    g.strokeStyle = '#8a929b'; g.beginPath(); g.moveTo(16, 14); g.lineTo(32, 14); g.moveTo(16, 22); g.lineTo(32, 22); g.stroke();
  } else {
    g.fillStyle = '#ffffff'; g.strokeStyle = '#b8bcc2'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(10, 4); g.lineTo(30, 4); g.lineTo(39, 13); g.lineTo(39, 44); g.lineTo(10, 44); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#e3e6ea'; g.beginPath(); g.moveTo(30, 4); g.lineTo(30, 13); g.lineTo(39, 13); g.closePath(); g.fill(); g.stroke();
    if (kind === 'image') {
      g.fillStyle = '#7cc4ff'; g.fillRect(14, 20, 21, 16);
      g.fillStyle = '#3f9a52'; g.beginPath(); g.moveTo(14, 36); g.lineTo(22, 26); g.lineTo(28, 32); g.lineTo(31, 29); g.lineTo(35, 36); g.fill();
    } else {
      g.strokeStyle = '#c4c8ce'; g.lineWidth = 1.5;
      for (let y = 18; y <= 36; y += 5) { g.beginPath(); g.moveTo(15, y); g.lineTo(34, y); g.stroke(); }
    }
  }
  return c;
}

function wrapLabel(g, text, maxW, maxLines) {
  const lines = []; let cur = '';
  for (const ch of text) {
    if (g.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; if (lines.length === maxLines) break; }
    else cur += ch;
  }
  if (lines.length < maxLines) lines.push(cur);
  else { let last = lines[maxLines - 1]; while (g.measureText(last + '…').width > maxW && last.length) last = last.slice(0, -1); lines[maxLines - 1] = last + '…'; }
  return lines.filter((l) => l.length);
}

function itemSprite(it, iconImg) {
  const s = it.iconSize; // icon box size in px
  const w = ITEM_BOX_W, h = s + 42;
  const c = document.createElement('canvas'); c.width = Math.ceil(w * DPR); c.height = Math.ceil(h * DPR);
  const g = c.getContext('2d'); g.scale(DPR, DPR);
  const ix = (w - s) / 2, iy = 2;
  g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 4; g.shadowOffsetY = 1;
  if (iconImg) {
    const ar = (iconImg.width || 1) / (iconImg.height || 1);
    let dw = s, dh = s; if (ar > 1) dh = s / ar; else dw = s * ar;
    g.drawImage(iconImg, ix + (s - dw) / 2, iy + (s - dh) / 2, dw, dh);
  }
  g.font = '12px "Segoe UI", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
  const lines = wrapLabel(g, it.name, w - 4, 2);
  g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 3; g.shadowOffsetY = 1;
  g.fillStyle = '#fff';
  lines.forEach((l, i) => g.fillText(l, w / 2, iy + s + 4 + i * 15));
  return { canvas: c, w, h, ax: w / 2, ay: iy + s / 2 }; // anchor = icon center
}

// ---------- state ----------
const S = {
  items: [], total: 0, totalBytes: 0, binCap: 0.72,
  robot: { x: 0, y: 0, a: -Math.PI / 2, moving: false, brush: 0, kx: 0, ky: 0, wob: 0 },
  dock: { x: 0, y: 0 },
  state: 'boot', stateT: 0, homeReason: null,
  mapped: false, beamA: 0, beamStart: 0, beamSwept: 0,
  battery: 100, binLoad: 0, collected: 0, bytes: 0, elapsed: 0, running: false,
  paused: false, muted: false, stopped: false,
  target: null, strain: null, flash: null,
  trail: [], drag: null, time: 0,
};

const dockedPos = () => ({ x: S.dock.x + DOCK_W / 2, y: S.dock.y + 55 * DOCK_K });
const approachPos = () => ({ x: S.dock.x + DOCK_W / 2, y: S.dock.y - R * 0.95 });
const binPct = () => clamp(S.binLoad / S.binCap * 100, 0, 100);

function setState(s) { S.state = s; S.stateT = 0; }
function goHome(reason) { S.homeReason = reason; S.target = null; setState('home'); }

// ---------- sound ----------
const Snd = (() => {
  let ac = null, master, motorGain, motorBP, hum, noise;
  function init() {
    if (ac) return;
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    master = ac.createGain(); master.gain.value = S.muted ? 0 : 0.55; master.connect(ac.destination);
    noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const n = ac.createBufferSource(); n.buffer = noise; n.loop = true;
    motorBP = ac.createBiquadFilter(); motorBP.type = 'bandpass'; motorBP.frequency.value = 520; motorBP.Q.value = 0.9;
    motorGain = ac.createGain(); motorGain.gain.value = 0;
    n.connect(motorBP).connect(motorGain).connect(master); n.start();
    hum = ac.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 92;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240;
    const hg = ac.createGain(); hg.gain.value = 0.35;
    hum.connect(lp).connect(hg).connect(motorGain); hum.start();
  }
  function motor(level, strain, near = 0) {
    if (!ac) return;
    const t = ac.currentTime;
    // the vacuum roars louder and higher when icons are right under/next to it
    motorGain.gain.setTargetAtTime(level * (0.07 + near * 0.11), t, 0.06);
    motorBP.frequency.setTargetAtTime(520 + strain * 650 + near * 1400, t, 0.08);
    hum.frequency.setTargetAtTime(92 + strain * 38 + near * 30, t, 0.1);
  }
  function burst(dur, f0, f1, vol, type = 'bandpass') {
    if (!ac) return;
    const t = ac.currentTime;
    const s = ac.createBufferSource(); s.buffer = noise;
    const f = ac.createBiquadFilter(); f.type = type; f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.03, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  function tone(freq, at, dur, vol, type = 'sine') {
    if (!ac) return;
    const t = ac.currentTime + at;
    const o = ac.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  // lidar scan: sweeping sci-fi whirr that follows the beam, plus a sonar shimmer
  let scanN = null;
  function scanStart() {
    if (!ac || scanN) return;
    const t = ac.currentTime;
    const out = ac.createGain(); out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(0.11, t + 0.3);
    out.connect(master);
    const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = 640;
    const lfo = ac.createOscillator(); lfo.frequency.value = 2.7 / TAU; // one wobble per beam turn
    const lfoG = ac.createGain(); lfoG.gain.value = 260; lfo.connect(lfoG).connect(o.frequency);
    const trem = ac.createOscillator(); trem.frequency.value = 18;
    const tremG = ac.createGain(); tremG.gain.value = 0.35;
    const amp = ac.createGain(); amp.gain.value = 0.55; trem.connect(tremG).connect(amp.gain);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 2;
    o.connect(amp).connect(bp).connect(out);
    const n = ac.createBufferSource(); n.buffer = noise; n.loop = true;
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5200;
    const ng = ac.createGain(); ng.gain.value = 0.18; n.connect(hp).connect(ng).connect(out);
    [o, lfo, trem, n].forEach((x) => x.start(t));
    scanN = { out, srcs: [o, lfo, trem, n] };
  }
  function scanStop() {
    if (!scanN) return;
    const t = ac.currentTime, s = scanN; scanN = null;
    s.out.gain.setTargetAtTime(0.0001, t, 0.12);
    s.srcs.forEach((x) => x.stop(t + 0.6));
  }
  let lastPing = 0;
  function ping() {
    if (!ac || ac.currentTime - lastPing < 0.05) return;
    lastPing = ac.currentTime;
    tone(1760 + Math.random() * 600, 0, 0.12, 0.05);
  }
  // strong suction: a hiss that rises in pitch, a low "slurp" and a pop at the end
  function suck(big) {
    if (!ac) return;
    const d = big ? 1.9 : 0.42;
    burst(d, big ? 350 : 700, big ? 5000 : 6000, big ? 0.42 : 0.38, 'bandpass');
    burst(d * 0.8, 200, 900, big ? 0.3 : 0.22, 'lowpass');
    const t = ac.currentTime;
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(big ? 120 : 220, t); o.frequency.exponentialRampToValueAtTime(big ? 700 : 1100, t + d);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(master); o.start(t); o.stop(t + d + 0.05);
    tone(big ? 520 : 780, d * 0.95, 0.06, 0.18, 'square');
  }

  return {
    init, motor, scanStart, scanStop, ping,
    pop: suck,
    chirp: (up = true) => { const a = up ? [988, 1319] : [1319, 988]; tone(a[0], 0, 0.09, 0.12); tone(a[1], 0.1, 0.12, 0.12); },
    done: () => { tone(988, 0, 0.1, 0.12); tone(1175, 0.11, 0.1, 0.12); tone(1568, 0.22, 0.2, 0.12); },
    whoosh: () => burst(2.6, 250, 1800, 0.22, 'lowpass'),
    thud: () => { tone(110, 0, 0.18, 0.35, 'sine'); burst(0.08, 400, 200, 0.12); },
    mute: (m) => { if (master) master.gain.setTargetAtTime(m ? 0 : 0.55, ac.currentTime, 0.05); },
  };
})();

// ---------- setup ----------
function mockItems() {
  // preview data: a messy desktop with 42 things
  const names = ['notes copy 2.txt', 'Screenshot 2026-10-19 at 14.07.08.png', 'invoice-sample.pdf', 'budget-snacks.xlsx', 'New Folder', 'q3-slides-actually-final.pptx',
    'wallpaper-idea.png', 'demo-for-nobody.mp4', 'logo-new-NEW.png', 'final-final-v2.pdf', 'voice-memo-idea.m4a', 'old-site.zip', 'IMG_2042.png', 'desktop-cleaning',
    'untitled folder', 'backup.zip', 'todo.txt', 'resume (3).docx', 'Screenshot 2026-10-21.png', 'cat.gif', 'stuff', 'video-export.mov', 'readme.md', 'tax-2025.pdf',
    'design-v7.fig', 'Untitled.txt', 'photo.jpg', 'archive', 'meeting-notes.txt', 'Recording 01.mp4', 'icons', 'export (1).csv', 'draft.docx', 'IMG_1999.jpg',
    'temp', 'presentation.key', 'node-installer.msi', 'hello.py', 'Screenshot (88).png', 'random.json', 'mockup.png', 'Recycle Bin'];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return names.map((name, i) => {
    const kind = name === 'Recycle Bin' ? 'system' : /\.(png|jpg|gif)$/.test(name) ? 'image' : /\./.test(name) ? 'file' : 'folder';
    const cluster = i < 26;
    const x = cluster ? W * 0.32 + rnd() * W * 0.3 : (i % 2 ? W - 60 - rnd() * 40 : 50 + rnd() * W * 0.18);
    const y = cluster ? H * 0.2 + rnd() * H * 0.38 : 60 + rnd() * (H - 200);
    const big = /mp4|mov|zip|msi/.test(name);
    return { name, x, y, iconSize: 48, kind, icon: null, size: Math.round((big ? 600e6 + rnd() * 2.4e9 : rnd() * 9e7)) };
  });
}

async function setup() {
  if (PREVIEW) document.body.classList.add('preview');
  resize();
  const data = PREVIEW ? { items: mockItems() } : await window.crumby.init();

  const [rImg, dImg] = await Promise.all([loadImg('assets/robot.svg'), loadImg('assets/dock.svg')]);
  robotSprite = raster(rImg, R * 2, R * 2);
  dockSprite = raster(dImg, DOCK_W, DOCK_H);

  S.dock.x = Math.round(W * 0.82 - DOCK_W / 2);
  S.dock.y = Math.round(H - DOCK_H - 4);
  const dp = dockedPos(); S.robot.x = dp.x; S.robot.y = dp.y;

  const raw = data.items || [];
  S.totalBytes = raw.reduce((a, b) => a + (b.size || 0), 0);
  const sizes = raw.map((r) => r.size || 0).sort((a, b) => b - a);
  const bigCut = Math.max(150e6, sizes[Math.floor(sizes.length * 0.12)] || Infinity);
  const N = raw.length;
  S.binCap = N >= 6 ? 0.72 : 1.01;

  for (const r of raw) {
    const icon = r.icon ? await loadImg(r.icon) : null;
    const it = {
      name: r.name, kind: r.kind, size: r.size || 0, iconSize: r.iconSize || 48,
      x: clamp(r.x, 20, W - 20), y: clamp(r.y, 20, H - 40), vx: 0, vy: 0,
      st: 'floor', revealed: false, glow: 0, t: 0, dur: 0, rot: 0, sx: 0, sy: 0,
      rv: 0, rest: 0, warp: 0, warpA: 0, tumbled: false, thrown: false, phase: Math.random() * TAU,
      spin: (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.7),
      big: (r.size || 0) >= bigCut,
      load: 0.5 / Math.max(1, N) + 0.5 * (S.totalBytes > 0 ? (r.size || 0) / S.totalBytes : 1 / Math.max(1, N)),
    };
    it.sprite = itemSprite(it, icon || genericIcon(it.kind, it.iconSize));
    S.items.push(it);
  }
  S.total = S.items.length;
  $('countOf').textContent = `of ${S.total} items`;

  bindUI();
  if (!PREVIEW) window.crumby.ready();
  last = performance.now();
  requestAnimationFrame(frame);
}

// ---------- simulation ----------
function driveTo(tx, ty, dt, speed = SPEED, arrive = 5) {
  const r = S.robot;
  const dx = tx - r.x, dy = ty - r.y, d = Math.hypot(dx, dy);
  if (d < arrive) { r.moving = false; return true; }
  const want = Math.atan2(dy, dx), da = angDiff(want, r.a);
  const turn = 4.4 * dt;
  r.a += clamp(da, -turn, turn);
  r.moving = true;
  if (Math.abs(da) < 0.7) {
    const v = speed * Math.min(1, d / 70 + 0.3) * (1 - Math.abs(da) / 1.0);
    const step = Math.min(d, v * dt);
    r.x += Math.cos(r.a) * step; r.y += Math.sin(r.a) * step;
  }
  return false;
}
function turnTo(a, dt) {
  const r = S.robot, da = angDiff(a, r.a);
  r.a += clamp(da, -3.6 * dt, 3.6 * dt); r.moving = true;
  return Math.abs(da) < 0.02;
}

function floorItems() { return S.items.filter((i) => i.st === 'floor'); }

function pickTarget() {
  const r = S.robot; let best = null, bc = Infinity;
  for (const it of S.items) {
    if (it.st !== 'floor' || !it.revealed) continue;
    const d = Math.hypot(it.x - r.x, it.y - r.y);
    const c = d + 55 * Math.abs(angDiff(Math.atan2(it.y - r.y, it.x - r.x), r.a));
    if (c < bc) { bc = c; best = it; }
  }
  return best;
}

function startSuck(it) {
  it.st = 'suck'; it.t = 0; it.sx = it.x; it.sy = it.y;
  it.dur = it.big ? 2.2 : 0.42;
  if (it.big) S.strain = it;
  Snd.pop(it.big);
}

function finishSuck(it) {
  it.st = 'gone';
  S.collected++; S.bytes += it.size; S.binLoad += it.load;
  if (S.strain === it) S.strain = null;
  if (S.target === it) S.target = null;
}

function revealSweep(prevSwept) {
  const r = S.robot;
  for (const it of S.items) {
    if (it.revealed) continue;
    let a = (Math.atan2(it.y - r.y, it.x - r.x) - S.beamStart) % TAU; if (a < 0) a += TAU;
    if (a <= S.beamSwept || S.beamSwept >= TAU) { it.revealed = true; it.glow = 1; Snd.ping(); }
  }
}

function update(dt) {
  S.time += dt;
  const r = S.robot;
  r.moving = false;
  S.stateT += dt;
  if (S.flash && S.time > S.flash.until) S.flash = null;

  // kick from a thrown icon
  if (Math.abs(r.kx) + Math.abs(r.ky) > 1) {
    r.x += r.kx * dt; r.y += r.ky * dt;
    const k = Math.exp(-5 * dt); r.kx *= k; r.ky *= k;
  } else { r.kx = r.ky = 0; }
  r.wob *= Math.exp(-4 * dt);

  switch (S.state) {
    case 'boot':
      if (S.stateT > 1.1) { Snd.init(); Snd.chirp(true); S.running = true; setState('undock'); }
      break;
    case 'undock': {
      const ap = approachPos();
      r.moving = true;
      if (driveTo(ap.x, ap.y, dt, 70)) {
        if (!S.mapped) { S.beamStart = -Math.PI / 2; S.beamA = S.beamStart; S.beamSwept = 0; setState('mapping'); }
        else setState('cleaning');
      }
      break;
    }
    case 'mapping': {
      const w = 2.7;
      S.beamA += w * dt; S.beamSwept += w * dt;
      revealSweep();
      if (S.beamSwept >= TAU * 2) { S.mapped = true; S.items.forEach((i) => (i.revealed = true)); setState('cleaning'); }
      break;
    }
    case 'cleaning': {
      if (S.strain) { // halt and strain on a big file
        r.moving = false;
        break;
      }
      if (!S.target || S.target.st !== 'floor') S.target = pickTarget();
      if (!S.target) {
        if (!S.items.some((i) => i.st === 'floor' || i.st === 'suck' || i.st === 'held')) goHome('done');
        break;
      }
      driveTo(S.target.x, S.target.y, dt, SPEED, 2);
      break;
    }
    case 'home': {
      if (S.strain) break;
      const ap = approachPos();
      if (driveTo(ap.x, ap.y, dt, SPEED, 4)) setState('align');
      break;
    }
    case 'align':
      if (turnTo(-Math.PI / 2, dt)) setState('reverse');
      break;
    case 'reverse': {
      const dp = dockedPos();
      r.moving = true;
      r.x = lerp(r.x, dp.x, Math.min(1, dt * 6));
      r.y = Math.min(dp.y, r.y + 52 * dt);
      if (r.y >= dp.y - 0.5) { r.y = dp.y; r.x = dp.x; Snd.chirp(false); setState(S.binLoad > 0.001 ? 'emptying' : 'docked'); if (S.state === 'emptying') Snd.whoosh(); }
      break;
    }
    case 'emptying': {
      const dur = 3.0;
      S.binLoad = Math.max(0, S.binLoad - (S.binCap * dt) / (dur * 0.85));
      if (S.stateT >= dur) { S.binLoad = 0; setState('docked'); }
      break;
    }
    case 'docked': {
      const left = floorItems().length;
      if (S.homeReason === 'done' || S.homeReason === 'stop' || left === 0) {
        setState(S.homeReason === 'stop' ? 'stopped' : 'done');
        S.running = false; if (S.state === 'done') Snd.done();
      } else if (S.battery < 40) setState('charging');
      else { Snd.chirp(true); setState('undock'); }
      break;
    }
    case 'charging':
      if (S.battery >= 90) { Snd.chirp(true); setState('undock'); }
      break;
    case 'halted': // Stop pressed: robot sits still until Resume
      r.moving = false;
      break;
    case 'lifted': case 'done': case 'stopped':
      break;
  }
  if (S.state === 'mapping') Snd.scanStart(); else Snd.scanStop();

  // battery
  const atDock = ['boot', 'emptying', 'docked', 'charging', 'done', 'stopped'].includes(S.state);
  if (atDock) S.battery = Math.min(100, S.battery + 3.2 * dt);
  else if (S.state !== 'lifted' && S.state !== 'halted') S.battery = Math.max(1, S.battery - (S.strain ? 0.45 : 0.16) * dt);
  if (S.state === 'cleaning' && S.battery < 15) goHome('battery');

  // items: gravity well around the robot, thrown physics, suction, reveal glow
  const suctionOn = ['cleaning', 'home', 'undock'].includes(S.state);
  const G = R * 3.4; // reach of the vacuum's pull
  S.near = 0;
  for (const it of S.items) {
    if (it.glow > 0) it.glow = Math.max(0, it.glow - dt * 0.9);
    if (it.st === 'floor') {
      const dx = r.x - it.x, dy = r.y - it.y, d = Math.max(1, Math.hypot(dx, dy));
      if (suctionOn && it.revealed && d < G) {
        const f = 1 - d / G; // 0 at the edge, 1 under the robot
        S.near = Math.max(S.near, f);
        // bend toward the robot
        it.warp = Math.max(it.warp, f);
        it.warpA = Math.atan2(dy, dx);
        // gravity: drift in, with a swirl around the robot
        const a = f * f * 340;
        it.vx += ((dx / d) * a + (-dy / d) * a * 0.55 * it.spin) * dt;
        it.vy += ((dy / d) * a + (dx / d) * a * 0.55 * it.spin) * dt;
        // torque: twist, and sometimes flip upside down and stay that way
        it.rv += it.spin * f * f * 14 * dt;
        if (!it.tumbled && f > 0.42 && Math.random() < dt * 1.6) {
          it.tumbled = true;
          it.rest = Math.random() < 0.45 ? Math.PI : it.spin * (0.25 + Math.random() * 0.6);
          it.rv += it.spin * 9;
        }
      }
      it.warp = Math.max(0, it.warp - dt * 1.8);
      // rotation spring toward its resting angle
      it.rv += angDiff(it.rest, it.rot) * 9 * dt;
      it.rv *= Math.exp(-3.2 * dt);
      it.rot += it.rv * dt;

      if (it.vx || it.vy) {
        it.x += it.vx * dt; it.y += it.vy * dt;
        const k = Math.exp(-2.6 * dt); it.vx *= k; it.vy *= k;
        if (it.x < 24 || it.x > W - 24) { it.vx *= -0.6; it.x = clamp(it.x, 24, W - 24); }
        if (it.y < 24 || it.y > H - 40) { it.vy *= -0.6; it.y = clamp(it.y, 24, H - 40); }
        const sp = Math.hypot(it.vx, it.vy);
        if (sp < 6) { it.vx = it.vy = 0; it.thrown = false; }
        if (it.thrown && sp > 180 && d < R + 18 && S.state !== 'lifted') { // hit the robot!
          r.kx = it.vx * 0.35; r.ky = it.vy * 0.35; r.wob = 1;
          S.flash = { text: 'Ouch.', until: S.time + 1.2 };
          Snd.thud(); it.vx = it.vy = 0; it.thrown = false; it.revealed = true; startSuck(it);
        }
      }
      if (it.st === 'floor' && suctionOn && it.revealed && !S.strain) {
        const d2 = Math.hypot(it.x - r.x, it.y - r.y);
        if (d2 < R * 0.85) startSuck(it);
      }
    } else if (it.st === 'suck') {
      it.t += dt / it.dur;
      if (it.t >= 1) finishSuck(it);
    }
  }

  // bin full?
  if (S.state === 'cleaning' && binPct() >= 100 && !S.strain) goHome('bin');

  // trail
  if (S.running && S.state !== 'lifted') {
    const lp = S.trail[S.trail.length - 1];
    if (!lp || Math.hypot(lp.x - r.x, lp.y - r.y) > 7) { S.trail.push({ x: r.x, y: r.y }); if (S.trail.length > 6000) S.trail.shift(); }
  }
  r.x = clamp(r.x, R, W - R); r.y = clamp(r.y, R, H - R);

  if (S.running && !['done', 'stopped', 'halted'].includes(S.state)) S.elapsed += dt;
  r.brush += dt * (r.moving || S.state === 'mapping' || S.strain ? 16 : 0);

  const motorLevel = S.state === 'lifted' ? 0.35 : (S.strain ? 1.2 : (r.moving ? 1 : (S.state === 'mapping' ? 0.45 : 0)));
  Snd.motor(motorLevel, S.strain ? 1 : 0, suctionOn ? S.near : 0);
}

// ---------- drawing ----------
function drawDock() {
  const d = S.dock;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 6;
  ctx.drawImage(dockSprite, d.x, d.y, DOCK_W, DOCK_H);
  ctx.restore();
  // bin window: lights up blue while self-emptying
  const wx = d.x + 27 * DOCK_K, wy = d.y + 126 * DOCK_K, ww = 86 * DOCK_K, wh = 40 * DOCK_K;
  if (S.state === 'emptying') {
    const p = S.stateT;
    ctx.save();
    ctx.beginPath(); ctx.roundRect(wx + 1, wy + 1, ww - 2, wh - 2, 6 * DOCK_K); ctx.clip();
    ctx.fillStyle = 'rgba(120,200,255,0.92)'; ctx.fillRect(wx, wy, ww, wh);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 6; i++) { // swirling debris
      const a = p * 9 + i * 1.05, rx = wx + ww / 2 + Math.cos(a) * ww * 0.32, ry = wy + wh / 2 + Math.sin(a * 1.3) * wh * 0.28;
      ctx.beginPath(); ctx.arc(rx, ry, 1.6, 0, TAU); ctx.fill();
    }
    const bw = 22 * DOCK_K, bh = 32 * DOCK_K * (0.75 + 0.25 * Math.min(1, p / 2.5));
    ctx.fillStyle = '#e9edf2'; ctx.beginPath(); ctx.roundRect(wx + ww / 2 - bw / 2, wy + wh / 2 - bh / 2, bw, bh, 4); ctx.fill();
    ctx.restore();
  }
  // charging contacts glow when charging
  if (['charging', 'docked', 'emptying', 'done', 'stopped', 'boot'].includes(S.state) && S.battery < 100) {
    ctx.save(); ctx.globalAlpha = 0.5 + 0.5 * Math.sin(S.time * 4);
    ctx.fillStyle = '#ffd34d'; ctx.shadowColor = '#ffcc33'; ctx.shadowBlur = 8;
    ctx.fillRect(d.x + 36 * DOCK_K, d.y + 94 * DOCK_K, 20 * DOCK_K, 6 * DOCK_K);
    ctx.fillRect(d.x + 84 * DOCK_K, d.y + 94 * DOCK_K, 20 * DOCK_K, 6 * DOCK_K);
    ctx.restore();
  }
}

function drawItem(it) {
  const sp = it.sprite;
  let x = it.x, y = it.y, rot = it.rot || 0, sc = 1, alpha = 1;
  if (it.st === 'suck') {
    const r = S.robot;
    let t = it.t;
    if (it.big) { // resist, then give in
      const resist = Math.min(1, t / 0.6);
      const jig = Math.sin(S.time * 55) * 3 * (1 - t);
      x = it.sx + jig; y = it.sy + Math.cos(S.time * 47) * 2 * (1 - t);
      rot = (it.rot || 0) + Math.sin(S.time * 30) * 0.12 * resist;
      if (t > 0.6) { const k = (t - 0.6) / 0.4; const e = k * k; x = lerp(x, r.x, e); y = lerp(y, r.y, e); rot += k * 6; sc = 1 - 0.92 * e; alpha = 1 - e * 0.8; }
      else sc = 1 - 0.08 * Math.sin(S.time * 20) * resist;
    } else {
      const e = t * t;
      x = lerp(it.sx, r.x, e); y = lerp(it.sy, r.y, e); rot = (it.rot || 0) + t * 5.5 * (it.spin > 0 ? 1 : -1); sc = 1 - 0.9 * e; alpha = 1 - e * 0.7;
    }
  }
  ctx.save();
  ctx.translate(x, y);
  const wv = it.st === 'suck' ? Math.max(it.warp, 0.6 * (1 - it.t)) : it.warp;
  if (wv > 0.01) { // stretch toward the robot, squash sideways, shear and quiver
    const q = 1 + 0.07 * Math.sin(S.time * 34 + it.phase);
    ctx.rotate(it.warpA);
    ctx.scale((1 + 0.55 * wv) * q, 1 - 0.35 * wv);
    ctx.transform(1, 0, 0.5 * wv * Math.sign(it.spin), 1, 0, 0);
    ctx.rotate(-it.warpA);
  }
  ctx.rotate(rot); ctx.scale(sc, sc);
  ctx.globalAlpha = alpha;
  if (it.st === 'held') { ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 10; ctx.scale(1.06, 1.06); }
  if (it.glow > 0) {
    ctx.save(); ctx.globalAlpha = it.glow * 0.55; ctx.fillStyle = 'rgba(80,230,255,0.35)';
    ctx.shadowColor = '#3fe0ff'; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.roundRect(-it.iconSize / 2 - 4, -it.iconSize / 2 - 4, it.iconSize + 8, it.iconSize + 8, 8); ctx.fill(); ctx.restore();
  }
  ctx.drawImage(sp.canvas, -sp.ax, -sp.ay, sp.w, sp.h);
  ctx.restore();
}

function drawBeam() {
  const r = S.robot, L = Math.hypot(W, H);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const slices = 22, wedge = 0.7;
  for (let i = 0; i < slices; i++) {
    const a0 = S.beamA - (i + 1) * wedge / slices, a1 = S.beamA - i * wedge / slices;
    ctx.fillStyle = `rgba(60,210,255,${0.3 * (1 - i / slices) ** 1.4})`;
    ctx.beginPath(); ctx.moveTo(r.x, r.y);
    ctx.lineTo(r.x + Math.cos(a0) * L, r.y + Math.sin(a0) * L);
    ctx.lineTo(r.x + Math.cos(a1) * L, r.y + Math.sin(a1) * L);
    ctx.closePath(); ctx.fill();
  }
  const ex = r.x + Math.cos(S.beamA) * L, ey = r.y + Math.sin(S.beamA) * L;
  ctx.strokeStyle = 'rgba(60,220,255,0.35)'; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.strokeStyle = 'rgba(200,250,255,0.95)'; ctx.lineWidth = 2; ctx.shadowColor = '#3fe0ff'; ctx.shadowBlur = 14;
  ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.restore();
}

function drawRobot() {
  const r = S.robot;
  const lifted = S.state === 'lifted';
  let x = r.x, y = r.y, a = r.a + Math.PI / 2;
  if (S.strain) { x += Math.sin(S.time * 63) * 1.6; y += Math.cos(S.time * 71) * 1.2; a += Math.sin(S.time * 40) * 0.035; }
  if (r.wob > 0.01) a += Math.sin(S.time * 30) * 0.25 * r.wob;
  const sc = lifted ? 1.08 : 1;

  ctx.save();
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = lifted ? 30 : 12; ctx.shadowOffsetY = lifted ? 22 : 5;
  ctx.beginPath(); ctx.arc(x, y, R * sc * 0.96, 0, TAU); ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(x, y); ctx.rotate(a); ctx.scale(sc, sc);
  // side brushes (peek out at the front corners)
  const spinning = r.moving || S.state === 'mapping' || S.strain || lifted;
  if (spinning || S.state === 'cleaning') {
    ctx.strokeStyle = 'rgba(30,30,32,0.85)'; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      const bx = side * R * 0.66, by = -R * 0.6;
      for (let k = 0; k < 3; k++) {
        const ang = side * r.brush + k * TAU / 3;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(ang) * R * 0.48, by + Math.sin(ang) * R * 0.48); ctx.stroke();
      }
    }
  }
  ctx.drawImage(robotSprite, -R, -R, R * 2, R * 2);
  // lidar spin highlight while mapping
  if (S.state === 'mapping') {
    ctx.fillStyle = 'rgba(90,230,255,0.9)'; ctx.shadowColor = '#3fe0ff'; ctx.shadowBlur = 8;
    const la = S.beamA - a;
    ctx.beginPath(); ctx.arc(Math.cos(la) * R * 0.2, R * 0.16 + Math.sin(la) * R * 0.2, 2, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  drawDock();
  for (const it of S.items) if (it.st === 'floor') drawItem(it);
  if (S.state === 'mapping') drawBeam();
  for (const it of S.items) if (it.st === 'suck') drawItem(it);
  drawRobot();
  for (const it of S.items) if (it.st === 'held') drawItem(it);
  drawMap();
}

// ---------- minimap ----------
const mc = $('map'), mx = mc.getContext('2d');
let MW = 250, MH = 140;
function sizeMap() {
  MW = mc.clientWidth || 252; MH = Math.round(MW * (H / W));
  mc.style.height = MH + 'px';
  mc.width = Math.round(MW * DPR); mc.height = Math.round(MH * DPR);
}
const DOT = { folder: '#5aa8ff', image: '#a98bff', file: '#f2a33a', system: '#9aa0a6' };
function drawMap() {
  const k = MW / W;
  mx.setTransform(DPR, 0, 0, DPR, 0, 0);
  mx.clearRect(0, 0, MW, MH);
  // trail: thick swath + thin line
  if (S.trail.length > 1) {
    mx.lineJoin = mx.lineCap = 'round';
    mx.beginPath(); S.trail.forEach((p, i) => (i ? mx.lineTo(p.x * k, p.y * k) : mx.moveTo(p.x * k, p.y * k)));
    mx.lineTo(S.robot.x * k, S.robot.y * k);
    mx.strokeStyle = 'rgba(70,150,165,0.32)'; mx.lineWidth = Math.max(5, R * 1.6 * k); mx.stroke();
    mx.strokeStyle = 'rgba(85,215,235,0.9)'; mx.lineWidth = 1.1; mx.stroke();
  }
  // dock
  const dp = dockedPos();
  mx.fillStyle = '#c7c7cc'; mx.beginPath(); mx.roundRect(dp.x * k - 6, (S.dock.y + DOCK_H) * k - 8, 12, 7, 2); mx.fill();
  // items
  for (const it of S.items) {
    if (!it.revealed || it.st === 'gone') continue;
    mx.fillStyle = DOT[it.kind] || DOT.file;
    mx.beginPath(); mx.arc(it.x * k, it.y * k, 1.8, 0, TAU); mx.fill();
  }
  // robot
  const r = S.robot, rr = Math.max(6, R * k * 1.4);
  mx.fillStyle = '#fff'; mx.beginPath(); mx.arc(r.x * k, r.y * k, rr, 0, TAU); mx.fill();
  mx.strokeStyle = '#1c1c1e'; mx.lineWidth = 1.6; mx.beginPath();
  mx.moveTo(r.x * k, r.y * k); mx.lineTo(r.x * k + Math.cos(r.a) * rr * 0.85, r.y * k + Math.sin(r.a) * rr * 0.85); mx.stroke();
}

// ---------- panel ----------
function fmtBytes(b) {
  if (b < 1) return 'Zero KB';
  if (b < 1e6) return Math.max(1, Math.round(b / 1e3)) + ' KB';
  if (b < 1e9) return (b / 1e6).toFixed(1) + ' MB';
  return (b / 1e9).toFixed(2) + ' GB';
}
function fmtTime(s) { s = Math.floor(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function statusText() {
  if (S.paused) return 'Paused';
  if (S.flash) return S.flash.text;
  switch (S.state) {
    case 'boot': return 'Waking up';
    case 'undock': return S.mapped ? 'Leaving the dock' : 'Waking up';
    case 'mapping': return 'Mapping your desktop';
    case 'cleaning': return S.strain ? 'Big file. Straining…' : 'Cleaning';
    case 'home':
      if (S.strain) return 'Big file. Straining…';
      return S.homeReason === 'bin' ? 'Bin full. Heading home' : S.homeReason === 'battery' ? 'Low battery. Heading home' : 'Heading home';
    case 'align': case 'reverse': return 'Reversing onto the dock';
    case 'emptying': return 'Self-emptying';
    case 'docked': case 'charging': return 'Charging';
    case 'lifted': return 'Hey! Put me down';
    case 'done': return 'All clean';
    case 'stopped': case 'halted': return 'Stopped';
  }
  return '';
}
let uiT = 0;
function updatePanel(dt) {
  uiT += dt; if (uiT < 0.08) return; uiT = 0;
  $('status').textContent = statusText();
  $('maplabel').classList.toggle('on', S.state === 'mapping');
  const b = Math.round(S.battery), bin = Math.round(binPct());
  $('batt').textContent = b + '%'; $('battFill').style.width = b + '%';
  $('bin').textContent = bin + '%'; $('binFill').style.width = bin + '%';
  $('binFill').className = 'fill ' + (bin >= 90 ? 'orange' : 'blue');
  $('count').textContent = S.collected;
  $('size').textContent = fmtBytes(S.bytes);
  $('time').textContent = fmtTime(S.elapsed);
  const halted = S.state === 'halted';
  $('stop').disabled = ['done', 'boot'].includes(S.state);
  $('stopIcon').innerHTML = halted ? '&#9654;' : '&#10005;';
  $('stopText').textContent = halted ? 'Resume' : 'Stop';
  $('stop').classList.toggle('resume', halted);
  $('pause').disabled = ['done', 'halted'].includes(S.state);
}

// ---------- input ----------
function hitItem(x, y) {
  for (let i = S.items.length - 1; i >= 0; i--) {
    const it = S.items[i];
    if (it.st !== 'floor') continue;
    if (Math.abs(x - it.x) < ITEM_BOX_W / 2 - 4 && y > it.y - it.iconSize / 2 - 4 && y < it.y + it.iconSize / 2 + 34) return it;
  }
  return null;
}
function quit() { if (PREVIEW) location.reload(); else window.crumby.quit(); }

function bindUI() {
  addEventListener('resize', resize);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') quit(); });
  $('close').addEventListener('click', quit);
  $('sound').addEventListener('click', () => {
    S.muted = !S.muted; Snd.init(); Snd.mute(S.muted);
    $('waves').style.display = S.muted ? 'none' : ''; $('mute').style.display = S.muted ? '' : 'none';
  });
  $('pause').addEventListener('click', () => {
    S.paused = !S.paused; Snd.init();
    $('pauseText').textContent = S.paused ? 'Resume' : 'Pause';
    $('pauseIcon').innerHTML = S.paused ? '&#9654;' : '&#10074;&#10074;';
    if (S.paused) { Snd.motor(0, 0); Snd.scanStop(); }
  });
  $('stop').addEventListener('click', () => {
    Snd.init();
    if (S.state === 'halted') { // Resume: pick up where it left off
      setState(S.resumeState || 'cleaning'); S.resumeState = null; S.running = true;
      Snd.chirp(true);
    } else if (!['done', 'boot'].includes(S.state)) { // Stop: halt right where it is
      S.paused = false; $('pauseText').textContent = 'Pause'; $('pauseIcon').innerHTML = '&#10074;&#10074;';
      S.resumeState = S.state === 'lifted' ? 'cleaning' : S.state;
      if (['align', 'reverse'].includes(S.resumeState)) S.resumeState = 'home';
      S.target = null; setState('halted');
      Snd.chirp(false);
    }
  });

  // drag the panel by its title bar
  const panel = $('panel'); let pd = null;
  $('drag').addEventListener('pointerdown', (e) => { if (e.target.id === 'close') return; pd = { dx: e.clientX - panel.offsetLeft, dy: e.clientY - panel.offsetTop }; e.target.setPointerCapture(e.pointerId); });
  $('drag').addEventListener('pointermove', (e) => { if (!pd) return; panel.style.left = clamp(e.clientX - pd.dx, 0, W - panel.offsetWidth) + 'px'; panel.style.top = clamp(e.clientY - pd.dy, 0, H - 40) + 'px'; panel.style.bottom = 'auto'; });
  $('drag').addEventListener('pointerup', () => (pd = null));

  // robot & icons on the floor
  cv.addEventListener('pointerdown', (e) => {
    Snd.init();
    const x = e.clientX, y = e.clientY, r = S.robot;
    if (Math.hypot(x - r.x, y - r.y) < R) {
      S.drag = { kind: 'robot', dx: x - r.x, dy: y - r.y, prev: S.state };
      if (S.strain) { S.strain.st = 'floor'; S.strain.x = S.strain.sx; S.strain.y = S.strain.sy; S.strain = null; }
      setState('lifted'); S.target = null;
    } else {
      const it = hitItem(x, y);
      if (it) { it.st = 'held'; it.revealed = true; S.drag = { kind: 'item', it, dx: x - it.x, dy: y - it.y, hist: [{ x, y, t: performance.now() }] }; if (S.target === it) S.target = null; }
    }
    if (S.drag) cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    const x = e.clientX, y = e.clientY, d = S.drag;
    if (!d) {
      const over = Math.hypot(x - S.robot.x, y - S.robot.y) < R || hitItem(x, y);
      cv.style.cursor = over ? 'grab' : 'default';
      return;
    }
    cv.style.cursor = 'grabbing';
    if (d.kind === 'robot') { S.robot.x = x - d.dx; S.robot.y = y - d.dy; }
    else { d.it.x = x - d.dx; d.it.y = y - d.dy; d.hist.push({ x, y, t: performance.now() }); if (d.hist.length > 8) d.hist.shift(); }
  });
  const release = () => {
    const d = S.drag; if (!d) return; S.drag = null; cv.style.cursor = 'default';
    if (d.kind === 'robot') {
      Snd.thud();
      const left = S.items.some((i) => i.st === 'floor' || i.st === 'held');
      if (d.prev === 'halted') setState('halted');
      else if (S.homeReason === 'stop' || ['done', 'stopped'].includes(d.prev)) goHome(S.homeReason === 'stop' || d.prev === 'stopped' ? 'stop' : 'done');
      else if (!S.mapped) { S.beamStart = S.robot.a; S.beamA = S.beamStart; S.beamSwept = 0; S.items.forEach((i) => (i.revealed = false)); S.running = true; setState('mapping'); }
      else if (!left) goHome('done');
      else if (binPct() >= 100) goHome('bin');
      else if (S.battery < 15) goHome('battery');
      else { S.homeReason = null; S.running = true; setState('cleaning'); }
    } else {
      const it = d.it, h = d.hist, now = performance.now();
      const old = h.find((p) => now - p.t < 90) || h[0], lastP = h[h.length - 1];
      const dtm = Math.max(16, lastP.t - old.t) / 1000;
      it.vx = clamp((lastP.x - old.x) / dtm, -2600, 2600); it.vy = clamp((lastP.y - old.y) / dtm, -2600, 2600);
      if (now - lastP.t > 120) it.vx = it.vy = 0;
      it.st = 'floor'; it.thrown = Math.hypot(it.vx, it.vy) > 180;
      if (['done', 'stopped'].includes(S.state) && S.homeReason !== 'stop') { S.homeReason = null; S.running = true; setState('undock'); }
    }
  };
  cv.addEventListener('pointerup', release);
  cv.addEventListener('pointercancel', release);
}

// ---------- loop ----------
let last = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!S.paused) update(dt);
  draw();
  updatePanel(dt);
  requestAnimationFrame(frame);
}

setup();
