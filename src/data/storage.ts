// ===== 数据层：localStorage 持久化 =====
// 职责仅限“存取整份快照”，不做任何业务判断。
import { createSeedState, SCHEMA_VERSION, STORAGE_KEY } from "./seed";
import type { FleetState } from "./types";

export function loadState(): FleetState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seed = createSeedState();
    saveState(seed);
    return seed;
  }
  try {
    const parsed = JSON.parse(raw) as FleetState;
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) {
      // 结构不兼容时回退到种子数据，保证刷新后状态自洽
      const seed = createSeedState();
      saveState(seed);
      return seed;
    }
    return normalize(parsed);
  } catch {
    const seed = createSeedState();
    saveState(seed);
    return seed;
  }
}

export function saveState(state: FleetState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/** 补齐后续版本可能新增的字段，避免读取旧存档时报错 */
function normalize(state: FleetState): FleetState {
  return {
    schemaVersion: SCHEMA_VERSION,
    seq: state.seq ?? 1,
    vehicles: state.vehicles ?? [],
    tasks: state.tasks ?? [],
    repairs: state.repairs ?? [],
    parts: state.parts ?? [],
    supplements: state.supplements ?? []
  };
}
