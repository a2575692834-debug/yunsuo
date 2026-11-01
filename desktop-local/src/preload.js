const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('yunsuoLocal', {
  info: () => ipcRenderer.invoke('local:info'),
  providers: () => ipcRenderer.invoke('local:providers'),
  parse: (text) => ipcRenderer.invoke('local:parse', text),

  listAccounts: () => ipcRenderer.invoke('local:accounts:list'),
  addAccount: (payload) => ipcRenderer.invoke('local:accounts:add', payload),
  updateAccount: (payload) => ipcRenderer.invoke('local:accounts:update', payload),
  deleteAccount: (id) => ipcRenderer.invoke('local:accounts:delete', id),
  accountUsage: (id) => ipcRenderer.invoke('local:accounts:usage', id),
  qrStart: (provider) => ipcRenderer.invoke('local:qr:start', provider),
  qrPoll: (payload) => ipcRenderer.invoke('local:qr:poll', payload),

  transfer: (payload) => ipcRenderer.invoke('local:transfer:run', payload),
  listHistory: () => ipcRenderer.invoke('local:history:list'),
  clearHistory: () => ipcRenderer.invoke('local:history:clear'),
  listShares: () => ipcRenderer.invoke('local:shares:list'),
  deleteShare: (id) => ipcRenderer.invoke('local:shares:delete', id),

  listFiles: (payload) => ipcRenderer.invoke('local:files:list', payload),
  searchFiles: (payload) => ipcRenderer.invoke('local:files:search', payload),
  fileOperation: (payload) => ipcRenderer.invoke('local:files:operation', payload),

  listMonitors: () => ipcRenderer.invoke('local:monitors:list'),
  addMonitor: (payload) => ipcRenderer.invoke('local:monitors:add', payload),
  updateMonitor: (payload) => ipcRenderer.invoke('local:monitors:update', payload),
  deleteMonitor: (id) => ipcRenderer.invoke('local:monitors:delete', id),
  runMonitor: (id) => ipcRenderer.invoke('local:monitors:run', id),

  getSettings: () => ipcRenderer.invoke('local:settings:get'),
  updateSettings: (payload) => ipcRenderer.invoke('local:settings:update', payload),
  exportResults: (payload) => ipcRenderer.invoke('local:export', payload),
  openExternal: (url) => ipcRenderer.invoke('local:open-external', url),
  showDataFolder: () => ipcRenderer.invoke('local:show-data'),

  onTransferProgress: (callback) => subscribe('local:transfer-progress', callback),
  onMonitorChanged: (callback) => subscribe('local:monitor-changed', callback)
})
