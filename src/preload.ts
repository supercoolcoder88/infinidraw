import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('files', {
  save: (text: string) => ipcRenderer.invoke('save', text),
  open: () => ipcRenderer.invoke('open'),
});
