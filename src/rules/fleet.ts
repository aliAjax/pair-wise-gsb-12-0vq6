// ===== 规则层：调度 / 报修 / 备件 / 完工 / 补录 的全部业务规则 =====
// 纯函数：直接修改传入的 state 草稿，违反规则时 throw Error（中文提示）。
// 不引用 Vue、localStorage、Naive UI，可独立单测。
import type {
  FleetState,
  Part,
  QcResult,
  RepairOrder,
  RepairStatus,
  Requisition,
  SupplementKind,
  Vehicle
} from "../data/types";

export class RuleError extends Error {}

export interface ActiveRepairInfo {
  order: RepairOrder;
  down: boolean;
}

// ---------- 基础查询（规则推导，不散落各处） ----------

export function genId(state: FleetState, prefix: string): string {
  state.seq += 1;
  return `${prefix}-${state.seq}`;
}

export function findVehicle(state: FleetState, vehicleId: string): Vehicle {
  const vehicle = state.vehicles.find((item) => item.id === vehicleId);
  if (!vehicle) throw new RuleError("车辆不存在");
  return vehicle;
}

export function findPart(state: FleetState, partId: string): Part {
  const part = state.parts.find((item) => item.id === partId);
  if (!part) throw new RuleError("备件不存在");
  return part;
}

export function findRepair(state: FleetState, orderId: string): RepairOrder {
  const order = state.repairs.find((item) => item.id === orderId);
  if (!order) throw new RuleError("维修单不存在");
  return order;
}

/** 全车队对某备件的占用数量（来自所有未关闭维修单的“占用”领用行） */
export function occupiedQty(state: FleetState, partId: string): number {
  return state.repairs
    .filter((order) => !order.frozen && order.status !== "已取消")
    .flatMap((order) => order.requisitions)
    .filter((line) => line.status === "占用" && line.partId === partId)
    .reduce((sum, line) => sum + line.qty, 0);
}

/** 可占用数量 = 库存 - 全车队占用 */
export function availableQty(state: FleetState, partId: string): number {
  const part = findPart(state, partId);
  return part.stock - occupiedQty(state, partId);
}

/** 单车在修单：status 非 已完工 / 已取消 即视为仍占用车辆 */
export function activeRepairOf(state: FleetState, vehicleId: string): RepairOrder | undefined {
  return state.repairs.find(
    (order) =>
      order.vehicleId === vehicleId &&
      order.status !== "已完工" &&
      order.status !== "已取消"
  );
}

export function activeTaskOf(state: FleetState, vehicleId: string) {
  return state.tasks.find((task) => task.vehicleId === vehicleId && task.status === "执行中");
}

/** 车辆是否停机（有未完结维修单；质检不合格、待料均继续停机） */
export function isDown(state: FleetState, vehicleId: string): boolean {
  return Boolean(activeRepairOf(state, vehicleId));
}

export const OPEN_STATUSES: RepairStatus[] = ["待修", "在修", "待料", "质检不合格"];

// ---------- 调度规则 ----------

export interface CreateTaskInput {
  vehicleId: string;
  name: string;
  zone: string;
}

export function createTask(state: FleetState, input: CreateTaskInput): string {
  findVehicle(state, input.vehicleId);
  if (activeTaskOf(state, input.vehicleId)) {
    throw new RuleError("该车辆已有执行中的任务");
  }
  // 停机车辆（在修 / 待料 / 质检不合格）不能派任务
  if (isDown(state, input.vehicleId)) {
    throw new RuleError("车辆处于保养停机状态，不能派发任务");
  }
  const id = genId(state, "t");
  state.tasks.unshift({
    id,
    vehicleId: input.vehicleId,
    name: input.name.trim(),
    zone: input.zone,
    status: "执行中",
    createdAt: new Date().toISOString()
  });
  return id;
}

export function completeTask(state: FleetState, taskId: string): void {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) throw new RuleError("任务不存在");
  if (task.status !== "执行中") throw new RuleError("只有执行中的任务可以完成");
  task.status = "已完成";
  task.completedAt = new Date().toISOString();
}

// ---------- 报修规则 ----------

