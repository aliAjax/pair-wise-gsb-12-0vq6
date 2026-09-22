// ===== 状态编排层：Pinia store =====
// 负责加载/持久化与“在草稿上跑规则、成功才提交”的事务性封装；
// 业务规则本身全部在 src/rules 中，这里不重复实现。
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { loadState, saveState } from "../data/storage";
import {
  activeRepairOf,
  activeTaskOf,
  addSupplement,
  auditState,
  availableQty,
  backToPending,
  cancelRepair,
  completeRepair,
  completeTask,
  createRepair,
  createTask,
  isDown,
  issueRequisition,
  occupyPart,
  occupiedQty,
  restockPart,
  resumeFromWaiting,
  RuleError,
  startRepair,
  turnToWaiting,
  type ActiveRepairInfo,
  type CreateRepairInput,
  type SupplementInput
} from "../rules/fleet";
import type { FleetState, RepairOrder, Vehicle } from "../data/types";

export type ActionResult = { ok: true } | { ok: false; message: string };

export const useFleetStore = defineStore("fleet", () => {
  const state = ref<FleetState>(loadState());

  function persist(): void {
    saveState(state.value);
  }

  /** 事务：在深拷贝草稿上执行规则，成功整体替换并落盘，失败不留半截修改 */
  function commit(mutate: (draft: FleetState) => void): ActionResult {
    const draft = structuredClone(state.value) as FleetState;
    try {
      mutate(draft);
      state.value = draft;
      persist();
      return { ok: true };
    } catch (error) {
      if (error instanceof RuleError) return { ok: false, message: error.message };
      throw error;
    }
  }

  // ---------- 调度动作 ----------

  function dispatchTask(input: { vehicleId: string; name: string; zone: string }): ActionResult {
    return commit((draft) => createTask(draft, input));
  }

  function finishTask(taskId: string): ActionResult {
    return commit((draft) => completeTask(draft, taskId));
  }

  // ---------- 报修 / 停机动作 ----------

  function openRepair(input: CreateRepairInput): ActionResult {
    return commit((draft) => createRepair(draft, input));
  }

  function beginRepair(orderId: string): ActionResult {
    return commit((draft) => startRepair(draft, orderId));
  }

  function returnRepairToPending(orderId: string): ActionResult {
    return commit((draft) => backToPending(draft, orderId));
  }

  function abandonRepair(orderId: string): ActionResult {
    return commit((draft) => cancelRepair(draft, orderId));
  }

  // ---------- 备件动作 ----------

  function holdPart(orderId: string, partId: string, qty: number): ActionResult {
    return commit((draft) => occupyPart(draft, orderId, partId, qty));
  }

  function issueLine(orderId: string, lineId: string): ActionResult {
    return commit((draft) => issueRequisition(draft, orderId, lineId));
  }

  function waitForParts(orderId: string, partId: string, qty: number): ActionResult {
    return commit((draft) => turnToWaiting(draft, orderId, { partId, qty }));
  }

  function resumeRepair(orderId: string): ActionResult {
    return commit((draft) => resumeFromWaiting(draft, orderId));
  }

  function receivePart(partId: string, qty: number): ActionResult {
    return commit((draft) => restockPart(draft, partId, qty));
  }

  // ---------- 完工 / 补录 ----------

  function finishRepair(
    orderId: string,
    input: { mileage: number; qcResult: "合格" | "不合格"; oldPartsReturned: number; qcNote?: string }
  ): ActionResult {
    return commit((draft) => completeRepair(draft, orderId, input));
  }

  function supplement(orderId: string, input: SupplementInput): ActionResult {
    return commit((draft) => addSupplement(draft, orderId, input));
  }

  function resetDemo(): void {
    localStorage.removeItem("dfwlfront-3-dispatch"); // 清掉旧版小工具的存档
    state.value = loadState();
  }

  // ---------- 派生查询 ----------

  const vehicles = computed(() =>
    state.value.vehicles.map((vehicle) => {
      const task = activeTaskOf(state.value, vehicle.id);
      const order = activeRepairOf(state.value, vehicle.id);
      const down = Boolean(order);
      const activeInfo: ActiveRepairInfo | null = order ? { order, down } : null;
      const fleetStatus: string = order
        ? `保养停机 · ${order.status}`
        : task
          ? "执行中"
          : "空闲";
      return { vehicle, task, activeRepair: activeInfo, down, fleetStatus };
    })
  );

  function vehicleById(id: string): Vehicle | undefined {
    return state.value.vehicles.find((item) => item.id === id);
  }

  function repairById(id: string): RepairOrder | undefined {
    return state.value.repairs.find((item) => item.id === id);
  }

  const partsView = computed(() =>
    state.value.parts.map((part) => ({
      part,
      occupied: occupiedQty(state.value, part.id),
      available: availableQty(state.value, part.id)
    }))
  );

  function supplementsOf(orderId: string) {
    return state.value.supplements
      .filter((item) => item.orderId === orderId)
      .sort((a, b) => b.version - a.version);
  }

  function availableOf(partId: string): number {
    return availableQty(state.value, partId);
  }

  function downOf(vehicleId: string): boolean {
    return isDown(state.value, vehicleId);
  }

  const auditProblems = computed(() => auditState(state.value));

  const metrics = computed(() => {
    const running = state.value.tasks.filter((task) => task.status === "执行中").length;
    const downVehicles = new Set(
      state.value.repairs
        .filter((order) => order.status !== "已完工" && order.status !== "已取消")
        .map((order) => order.vehicleId)
    ).size;
    const frozen = state.value.repairs.filter((order) => order.frozen).length;
    const waiting = state.value.repairs.filter((order) => order.status === "待料").length;
    return {
      totalVehicles: state.value.vehicles.length,
      running,
      down: downVehicles,
      waiting,
      frozen,
      repairs: state.value.repairs.length
    };
  });

  return {
    state,
    metrics,
    vehicles,
    partsView,
    auditProblems,
    vehicleById,
    repairById,
    supplementsOf,
    availableOf,
    downOf,
    dispatchTask,
    finishTask,
    openRepair,
    beginRepair,
    returnRepairToPending,
    abandonRepair,
    holdPart,
    issueLine,
    waitForParts,
    resumeRepair,
    receivePart,
    finishRepair,
    supplement,
    resetDemo
  };
});
