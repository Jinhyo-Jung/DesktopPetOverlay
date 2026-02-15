import './index.css';
import {
  CURRENT_SCHEMA_VERSION,
  TICK_INTERVAL_MS,
  applyAction,
  applyExpDelta,
  isActionEffective,
  loadState,
  persistSave,
  runTick,
  type PetState,
  type Stage,
} from './petState';
import {
  computeActivityExp,
  HEARTBEAT_MS,
  SAMPLE_INTERVAL_MS,
  type ActivityExpSnapshot,
  DAILY_ACTIVITY_EXP_CAP,
  FALLBACK_COOLDOWN_MS,
  grantActivityExp,
  grantFallbackExp,
  loadActivitySnapshot,
  persistActivitySnapshot,
  rolloverSnapshot,
  setActivityEnabled,
} from './activityExp';

interface OverlayState {
  clickThroughEnabled: boolean;
  shortcut: string;
  shortcutRegistered: boolean;
}

interface OverlayBridge {
  getState: () => Promise<OverlayState>;
  setClickThrough: (enabled: boolean) => Promise<boolean>;
  toggleClickThrough: () => Promise<boolean>;
  moveWindowBy: (payload: {
    deltaX: number;
    deltaY: number;
    anchorX?: number;
    anchorY?: number;
    anchorSize?: number;
    lockToTaskbar?: boolean;
  }) => Promise<void>;
  setPointerCapture: (enabled: boolean) => Promise<void>;
  getDisplays: () => Promise<DisplayInfo[]>;
  moveToDisplay: (displayId: number) => Promise<boolean>;
  onClickThroughChanged: (callback: (state: OverlayState) => void) => () => void;
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

declare global {
  interface Window {
    overlayBridge?: OverlayBridge;
  }
}

const STAGE_FACE_MAP: Record<Stage, string> = {
  Egg: '🐣',
  Baby: '🐥',
  Teen: '🐱',
  Adult: '🐈',
};

const STAGE_EXP_BASE: Record<Stage, number> = {
  Egg: 0,
  Baby: 30,
  Teen: 90,
  Adult: 180,
};

const STAGE_EXP_NEXT: Record<Stage, number> = {
  Egg: 30,
  Baby: 90,
  Teen: 180,
  Adult: 240,
};

const BUDDY_EMOJI_POOL = ['🐶', '🐰', '🦊', '🐼', '🐸', '🐵'];
const CHARACTER_STORAGE_KEY = 'desktop-pet-overlay-characters-v1';
const UI_PANEL_STORAGE_KEY = 'desktop-pet-overlay-ui-panel-visible-v1';
const UI_PANEL_POSITION_STORAGE_KEY = 'desktop-pet-overlay-ui-panel-position-v1';
const DRAG_THRESHOLD = 4;
const PET_NODE_SIZE = 88;
const MAIN_DEFAULT_MARGIN_X = 48;
const PET_GROUND_MARGIN_Y = 8;
const PET_GRAVITY = 1_550;
const PET_WALK_SPEED = 85;
const PET_JUMP_VELOCITY = -420;
const PET_INERTIA_DAMPING = 0.91;
const PET_MIN_VELOCITY = 8;
const PET_LANDING_MS = 150;
const PET_MAX_AIR_MS = 2_400;
const PET_SPRITE_CONFIG_CANDIDATES = [
  'source/pet_sprites/main_cat.json',
  './source/pet_sprites/main_cat.json',
  '../source/pet_sprites/main_cat.json',
  '../../source/pet_sprites/main_cat.json',
];

type StatKey = 'hunger' | 'happiness' | 'cleanliness' | 'health';

interface PlaygroundPet {
  id: string;
  kind: 'main' | 'buddy';
  emoji: string;
  x: number;
  y: number;
  spriteProfile?: string | null;
}

interface UiPanelPosition {
  x: number;
  y: number;
}

type PetVisualState = 'idle' | 'walk' | 'jump' | 'fall' | 'drag';

interface PetMotion {
  state: PetVisualState;
  vx: number;
  vy: number;
  dragging: boolean;
  landingUntil: number;
  nextDecisionAt: number;
  stateStartedAt: number;
}

interface PetSpriteConfig {
  version: number;
  name: string;
  image: string;
  frameWidth?: number;
  frameHeight?: number;
  frameCount?: number;
  frames?: SpriteFrameRect[];
  states?: Partial<Record<PetVisualState, SpriteStateConfig>>;
  defaultFps?: number;
  hitAlphaThreshold?: number;
}

interface SpriteFrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SpriteStateConfig {
  frames: number[];
  fps?: number;
  loop?: boolean;
}

interface SpriteStateRuntime {
  frames: number[];
  fps: number;
  loop: boolean;
}

interface SpriteProfile {
  key: string;
  imageUrl: string;
  image: HTMLImageElement;
  frames: SpriteFrameRect[];
  frameAlphaData: Array<ImageData | null>;
  states: Record<PetVisualState, SpriteStateRuntime>;
  hitAlphaThreshold: number;
}

const statKeys: StatKey[] = ['hunger', 'happiness', 'cleanliness', 'health'];

const statValueElements: Record<StatKey, HTMLElement> = {
  hunger: document.getElementById('hunger-value') as HTMLElement,
  happiness: document.getElementById('happiness-value') as HTMLElement,
  cleanliness: document.getElementById('cleanliness-value') as HTMLElement,
  health: document.getElementById('health-value') as HTMLElement,
};

const statFillElements: Record<StatKey, HTMLElement> = {
  hunger: document.getElementById('hunger-fill') as HTMLElement,
  happiness: document.getElementById('happiness-fill') as HTMLElement,
  cleanliness: document.getElementById('cleanliness-fill') as HTMLElement,
  health: document.getElementById('health-fill') as HTMLElement,
};

const faceElement = document.getElementById('pet-face') as HTMLElement;
const stageTextElement = document.getElementById('stage-text') as HTMLElement;
const warningTextElement = document.getElementById('warning-text') as HTMLElement;
const metaTextElement = document.getElementById('meta-text') as HTMLElement;
const expTextElement = document.getElementById('exp-text') as HTMLElement;
const expFillElement = document.getElementById('exp-fill') as HTMLElement;
const feedButton = document.getElementById('feed-btn') as HTMLButtonElement;
const cleanButton = document.getElementById('clean-btn') as HTMLButtonElement;
const playButton = document.getElementById('play-btn') as HTMLButtonElement;
const clickThroughToggleButton = document.getElementById(
  'click-through-toggle-btn',
) as HTMLButtonElement;
const clickThroughStatusElement = document.getElementById(
  'click-through-status',
) as HTMLElement;
const addCharacterButton = document.getElementById('add-character-btn') as HTMLButtonElement;
const removeCharacterButton = document.getElementById('remove-character-btn') as HTMLButtonElement;
const characterCountElement = document.getElementById('character-count') as HTMLElement;
const overlayHintElement = document.getElementById('overlay-hint') as HTMLElement;
const playgroundElement = document.getElementById('pet-playground') as HTMLElement;
const petCardElement = document.getElementById('pet-card') as HTMLElement;
const petUiPanelElement = document.getElementById('pet-ui-panel') as HTMLElement;
const panelDragHandleElement = document.getElementById('panel-drag-handle') as HTMLElement;
const settingsButton = document.getElementById('settings-btn') as HTMLButtonElement;
const displaySettingsPanel = document.getElementById('display-settings-panel') as HTMLElement;
const displaySelect = document.getElementById('display-select') as HTMLSelectElement;
const displayApplyButton = document.getElementById('display-apply-btn') as HTMLButtonElement;
const activityOptToggleButton = document.getElementById(
  'activity-opt-toggle-btn',
) as HTMLButtonElement;
const activityCheckinButton = document.getElementById(
  'activity-checkin-btn',
) as HTMLButtonElement;
const activityStatusElement = document.getElementById('activity-status') as HTMLElement;
const activityMetricsElement = document.getElementById('activity-metrics') as HTMLElement;
const helpButton = document.getElementById('help-btn') as HTMLButtonElement;
const helpPanelElement = document.getElementById('help-panel') as HTMLElement;

let state: PetState = loadState();
let clickThroughEnabled = false;
let clickThroughShortcut = 'Ctrl+Alt+Shift+O';
let clickThroughShortcutRegistered = true;
let playgroundPets: PlaygroundPet[] = loadPlaygroundPets();
let selectedPetId = playgroundPets[0]?.id ?? 'main';

let activitySnapshot: ActivityExpSnapshot = loadActivitySnapshot(new Date());
let sampleActiveSeconds = 0;
let sampleInputEvents = 0;
let sampleInputByType = createEmptyInputCounter();
let dailyActiveSeconds = 0;
let dailyInputByType = createEmptyInputCounter();
let showDetailedMetrics = false;
let uiPanelVisible = loadUiPanelVisible();
let uiPanelPosition: UiPanelPosition | null = loadUiPanelPosition();
let pointerCaptureState: boolean | null = null;
let dragLockCount = 0;
const petMotionMap = new Map<string, PetMotion>();
let liveLoopHandle = 0;
let liveLoopLastTs = 0;
let defaultMainSpriteProfile: SpriteProfile | null = null;
const spriteProfileMap = new Map<string, SpriteProfile>();
const petFrameIndexMap = new Map<string, number>();

const overlayBridge = window.overlayBridge;

type CountedInputEvent = 'keydown' | 'mousedown' | 'mousemove' | 'wheel' | 'touchstart';
type InputCounter = Record<CountedInputEvent, number>;

function createEmptyInputCounter(): InputCounter {
  return {
    keydown: 0,
    mousedown: 0,
    mousemove: 0,
    wheel: 0,
    touchstart: 0,
  };
}

function sumInputCounter(counter: InputCounter): number {
  return counter.keydown + counter.mousedown + counter.mousemove + counter.wheel + counter.touchstart;
}

function getCooldownRemainingMs(lastFallbackAt: string | null): number {
  if (!lastFallbackAt) {
    return 0;
  }

  const elapsed = Date.now() - Date.parse(lastFallbackAt);
  return Math.max(0, FALLBACK_COOLDOWN_MS - elapsed);
}

function getGroundY(): number {
  return Math.max(0, playgroundElement.clientHeight - PET_NODE_SIZE - PET_GROUND_MARGIN_Y);
}

function ensurePetMotion(petId: string): PetMotion {
  const existing = petMotionMap.get(petId);
  if (existing) {
    return existing;
  }
  const nowMs = performance.now();
  const created: PetMotion = {
    state: 'idle',
    vx: 0,
    vy: 0,
    dragging: false,
    landingUntil: 0,
    nextDecisionAt: nowMs + 2_000,
    stateStartedAt: nowMs,
  };
  petMotionMap.set(petId, created);
  return created;
}

function isAirborneState(stateName: PetVisualState): boolean {
  return stateName === 'jump' || stateName === 'fall';
}

function transitionMotionState(motion: PetMotion, nextState: PetVisualState, nowMs: number): void {
  if (motion.state === nextState) {
    return;
  }
  motion.state = nextState;
  motion.stateStartedAt = nowMs;
}

function parseSpriteConfig(raw: unknown): PetSpriteConfig | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const image = typeof record.image === 'string' ? record.image.trim() : '';
  if (!image) {
    return null;
  }

