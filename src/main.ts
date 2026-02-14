import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron';
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

const DEFAULT_PREFERENCES: OverlayPreferences = {
  clickThroughEnabled: false,
};

const CLICK_THROUGH_TOGGLE_SHORTCUT = 'CommandOrControl+Shift+O';
const CLICK_THROUGH_SHORTCUT_LABEL = 'Ctrl+Shift+O';

let mainWindow: BrowserWindow | null = null;
let overlayPreferences: OverlayPreferences = { ...DEFAULT_PREFERENCES };
let clickThroughShortcutRegistered = false;

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

  mainWindow.setIgnoreMouseEvents(nextEnabled, { forward: nextEnabled });
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

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 560,
    minWidth: 360,
    minHeight: 500,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
    x: overlayPreferences.x,
    y: overlayPreferences.y,
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
};

app.on('ready', () => {
  overlayPreferences = readOverlayPreferences();
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
