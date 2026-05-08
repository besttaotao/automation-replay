const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('macroApi', {
  listMacros: () => ipcRenderer.invoke('list-macros'),
  deleteMacro: (filePath) => ipcRenderer.invoke('delete-macro', filePath),
  startRecording: (payload) => ipcRenderer.invoke('start-recording', payload),
  stopRecording: () => ipcRenderer.invoke('stop-recording'),
  cancelRecordingCountdown: () => ipcRenderer.invoke('cancel-recording-countdown'),
  saveCurrentMacro: (payload) => ipcRenderer.invoke('save-current-macro', payload),
  loadMacro: (filePath) => ipcRenderer.invoke('load-macro', filePath),
  chooseMacro: () => ipcRenderer.invoke('choose-macro'),
  startPlayback: (payload) => ipcRenderer.invoke('start-playback', payload),
  stopPlayback: () => ipcRenderer.invoke('stop-playback'),
  cancelPlaybackCountdown: () => ipcRenderer.invoke('cancel-playback-countdown'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  focusWindow: () => ipcRenderer.invoke('focus-window'),
  onLog: (callback) => ipcRenderer.on('engine-log', (_event, message) => callback(message)),
  onRecordingFinished: (callback) => ipcRenderer.on('recording-finished', (_event, payload) => callback(payload)),
  onPlaybackFinished: (callback) => ipcRenderer.on('playback-finished', (_event, payload) => callback(payload))
});
