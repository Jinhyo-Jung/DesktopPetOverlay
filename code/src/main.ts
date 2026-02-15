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
const APP_USER_MODEL_ID = 'com.jinhy.desktoppetoverlay';

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
  const nextX = display.workArea.x;
  const nextY = display.workArea.y;

  if (nextX !== x || nextY !== y) {
    overlayPreferences.x = nextX;
    overlayPreferences.y = nextY;
    writeOverlayPreferences();
  }
};

const getDefaultWindowPosition = (): { x: number; y: number } => {
  const display = screen.getPrimaryDisplay();
  const { x, y } = display.workArea;
  return {
    x,
    y,
  };
};

const getLaunchDisplay = (): Electron.Display => {
  if (Number.isFinite(overlayPreferences.x) && Number.isFinite(overlayPreferences.y)) {
    return screen.getDisplayNearestPoint({
      x: Math.round(overlayPreferences.x as number),
      y: Math.round(overlayPreferences.y as number),
    });
  }
  return screen.getPrimaryDisplay();
};

const resolveWindowIconPath = (): string => {
  const resourcesIcoPath = path.join(process.resourcesPath, 'source', 'exe_icon3.ico');
  const resourcesPngPath = path.join(process.resourcesPath, 'source', 'exe_icon3.png');
  const packagedIcoPath = path.join(process.resourcesPath, 'app.asar', 'source', 'exe_icon3.ico');
  const devIcoPath = path.join(app.getAppPath(), 'source', 'exe_icon3.ico');
  const devPngPath = path.join(app.getAppPath(), 'source', 'exe_icon3.png');

  if (app.isPackaged && fs.existsSync(resourcesIcoPath)) {
    return resourcesIcoPath;
  }
  if (app.isPackaged && fs.existsSync(resourcesPngPath)) {
    return resourcesPngPath;
  }
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
  const launchDisplay = getLaunchDisplay();
  const launchArea = launchDisplay.workArea;
  const iconPath = resolveWindowIconPath();
  mainWindow = new BrowserWindow({
    width: launchArea.width,
    height: launchArea.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
    x: Number.isFinite(overlayPreferences.x) ? (overlayPreferences.x as number) : defaultPosition.x,
    y: Number.isFinite(overlayPreferences.y) ? (overlayPreferences.y as number) : defaultPosition.y,
  });

  if (
    mainWindow.getBounds().width !== launchArea.width ||
    mainWindow.getBounds().height !== launchArea.height ||
    mainWindow.getBounds().x !== launchArea.x ||
    mainWindow.getBounds().y !== launchArea.y
  ) {
    mainWindow.setBounds({
      x: launchArea.x,
      y: launchArea.y,
      width: launchArea.width,
      height: launchArea.height,
    });
  }
  overlayPreferences.x = launchArea.x;
  overlayPreferences.y = launchArea.y;
  writeOverlayPreferences();

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

    // Backward compatibility: keep handler alive, but no-op.
    const _payload: WindowMovePayload =
      rawPayload && typeof rawPayload === 'object' ? (rawPayload as WindowMovePayload) : {};
    void _payload;
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
    mainWindow.setBounds({
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
    });
    overlayPreferences.x = area.x;
    overlayPreferences.y = area.y;
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
