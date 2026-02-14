export type Stage = 'Egg' | 'Baby' | 'Teen' | 'Adult';

export type ActionType = 'feed' | 'clean' | 'play';

export interface Stats {
  hunger: number;
  happiness: number;
  cleanliness: number;
  health: number;
}

export interface ActionCounts {
  feed: number;
  clean: number;
  play: number;
}

export interface PetSave {
  schemaVersion: number;
  stats: Stats;
  stage: Stage;
  exp: number;
  lastSeenTimestamp: string;
  actionCounts: ActionCounts;
}

export interface PetState extends PetSave {
  warnings: string[];
}

const STORAGE_KEY = 'desktop-pet-overlay-save';
export const CURRENT_SCHEMA_VERSION = 2;
export const TICK_INTERVAL_MS = 60_000;
const MAX_OFFLINE_MINUTES = 12 * 60;

const DANGER_THRESHOLD = 25;
const DECAY_PER_MINUTE = {
  hunger: 0.22,
  happiness: 0.18,
  cleanliness: 0.2,
};
const HEALTH_PENALTY_PER_MINUTE = 0.16;

const ACTION_EFFECTS: Record<
  ActionType,
  { hunger: number; happiness: number; cleanliness: number; health: number; exp: number }
> = {
  feed: { hunger: 26, happiness: 0, cleanliness: 0, health: 2, exp: 2 },
  clean: { hunger: 0, happiness: 0, cleanliness: 24, health: 2, exp: 2 },
  play: { hunger: 0, happiness: 22, cleanliness: 0, health: 0, exp: 4 },
};

const DEFAULT_STATS: Stats = {
  hunger: 100,
  happiness: 100,
  cleanliness: 100,
  health: 100,
};

const DEFAULT_ACTION_COUNTS: ActionCounts = {
  feed: 0,
  clean: 0,
  play: 0,
};

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeStats(value: unknown): Stats {
  const record = asRecord(value);
  if (!record) {
    return { ...DEFAULT_STATS };
  }

  return {
    hunger: clamp(toNumber(record.hunger, DEFAULT_STATS.hunger)),
    happiness: clamp(toNumber(record.happiness, DEFAULT_STATS.happiness)),
    cleanliness: clamp(toNumber(record.cleanliness, DEFAULT_STATS.cleanliness)),
    health: clamp(toNumber(record.health, DEFAULT_STATS.health)),
  };
}

function normalizeActionCounts(value: unknown): ActionCounts {
  const record = asRecord(value);
  if (!record) {
    return { ...DEFAULT_ACTION_COUNTS };
  }

  return {
    feed: Math.max(0, Math.floor(toNumber(record.feed, 0))),
    clean: Math.max(0, Math.floor(toNumber(record.clean, 0))),
    play: Math.max(0, Math.floor(toNumber(record.play, 0))),
  };
}

function toIsoTimestamp(value: unknown, fallbackIso: string): string {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  return fallbackIso;
}

function deriveStage(exp: number): Stage {
  if (exp >= 180) {
    return 'Adult';
  }
  if (exp >= 90) {
    return 'Teen';
  }
  if (exp >= 30) {
    return 'Baby';
  }
  return 'Egg';
}

function normalizeStage(value: unknown, exp: number): Stage {
  if (value === 'Egg' || value === 'Baby' || value === 'Teen' || value === 'Adult') {
    return value;
  }
  return deriveStage(exp);
}

function defaultSave(nowIso: string): PetSave {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    stats: { ...DEFAULT_STATS },
    stage: 'Egg',
    exp: 0,
    lastSeenTimestamp: nowIso,
    actionCounts: { ...DEFAULT_ACTION_COUNTS },
  };
}

function applyDecay(save: PetSave, elapsedMinutes: number, nowIso: string): PetSave {
  const safeMinutes = Math.max(0, Math.min(MAX_OFFLINE_MINUTES, Math.floor(elapsedMinutes)));
  if (safeMinutes <= 0) {
    return { ...save, lastSeenTimestamp: nowIso };
  }

  const hunger = clamp(save.stats.hunger - DECAY_PER_MINUTE.hunger * safeMinutes);
  const happiness = clamp(save.stats.happiness - DECAY_PER_MINUTE.happiness * safeMinutes);
  const cleanliness = clamp(save.stats.cleanliness - DECAY_PER_MINUTE.cleanliness * safeMinutes);

  let health = save.stats.health;
  if (hunger <= DANGER_THRESHOLD || cleanliness <= DANGER_THRESHOLD) {
    health = clamp(health - HEALTH_PENALTY_PER_MINUTE * safeMinutes);
  }

  return {
    ...save,
    stats: {
      hunger,
      happiness,
      cleanliness,
      health,
    },
    lastSeenTimestamp: nowIso,
  };
}

