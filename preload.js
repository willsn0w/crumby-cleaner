const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('crumb', {
  init: () => ipcRenderer.invoke('crumb:init'),
  ready: () => ipcRenderer.send('crumb:ready'),
  quit: () => ipcRenderer.send('crumb:quit'),
});