export interface CreateRepairInput {
  vehicleId: string;
  title: string;
  faultDesc: string;
  emergency: boolean;
  /** 紧急且有执行中任务时必填 */
  recallReason: string;
}

export function createRepair(state: FleetState, input: CreateRepairInput): string {
  const vehicle = findVehicle(state, input.vehicleId);

  const task = activeTaskOf(state, input.vehicleId);
  if (task) {
    if (!input.emergency) {
      // 规则：执行中车辆不能报修
      throw new RuleError("该车辆任务执行中，不能报修；如确需报修请走紧急报修并回收任务");
    }
    const reason = input.recallReason.trim();
    if (reason.length < 5) {
      // 规则：紧急报修须先回收任务并写明原因
      throw new RuleError("紧急报修必须先回收任务，并填写不少于 5 个字的回收原因");
    }
    task.status = "已回收";
    task.recalledAt = new Date().toISOString();
    task.recallReason = reason;
  }

  // 规则：单车只保留一张在修单
  if (activeRepairOf(state, input.vehicleId)) {
    throw new RuleError(`车辆 ${vehicle.plate} 已有未完工的维修单，不能重复报修`);
  }

  const id = genId(state, "r");
  const order: RepairOrder = {
    id,
    vehicleId: input.vehicleId,
    title: input.title.trim(),
    faultDesc: input.faultDesc.trim(),
    emergency: input.emergency,
    status: "待修",
    requisitions: [],
    createdAt: new Date().toISOString(),
    frozen: false
  };
  state.repairs.unshift(order);
  return id;
}

/** 待修 / 质检不合格 → 在修 */
export function startRepair(state: FleetState, orderId: string): void {
  const order = findRepair(state, orderId);
  if (order.status !== "待修" && order.status !== "质检不合格") {
    throw new RuleError("只有待修（含质检退回）的工单可以开工");
  }
  order.status = "在修";
  if (!order.startedAt) order.startedAt = new Date().toISOString();
}

/** 质检不合格后手动确认退回待修 */
export function backToPending(state: FleetState, orderId: string): void {
  const order = findRepair(state, orderId);
  if (order.status !== "质检不合格") throw new RuleError("只有质检不合格的工单可以退回待修");
  order.status = "待修";
}

export function cancelRepair(state: FleetState, orderId: string): void {
  const order = findRepair(state, orderId);
  if (order.frozen) throw new RuleError("已完工冻结的工单不能取消");
  releaseAllHolds(state, order);
  order.status = "已取消";
  order.canceledAt = new Date().toISOString();
}

// ---------- 备件规则 ----------

export function occupyPart(
  state: FleetState,
  orderId: string,
  partId: string,
  qty: number
): string {
  const order = findRepair(state, orderId);
  if (order.frozen) throw new RuleError("工单已冻结，不能再领用备件");
  if (order.status === "已取消") throw new RuleError("工单已取消");
  if (!Number.isInteger(qty) || qty <= 0) throw new RuleError("领用数量必须为正整数");

  const part = findPart(state, partId);
  // 同一工单内对同备件的占用合并计算，避免拆单行绕过库存校验
  const ownHeld = order.requisitions
    .filter((line) => line.status === "占用" && line.partId === partId)
    .reduce((sum, line) => sum + line.qty, 0);
  const othersHeld = occupiedQty(state, partId) - ownHeld;
  if (part.stock - othersHeld - ownHeld - qty < 0) {
    // 规则：备件领用不能超过库存
    throw new RuleError(
      `库存不足：${part.name} 库存 ${part.stock}，已占用 ${othersHeld + ownHeld}，本次再领 ${qty}`
    );
  }

  const id = genId(state, "q");
  const line: Requisition = {
    id,
    partId: part.id,
    partName: part.name,
    qty,
    status: "占用",
    createdAt: new Date().toISOString()
  };
  order.requisitions.push(line);
  return id;
}

