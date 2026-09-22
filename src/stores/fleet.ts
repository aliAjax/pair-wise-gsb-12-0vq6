import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { FleetState, PartLine } from "../types";
import type { AmendInput, FinishInput } from "../rules/engine";
import { loadState, resetState, saveState } from "../data/storage";
import {
  RuleError,
  amendOrder,
  assignTask,
  availableOf,
  confirmIssue,
  createOrder,
  effectiveMileage,
  effectiveParts,
  finishOrder,
  isDown,
  openOrderOf,
  phaseOf,
  receiveStock,
  recallTask,
  releasePending,
  releaseReserved,
  requestParts,
  reservationsOfOrder,
  retryPending,
  startOrder,
  stockOf,
  stockRows
} from "../rules/engine";

/**
 * 状态层：持有整棵 FleetState 并持久化。
 * 所有变更必须调用规则引擎的纯函数，store 只做「计算新状态 → 替换 → 保存」，
 * 规则错误以 RuleError 抛出，由界面捕获提示。
 */
export const useFleetStore = defineStore("fleet", () => {
  const state = ref<FleetState>(loadState());

  function commit(next: FleetState) {
    state.value = next;
    saveState(next);
  }

  /** 统一执行入口：拦截规则错误并返回提示信息 */
  function run(action: (s: FleetState) => FleetState): { ok: boolean; error?: string } {
    try {
      commit(action(state.value));
      return { ok: true };
    } catch (err) {
      if (err instanceof RuleError) return { ok: false, error: err.message };
      throw err;
    }
  }

  // ---------- 车辆 / 任务 ----------

  const vehicles = computed(() => state.value.vehicles);
  const downCount = computed(
    () => state.value.vehicles.filter((v) => isDown(state.value, v.id)).length
  );

  function vehiclePhase(id: string) {
    const v = state.value.vehicles.find((x) => x.id === id);
    return v ? phaseOf(state.value, v) : "空闲";
  }

  function assign(id: string, taskName: string) {
    return run((s) => assignTask(s, id, taskName));
  }

  function completeTask(id: string) {
    return run((s) => {
      const next = structuredClone(s);
      const v = next.vehicles.find((x) => x.id === id);
      if (!v) throw new RuleError("车辆不存在");
      if (isDown(next, id)) throw new RuleError("车辆保养停机中");
      if (v.taskStatus !== "执行中") throw new RuleError("没有执行中的任务");
      v.taskStatus = "已完成";
      return next;
    });
  }

  function recall(id: string, reason: string) {
    return run((s) => recallTask(s, id, reason));
  }

  // ---------- 工单 ----------

  const orders = computed(() => state.value.orders);
  const openOrders = computed(
    () => state.value.orders.filter((o) => o.status !== "已完成")
  );

  function openOrder(vehicleId: string) {
    return openOrderOf(state.value, vehicleId);
  }

  function createRepair(input: {
    vehicleId: string;
    title: string;
    reason: string;
    emergency: boolean;
    recallReason?: string;
  }) {
    return run((s) => createOrder(input, s));
  }

  function start(id: string) {
    return run((s) => startOrder(s, id));
  }

  function requestIssue(id: string, lines: PartLine[]) {
    return run((s) => requestParts(s, id, lines));
  }

  function confirm(id: string) {
    return run((s) => confirmIssue(s, id));
  }

  function releaseHeld(id: string) {
    return run((s) => releaseReserved(s, id));
  }

  function retry(id: string) {
    return run((s) => retryPending(s, id));
  }

  function cancelWait(id: string) {
    return run((s) => releasePending(s, id));
  }

  function finish(id: string, input: FinishInput) {
    return run((s) => finishOrder(s, id, input));
  }

  function amend(id: string, input: AmendInput) {
    return run((s) => amendOrder(s, id, input));
  }

  // ---------- 备件 / 库存 ----------

  const parts = computed(() => state.value.parts);
  const movements = computed(() => state.value.movements);
  const stockTable = computed(() => stockRows(state.value));

  function partById(id: string) {
    return state.value.parts.find((p) => p.id === id);
  }

  function onHand(partId: string) {
    return stockOf(state.value, partId);
  }

  function available(partId: string) {
    return availableOf(state.value, partId);
  }

  function heldByOrder(orderId: string) {
    return reservationsOfOrder(state.value, orderId);
  }

  function receive(partId: string, qty: number, reason: string) {
    return run((s) => receiveStock(s, partId, qty, reason));
  }

  // ---------- 工单派生视图 ----------

  function effectiveOrderMileage(orderId: string) {
    const o = state.value.orders.find((x) => x.id === orderId);
    return o ? effectiveMileage(o) : 0;
  }

  function effectiveOrderParts(orderId: string) {
    const o = state.value.orders.find((x) => x.id === orderId);
    return o ? effectiveParts(o) : [];
  }

  function resetAll() {
    state.value = resetState();
  }

  return {
    state,
    vehicles,
    orders,
    openOrders,
    downCount,
    parts,
    movements,
    stockTable,
    vehiclePhase,
    openOrder,
    assign,
    completeTask,
    recall,
    createRepair,
    start,
    requestIssue,
    confirm,
    releaseHeld,
    retry,
    cancelWait,
    finish,
    amend,
    partById,
    onHand,
    available,
    heldByOrder,
    receive,
    effectiveOrderMileage,
    effectiveOrderParts,
    resetAll
  };
});
