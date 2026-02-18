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
  getLocalDayKey,
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
  sendPetChatPrompt: (prompt: string) => Promise<{ ok: boolean; text?: string; error?: string }>;
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

const STAGE_TRANSITION_MESSAGE: Record<Exclude<Stage, 'Egg'>, string> = {
  Baby: '진화 완료: Baby! 이제 작은 발걸음으로 세상을 배워가요.',
  Teen: '진화 완료: Teen! 자신감이 붙어서 모험심이 커졌어요.',
  Adult: '진화 완료: Adult! 믿음직한 성체로 완전히 성장했어요.',
};

const BUDDY_EMOJI_POOL = ['🐶', '🐰', '🦊', '🐼', '🐸', '🐵'];
const CHARACTER_STORAGE_KEY = 'desktop-pet-overlay-characters-v1';
const UI_PANEL_STORAGE_KEY = 'desktop-pet-overlay-ui-panel-visible-v1';
const UI_PANEL_POSITION_STORAGE_KEY = 'desktop-pet-overlay-ui-panel-position-v1';
const CHARACTER_SIZE_LEVEL_STORAGE_KEY = 'desktop-pet-overlay-character-size-level-v1';
const MAIN_MOTION_MODE_STORAGE_KEY = 'desktop-pet-overlay-main-motion-mode-v1';
const SAVE_STORAGE_KEY = 'desktop-pet-overlay-save';
const ACTIVITY_STORAGE_KEY = 'desktop-pet-overlay-activity-exp-v1';
const DAILY_REPORT_STORAGE_KEY = 'desktop-pet-overlay-daily-report-v1';
const CHAT_STATE_STORAGE_KEY = 'desktop-pet-overlay-chat-state-v1';
const DRAG_THRESHOLD = 4;
const PET_BASE_NODE_SIZE = 88;
const MAIN_DEFAULT_MARGIN_X = 48;
const PET_GROUND_MARGIN_Y = 8;
const PET_GRAVITY = 1_550;
const PET_WALK_SPEED = 85;
const PET_JUMP_VELOCITY = -420;
const PET_INERTIA_DAMPING = 0.91;
const PET_MIN_VELOCITY = 8;
const PET_LANDING_MS = 150;
const PET_MAX_AIR_MS = 2_400;
const CHARACTER_SIZE_LEVEL_MIN = 1;
const CHARACTER_SIZE_LEVEL_MAX = 10;
const CHARACTER_SCALE_MAX = 6;
const PET_SPRITE_CONFIG_CANDIDATES = [
  'source/pet_sprites/main_cat.json',
  './source/pet_sprites/main_cat.json',
  '../source/pet_sprites/main_cat.json',
  '../../source/pet_sprites/main_cat.json',
  '../../../source/pet_sprites/main_cat.json',
  '../../../../source/pet_sprites/main_cat.json',
];
const MAIN_STAGE_PROFILE_KEY_MAP: Record<Stage, string> = {
  Egg: 'main-cat-egg',
  Baby: 'main-cat-baby',
  Teen: 'main-cat-teen',
  Adult: 'main-cat-adult',
};
const HAPPY_IMAGE_SWITCH_MS = 5_000;
const IDLE_INACTIVE_THRESHOLD_MS = 45_000;
const INACTIVE_IMAGE_SWITCH_MS = 7_000;
const DIRTY_CLEANLINESS_THRESHOLD = 60;
const CHAT_OPEN_COOLDOWN_MS = 60_000;

type StatKey = 'hunger' | 'happiness' | 'cleanliness' | 'health';
type MainMotionMode = 'random' | 'fixed';
type MainEmotionMode = 'happy' | 'tired' | 'sleep' | 'neutral' | 'dirty';

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

interface DailyReport {
  dayKey: string;
  summary: string;
  createdAt: string;
  viewed: boolean;
}

interface ChatPersistedState {
  lastOpenedAt: number;
}

type ChatRole = 'user' | 'pet';

interface ChatMessage {
  role: ChatRole;
  text: string;
}

type PetVisualState = 'idle' | 'walk' | 'jump' | 'fall' | 'drag';

interface PetMotion {
  state: PetVisualState;
  vx: number;
  vy: number;
  facing: 1 | -1;
  dragging: boolean;
  landingUntil: number;
  nextDecisionAt: number;
  stateStartedAt: number;
  expressionFrameIndex: number | null;
  nextExpressionAt: number;
}