/** 占用 → 已领用：真正核销库存 */
export function issueRequisition(state: FleetState, orderId: string, lineId: string): void {
  const order = findRepair(state, orderId);
  const line = order.requisitions.find((item) => item.id === lineId);
  if (!line) throw new RuleError("领用记录不存在");
  if (line.status !== "占用") throw new RuleError("只有占用中的备件可以领用核销");
  const part = findPart(state, line.partId);
  if (part.stock < line.qty) {
    // 占用期间库存被盘点调减等极端情况，兜底拦截
    throw new RuleError(`库存不足，无法核销 ${part.name}（库存 ${part.stock}，需 ${line.qty}）`);
  }
  part.stock -= line.qty;
  line.status = "已领用";
  line.issuedAt = new Date().toISOString();
}

function releaseLine(line: Requisition): void {
  if (line.status !== "占用") return;
  line.status = "已释放";
  line.releasedAt = new Date().toISOString();
}

/** 释放工单上全部“占用”数量（取消 / 缺件转待料 / 完工时使用） */
export function releaseAllHolds(state: FleetState, order: RepairOrder): void {
  order.requisitions.forEach(releaseLine);
}

export interface ShortfallInput {
  partId: string;
  qty: number;
}

/**
 * 规则：缺件转为待料，并释放已占数量。
 * 登记缺件信息，释放该工单全部占用，车辆继续停机。
 */
export function turnToWaiting(state: FleetState, orderId: string, input: ShortfallInput): void {
  const order = findRepair(state, orderId);
  if (order.frozen || order.status === "已取消") {
    throw new RuleError("当前工单状态不能转待料");
  }
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    throw new RuleError("缺件数量必须为正整数");
  }
  const part = findPart(state, input.partId);

  releaseAllHolds(state, order);
  order.status = "待料";
  order.waitingSince = new Date().toISOString();
  order.waitingPartId = part.id;
  order.waitingPartName = part.name;
  order.waitingQty = input.qty;
}

/** 待料 → 在修（备件到货/入库后复工） */
export function resumeFromWaiting(state: FleetState, orderId: string): void {
  const order = findRepair(state, orderId);
  if (order.status !== "待料") throw new RuleError("只有待料工单可以复工");
  const available = order.waitingPartId
    ? availableQty(state, order.waitingPartId)
    : Infinity;
  if (order.waitingQty && available < order.waitingQty) {
    throw new RuleError(
      `缺件仍不足：需要 ${order.waitingQty}，当前可用 ${available}，请先入库`
    );
  }
  order.status = "在修";
  if (!order.startedAt) order.startedAt = new Date().toISOString();
  order.waitingSince = undefined;
  order.waitingPartId = undefined;
  order.waitingPartName = undefined;
  order.waitingQty = undefined;
}

export function restockPart(state: FleetState, partId: string, qty: number): void {
  if (!Number.isInteger(qty) || qty <= 0) throw new RuleError("入库数量必须为正整数");
  const part = findPart(state, partId);
  part.stock += qty;
}

// ---------- 完工 / 质检 / 旧件 ----------

export interface CompleteInput {
  mileage: number;
  qcResult: QcResult;
  oldPartsReturned: number;
  qcNote?: string;
}

export function completeRepair(state: FleetState, orderId: string, input: CompleteInput): void {
  const order = findRepair(state, orderId);
  const vehicle = findVehicle(state, order.vehicleId);

  if (order.frozen) throw new RuleError("工单已完工冻结");
  if (order.status !== "在修") throw new RuleError("只有在修工单可以填报完工");
  if (!Number.isFinite(input.mileage) || input.mileage <= 0) {
    throw new RuleError("请录入有效里程");
  }
  if (input.mileage < vehicle.mileage) {
    throw new RuleError(`完工里程不能小于车辆当前里程 ${vehicle.mileage} km`);
  }
  if (!Number.isInteger(input.oldPartsReturned) || input.oldPartsReturned < 0) {
    throw new RuleError("旧件回收数量必须为不小于 0 的整数");
  }
  const issuedCount = order.requisitions.filter((line) => line.status === "已领用").length;
  if (issuedCount > 0 && input.oldPartsReturned < 1) {
    throw new RuleError("本单已领用备件，完工必须回收旧件（至少 1 件）");
  }

  if (input.qcResult === "不合格") {
    // 规则：质检不合格退回待修，不冻结、车辆继续停机
    order.status = "质检不合格";
    order.lastQc = {
      mileage: input.mileage,
      oldPartsReturned: input.oldPartsReturned,
      qcNote: input.qcNote?.trim(),
      at: new Date().toISOString()
    };
    return;
  }

  // 合格完工：未核销的占用不再使用，释放掉
  releaseAllHolds(state, order);

  order.status = "已完工";
  order.frozen = true;
  order.completion = {
    mileage: input.mileage,
    qcResult: "合格",
    oldPartsReturned: input.oldPartsReturned,
    qcNote: input.qcNote?.trim(),
    finishedAt: new Date().toISOString()
  };
  vehicle.mileage = input.mileage;
}

