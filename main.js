// Crumby — a desktop-cleaning robot that lives on your wallpaper.
// Main process: finds desktop icons, hides the real ones, opens a transparent
// overlay where the robot collects them. Every icon the robot swallows is moved
// to the Windows Recycle Bin (shell.trashItem), so it can always be restored.
// Adds "Limpar com o Crumby" to the desktop right-click menu and keeps running
// in the system tray after the cleaning window is closed.

const { app, BrowserWindow, ipcMain, screen, nativeImage, globalShortcut, shell, dialog, Tray, Menu, desktopCapturer } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (process.platform === 'win32') app.setAppUserModelId('app.crumby.desktop');
if (!app.requestSingleInstanceLock()) app.exit(0);

let win = null;
let helper = null;
let helperBuf = '';
let helperWaiters = [];

// ---------- desktop helper (Windows only) ----------
function startHelper() {
  if (process.platform !== 'win32') return;
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
    helper.on('exit', () => { helper = null; helperWaiters.splice(0).forEach((w) => w('')); });
    helper.on('error', () => { helper = null; });
  } catch (e) { helper = null; }
}

function helperCmd(cmd, timeout = 15000) {
  return new Promise((resolve) => {
    if (!helper) return resolve('');
    const t = setTimeout(() => resolve(''), timeout);
    helperWaiters.push((out) => { clearTimeout(t); resolve(out); });
    try { helper.stdin.write(cmd + '\n'); } catch (e) { clearTimeout(t); resolve(''); }
  });
}

// ---------- desktop files ----------
const IMG = /\.(png|jpe?g|gif|bmp|webp|heic|tiff?)$/i;

function desktopDirs() {
  const dirs = [app.getPath('desktop')];
  const pub = process.env.PUBLIC ? path.join(process.env.PUBLIC, 'Desktop') : null;
  if (pub && fs.existsSync(pub)) dirs.push(pub);
  return dirs;
}

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

async function listDesktopFiles() {
  const files = [];
  for (const dir of desktopDirs()) {
    let entries = [];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of entries) {
      const n = e.name;
      if (/^desktop\.ini$/i.test(n) || n.startsWith('~$') || n.startsWith('.')) continue;
      const fp = path.join(dir, n);
      let size = 0, isDir = e.isDirectory();
      try {
        if (isDir) size = await dirSize(fp, { n: 4000 });
        else size = (await fs.promises.stat(fp)).size;
      } catch (er) {}
      files.push({ name: n, path: fp, size, isDir });
    }
  }
  return files;
}

async function iconFor(f) {
  try {
    if (!f.isDir && IMG.test(f.name) && nativeImage.createThumbnailFromPath) {
      const t = await nativeImage.createThumbnailFromPath(f.path, { width: 96, height: 96 });
      if (t && !t.isEmpty()) return t.toDataURL();
    }
  } catch (e) {}
  try {
    const ic = await app.getFileIcon(f.path, { size: 'large' });
    if (ic && !ic.isEmpty()) return ic.toDataURL();
  } catch (e) {}
  return null;
}

function kindOf(f) {
  if (!f) return 'system';
  if (f.isDir) return 'folder';
  if (IMG.test(f.name)) return 'image';
  return 'file';
}

// ---------- exact icon copies ----------
// Photograph the desktop with the icons (A) and without them (B). Wherever A differs from B
// is the icon + its label exactly as Windows drew it; the difference gives the transparency.
async function grabScreen(display) {
  try {
    const want = { width: Math.round(display.bounds.width * display.scaleFactor), height: Math.round(display.bounds.height * display.scaleFactor) };
    const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: want });
    const src = srcs.find((s) => s.display_id === String(display.id)) || srcs[0];
    if (!src || src.thumbnail.isEmpty()) return null;
    const sz = src.thumbnail.getSize();
    return { buf: src.thumbnail.toBitmap(), w: sz.width, h: sz.height, k: sz.width / want.width };
  } catch (e) { return null; }
}

// A, B: BGRA screen bitmaps of equal size. rect / icon: [l, t, r, b] in that bitmap's pixels.
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

// item bookkeeping for moving the real icons afterwards
let itemMeta = [];

// the wallpaper without icons (B) is kept for the whole session: it is the overlay's background,
// so the real icons can stay alive underneath (Windows keeps track of positions and drops normally)
let wallpaperShot = null;

function looksBlack(A) {
  let black = 0, n = 0;
  for (let k = 0; k < 400; k++) {
    const x = Math.floor(Math.random() * A.w), y = Math.floor(Math.random() * A.h), i = (y * A.w + x) * 4;
    n++; if (A.buf[i] === 0 && A.buf[i + 1] === 0 && A.buf[i + 2] === 0) black++;
  }
  return black / n > 0.9;
}

