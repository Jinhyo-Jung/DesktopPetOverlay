import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

interface OverlayPreferences {
  x?: number;
  y?: number;
  clickThroughEnabled: boolean;
}

interface OverlayState {
  clickThroughEnabled: boolean;
  shortcut: string;
  shortcutRegistered: boolean;
}

interface WindowMovePayload {
  deltaX?: number;
  deltaY?: number;
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

const DEFAULT_PREFERENCES: OverlayPreferences = {
  clickThroughEnabled: false,
};

const CLICK_THROUGH_TOGGLE_SHORTCUT = 'CommandOrControl+Alt+Shift+O';
const CLICK_THROUGH_SHORTCUT_LABEL = 'Ctrl+Alt+Shift+O';
const WINDOW_WIDTH = 520;
const WINDOW_HEIGHT = 320;
const WINDOW_MIN_WIDTH = 420;
const WINDOW_MIN_HEIGHT = 280;
const APP_USER_MODEL_ID = 'com.jinhy.desktoppetoverlay';
const WINDOW_EDGE_MARGIN_X = 24;
const WINDOW_EDGE_MARGIN_Y = 12;

let mainWindow: BrowserWindow | null = null;
let overlayPreferences: OverlayPreferences = { ...DEFAULT_PREFERENCES };
let clickThroughShortcutRegistered = false;
let pointerCaptureEnabled = true;

const getPreferencesPath = (): string =>
  path.join(app.getPath('userData'), 'overlay-preferences.json');

const readOverlayPreferences = (): OverlayPreferences => {
  try {
    const raw = fs.readFileSync(getPreferencesPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<OverlayPreferences>;
    return {
      x: Number.isFinite(parsed.x) ? parsed.x : undefined,
      y: Number.isFinite(parsed.y) ? parsed.y : undefined,
      clickThroughEnabled: parsed.clickThroughEnabled === true,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
};

const writeOverlayPreferences = (): void => {
  try {
    fs.writeFileSync(
      getPreferencesPath(),
      JSON.stringify(overlayPreferences, null, 2),
      'utf-8',
    );
  } catch {
    // Keep app stable even if disk write fails.
  }
};

const getOverlayState = (): OverlayState => ({
  clickThroughEnabled: overlayPreferences.clickThroughEnabled,
  shortcut: CLICK_THROUGH_SHORTCUT_LABEL,
  shortcutRegistered: clickThroughShortcutRegistered,
});

const emitOverlayState = (): void => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send('overlay:click-through-changed', getOverlayState());
};

const applyMouseIgnoreState = (): void => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const shouldIgnoreMouse =
    overlayPreferences.clickThroughEnabled || !pointerCaptureEnabled;
  mainWindow.setIgnoreMouseEvents(shouldIgnoreMouse, { forward: shouldIgnoreMouse });
};

const getCurrentDisplayId = (): number | null => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }

  const bounds = mainWindow.getBounds();
  const center = {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  };
  return screen.getDisplayNearestPoint(center).id;
};

const getDisplayInfos = (): DisplayInfo[] => {
  const currentId = getCurrentDisplayId();
  return screen.getAllDisplays().map((display) => ({
    id: display.id,
    name: display.label || `Display ${display.id}`,
    width: display.bounds.width,
    height: display.bounds.height,
    workAreaX: display.workArea.x,
    workAreaY: display.workArea.y,
    workAreaWidth: display.workArea.width,
    workAreaHeight: display.workArea.height,
    current: currentId === display.id,
  }));
};

const registerOverlayShortcut = (): boolean => {
  if (
    clickThroughShortcutRegistered ||
    globalShortcut.isRegistered(CLICK_THROUGH_TOGGLE_SHORTCUT)
  ) {
    clickThroughShortcutRegistered = true;
    return true;
  }

  clickThroughShortcutRegistered = globalShortcut.register(
    CLICK_THROUGH_TOGGLE_SHORTCUT,
    () => {
      applyClickThrough(!overlayPreferences.clickThroughEnabled);
    },
  );

  return clickThroughShortcutRegistered;
};

const applyClickThrough = (enabled: boolean): boolean => {
  if (enabled && !clickThroughShortcutRegistered) {
    registerOverlayShortcut();
  }

  const nextEnabled = enabled && clickThroughShortcutRegistered;
  overlayPreferences.clickThroughEnabled = nextEnabled;
  writeOverlayPreferences();

  if (!mainWindow || mainWindow.isDestroyed()) {
    return nextEnabled;
  }

  applyMouseIgnoreState();
  emitOverlayState();
  return nextEnabled;
};

