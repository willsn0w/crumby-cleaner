const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('crumby', {
  init: () => ipcRenderer.invoke('crumby:init'),
  ready: () => ipcRenderer.send('crumby:ready'),
  quit: () => ipcRenderer.send('crumby:quit'),
});
