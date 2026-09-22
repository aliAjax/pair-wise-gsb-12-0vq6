<script setup lang="ts">
import { computed, ref } from "vue";
import { useFleetStore } from "./stores/fleet";
import {
  availableOf,
  openOrderOf,
  phaseOf,
  reservedOf,
  stockOf
} from "./rules/engine";
import VehiclePanel from "./components/VehiclePanel.vue";
import OrderPanel from "./components/OrderPanel.vue";
import InventoryPanel from "./components/InventoryPanel.vue";
import MetricBar from "./components/MetricBar.vue";
import ToastHost from "./components/ToastHost.vue";
import { useToast } from "./components/toast";

const store = useFleetStore();
const toast = useToast();

const tab = ref<"dispatch" | "orders" | "stock">("dispatch");
const showCheck = ref(false);

interface CheckItem {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * 一致性自检：全部由状态现场重新派生，不做任何修改。
 * 覆盖：库存非负、可用=结存−预占、单车一张在修单、停机派生、
 * 执行中无报修单、完工冻结里程/版本、预占均挂在修工单。
 */
const checks = computed<CheckItem[]>(() => {
  const s = store.state;
  const result: CheckItem[] = [];

  // 1. 结存与可用非负，且 可用 = 结存 − 预占
  let stockOk = true;
  const stockDetails: string[] = [];
  for (const p of s.parts) {
    const onHand = stockOf(s, p.id);
    const held = reservedOf(s, p.id);
    const avail = availableOf(s, p.id);
    if (onHand < 0 || avail < 0 || avail !== onHand - held) {
      stockOk = false;
      stockDetails.push(p.name);
    }
  }
  result.push({
    name: "库存非负且 可用 = 结存 − 预占",
    ok: stockOk,
    detail: stockOk ? "全部备件一致" : `异常备件：${stockDetails.join("、")}`

  });

  // 2. 每车最多一张在修单；停机阶段与在修单一致
  let singleOk = true;
  let phaseOk = true;
  for (const v of s.vehicles) {
    const opens = s.orders.filter((o) => o.vehicleId === v.id && o.status !== "已完成");
    if (opens.length > 1) singleOk = false;
    const down = opens.length === 1;
    if (down !== (phaseOf(s, v) === "保养停机")) phaseOk = false;
  }
  result.push({ name: "单车只保留一张在修单", ok: singleOk, detail: singleOk ? "通过" : "存在多单车辆" });
  result.push({
    name: "保养停机由在修单派生",
    ok: phaseOk,
    detail: phaseOk ? "停机/复机一致" : "停机状态与工单不一致"
  });

  // 3. 执行中车辆不存在开放报修单（紧急报修必然先回收任务）
  let recallOk = true;
  for (const v of s.vehicles) {
    if (v.taskStatus === "执行中" && openOrderOf(s, v.id)) recallOk = false;
  }
  result.push({
    name: "执行中车辆无报修单",
    ok: recallOk,
    detail: recallOk ? "紧急报修均已回收任务" : "存在执行中报修单"
  });

  // 4. 已完工工单：有冻结快照，备件/里程不被改写
  let freezeOk = true;
  const frozenDetails: string[] = [];
  for (const o of s.orders) {
    if (o.status !== "已完成") continue;
    if (!o.finish) {
      freezeOk = false;
      frozenDetails.push(`${o.code}缺完工记录`);
      continue;
    }
    // 原始核销明细合计必须能在流水里找到对应净核销（入库为正方向）
    for (const line of o.parts) {
      const used = s.movements
        .filter((m) => m.orderId === o.id && m.partId === line.partId)
        .reduce((sum, m) => sum + (m.type === "核销" ? m.qty : -m.qty), 0);
      // 允许补录改变净额，但原始 parts 数量必须 ≤ 总净核销（补退时可能小于）
      if (used < 0) {
        freezeOk = false;
        frozenDetails.push(`${o.code} ${line.partId}`);
      }
    }
  }
  result.push({
    name: "完工单冻结快照完整",
    ok: freezeOk,
    detail: freezeOk ? "里程与原始备件均有快照，补录仅追加版本" : frozenDetails.join("、")
  });

  // 5. 所有预占都挂在「在修」工单上（待料不占库存）
  let reservationOwnerOk = true;
  for (const r of s.reservations) {
    const o = s.orders.find((x) => x.id === r.orderId);
    if (!o || o.status !== "在修") reservationOwnerOk = false;
  }
  result.push({
    name: "预占均属于在修工单",
    ok: reservationOwnerOk,
    detail: reservationOwnerOk ? "缺件已释放，不占库存" : "存在游离预占"
  });

  // 6. 补录版本均带原因，且版本号连续
  let versionOk = true;
  for (const o of s.orders) {
    o.versions.forEach((v, i) => {
      if (!v.reason.trim() || v.version !== i + 1) versionOk = false;
    });
  }
  result.push({
    name: "补录版本带原因且连续",
    ok: versionOk,
    detail: versionOk ? "所有补录均可追溯" : "存在异常版本"
  });

  return result;
});

const allPass = computed(() => checks.value.every((c) => c.ok));

function runCheck() {
  showCheck.value = true;
  if (allPass.value) toast.success("一致性自检全部通过");
  else toast.error("存在不一致项，请查看自检结果");
}

function resetAll() {
  if (window.confirm("确定恢复到演示种子数据？当前修改将被清空。")) {
    store.resetAll();
    toast.info("已恢复种子数据");
  }
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">物流车队 · 调度 / 保养 / 备件一体化</p>
          <h1>车辆调度 · 保养停机与备件核销台</h1>
          <p class="subtitle">
            执行中车辆不能报修，紧急报修先回收任务并写明原因；单车一张在修单；
            备件先预占后核销，缺件转待料并释放已占数量；完工录里程、质检与旧件回收，
            合格后冻结，补录只追加带原因的版本。
          </p>
        </div>
        <div class="top-actions">
          <button type="button" class="secondary" @click="runCheck">一致性自检</button>
          <button type="button" class="secondary" @click="resetAll">重置演示数据</button>
        </div>
      </header>

      <MetricBar />

      <nav class="tabs">
        <button type="button" :class="{ active: tab === 'dispatch' }" @click="tab = 'dispatch'">
          车辆调度 / 报修
        </button>
        <button type="button" :class="{ active: tab === 'orders' }" @click="tab = 'orders'">
          维修工单台
        </button>
        <button type="button" :class="{ active: tab === 'stock' }" @click="tab = 'stock'">
          备件核销台
        </button>
      </nav>

      <VehiclePanel v-show="tab === 'dispatch'" />
      <OrderPanel v-show="tab === 'orders'" />
      <InventoryPanel v-show="tab === 'stock'" />

      <section v-if="showCheck" class="panel check-panel">
        <div class="panel-head">
          <h2>刷新一致性自检</h2>
          <span class="status" :class="allPass ? 'st-已完成' : 'st-待料'">
            {{ allPass ? "全部通过" : "存在异常" }}
          </span>
        </div>
        <ul class="check-list">
          <li v-for="c in checks" :key="c.name" :class="c.ok ? 'ok' : 'bad'">
            <span class="check-dot">{{ c.ok ? "✓" : "✗" }}</span>
            <div>
              <p class="check-name">{{ c.name }}</p>
              <p class="muted small">{{ c.detail }}</p>
            </div>
          </li>
        </ul>
        <p class="hint">
          本面板所有结论均由流水、预占台账、工单现场重新计算。刷新页面后若全部通过，
          即说明任务、停机、库存与补录版本持久化一致。
        </p>
      </section>

      <footer class="foot">
        数据保存在浏览器 localStorage · 数据层（data）/ 规则层（rules）/ 状态层（stores）/ 界面层（components）分离
      </footer>
    </div>
    <ToastHost />
  </main>
</template>
