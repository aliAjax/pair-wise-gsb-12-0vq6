<script setup lang="ts">
import { computed, ref } from "vue";
import { useFleetStore } from "../stores/fleet";
import { phaseOf } from "../rules/engine";
import { useToast } from "./toast";

const store = useFleetStore();
const toast = useToast();

const zoneFilter = ref("全部区域");
const zones = ["全部区域", "城北", "城东", "城南"];

const taskVehicleId = ref("");
const taskName = ref("");

const repairVehicleId = ref("");
const emergency = ref(false);
const repairTitle = ref("");
const repairReason = ref("");
const recallReason = ref("");

const list = computed(() =>
  store.vehicles.filter((v) => zoneFilter.value === "全部区域" || v.zone === zoneFilter.value)
);

function phase(id: string) {
  const v = store.vehicles.find((x) => x.id === id);
  return v ? phaseOf(store.state, v) : "空闲";
}

function submitTask() {
  if (!taskVehicleId.value) return toast.error("请选择车辆");
  if (!taskName.value.trim()) return toast.error("请填写配送任务");
  const r = store.assign(taskVehicleId.value, taskName.value);
  if (!r.ok) return toast.error(r.error!);
  toast.success("已派工");
  taskVehicleId.value = "";
  taskName.value = "";
}

function completeTask(id: string) {
  const r = store.completeTask(id);
  if (!r.ok) return toast.error(r.error!);
  toast.success("任务已完成");
}

const canSubmitRepair = computed(() => {
  if (!repairVehicleId.value || !repairTitle.value.trim() || !repairReason.value.trim()) return false;
  const v = store.vehicles.find((x) => x.id === repairVehicleId.value);
  if (v?.taskStatus === "执行中" && emergency.value && !recallReason.value.trim()) return false;
  return true;
});

function submitRepair() {
  if (!canSubmitRepair.value) {
    return toast.error(
      repairVehicleId.value &&
        store.vehicles.find((x) => x.id === repairVehicleId.value)?.taskStatus === "执行中" &&
        emergency.value
        ? "紧急报修必须先写明回收任务原因"
        : "请完整填写报修信息"
    );
  }
  const r = store.createRepair({
    vehicleId: repairVehicleId.value,
    title: repairTitle.value,
    reason: repairReason.value,
    emergency: emergency.value,
    recallReason: emergency.value ? recallReason.value : undefined
  });
  if (!r.ok) return toast.error(r.error!);
  toast.success(emergency.value ? "已回收任务并创建紧急报修单" : "报修单已创建，车辆进入保养停机");
  repairVehicleId.value = "";
  emergency.value = false;
  repairTitle.value = "";
  repairReason.value = "";
  recallReason.value = "";
}

const selectedVehicle = computed(() => store.vehicles.find((v) => v.id === repairVehicleId.value));
const selectedOpenOrder = computed(() =>
  selectedVehicle.value ? store.openOrder(selectedVehicle.value.id) : undefined
);
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <h2>车辆调度</h2>
      <select v-model="zoneFilter" class="mini-select">
        <option v-for="z in zones" :key="z" :value="z">{{ z }}</option>
      </select>
    </div>

    <form class="inline-form" @submit.prevent="submitTask">
      <select v-model="taskVehicleId">
        <option value="" disabled>选择车辆派工</option>
        <option v-for="v in store.vehicles" :key="v.id" :value="v.id">
          {{ v.plate }} · {{ v.driver }}（{{ phase(v.id) }}）
        </option>
      </select>
      <input v-model="taskName" placeholder="配送任务，如：商超补货" />
      <button type="submit">分配任务</button>
    </form>

    <div class="vehicle-list">
      <article v-for="v in list" :key="v.id" class="vehicle-card" :class="{ down: phase(v.id) === '保养停机' }">
        <div class="vehicle-main">
          <p class="vehicle-title">
            {{ v.plate }}
            <span class="muted">/ {{ v.driver }} / {{ v.zone }}</span>
          </p>
          <p class="vehicle-sub">
            里程 <strong>{{ v.mileage.toLocaleString() }}</strong> km
            <template v-if="v.taskName"> · 任务：{{ v.taskName }}</template>
          </p>
          <p v-if="v.note" class="vehicle-note">{{ v.note }}</p>
        </div>
        <div class="vehicle-side">
          <span class="status" :class="`st-${phase(v.id)}`">{{ phase(v.id) }}</span>
          <button
            v-if="v.taskStatus === '执行中' && phase(v.id) !== '保养停机'"
            class="secondary small"
            type="button"
            @click="completeTask(v.id)"
          >
            回收/完成
          </button>
        </div>
      </article>
    </div>

    <div class="divider" />

    <h3 class="block-title">报修登记</h3>
    <form class="form-grid" @submit.prevent="submitRepair">
      <label>
        报修车辆
        <select v-model="repairVehicleId" required>
          <option value="" disabled>选择车辆</option>
          <option v-for="v in store.vehicles" :key="v.id" :value="v.id">
            {{ v.plate }} · {{ v.driver }}（{{ phase(v.id) }}）
          </option>
        </select>
      </label>

      <div v-if="selectedVehicle" class="rule-hint" :class="{ warn: selectedVehicle.taskStatus === '执行中' }">
        <template v-if="selectedOpenOrder">
          ⚠ 该车辆已有在修单 {{ selectedOpenOrder.code }}，单车只保留一张在修单
        </template>
        <template v-else-if="selectedVehicle.taskStatus === '执行中'">
          ⚠ 车辆任务执行中：普通报修不可提交；紧急报修将先回收任务
        </template>
        <template v-else>✓ 可以报修，提交后车辆进入保养停机</template>
      </div>

      <label class="check-line">
        <input v-model="emergency" type="checkbox" />
        紧急报修（执行中车辆须先回收任务）
      </label>

      <label v-if="emergency && selectedVehicle?.taskStatus === '执行中'">
        回收任务原因（必填）
        <textarea
          v-model="recallReason"
          placeholder="说明为何中断任务，如：高速水温报警，存在安全隐患"
        />
      </label>

      <label>
        报修内容
        <input v-model="repairTitle" placeholder="如：更换前刹车片" required />
      </label>
      <label>
        故障 / 报修原因
        <textarea v-model="repairReason" placeholder="描述故障现象与报修原因" required />
      </label>

      <button type="submit" :disabled="!canSubmitRepair">
        {{ emergency ? "回收任务并紧急报修" : "提交报修" }}
      </button>
    </form>
  </section>
</template>