// ---------- 补录（冻结后只增版本） ----------

export interface SupplementInput {
  kind: SupplementKind;
  reason: string;
  mileage?: number;
  partId?: string;
  qty?: number;
}

export function addSupplement(state: FleetState, orderId: string, input: SupplementInput): string {
  const order = findRepair(state, orderId);
  // 规则：完工冻结后备件与里程不可改，补录只生成带原因版本
  if (!order.frozen) throw new RuleError("只有已完工冻结的工单需要补录");
  const reason = input.reason.trim();
  if (reason.length < 5) throw new RuleError("补录必须填写不少于 5 个字的原因");

  const version =
    state.supplements
      .filter((item) => item.orderId === orderId)
      .reduce((max, item) => Math.max(max, item.version), 0) + 1;

  const recordBase = {
    id: genId(state, "s"),
    orderId,
    version,
    kind: input.kind,
    reason,
    createdAt: new Date().toISOString()
  };

  if (input.kind === "里程补录") {
    if (!Number.isFinite(input.mileage) || !input.mileage || input.mileage <= 0) {
      throw new RuleError("请录入有效补录里程");
    }
    state.supplements.unshift({ ...recordBase, mileage: input.mileage });
  } else {
    if (!input.partId) throw new RuleError("请选择补录备件");
    if (!Number.isInteger(input.qty) || !input.qty || input.qty <= 0) {
      throw new RuleError("补录数量必须为正整数");
    }
    const part = findPart(state, input.partId);
    // 补录仅留痕版本：冻结单不扣库存、不改原领用行
    state.supplements.unshift({
      ...recordBase,
      partId: part.id,
      partName: part.name,
      qty: input.qty
    });
  }
  return recordBase.id;
}

// ---------- 一致性自检：刷新后任务/停机/库存/版本应自洽 ----------

export function auditState(state: FleetState): string[] {
  const problems: string[] = [];

  for (const part of state.parts) {
    const held = occupiedQty(state, part.id);
    if (held > part.stock) {
      problems.push(`备件「${part.name}」占用 ${held} 超过库存 ${part.stock}`);
    }
    if (part.stock < 0) problems.push(`备件「${part.name}」库存为负`);
  }

  for (const vehicle of state.vehicles) {
    const actives = state.repairs.filter(
      (order) =>
        order.vehicleId === vehicle.id &&
        order.status !== "已完工" &&
        order.status !== "已取消"
    );
    if (actives.length > 1) {
      problems.push(`车辆 ${vehicle.plate} 同时存在 ${actives.length} 张未完工维修单`);
    }
    const running = state.tasks.filter(
      (task) => task.vehicleId === vehicle.id && task.status === "执行中"
    );
    if (running.length > 1) problems.push(`车辆 ${vehicle.plate} 存在多个执行中任务`);
    if (actives.length > 0 && running.length > 0) {
      problems.push(`车辆 ${vehicle.plate} 停机与执行中任务并存`);
    }
  }

  for (const order of state.repairs) {
    if (order.frozen && order.status !== "已完工") {
      problems.push(`维修单 ${order.id} 已冻结但状态为 ${order.status}`);
    }
    const versions = state.supplements.filter((item) => item.orderId === order.id);
    if (!order.frozen && versions.length > 0) {
      problems.push(`维修单 ${order.id} 未冻结却存在补录版本`);
    }
    const nums = versions.map((item) => item.version).sort((a, b) => a - b);
    nums.forEach((num, index) => {
      if (num !== index + 1) problems.push(`维修单 ${order.id} 补录版本号不连续`);
    });
  }

  return problems;
}
