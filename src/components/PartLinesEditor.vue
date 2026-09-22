<script setup lang="ts">
import { computed } from "vue";
import type { PartLine } from "../types";
import { useFleetStore } from "../stores/fleet";

const props = defineProps<{
  modelValue: PartLine[];
  /** 有符号模式：补录时允许负数表示退库 */
  signed?: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [PartLine[]] }>();

const store = useFleetStore();
const lines = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v)
});

function patch(index: number, patch: Partial<PartLine>) {
  lines.value = lines.value.map((l, i) => (i === index ? { ...l, ...patch } : l));
}

function add() {
  lines.value = [...lines.value, { partId: "", qty: props.signed ? 0 : 1 }];
}

function remove(index: number) {
  lines.value = lines.value.filter((_, i) => i !== index);
}
</script>

<template>
  <div class="part-lines">
    <div v-for="(line, i) in lines" :key="i" class="part-line">
      <select :value="line.partId" @change="patch(i, { partId: ($event.target as HTMLSelectElement).value })">
        <option value="" disabled>选择备件</option>
        <option v-for="p in store.parts" :key="p.id" :value="p.id">
          {{ p.name }}（{{ p.spec }}）可用 {{ store.available(p.id) }}{{ p.unit }}
        </option>
      </select>
      <input
        :value="line.qty"
        type="number"
        :min="signed ? -999 : 1"
        :step="1"
        @input="patch(i, { qty: Number(($event.target as HTMLInputElement).value) })"
      />
      <button type="button" class="icon-btn danger" title="删除该行" @click="remove(i)">×</button>
    </div>
    <button type="button" class="text-btn" @click="add">+ 添加一行</button>
  </div>
</template>
