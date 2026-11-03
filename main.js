// Crumby — a robot vacuum that lives on your Windows desktop, like a desktop pet.
//
// The real desktop always stays in charge: Crumby's window is transparent and lets every click,
// drag and drop through, except over the robot, its dock and its panel. The robot reads where the
// real icons are several times a second, nudges them for real with its "gravity", and when it
// swallows one it photographs just that icon, sends the file to the Recycle Bin and animates the
// photo into the robot. Adds "Limpar com o Crumby" to the desktop right-click menu and keeps
// running in the system tray.

const { app, BrowserWindow, ipcMain, screen, nativeImage, shell, dialog, Tray, Menu, desktopCapturer } = require('electron');
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (process.platform === 'win32') app.setAppUserModelId('app.crumby.desktop');
if (!app.requestSingleInstanceLock()) app.exit(0);

// test mode (a file named "test-mode" containing "on", next to main.js): only files named
// crumby-test* are cleaned, a debug.log is written and Crumby restarts when its files change
const TEST_MODE = (() => { try { return /^\s*on/i.test(fs.readFileSync(path.join(__dirname, 'test-mode'), 'utf8')); } catch (e) { return false; } })();

let win = null;

// test mode keeps a diagnostic log next to main.js
function log(...a) {
  if (!TEST_MODE) return;
  try { fs.appendFileSync(path.join(__dirname, 'debug.log'), new Date().toISOString().slice(11, 23) + ' ' + a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n'); } catch (e) {}
}
process.on('uncaughtException', (e) => log('UNCAUGHT', String(e && e.stack || e)));
process.on('unhandledRejection', (e) => log('UNHANDLED', String(e && e.stack || e)));

// ---------- desktop helper (Windows only) ----------
let helper = null, helperBuf = '', helperWaiters = [], helperQueue = Promise.resolve();
function startHelper() {
  if (process.platform !== 'win32' || helper) return;
  try {
    const src = fs.readFileSync(path.join(__dirname, 'desktop-helper.ps1'), 'utf8');
    const file = path.join(os.tmpdir(), 'crumby-desktop-helper.ps1');
    fs.writeFileSync(file, '﻿' + src, 'utf8');
    helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    helper.stdout.setEncoding('utf8');
    helper.stdout.on('data', (d) => {
      helperBuf += d;
      let idx;
      while ((idx = helperBuf.indexOf('<<END>>')) !== -1) {
        const out = helperBuf.slice(0, idx);
        helperBuf = helperBuf.slice(idx + 7).replace(/^\r?\n/, '');
        const w = helperWaiters.shift();
        if (w) w(out);
      }
    });
    helper.stderr.setEncoding('utf8');
    helper.stderr.on('data', (d) => log('helper stderr', d.slice(0, 800)));
    helper.on('exit', (code) => { log('helper exit', code); });
    helper.on('exit', () => { helper = null; helperWaiters.splice(0).forEach((w) => w('')); });
    helper.on('error', () => { helper = null; });
  } catch (e) { helper = null; }
}
// one command at a time, in order
function helperCmd(cmd, timeout = 15000) {
  const run = () => new Promise((resolve) => {
    if (!helper) return resolve('');
    const t = setTimeout(() => resolve(''), timeout);
    helperWaiters.push((out) => { clearTimeout(t); resolve(out); });
    try { helper.stdin.write(cmd + '\n'); } catch (e) { clearTimeout(t); resolve(''); }
  });
  const p = helperQueue.then(run, run);
  helperQueue = p.catch(() => {});
  return p;
}

// ---------- desktop files (cached) ----------
const IMG = /\.(png|jpe?g|gif|bmp|webp|heic|tiff?)$/i;
function desktopDirs() {
  const dirs = [app.getPath('desktop')];
  const pub = process.env.PUBLIC ? path.join(process.env.PUBLIC, 'Desktop') : null;
  if (pub && fs.existsSync(pub)) dirs.push(pub);
  return dirs;
}
const folderSizes = new Map();
async function dirSize(p, budget) {
  let total = 0;
  const stack = [p];
  while (stack.length && budget.n > 0) {
    const d = stack.pop();
    let entries = [];
    try { entries = await fs.promises.readdir(d, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of entries) {
      if (--budget.n <= 0) break;
      const fp = path.join(d, e.name);
      if (e.isDirectory()) stack.push(fp);
      else { try { total += (await fs.promises.stat(fp)).size; } catch (er) {} }
    }
  }
  return total;
}
let fileCache = { at: 0, files: [] };
async function desktopFiles() {
  if (Date.now() - fileCache.at < 1500) return fileCache.files;
  const files = [];
  for (const dir of desktopDirs()) {
    let entries = [];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of entries) {
      const n = e.name;
      if (/^desktop\.ini$/i.test(n) || n.startsWith('~$') || n.startsWith('.')) continue;
      const fp = path.join(dir, n);
      const isDir = e.isDirectory();
      let size = 0;
      if (isDir) {
        if (!folderSizes.has(fp)) { folderSizes.set(fp, 0); dirSize(fp, { n: 4000 }).then((s) => folderSizes.set(fp, s)); }
        size = folderSizes.get(fp);
      } else { try { size = (await fs.promises.stat(fp)).size; } catch (er) {} }
      files.push({ name: n, path: fp, size, isDir });
    }
  }
  fileCache = { at: Date.now(), files };
  return files;
}
function kindOf(f) {
  if (!f) return 'system';
  if (f.isDir) return 'folder';
  if (IMG.test(f.name)) return 'image';
  return 'file';
}
// listview labels may hide extensions (.lnk/.url never show them)
function matchFile(label, files) {
  const lo = label.toLowerCase();
  return files.find((f) => f.name.toLowerCase() === lo)
    || files.find((f) => f.name.replace(/\.[^.]+$/, '').toLowerCase() === lo) || null;
}

// ---------- the real icons ----------
let rows = new Map();   // name -> latest row from Explorer (physical px, listview coords)
let virt = { x: 0, y: 0 }, mouseDown = false;

function parseScan(text) {
  const out = new Map();
  for (const line of text.split(/\r?\n/)) {
    const p = line.split('\t');
    if (p[0] === 'VS') virt = { x: +p[1] || 0, y: +p[2] || 0 };
    else if (p[0] === 'MB') mouseDown = p[1] === '1';
    else if (p[0] === 'IT' && p.length >= 14) {
      const name = p.slice(13).join('\t');
      out.set(name, { idx: +p[1], pos: [+p[2], +p[3]], icon: p.slice(4, 8).map(Number), bounds: p.slice(8, 12).map(Number), sel: p[12] === '1', name });
    }
  }
  return out;
}

// physical listview coords <-> DIP inside our window
function geo() {
  const d = screen.getPrimaryDisplay();
  return { s: d.scaleFactor, wa: d.workArea, ox: virt.x - d.bounds.x * d.scaleFactor, oy: virt.y - d.bounds.y * d.scaleFactor };
}
function toDip(g, px, py) { return [(px + g.ox) / g.s - g.wa.x, (py + g.oy) / g.s - g.wa.y]; }

let scanLogged = 0;
async function scanDesktop() {
  const text = await helperCmd('scan', 4000);
  if (scanLogged < 3) { scanLogged++; log('scan', text.slice(0, 600)); }
  if (!text) return null;
  rows = parseScan(text);
  const files = await desktopFiles();
  const g = geo();
  const items = [];
  for (const r of rows.values()) {
    const [x, y] = toDip(g, (r.icon[0] + r.icon[2]) / 2, (r.icon[1] + r.icon[3]) / 2);
    if (x < -20 || y < -20 || x > g.wa.width + 20 || y > g.wa.height + 20) continue; // other monitors
    const f = matchFile(r.name, files);
    const [bl, bt] = toDip(g, r.bounds[0], r.bounds[1]);
    const [br, bb] = toDip(g, r.bounds[2], r.bounds[3]);
    items.push({
      name: r.name, x, y, sel: r.sel, box: [bl - x, bt - y, br - x, bb - y],
      kind: kindOf(f), size: f ? f.size : 0,
      canTrash: !!f && !/^crumby(\.exe|\.lnk)?$/i.test(f.name) && (!TEST_MODE || /^crumby-test/i.test(r.name)), // never itself
    });
  }
  return { items, mouseDown };
}

let scanning = false;
async function scanLoop() {
  while (win && session) {
    if (!scanning) {
      scanning = true;
      try {
        const res = await scanDesktop();
        if (res && win) win.webContents.send('crumby:scan', res);
      } catch (e) {}
      scanning = false;
    }
    await new Promise((r) => setTimeout(r, 220));
  }
}

// gravity: the renderer asks to put icons at new DIP centers
async function moveIcons(list) {
  if (!Array.isArray(list) || !list.length) return;
  const g = geo();
  const parts = ['moves'];
  for (const m of list) {
    const r = rows.get(m.name);
    if (!r) continue;
    const cx = (r.icon[0] + r.icon[2]) / 2, cy = (r.icon[1] + r.icon[3]) / 2;
    const nx = (m.x + g.wa.x) * g.s - g.ox, ny = (m.y + g.wa.y) * g.s - g.oy; // wanted icon center, listview coords
    const dx = Math.round(nx - cx), dy = Math.round(ny - cy);
    if (!dx && !dy) continue;
    const px = Math.max(0, r.pos[0] + dx), py = Math.max(0, r.pos[1] + dy);
    parts.push(r.idx, px, py, r.name);
    // optimistic update until the next scan
    const ddx = px - r.pos[0], ddy = py - r.pos[1];
    r.pos = [px, py];
    r.icon = [r.icon[0] + ddx, r.icon[1] + ddy, r.icon[2] + ddx, r.icon[3] + ddy];
    r.bounds = [r.bounds[0] + ddx, r.bounds[1] + ddy, r.bounds[2] + ddx, r.bounds[3] + ddy];
  }
  if (parts.length > 1) await helperCmd(parts.join('\t'), 3000);
}

// ---------- photos ----------
async function grabScreen(display) {
  try {
    const want = { width: Math.round(display.bounds.width * display.scaleFactor), height: Math.round(display.bounds.height * display.scaleFactor) };
    const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: want });
    const src = srcs.find((x) => x.display_id === String(display.id)) || srcs[0];
    if (!src || src.thumbnail.isEmpty()) return null;
    const sz = src.thumbnail.getSize();
    return { buf: src.thumbnail.toBitmap(), w: sz.width, h: sz.height, k: sz.width / want.width };
  } catch (e) { log('grabScreen', String(e)); return null; }
}

