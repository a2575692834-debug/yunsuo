const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('yunsuoDesktop', {
  load: () => ipcRenderer.invoke('desktop:load'),
  login: (payload) => ipcRenderer.invoke('desktop:login', payload),
  connect: (payload) => ipcRenderer.invoke('desktop:connect', payload),
  resume: () => ipcRenderer.invoke('desktop:resume'),
  clearToken: () => ipcRenderer.invoke('desktop:clear-token'),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url)
})
