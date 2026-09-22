<script setup lang="ts">
import { ref } from "vue";
import { useFleetStore } from "../stores/fleet";
import { useToast } from "./toast";

const store = useFleetStore();
const toast = useToast();

const partId = ref(store.parts[0]?.id ?? "");
const qty = ref(1);
const reason = ref("");

function doReceive() {
  if (!partId.value) return toast.error("请选择备件");
  if (qty.value <= 0) return toast.error("入库数量必须大于 0");
  const r = store.receive(partId.value, qty.value, reason.value);
  if (!r.ok) return toast.error(r.error!);
  toast.success("入库成功");
  qty.value = 1;
  reason.value = "";
}

function partName(id: string) {
  return store.partById(id)?.name ?? id;
}

function partCode(id: string) {
  return store.partById(id)?.code ?? "";
}
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <h2>备件核销台</h2>
      <span class="muted small">库存由流水实时汇总，刷新后与记录一致</span>
    </div>

    <div class="stock-table-wrap">
      <table class="stock-table">
        <thead>
          <tr>
            <th>备件</th>
            <th>规格</th>
            <th>结存</th>
            <th>已预占</th>
            <th>可用</th>
            <th>单位</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in store.stockTable" :key="row.partId" :class="{ tight: row.available <= 1 }">
            <td>
              <strong>{{ partName(row.partId) }}</strong>
              <span class="muted small"> {{ partCode(row.partId) }}</span>
            </td>
            <td>{{ store.partById(row.partId)?.spec }}</td>
            <td>{{ row.onHand }}</td>
            <td :class="{ occupied: row.reserved > 0 }">{{ row.reserved }}</td>
            <td><strong :class="{ danger: row.available <= 0 }">{{ row.available }}</strong></td>
            <td>{{ store.partById(row.partId)?.unit }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <form class="inline-form receive-form" @submit.prevent="doReceive">
      <select v-model="partId">
        <option v-for="p in store.parts" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <input v-model.number="qty" type="number" min="1" placeholder="入库数量" />
      <input v-model="reason" placeholder="入库原因 / 单号（可选）" />
      <button type="submit">备件入库</button>
    </form>

    <h3 class="block-title">库存流水核对</h3>
    <div class="movement-list">
      <div
        v-for="m in [...store.movements].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12)"
        :key="m.id"
        class="movement-row"
      >
        <span class="mv-type" :class="`mv-${m.type}`">{{ m.type }}</span>
        <span class="mv-name">{{ partName(m.partId) }}</span>
        <span class="mv-qty" :class="m.type === '核销' ? 'danger' : 'ok'">
          {{ m.type === "核销" ? "−" : "+" }}{{ m.qty }}
        </span>
        <span class="mv-reason muted">{{ m.reason || "—" }}</span>
        <span class="mv-time muted">{{ new Date(m.at).toLocaleString("zh-CN") }}</span>
      </div>
    </div>
  </section>
</template>
