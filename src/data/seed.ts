// ===== 数据层：种子数据 =====
import type { FleetState } from "./types";

export const STORAGE_KEY = "dfwlfront-3-fleet-v2";
export const SCHEMA_VERSION = 2;

export function createSeedState(): FleetState {
  const now = Date.now();
  const iso = (offsetMin: number) => new Date(now - offsetMin * 60000).toISOString();

  return {
    schemaVersion: SCHEMA_VERSION,
    seq: 100,
    vehicles: [
      { id: "v-1", plate: "沪A-82L6", driver: "董飞", zone: "城北", mileage: 86420 },
      { id: "v-2", plate: "沪B-73K9", driver: "周航", zone: "城东", mileage: 120350 },
      { id: "v-3", plate: "沪C-55T2", driver: "李楠", zone: "城南", mileage: 45120 }
    ],
    tasks: [
      {
        id: "t-1",
        vehicleId: "v-2",
        name: "医药配送",
        zone: "城东",
        status: "执行中",
        createdAt: iso(180)
      },
      {
        id: "t-2",
        vehicleId: "v-1",
        name: "商超补货",
        zone: "城北",
        status: "已完成",
        createdAt: iso(24 * 60),
        completedAt: iso(20 * 60)
      }
    ],
    repairs: [],
    parts: [
      { id: "p-1", name: "机油滤清器", spec: "JX-0718", stock: 12 },
      { id: "p-2", name: "刹车片（前）", spec: "D1521", stock: 4 },
      { id: "p-3", name: "空气滤芯", spec: "K2845", stock: 8 },
      { id: "p-4", name: "启动马达", spec: "SM-12V", stock: 0 }
    ],
    supplements: []
  };
}
