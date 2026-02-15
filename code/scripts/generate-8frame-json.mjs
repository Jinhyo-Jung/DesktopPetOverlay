import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DEFAULT_FRAME_COUNT = 8;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = 'true';
    }
  }
  return args;
}

async function readPngSize(filePath) {
  const fileBuffer = await fs.readFile(filePath);
  if (!fileBuffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`PNG 파일이 아닙니다: ${filePath}`);
  }

  const width = fileBuffer.readUInt32BE(16);
  const height = fileBuffer.readUInt32BE(20);
  if (!width || !height) {
    throw new Error(`PNG 크기를 읽을 수 없습니다: ${filePath}`);
  }
  return { width, height };
}

function normalizePosixPath(filePath) {
  return filePath.split(path.sep).join(path.posix.sep);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const imageArg = args.image;

  if (!imageArg) {
    throw new Error(
      '사용법: node code/scripts/generate-8frame-json.mjs --image source/my_pet_sheet.png [--name my-pet] [--out source/pet_sprites/my_pet.json]'
    );
  }

  const imagePath = path.resolve(rootDir, imageArg);
  const imageRelativePath = normalizePosixPath(path.relative(rootDir, imagePath));
  const frameCount = Number(args.frames ?? DEFAULT_FRAME_COUNT);
  if (!Number.isFinite(frameCount) || frameCount < 2) {
    throw new Error(`frames 값이 올바르지 않습니다: ${args.frames}`);
  }

  const { width, height } = await readPngSize(imagePath);
  const frameWidth = Math.floor(width / frameCount);
  if (frameWidth <= 0) {
    throw new Error(`프레임 너비 계산 실패: width=${width}, frames=${frameCount}`);
  }

  const nameFromFile = path.basename(imagePath, path.extname(imagePath));
  const petName = args.name ?? nameFromFile;
  const outPath = path.resolve(rootDir, args.out ?? `source/pet_sprites/${nameFromFile}.json`);
  const outRelativePath = normalizePosixPath(path.relative(rootDir, outPath));

  const frames = Array.from({ length: frameCount }, (_, index) => ({
    x: index * frameWidth,
    y: 0,
    width: frameWidth,
    height,
  }));

  const config = {
    version: 1,
    name: petName,
    image: imageRelativePath,
    defaultFps: 8,
    hitAlphaThreshold: 24,
    frames,
    states: {
      idle: { frames: [0, 1, 2, 3, 4, 5, 6, 7].filter((index) => index < frameCount), fps: 4, loop: true },
      walk: { frames: [0, 1, 2, 3, 4, 5, 6, 7].filter((index) => index < frameCount), fps: 10, loop: true },
      jump: { frames: [2, 3, 4].filter((index) => index < frameCount), fps: 10, loop: false },
      fall: { frames: [5, 6].filter((index) => index < frameCount), fps: 10, loop: true },
      drag: { frames: [0], fps: 1, loop: true },
    },
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  const remainder = width % frameCount;
  if (remainder !== 0) {
    console.warn(
      `경고: 시트 너비(${width})가 ${frameCount}로 나누어떨어지지 않아 오른쪽 ${remainder}px가 제외되었습니다.`
    );
  }

  console.log(`SPRITE_JSON_GENERATED ${outRelativePath}`);
}

await main();
