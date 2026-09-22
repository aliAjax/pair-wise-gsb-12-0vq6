<script setup lang="ts">
import { computed, ref } from "vue";
import { useFleetStore } from "./stores/fleet";
import DispatchPanel from "./ui/DispatchPanel.vue";
import RepairPanel from "./ui/RepairPanel.vue";
import PartsPanel from "./ui/PartsPanel.vue";
import Toasts from "./ui/Toasts.vue";

const store = useFleetStore();

const tabs = [
  { key: "dispatch", label: "车辆调度" },
  { key: "repair", label: "保养报修 / 停机" },
  { key: "parts", label: "备件核销台" }
] as const;

type TabKey = (typeof tabs)[number]["key"];
const activeTab = ref<TabKey>("dispatch");

const metricCards = computed(() => [
  { label: "车辆总数", value: store.metrics.totalVehicles },
  { label: "执行中任务", value: store.metrics.running },
  { label: "保养停机车辆", value: store.metrics.down, hint: store.metrics.waiting ? `其中待料 ${store.metrics.waiting}` : "" },
  { label: "已完工冻结工单", value: store.metrics.frozen }
]);

function reset() {
  if (window.confirm("确认恢复演示数据？当前全部任务、工单与库存改动将被清空。")) {
    store.resetDemo();
  }
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">物流行业 · 调度 / 保养 / 备件一体化</p>
          <h1>车辆调度 · 保养停机与备件核销台</h1>
          <p class="subtitle">
            执行中车辆不可普通报修，紧急报修先回收任务并写明原因；单车一张在修单；备件占用不超库存、缺件转待料并释放；
            完工须录里程、质检与旧件回收，不合格退回待修；冻结后补录只生成带原因版本。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">Pinia</span>
          <span class="tag">TypeScript</span>
          <span class="tag">localStorage 持久化</span>
          <button class="secondary" type="button" @click="reset">重置演示数据</button>
        </div>
      </header>

      <section class="metrics">
        <article v-for="card in metricCards" :key="card.label" class="metric">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
          <small v-if="card.hint">{{ card.hint }}</small>
        </article>
      </section>

      <div v-if="store.auditProblems.length" class="audit-banner">
        <strong>数据一致性检查发现问题：</strong>
        <ul>
          <li v-for="(problem, index) in store.auditProblems" :key="index">{{ problem }}</li>
        </ul>
      </div>

      <nav class="tabs">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          class="tab"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </nav>

      <DispatchPanel v-if="activeTab === 'dispatch'" />
      <RepairPanel v-else-if="activeTab === 'repair'" />
      <PartsPanel v-else />
    </div>

    <Toasts />
  </main>
</template>
