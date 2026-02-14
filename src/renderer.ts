import './index.css';
import {
  CURRENT_SCHEMA_VERSION,
  TICK_INTERVAL_MS,
  applyAction,
  loadState,
  persistSave,
  runTick,
  type PetState,
  type Stage,
} from './petState';

interface OverlayState {
  clickThroughEnabled: boolean;
  shortcut: string;
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

let state: PetState = loadState();
let clickThroughEnabled = false;
let clickThroughShortcut = 'Ctrl+Shift+O';
let playgroundPets: PlaygroundPet[] = loadPlaygroundPets();
let selectedPetId = playgroundPets[0]?.id ?? 'main';

const overlayBridge = window.overlayBridge;

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
  clickThroughToggleButton.textContent = clickThroughEnabled
    ? 'Click-through: ON'
    : 'Click-through: OFF';
  clickThroughStatusElement.textContent = clickThroughEnabled
    ? `통과 중 · ${clickThroughShortcut}로 복구`
    : '입력 캡처 중';
}

const render = (nextState: PetState): void => {
  state = nextState;
  faceElement.textContent = STAGE_FACE_MAP[state.stage];
  stageTextElement.textContent = `Stage: ${state.stage}`;
  warningTextElement.textContent = state.warnings.join(' · ');
  metaTextElement.textContent =
    `EXP ${state.exp} · schema v${CURRENT_SCHEMA_VERSION} · ` +
    `feed ${state.actionCounts.feed} / clean ${state.actionCounts.clean} / play ${state.actionCounts.play}`;

  for (const key of statKeys) {
    const value = Math.round(state.stats[key]);
    statValueElements[key].textContent = String(value);
    statFillElements[key].style.width = `${value}%`;
  }

  renderPlayground();
  updateClickThroughUI();
};

const handleAction = (action: 'feed' | 'clean' | 'play'): void => {
  render(applyAction(state, action));
};

const addBuddy = (): void => {
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
};

const removeBuddy = (): void => {
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
};

feedButton.addEventListener('click', () => handleAction('feed'));
cleanButton.addEventListener('click', () => handleAction('clean'));
playButton.addEventListener('click', () => handleAction('play'));
addCharacterButton.addEventListener('click', addBuddy);
removeCharacterButton.addEventListener('click', removeBuddy);

clickThroughToggleButton.addEventListener('click', async () => {
  if (!overlayBridge) {
    return;
  }
  clickThroughEnabled = await overlayBridge.toggleClickThrough();
  updateClickThroughUI();
});

window.addEventListener('beforeunload', () => {
  persistSave(state);
  persistPlaygroundPets();
});

setInterval(() => {
  render(runTick(state));
}, TICK_INTERVAL_MS);

if (overlayBridge) {
  overlayBridge
    .getState()
    .then((overlayState) => {
      clickThroughEnabled = overlayState.clickThroughEnabled;
      clickThroughShortcut = overlayState.shortcut;
      updateClickThroughUI();
    })
    .catch(() => {
      updateClickThroughUI();
    });

  const unsubscribe = overlayBridge.onClickThroughChanged((overlayState) => {
    clickThroughEnabled = overlayState.clickThroughEnabled;
    clickThroughShortcut = overlayState.shortcut;
    updateClickThroughUI();
  });

  window.addEventListener('beforeunload', unsubscribe, { once: true });
} else {
  clickThroughToggleButton.disabled = true;
  clickThroughStatusElement.textContent = '브리지 없음';
}

render(state);
