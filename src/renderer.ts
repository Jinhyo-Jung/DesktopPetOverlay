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

const STAGE_FACE_MAP: Record<Stage, string> = {
  Egg: '🐣',
  Baby: '🐥',
  Teen: '🐱',
  Adult: '🐈',
};

type StatKey = 'hunger' | 'happiness' | 'cleanliness' | 'health';

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

let state: PetState = loadState();

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
};

const handleAction = (action: 'feed' | 'clean' | 'play'): void => {
  render(applyAction(state, action));
};

feedButton.addEventListener('click', () => handleAction('feed'));
cleanButton.addEventListener('click', () => handleAction('clean'));
playButton.addEventListener('click', () => handleAction('play'));

window.addEventListener('beforeunload', () => {
  persistSave(state);
});

setInterval(() => {
  render(runTick(state));
}, TICK_INTERVAL_MS);

render(state);
