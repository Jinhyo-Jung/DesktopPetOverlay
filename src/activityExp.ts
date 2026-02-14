export interface ActivityExpSnapshot {
  enabled: boolean;
  dayKey: string;
  dailyActivityExp: number;
  dailyFallbackExp: number;
  totalGrantedExp: number;
  lastFallbackAt: string | null;
}

const STORAGE_KEY = 'desktop-pet-overlay-activity-exp-v1';

const DEFAULT_SNAPSHOT: ActivityExpSnapshot = {
  enabled: true,
  dayKey: '',
  dailyActivityExp: 0,
  dailyFallbackExp: 0,
  totalGrantedExp: 0,
  lastFallbackAt: null,
};

export const SAMPLE_INTERVAL_MS = 5 * 60_000;
export const HEARTBEAT_MS = 1_000;
export const DAILY_ACTIVITY_EXP_CAP = 36;
export const DAILY_FALLBACK_EXP_CAP = 12;
export const FALLBACK_EXP_GRANT = 4;
export const FALLBACK_COOLDOWN_MS = 60 * 60_000;

const ACTIVE_MINUTE_WEIGHT = 0.4;
const INPUT_EVENT_DIVISOR = 140;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as Record<string, unknown>;
}

function safeNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function safeIso(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

export function getLocalDayKey(now: Date): string {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeSnapshot(raw: unknown, now: Date): ActivityExpSnapshot {
  const record = asRecord(raw);
  const normalized: ActivityExpSnapshot = {
    ...DEFAULT_SNAPSHOT,
    dayKey: getLocalDayKey(now),
  };

  if (!record) {
    return normalized;
  }

  normalized.enabled = record.enabled !== false;
  normalized.dayKey =
    typeof record.dayKey === 'string' && record.dayKey.length > 0
      ? record.dayKey
      : normalized.dayKey;
  normalized.dailyActivityExp = Math.max(0, Math.floor(safeNumber(record.dailyActivityExp, 0)));
  normalized.dailyFallbackExp = Math.max(0, Math.floor(safeNumber(record.dailyFallbackExp, 0)));
  normalized.totalGrantedExp = Math.max(0, Math.floor(safeNumber(record.totalGrantedExp, 0)));
  normalized.lastFallbackAt = safeIso(record.lastFallbackAt);

  return normalized;
}

export function rolloverSnapshot(snapshot: ActivityExpSnapshot, now: Date): ActivityExpSnapshot {
  const dayKey = getLocalDayKey(now);
  if (snapshot.dayKey === dayKey) {
    return snapshot;
  }
  return {
    ...snapshot,
    dayKey,
    dailyActivityExp: 0,
    dailyFallbackExp: 0,
    lastFallbackAt: null,
  };
}

export function loadActivitySnapshot(now: Date): ActivityExpSnapshot {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return rolloverSnapshot({ ...DEFAULT_SNAPSHOT, dayKey: getLocalDayKey(now) }, now);
    }
    const parsed = JSON.parse(raw) as unknown;
    return rolloverSnapshot(normalizeSnapshot(parsed, now), now);
  } catch {
    return rolloverSnapshot({ ...DEFAULT_SNAPSHOT, dayKey: getLocalDayKey(now) }, now);
  }
}

export function persistActivitySnapshot(snapshot: ActivityExpSnapshot): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

export function computeActivityExp(activeSeconds: number, inputEvents: number): number {
  const activeMinutes = Math.max(0, activeSeconds) / 60;
  const signalScore = activeMinutes * ACTIVE_MINUTE_WEIGHT + Math.max(0, inputEvents) / INPUT_EVENT_DIVISOR;
  return Math.max(0, Math.floor(signalScore));
}

export function grantActivityExp(
  snapshot: ActivityExpSnapshot,
  activeSeconds: number,
  inputEvents: number,
  now: Date,
): { snapshot: ActivityExpSnapshot; gainedExp: number } {
  const rolled = rolloverSnapshot(snapshot, now);
  if (!rolled.enabled) {
    return { snapshot: rolled, gainedExp: 0 };
  }

  const rawExp = computeActivityExp(activeSeconds, inputEvents);
  if (rawExp <= 0) {
    return { snapshot: rolled, gainedExp: 0 };
  }

  const remainingCap = Math.max(0, DAILY_ACTIVITY_EXP_CAP - rolled.dailyActivityExp);
  const gainedExp = Math.min(rawExp, remainingCap);
  if (gainedExp <= 0) {
    return { snapshot: rolled, gainedExp: 0 };
  }

  const next: ActivityExpSnapshot = {
    ...rolled,
    dailyActivityExp: rolled.dailyActivityExp + gainedExp,
    totalGrantedExp: rolled.totalGrantedExp + gainedExp,
  };
  return { snapshot: next, gainedExp };
}

export function setActivityEnabled(
  snapshot: ActivityExpSnapshot,
  enabled: boolean,
  now: Date,
): ActivityExpSnapshot {
  const rolled = rolloverSnapshot(snapshot, now);
  return { ...rolled, enabled };
}

export function grantFallbackExp(
  snapshot: ActivityExpSnapshot,
  now: Date,
): { snapshot: ActivityExpSnapshot; gainedExp: number; reason: string } {
  const rolled = rolloverSnapshot(snapshot, now);
  const remainingCap = Math.max(0, DAILY_FALLBACK_EXP_CAP - rolled.dailyFallbackExp);
  if (remainingCap <= 0) {
    return { snapshot: rolled, gainedExp: 0, reason: 'fallback-cap' };
  }

  if (rolled.lastFallbackAt) {
    const elapsed = now.getTime() - Date.parse(rolled.lastFallbackAt);
    if (elapsed < FALLBACK_COOLDOWN_MS) {
      return { snapshot: rolled, gainedExp: 0, reason: 'fallback-cooldown' };
    }
  }

  const gainedExp = Math.min(FALLBACK_EXP_GRANT, remainingCap);
  const next: ActivityExpSnapshot = {
    ...rolled,
    dailyFallbackExp: rolled.dailyFallbackExp + gainedExp,
    totalGrantedExp: rolled.totalGrantedExp + gainedExp,
    lastFallbackAt: now.toISOString(),
  };
  return { snapshot: next, gainedExp, reason: 'ok' };
}

export function resetActivityContribution(
  snapshot: ActivityExpSnapshot,
  now: Date,
): { snapshot: ActivityExpSnapshot; expDelta: number } {
  const rolled = rolloverSnapshot(snapshot, now);
  if (rolled.totalGrantedExp <= 0) {
    return { snapshot: rolled, expDelta: 0 };
  }

  return {
    snapshot: {
      ...rolled,
      totalGrantedExp: 0,
      dailyActivityExp: 0,
      dailyFallbackExp: 0,
      lastFallbackAt: null,
    },
    expDelta: -rolled.totalGrantedExp,
  };
}
