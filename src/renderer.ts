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
  resetActivityContribution,
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
  onClickThroughChanged: (callback: (state: OverlayState) => void) => () => void;
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
const DRAG_THRESHOLD = 4;
const PET_NODE_SIZE = 44;

type StatKey = 'hunger' | 'happiness' | 'cleanliness' | 'health';

interface PlaygroundPet {
  id: string;
  kind: 'main' | 'buddy';
  emoji: string;
  x: number;
  y: number;
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
const activityOptToggleButton = document.getElementById(
  'activity-opt-toggle-btn',
) as HTMLButtonElement;
const activityCheckinButton = document.getElementById(
  'activity-checkin-btn',
) as HTMLButtonElement;
const activityResetButton = document.getElementById('activity-reset-btn') as HTMLButtonElement;
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

function loadPlaygroundPets(): PlaygroundPet[] {
  try {
    const raw = window.localStorage.getItem(CHARACTER_STORAGE_KEY);
    if (!raw) {
      return [{ id: 'main', kind: 'main', emoji: STAGE_FACE_MAP[state.stage], x: 132, y: 38 }];
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
      }));

    const mainPet = sanitized.find((pet) => pet.kind === 'main');
    if (!mainPet) {
      sanitized.unshift({
        id: 'main',
        kind: 'main',
        emoji: STAGE_FACE_MAP[state.stage],
        x: 132,
        y: 38,
      });
    }
    return sanitized;
  } catch {
    return [{ id: 'main', kind: 'main', emoji: STAGE_FACE_MAP[state.stage], x: 132, y: 38 }];
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
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `playground-pet${pet.id === selectedPetId ? ' selected' : ''}`;
    node.textContent = pet.emoji;
    node.style.left = `${pet.x}px`;
    node.style.top = `${pet.y}px`;
    node.dataset.petId = pet.id;
    node.title = pet.kind === 'main' ? '메인 캐릭터' : '보조 캐릭터';

    node.addEventListener('pointerdown', (event: PointerEvent) => {
      if (clickThroughEnabled) {
        return;
      }

      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const originX = pet.x;
      const originY = pet.y;
      let moved = false;
      node.classList.add('dragging');

      const onPointerMove = (moveEvent: PointerEvent): void => {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;
        if (Math.abs(deltaX) >= DRAG_THRESHOLD || Math.abs(deltaY) >= DRAG_THRESHOLD) {
          moved = true;
        }
        const nextX = originX + deltaX;
        const nextY = originY + deltaY;
        const index = playgroundPets.findIndex((item) => item.id === pet.id);
        if (index >= 0) {
          playgroundPets[index] = clampPetPosition({ ...playgroundPets[index], x: nextX, y: nextY });
          node.style.left = `${playgroundPets[index].x}px`;
          node.style.top = `${playgroundPets[index].y}px`;
        }
      };

      const onPointerUp = (): void => {
        window.removeEventListener('pointermove', onPointerMove);
        node.classList.remove('dragging');
        if (!moved) {
          selectedPetId = pet.id;
          overlayHintElement.textContent = '캐릭터 선택 완료';
        } else {
          overlayHintElement.textContent = '드래그 위치 저장 완료';
        }
        persistPlaygroundPets();
        renderPlayground();
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp, { once: true });
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
}

function updateActivityUI(): void {
  const previousDayKey = activitySnapshot.dayKey;
  activitySnapshot = rolloverSnapshot(activitySnapshot, new Date());
  if (previousDayKey !== activitySnapshot.dayKey) {
    dailyActiveSeconds = 0;
    dailyInputByType = createEmptyInputCounter();
  }

  activityOptToggleButton.textContent = activitySnapshot.enabled ? '활동 EXP: ON' : '활동 EXP: OFF';
  const cooldownRemainingMs = getCooldownRemainingMs(activitySnapshot.lastFallbackAt);
  activityCheckinButton.disabled = cooldownRemainingMs > 0;
  activityCheckinButton.textContent =
    cooldownRemainingMs > 0
      ? `EXP 획득 (${Math.ceil(cooldownRemainingMs / 1_000)}s)`
      : 'EXP 획득';

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
    `- Feed / Clean / Play: 해당 능력치가 실제로 회복될 때만 EXP를 줍니다.\n` +
    `  (이미 100이라 변화가 없으면 EXP 없음)\n` +
    `- 활동 EXP(자동): 5분 샘플마다 시간/입력 집계로 자동 획득됩니다.\n` +
    `- EXP 획득(수동): 5분 쿨다운마다 +2 EXP를 받습니다.\n` +
    `- 활동 EXP 기록 초기화: 활동 시스템으로 받은 누적 EXP 기록을 초기화하고 캐릭터 EXP에서 차감합니다.\n` +
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
  } else {
    const lastBuddy = [...playgroundPets].reverse().find((pet) => pet.kind === 'buddy');
    if (!lastBuddy) {
      overlayHintElement.textContent = '삭제할 보조 캐릭터가 없습니다.';
      return;
    }
    playgroundPets = playgroundPets.filter((pet) => pet.id !== lastBuddy.id);
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
addCharacterButton.addEventListener('click', addBuddy);
removeCharacterButton.addEventListener('click', removeBuddy);

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
    overlayHintElement.textContent = 'EXP 획득은 5분 간격으로 사용할 수 있습니다.';
  }
  updateActivityUI();
});

activityResetButton.addEventListener('click', () => {
  const resetResult = resetActivityContribution(activitySnapshot, new Date());
  activitySnapshot = resetResult.snapshot;
  persistActivitySnapshot(activitySnapshot);
  if (resetResult.expDelta !== 0) {
    state = applyExpDelta(state, resetResult.expDelta);
    overlayHintElement.textContent = '활동 기반 누적 EXP를 초기화했습니다.';
    render(state);
    return;
  }
  overlayHintElement.textContent = '초기화할 활동 EXP가 없습니다.';
  updateActivityUI();
});

window.addEventListener('beforeunload', () => {
  persistSave(state);
  persistPlaygroundPets();
  persistActivitySnapshot(activitySnapshot);
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

updateHelpPanel();
bindActivitySignalEvents();
render(state);
