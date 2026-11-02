// Crumby — a desktop-cleaning robot that lives on your wallpaper.
// Main process: finds desktop icons, hides the real ones, opens a transparent
// overlay where the robot collects them. Every icon the robot swallows is moved
// to the Windows Recycle Bin (shell.trashItem), so it can always be restored.
// Also adds "Limpar a área de trabalho com Crumby" to the desktop right-click menu.

const { app, BrowserWindow, ipcMain, screen, nativeImage, globalShortcut, shell, dialog } = require('electron');
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
let restoring = false;

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

async function collectItems(workArea, scale) {
  const files = await listDesktopFiles();
  const scanText = await helperCmd('scan');
  const rows = scanText.split(/\r?\n/).filter((l) => l && !l.startsWith('ERR'))
    .map((l) => l.split('\t')).filter((p) => p.length >= 5)
    .map((p) => ({ l: +p[0], t: +p[1], r: +p[2], b: +p[3], name: p.slice(4).join('\t') }));

  // match listview labels to files (labels may hide extensions; .lnk/.url never show them)
  const pool = files.slice();
  const take = (label) => {
    const lo = label.toLowerCase();
    let i = pool.findIndex((f) => f.name.toLowerCase() === lo);
    if (i < 0) i = pool.findIndex((f) => f.name.replace(/\.[^.]+$/, '').toLowerCase() === lo);
    return i >= 0 ? pool.splice(i, 1)[0] : null;
  };

  const items = [];
  const onScreen = (x, y) => x >= -10 && y >= -10 && x <= workArea.width + 10 && y <= workArea.height + 10;
  const mapped = rows.map((r) => ({
    r, x: ((r.l + r.r) / 2) / scale - workArea.x, y: ((r.t + r.b) / 2) / scale - workArea.y,
  }));
  if (mapped.some((m) => onScreen(m.x, m.y))) {
    // icons on other monitors are left alone (they still hide/return with the desktop)
    for (const m of mapped) {
      if (!onScreen(m.x, m.y)) continue;
      const f = take(m.r.name);
      items.push({ name: m.r.name, file: f, x: m.x, y: m.y, iconSize: Math.max(24, Math.min(96, (m.r.r - m.r.l) / scale)) });
    }
  } else {
    // fallback: Windows default arrangement (column-major from top-left)
    const cellW = 76, cellH = 100, rowsPer = Math.max(1, Math.floor((workArea.height - 10) / cellH));
    files.forEach((f, i) => {
      const col = Math.floor(i / rowsPer), row = i % rowsPer;
      items.push({ name: f.name.replace(/\.(lnk|url)$/i, ''), file: f, x: 8 + col * cellW + cellW / 2, y: 6 + row * cellH + 26, iconSize: 48 });
    });
  }

  const out = [];
  itemPaths = [];
  for (const it of items) {
    itemPaths.push(it.file ? it.file.path : null);
    out.push({
      id: out.length,
      canTrash: !!it.file,
      name: it.name,
      x: it.x, y: it.y, iconSize: it.iconSize,
      size: it.file ? it.file.size : 0,
      kind: kindOf(it.file),
      icon: it.file ? await iconFor(it.file) : null,
    });
  }
  return out;
}

// ---------- recycle bin ----------
let itemPaths = [];
const trashed = new Set();
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
function reg(args) {
  return new Promise((res) => execFile('reg.exe', args, { windowsHide: true }, (err) => res(!err)));
}
async function registerContextMenu() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const exe = process.execPath;
  await reg(['add', MENU_KEY, '/ve', '/d', 'Limpar a área de trabalho com Crumby', '/f']);
  await reg(['add', MENU_KEY, '/v', 'Icon', '/d', `"${exe}",0`, '/f']);
  await reg(['add', MENU_KEY, '/v', 'Position', '/d', 'Top', '/f']);
  await reg(['add', MENU_KEY + '\\command', '/ve', '/d', `"${exe}" --clean`, '/f']);
}
async function unregisterContextMenu() {
  if (process.platform !== 'win32') return;
  await reg(['delete', MENU_KEY, '/f']);
}

// ---------- lifecycle ----------
async function restoreDesktop() {
  if (restoring) return;
  restoring = true;
  if (helper) {
    await helperCmd('show', 3000);
    try { helper.stdin.end(); } catch (e) {}
  }
}

async function quit() {
  await restoreDesktop();
  globalShortcut.unregisterAll();
  app.exit(0);
}

async function createWindow() {
  const display = screen.getPrimaryDisplay();
  const wa = display.workArea;
  startHelper();

  win = new BrowserWindow({
    x: wa.x, y: wa.y, width: wa.width, height: wa.height,
    transparent: true, frame: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    hasShadow: false, show: false, backgroundColor: '#00000000',
    title: 'Crumby', icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false },
  });
  win.setMenu(null);

  const items = await collectItems(wa, display.scaleFactor);

  ipcMain.handle('crumby:init', () => ({ items, width: wa.width, height: wa.height }));
  ipcMain.on('crumby:ready', async () => {
    win.show();
    win.focus();
    await helperCmd('hide', 5000); // real icons vanish the moment our copies are on screen
  });
  ipcMain.on('crumby:quit', () => quit());
  ipcMain.handle('crumby:trash', (e, id) => trashItem(id));

  await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  globalShortcut.register('Escape', () => quit());
  win.on('closed', () => quit());
}

app.whenReady().then(async () => {
  if (process.argv.includes('--uninstall')) {
    await unregisterContextMenu();
    await dialog.showMessageBox({ type: 'info', title: 'Crumby', message: 'Crumby foi removido do menu do clique direito.' });
    app.exit(0);
    return;
  }
  registerContextMenu(); // refreshed on every launch so it always points at this copy
  createWindow();
});
app.on('window-all-closed', () => quit());
process.on('exit', () => { try { helper && helper.stdin.end(); } catch (e) {} });