// the robot hides from screen capture only for these few milliseconds, so screenshots and
// screen recordings of Crumby work normally the rest of the time
async function grab(rect) {
  const [l, t, r, b] = rect.map(Math.round);
  if (win) { try { win.setContentProtection(true); } catch (e) {} await new Promise((res) => setTimeout(res, 70)); }
  const out = await helperCmd(`grab\t${l}\t${t}\t${r - l}\t${b - t}`, 4000);
  if (win) { try { win.setContentProtection(false); } catch (e) {} }
  const line = out.split(/\r?\n/).find((x) => x.startsWith('PNG\t'));
  if (!line) return null;
  const img = nativeImage.createFromBuffer(Buffer.from(line.slice(4), 'base64'));
  if (img.isEmpty()) return null;
  const sz = img.getSize();
  return { buf: img.toBitmap(), w: sz.width, h: sz.height, k: 1, img };
}

function cutSprite(A, B, rect, icon) {
  const W = A.w;
  const l = Math.max(0, Math.floor(rect[0])), t = Math.max(0, Math.floor(rect[1]));
  const r = Math.min(A.w, Math.ceil(rect[2])), b = Math.min(A.h, Math.ceil(rect[3]));
  const w = r - l, h = b - t;
  if (w <= 2 || h <= 2) return null;
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((t + y) * W + (l + x)) * 4;
      const d = Math.max(Math.abs(A.buf[i] - B.buf[i]), Math.abs(A.buf[i + 1] - B.buf[i + 1]), Math.abs(A.buf[i + 2] - B.buf[i + 2]));
      a[y * w + x] = d < 6 ? 0 : Math.min(1, d / 36);
    }
  }
  // fill pinholes inside the icon where its colour happens to match the wallpaper (closing, radius 2)
  const il = Math.max(0, icon[0] - l), it = Math.max(0, icon[1] - t), ir = Math.min(w, icon[2] - l), ib = Math.min(h, icon[3] - t);
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && a[y * w + x] > 0.5;
  const fill = [];
  for (let y = it; y < ib; y++) {
    for (let x = il; x < ir; x++) {
      if (a[y * w + x] > 0.5) continue;
      let hits = 0;
      for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, 0], [1, 0], [0, -1], [0, 1]]) if (solid(x + dx, y + dy)) hits++;
      if (hits >= 6) fill.push(y * w + x);
    }
  }
  for (const k of fill) a[k] = 1;
  // premultiplied BGRA: colour = A - (1 - alpha) * B, so it composites back to exactly A over the wallpaper
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x, i = ((t + y) * W + (l + x)) * 4, o = k * 4, al = a[k];
      if (al <= 0) continue;
      for (let c = 0; c < 3; c++) out[o + c] = Math.max(0, Math.min(255 * al, A.buf[i + c] - (1 - al) * B.buf[i + c]));
      out[o + 3] = Math.round(255 * al);
    }
  }
  const img = nativeImage.createFromBitmap(out, { width: w, height: h });
  return { url: img.toDataURL(), l, t, w, h };
}

