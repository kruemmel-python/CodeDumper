const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appInfo', Object.freeze({
    version: process.versions.electron,
}));

contextBridge.exposeInMainWorld('codeDumperLocalLlm', Object.freeze({
    request: (payload) => ipcRenderer.invoke('codedumper:local-llm-request', payload),
}));