interface PetSpriteConfig {
  version: number;
  name: string;
  image?: string;
  frameImages?: SpriteFrameImageConfig[];
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

interface SpriteFrameImageConfig {
  id: string;
  image: string;
}

interface SpriteStateConfig {
  frames?: number[];
  emotions?: string[];
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
  imageUrls: string[];
  frameImages: HTMLImageElement[];
  frames: SpriteFrameRect[];
  frameAlphaData: Array<ImageData | null>;
  frameEmotionIds: Array<string | null>;
  states: Record<PetVisualState, SpriteStateRuntime>;
  hitAlphaThreshold: number;
  groundInsetRatio: number;
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
const characterSizeSlider = document.getElementById('character-size-slider') as HTMLInputElement;
const characterSizeValue = document.getElementById('character-size-value') as HTMLElement;
const mainMotionModeSelect = document.getElementById('main-motion-mode-select') as HTMLSelectElement;
const resetGrowthButton = document.getElementById('reset-growth-btn') as HTMLButtonElement;
const activityOptToggleButton = document.getElementById(
  'activity-opt-toggle-btn',
) as HTMLButtonElement;
const activityCheckinButton = document.getElementById(
  'activity-checkin-btn',
) as HTMLButtonElement;
const activityStatusElement = document.getElementById('activity-status') as HTMLElement;
const activityMetricsElement = document.getElementById('activity-metrics') as HTMLElement;
const helpButton = document.getElementById('help-btn') as HTMLButtonElement;
const reportButton = document.getElementById('report-btn') as HTMLButtonElement;
const helpPanelElement = document.getElementById('help-panel') as HTMLElement;
const chatOpenButton = document.getElementById('chat-open-btn') as HTMLButtonElement;
const chatStatusElement = document.getElementById('chat-status') as HTMLElement;
const chatBoxElement = document.getElementById('chat-box') as HTMLElement;
const chatLogElement = document.getElementById('chat-log') as HTMLElement;
const chatInputElement = document.getElementById('chat-input') as HTMLInputElement;
const chatSendButton = document.getElementById('chat-send-btn') as HTMLButtonElement;

let state: PetState = loadState();
let clickThroughEnabled = false;
let clickThroughShortcut = 'Ctrl+Alt+Shift+O';
let clickThroughShortcutRegistered = true;
let characterSizeLevel = loadCharacterSizeLevel();
let mainMotionMode = loadMainMotionMode();
let defaultMainSpriteProfile: SpriteProfile | null = null;
const spriteProfileMap = new Map<string, SpriteProfile>();
const petFrameIndexMap = new Map<string, number>();
let playgroundPets: PlaygroundPet[] = loadPlaygroundPets();
let selectedPetId = playgroundPets[0]?.id ?? 'main';

let activitySnapshot: ActivityExpSnapshot = loadActivitySnapshot(new Date());
let sampleActiveSeconds = 0;
let sampleInputEvents = 0;
let sampleInputByType = createEmptyInputCounter();
let dailyActiveSeconds = 0;
let dailyInputByType = createEmptyInputCounter();
let showDetailedMetrics = false;
let lastInteractionAtMs = Date.now();
let inactiveEmotionMode: Extract<MainEmotionMode, 'sleep' | 'neutral'> = 'neutral';
let nextInactiveEmotionSwitchAt = 0;
let activeEmotionFrameIndex: number | null = null;
let activeEmotionMode: MainEmotionMode | null = null;
let nextEmotionFrameSwitchAt = 0;
let mainAirborneFrameLockIndex: number | null = null;
let uiPanelVisible = loadUiPanelVisible();
let uiPanelPosition: UiPanelPosition | null = loadUiPanelPosition();
let pointerCaptureState: boolean | null = null;
let dragLockCount = 0;
const petMotionMap = new Map<string, PetMotion>();
let liveLoopHandle = 0;
let liveLoopLastTs = 0;
let pendingDailyReport: DailyReport | null = loadPendingDailyReport();
const chatState: ChatPersistedState = loadChatPersistedState();
let chatVisible = false;
let chatClosedByTurnLimit = false;
let chatSessionMaxTurns = 0;
let chatSessionUsedTurns = 0;
let chatMessages: ChatMessage[] = [];

const overlayBridge = window.overlayBridge;

type CountedInputEvent = 'keydown' | 'mousedown' | 'mousemove' | 'wheel' | 'touchstart';
type InputCounter = Record<CountedInputEvent, number>;

function markUserInteraction(nowMs: number = Date.now()): void {
  lastInteractionAtMs = nowMs;
  inactiveEmotionMode = 'neutral';
  nextInactiveEmotionSwitchAt = 0;
}

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

function loadPendingDailyReport(): DailyReport | null {
  try {
    const raw = window.localStorage.getItem(DAILY_REPORT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<DailyReport>;
    if (
      typeof parsed.dayKey !== 'string' ||
      typeof parsed.summary !== 'string' ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.viewed !== 'boolean'
    ) {
      return null;
    }
    return {
      dayKey: parsed.dayKey,
      summary: parsed.summary,
      createdAt: parsed.createdAt,
      viewed: parsed.viewed,
    };
  } catch {
    return null;
  }
}

function persistPendingDailyReport(report: DailyReport | null): void {
  if (!report) {
    window.localStorage.removeItem(DAILY_REPORT_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(DAILY_REPORT_STORAGE_KEY, JSON.stringify(report));
}

function loadChatPersistedState(): ChatPersistedState {
  try {
    const raw = window.localStorage.getItem(CHAT_STATE_STORAGE_KEY);
    if (!raw) {
      return { lastOpenedAt: 0 };
    }
    const parsed = JSON.parse(raw) as Partial<ChatPersistedState>;
    if (!Number.isFinite(parsed.lastOpenedAt)) {
      return { lastOpenedAt: 0 };
    }
    return { lastOpenedAt: Math.max(0, Number(parsed.lastOpenedAt)) };
  } catch {
    return { lastOpenedAt: 0 };
  }
}

function persistChatPersistedState(): void {
  window.localStorage.setItem(CHAT_STATE_STORAGE_KEY, JSON.stringify(chatState));
}

function getDailyReportText(): string {
  const now = new Date();
  const dayKey = getLocalDayKey(now);
  const averageStat =
    (state.stats.hunger + state.stats.happiness + state.stats.cleanliness + state.stats.health) / 4;
  const effortScore = state.actionCounts.feed + state.actionCounts.clean + state.actionCounts.play;
  const encouragement =
    averageStat >= 80
      ? '오늘은 안정적으로 잘 돌봤어요. 이 흐름을 그대로 유지해봐요.'
      : averageStat >= 60
        ? '조금만 더 관리하면 컨디션이 더 좋아질 수 있어요.'
        : '내일은 Feed/Clean/Play를 더 자주 눌러서 회복에 집중해봐요.';
  return (
    `[${dayKey}] Stage ${state.stage} · EXP ${state.exp}\n` +
    `스탯 평균 ${Math.round(averageStat)}점 · 행동 ${effortScore}회\n` +
    `활동 EXP 자동 ${activitySnapshot.dailyActivityExp}, 수동 ${activitySnapshot.dailyFallbackExp}\n` +
    encouragement
  );
}

function updateReportButtonVisibility(): void {
  const hasPending = Boolean(pendingDailyReport && !pendingDailyReport.viewed);
  reportButton.classList.toggle('hidden', !hasPending);
}

function openPendingReport(): void {
  if (!pendingDailyReport || pendingDailyReport.viewed) {
    updateReportButtonVisibility();
    return;
  }
  window.alert(pendingDailyReport.summary);
  pendingDailyReport = { ...pendingDailyReport, viewed: true };
  persistPendingDailyReport(pendingDailyReport);
  updateReportButtonVisibility();
}

function getChatOpenRemainingMs(nowMs: number = Date.now()): number {
  const elapsed = nowMs - chatState.lastOpenedAt;
  return Math.max(0, CHAT_OPEN_COOLDOWN_MS - elapsed);
}

function renderChatLog(): void {
  chatLogElement.replaceChildren();
  for (const message of chatMessages) {
    const line = document.createElement('p');
    line.className = `chat-log-line ${message.role}`;
    line.textContent = message.role === 'user' ? `나: ${message.text}` : `펫: ${message.text}`;
    chatLogElement.appendChild(line);
  }
  chatLogElement.scrollTop = chatLogElement.scrollHeight;
}

function updateChatUI(): void {
  const remainingMs = getChatOpenRemainingMs();
  if (!chatVisible) {
    chatBoxElement.classList.add('hidden');
    if (remainingMs > 0) {
      chatOpenButton.disabled = true;
      chatStatusElement.textContent = `대화 재오픈 ${Math.ceil(remainingMs / 1_000)}초`;
    } else if (chatClosedByTurnLimit) {
      chatOpenButton.disabled = false;
      chatStatusElement.textContent = '세션 종료. 다시 대화하기를 눌러주세요.';
    } else {
      chatOpenButton.disabled = false;
      chatStatusElement.textContent = '대화창 닫힘';
    }
    chatSendButton.disabled = true;
    chatInputElement.disabled = true;
    return;
  }

  chatBoxElement.classList.remove('hidden');
  const remainTurns = Math.max(0, chatSessionMaxTurns - chatSessionUsedTurns);
  chatStatusElement.textContent = `남은 응답 ${remainTurns}회`;
  const disabled = remainTurns <= 0;
  chatSendButton.disabled = disabled;
  chatInputElement.disabled = disabled;
}

function closeChatSession(limitReached: boolean): void {
  chatVisible = false;
  chatClosedByTurnLimit = limitReached;
  chatInputElement.value = '';
  updateChatUI();
}

function openChatSession(): void {
  if (getChatOpenRemainingMs() > 0) {
    updateChatUI();
    return;
  }
  chatVisible = true;
  chatClosedByTurnLimit = false;
  chatSessionMaxTurns = 3 + Math.floor(Math.random() * 3);
  chatSessionUsedTurns = 0;
  chatMessages = [{ role: 'pet', text: '안녕! 오늘 컨디션 기준으로 짧게 대화해볼까?' }];
  chatState.lastOpenedAt = Date.now();
  persistChatPersistedState();
  renderChatLog();
  updateChatUI();
  chatInputElement.focus();
}

function buildChatPrompt(userText: string): string {
  const recentDialog = chatMessages
    .slice(-6)
    .map((message) => `${message.role === 'user' ? 'User' : 'Pet'}: ${message.text}`)
    .join('\n');
  return [
    '너는 DesktopPetOverlay의 펫 캐릭터다.',
    '답변은 한국어로, 1~2문장, 부드럽고 짧게 작성한다.',
    '게임 규칙: Feed/Clean/Play 액션, 활동 EXP 자동/수동 획득, 스탯은 hunger/happiness/cleanliness/health.',
    `현재 상태: Stage=${state.stage}, EXP=${state.exp}, hunger=${Math.round(state.stats.hunger)}, happiness=${Math.round(state.stats.happiness)}, cleanliness=${Math.round(state.stats.cleanliness)}, health=${Math.round(state.stats.health)}.`,
    `행동 횟수: feed=${state.actionCounts.feed}, clean=${state.actionCounts.clean}, play=${state.actionCounts.play}.`,
    '다음 사용자 메시지에 대해, 게임 맥락을 반영해 자연스럽게 응답하라.',
    `대화 기록:\n${recentDialog}`,
    `사용자 입력: ${userText}`,
  ].join('\n');
}

async function sendChatMessage(): Promise<void> {
  const input = chatInputElement.value.trim();
  if (!chatVisible || !input || chatSessionUsedTurns >= chatSessionMaxTurns) {
    return;
  }
  chatInputElement.value = '';
  chatMessages.push({ role: 'user', text: input });
  renderChatLog();
  updateChatUI();

  if (!overlayBridge) {
    chatMessages.push({ role: 'pet', text: '브리지를 찾지 못해서 지금은 대답할 수 없어요.' });
    renderChatLog();
    closeChatSession(true);
    return;
  }

  chatSendButton.disabled = true;
  try {
    const response = await overlayBridge.sendPetChatPrompt(buildChatPrompt(input));
    const answer =
      response.ok && response.text
        ? response.text
        : '지금은 생각이 끊겼어. 잠시 뒤에 다시 열어서 말 걸어줘.';
    chatMessages.push({ role: 'pet', text: answer });
  } catch {
    chatMessages.push({ role: 'pet', text: '네트워크가 불안정해서 답을 못 했어.' });
  }
  chatSessionUsedTurns += 1;
  renderChatLog();
  if (chatSessionUsedTurns >= chatSessionMaxTurns) {
    chatMessages.push({ role: 'pet', text: '오늘 대화는 여기까지! 1분 뒤에 다시 열 수 있어.' });
    renderChatLog();
    closeChatSession(true);
    return;
  }
  updateChatUI();
}

function clampCharacterSizeLevel(level: number): number {
  return Math.min(CHARACTER_SIZE_LEVEL_MAX, Math.max(CHARACTER_SIZE_LEVEL_MIN, Math.round(level)));
}

function loadCharacterSizeLevel(): number {
  const raw = window.localStorage.getItem(CHARACTER_SIZE_LEVEL_STORAGE_KEY);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return CHARACTER_SIZE_LEVEL_MIN;
  }
  return clampCharacterSizeLevel(parsed);
}

function persistCharacterSizeLevel(): void {
  window.localStorage.setItem(CHARACTER_SIZE_LEVEL_STORAGE_KEY, String(characterSizeLevel));
}

function getCharacterScale(level: number = characterSizeLevel): number {
  const normalized =
    (clampCharacterSizeLevel(level) - CHARACTER_SIZE_LEVEL_MIN) /
    Math.max(1, CHARACTER_SIZE_LEVEL_MAX - CHARACTER_SIZE_LEVEL_MIN);
  return 1 + normalized * (CHARACTER_SCALE_MAX - 1);
}

function getCurrentPetSize(): number {
  return Math.max(24, Math.round(PET_BASE_NODE_SIZE * getCharacterScale()));
}

function loadMainMotionMode(): MainMotionMode {
  const raw = window.localStorage.getItem(MAIN_MOTION_MODE_STORAGE_KEY);
  return raw === 'fixed' ? 'fixed' : 'random';
}

function persistMainMotionMode(): void {
  window.localStorage.setItem(MAIN_MOTION_MODE_STORAGE_KEY, mainMotionMode);
}

function isMainMotionRandom(): boolean {
  return mainMotionMode === 'random';
}

function updateCharacterSettingsUI(): void {
  characterSizeSlider.value = String(characterSizeLevel);
  characterSizeValue.textContent = `${characterSizeLevel} (x${getCharacterScale().toFixed(2)})`;
  mainMotionModeSelect.value = mainMotionMode;
}

function getPetGroundInsetPx(pet: PlaygroundPet, petSize: number = getCurrentPetSize()): number {
  const profile = getSpriteProfileForPet(pet);
  if (!profile) {
    return 0;
  }
  return Math.round(petSize * profile.groundInsetRatio);
}

function getGroundYForPet(pet: PlaygroundPet, petSize: number = getCurrentPetSize()): number {
  const insetPx = getPetGroundInsetPx(pet, petSize);
  return Math.max(0, playgroundElement.clientHeight - petSize - PET_GROUND_MARGIN_Y + insetPx);
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
    facing: 1,
    dragging: false,
    landingUntil: 0,
    nextDecisionAt: nowMs + 2_000,
    stateStartedAt: nowMs,
    expressionFrameIndex: null,
    nextExpressionAt: nowMs + 800 + Math.random() * 1_400,
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
  const image = typeof record.image === 'string' ? record.image.trim() : undefined;

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
    const frames = Array.isArray(item.frames)
      ? item.frames
          .map((frameIndex) => (Number.isFinite(frameIndex) ? Math.floor(Number(frameIndex)) : -1))
          .filter((frameIndex) => frameIndex >= 0)
      : [];
    const emotions = Array.isArray(item.emotions)
      ? item.emotions
          .map((emotion) => (typeof emotion === 'string' ? emotion.trim() : ''))
          .filter((emotion) => emotion.length > 0)
      : [];
    if (frames.length === 0 && emotions.length === 0) {
      return null;
    }
    return {
      frames: frames.length > 0 ? frames : undefined,
      emotions: emotions.length > 0 ? emotions : undefined,
      fps: Number.isFinite(item.fps) ? Math.max(1, Number(item.fps)) : undefined,
      loop: typeof item.loop === 'boolean' ? item.loop : undefined,
    };
  };

  const parseFrameImageConfig = (value: unknown): SpriteFrameImageConfig | null => {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const item = value as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const frameImage = typeof item.image === 'string' ? item.image.trim() : '';
    if (!id || !frameImage) {
      return null;
    }
    return {
      id,
      image: frameImage,
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
  const parsedFrameImages = Array.isArray(record.frameImages)
    ? record.frameImages
        .map(parseFrameImageConfig)
        .filter((item): item is SpriteFrameImageConfig => Boolean(item))
    : undefined;

  if (!image && (!parsedFrameImages || parsedFrameImages.length === 0)) {
    return null;
  }

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
    frameImages: parsedFrameImages,
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

async function resolveAssetUrl(assetPath: string): Promise<string | null> {
  const candidates = [
    assetPath,
    `./${assetPath}`,
    `../${assetPath}`,
    `../../${assetPath}`,
    `../../../${assetPath}`,
    `../../../../${assetPath}`,
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

function resolveSpriteStates(
  config: PetSpriteConfig,
  frameCount: number,
  emotionFrameMap?: Map<string, number>,
): Record<PetVisualState, SpriteStateRuntime> {
  const resolveEmotionFrameWithFallback = (emotionId: string): number | null => {
    if (!emotionFrameMap) {
      return null;
    }
    const exact = emotionFrameMap.get(emotionId);
    if (Number.isFinite(exact)) {
      return exact as number;
    }
    const baseEmotionId = emotionId.replace(/_\d+$/, '');
    if (baseEmotionId === emotionId) {
      return null;
    }
    const base = emotionFrameMap.get(baseEmotionId);
    return Number.isFinite(base) ? (base as number) : null;
  };

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
    if (!rawState) {
      continue;
    }

    const directFrames = (rawState.frames ?? []).filter(
      (frameIndex) => frameIndex >= 0 && frameIndex < frameCount,
    );
    const emotionFrames =
      emotionFrameMap && rawState.emotions
        ? rawState.emotions
            .map(resolveEmotionFrameWithFallback)
            .filter((frameIndex): frameIndex is number => Number.isFinite(frameIndex))
        : [];
    const frames = directFrames.length > 0 ? directFrames : emotionFrames;
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

function estimateGroundInsetRatio(
  frameAlphaData: Array<ImageData | null>,
  hitAlphaThreshold: number,
): number {
  const ratios: number[] = [];
  for (const alphaData of frameAlphaData) {
    if (!alphaData) {
      continue;
    }
    let bottomOpaqueY = -1;
    for (let y = alphaData.height - 1; y >= 0; y -= 1) {
      let found = false;
      for (let x = 0; x < alphaData.width; x += 1) {
        const alphaIndex = (y * alphaData.width + x) * 4 + 3;
        if ((alphaData.data[alphaIndex] ?? 0) >= hitAlphaThreshold) {
          bottomOpaqueY = y;
          found = true;
          break;
        }
      }
      if (found) {
        break;
      }
    }
    if (bottomOpaqueY >= 0) {
      const insetPx = Math.max(0, alphaData.height - 1 - bottomOpaqueY);
      ratios.push(insetPx / Math.max(1, alphaData.height));
    }
  }
  if (ratios.length === 0) {
    return 0;
  }
  ratios.sort((a, b) => a - b);
  const median = ratios[Math.floor(ratios.length / 2)] ?? 0;
  return Math.max(0, Math.min(0.35, median));
}

interface ResolvedFrameImage {
  id: string;
  url: string;
  image: HTMLImageElement;
}

function createSpriteProfile(
  config: PetSpriteConfig,
  atlas: { imageUrl: string; image: HTMLImageElement } | null,
  frameImages: ResolvedFrameImage[],
): SpriteProfile {
  const frames =
    frameImages.length > 0
      ? frameImages.map((frameImage) => ({
          x: 0,
          y: 0,
          width: frameImage.image.naturalWidth,
          height: frameImage.image.naturalHeight,
        }))
      : resolveSpriteFrames(config, atlas?.image as HTMLImageElement);
  const frameSources =
    frameImages.length > 0 ? frameImages.map((frameImage) => frameImage.image) : frames.map(() => atlas?.image as HTMLImageElement);
  const frameEmotionIds =
    frameImages.length > 0 ? frameImages.map((frameImage) => frameImage.id) : frames.map(() => null);
  const hitAlphaThreshold = config.hitAlphaThreshold ?? 12;
  const frameAlphaData = frames.map((frame, index) => buildFrameAlphaData(frameSources[index], frame));
  const emotionFrameMap = new Map<string, number>();
  frameEmotionIds.forEach((emotionId, index) => {
    if (emotionId && !emotionFrameMap.has(emotionId)) {
      emotionFrameMap.set(emotionId, index);
    }
  });

  return {
    key: config.name,
    imageUrls: frameImages.length > 0 ? frameImages.map((frameImage) => frameImage.url) : [atlas?.imageUrl ?? ''],
    frameImages: frameSources,
    frames,
    frameAlphaData,
    frameEmotionIds,
    states: resolveSpriteStates(
      config,
      frames.length,
      emotionFrameMap.size > 0 ? emotionFrameMap : undefined,
    ),
    hitAlphaThreshold,
    groundInsetRatio: estimateGroundInsetRatio(frameAlphaData, hitAlphaThreshold),
  };
}

function registerSpriteProfile(profile: SpriteProfile): void {
  spriteProfileMap.set(profile.key, profile);
}

function mapAssetPathToGrowthStage(assetPath: string, stageFolder: 'egg' | 'baby' | 'teen'): string {
  return assetPath.replace(/\/(egg|baby|teen|adult)\//, `/${stageFolder}/`);
}

function cloneConfigForGrowthStage(
  baseConfig: PetSpriteConfig,
  stageFolder: 'egg' | 'baby' | 'teen',
): PetSpriteConfig | null {
  if (!baseConfig.frameImages || baseConfig.frameImages.length === 0) {
    return null;
  }
  const stageKeyByFolder: Record<'egg' | 'baby' | 'teen', Stage> = {
    egg: 'Egg',
    baby: 'Baby',
    teen: 'Teen',
  };
  return {
    ...baseConfig,
    name: MAIN_STAGE_PROFILE_KEY_MAP[stageKeyByFolder[stageFolder]],
    frameImages: baseConfig.frameImages.map((item) => ({
      ...item,
      image: mapAssetPathToGrowthStage(item.image, stageFolder),
    })),
  };
}

async function loadSpriteProfileFromConfig(config: PetSpriteConfig): Promise<SpriteProfile | null> {
  let atlas: { imageUrl: string; image: HTMLImageElement } | null = null;
  const resolvedFrameImages: ResolvedFrameImage[] = [];

  if (config.image) {
    const resolvedAtlas = await resolveAssetUrl(config.image);
    if (resolvedAtlas) {
      atlas = {
        imageUrl: resolvedAtlas,
        image: await loadImage(resolvedAtlas),
      };
    }
  }

  if (config.frameImages && config.frameImages.length > 0) {
    for (const frameImage of config.frameImages) {
      const resolved = await resolveAssetUrl(frameImage.image);
      if (!resolved) {
        continue;
      }
      resolvedFrameImages.push({
        id: frameImage.id,
        url: resolved,
        image: await loadImage(resolved),
      });
    }
  }

  if (!atlas && resolvedFrameImages.length === 0) {
    return null;
  }

  return createSpriteProfile(config, atlas, resolvedFrameImages);
}

function resolveMainStageProfile(stage: Stage): SpriteProfile | null {
  const key = MAIN_STAGE_PROFILE_KEY_MAP[stage];
  return spriteProfileMap.get(key) ?? null;
}

function getSpriteProfileForPet(pet: PlaygroundPet): SpriteProfile | null {
  if (pet.kind === 'main') {
    const stageProfile = resolveMainStageProfile(state.stage);
    if (stageProfile) {
      return stageProfile;
    }
    // Do not leak other stage assets into main character rendering.
    return null;
  }
  if (pet.spriteProfile) {
    const assigned = spriteProfileMap.get(pet.spriteProfile);
    if (assigned) {
      return assigned;
    }
  }
  return null;
}

async function initializeSpritePipeline(): Promise<void> {
  for (const candidate of PET_SPRITE_CONFIG_CANDIDATES) {
    const config = await fetchSpriteConfig(candidate);
    if (!config) {
      continue;
    }

    const adultProfile = await loadSpriteProfileFromConfig(config);
    if (!adultProfile) {
      continue;
    }
    registerSpriteProfile({
      ...adultProfile,
      key: MAIN_STAGE_PROFILE_KEY_MAP.Adult,
    });
    registerSpriteProfile({
      ...adultProfile,
      key: config.name,
    });

    const eggConfig = cloneConfigForGrowthStage(config, 'egg');
    if (eggConfig) {
      const eggProfile = await loadSpriteProfileFromConfig(eggConfig);
      if (eggProfile) {
        registerSpriteProfile(eggProfile);
      }
    }

    const babyConfig = cloneConfigForGrowthStage(config, 'baby');
    if (babyConfig) {
      const babyProfile = await loadSpriteProfileFromConfig(babyConfig);
      if (babyProfile) {
        registerSpriteProfile(babyProfile);
      }
    }

    const teenConfig = cloneConfigForGrowthStage(config, 'teen');
    if (teenConfig) {
      const teenProfile = await loadSpriteProfileFromConfig(teenConfig);
      if (teenProfile) {
        registerSpriteProfile(teenProfile);
      }
    }

    if (!defaultMainSpriteProfile) {
      defaultMainSpriteProfile = adultProfile;
    }
    return;
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

function pickDifferentRandomFrame(frames: number[], previousFrame: number | null): number {
  if (frames.length <= 1) {
    return frames[0] ?? 0;
  }
  const filtered = previousFrame === null ? frames : frames.filter((frame) => frame !== previousFrame);
  const pool = filtered.length > 0 ? filtered : frames;
  return pool[Math.floor(Math.random() * pool.length)] ?? pool[0] ?? 0;
}

function resolveMainEmotionMode(nowMs: number): MainEmotionMode {
  if (state.stats.cleanliness <= DIRTY_CLEANLINESS_THRESHOLD) {
    return 'dirty';
  }
  if (state.stats.health <= 60) {
    return 'tired';
  }
  if (state.stats.happiness >= 90) {
    return 'happy';
  }

  const inactiveMs = nowMs - lastInteractionAtMs;
  if (inactiveMs >= IDLE_INACTIVE_THRESHOLD_MS) {
    if (nowMs >= nextInactiveEmotionSwitchAt) {
      inactiveEmotionMode = Math.random() < 0.5 ? 'sleep' : 'neutral';
      nextInactiveEmotionSwitchAt = nowMs + INACTIVE_IMAGE_SWITCH_MS;
    }
    return inactiveEmotionMode;
  }

  inactiveEmotionMode = 'neutral';
  nextInactiveEmotionSwitchAt = 0;
  return 'neutral';
}

function resolveMainEmotionFrameIndex(
  profile: SpriteProfile,
  motion: PetMotion,
  runtimeFrames: number[],
  nowMs: number,
): number {
  const emotionMode = resolveMainEmotionMode(nowMs);
  const framePrefix = emotionMode;
  const matchedFrames = runtimeFrames.filter((frameIndex) =>
    (profile.frameEmotionIds[frameIndex] ?? '').startsWith(framePrefix),
  );
  const framePool = matchedFrames.length > 0 ? matchedFrames : runtimeFrames;
  const switchMs = emotionMode === 'happy' ? HAPPY_IMAGE_SWITCH_MS : INACTIVE_IMAGE_SWITCH_MS;
  const isAirborne = motion.state === 'jump' || motion.state === 'fall';

  if (activeEmotionMode !== emotionMode) {
    activeEmotionMode = emotionMode;
    activeEmotionFrameIndex = null;
    nextEmotionFrameSwitchAt = 0;
  }

  if (
    activeEmotionFrameIndex === null ||
    !framePool.includes(activeEmotionFrameIndex) ||
    nowMs >= nextEmotionFrameSwitchAt
  ) {
    activeEmotionFrameIndex = pickDifferentRandomFrame(framePool, activeEmotionFrameIndex);
    nextEmotionFrameSwitchAt = nowMs + switchMs;
  }

  if (isAirborne) {
    if (
      mainAirborneFrameLockIndex !== null &&
      (mainAirborneFrameLockIndex < 0 || mainAirborneFrameLockIndex >= profile.frames.length)
    ) {
      mainAirborneFrameLockIndex = null;
    }
    if (mainAirborneFrameLockIndex === null) {
      const previousFrame = petFrameIndexMap.get('main');
      if (
        Number.isFinite(previousFrame) &&
        Number(previousFrame) >= 0 &&
        Number(previousFrame) < profile.frames.length
      ) {
        mainAirborneFrameLockIndex = Number(previousFrame);
      } else {
        mainAirborneFrameLockIndex = activeEmotionFrameIndex ?? framePool[0] ?? 0;
      }
    }
    return mainAirborneFrameLockIndex;
  }
  mainAirborneFrameLockIndex = null;

  if (motion.state === 'drag') {
    return framePool[0] ?? activeEmotionFrameIndex ?? 0;
  }

  return activeEmotionFrameIndex;
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

  if (
    motion.state === 'idle' &&
    motion.expressionFrameIndex !== null &&
    runtime.frames.includes(motion.expressionFrameIndex)
  ) {
    return motion.expressionFrameIndex;
  }

  if (pet.kind === 'main') {
    return resolveMainEmotionFrameIndex(profile, motion, runtime.frames, nowMs);
  }

  const effectiveFps =
    motion.state === 'walk'
      ? Math.min(16, Math.max(runtime.fps, runtime.fps + Math.abs(motion.vx) / 35))
      : runtime.fps;
  const frameDuration = 1_000 / Math.max(1, effectiveFps);
  const elapsed = Math.max(0, nowMs - motion.stateStartedAt);
  const frameStep = Math.floor(elapsed / frameDuration);
  const frameOffset = runtime.loop
    ? frameStep % runtime.frames.length
    : Math.min(runtime.frames.length - 1, frameStep);
  return runtime.frames[frameOffset] ?? 0;
}

function updateIdleExpressionFrame(pet: PlaygroundPet, motion: PetMotion, nowMs: number): void {
  if (pet.kind === 'main') {
    motion.expressionFrameIndex = null;
    return;
  }
  const profile = getSpriteProfileForPet(pet);
  if (!profile) {
    motion.expressionFrameIndex = null;
    return;
  }
  const idleFrames = profile.states.idle.frames;
  if (motion.state !== 'idle' || idleFrames.length <= 1) {
    motion.expressionFrameIndex = null;
    return;
  }
  if (motion.expressionFrameIndex !== null && nowMs < motion.nextExpressionAt) {
    return;
  }
  const candidateFrames = idleFrames.filter((frameIndex) => frameIndex !== motion.expressionFrameIndex);
  const framePool = candidateFrames.length > 0 ? candidateFrames : idleFrames;
  const weightedFramePool: number[] = [];
  for (const frameIndex of framePool) {
    const emotionId = profile.frameEmotionIds[frameIndex] ?? '';
    const weight =
      emotionId === 'neutral' ? 8 : emotionId === 'happy' ? 3 : emotionId === 'sleep' ? 2 : 1;
    for (let repeat = 0; repeat < weight; repeat += 1) {
      weightedFramePool.push(frameIndex);
    }
  }
  const pickPool = weightedFramePool.length > 0 ? weightedFramePool : framePool;
  const nextFrame = pickPool[Math.floor(Math.random() * pickPool.length)] ?? idleFrames[0];
  motion.expressionFrameIndex = nextFrame;
  motion.nextExpressionAt = nowMs + 3_000 + Math.random() * 5_000;
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
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const sourceImage = profile.frameImages[frameIndex] ?? profile.frameImages[0];
  if (!sourceImage) {
    return;
  }
  ctx.drawImage(
    sourceImage,
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
  const motion = ensurePetMotion(pet.id);
  const sampleX = motion.facing < 0 ? rect.width - localX : localX;
  const px = Math.max(0, Math.min(alphaData.width - 1, Math.floor((sampleX / rect.width) * alphaData.width)));
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
  const profile = getSpriteProfileForPet(pet);
  const petSize = getCurrentPetSize();
  node.classList.toggle('selected', pet.id === selectedPetId);
  node.classList.toggle('state-idle', motion.state === 'idle');
  node.classList.toggle('state-walk', motion.state === 'walk');
  node.classList.toggle('state-jump', motion.state === 'jump');
  node.classList.toggle('state-fall', motion.state === 'fall');
  node.classList.toggle('state-drag', motion.state === 'drag');
  node.style.width = `${petSize}px`;
  node.style.height = `${petSize}px`;
  node.style.left = `${pet.x}px`;
  node.style.top = `${pet.y}px`;
  node.style.setProperty('--pet-facing', motion.facing < 0 ? '-1' : '1');
  if (!profile) {
    node.style.fontSize = `${Math.max(28, Math.round(petSize * 0.56))}px`;
  }

  const canvas = node.querySelector('canvas.pet-sprite-canvas') as HTMLCanvasElement | null;
  if (canvas && (canvas.width !== petSize || canvas.height !== petSize)) {
    canvas.width = petSize;
    canvas.height = petSize;
  }
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
  const petSize = getCurrentPetSize();
  const mainPet: PlaygroundPet = {
    id: 'main',
    kind: 'main',
    emoji: STAGE_FACE_MAP[state.stage],
    x: 0,
    y: 0,
    spriteProfile: 'main-cat',
  };
  return {
    x: Math.max(8, window.innerWidth - petSize - MAIN_DEFAULT_MARGIN_X),
    y: getGroundYForPet(mainPet, petSize),
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
  const petSize = getCurrentPetSize();
  const maxX = Math.max(0, playgroundElement.clientWidth - petSize);
  const maxY = Math.max(0, playgroundElement.clientHeight - petSize + getPetGroundInsetPx(pet, petSize));
  return {
    ...pet,
    x: Math.max(0, Math.min(maxX, pet.x)),
    y: Math.max(0, Math.min(maxY, pet.y)),
  };
}

function realignPetPositionsForViewport(nowMs: number): void {
  playgroundPets = playgroundPets.map((pet) => {
    const motion = ensurePetMotion(pet.id);
    const nextPet = clampPetPosition({ ...pet });
    const groundY = getGroundYForPet(nextPet);
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
      if (!isMainMotionRandom()) {
        transitionMotionState(motion, 'idle', nowMs);
        motion.vx = 0;
        motion.vy = 0;
      }
    }
    updateIdleExpressionFrame(nextPet, motion, nowMs);
    return nextPet;
  });
}

function stepPetMotion(deltaSec: number, nowMs: number): void {
  playgroundPets = playgroundPets.map((pet) => {
    const motion = ensurePetMotion(pet.id);
    if (motion.dragging) {
      return pet;
    }

    let nextPet = { ...pet };
    const petSize = getCurrentPetSize();
    const maxX = Math.max(0, playgroundElement.clientWidth - petSize);
    const groundY = getGroundYForPet(nextPet, petSize);

    if (!isAirborneState(motion.state) && Math.abs(nextPet.y - groundY) > 0.5) {
      nextPet.y = groundY;
    }

    if (pet.kind === 'main') {
      if (isMainMotionRandom()) {
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
      } else if (!motion.dragging && !isAirborneState(motion.state)) {
        transitionMotionState(motion, 'idle', nowMs);
        motion.vx = 0;
        motion.vy = 0;
        motion.landingUntil = 0;
      }
    }

    if (motion.vx < -PET_MIN_VELOCITY) {
      motion.facing = -1;
    } else if (motion.vx > PET_MIN_VELOCITY) {
      motion.facing = 1;
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
      motion.facing = motion.vx < 0 ? -1 : 1;
      nextPet.x = Math.max(0, Math.min(maxX, nextPet.x));
    }

    if (!isAirborneState(motion.state)) {
      nextPet.y = groundY;
      motion.vy = 0;
      motion.landingUntil = 0;
    }

    if (pet.kind === 'main' && !isMainMotionRandom()) {
      transitionMotionState(motion, 'idle', nowMs);
      motion.vx = 0;
      motion.vy = 0;
      nextPet.y = groundY;
    }

    updateIdleExpressionFrame(pet, motion, nowMs);
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
  updatePanelFace(nowMs);
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
    const petSize = getCurrentPetSize();
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `playground-pet ${pet.kind}`;
    node.dataset.petId = pet.id;
    node.title = pet.kind === 'main' ? '메인 캐릭터' : '보조 캐릭터';
    if (spriteProfile) {
      const shell = document.createElement('div');
      shell.className = 'pet-sprite-shell';
      const canvas = document.createElement('canvas');
      canvas.className = 'pet-sprite-canvas';
      canvas.width = petSize;
      canvas.height = petSize;
      canvas.setAttribute('aria-hidden', 'true');
      shell.appendChild(canvas);
      node.appendChild(shell);
    } else {
      node.textContent = pet.emoji;
      node.style.fontSize = `${Math.max(28, Math.round(petSize * 0.56))}px`;
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
      markUserInteraction();
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
          const nowMs = performance.now();
          if (pet.kind === 'main' && !isMainMotionRandom()) {
            transitionMotionState(motion, 'idle', nowMs);
            motion.vx = 0;
            motion.vy = 0;
            motion.landingUntil = 0;
            motion.nextDecisionAt = nowMs + 20_000;
          } else {
            motion.vx = velocityX * 0.08;
            motion.vy = velocityY * 0.08;
            motion.facing = motion.vx < 0 ? -1 : 1;
            transitionMotionState(motion, motion.vy < 0 ? 'jump' : 'fall', nowMs);
            motion.landingUntil = 0;
            motion.nextDecisionAt = nowMs + 1_200;
          }
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

function applyMainMotionMode(mode: MainMotionMode): void {
  mainMotionMode = mode;
  persistMainMotionMode();
  const nowMs = performance.now();
  const mainPet = playgroundPets.find((pet) => pet.kind === 'main');
  if (!mainPet) {
    updateCharacterSettingsUI();
    return;
  }

  const motion = ensurePetMotion(mainPet.id);
  if (mainMotionMode === 'fixed') {
    transitionMotionState(motion, 'idle', nowMs);
    motion.vx = 0;
    motion.vy = 0;
    motion.landingUntil = 0;
    mainPet.y = getGroundYForPet(mainPet);
    overlayHintElement.textContent = '메인 캐릭터를 현재 위치에 고정했습니다.';
  } else {
    motion.nextDecisionAt = Math.min(motion.nextDecisionAt, nowMs + 500);
    overlayHintElement.textContent = '메인 캐릭터 랜덤 이동을 활성화했습니다.';
  }

  updateCharacterSettingsUI();
  persistPlaygroundPets();
  renderPlayground();
}

function applyCharacterSizeLevel(nextLevel: number): void {
  const clamped = clampCharacterSizeLevel(nextLevel);
  if (clamped === characterSizeLevel) {
    updateCharacterSettingsUI();
    return;
  }

  const oldSize = getCurrentPetSize();
  characterSizeLevel = clamped;
  persistCharacterSizeLevel();
  const newSize = getCurrentPetSize();

  if (oldSize !== newSize) {
    playgroundPets = playgroundPets.map((pet) => {
      const oldInset = getPetGroundInsetPx(pet, oldSize);
      const newInset = getPetGroundInsetPx(pet, newSize);
      const anchorX = pet.x + oldSize / 2;
      const anchorY = pet.y + oldSize - oldInset;
      return clampPetPosition({
        ...pet,
        x: anchorX - newSize / 2,
        y: anchorY - (newSize - newInset),
      });
    });
  }

  realignPetPositionsForViewport(performance.now());
  updateCharacterSettingsUI();
  persistPlaygroundPets();
  renderPlayground();
  overlayHintElement.textContent = `캐릭터 크기를 ${characterSizeLevel} 단계로 변경했습니다.`;
}

function syncMainMotionModeOnBoot(): void {
  if (isMainMotionRandom()) {
    return;
  }
  const mainPet = playgroundPets.find((pet) => pet.kind === 'main');
  if (!mainPet) {
    return;
  }
  const nowMs = performance.now();
  const motion = ensurePetMotion(mainPet.id);
  transitionMotionState(motion, 'idle', nowMs);
  motion.vx = 0;
  motion.vy = 0;
  motion.landingUntil = 0;
  mainPet.y = getGroundYForPet(mainPet);
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
    `- 이동 모드: ⚙ 설정에서 랜덤 이동/현재 위치 고정을 전환할 수 있습니다.\n` +
    `- 크기 조절: ⚙ 설정의 캐릭터 크기(1~10)에서 최대 x6.00까지 확대됩니다.\n` +
    `- 생동감 모션: 이동 방향 반전, 걷기 속도 연동 FPS, 유휴 표정 랜덤 전환이 적용됩니다.\n` +
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

function updatePanelFace(nowMs: number): void {
  const mainPet = playgroundPets.find((pet) => pet.kind === 'main');
  if (!mainPet) {
    faceElement.style.backgroundImage = '';
    faceElement.textContent = STAGE_FACE_MAP[state.stage];
    return;
  }
  const motion = ensurePetMotion(mainPet.id);
  const profile = getSpriteProfileForPet(mainPet);
  if (!profile) {
    faceElement.style.backgroundImage = '';
    faceElement.textContent = STAGE_FACE_MAP[state.stage];
    return;
  }

  const frameIndex = resolveAnimationFrameIndex(mainPet, motion, nowMs);
  const imageUrl = profile.imageUrls[frameIndex] ?? profile.imageUrls[0] ?? '';
  if (imageUrl) {
    faceElement.textContent = '';
    faceElement.style.backgroundImage = `url("${imageUrl}")`;
  } else {
    faceElement.style.backgroundImage = '';
    faceElement.textContent = STAGE_FACE_MAP[state.stage];
  }
}

function render(nextState: PetState): void {
  const previousStage = state.stage;
  state = nextState;
  updatePanelFace(performance.now());
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
  if (state.stage !== previousStage && state.stage !== 'Egg') {
    overlayHintElement.textContent = STAGE_TRANSITION_MESSAGE[state.stage];
  }
}

function handleAction(action: 'feed' | 'clean' | 'play'): void {
  if (!isActionEffective(state, action)) {
    overlayHintElement.textContent = '현재 상태에서는 해당 액션으로 얻을 수 있는 보상이 없습니다.';
    return;
  }
  markUserInteraction();
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
      markUserInteraction();
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
    updateCharacterSettingsUI();
    try {
      await refreshDisplayOptions();
    } catch {
      overlayHintElement.textContent = '모니터 정보를 불러오지 못했습니다.';
    }
  }
});

characterSizeSlider.addEventListener('input', () => {
  applyCharacterSizeLevel(Number(characterSizeSlider.value));
});

characterSizeSlider.addEventListener('change', () => {
  applyCharacterSizeLevel(Number(characterSizeSlider.value));
});

mainMotionModeSelect.addEventListener('change', () => {
  const mode = mainMotionModeSelect.value === 'fixed' ? 'fixed' : 'random';
  applyMainMotionMode(mode);
});

resetGrowthButton.addEventListener('click', () => {
  const confirmed = window.confirm(
    '지금까지의 성장 내용(스탯, EXP, 활동 EXP 기록)을 모두 초기화합니다. 계속하시겠습니까?',
  );
  if (!confirmed) {
    return;
  }

  window.localStorage.removeItem(SAVE_STORAGE_KEY);
  window.localStorage.removeItem(ACTIVITY_STORAGE_KEY);
  state = loadState();
  activitySnapshot = loadActivitySnapshot(new Date());
  sampleActiveSeconds = 0;
  sampleInputEvents = 0;
  sampleInputByType = createEmptyInputCounter();
  dailyActiveSeconds = 0;
  dailyInputByType = createEmptyInputCounter();
  activeEmotionFrameIndex = null;
  activeEmotionMode = null;
  nextEmotionFrameSwitchAt = 0;
  mainAirborneFrameLockIndex = null;
  markUserInteraction();
  overlayHintElement.textContent = '성장 내용을 초기화했습니다.';
  render(state);
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
  markUserInteraction();
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
  const reportSummary = getDailyReportText();
  pendingDailyReport = {
    dayKey: getLocalDayKey(new Date()),
    summary: reportSummary,
    createdAt: new Date().toISOString(),
    viewed: false,
  };
  persistPendingDailyReport(pendingDailyReport);
  const viewNow = window.confirm('오늘의 요약/격려 리포트를 지금 확인할까요?');
  if (viewNow) {
    window.alert(reportSummary);
    pendingDailyReport = {
      ...pendingDailyReport,
      viewed: true,
    };
    persistPendingDailyReport(pendingDailyReport);
  }
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

reportButton.addEventListener('click', () => {
  openPendingReport();
});

chatOpenButton.addEventListener('click', () => {
  if (chatVisible) {
    closeChatSession(false);
    return;
  }
  openChatSession();
});

chatSendButton.addEventListener('click', () => {
  void sendChatMessage();
});

chatInputElement.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Enter') {
    return;
  }
  event.preventDefault();
  void sendChatMessage();
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
updateCharacterSettingsUI();
updateReportButtonVisibility();
updateChatUI();
syncMainMotionModeOnBoot();
setUiPanelVisible(uiPanelVisible);
bindActivitySignalEvents();
render(state);
startLiveLoop();
setInterval(() => {
  if (!chatVisible) {
    updateChatUI();
  }
}, 1_000);
void initializeSpritePipeline().then(() => {
  renderPlayground();
});