// screenshot with the icons, never including our own window
async function grabWithIcons(display) {
  let A = await grabScreen(display);
  if (A && win && win.isVisible() && looksBlack(A)) { // capture-exclusion not supported on this Windows
    win.hide(); await new Promise((r) => setTimeout(r, 220));
    A = await grabScreen(display);
    if (win) win.show();
  }
  return A;
}

function backgroundFrom(B, display, workArea) {
  const s = display.scaleFactor * B.k;
  const l = Math.round((workArea.x - display.bounds.x) * s), t = Math.round((workArea.y - display.bounds.y) * s);
  const w = Math.min(B.w - l, Math.round(workArea.width * s)), h = Math.min(B.h - t, Math.round(workArea.height * s));
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) B.buf.copy(out, y * w * 4, ((t + y) * B.w + l) * 4, ((t + y) * B.w + l + w) * 4);
  return nativeImage.createFromBitmap(out, { width: w, height: h }).toDataURL();
}

function parseScan(text) {
  let vx = 0, vy = 0;
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const p = line.split('\t');
    if (p[0] === 'VS') { vx = +p[1] || 0; vy = +p[2] || 0; }
    else if (p[0] === 'IT' && p.length >= 13) {
      rows.push({ idx: +p[1], pos: [+p[2], +p[3]], icon: p.slice(4, 8).map(Number), bounds: p.slice(8, 12).map(Number), name: p.slice(12).join('\t') });
    }
  }
  return { vx, vy, rows };
}

// capture: 'full' = photograph with + without icons (session start)
//          'icons' = only re-photograph the icons (wallpaper kept)       | false = no photos
// onlyNew: add just the icons that appeared since (dropped files), keeping current ids
async function collectItems(workArea, display, { capture = false, onlyNew = false } = {}) {
  const scale = display.scaleFactor;
  const files = await listDesktopFiles();
  const { vx, vy, rows: allRows } = parseScan(await helperCmd('scan'));
  const known = new Set(itemMeta.map((m) => m.name));
  const rows = onlyNew ? allRows.filter((r) => !known.has(r.name)) : allRows;
  if (onlyNew && !rows.length) return [];

  let A = null, B = null;
  if (capture === 'full' && rows.length) {
    A = await grabScreen(display);
    await helperCmd('hide', 5000);                // a split second, just for the wallpaper photo
    await new Promise((r) => setTimeout(r, 350));
    B = A ? await grabScreen(display) : null;
    await helperCmd('show', 5000);                // real icons back right away
    if (!B || B.w !== A.w || B.h !== A.h) A = B = null;
    wallpaperShot = B;
  } else if (capture === 'icons' && rows.length && wallpaperShot) {
    A = await grabWithIcons(display);
    B = wallpaperShot;
    if (!A || A.w !== B.w || A.h !== B.h) A = B = null;
  }

  // match listview labels to files (labels may hide extensions; .lnk/.url never show them)
  const taken = new Set(onlyNew ? itemPaths.filter(Boolean) : []);
  const pool = files.filter((f) => !taken.has(f.path));
  const take = (label) => {
    const lo = label.toLowerCase();
    let i = pool.findIndex((f) => f.name.toLowerCase() === lo);
    if (i < 0) i = pool.findIndex((f) => f.name.replace(/\.[^.]+$/, '').toLowerCase() === lo);
    return i >= 0 ? pool.splice(i, 1)[0] : null;
  };

  // listview coords -> screen physical px (primary display starts at 0,0)
  const ox = vx - display.bounds.x * scale, oy = vy - display.bounds.y * scale;
  const items = [];
  const onScreen = (x, y) => x >= -10 && y >= -10 && x <= workArea.width + 10 && y <= workArea.height + 10;
  const mapped = rows.map((r) => ({
    r,
    x: ((r.icon[0] + r.icon[2]) / 2 + ox) / scale - (workArea.x - display.bounds.x),
    y: ((r.icon[1] + r.icon[3]) / 2 + oy) / scale - (workArea.y - display.bounds.y),
  }));
  if (mapped.some((m) => onScreen(m.x, m.y))) {
    // icons on other monitors are left alone
    for (const m of mapped) {
      if (!onScreen(m.x, m.y)) continue;
      const f = take(m.r.name);
      let sprite = null;
      if (A && B) {
        const k = A.k;
        const pad = 3 * scale;
        const rect = [m.r.bounds[0] + ox - pad, m.r.bounds[1] + oy - pad, m.r.bounds[2] + ox + pad, m.r.bounds[3] + oy + pad].map((v) => v * k);
        const icon = [m.r.icon[0] + ox, m.r.icon[1] + oy, m.r.icon[2] + ox, m.r.icon[3] + oy].map((v) => v * k);
        const cut = cutSprite(A, B, rect, icon);
        if (cut) {
          const icx = ((icon[0] + icon[2]) / 2), icy = ((icon[1] + icon[3]) / 2);
          const s2 = scale * k;
          sprite = { url: cut.url, w: cut.w / s2, h: cut.h / s2, ax: (icx - cut.l) / s2, ay: (icy - cut.t) / s2 };
        }
      }
      items.push({ name: m.r.name, file: f, x: m.x, y: m.y, pos: m.r.pos, sprite,
        iconSize: Math.max(24, Math.min(96, (m.r.icon[2] - m.r.icon[0]) / scale)) });
    }
  } else if (!onlyNew) {
    // fallback: Windows default arrangement (column-major from top-left)
    const cellW = 76, cellH = 100, rowsPer = Math.max(1, Math.floor((workArea.height - 10) / cellH));
    files.forEach((f, i) => {
      const col = Math.floor(i / rowsPer), row = i % rowsPer;
      items.push({ name: f.name.replace(/\.(lnk|url)$/i, ''), file: f, x: 8 + col * cellW + cellW / 2, y: 6 + row * cellH + 26, iconSize: 48 });
    });
  }

  const out = [];
  if (!onlyNew) { itemPaths = []; itemMeta = []; }
  for (const it of items) {
    const id = itemPaths.length;
    itemPaths.push(it.file ? it.file.path : null);
    itemMeta.push({ name: it.name, pos: it.pos || null, x: it.x, y: it.y, scale });
    out.push({
      id,
      canTrash: !!it.file,
      name: it.name,
      x: it.x, y: it.y, iconSize: it.iconSize,
      size: it.file ? it.file.size : 0,
      kind: kindOf(it.file),
      sprite: it.sprite,
      icon: !it.sprite && it.file ? await iconFor(it.file) : null,
    });
  }
  return out;
}