  const parseFiniteNumber = (value: unknown): number | null =>
    Number.isFinite(value) ? Number(value) : null;

  const parseFrameRect = (value: unknown): SpriteFrameRect | null => {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const item = value as Record<string, unknown>;
    const x = parseFiniteNumber(item.x);
    const y = parseFiniteNumber(item.y);
    const width = parseFiniteNumber(item.width);
    const height = parseFiniteNumber(item.height);
    if (x === null || y === null || width === null || height === null) {
      return null;
    }
    if (width <= 0 || height <= 0) {
      return null;
    }
    return {
      x: Math.max(0, Math.round(x)),
      y: Math.max(0, Math.round(y)),
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
    };
  };

  const parseStateConfig = (value: unknown): SpriteStateConfig | null => {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const item = value as Record<string, unknown>;
    if (!Array.isArray(item.frames)) {
      return null;
    }
    const frames = item.frames
      .map((frameIndex) => (Number.isFinite(frameIndex) ? Math.floor(Number(frameIndex)) : -1))
      .filter((frameIndex) => frameIndex >= 0);
    if (frames.length === 0) {
      return null;
    }
    return {
      frames,
      fps: Number.isFinite(item.fps) ? Math.max(1, Number(item.fps)) : undefined,
      loop: typeof item.loop === 'boolean' ? item.loop : undefined,
    };
  };

  let states: Partial<Record<PetVisualState, SpriteStateConfig>> | undefined;
  if (record.states && typeof record.states === 'object') {
    const parsedStates: Partial<Record<PetVisualState, SpriteStateConfig>> = {};
    for (const stateName of ['idle', 'walk', 'jump', 'fall', 'drag'] as PetVisualState[]) {
      const parsed = parseStateConfig((record.states as Record<string, unknown>)[stateName]);
      if (parsed) {
        parsedStates[stateName] = parsed;
      }
    }
    if (Object.keys(parsedStates).length > 0) {
      states = parsedStates;
    }
  }

  const parsedFrames = Array.isArray(record.frames)
    ? record.frames.map(parseFrameRect).filter((frame): frame is SpriteFrameRect => Boolean(frame))
    : undefined;

  const frameWidth = Number.isFinite(record.frameWidth)
    ? Math.max(1, Math.floor(Number(record.frameWidth)))
    : undefined;
  const frameHeight = Number.isFinite(record.frameHeight)
    ? Math.max(1, Math.floor(Number(record.frameHeight)))
    : undefined;
  const frameCount = Number.isFinite(record.frameCount)
    ? Math.max(1, Math.floor(Number(record.frameCount)))
    : undefined;

  return {
    version: Number.isFinite(record.version) ? Number(record.version) : 1,
    name: typeof record.name === 'string' ? record.name : 'main',
    image,
    frameWidth,
    frameHeight,
    frameCount,
    frames: parsedFrames,
    states,
    defaultFps: Number.isFinite(record.defaultFps) ? Math.max(1, Number(record.defaultFps)) : undefined,
    hitAlphaThreshold: Number.isFinite(record.hitAlphaThreshold)
      ? Math.max(1, Number(record.hitAlphaThreshold))
      : 12,
  };
}

async function fetchSpriteConfig(pathname: string): Promise<PetSpriteConfig | null> {
  try {
    const response = await fetch(pathname, { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }
    const json = (await response.json()) as unknown;
    return parseSpriteConfig(json);
  } catch {
    return null;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image-load-failed'));
    image.src = url;
  });
}