// one photo of the bare wallpaper per run: icons blink away for a split second (while the lidar
// sweeps), Crumby's window is kept out of the photo
let wallpaper = null;
async function takeWallpaper() {
  const d = screen.getPrimaryDisplay();
  if (win) { try { win.setContentProtection(true); } catch (e) {} }
  await helperCmd('hide', 3000);
  await new Promise((r) => setTimeout(r, 160));
  const shot = await grabScreen(d);
  await helperCmd('show', 3000);
  if (win) { try { win.setContentProtection(false); } catch (e) {} }
  if (shot) wallpaper = shot;
  log('wallpaper', shot ? `${shot.w}x${shot.h} k=${shot.k}` : 'failed');
  return !!shot;
}
function wallpaperCrop(rect) {
  const B = wallpaper;
  if (!B) return null;
  const k = B.k;
  const l = Math.round(rect[0] * k), t = Math.round(rect[1] * k), w = Math.round((rect[2] - rect[0]) * k), h = Math.round((rect[3] - rect[1]) * k);
  if (l < 0 || t < 0 || l + w > B.w || t + h > B.h || w <= 0 || h <= 0) return null;
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) B.buf.copy(buf, y * w * 4, ((t + y) * B.w + l) * 4, ((t + y) * B.w + l + w) * 4);
  return { buf, w, h, k: 1 };
}

