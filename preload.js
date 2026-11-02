const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('crumby', {
  init: () => ipcRenderer.invoke('crumby:init'),
  ready: () => ipcRenderer.send('crumby:ready'),
  quit: () => ipcRenderer.send('crumby:quit'),
  trash: (id) => ipcRenderer.invoke('crumby:trash', id),
  saveDock: (pos) => ipcRenderer.send('crumby:saveDock', pos),
});
