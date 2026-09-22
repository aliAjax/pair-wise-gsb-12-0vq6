<script setup lang="ts">
import { useFleetStore } from "../stores/fleet";
import { effectiveMileage, effectiveParts } from "../rules/engine";
import type { RepairOrder } from "../types";

defineProps<{ order: RepairOrder }>();
const store = useFleetStore();

function pname(id: string) {
  return store.partById(id)?.name ?? id;
}
</script>

<template>
  <div class="order-detail" @click.stop>
    <div class="detail-cols">
      <div>
        <h5>已核销备件（原始，冻结后不改）</h5>
        <p v-if="order.parts.length === 0" class="muted">暂无</p>
        <p v-for="l in order.parts" :key="l.partId" class="detail-line">
          {{ pname(l.partId) }} × {{ l.qty }}
        </p>
      </div>
      <div>
        <h5>有效备件（含补录净变化）</h5>
        <p v-if="effectiveParts(order).length === 0" class="muted">暂无</p>
        <p v-for="l in effectiveParts(order)" :key="l.partId" class="detail-line">
          {{ pname(l.partId) }} × {{ l.qty }}
        </p>
      </div>
    </div>

    <div v-if="order.versions.length" class="versions">
      <h5>补录版本（只追加）</h5>
      <div v-for="v in order.versions" :key="v.version" class="version-item">
        <p class="version-head">V{{ v.version }} · {{ new Date(v.at).toLocaleString("zh-CN") }}</p>
        <p>原因：{{ v.reason }}</p>
        <p>里程：{{ v.mileage.toLocaleString() }} km</p>
        <p v-if="v.partDeltas.length">
          备件调整：
          <span v-for="(d, i) in v.partDeltas" :key="d.partId">
            {{ pname(d.partId) }} {{ d.qty > 0 ? "+" : "" }}{{ d.qty }}<span v-if="i < v.partDeltas.length - 1">；</span>
          </span>
        </p>
        <p v-if="v.oldPartsReturned">旧件：{{ v.oldPartsReturned }}</p>
      </div>
    </div>

    <div v-if="order.finish" class="freeze-snapshot">
      <h5>完工冻结快照</h5>
      <p>完工时间：{{ new Date(order.finish.at).toLocaleString("zh-CN") }}</p>
      <p>冻结里程：{{ order.finish.mileage.toLocaleString() }} km · 当前有效里程：{{ effectiveMileage(order).toLocaleString() }} km</p>
      <p>质检：合格 / {{ order.finish.inspectNote }}</p>
      <p>旧件回收：{{ order.finish.oldPartsReturned }}</p>
    </div>

    <h5>流转时间线</h5>
    <ol class="timeline">
      <li v-for="(e, i) in [...order.timeline].reverse()" :key="i">
        <span class="t-time">{{ new Date(e.at).toLocaleTimeString("zh-CN") }}</span>
        <span class="t-action">{{ e.action }}</span>
        <span v-if="e.detail" class="t-detail">{{ e.detail }}</span>
      </li>
    </ol>
  </div>
</template>
