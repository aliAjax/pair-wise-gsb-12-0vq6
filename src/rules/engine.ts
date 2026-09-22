import type {
  AmendVersion,
  FinishRecord,
  FleetState,
  PartLine,
  RepairOrder,
  Reservation,
  Shortage,
  StockMovement,
  Vehicle,
  VehiclePhase
} from "../types";

/**
 * 规则引擎：所有业务不变量集中在本文件，以纯函数实现。
 * 不依赖 Vue / Pinia / DOM，方便单测；界面与状态层只能通过这里改变数据。
 *
 * 不变量：
 *  R1 执行中车辆不能报修；紧急报修必须先回收任务并写明原因
 *  R2 同一车辆同一时刻最多一张非完成工单（在修 / 待修 / 待料）
 *  R3 备件领用不能超过库存；库存全部由流水汇总，核销立即扣减
 *  R4 缺件时整张领用单转为待料，已占数量全部释放（退库流水）
 *  R5 完工必须录里程、质检结论、旧件回收；质检不合格退回待修
 *  R6 合格完工后冻结备件与里程；补录只追加带原因的版本
 */

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}

let seq = 0;
export function uid(prefix: string): string {
  seq = (seq + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

// ---------- 派生查询（只读） ----------

export function stockOf(state: FleetState, partId: string): number {
  return state.movements.reduce((sum, m) => {
    if (m.partId !== partId) return sum;
    if (m.type === "核销") return sum - m.qty;
    return sum + m.qty; // 入库 / 退库
  }, 0);
}

/** 该备件被未完成领用单预占的数量 */
export function reservedOf(state: FleetState, partId: string): number {
  return state.reservations
    .filter((r) => r.partId === partId)
    .reduce((sum, r) => sum + r.qty, 0);
}

/** 可用库存 = 结存 − 预占；任何领用都不能超过它（R3） */
export function availableOf(state: FleetState, partId: string): number {
  return stockOf(state, partId) - reservedOf(state, partId);
}

export interface StockRow {
  partId: string;
  onHand: number;
  reserved: number;
  available: number;
}

export function stockMap(state: FleetState): Record<string, number> {
  const map: Record<string, number> = {};
  for (const p of state.parts) map[p.id] = 0;
  for (const m of state.movements) {
    map[m.partId] ??= 0;
    map[m.partId] += m.type === "核销" ? -m.qty : m.qty;
  }
  for (const r of state.reservations) map[r.partId] = (map[r.partId] ?? 0) - r.qty;
  return map;
}

/** 某工单当前已预占、待确认核销的领用行 */
export function reservationsOfOrder(state: FleetState, orderId: string): PartLine[] {
  const map: Record<string, number> = {};
  for (const r of state.reservations) {
    if (r.orderId === orderId) map[r.partId] = (map[r.partId] ?? 0) + r.qty;
  }
  return Object.entries(map).map(([partId, qty]) => ({ partId, qty }));
}

/** 库存台账：结存 / 预占 / 可用三列全部由流水与预占台账派生 */
export function stockRows(state: FleetState): StockRow[] {
  return state.parts.map((p) => {
    const onHand = stockOf(state, p.id);
    const reserved = reservedOf(state, p.id);
    return { partId: p.id, onHand, reserved, available: onHand - reserved };
  });
}

/** 车辆在修工单（任意非完成状态），R2 的判定依据 */
export function openOrderOf(state: FleetState, vehicleId: string): RepairOrder | undefined {
  return state.orders.find((o) => o.vehicleId === vehicleId && o.status !== "已完成");
}

export function isDown(state: FleetState, vehicleId: string): boolean {
  return Boolean(openOrderOf(state, vehicleId));
}

/** 保养停机是派生阶段：有非完成工单即为停机 */
export function phaseOf(state: FleetState, vehicle: Vehicle): VehiclePhase {
  return isDown(state, vehicle.id) ? "保养停机" : vehicle.taskStatus;
}

/** 汇总领用需求与可用库存（结存−预占）的差额 */
export function computeShortages(state: FleetState, lines: PartLine[]): Shortage[] {
  const need: Record<string, number> = {};
  for (const line of lines) need[line.partId] = (need[line.partId] ?? 0) + line.qty;
  const result: Shortage[] = [];
  for (const partId of Object.keys(need)) {
    const available = availableOf(state, partId);
    if (available < need[partId]) {
      result.push({ partId, need: need[partId], available: Math.max(0, available) });
    }
  }
  return result;
}

export function partName(state: FleetState, partId: string): string {
  return state.parts.find((p) => p.id === partId)?.name ?? partId;
}

// ---------- 写操作（均为纯函数：返回新状态，不修改入参） ----------

function clone(state: FleetState): FleetState {
  return structuredClone(state);
}

function pushMovement(
  state: FleetState,
  partId: string,
  type: StockMovement["type"],
  qty: number,
  extra?: { orderId?: string; reason?: string }
) {
  state.movements.push({ id: uid("m"), partId, type, qty, at: new Date().toISOString(), ...extra });
}

function addEvent(order: RepairOrder, action: string, detail?: string) {
  order.timeline.push({ at: new Date().toISOString(), action, detail });
}

function genOrderCode(state: FleetState): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const count = state.orders.filter((o) => o.code.includes(ymd)).length + 1;
  return `WX-${ymd}-${String(count).padStart(2, "0")}`;
}

function describeLines(state: FleetState, lines: PartLine[]): string {
  return lines.map((l) => `${partName(state, l.partId)}×${l.qty}`).join("，");
}

/** 派工：停机车辆不允许再派 */
export function assignTask(
  state: FleetState,
  vehicleId: string,
  taskName: string
): FleetState {
  const next = clone(state);
  const v = next.vehicles.find((x) => x.id === vehicleId);
  if (!v) throw new RuleError("车辆不存在");
  if (isDown(next, vehicleId)) throw new RuleError("车辆保养停机中，不能派工");
  v.taskStatus = "执行中";
  v.taskName = taskName.trim();
  v.taskAssignedAt = new Date().toISOString();
  return next;
}

/** 回收调度任务（用于紧急报修前置），原因必填 */
export function recallTask(
  state: FleetState,
  vehicleId: string,
  reason: string
): FleetState {
  const next = clone(state);
  const v = next.vehicles.find((x) => x.id === vehicleId);
  if (!v) throw new RuleError("车辆不存在");
  if (v.taskStatus !== "执行中") throw new RuleError("该车辆当前没有执行中的任务");
  if (!reason.trim()) throw new RuleError("紧急报修必须写明回收任务的原因");
  v.taskStatus = "空闲";
  v.taskName = "";
  v.taskAssignedAt = null;
  return next;
}

export interface CreateOrderInput {
  vehicleId: string;
  title: string;
  reason: string;
  emergency: boolean;
  /** emergency=true 时必填：回收任务原因 */
  recallReason?: string;
}

/**
 * 报修（R1/R2）：
 * - 执行中车辆不能直接报修
 * - 紧急报修先回收任务（reason 必填），并在工单留存回收记录
 * - 每车只允许一张在修单
 */
export function createOrder(input: CreateOrderInput, state: FleetState): FleetState {
  const next = clone(state);
  const vehicle = next.vehicles.find((v) => v.id === input.vehicleId);
  if (!vehicle) throw new RuleError("车辆不存在");
  if (openOrderOf(next, input.vehicleId)) {
    throw new RuleError("该车辆已有一张在修工单，单车同一时间只能保留一张在修单");
  }
  if (vehicle.taskStatus === "执行中") {
    if (!input.emergency) {
      throw new RuleError("车辆执行中任务，不能报修；确需报修请走紧急报修并先回收任务");
    }
    if (!input.recallReason?.trim()) {
      throw new RuleError("紧急报修必须先回收任务并写明原因");
    }
  }

  let recall: RepairOrder["recall"] = null;
  if (input.emergency && vehicle.taskStatus === "执行中") {
    recall = {
      at: new Date().toISOString(),
      taskName: vehicle.taskName,
      reason: input.recallReason!.trim()
    };
    // 先回收任务
    vehicle.taskStatus = "空闲";
    vehicle.taskName = "";
    vehicle.taskAssignedAt = null;
  }

  const now = new Date().toISOString();
  const order: RepairOrder = {
    id: uid("o"),
    code: genOrderCode(next),
    vehicleId: input.vehicleId,
    title: input.title.trim(),
    reason: input.reason.trim(),
    emergency: input.emergency,
    status: "待修",
    createdAt: now,
    startedAt: null,
    recall,
    parts: [],
    pendingParts: [],
    shortages: [],
    finish: null,
    versions: [],
    timeline: [
      {
        at: now,
        action: "创建工单",
        detail: input.emergency
          ? `紧急报修${recall ? `；已回收任务「${recall.taskName}」，原因：${recall.reason}` : ""}`
          : undefined
      }
    ]
  };
  next.orders.unshift(order);
  return next;
}

/** 开工：待修 → 在修 */
export function startOrder(state: FleetState, orderId: string): FleetState {
  const next = clone(state);
  const order = mustGetOpen(next, orderId);
  if (order.status !== "待修") throw new RuleError("只有待修工单可以开工");
  order.status = "在修";
  order.startedAt = new Date().toISOString();
  addEvent(order, "开工");
  return next;
}

/**
 * 备件领用与核销（R3/R4）采用两阶段模型：
 *   申请领用 → 原子预占（逐行占用可用库存）→ 核销台确认 → 生成核销流水
 * 任一行可用库存不足时，回滚本次申请已预占的全部数量（释放已占），工单转待料。
 */

interface ReserveResult {
  ok: boolean;
  shortages: Shortage[];
  made: string[];
}

/**
 * 逐行预占：任一行可用数量不足即失败。
 * 失败时把本次已经写入的预占记录全部移除（释放已占数量）。
 */
function tryReserve(state: FleetState, order: RepairOrder, lines: PartLine[]): ReserveResult {
  const made: Reservation[] = [];
  for (const line of lines) {
    const available = availableOf(state, line.partId);
    if (line.qty > available) {
      // 回滚本次已占数量
      const madeIds = new Set(made.map((r) => r.id));
      state.reservations = state.reservations.filter((r) => !madeIds.has(r.id));
      return {
        ok: false,
        made: [],
        shortages: [{ partId: line.partId, need: line.qty, available: Math.max(0, available) }]
      };
    }
    const record: Reservation = {
      id: uid("r"),
      partId: line.partId,
      orderId: order.id,
      qty: line.qty,
      reason: order.title,
      at: new Date().toISOString()
    };
    state.reservations.push(record);
    made.push(record);
  }
  return { ok: true, shortages: [], made: made.map((r) => r.id) };
}

/**
 * 申请领用备件（在修工单）：
 * - 全部可满足 → 预占成功，备件进入「待核销」，等待核销台确认
 * - 存在缺件 → 本次预占全部释放，工单转「待料」并登记 pendingParts
 */
export function requestParts(
  state: FleetState,
  orderId: string,
  requested: PartLine[]
): FleetState {
  const lines = requested
    .map((l) => ({ partId: l.partId, qty: Math.floor(l.qty) }))
    .filter((l) => l.qty > 0);
  if (lines.length === 0) throw new RuleError("请至少填写一项领用备件及数量");

  const next = clone(state);
  const order = mustGetOpen(next, orderId);
  if (order.status !== "在修") throw new RuleError("只有在修工单可以领用备件");

  const result = tryReserve(next, order, lines);
  if (!result.ok) {
    order.status = "待料";
    order.pendingParts = mergeLines([...order.pendingParts, ...lines]);
    order.shortages = result.shortages;
    addEvent(
      order,
      "缺件转待料",
      `需求 ${describeLines(next, lines)}，已释放本次预占；不足：${result.shortages
        .map((s) => `${partName(next, s.partId)} 需${s.need} 可用${s.available}`)
        .join("，")}`
    );
    return next;
  }

  order.shortages = [];
  addEvent(order, "预占备件", `${describeLines(next, lines)}（待核销确认）`);
  return next;
}

/**
 * 核销台确认：把工单已预占的备件转成核销流水并冻结进工单明细。
 * 核销后该批数量才真正出库。
 */
export function confirmIssue(
  state: FleetState,
  orderId: string,
  lines?: PartLine[]
): FleetState {
  const next = clone(state);
  const order = mustGetOpen(next, orderId);
  if (order.status !== "在修") throw new RuleError("只有在修工单可以核销备件");

  const held = reservationsOfOrder(next, orderId);
  if (held.length === 0) throw new RuleError("该工单没有待核销的预占备件");

  // 默认核销全部预占；传入 lines 时只核销指定数量（不能超过预占）
  let targets = held;
  if (lines) {
    targets = mergeLines(lines.filter((l) => l.qty > 0));
    for (const t of targets) {
      const heldQty = held.find((h) => h.partId === t.partId)?.qty ?? 0;
      if (t.qty > heldQty) {
        throw new RuleError(`${partName(next, t.partId)} 核销数量不能超过预占数量 ${heldQty}`);
      }
    }
  }

  for (const t of targets) {
    let remain = t.qty;
    // 按时间顺序扣减该工单的预占记录
    for (const r of [...next.reservations].sort((a, b) => a.at.localeCompare(b.at))) {
      if (r.orderId !== order.id || r.partId !== t.partId || remain === 0) continue;
      const take = Math.min(remain, r.qty);
      r.qty -= take;
      remain -= take;
    }
    next.reservations = next.reservations.filter((r) => r.qty > 0);
    pushMovement(next, t.partId, "核销", t.qty, { orderId: order.id, reason: order.title });
  }
  order.parts = mergeLines([...order.parts, ...targets]);
  addEvent(order, "核销备件", describeLines(next, targets));
  return next;
}

/** 释放工单的预占数量（全部或指定行），可用库存随即恢复 */
export function releaseReserved(
  state: FleetState,
  orderId: string,
  lines?: PartLine[]
): FleetState {
  const next = clone(state);
  const order = mustGetOpen(next, orderId);
  const held = reservationsOfOrder(next, orderId);
  if (held.length === 0) throw new RuleError("该工单没有已预占数量");

  if (!lines) {
    next.reservations = next.reservations.filter((r) => r.orderId !== orderId);
    addEvent(order, "释放预占", describeLines(next, held));
    return next;
  }

  const selected = mergeLines(lines.filter((l) => l.qty > 0));
  for (const s of selected) {
    const heldQty = held.find((h) => h.partId === s.partId)?.qty ?? 0;
    if (s.qty > heldQty) {
      throw new RuleError(`${partName(next, s.partId)} 释放数量不能超过预占数量 ${heldQty}`);
    }
    let remain = s.qty;
    for (const r of [...next.reservations].sort((a, b) => b.at.localeCompare(a.at))) {
      if (r.orderId !== orderId || r.partId !== s.partId || remain === 0) continue;
      const take = Math.min(remain, r.qty);
      r.qty -= take;
      remain -= take;
    }
  }
  next.reservations = next.reservations.filter((r) => r.qty > 0);
  addEvent(order, "释放预占", describeLines(next, selected));
  return next;
}

/**
 * 待料复工：备件到货后按 pendingParts 重新尝试预占。
 * - 全部满足 → 预占后直接核销（本次申请原子完成），回到在修
 * - 仍缺件 → 回滚已占数量，保持待料
 */
export function retryPending(state: FleetState, orderId: string): FleetState {
  const next = clone(state);
  const order = mustGetOpen(next, orderId);
  if (order.status !== "待料") throw new RuleError("只有待料工单可以申请复工");
  if (order.pendingParts.length === 0) throw new RuleError("没有待料备件需求");

  const lines = order.pendingParts;
  const result = tryReserve(next, order, lines);
  if (!result.ok) {
    order.shortages = result.shortages;
    addEvent(
      order,
      "复工失败仍待料",
      `不足：${result.shortages
        .map((s) => `${partName(next, s.partId)} 需${s.need} 可用${s.available}`)
        .join("，")}；已释放本次预占`
    );
    return next;
  }

  // 预占全部成功：直接转为核销流水
  for (const line of lines) {
    pushMovement(next, line.partId, "核销", line.qty, { orderId: order.id, reason: order.title });
  }
  next.reservations = next.reservations.filter((r) => r.orderId !== order.id);
  order.parts = mergeLines([...order.parts, ...lines]);
  addEvent(order, "待料补齐核销", describeLines(next, lines));
  order.pendingParts = [];
  order.shortages = [];
  order.status = "在修";
  addEvent(order, "复工");
  return next;
}

/** 释放待料需求：不再等待缺件，清空 pendingParts 并留痕 */
export function releasePending(state: FleetState, orderId: string): FleetState {
  const next = clone(state);
  const order = mustGetOpen(next, orderId);
  if (order.status !== "待料") throw new RuleError("只有待料工单可以释放待料");
  if (order.pendingParts.length === 0) throw new RuleError("无待料数量可释放");
  const released = order.pendingParts;
  order.pendingParts = [];
  order.shortages = [];
  order.status = "在修";
  addEvent(order, "取消待料并释放需求", describeLines(next, released));
  return next;
}

/** 备件入库（库存由流水增加） */
export function receiveStock(
  state: FleetState,
  partId: string,
  qty: number,
  reason: string
): FleetState {
  if (qty <= 0) throw new RuleError("入库数量必须大于 0");
  const next = clone(state);
  if (!next.parts.some((p) => p.id === partId)) throw new RuleError("备件不存在");
  pushMovement(next, partId, "入库", Math.floor(qty), { reason: reason.trim() || "采购入库" });
  return next;
}

export interface FinishInput {
  mileage: number;
  inspectPass: boolean;
  inspectNote: string;
  oldPartsReturned: string;
}

/**
 * 完工（R5）：里程、质检、旧件回收三项必填。
 * - 质检不合格：退回待修，不写入完工冻结记录，里程不变
 * - 质检合格：冻结备件与里程，工单完成；待料需求或未核销预占须先处理
 */
export function finishOrder(state: FleetState, orderId: string, input: FinishInput): FleetState {
  const next = clone(state);
  const order = mustGetOpen(next, orderId);
  if (order.status === "待料") throw new RuleError("待料工单不能完工，请先复工或取消待料");
  const held = reservationsOfOrder(next, orderId);
  if (held.length > 0) {
    throw new RuleError("还有已预占未核销的备件，请先在核销台确认核销或释放");
  }

  const mileage = Math.floor(input.mileage);
  if (!Number.isFinite(mileage) || mileage < 0) throw new RuleError("请录入完工里程");
  const vehicle = next.vehicles.find((v) => v.id === order.vehicleId);
  if (vehicle && mileage < vehicle.mileage) {
    throw new RuleError(`完工里程不能小于车辆当前里程 ${vehicle.mileage} km`);
  }
  if (!input.oldPartsReturned.trim()) throw new RuleError("必须填写旧件回收记录");
  if (!input.inspectNote.trim()) throw new RuleError("请填写质检意见");

  if (!input.inspectPass) {
    order.status = "待修";
    order.shortages = [];
    addEvent(
      order,
      "质检不合格退回待修",
      `里程 ${mileage} km；质检意见：${input.inspectNote.trim()}`
    );
    return next;
  }

  const record: FinishRecord = {
    at: new Date().toISOString(),
    mileage,
    inspectPass: true,
    inspectNote: input.inspectNote.trim(),
    oldPartsReturned: input.oldPartsReturned.trim()
  };
  order.finish = record;
  order.status = "已完成";
  if (vehicle) vehicle.mileage = mileage;
  addEvent(order, "完工合格", `里程 ${mileage} km，备件与里程已冻结，旧件已回收`);
  return next;
}

/**
 * 补录（R6）：仅已完成工单可补录。
 * - 原始完工快照与已核销流水永不改写
 * - 里程补录追加版本并同步车辆当前里程（需≥当前）
 * - 备件补领生成核销流水、退回生成退库流水，全部挂在新版本上
 */
export interface AmendInput {
  reason: string;
  mileage: number;
  partDeltas: PartLine[];
  oldPartsReturned: string;
}

export function amendOrder(state: FleetState, orderId: string, input: AmendInput): FleetState {
  if (!input.reason.trim()) throw new RuleError("补录必须写明原因");
  const mileage = Math.floor(input.mileage);
  if (!Number.isFinite(mileage) || mileage < 0) throw new RuleError("请录入补录里程");

  const next = clone(state);
  const order = next.orders.find((o) => o.id === orderId);
  if (!order) throw new RuleError("工单不存在");
  if (order.status !== "已完成" || !order.finish) {
    throw new RuleError("只有已完工工单可以补录");
  }
  const vehicle = next.vehicles.find((v) => v.id === order.vehicleId);
  if (vehicle && mileage < vehicle.mileage) {
    throw new RuleError(`补录里程不能小于车辆当前里程 ${vehicle.mileage} km`);
  }

  const deltas = input.partDeltas
    .map((d) => ({ partId: d.partId, qty: Math.sign(d.qty) * Math.floor(Math.abs(d.qty)) }))
    .filter((d) => d.qty !== 0);

  // 退库不能超过工单当前净核销（原始冻结核销 + 历次补录版本）
  const net: Record<string, number> = {};
  const acc = (partId: string, qty: number) => {
    net[partId] = (net[partId] ?? 0) + qty;
  };
  for (const l of order.parts) acc(l.partId, l.qty);
  // 用「当前工单」已有的版本计算（clone 后追加前）
  for (const v of order.versions) {
    for (const d of v.partDeltas) acc(d.partId, d.qty);
  }
  for (const d of deltas) {
    if (d.qty < 0 && (net[d.partId] ?? 0) < Math.abs(d.qty)) {
      throw new RuleError(`${partName(next, d.partId)} 退库数量超过该工单已核销数量`);
    }
    if (d.qty > 0 && availableOf(next, d.partId) < d.qty) {
      throw new RuleError(`${partName(next, d.partId)} 可用库存不足，无法补领`);
    }
  }

  const version: AmendVersion = {
    version: order.versions.length + 1,
    at: new Date().toISOString(),
    reason: input.reason.trim(),
    mileage,
    partDeltas: deltas,
    oldPartsReturned: input.oldPartsReturned.trim()
  };

  for (const d of deltas) {
    if (d.qty > 0) {
      pushMovement(next, d.partId, "核销", d.qty, { orderId: order.id, reason: `补录V${version.version}` });
    } else {
      pushMovement(next, d.partId, "退库", -d.qty, { orderId: order.id, reason: `补录V${version.version}` });
    }
  }
  order.versions.push(version);
  if (vehicle) vehicle.mileage = mileage;
  addEvent(
    order,
    `补录 V${version.version}`,
    `原因：${version.reason}；里程 ${mileage} km${
      deltas.length ? `；备件：${deltas.map((d) => `${partName(next, d.partId)}${d.qty > 0 ? "+" : ""}${d.qty}`).join("，")}` : ""
    }`
  );
  return next;
}

/** 工单的有效里程：完工快照 + 最新补录版本 */
export function effectiveMileage(order: RepairOrder): number {
  return order.versions.length
    ? order.versions[order.versions.length - 1].mileage
    : order.finish?.mileage ?? 0;
}

/** 工单的有效备件明细：原始核销合并所有补录版本后的净数量 */
export function effectiveParts(order: RepairOrder): PartLine[] {
  const net: Record<string, number> = {};
  for (const l of order.parts) net[l.partId] = (net[l.partId] ?? 0) + l.qty;
  for (const v of order.versions) {
    for (const d of v.partDeltas) net[d.partId] = (net[d.partId] ?? 0) + d.qty;
  }
  return Object.entries(net)
    .filter(([, qty]) => qty !== 0)
    .map(([partId, qty]) => ({ partId, qty }));
}

// ---------- 内部工具 ----------

function mustGetOpen(state: FleetState, orderId: string): RepairOrder {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) throw new RuleError("工单不存在");
  if (order.status === "已完成") throw new RuleError("工单已完工冻结，不能再执行该操作（如需调整请补录）");
  return order;
}

function mergeLines(lines: PartLine[]): PartLine[] {
  const map: Record<string, number> = {};
  for (const l of lines) map[l.partId] = (map[l.partId] ?? 0) + l.qty;
  return Object.entries(map).map(([partId, qty]) => ({ partId, qty }));
}
