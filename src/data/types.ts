// ===== 数据层：领域类型与常量 =====
// 这里只描述“数据长什么样”，不写任何业务规则与界面逻辑。

export const ZONES = ["城北", "城东", "城南"] as const;
export type Zone = (typeof ZONES)[number];

export type TaskStatus = "执行中" | "已完成" | "已回收";

export type RepairStatus =
  | "待修"
  | "在修"
  | "待料"
  | "质检不合格" // 质检不合格 = 退回待修，车辆继续停机
  | "已完工" // 冻结
  | "已取消";

export type RequisitionStatus = "占用" | "已领用" | "已释放";

export type QcResult = "合格" | "不合格";

export type SupplementKind = "里程补录" | "备件补录";

export interface Vehicle {
  id: string;
  plate: string;
  driver: string;
  zone: Zone;
  /** 当前最新里程（公里） */
  mileage: number;
}

export interface DispatchTask {
  id: string;
  vehicleId: string;
  name: string;
  zone: string;
  status: TaskStatus;
  createdAt: string;
  completedAt?: string;
  /** 紧急报修回收任务时必填的原因 */
  recalledAt?: string;
  recallReason?: string;
}

export interface Requisition {
  id: string;
  partId: string;
  /** 名称快照，防止备件档案后续改动影响历史单据 */
  partName: string;
  qty: number;
  status: RequisitionStatus;
  createdAt: string;
  issuedAt?: string;
  releasedAt?: string;
}

export interface CompletionSnapshot {
  mileage: number;
  qcResult: QcResult;
  /** 旧件回收件数 */
  oldPartsReturned: number;
  qcNote?: string;
  finishedAt: string;
}

export interface QcFailure {
  mileage: number;
  oldPartsReturned: number;
  qcNote?: string;
  at: string;
}

export interface RepairOrder {
  id: string;
  vehicleId: string;
  title: string;
  faultDesc: string;
  emergency: boolean;
  status: RepairStatus;
  requisitions: Requisition[];
  createdAt: string;
  startedAt?: string;
  waitingSince?: string;
  waitingPartId?: string;
  waitingPartName?: string;
  waitingQty?: number;
  /** 合格完工后的冻结快照；冻结后备件与里程不可再改 */
  completion?: CompletionSnapshot;
  frozen: boolean;
  lastQc?: QcFailure;
  canceledAt?: string;
}

export interface Part {
  id: string;
  name: string;
  spec: string;
  /** 实物库存（已领用核销时扣减） */
  stock: number;
}

export interface SupplementVersion {
  id: string;
  orderId: string;
  /** 同一工单第几次补录，从 1 开始 */
  version: number;
  kind: SupplementKind;
  reason: string;
  createdAt: string;
  mileage?: number;
  partId?: string;
  partName?: string;
  qty?: number;
}

export interface FleetState {
  /** 存档结构版本，便于以后迁移 */
  schemaVersion: number;
  seq: number;
  vehicles: Vehicle[];
  tasks: DispatchTask[];
  repairs: RepairOrder[];
  parts: Part[];
  supplements: SupplementVersion[];
}
