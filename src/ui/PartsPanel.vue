<script setup lang="ts">
import { reactive } from "vue";
import { useFleetStore } from "../stores/fleet";
import { toast } from "./toast";

const store = useFleetStore();

// 每个备件一行独立的入库数量输入
const inbound = reactive<Record<string, number>>({});

function receive(partId: string) {
  const qty = inbound[partId] ?? 0;
  toast.from(store.receivePart(partId, qty), "备件已入库");
  inbound[partId] = 0;
}

function shortfallReady(partId: string | undefined, qty: number | undefined): boolean {
  if (!partId) return false;
  return store.availableOf(partId) >= (qty ?? 0);
}
</script>

<template>
  <section class="list-panel">
    <div class="toolbar">
      <h2>备件库存与核销台</h2>
      <span class="hint">
        占用 = 各在修单已申请未出库数量；可用 = 库存 − 占用。领用核销时才扣减库存，缺件转待料会释放占用。
      </span>
    </div>

    <div class="table-wrap">
      <table class="part-table">
        <thead>
          <tr>
            <th>备件</th>
            <th>规格</th>
            <th>库存</th>
            <th>占用</th>
            <th>可用</th>
            <th>入库</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in store.partsView" :key="item.part.id">
            <td>{{ item.part.name }}</td>
            <td>{{ item.part.spec }}</td>
            <td :class="{ zero: item.part.stock === 0 }">{{ item.part.stock }}</td>
            <td>{{ item.occupied }}</td>
            <td :class="{ zero: item.available <= 0 }">{{ item.available }}</td>
            <td>
              <div class="inline-form tight">
                <input v-model.number="inbound[item.part.id]" type="number" min="1" placeholder="数量" />
                <button
                  type="button"
                  class="secondary"
                  :disabled="!inbound[item.part.id]"
                  @click="receive(item.part.id)"
                >
                  入库
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <h3 class="sub-title">等待备件的工单</h3>
    <div v-if="store.metrics.waiting === 0" class="empty">没有待料工单</div>
    <div class="record-grid">
      <article
        v-for="order in store.state.repairs.filter((item) => item.status === '待料')"
        :key="order.id"
        class="record"
      >
        <div class="record-head">
          <p class="record-title">{{ order.title }}</p>
          <span class="status waiting">待料</span>
        </div>
        <div class="details">
          <span>缺件：{{ order.waitingPartName }} × {{ order.waitingQty }}</span>
          <span>
            当前可用：
            <strong :class="{ zero: !shortfallReady(order.waitingPartId, order.waitingQty) }">
              {{ order.waitingPartId ? store.availableOf(order.waitingPartId) : 0 }}
            </strong>
            <span v-if="!shortfallReady(order.waitingPartId, order.waitingQty)" class="muted">（仍缺件）</span>
          </span>
        </div>
        <div class="actions">
          <button
            type="button"
            @click="toast.from(store.resumeRepair(order.id), '备件到位，工单已复工')"
          >
            备件已齐 · 复工
          </button>
        </div>
      </article>
    </div>
  </section>
</template>
