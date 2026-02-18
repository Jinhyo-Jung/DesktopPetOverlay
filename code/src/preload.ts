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
  setPointerCapture: (enabled: boolean) => Promise<void>;
  getDisplays: () => Promise<DisplayInfo[]>;
  moveToDisplay: (displayId: number) => Promise<boolean>;
  onClickThroughChanged: (callback: (state: OverlayState) => void) => () => void;
  sendPetChatPrompt: (prompt: string) => Promise<{ ok: boolean; text?: string; error?: string }>;
  requestClose: () => Promise<boolean>;
  confirmClose: () => Promise<boolean>;
  onCloseRequested: (callback: () => void) => () => void;
  getOpenAiStatus: () => Promise<{ hasApiKey: boolean; source: 'config' | 'env' | 'none'; model: string }>;
  setOpenAiConfig: (payload: { apiKey: string; model?: string }) => Promise<{
    ok: boolean;
    status: { hasApiKey: boolean; source: 'config' | 'env' | 'none'; model: string };
  }>;
  clearOpenAiConfig: () => Promise<{
    ok: boolean;
    status: { hasApiKey: boolean; source: 'config' | 'env' | 'none'; model: string };
  }>;
}

const overlayBridge: OverlayBridge = {
  getState: () => ipcRenderer.invoke('overlay:get-state') as Promise<OverlayState>,
  setClickThrough: (enabled: boolean) =>
    ipcRenderer.invoke('overlay:set-click-through', enabled) as Promise<boolean>,
  toggleClickThrough: () =>
    ipcRenderer.invoke('overlay:toggle-click-through') as Promise<boolean>,
  moveWindowBy: (payload: WindowMovePayload) =>
    ipcRenderer.invoke('overlay:move-window-by', payload) as Promise<void>,
  setPointerCapture: (enabled: boolean) =>
    ipcRenderer.invoke('overlay:set-pointer-capture', enabled) as Promise<void>,
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
  sendPetChatPrompt: (prompt: string) =>
    ipcRenderer.invoke('pet-chat:send', { prompt }) as Promise<{
      ok: boolean;
      text?: string;
      error?: string;
    }>,
  requestClose: () => ipcRenderer.invoke('app:request-close') as Promise<boolean>,
  confirmClose: () => ipcRenderer.invoke('app:confirm-close') as Promise<boolean>,
  onCloseRequested: (callback: () => void) => {
    const listener = () => {
      callback();
    };
    ipcRenderer.on('app:close-requested', listener);
    return () => {
      ipcRenderer.removeListener('app:close-requested', listener);
    };
  },
  getOpenAiStatus: () => ipcRenderer.invoke('openai:get-status') as Promise<{
    hasApiKey: boolean;
    source: 'config' | 'env' | 'none';
    model: string;
  }>,
  setOpenAiConfig: (payload: { apiKey: string; model?: string }) =>
    ipcRenderer.invoke('openai:set-config', payload) as Promise<{
      ok: boolean;
      status: { hasApiKey: boolean; source: 'config' | 'env' | 'none'; model: string };
    }>,
  clearOpenAiConfig: () =>
    ipcRenderer.invoke('openai:clear-config') as Promise<{
      ok: boolean;
      status: { hasApiKey: boolean; source: 'config' | 'env' | 'none'; model: string };
    }>,
};

contextBridge.exposeInMainWorld('overlayBridge', overlayBridge);