// Swallow, step 1 (fast): photo of the icon, cut out against the wallpaper photo. The renderer starts
// the animation at once and covers the real icon with the matching piece of wallpaper.
async function liftIcon(name) {
  const r = rows.get(name);
  if (!r) return null;
  if (!wallpaper) await takeWallpaper();
  const g = geo();
  const pad = Math.round(4 * g.s);
  const rect = [r.bounds[0] + g.ox - pad, r.bounds[1] + g.oy - pad, r.bounds[2] + g.ox + pad, r.bounds[3] + g.oy + pad];
  const icon = [r.icon[0] + g.ox, r.icon[1] + g.oy, r.icon[2] + g.ox, r.icon[3] + g.oy];
  const A = await grab(rect);
  if (!A) return null;
  let B = wallpaperCrop(rect);
  if (B && (B.w !== A.w || B.h !== A.h)) B = null;
  const s = g.s;
  const icx = (icon[0] + icon[2]) / 2 - rect[0], icy = (icon[1] + icon[3]) / 2 - rect[1];
  let sprite = null, patch = null;
  if (B) {
    const ic = [icon[0] - rect[0], icon[1] - rect[1], icon[2] - rect[0], icon[3] - rect[1]];
    const c = cutSprite(A, B, [0, 0, A.w, A.h], ic);
    if (c) sprite = { url: c.url, w: c.w / s, h: c.h / s, ax: (icx - c.l) / s, ay: (icy - c.t) / s };
    patch = { url: nativeImage.createFromBitmap(B.buf, { width: B.w, height: B.h }).toDataURL(), w: B.w / s, h: B.h / s, ax: icx / s, ay: icy / s };
  }
  if (!sprite) sprite = { url: A.img.toDataURL(), w: A.w / s, h: A.h / s, ax: icx / s, ay: icy / s, opaque: true };
  return { sprite, patch };
}

