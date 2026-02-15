import { promises as fs, constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rcedit } from 'rcedit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');
const icoPath = path.join(rootDir, 'source', 'exe_icon3.ico');
const exePath = path.join(rootDir, 'out', 'DesktopPetOverlay-win32-x64', 'DesktopPetOverlay.exe');

async function exists(filePath) {
  try {
    await fs.access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(exePath))) {
  console.log(`ICON_PATCH_SKIPPED ${exePath}`);
  process.exit(0);
}

await rcedit(exePath, { icon: icoPath });
console.log(`ICON_PATCHED ${exePath}`);