function readRawSave(): unknown {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function migrateSave(rawSave: unknown, nowIso: string): PetSave {
  const record = asRecord(rawSave);
  if (!record) {
    return defaultSave(nowIso);
  }

  const statsSource = asRecord(record.stats) ?? record;
  const stats = normalizeStats(statsSource);
  const exp = Math.max(0, Math.floor(toNumber(record.exp, 0)));
  const stage = normalizeStage(record.stage, exp);
  const actionCounts = normalizeActionCounts(record.actionCounts);
  const schemaVersion = Math.max(1, Math.floor(toNumber(record.schemaVersion, 1)));
  const lastSeenTimestamp = toIsoTimestamp(record.lastSeenTimestamp, nowIso);

  const migrated: PetSave = {
    schemaVersion,
    stats,
    stage,
    exp,
    lastSeenTimestamp,
    actionCounts,
  };

  return {
    ...migrated,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}

function buildWarnings(stats: Stats): string[] {
  const warnings: string[] = [];
  if (stats.hunger <= DANGER_THRESHOLD) {
    warnings.push('배고픔 주의');
  }
  if (stats.cleanliness <= DANGER_THRESHOLD) {
    warnings.push('청결 주의');
  }
  if (stats.happiness <= DANGER_THRESHOLD) {
    warnings.push('행복도 주의');
  }
  if (stats.health <= DANGER_THRESHOLD) {
    warnings.push('건강 주의');
  }

  if (warnings.length === 0) {
    warnings.push('상태 양호');
  }

  return warnings;
}

function toState(save: PetSave): PetState {
  return {
    ...save,
    warnings: buildWarnings(save.stats),
  };
}

function toSave(state: PetState | PetSave): PetSave {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    stats: {
      hunger: clamp(state.stats.hunger),
      happiness: clamp(state.stats.happiness),
      cleanliness: clamp(state.stats.cleanliness),
      health: clamp(state.stats.health),
    },
    stage: normalizeStage(state.stage, state.exp),
    exp: Math.max(0, Math.floor(state.exp)),
    lastSeenTimestamp: toIsoTimestamp(state.lastSeenTimestamp, new Date().toISOString()),
    actionCounts: normalizeActionCounts(state.actionCounts),
  };
}

export function persistSave(state: PetState | PetSave): void {
  const normalized = toSave(state);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}

export function loadState(): PetState {
  const now = new Date();
  const nowIso = now.toISOString();
  const raw = readRawSave();
  const migrated = migrateSave(raw, nowIso);

  const elapsedMs = now.getTime() - Date.parse(migrated.lastSeenTimestamp);
  const elapsedMinutes = Number.isFinite(elapsedMs) ? Math.floor(elapsedMs / 60_000) : 0;
  const decayed = applyDecay(migrated, elapsedMinutes, nowIso);
  decayed.stage = deriveStage(decayed.exp);
  persistSave(decayed);

  return toState(decayed);
}

export function runTick(current: PetState): PetState {
  const next = applyDecay(toSave(current), 1, new Date().toISOString());
  next.stage = deriveStage(next.exp);
  persistSave(next);
  return toState(next);
}

export function applyExpDelta(current: PetState, expDelta: number): PetState {
  const nowIso = new Date().toISOString();
  const base = toSave(current);
  const nextExp = Math.max(0, base.exp + Math.floor(expDelta));

  const next: PetSave = {
    ...base,
    exp: nextExp,
    stage: deriveStage(nextExp),
    lastSeenTimestamp: nowIso,
  };

  persistSave(next);
  return toState(next);
}

export function applyAction(current: PetState, action: ActionType): PetState {
  const effects = ACTION_EFFECTS[action];
  const nowIso = new Date().toISOString();
  const base = toSave(current);

  const next: PetSave = {
    ...base,
    stats: {
      hunger: clamp(base.stats.hunger + effects.hunger),
      happiness: clamp(base.stats.happiness + effects.happiness),
      cleanliness: clamp(base.stats.cleanliness + effects.cleanliness),
      health: clamp(base.stats.health + effects.health),
    },
    exp: base.exp + effects.exp,
    lastSeenTimestamp: nowIso,
    actionCounts: {
      ...base.actionCounts,
      [action]: base.actionCounts[action] + 1,
    },
  };

  next.stage = deriveStage(next.exp);
  persistSave(next);
  return toState(next);
}