// ---------- files dragged onto the desktop while Crumby is open ----------
// The overlay steps aside (click-through) so Windows itself receives the drop, exactly where the
// user lets go. Once the mouse button is released, the new icon is photographed and added.
let passthrough = false;
async function letDropThrough(positions) {
  if (!win || passthrough) return;
  passthrough = true;
  win.setIgnoreMouseEvents(true);
  // real icons go where the user sees them first, so nothing gets dropped into the wrong folder
  await applyMoves(positions);
  const t0 = Date.now();
  let sawDown = false;
  while (Date.now() - t0 < 30000) {
    await new Promise((r) => setTimeout(r, 120));
    const down = (await helperCmd('mouse', 1500)).trim().startsWith('1');
    if (down) sawDown = true;
    else if (sawDown || Date.now() - t0 > 1500) break;
  }
  if (win) win.setIgnoreMouseEvents(false);
  passthrough = false;
  // Explorer needs a moment to create the icon(s)
  for (let tries = 0; tries < 8 && win && session; tries++) {
    await new Promise((r) => setTimeout(r, 350));
    const added = await collectItems(session.wa, screen.getPrimaryDisplay(), { capture: 'icons', onlyNew: true });
    if (added.length) { if (win) win.webContents.send('crumby:added', added); break; }
  }
}

