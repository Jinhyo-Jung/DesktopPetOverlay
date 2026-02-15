import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pngToIco from 'png-to-ico';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');
const pngPath = path.join(rootDir, 'source', 'exe_icon3.png');
const icoPath = path.join(rootDir, 'source', 'exe_icon3.ico');

const iconBuffer = await pngToIco(pngPath);
await fs.writeFile(icoPath, iconBuffer);
console.log(`ICON_SYNCED ${icoPath}`);