async function resolveSpriteImageUrl(config: PetSpriteConfig): Promise<string | null> {
  const candidates = [
    config.image,
    `./${config.image}`,
    `../${config.image}`,
    `../../${config.image}`,
  ];
  for (const candidate of candidates) {
    try {
      await loadImage(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

function buildFrameAlphaData(image: HTMLImageElement, frame: SpriteFrameRect): ImageData | null {
  if (frame.width <= 0 || frame.height <= 0) {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return null;
  }
  ctx.clearRect(0, 0, frame.width, frame.height);
  ctx.drawImage(
    image,
    frame.x,
    frame.y,
    frame.width,
    frame.height,
    0,
    0,
    frame.width,
    frame.height,
  );
  return ctx.getImageData(0, 0, frame.width, frame.height);
}

function resolveSpriteFrames(config: PetSpriteConfig, image: HTMLImageElement): SpriteFrameRect[] {
  const framesFromConfig = config.frames
    ?.map((frame) => ({
      x: Math.max(0, Math.min(image.naturalWidth - 1, frame.x)),
      y: Math.max(0, Math.min(image.naturalHeight - 1, frame.y)),
      width: Math.max(1, Math.min(image.naturalWidth, frame.width)),
      height: Math.max(1, Math.min(image.naturalHeight, frame.height)),
    }))
    .filter(
      (frame) =>
        frame.x + frame.width <= image.naturalWidth && frame.y + frame.height <= image.naturalHeight,
    );
  if (framesFromConfig && framesFromConfig.length > 0) {
    return framesFromConfig;
  }

  const frameWidth = config.frameWidth ?? image.naturalWidth;
  const frameHeight = config.frameHeight ?? image.naturalHeight;
  const maxColumns = Math.max(1, Math.floor(image.naturalWidth / frameWidth));
  const maxRows = Math.max(1, Math.floor(image.naturalHeight / frameHeight));
  const maxFrames = maxColumns * maxRows;
  const frameCount = Math.min(maxFrames, config.frameCount ?? maxFrames);
  const frames: SpriteFrameRect[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    const col = index % maxColumns;
    const row = Math.floor(index / maxColumns);
    frames.push({
      x: col * frameWidth,
      y: row * frameHeight,
      width: frameWidth,
      height: frameHeight,
    });
  }
  return frames.length > 0
    ? frames
    : [
        {
          x: 0,
          y: 0,
          width: image.naturalWidth,
          height: image.naturalHeight,
        },
      ];
}

function resolveSpriteStates(config: PetSpriteConfig, frameCount: number): Record<PetVisualState, SpriteStateRuntime> {
  const fallback: Record<PetVisualState, SpriteStateRuntime> = {
    idle: { frames: [0], fps: 2, loop: true },
    walk: { frames: [0], fps: 8, loop: true },
    jump: { frames: [0], fps: 10, loop: false },
    fall: { frames: [0], fps: 10, loop: true },
    drag: { frames: [0], fps: 6, loop: true },
  };
  const defaultFps = config.defaultFps ?? 8;
  for (const stateName of Object.keys(fallback) as PetVisualState[]) {
    const rawState = config.states?.[stateName];
    if (!rawState || rawState.frames.length === 0) {
      continue;
    }
    const frames = rawState.frames.filter(
      (frameIndex) => frameIndex >= 0 && frameIndex < frameCount,
    );
    if (frames.length === 0) {
      continue;
    }
    fallback[stateName] = {
      frames,
      fps: rawState.fps ?? defaultFps,
      loop: rawState.loop ?? fallback[stateName].loop,
    };
  }
  return fallback;
}

function createSpriteProfile(
  config: PetSpriteConfig,
  imageUrl: string,
  image: HTMLImageElement,
): SpriteProfile {
  const frames = resolveSpriteFrames(config, image);
  return {
    key: config.name,
    imageUrl,
    image,
    frames,
    frameAlphaData: frames.map((frame) => buildFrameAlphaData(image, frame)),
    states: resolveSpriteStates(config, frames.length),
    hitAlphaThreshold: config.hitAlphaThreshold ?? 12,
  };
}

function registerSpriteProfile(profile: SpriteProfile): void {
  spriteProfileMap.set(profile.key, profile);
}

function getSpriteProfileForPet(pet: PlaygroundPet): SpriteProfile | null {
  if (pet.spriteProfile) {
    const assigned = spriteProfileMap.get(pet.spriteProfile);
    if (assigned) {
      return assigned;
    }
  }
  if (pet.kind === 'main') {
    return defaultMainSpriteProfile;
  }
  return null;
}

async function initializeSpritePipeline(): Promise<void> {
  for (const candidate of PET_SPRITE_CONFIG_CANDIDATES) {
    const config = await fetchSpriteConfig(candidate);
    if (!config) {
      continue;
    }
    const resolved = await resolveSpriteImageUrl(config);
    if (!resolved) {
      continue;
    }
    const image = await loadImage(resolved);
    const profile = createSpriteProfile(config, resolved, image);
    registerSpriteProfile(profile);
    if (!defaultMainSpriteProfile) {
      defaultMainSpriteProfile = profile;
    }
  }
}

function loadUiPanelVisible(): boolean {
  return window.localStorage.getItem(UI_PANEL_STORAGE_KEY) === '1';
}

function loadUiPanelPosition(): UiPanelPosition | null {
  try {
    const raw = window.localStorage.getItem(UI_PANEL_POSITION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<UiPanelPosition>;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) {
      return null;
    }
    return {
      x: Math.round(Number(parsed.x)),
      y: Math.round(Number(parsed.y)),
    };
  } catch {
    return null;
  }
}

function persistUiPanelVisible(): void {
  window.localStorage.setItem(UI_PANEL_STORAGE_KEY, uiPanelVisible ? '1' : '0');
}

function persistUiPanelPosition(): void {
  if (!uiPanelPosition) {
    return;
  }
  window.localStorage.setItem(UI_PANEL_POSITION_STORAGE_KEY, JSON.stringify(uiPanelPosition));
}

function clampUiPanelPosition(position: UiPanelPosition): UiPanelPosition {
  const panelWidth = Math.max(280, petUiPanelElement.offsetWidth || 340);
  const panelHeight = Math.max(260, petUiPanelElement.offsetHeight || 420);
  const minX = 8;
  const minY = 8;
  const maxX = Math.max(minX, window.innerWidth - panelWidth - 8);
  const maxY = Math.max(minY, window.innerHeight - panelHeight - 8);
  return {
    x: Math.min(Math.max(position.x, minX), maxX),
    y: Math.min(Math.max(position.y, minY), maxY),
  };
}

function getDefaultUiPanelPosition(): UiPanelPosition {
  const panelWidth = Math.max(280, petUiPanelElement.offsetWidth || 340);
  const panelHeight = Math.max(260, petUiPanelElement.offsetHeight || 420);
  return {
    x: Math.round((window.innerWidth - panelWidth) / 2),
    y: Math.round(window.innerHeight - panelHeight - 10),
  };
}

function applyUiPanelPosition(): void {
  if (petUiPanelElement.classList.contains('hidden')) {
    return;
  }

  const next = clampUiPanelPosition(uiPanelPosition ?? getDefaultUiPanelPosition());
  uiPanelPosition = next;
  petUiPanelElement.style.left = `${next.x}px`;
  petUiPanelElement.style.top = `${next.y}px`;
  persistUiPanelPosition();
}

function setUiPanelVisible(visible: boolean): void {
  uiPanelVisible = visible;
  if (visible) {
    petUiPanelElement.classList.remove('hidden');
    petCardElement.classList.remove('compact');
    petCardElement.classList.add('expanded');
    requestAnimationFrame(() => applyUiPanelPosition());
  } else {
    displaySettingsPanel.classList.add('hidden');
    persistUiPanelPosition();
    petUiPanelElement.classList.add('hidden');
    petCardElement.classList.remove('expanded');
    petCardElement.classList.add('compact');
  }
  persistUiPanelVisible();
  syncPointerCaptureMode();
}

async function applyPointerCapture(enabled: boolean): Promise<void> {
  if (!overlayBridge || pointerCaptureState === enabled) {
    return;
  }
  pointerCaptureState = enabled;
  try {
    await overlayBridge.setPointerCapture(enabled);
  } catch {
    pointerCaptureState = null;
  }
}

function getPetById(petId: string): PlaygroundPet | null {
  return playgroundPets.find((pet) => pet.id === petId) ?? null;
}

function resolveAnimationFrameIndex(pet: PlaygroundPet, motion: PetMotion, nowMs: number): number {
  const profile = getSpriteProfileForPet(pet);
  if (!profile) {
    return 0;
  }
  const runtime = profile.states[motion.state];
  if (!runtime || runtime.frames.length === 0) {
    return 0;
  }
  const frameDuration = 1_000 / Math.max(1, runtime.fps);
  const elapsed = Math.max(0, nowMs - motion.stateStartedAt);
  const frameStep = Math.floor(elapsed / frameDuration);
  const frameOffset = runtime.loop
    ? frameStep % runtime.frames.length
    : Math.min(runtime.frames.length - 1, frameStep);
  return runtime.frames[frameOffset] ?? 0;
}

function drawSpriteFrame(node: HTMLButtonElement, pet: PlaygroundPet, motion: PetMotion, nowMs: number): void {
  const canvas = node.querySelector('canvas.pet-sprite-canvas') as HTMLCanvasElement | null;
  const profile = getSpriteProfileForPet(pet);
  if (!canvas || !profile) {
    return;
  }
  const frameIndex = resolveAnimationFrameIndex(pet, motion, nowMs);
  const frame = profile.frames[frameIndex] ?? profile.frames[0];
  if (!frame) {
    return;
  }

  petFrameIndexMap.set(pet.id, frameIndex);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    profile.image,
    frame.x,
    frame.y,
    frame.width,
    frame.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
}

function isPetOpaqueAt(node: HTMLElement, clientX: number, clientY: number): boolean {
  const petId = node.dataset.petId;
  if (!petId) {
    return true;
  }
  const pet = getPetById(petId);
  if (!pet) {
    return true;
  }
  const profile = getSpriteProfileForPet(pet);
  if (!profile) {
    return true;
  }

  const frameIndex = petFrameIndexMap.get(pet.id) ?? 0;
  const alphaData = profile.frameAlphaData[frameIndex] ?? profile.frameAlphaData[0];
  if (!alphaData) {
    return true;
  }

  const rect = node.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  if (localX < 0 || localY < 0 || localX >= rect.width || localY >= rect.height) {
    return false;
  }
  const px = Math.max(0, Math.min(alphaData.width - 1, Math.floor((localX / rect.width) * alphaData.width)));
  const py = Math.max(
    0,
    Math.min(alphaData.height - 1, Math.floor((localY / rect.height) * alphaData.height)),
  );
  const alphaIndex = (py * alphaData.width + px) * 4 + 3;
  const alpha = alphaData.data[alphaIndex] ?? 0;
  return alpha >= profile.hitAlphaThreshold;
}

function applyPetNodeVisual(node: HTMLButtonElement, pet: PlaygroundPet, nowMs: number = performance.now()): void {
  const motion = ensurePetMotion(pet.id);
  node.classList.toggle('selected', pet.id === selectedPetId);
  node.classList.toggle('state-idle', motion.state === 'idle');
  node.classList.toggle('state-walk', motion.state === 'walk');
  node.classList.toggle('state-jump', motion.state === 'jump');
  node.classList.toggle('state-fall', motion.state === 'fall');
  node.classList.toggle('state-drag', motion.state === 'drag');
  node.style.left = `${pet.x}px`;
  node.style.top = `${pet.y}px`;
  drawSpriteFrame(node, pet, motion, nowMs);
}

function shouldCapturePointerAt(clientX: number, clientY: number): boolean {
  if (clickThroughEnabled) {
    return false;
  }

  const target = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  if (!target) {
    return false;
  }

  const petNode = target.closest('.playground-pet') as HTMLElement | null;
  if (petNode && !isPetOpaqueAt(petNode, clientX, clientY)) {
    return false;
  }

  if (uiPanelVisible) {
    return Boolean(target.closest('#pet-ui-panel, .playground-pet'));
  }

  return Boolean(target.closest('.playground-pet'));
}

function beginDragLock(): void {
  dragLockCount += 1;
  void applyPointerCapture(true);
}

function endDragLock(): void {
  dragLockCount = Math.max(0, dragLockCount - 1);
  syncPointerCaptureMode();
}

function syncPointerCaptureMode(mouseEvent?: MouseEvent): void {
  if (!overlayBridge) {
    return;
  }

  if (clickThroughEnabled) {
    void applyPointerCapture(false);
    return;
  }

  if (dragLockCount > 0) {
    void applyPointerCapture(true);
    return;
  }

  if (!mouseEvent) {
    const hoveredSelector = uiPanelVisible
      ? '#pet-ui-panel:hover, .playground-pet:hover'
      : '.playground-pet:hover';
    const hovered = document.querySelector(hoveredSelector);
    void applyPointerCapture(Boolean(hovered));
    return;
  }

  void applyPointerCapture(shouldCapturePointerAt(mouseEvent.clientX, mouseEvent.clientY));
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remainSeconds = total % 60;
  return `${minutes}m ${String(remainSeconds).padStart(2, '0')}s`;
}

function updateActionButtons(nextState: PetState): void {
  feedButton.disabled = !isActionEffective(nextState, 'feed');
  cleanButton.disabled = !isActionEffective(nextState, 'clean');
  playButton.disabled = !isActionEffective(nextState, 'play');
}

function getDefaultMainPetPosition(): { x: number; y: number } {
  return {
    x: Math.max(8, window.innerWidth - PET_NODE_SIZE - MAIN_DEFAULT_MARGIN_X),
    y: Math.max(8, window.innerHeight - PET_NODE_SIZE - PET_GROUND_MARGIN_Y),
  };
}

function loadPlaygroundPets(): PlaygroundPet[] {
  try {
    const defaultMain = getDefaultMainPetPosition();
    const raw = window.localStorage.getItem(CHARACTER_STORAGE_KEY);
    if (!raw) {
      return [
        {
          id: 'main',
          kind: 'main',
          emoji: STAGE_FACE_MAP[state.stage],
          x: defaultMain.x,
          y: defaultMain.y,
          spriteProfile: 'main-cat',
        },
      ];
    }

    const parsed = JSON.parse(raw) as PlaygroundPet[];
    const sanitized = parsed
      .filter((pet) => pet && typeof pet.id === 'string' && pet.id.length > 0)
      .map((pet) => ({
        id: pet.id,
        kind: pet.kind === 'buddy' ? 'buddy' : 'main',
        emoji: typeof pet.emoji === 'string' && pet.emoji.length > 0 ? pet.emoji : '🐾',
        x: Number.isFinite(pet.x) ? pet.x : 0,
        y: Number.isFinite(pet.y) ? pet.y : 0,
        spriteProfile:
          typeof (pet as { spriteProfile?: unknown }).spriteProfile === 'string'
            ? (pet as { spriteProfile: string }).spriteProfile
            : pet.kind === 'main'
              ? 'main-cat'
              : null,
      }));

    const mainPet = sanitized.find((pet) => pet.kind === 'main');
    if (!mainPet) {
      sanitized.unshift({
        id: 'main',
        kind: 'main',
        emoji: STAGE_FACE_MAP[state.stage],
        x: defaultMain.x,
        y: defaultMain.y,
        spriteProfile: 'main-cat',
      });
    }
    return sanitized;
  } catch {
    const defaultMain = getDefaultMainPetPosition();
    return [
      {
        id: 'main',
        kind: 'main',
        emoji: STAGE_FACE_MAP[state.stage],
        x: defaultMain.x,
        y: defaultMain.y,
        spriteProfile: 'main-cat',
      },
    ];
  }
}

function persistPlaygroundPets(): void {
  window.localStorage.setItem(CHARACTER_STORAGE_KEY, JSON.stringify(playgroundPets));
}

function clampPetPosition(pet: PlaygroundPet): PlaygroundPet {
  const maxX = Math.max(0, playgroundElement.clientWidth - PET_NODE_SIZE);
  const maxY = Math.max(0, playgroundElement.clientHeight - PET_NODE_SIZE);
  return {
    ...pet,
    x: Math.max(0, Math.min(maxX, pet.x)),
    y: Math.max(0, Math.min(maxY, pet.y)),
  };
}

function realignPetPositionsForViewport(nowMs: number): void {
  const groundY = getGroundY();
  playgroundPets = playgroundPets.map((pet) => {
    const motion = ensurePetMotion(pet.id);
    const nextPet = clampPetPosition({ ...pet });
    if (motion.dragging) {
      return nextPet;
    }

    if (isAirborneState(motion.state)) {
      if (nextPet.y >= groundY) {
        nextPet.y = groundY;
        motion.vy = 0;
        motion.landingUntil = 0;
        transitionMotionState(motion, 'idle', nowMs);
      }
    } else {
      nextPet.y = groundY;
      motion.vy = 0;
    }

    if (pet.kind === 'main') {
      motion.nextDecisionAt = Math.min(motion.nextDecisionAt, nowMs + 500);
    }
    return nextPet;
  });
}

function stepPetMotion(deltaSec: number, nowMs: number): void {
  const groundY = getGroundY();
  playgroundPets = playgroundPets.map((pet) => {
    const motion = ensurePetMotion(pet.id);
    if (motion.dragging) {
      return pet;
    }

    let nextPet = { ...pet };
    const maxX = Math.max(0, playgroundElement.clientWidth - PET_NODE_SIZE);

    if (!isAirborneState(motion.state) && Math.abs(nextPet.y - groundY) > 0.5) {
      nextPet.y = groundY;
    }

    if (pet.kind === 'main') {
      if (motion.state === 'idle' && nowMs >= motion.nextDecisionAt) {
        transitionMotionState(motion, 'walk', nowMs);
        motion.vx = Math.random() > 0.5 ? PET_WALK_SPEED : -PET_WALK_SPEED;
        motion.nextDecisionAt = nowMs + 1_200 + Math.random() * 1_800;
      } else if (motion.state === 'walk' && nowMs >= motion.nextDecisionAt) {
        if (Math.random() < 0.35) {
          transitionMotionState(motion, 'jump', nowMs);
          motion.vx = motion.vx === 0 ? (Math.random() > 0.5 ? PET_WALK_SPEED : -PET_WALK_SPEED) : motion.vx;
          motion.vy = PET_JUMP_VELOCITY;
          motion.landingUntil = 0;
          motion.nextDecisionAt = nowMs + 1_100 + Math.random() * 700;
        } else {
          transitionMotionState(motion, 'idle', nowMs);
          motion.vx = 0;
          motion.nextDecisionAt = nowMs + 900 + Math.random() * 1_100;
        }
      }
    }

    if (motion.state === 'walk') {
      nextPet.x += motion.vx * deltaSec;
    }

    if (motion.state === 'jump' || motion.state === 'fall') {
      motion.vy += PET_GRAVITY * deltaSec;
      nextPet.x += motion.vx * deltaSec;
      nextPet.y += motion.vy * deltaSec;
      if (motion.vy > 0 && motion.state === 'jump') {
        transitionMotionState(motion, 'fall', nowMs);
      }
    }

    if (motion.state !== 'walk') {
      motion.vx *= PET_INERTIA_DAMPING;
    }
    if (Math.abs(motion.vx) < PET_MIN_VELOCITY && motion.state !== 'walk') {
      motion.vx = 0;
    }

    nextPet = clampPetPosition(nextPet);
    if (isAirborneState(motion.state) && nowMs - motion.stateStartedAt >= PET_MAX_AIR_MS) {
      nextPet.y = groundY;
      motion.vy = 0;
      transitionMotionState(motion, 'fall', nowMs);
      motion.landingUntil = nowMs + PET_LANDING_MS;
    }

    if (isAirborneState(motion.state) && nextPet.y >= groundY) {
      nextPet.y = groundY;
      motion.vy = 0;
      transitionMotionState(motion, 'fall', nowMs);
      if (motion.landingUntil <= 0) {
        motion.landingUntil = nowMs + PET_LANDING_MS;
      }
    }

    if (motion.state === 'fall' && motion.landingUntil > 0 && nowMs >= motion.landingUntil) {
      transitionMotionState(motion, 'idle', nowMs);
      motion.landingUntil = 0;
      motion.vx = 0;
      motion.nextDecisionAt = nowMs + 1_000 + Math.random() * 1_500;
    }

    if (motion.state === 'walk' && (nextPet.x <= 0 || nextPet.x >= maxX)) {
      motion.vx = motion.vx === 0 ? (nextPet.x <= 0 ? PET_WALK_SPEED : -PET_WALK_SPEED) : -motion.vx;
      nextPet.x = Math.max(0, Math.min(maxX, nextPet.x));
    }

    if (!isAirborneState(motion.state)) {
      nextPet.y = groundY;
      motion.vy = 0;
      motion.landingUntil = 0;
    }

    return nextPet;
  });

  for (const pet of playgroundPets) {
    const node = playgroundElement.querySelector(
      `.playground-pet[data-pet-id="${pet.id}"]`,
    ) as HTMLButtonElement | null;
    if (!node) {
      continue;
    }
    applyPetNodeVisual(node, pet, nowMs);
  }
}

function startLiveLoop(): void {
  const tick = (ts: number): void => {
    if (liveLoopLastTs === 0) {
      liveLoopLastTs = ts;
    }
    const deltaSec = Math.max(0, Math.min(0.05, (ts - liveLoopLastTs) / 1_000));
    liveLoopLastTs = ts;
    stepPetMotion(deltaSec, ts);
    liveLoopHandle = window.requestAnimationFrame(tick);
  };
  if (liveLoopHandle !== 0) {
    window.cancelAnimationFrame(liveLoopHandle);
  }
  liveLoopLastTs = 0;
  liveLoopHandle = window.requestAnimationFrame(tick);
}

function syncMainPetEmoji(): void {
  playgroundPets = playgroundPets.map((pet) =>
    pet.kind === 'main' ? { ...pet, emoji: STAGE_FACE_MAP[state.stage] } : pet,
  );
}

function renderPlayground(): void {
  syncMainPetEmoji();
  playgroundElement.replaceChildren();
  playgroundPets = playgroundPets.map(clampPetPosition);

  for (const pet of playgroundPets) {
    const motion = ensurePetMotion(pet.id);
    const spriteProfile = getSpriteProfileForPet(pet);
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `playground-pet ${pet.kind}`;
    node.dataset.petId = pet.id;
    node.title = pet.kind === 'main' ? '메인 캐릭터' : '보조 캐릭터';
    if (spriteProfile) {
      const canvas = document.createElement('canvas');
      canvas.className = 'pet-sprite-canvas';
      canvas.width = PET_NODE_SIZE;
      canvas.height = PET_NODE_SIZE;
      canvas.setAttribute('aria-hidden', 'true');
      node.appendChild(canvas);
    } else {
      node.textContent = pet.emoji;
    }
    applyPetNodeVisual(node, pet);

    node.addEventListener('pointerdown', (event: PointerEvent) => {
      if (clickThroughEnabled) {
        return;
      }
      if (!isPetOpaqueAt(node, event.clientX, event.clientY)) {
        return;
      }

      event.preventDefault();
      beginDragLock();
      motion.dragging = true;
      transitionMotionState(motion, 'drag', performance.now());
      if (node.setPointerCapture) {
        try {
          node.setPointerCapture(event.pointerId);
        } catch {
          // noop
        }
      }
      const currentPet = getPetById(pet.id) ?? pet;
      const startX = event.clientX;
      const startY = event.clientY;
      const originX = currentPet.x;
      const originY = currentPet.y;
      let moved = false;
      let velocityX = 0;
      let velocityY = 0;
      let previousX = startX;
      let previousY = startY;
      let previousTs = performance.now();
      node.classList.add('dragging');

      const onPointerMove = (moveEvent: PointerEvent): void => {
        const nowTs = performance.now();
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;
        const elapsed = Math.max(1, nowTs - previousTs) / 1_000;
        velocityX = (moveEvent.clientX - previousX) / elapsed;
        velocityY = (moveEvent.clientY - previousY) / elapsed;
        previousX = moveEvent.clientX;
        previousY = moveEvent.clientY;
        previousTs = nowTs;
        if (Math.abs(deltaX) >= DRAG_THRESHOLD || Math.abs(deltaY) >= DRAG_THRESHOLD) {
          moved = true;
        }

        const nextX = originX + deltaX;
        const nextY = originY + deltaY;
        const index = playgroundPets.findIndex((item) => item.id === pet.id);
        if (index >= 0) {
          playgroundPets[index] = clampPetPosition({ ...playgroundPets[index], x: nextX, y: nextY });
          applyPetNodeVisual(node, playgroundPets[index]);
        }
      };

      const onPointerUp = (): void => {
        window.removeEventListener('pointermove', onPointerMove);
        endDragLock();
        motion.dragging = false;
        node.classList.remove('dragging');
        if (!moved) {
          selectedPetId = pet.id;
          transitionMotionState(motion, 'idle', performance.now());
          motion.vx = 0;
          motion.vy = 0;
          if (pet.kind === 'main') {
            setUiPanelVisible(!uiPanelVisible);
            overlayHintElement.textContent = uiPanelVisible
              ? '메인 UI를 표시했습니다.'
              : '메인 UI를 숨겼습니다.';
          } else {
            overlayHintElement.textContent = '캐릭터 선택 완료';
          }
        } else {
          motion.vx = velocityX * 0.08;
          motion.vy = velocityY * 0.08;
          transitionMotionState(motion, motion.vy < 0 ? 'jump' : 'fall', performance.now());
          motion.landingUntil = 0;
          motion.nextDecisionAt = performance.now() + 1_200;
          overlayHintElement.textContent = '드래그 위치 저장 완료';
        }
        persistPlaygroundPets();
        applyPetNodeVisual(node, playgroundPets.find((item) => item.id === pet.id) ?? pet);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp, { once: true });
      window.addEventListener('pointercancel', onPointerUp, { once: true });
    });

    playgroundElement.appendChild(node);
  }

  const buddyCount = playgroundPets.filter((pet) => pet.kind === 'buddy').length;
  characterCountElement.textContent = `캐릭터 ${playgroundPets.length} (보조 ${buddyCount})`;
}

function updateClickThroughUI(): void {
  if (!clickThroughShortcutRegistered) {
    clickThroughToggleButton.textContent = 'Click-through: OFF';
    clickThroughStatusElement.textContent = `단축키(${clickThroughShortcut}) 등록 실패`;
    return;
  }

  clickThroughToggleButton.textContent = clickThroughEnabled
    ? 'Click-through: ON'
    : 'Click-through: OFF';
  clickThroughStatusElement.textContent = clickThroughEnabled
    ? `통과 중 · ${clickThroughShortcut}로 복구`
    : '입력 캡처 중';
}

function applyOverlayState(overlayState: OverlayState): void {
  clickThroughEnabled = overlayState.clickThroughEnabled;
  clickThroughShortcut = overlayState.shortcut;
  clickThroughShortcutRegistered = overlayState.shortcutRegistered;
  updateClickThroughUI();
  syncPointerCaptureMode();
}

async function refreshDisplayOptions(): Promise<void> {
  if (!overlayBridge) {
    return;
  }

  const displays = await overlayBridge.getDisplays();
  displaySelect.replaceChildren();
  for (const [index, display] of displays.entries()) {
    const option = document.createElement('option');
    option.value = String(display.id);
    option.textContent =
      `모니터 ${index + 1} · ${display.width}x${display.height}` +
      (display.current ? ' (현재)' : '');
    option.selected = display.current;
    displaySelect.appendChild(option);
  }
  displayApplyButton.disabled = displays.length === 0;
}

function updateActivityUI(): void {
  const previousDayKey = activitySnapshot.dayKey;
  activitySnapshot = rolloverSnapshot(activitySnapshot, new Date());
  if (previousDayKey !== activitySnapshot.dayKey) {
    dailyActiveSeconds = 0;
    dailyInputByType = createEmptyInputCounter();
  }

  activityOptToggleButton.textContent = activitySnapshot.enabled ? '활동 EXP: ON' : '활동 EXP: OFF';
  activityCheckinButton.disabled = false;
  activityCheckinButton.textContent = 'EXP 획득';

  const samplePreviewExp = computeActivityExp(sampleActiveSeconds, sampleInputEvents);
  const sampleInputTotal = sumInputCounter(sampleInputByType);
  const dailyInputTotal = sumInputCounter(dailyInputByType);
  activityStatusElement.textContent =
    `활동 EXP(자동) ${activitySnapshot.dailyActivityExp}/${DAILY_ACTIVITY_EXP_CAP} · ` +
    `EXP 획득(수동) ${activitySnapshot.dailyFallbackExp} · 샘플 예상 +${samplePreviewExp}`;

  if (showDetailedMetrics) {
    activityMetricsElement.textContent =
      `샘플 ${formatDuration(sampleActiveSeconds)} · 입력 ${sampleInputTotal}회 ` +
      `(key ${sampleInputByType.keydown}, down ${sampleInputByType.mousedown}, move ${sampleInputByType.mousemove}, wheel ${sampleInputByType.wheel}, touch ${sampleInputByType.touchstart}) · ` +
      `오늘 누적 ${formatDuration(dailyActiveSeconds)} / 입력 ${dailyInputTotal}회`;
  } else {
    activityMetricsElement.textContent =
      `EXP를 클릭하면 집계를 표시합니다. 현재 샘플: ${formatDuration(sampleActiveSeconds)}, 입력 ${sampleInputTotal}회`;
  }
}

function updateHelpPanel(): void {
  helpPanelElement.textContent =
    `- 메인 캐릭터 클릭: 설정 UI를 열고/닫습니다.\n` +
    `- 메인 캐릭터 드래그: 관성 이동이 적용되며, 드래그 종료 후 잠깐 자연스럽게 미끄러집니다.\n` +
    `- 클릭 경계: 스프라이트가 있는 캐릭터는 PNG 알파(투명도) 기준으로 클릭 영역을 판정합니다.\n` +
    `- 상태 머신: idle / walk / jump / fall / drag 상태로 전환되며 자동 움직임이 적용됩니다.\n` +
    `- 착지 연출: 하단 지면(작업영역 하단) 도달 시 fall -> idle 전환으로 착지 효과를 냅니다.\n` +
    `- 스프라이트 재생: 상태별 프레임 시퀀스를 JSON으로 정의해 멀티 프레임으로 재생합니다.\n` +
    `- 스탯 패널 상단 '패널 이동' 드래그: 모니터 해상도 범위 안에서 패널만 이동합니다.\n` +
    `- ⚙ 설정: 표시할 모니터를 선택해 캐릭터 위치를 전환합니다.\n` +
    `- ESC: 열린 설정 UI를 닫습니다.\n` +
    `- Feed / Clean / Play: 해당 능력치가 실제로 회복될 때만 EXP를 줍니다.\n` +
    `  (이미 100이라 변화가 없으면 EXP 없음)\n` +
    `- 스탯 감소는 앱 실행 중에만 진행됩니다. 앱 종료 시간은 감소에 반영하지 않습니다.\n` +
    `- 활동 EXP(자동): 5분 샘플마다 시간/입력 집계로 자동 획득됩니다.\n` +
    `- EXP 획득(수동): 5분 쿨다운마다 +2 EXP를 받습니다.\n` +
    `- EXP 숫자(예: 10 / 30) 클릭: 입력 이벤트별 집계와 누적 시간을 표시합니다.`;
}

function getStageExpProgress(exp: number, stage: Stage): { current: number; next: number; ratio: number } {
  const base = STAGE_EXP_BASE[stage];
  const next = STAGE_EXP_NEXT[stage];
  const current = Math.max(0, exp - base);
  const total = Math.max(1, next - base);
  const ratio = Math.max(0, Math.min(1, current / total));
  return { current, next, ratio };
}

function render(nextState: PetState): void {
  state = nextState;
  faceElement.textContent = STAGE_FACE_MAP[state.stage];
  stageTextElement.textContent = `Stage: ${state.stage}`;
  warningTextElement.textContent = state.warnings.join(' · ');

  const expProgress = getStageExpProgress(state.exp, state.stage);
  expTextElement.textContent = `${state.exp} / ${STAGE_EXP_NEXT[state.stage]}`;
  expFillElement.style.width = `${Math.round(expProgress.ratio * 100)}%`;

  metaTextElement.textContent =
    `EXP ${state.exp} · schema v${CURRENT_SCHEMA_VERSION} · ` +
    `feed ${state.actionCounts.feed} / clean ${state.actionCounts.clean} / play ${state.actionCounts.play} · ` +
    `activity-total ${activitySnapshot.totalGrantedExp}`;

  for (const key of statKeys) {
    const value = Math.round(state.stats[key]);
    statValueElements[key].textContent = String(value);
    statFillElements[key].style.width = `${value}%`;
  }

  updateActionButtons(state);
  renderPlayground();
  updateClickThroughUI();
  updateActivityUI();
}

function handleAction(action: 'feed' | 'clean' | 'play'): void {
  if (!isActionEffective(state, action)) {
    overlayHintElement.textContent = '현재 상태에서는 해당 액션으로 얻을 수 있는 보상이 없습니다.';
    return;
  }
  render(applyAction(state, action));
}

function addBuddy(): void {
  const buddyCount = playgroundPets.filter((pet) => pet.kind === 'buddy').length;
  if (buddyCount >= 8) {
    overlayHintElement.textContent = '보조 캐릭터는 최대 8개까지 추가할 수 있습니다.';
    return;
  }

  const emoji = BUDDY_EMOJI_POOL[buddyCount % BUDDY_EMOJI_POOL.length];
  const newBuddy: PlaygroundPet = {
    id: `buddy-${Date.now()}`,
    kind: 'buddy',
    emoji,
    x: 8 + (buddyCount * 20) % 220,
    y: 8 + (buddyCount * 18) % 72,
  };

  playgroundPets.push(clampPetPosition(newBuddy));
  selectedPetId = newBuddy.id;
  persistPlaygroundPets();
  overlayHintElement.textContent = '보조 캐릭터를 추가했습니다.';
  renderPlayground();
}

function removeBuddy(): void {
  const selectedBuddy = playgroundPets.find((pet) => pet.id === selectedPetId && pet.kind === 'buddy');
  if (selectedBuddy) {
    playgroundPets = playgroundPets.filter((pet) => pet.id !== selectedBuddy.id);
    petMotionMap.delete(selectedBuddy.id);
    petFrameIndexMap.delete(selectedBuddy.id);
  } else {
    const lastBuddy = [...playgroundPets].reverse().find((pet) => pet.kind === 'buddy');
    if (!lastBuddy) {
      overlayHintElement.textContent = '삭제할 보조 캐릭터가 없습니다.';
      return;
    }
    playgroundPets = playgroundPets.filter((pet) => pet.id !== lastBuddy.id);
    petMotionMap.delete(lastBuddy.id);
    petFrameIndexMap.delete(lastBuddy.id);
  }

  selectedPetId = 'main';
  persistPlaygroundPets();
  overlayHintElement.textContent = '보조 캐릭터를 제거했습니다.';
  renderPlayground();
}

function isActivityTimeCountable(): boolean {
  return activitySnapshot.enabled;
}

function handleActivitySample(now: Date): void {
  const sampledActiveSeconds = sampleActiveSeconds;
  const sampledInputEvents = sampleInputEvents;
  const sampledInputByType = { ...sampleInputByType };
  sampleActiveSeconds = 0;
  sampleInputEvents = 0;
  sampleInputByType = createEmptyInputCounter();

  dailyActiveSeconds += sampledActiveSeconds;
  dailyInputByType.keydown += sampledInputByType.keydown;
  dailyInputByType.mousedown += sampledInputByType.mousedown;
  dailyInputByType.mousemove += sampledInputByType.mousemove;
  dailyInputByType.wheel += sampledInputByType.wheel;
  dailyInputByType.touchstart += sampledInputByType.touchstart;

  const result = grantActivityExp(activitySnapshot, sampledActiveSeconds, sampledInputEvents, now);
  activitySnapshot = result.snapshot;
  persistActivitySnapshot(activitySnapshot);

  if (result.gainedExp > 0) {
    state = applyExpDelta(state, result.gainedExp);
    overlayHintElement.textContent = `활동 EXP +${result.gainedExp}`;
    render(state);
  } else {
    updateActivityUI();
  }
}

function bindActivitySignalEvents(): void {
  const countedEvents: CountedInputEvent[] = ['keydown', 'mousedown', 'mousemove', 'wheel', 'touchstart'];
  for (const eventName of countedEvents) {
    window.addEventListener(eventName, () => {
      if (activitySnapshot.enabled) {
        sampleInputEvents += 1;
        sampleInputByType[eventName] += 1;
      }
    });
  }
}

feedButton.addEventListener('click', () => handleAction('feed'));
cleanButton.addEventListener('click', () => handleAction('clean'));
playButton.addEventListener('click', () => handleAction('play'));
addCharacterButton.disabled = true;
removeCharacterButton.disabled = true;
addCharacterButton.addEventListener('click', addBuddy);
removeCharacterButton.addEventListener('click', removeBuddy);

panelDragHandleElement.addEventListener('pointerdown', (event: PointerEvent) => {
  if (clickThroughEnabled || !uiPanelVisible) {
    return;
  }

  event.preventDefault();
  beginDragLock();
  if (panelDragHandleElement.setPointerCapture) {
    try {
      panelDragHandleElement.setPointerCapture(event.pointerId);
    } catch {
      // noop
    }
  }
  const startX = event.clientX;
  const startY = event.clientY;
  const origin = clampUiPanelPosition(uiPanelPosition ?? getDefaultUiPanelPosition());
  let moved = false;

  const onPointerMove = (moveEvent: PointerEvent): void => {
    const deltaX = moveEvent.clientX - startX;
    const deltaY = moveEvent.clientY - startY;
    if (Math.abs(deltaX) >= DRAG_THRESHOLD || Math.abs(deltaY) >= DRAG_THRESHOLD) {
      moved = true;
    }
    uiPanelPosition = clampUiPanelPosition({
      x: origin.x + deltaX,
      y: origin.y + deltaY,
    });
    petUiPanelElement.style.left = `${uiPanelPosition.x}px`;
    petUiPanelElement.style.top = `${uiPanelPosition.y}px`;
  };

  const onPointerUp = (): void => {
    window.removeEventListener('pointermove', onPointerMove);
    endDragLock();
    if (moved) {
      persistUiPanelPosition();
      overlayHintElement.textContent = '스탯 패널 위치 이동 완료';
    }
  };

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp, { once: true });
  window.addEventListener('pointercancel', onPointerUp, { once: true });
});

settingsButton.addEventListener('click', async () => {
  displaySettingsPanel.classList.toggle('hidden');
  if (!displaySettingsPanel.classList.contains('hidden')) {
    try {
      await refreshDisplayOptions();
    } catch {
      overlayHintElement.textContent = '모니터 정보를 불러오지 못했습니다.';
    }
  }
});

displayApplyButton.addEventListener('click', async () => {
  if (!overlayBridge) {
    return;
  }

  const displayId = Number(displaySelect.value);
  if (!Number.isFinite(displayId)) {
    return;
  }

  const moved = await overlayBridge.moveToDisplay(displayId);
  if (moved) {
    realignPetPositionsForViewport(performance.now());
    renderPlayground();
    overlayHintElement.textContent = '선택한 모니터로 캐릭터를 이동했습니다.';
    await refreshDisplayOptions();
  } else {
    overlayHintElement.textContent = '모니터 이동에 실패했습니다.';
  }
});

clickThroughToggleButton.addEventListener('click', async () => {
  if (!overlayBridge) {
    return;
  }

  await overlayBridge.toggleClickThrough();
  try {
    applyOverlayState(await overlayBridge.getState());
    if (!clickThroughShortcutRegistered) {
      overlayHintElement.textContent =
        `단축키(${clickThroughShortcut}) 등록 실패로 클릭 통과를 활성화할 수 없습니다.`;
    }
  } catch {
    updateClickThroughUI();
  }
});

activityOptToggleButton.addEventListener('click', () => {
  activitySnapshot = setActivityEnabled(activitySnapshot, !activitySnapshot.enabled, new Date());
  if (!activitySnapshot.enabled) {
    sampleActiveSeconds = 0;
    sampleInputEvents = 0;
    sampleInputByType = createEmptyInputCounter();
  }
  persistActivitySnapshot(activitySnapshot);
  overlayHintElement.textContent = activitySnapshot.enabled
    ? '활동 EXP 수집을 다시 시작했습니다.'
    : '활동 EXP 수집을 중지했습니다.';
  updateActivityUI();
  render(state);
});

activityCheckinButton.addEventListener('click', () => {
  const result = grantFallbackExp(activitySnapshot, new Date());
  activitySnapshot = result.snapshot;
  persistActivitySnapshot(activitySnapshot);

  if (result.gainedExp > 0) {
    state = applyExpDelta(state, result.gainedExp);
    overlayHintElement.textContent = `EXP 획득 +${result.gainedExp}`;
    render(state);
    return;
  }

  if (result.reason === 'fallback-cooldown') {
    const remainingSeconds = Math.max(
      1,
      Math.ceil(getCooldownRemainingMs(activitySnapshot.lastFallbackAt) / 1_000),
    );
    overlayHintElement.textContent = `EXP 획득은 ${remainingSeconds}초 뒤에 다시 클릭할 수 있습니다.`;
  }
  updateActivityUI();
});

window.addEventListener('beforeunload', () => {
  if (liveLoopHandle !== 0) {
    window.cancelAnimationFrame(liveLoopHandle);
  }
  persistSave(state);
  persistPlaygroundPets();
  persistActivitySnapshot(activitySnapshot);
  persistUiPanelPosition();
});

window.addEventListener('resize', () => {
  realignPetPositionsForViewport(performance.now());
  renderPlayground();
  if (uiPanelVisible) {
    applyUiPanelPosition();
  }
});

setInterval(() => {
  render(runTick(state));
}, TICK_INTERVAL_MS);

setInterval(() => {
  if (isActivityTimeCountable()) {
    sampleActiveSeconds += HEARTBEAT_MS / 1_000;
  }
}, HEARTBEAT_MS);

setInterval(() => {
  handleActivitySample(new Date());
}, SAMPLE_INTERVAL_MS);

if (overlayBridge) {
  overlayBridge
    .getState()
    .then((overlayState) => applyOverlayState(overlayState))
    .catch(() => {
      updateClickThroughUI();
    });

  const unsubscribe = overlayBridge.onClickThroughChanged((overlayState) => {
    applyOverlayState(overlayState);
  });

  window.addEventListener('beforeunload', unsubscribe, { once: true });
} else {
  clickThroughToggleButton.disabled = true;
  clickThroughStatusElement.textContent = '브리지 없음';
}

expTextElement.addEventListener('click', () => {
  showDetailedMetrics = !showDetailedMetrics;
  updateActivityUI();
});

helpButton.addEventListener('click', () => {
  helpPanelElement.classList.toggle('hidden');
});

window.addEventListener('mousemove', (event: MouseEvent) => {
  syncPointerCaptureMode(event);
});

window.addEventListener('mouseenter', (event: MouseEvent) => {
  syncPointerCaptureMode(event);
});

window.addEventListener('mouseleave', () => {
  if (!clickThroughEnabled && dragLockCount === 0) {
    void applyPointerCapture(false);
  }
});

window.addEventListener('blur', () => {
  if (!clickThroughEnabled) {
    void applyPointerCapture(false);
  }
});

window.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || !uiPanelVisible) {
    return;
  }
  event.preventDefault();
  setUiPanelVisible(false);
  overlayHintElement.textContent = 'ESC로 메인 UI를 숨겼습니다.';
});

updateHelpPanel();
setUiPanelVisible(uiPanelVisible);
bindActivitySignalEvents();
render(state);
startLiveLoop();
void initializeSpritePipeline().then(() => {
  renderPlayground();
});