// apply the overlay positions of icons the user (or the vacuum) moved to the real desktop
async function applyMoves(list) {
  if (!Array.isArray(list)) return;
  for (const m of list) {
    const meta = itemMeta[m.id];
    if (!meta || !meta.pos || trashed.has(m.id)) continue;
    const dx = Math.round((m.x - meta.x) * meta.scale), dy = Math.round((m.y - meta.y) * meta.scale);
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
    const nx = Math.max(0, meta.pos[0] + dx), ny = Math.max(0, meta.pos[1] + dy);
    await helperCmd(`move\t${meta.name}\t${nx}\t${ny}`, 3000);
    meta.pos = [nx, ny]; meta.x = m.x; meta.y = m.y;
  }
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

// ---------- recycle bin ----------
let itemPaths = [];
let trashed = new Set();
async function trashItem(id) {
  const p = itemPaths[id];
  if (!p) return { ok: false, error: 'not a file' };
  if (trashed.has(id)) return { ok: true };
  try {
    await shell.trashItem(p);
    trashed.add(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
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

// ---------- cleaning sessions ----------
let session = null; // { items, wa }
let closing = false;

async function startSession() {
  if (win) { win.show(); win.focus(); return; }
  if (session) return; // already opening
  closing = false;
  const display = screen.getPrimaryDisplay();
  const wa = display.workArea; // excludes the taskbar
  session = { wa, items: [] };
  if (!helper) startHelper();
  trashed = new Set();

  win = new BrowserWindow({
    x: wa.x, y: wa.y, width: wa.width, height: wa.height,
    transparent: true, frame: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    hasShadow: false, show: false, backgroundColor: '#00000000', skipTaskbar: true,
    title: 'Crumby', icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false },
  });
  win.setMenu(null);
  win.on('closed', () => { win = null; endSession(); });

  if (helper) { await helperCmd('minall', 4000); await new Promise((r) => setTimeout(r, 650)); } // bring the desktop into view
  itemMeta = []; itemPaths = []; wallpaperShot = null;
  session.items = await collectItems(wa, display, { capture: 'full' });
  session.bg = wallpaperShot ? backgroundFrom(wallpaperShot, display, wa) : null;
  try { win.setContentProtection(true); } catch (e) {} // our window never shows up in our own screenshots
  await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  globalShortcut.register('Escape', () => { if (win) win.webContents.send('crumby:esc'); else endSession(); });
  updateTrayMenu();
}

// closes the cleaning window, shows the real desktop again, keeps Crumby in the tray
async function endSession(moves) {
  if (closing) return;
  closing = true;
  globalShortcut.unregister('Escape');
  if (moves) await applyMoves(moves);
  await helperCmd('show', 3000);
  await helperCmd('undomin', 3000);
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
  items: session ? session.items : [],
  width: session ? session.wa.width : 0, height: session ? session.wa.height : 0,
  dock: settings.dock || null,
  bg: session ? session.bg : null,
}));
ipcMain.on('crumby:ready', async () => {
  if (!win) return;
  win.show();
  win.focus();
  // with a wallpaper photo as background the real icons stay alive underneath;
  // without one (photo failed) they have to be hidden instead
  if (!session || !session.bg) await helperCmd('hide', 5000);
});
ipcMain.on('crumby:dragIn', (e, positions) => letDropThrough(positions));
ipcMain.on('crumby:quit', (e, moves) => endSession(moves));
ipcMain.handle('crumby:trash', (e, id) => trashItem(id));
// "Start" after a run: look at the desktop again (new files saved since then)
ipcMain.handle('crumby:rescan', async (e, moves) => {
  if (!session) return { items: [] };
  const display = screen.getPrimaryDisplay();
  // put moved icons where the user left them, then photograph the desktop again without our window
  await applyMoves(moves);
  trashed = new Set();
  itemMeta = []; itemPaths = [];
  session.items = await collectItems(session.wa, display, { capture: session.bg ? 'icons' : false });
  return { items: session.items };
});
ipcMain.handle('crumby:open', async (e, id) => {
  const p = itemPaths[id];
  if (!p) return false;
  return (await shell.openPath(p)) === '';
});
ipcMain.handle('crumby:itemMenu', (e, id, protectedNow) => new Promise((resolve) => {
  const p = itemPaths[id];
  let choice = null;
  const menu = Menu.buildFromTemplate([
    { label: 'Abrir', enabled: !!p, click: () => { choice = 'open'; shell.openPath(p); } },
    { label: 'Mostrar na pasta', enabled: !!p, click: () => { choice = 'reveal'; shell.showItemInFolder(p); } },
    { type: 'separator' },
    { label: 'Não limpar este item', type: 'checkbox', checked: !!protectedNow, enabled: !!p, click: (m) => { choice = m.checked ? 'protect' : 'unprotect'; } },
  ]);
  menu.popup({ window: win || undefined, callback: () => setTimeout(() => resolve(choice), 0) });
}));
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
    tray.setToolTip('Crumby');
    tray.on('click', () => startSession());
    tray.on('double-click', () => startSession());
    updateTrayMenu();
  } catch (e) { tray = null; }
}

async function quitApp() {
  await endSession();
  globalShortcut.unregisterAll();
  if (helper) { try { helper.stdin.end(); } catch (e) {} }
  if (tray) { tray.destroy(); tray = null; }
  app.exit(0);
}

// ---------- app ----------
app.on('second-instance', (e, argv) => {
  // right-click menu or a second double-click while Crumby lives in the tray
  if (!argv.includes('--background')) startSession();
});
app.on('window-all-closed', () => { /* stay in the tray */ });

app.whenReady().then(async () => {
  loadSettings();
  if (process.argv.includes('--uninstall')) {
    await unregisterContextMenu();
    try { app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, args: ['--background'] }); } catch (e) {}
    await dialog.showMessageBox({ type: 'info', title: 'Crumby', message: 'Crumby foi removido do menu do clique direito e da inicialização do Windows.' });
    app.exit(0);
    return;
  }
  registerContextMenu(); // refreshed on every launch so it always points at this copy
  if (settings.startAtLogin === undefined) setStartAtLogin(true);
  else setStartAtLogin(settings.startAtLogin);
  createTray();
  startHelper();
  if (!process.argv.includes('--background')) startSession();
});
process.on('exit', () => { try { helper && helper.stdin.end(); } catch (e) {} });
