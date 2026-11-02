const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('crumby', {
  init: () => ipcRenderer.invoke('crumby:init'),
  ready: () => ipcRenderer.send('crumby:ready'),
  quit: (moves) => ipcRenderer.send('crumby:quit', moves),
  trash: (id) => ipcRenderer.invoke('crumby:trash', id),
  saveDock: (pos) => ipcRenderer.send('crumby:saveDock', pos),
  rescan: (moves) => ipcRenderer.invoke('crumby:rescan', moves),
  open: (id) => ipcRenderer.invoke('crumby:open', id),
  itemMenu: (id, prot) => ipcRenderer.invoke('crumby:itemMenu', id, prot),
  onEsc: (fn) => ipcRenderer.on('crumby:esc', () => fn()),
  dragIn: (positions) => ipcRenderer.send('crumby:dragIn', positions),
  onAdded: (fn) => ipcRenderer.on('crumby:added', (e, items) => fn(items)),
});
