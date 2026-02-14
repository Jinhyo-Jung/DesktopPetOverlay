import { contextBridge, ipcRenderer } from 'electron';

interface OverlayState {
  clickThroughEnabled: boolean;
  shortcut: string;
  shortcutRegistered: boolean;
}

interface OverlayBridge {
  getState: () => Promise<OverlayState>;
  setClickThrough: (enabled: boolean) => Promise<boolean>;
  toggleClickThrough: () => Promise<boolean>;
  onClickThroughChanged: (callback: (state: OverlayState) => void) => () => void;
}

const overlayBridge: OverlayBridge = {
  getState: () => ipcRenderer.invoke('overlay:get-state') as Promise<OverlayState>,
  setClickThrough: (enabled: boolean) =>
    ipcRenderer.invoke('overlay:set-click-through', enabled) as Promise<boolean>,
  toggleClickThrough: () =>
    ipcRenderer.invoke('overlay:toggle-click-through') as Promise<boolean>,
  onClickThroughChanged: (callback: (state: OverlayState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: OverlayState) => {
      callback(payload);
    };
    ipcRenderer.on('overlay:click-through-changed', listener);
    return () => {
      ipcRenderer.removeListener('overlay:click-through-changed', listener);
    };
  },
};

contextBridge.exposeInMainWorld('overlayBridge', overlayBridge);
