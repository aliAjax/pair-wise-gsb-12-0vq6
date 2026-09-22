// 领域模型：只描述数据结构，不包含任何规则或界面逻辑。

/** 车辆调度任务状态（保养停机由在修工单派生，见规则层 phaseOf） */
export type VehicleTaskStatus = "空闲" | "执行中" | "已完成";

/** 车辆当前所处阶段：保养停机为派生状态 */
export type VehiclePhase = VehicleTaskStatus | "保养停机";

/** 维修工单状态：待修 → 在修 →（缺件时）待料 → 已完成 */
export type RepairStatus = "待修" | "在修" | "待料" | "已完成";

/** 库存流水类型：入库为加，核销为减，退库为加 */
export type MovementType = "入库" | "核销" | "退库";

/**
 * 预占记录：领用申请逐行预占库存，整单满足后才转为核销；
 * 申请失败（缺件）时回滚本次预占。待料工单不占用库存。
 */
export interface Reservation {
  id: string;
  partId: string;
  orderId: string;
  qty: number;
  reason?: string;
  at: string;
}

export interface Vehicle {
  id: string;
  /** 车牌号 */
  plate: string;
  driver: string;
  zone: string;
  taskStatus: VehicleTaskStatus;
  taskName: string;
  taskAssignedAt: string | null;
  /** 当前里程，仅由工单完工 / 补录驱动 */
  mileage: number;
  note: string;
}

export interface Part {
  id: string;
  /** 备件编码 */
  code: string;
  name: string;
  spec: string;
  unit: string;
}

/**
 * 库存流水：库存不直接存数，全部由流水汇总得到，
 * 刷新后库存与核销/退库记录必然一致。
 */
export interface StockMovement {
  id: string;
  partId: string;
  type: MovementType;
  /** 恒为正数，方向由 type 决定 */
  qty: number;
  /** 关联工单号（核销 / 退库时） */
  orderId?: string;
  reason?: string;
  at: string;
}

export interface PartLine {
  partId: string;
  qty: number;
}

export interface TimelineEvent {
  at: string;
  action: string;
  detail?: string;
}

/** 紧急报修时回收调度任务的记录 */
export interface RecallInfo {
  at: string;
  /** 被回收的任务名称 */
  taskName: string;
  /** 回收原因（必填） */
  reason: string;
}

/** 完工记录：一旦合格完工即冻结 */
export interface FinishRecord {
  at: string;
  mileage: number;
  inspectPass: boolean;
  inspectNote: string;
  /** 旧件回收说明 / 回收单号（必填） */
  oldPartsReturned: string;
}

/** 补录版本：原始完工数据不动，补录只追加版本 */
export interface AmendVersion {
  version: number;
  at: string;
  /** 补录原因（必填） */
  reason: string;
  mileage: number;
  /** 备件调整：正数补领核销，负数退库 */
  partDeltas: PartLine[];
  oldPartsReturned: string;
}

export interface Shortage {
  partId: string;
  need: number;
  available: number;
}

export interface RepairOrder {
  id: string;
  /** 工单编号 WX-日期-序号 */
  code: string;
  vehicleId: string;
  /** 报修内容 */
  title: string;
  /** 报修原因 / 故障说明 */
  reason: string;
  emergency: boolean;
  status: RepairStatus;
  createdAt: string;
  startedAt: string | null;
  /** 紧急报修时的任务回收记录 */
  recall: RecallInfo | null;
  /** 已核销备件明细 */
  parts: PartLine[];
  /** 转待料时未满足的领用需求，复工时按此重试 */
  pendingParts: PartLine[];
  /** 最近一次缺件情况 */
  shortages: Shortage[];
  /** 合格完工记录（冻结快照） */
  finish: FinishRecord | null;
  /** 补录版本列表（追加，不改写原记录） */
  versions: AmendVersion[];
  timeline: TimelineEvent[];
}

export interface FleetState {
  /** 数据结构版本号，便于后续迁移 */
  schemaVersion: number;
  vehicles: Vehicle[];
  parts: Part[];
  orders: RepairOrder[];
  movements: StockMovement[];
  /** 当前有效预占（领用成功转核销后移除；缺件回滚后移除） */
  reservations: Reservation[];
}
