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

const DEFAULT_PREFERENCES: OverlayPreferences = {
  clickThroughEnabled: false,
};

const CLICK_THROUGH_TOGGLE_SHORTCUT = 'CommandOrControl+Shift+O';
const CLICK_THROUGH_SHORTCUT_LABEL = 'Ctrl+Shift+O';

let mainWindow: BrowserWindow | null = null;
let overlayPreferences: OverlayPreferences = { ...DEFAULT_PREFERENCES };

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

const applyClickThrough = (enabled: boolean): boolean => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return overlayPreferences.clickThroughEnabled;
  }

  overlayPreferences.clickThroughEnabled = enabled;
  mainWindow.setIgnoreMouseEvents(enabled, { forward: enabled });
  writeOverlayPreferences();
  mainWindow.webContents.send('overlay:click-through-changed', {
    clickThroughEnabled: enabled,
    shortcut: CLICK_THROUGH_SHORTCUT_LABEL,
  });
  return enabled;
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
  ipcMain.handle('overlay:get-state', () => ({
    clickThroughEnabled: overlayPreferences.clickThroughEnabled,
    shortcut: CLICK_THROUGH_SHORTCUT_LABEL,
  }));

  ipcMain.handle('overlay:set-click-through', (_event, enabled: unknown) =>
    applyClickThrough(enabled === true),
  );

  ipcMain.handle('overlay:toggle-click-through', () =>
    applyClickThrough(!overlayPreferences.clickThroughEnabled),
  );
};

const registerOverlayShortcut = (): void => {
  globalShortcut.register(CLICK_THROUGH_TOGGLE_SHORTCUT, () => {
    applyClickThrough(!overlayPreferences.clickThroughEnabled);
  });
};

app.on('ready', () => {
  overlayPreferences = readOverlayPreferences();
  registerIpcHandlers();
  createWindow();
  registerOverlayShortcut();
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

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
