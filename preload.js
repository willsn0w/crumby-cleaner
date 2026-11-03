const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('crumby', {
  init: () => ipcRenderer.invoke('crumby:init'),
  ready: () => ipcRenderer.send('crumby:ready'),
  painted: () => ipcRenderer.send('crumby:painted'),
  quit: () => ipcRenderer.send('crumby:quit'),
  interactive: (on) => ipcRenderer.send('crumby:interactive', on),
  move: (list) => ipcRenderer.send('crumby:move', list),
  lift: (name) => ipcRenderer.invoke('crumby:lift', name),
  trash: (name) => ipcRenderer.invoke('crumby:trash', name),
  wallpaper: () => ipcRenderer.invoke('crumby:wallpaper'),
  prefetch: (name) => ipcRenderer.invoke('crumby:prefetch', name),
  onCover: (fn) => ipcRenderer.on('crumby:cover', (e, url) => fn(url)),
  covered: () => ipcRenderer.send('crumby:covered'),
  onUncover: (fn) => ipcRenderer.on('crumby:uncover', () => fn()),
  refresh: () => ipcRenderer.send('crumby:refresh'),
  saveDock: (pos) => ipcRenderer.send('crumby:saveDock', pos),
  onScan: (fn) => ipcRenderer.on('crumby:scan', (e, data) => fn(data)),
});