// Swallow, step 2 (background): Recycle Bin, then wait until Explorer has removed the icon
async function trashIcon(name) {
  const files = await desktopFiles();
  const f = matchFile(name, files);
  if (!f) return { ok: false, error: 'not a file' };
  if (TEST_MODE && !/^crumby-test/i.test(name)) return { ok: false, error: 'test mode' };
  try { await shell.trashItem(f.path); } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  fileCache.at = 0;
  log('trashed', name);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 80));
    if (!parseScan(await helperCmd('scan', 3000)).has(name)) return { ok: true };
  }
  await helperCmd('refresh', 2000); // Explorer missed it: F5
  return { ok: true };
}

// ---------- settings (userData/settings.json) ----------
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
let settings = {};
function loadSettings() {
  try { settings = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')) || {}; } catch (e) { settings = {}; }
}
function saveSettings() {
  try { fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true }); fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2)); } catch (e) {}
}

// ---------- desktop right-click menu (per user, no admin needed) ----------
const MENU_KEY = 'HKCU\\Software\\Classes\\DesktopBackground\\Shell\\Crumby';
const MENU_LABEL = 'Limpar com o Crumby';
function reg(args) {
  return new Promise((res) => execFile('reg.exe', args, { windowsHide: true }, (err) => res(!err)));
}
async function registerContextMenu() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const exe = process.execPath;
  await reg(['add', MENU_KEY, '/ve', '/d', MENU_LABEL, '/f']);
  await reg(['add', MENU_KEY, '/v', 'MUIVerb', '/d', MENU_LABEL, '/f']);
  await reg(['add', MENU_KEY, '/v', 'Icon', '/d', `"${exe}",0`, '/f']);
  await reg(['add', MENU_KEY, '/v', 'Position', '/d', 'Top', '/f']);
  await reg(['add', MENU_KEY + '\\command', '/ve', '/d', `"${exe}" --clean`, '/f']);
}
async function unregisterContextMenu() {
  if (process.platform !== 'win32') return;
  await reg(['delete', MENU_KEY, '/f']);
}

// ---------- start with Windows (tray only) ----------
function setStartAtLogin(on) {
  settings.startAtLogin = !!on; saveSettings();
  if (!app.isPackaged) return;
  try { app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath, args: ['--background'] }); } catch (e) {}
}

// ---------- the robot's window ----------
let session = null;
let closing = false;

async function startSession() {
  if (win) { win.show(); return; }
  if (session) return;
  closing = false;
  const wa = screen.getPrimaryDisplay().workArea; // never covers the taskbar
  session = { wa };
  startHelper();

  win = new BrowserWindow({
    x: wa.x, y: wa.y, width: wa.width, height: wa.height,
    transparent: true, frame: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    hasShadow: false, show: false, backgroundColor: '#00000000', skipTaskbar: true,
    title: 'Crumby', icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false },
  });
  win.setMenu(null);
  // clicks, drags and drops go straight to the real desktop, except where the renderer says otherwise
  win.setIgnoreMouseEvents(true, { forward: true });
  win.on('closed', () => { win = null; endSession(); });
  win.webContents.on('console-message', (e, level, message, line, src) => log('renderer', level, message, (src || '').split('/').pop() + ':' + line));
  win.webContents.on('render-process-gone', (e, d) => log('renderer gone', d));
  log('session start', wa);
  await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  updateTrayMenu();
}

async function endSession() {
  if (closing) return;
  closing = true;
  if (win && !win.isDestroyed()) { const w = win; win = null; w.destroy(); }
  session = null;
  closing = false;
  updateTrayMenu();
  if (tray && !settings.trayHintShown && process.platform === 'win32') {
    settings.trayHintShown = true; saveSettings();
    try { tray.displayBalloon({ title: 'Crumby continua por aqui', content: 'Clique no robô na bandeja para limpar de novo, ou use "Limpar com o Crumby" no clique direito da área de trabalho.', iconType: 'info' }); } catch (e) {}
  }
}