const persistWindowPosition = (): void => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const { x, y } = mainWindow.getBounds();
  overlayPreferences.x = x;
  overlayPreferences.y = y;
  writeOverlayPreferences();
};

const clampWindowPosition = (): void => {
  if (!Number.isFinite(overlayPreferences.x) || !Number.isFinite(overlayPreferences.y)) {
    return;
  }

  const x = overlayPreferences.x as number;
  const y = overlayPreferences.y as number;
  const display = screen.getDisplayNearestPoint({ x, y });
  const { x: workX, y: workY, width: workWidth, height: workHeight } = display.workArea;
  const maxX = Math.max(workX, workX + workWidth - WINDOW_WIDTH);
  const maxY = Math.max(workY, workY + workHeight - WINDOW_HEIGHT);
  const nextX = Math.min(Math.max(x, workX), maxX);
  const nextY = Math.min(Math.max(y, workY), maxY);

  if (nextX !== x || nextY !== y) {
    overlayPreferences.x = nextX;
    overlayPreferences.y = nextY;
    writeOverlayPreferences();
  }
};

const clampBoundsToWorkArea = (
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number } => {
  const centerPoint = {
    x: Math.round(x + width / 2),
    y: Math.round(y + height / 2),
  };
  const display = screen.getDisplayNearestPoint(centerPoint);
  const { x: workX, y: workY, width: workWidth, height: workHeight } = display.workArea;
  const maxX = Math.max(workX, workX + workWidth - width);
  const maxY = Math.max(workY, workY + workHeight - height);
  return {
    x: Math.min(Math.max(x, workX), maxX),
    y: Math.min(Math.max(y, workY), maxY),
  };
};

const getDefaultWindowPosition = (): { x: number; y: number } => {
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  return {
    x: Math.round(x + width - WINDOW_WIDTH - WINDOW_EDGE_MARGIN_X),
    y: Math.round(y + height - WINDOW_HEIGHT - WINDOW_EDGE_MARGIN_Y),
  };
};

const resolveWindowIconPath = (): string => {
  const packagedIcoPath = path.join(process.resourcesPath, 'app.asar', 'source', 'exe_icon3.ico');
  const devIcoPath = path.join(app.getAppPath(), 'source', 'exe_icon3.ico');
  const devPngPath = path.join(app.getAppPath(), 'source', 'exe_icon3.png');

  if (app.isPackaged && fs.existsSync(packagedIcoPath)) {
    return packagedIcoPath;
  }
  if (fs.existsSync(devIcoPath)) {
    return devIcoPath;
  }
  return devPngPath;
};

const createWindow = () => {
  const defaultPosition = getDefaultWindowPosition();
  const iconPath = resolveWindowIconPath();
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
    x: overlayPreferences.x ?? defaultPosition.x,
    y: overlayPreferences.y ?? defaultPosition.y,
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('move', persistWindowPosition);
  mainWindow.on('close', persistWindowPosition);

  applyClickThrough(overlayPreferences.clickThroughEnabled);
};

