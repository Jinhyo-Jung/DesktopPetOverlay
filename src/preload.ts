import { contextBridge, ipcRenderer } from 'electron';

interface OverlayState {
  clickThroughEnabled: boolean;
  shortcut: string;
  shortcutRegistered: boolean;
}

interface WindowMovePayload {
  deltaX: number;
  deltaY: number;
  anchorX?: number;
  anchorY?: number;
  anchorSize?: number;
  lockToTaskbar?: boolean;
}

interface DisplayInfo {
  id: number;
  name: string;
  width: number;
  height: number;
  workAreaX: number;
  workAreaY: number;
  workAreaWidth: number;
  workAreaHeight: number;
  current: boolean;
}

interface OverlayBridge {
  getState: () => Promise<OverlayState>;
  setClickThrough: (enabled: boolean) => Promise<boolean>;
  toggleClickThrough: () => Promise<boolean>;
  moveWindowBy: (payload: WindowMovePayload) => Promise<void>;
  getDisplays: () => Promise<DisplayInfo[]>;
  moveToDisplay: (displayId: number) => Promise<boolean>;
  onClickThroughChanged: (callback: (state: OverlayState) => void) => () => void;
}

const overlayBridge: OverlayBridge = {
  getState: () => ipcRenderer.invoke('overlay:get-state') as Promise<OverlayState>,
  setClickThrough: (enabled: boolean) =>
    ipcRenderer.invoke('overlay:set-click-through', enabled) as Promise<boolean>,
  toggleClickThrough: () =>
    ipcRenderer.invoke('overlay:toggle-click-through') as Promise<boolean>,
  moveWindowBy: (payload: WindowMovePayload) =>
    ipcRenderer.invoke('overlay:move-window-by', payload) as Promise<void>,
  getDisplays: () => ipcRenderer.invoke('overlay:get-displays') as Promise<DisplayInfo[]>,
  moveToDisplay: (displayId: number) =>
    ipcRenderer.invoke('overlay:move-to-display', displayId) as Promise<boolean>,
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
