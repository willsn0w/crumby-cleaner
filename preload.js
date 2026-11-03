const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('crumby', {
  init: () => ipcRenderer.invoke('crumby:init'),
  ready: () => ipcRenderer.send('crumby:ready'),
  quit: () => ipcRenderer.send('crumby:quit'),
  interactive: (on) => ipcRenderer.send('crumby:interactive', on),
  move: (list) => ipcRenderer.send('crumby:move', list),
  lift: (name) => ipcRenderer.invoke('crumby:lift', name),
  trash: (name) => ipcRenderer.invoke('crumby:trash', name),
  wallpaper: () => ipcRenderer.invoke('crumby:wallpaper'),
  refresh: () => ipcRenderer.send('crumby:refresh'),
  saveDock: (pos) => ipcRenderer.send('crumby:saveDock', pos),
  onScan: (fn) => ipcRenderer.on('crumby:scan', (e, data) => fn(data)),
});