const registerIpcHandlers = (): void => {
  ipcMain.handle('overlay:get-state', () => getOverlayState());

  ipcMain.handle('overlay:set-click-through', (_event, enabled: unknown) =>
    applyClickThrough(enabled === true),
  );

  ipcMain.handle('overlay:toggle-click-through', () =>
    applyClickThrough(!overlayPreferences.clickThroughEnabled),
  );

  ipcMain.handle('overlay:set-pointer-capture', (_event, enabled: unknown) => {
    pointerCaptureEnabled = enabled === true;
    applyMouseIgnoreState();
  });

  ipcMain.handle('overlay:move-window-by', (_event, rawPayload: unknown) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    const payload: WindowMovePayload =
      rawPayload && typeof rawPayload === 'object' ? (rawPayload as WindowMovePayload) : {};

    const deltaX = Number.isFinite(payload.deltaX) ? Math.round(Number(payload.deltaX)) : 0;
    const deltaY = Number.isFinite(payload.deltaY) ? Math.round(Number(payload.deltaY)) : 0;
    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    const currentBounds = mainWindow.getBounds();
    let nextX = currentBounds.x + deltaX;
    let nextY = currentBounds.y + deltaY;
    const hasAnchor =
      Number.isFinite(payload.anchorX) &&
      Number.isFinite(payload.anchorY) &&
      Number.isFinite(payload.anchorSize);
    const anchorX = hasAnchor ? Math.round(Number(payload.anchorX)) : 0;
    const anchorY = hasAnchor ? Math.round(Number(payload.anchorY)) : 0;
    const anchorSize = hasAnchor
      ? Math.max(16, Math.min(256, Math.round(Number(payload.anchorSize))))
      : 44;
    const lockToTaskbar = payload.lockToTaskbar === true;
    const safeAnchorY = Math.max(0, Math.min(anchorY, Math.max(0, currentBounds.height - anchorSize)));

    const displayPoint = hasAnchor
      ? {
          x: Math.round(nextX + anchorX + anchorSize / 2),
          y: Math.round(nextY + anchorY + anchorSize / 2),
        }
      : {
          x: Math.round(nextX + currentBounds.width / 2),
          y: Math.round(nextY + currentBounds.height / 2),
        };
    const display = screen.getDisplayNearestPoint(displayPoint);
    const { x: workX, y: workY, width: workWidth, height: workHeight } = display.workArea;

    if (hasAnchor) {
      if (lockToTaskbar) {
        const displays = screen.getAllDisplays();
        let globalMinX = Number.POSITIVE_INFINITY;
        let globalMaxX = Number.NEGATIVE_INFINITY;
        for (const item of displays) {
          const area = item.workArea;
          globalMinX = Math.min(globalMinX, area.x - anchorX);
          globalMaxX = Math.max(globalMaxX, area.x + area.width - anchorX - anchorSize);
        }

        if (Number.isFinite(globalMinX) && Number.isFinite(globalMaxX)) {
          nextX = Math.min(Math.max(nextX, globalMinX), globalMaxX);
        }

        const targetDisplay = screen.getDisplayNearestPoint({
          x: Math.round(nextX + anchorX + anchorSize / 2),
          y: Math.round(displayPoint.y),
        });
        const area = targetDisplay.workArea;
        nextY = area.y + area.height - anchorSize - WINDOW_EDGE_MARGIN_Y - safeAnchorY;
      } else {
        const minX = workX - anchorX;
        const maxX = workX + workWidth - anchorX - anchorSize;
        nextX = Math.min(Math.max(nextX, minX), maxX);
        const minY = workY - anchorY;
        const maxY = workY + workHeight - anchorY - anchorSize;
        nextY = Math.min(Math.max(nextY, minY), maxY);
      }
    } else {
      const next = clampBoundsToWorkArea(nextX, nextY, currentBounds.width, currentBounds.height);
      nextX = next.x;
      nextY = next.y;
    }

    mainWindow.setPosition(nextX, nextY);
    overlayPreferences.x = nextX;
    overlayPreferences.y = nextY;
    writeOverlayPreferences();
  });

  ipcMain.handle('overlay:get-displays', () => getDisplayInfos());

  ipcMain.handle('overlay:move-to-display', (_event, rawDisplayId: unknown) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return false;
    }

    const displayId = Number(rawDisplayId);
    if (!Number.isFinite(displayId)) {
      return false;
    }

    const target = screen.getAllDisplays().find((display) => display.id === displayId);
    if (!target) {
      return false;
    }

    const area = target.workArea;
    const nextX = Math.round(area.x + area.width - WINDOW_WIDTH - WINDOW_EDGE_MARGIN_X);
    const nextY = Math.round(area.y + area.height - WINDOW_HEIGHT - WINDOW_EDGE_MARGIN_Y);
    mainWindow.setPosition(nextX, nextY);
    overlayPreferences.x = nextX;
    overlayPreferences.y = nextY;
    writeOverlayPreferences();
    return true;
  });
};

app.on('ready', () => {
  app.setAppUserModelId(APP_USER_MODEL_ID);
  overlayPreferences = readOverlayPreferences();
  clampWindowPosition();
  registerIpcHandlers();
  registerOverlayShortcut();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('browser-window-focus', () => {
  const wasRegistered = clickThroughShortcutRegistered;
  registerOverlayShortcut();

  if (!clickThroughShortcutRegistered && overlayPreferences.clickThroughEnabled) {
    applyClickThrough(false);
    return;
  }

  if (wasRegistered !== clickThroughShortcutRegistered) {
    emitOverlayState();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