ipcMain.handle('crumby:init', () => ({
  width: session ? session.wa.width : 0, height: session ? session.wa.height : 0,
  dock: settings.dock || null, testMode: TEST_MODE, windows: process.platform === 'win32',
}));
ipcMain.on('crumby:ready', () => {
  log('ready');
  if (!win) return;
  helperCmd('refresh', 2000); // clears any stale icon Explorer kept around
  win.show(); // (showInactive leaves transparent windows grey on some Windows setups)
  scanLoop();
});
ipcMain.on('crumby:quit', () => endSession());
ipcMain.on('crumby:interactive', (e, on) => { if (win) win.setIgnoreMouseEvents(!on, { forward: true }); });
ipcMain.on('crumby:move', (e, list) => { moveIcons(list); });
ipcMain.handle('crumby:lift', (e, name) => liftIcon(name));
ipcMain.handle('crumby:trash', (e, name) => trashIcon(name));
ipcMain.handle('crumby:wallpaper', () => takeWallpaper());
ipcMain.on('crumby:refresh', () => { helperCmd('refresh', 2000); });
ipcMain.on('crumby:saveDock', (e, pos) => {
  if (pos && isFinite(pos.x) && isFinite(pos.y)) { settings.dock = { x: Math.round(pos.x), y: Math.round(pos.y) }; saveSettings(); }
});

// ---------- tray ----------
let tray = null;
function trayIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'assets', 'icon.png'));
  return img.isEmpty() ? img : img.resize({ width: 16, height: 16, quality: 'best' });
}
function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: win ? 'Mostrar o Crumby' : MENU_LABEL, click: () => startSession() },
    { type: 'separator' },
    { label: 'Iniciar com o Windows', type: 'checkbox', checked: settings.startAtLogin !== false, click: (m) => setStartAtLogin(m.checked) },
    { type: 'separator' },
    { label: 'Sair do Crumby', click: () => quitApp() },
  ]));
}
function createTray() {
  try {
    tray = new Tray(trayIcon());
    tray.setToolTip(TEST_MODE ? 'Crumby (modo de teste)' : 'Crumby');
    tray.on('click', () => startSession());
    tray.on('double-click', () => startSession());
    updateTrayMenu();
  } catch (e) { tray = null; }
}

async function quitApp() {
  await endSession();
  if (helper) { try { helper.stdin.end(); } catch (e) {} }
  if (tray) { tray.destroy(); tray = null; }
  app.exit(0);
}

// ---------- app ----------
app.on('second-instance', (e, argv) => {
  if (!argv.includes('--background')) startSession();
});
app.on('window-all-closed', () => { /* stay in the tray */ });

// test mode: restart by itself when its files are replaced (makes testing on a real PC quick)
function watchForUpdates() {
  if (!TEST_MODE) return;
  const files = ['main.js', 'preload.js', 'desktop-helper.ps1', 'renderer/app.js', 'renderer/index.html', 'renderer/style.css'];
  let timer = null;
  for (const f of files) {
    fs.watchFile(path.join(__dirname, f), { interval: 1000 }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (helper) { try { helper.stdin.end(); } catch (e) {} }
        app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--background') });
        app.exit(0);
      }, 1500);
    });
  }
}

app.whenReady().then(async () => {
  log('start', process.argv, app.getPath('desktop'));
  loadSettings();
  watchForUpdates();
  if (process.argv.includes('--uninstall')) {
    await unregisterContextMenu();
    try { app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, args: ['--background'] }); } catch (e) {}
    await dialog.showMessageBox({ type: 'info', title: 'Crumby', message: 'Crumby foi removido do menu do clique direito e da inicialização do Windows.' });
    app.exit(0);
    return;
  }
  registerContextMenu();
  if (settings.startAtLogin === undefined) setStartAtLogin(true);
  else setStartAtLogin(settings.startAtLogin);
  createTray();
  startHelper();
  if (!process.argv.includes('--background')) startSession();
});
process.on('exit', () => { try { helper && helper.stdin.end(); } catch (e) {} });
