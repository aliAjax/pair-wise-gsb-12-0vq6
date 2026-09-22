<script setup lang="ts">
import { computed } from "vue";
import { useFleetStore } from "../stores/fleet";

const store = useFleetStore();

const metrics = computed(() => {
  const total = store.vehicles.length;
  const running = store.vehicles.filter(
    (v) => store.vehiclePhase(v.id) === "执行中"
  ).length;
  const down = store.downCount;
  const waiting = store.orders.filter((o) => o.status === "待料").length;
  return [
    { label: "车辆总数", value: total },
    { label: "执行中", value: running },
    { label: "保养停机", value: down },
    { label: "缺件待料", value: waiting },
    { label: "在修工单", value: store.openOrders.length },
    { label: "累计完工", value: store.orders.filter((o) => o.status === "已完成").length }
  ];
});
</script>

<template>
  <section class="metrics">
    <article v-for="m in metrics" :key="m.label" class="metric">
      <span>{{ m.label }}</span>
      <strong :class="{ alert: m.label === '缺件待料' && m.value > 0 }">{{ m.value }}</strong>
    </article>
  </section>
</template>
