import type { FleetState } from "../types";
import { SCHEMA_VERSION, STORAGE_KEY } from "./schema";
import { createSeedState } from "./seed";

/**
 * 持久化层：只负责与 localStorage 交互，不包含任何业务规则。
 * 读取时做最小结构校验；版本不符或数据损坏时回落到种子数据。
 */
function isStateLike(value: unknown): value is FleetState {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return (
    Array.isArray(s.vehicles) &&
    Array.isArray(s.parts) &&
    Array.isArray(s.orders) &&
    Array.isArray(s.movements) &&
    Array.isArray(s.reservations)
  );
}

export function loadState(): FleetState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return createSeedState();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isStateLike(parsed)) return createSeedState();
    // 未来版本迁移入口；当前版本直接使用
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      return { ...createSeedState(), ...parsed };
    }
    return parsed;
  } catch {
    return createSeedState();
  }
}

export function saveState(state: FleetState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetState(): FleetState {
  const seed = createSeedState();
  saveState(seed);
  return seed;
}
