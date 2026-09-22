import type { FleetState, StockMovement } from "../types";
import { SCHEMA_VERSION } from "./schema";

/**
 * 种子数据：车辆、备件、库存流水、工单各归其位。
 * 库存数量不在任何对象上冗余，全部由 movements 汇总；
 * 预占数量由 reservations 汇总。刷新后台账与记录必然一致。
 */
export function createSeedState(): FleetState {
  const now = Date.now();
  const iso = (offsetMinutes: number) => new Date(now - offsetMinutes * 60000).toISOString();

  const vehicles: FleetState["vehicles"] = [
    {
      id: "v-001",
      plate: "沪A-82L6",
      driver: "董飞",
      zone: "城北",
      taskStatus: "空闲",
      taskName: "",
      taskAssignedAt: null,
      mileage: 128400,
      note: "常规保养已完成，可派车"
    },
    {
      id: "v-002",
      plate: "沪B-73K9",
      driver: "周航",
      zone: "城东",
      taskStatus: "执行中",
      taskName: "医药配送",
      taskAssignedAt: iso(150),
      mileage: 86520,
      note: "预计17:30返回"
    },
    {
      id: "v-003",
      plate: "沪C-51T2",
      driver: "林雪",
      zone: "城南",
      taskStatus: "空闲",
      taskName: "",
      taskAssignedAt: null,
      mileage: 203110,
      note: "制动异响，已开维修单"
    }
  ];

  const parts: FleetState["parts"] = [
    { id: "p-001", code: "OP-10W40-4L", name: "机油", spec: "10W-40 4L/桶", unit: "桶" },
    { id: "p-002", code: "FL-OIL-01", name: "机油滤芯", spec: "通用型", unit: "个" },
    { id: "p-003", code: "BR-PAD-F", name: "前刹车片", spec: "盘式 前轮", unit: "副" },
    { id: "p-004", code: "TP-215-R16", name: "轮胎", spec: "215/75 R16", unit: "条" },
    { id: "p-005", code: "BR-DISC-F", name: "前刹车盘", spec: "通风盘", unit: "个" }
  ];

  // 入库：机油4 / 机滤10 / 刹车片6 / 轮胎4 / 刹车盘2
  const movements: StockMovement[] = [
    { id: "m-seed-1", partId: "p-001", type: "入库", qty: 4, reason: "期初入库", at: iso(60 * 24 * 30) },
    { id: "m-seed-2", partId: "p-002", type: "入库", qty: 10, reason: "期初入库", at: iso(60 * 24 * 30) },
    { id: "m-seed-3", partId: "p-003", type: "入库", qty: 6, reason: "期初入库", at: iso(60 * 24 * 30) },
    { id: "m-seed-4", partId: "p-004", type: "入库", qty: 4, reason: "期初入库", at: iso(60 * 24 * 30) },
    { id: "m-seed-5", partId: "p-005", type: "入库", qty: 2, reason: "期初入库", at: iso(60 * 24 * 30) },
    // o-001 常规保养已核销：机油×1、机滤×1
    { id: "m-seed-6", partId: "p-001", type: "核销", qty: 1, orderId: "o-001", reason: "常规保养", at: iso(60 * 24 * 5) },
    { id: "m-seed-7", partId: "p-002", type: "核销", qty: 1, orderId: "o-001", reason: "常规保养", at: iso(60 * 24 * 5) }
  ];

  // o-002 已预占前刹车盘×2（全部库存），等待核销台确认
  const reservations: FleetState["reservations"] = [
    {
      id: "r-seed-1",
      partId: "p-005",
      orderId: "o-002",
      qty: 2,
      reason: "更换前刹车盘",
      at: iso(200)
    }
  ];

  const orders: FleetState["orders"] = [
    {
      id: "o-003",
      code: "WX-20260922-02",
      vehicleId: "v-001",
      title: "全车制动片更换",
      reason: "制动片磨损到限位，年检前更换",
      emergency: false,
      status: "待料",
      createdAt: iso(120),
      startedAt: iso(110),
      recall: null,
      parts: [],
      pendingParts: [{ partId: "p-003", qty: 6 }],
      shortages: [{ partId: "p-003", need: 6, available: 6 - 2 }],
      finish: null,
      versions: [],
      timeline: [
        { at: iso(120), action: "创建工单", detail: "全车制动片更换" },
        { at: iso(110), action: "开工" },
        {
          at: iso(90),
          action: "缺件转待料",
          detail: "需求 前刹车片×6，已释放本次预占；不足：前刹车片 需6 可用4"
        }
      ]
    },
    {
      id: "o-002",
      code: "WX-20260922-01",
      vehicleId: "v-003",
      title: "更换前刹车盘",
      reason: "制动抖动，检查发现前刹车盘起槽",
      emergency: false,
      status: "在修",
      createdAt: iso(300),
      startedAt: iso(260),
      recall: null,
      parts: [],
      pendingParts: [],
      shortages: [],
      finish: null,
      versions: [],
      timeline: [
        { at: iso(300), action: "创建工单", detail: "更换前刹车盘" },
        { at: iso(260), action: "开工" },
        { at: iso(200), action: "预占备件", detail: "前刹车盘×2（待核销确认）" }
      ]
    },
    {
      id: "o-001",
      code: "WX-20260917-01",
      vehicleId: "v-001",
      title: "常规保养：换机油机滤",
      reason: "行驶满1万公里例行保养",
      emergency: false,
      status: "已完成",
      createdAt: iso(60 * 24 * 5),
      startedAt: iso(60 * 24 * 5),
      recall: null,
      parts: [
        { partId: "p-001", qty: 1 },
        { partId: "p-002", qty: 1 }
      ],
      pendingParts: [],
      shortages: [],
      finish: {
        at: iso(60 * 24 * 5),
        mileage: 128400,
        inspectPass: true,
        inspectNote: "油位正常，无渗漏",
        oldPartsReturned: "旧机油1桶、旧机滤1个已回收（回收单 HS-20260917-03）"
      },
      versions: [],
      timeline: [
        { at: iso(60 * 24 * 5), action: "创建工单", detail: "常规保养" },
        { at: iso(60 * 24 * 5), action: "开工" },
        { at: iso(60 * 24 * 5), action: "核销备件", detail: "机油×1，机油滤芯×1" },
        { at: iso(60 * 24 * 5), action: "完工合格", detail: "里程 128400 km，旧件已回收" }
      ]
    }
  ];

  return { schemaVersion: SCHEMA_VERSION, vehicles, parts, orders, movements, reservations };
}
