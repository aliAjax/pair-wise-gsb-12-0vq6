<script setup lang="ts">
import { computed, reactive } from "vue";
import { ZONES } from "../data/types";
import { useFleetStore } from "../stores/fleet";
import { toast } from "./toast";

const store = useFleetStore();

const form = reactive({ vehicleId: "", name: "", zone: ZONES[0] as string });

const dispatchable = computed(() =>
  store.vehicles.filter((item) => !item.down && !item.task)
);

function submit() {
  if (!form.vehicleId) {
    toast.error("请选择车辆");
    return;
  }
  if (!form.name.trim()) {
    toast.error("请填写配送任务");
    return;
  }
  toast.from(store.dispatchTask({ ...form }), "任务已派发");
  form.name = "";
}
</script>

<template>
  <div class="two-col">
    <form class="panel" @submit.prevent="submit">
      <h2>新增配送任务</h2>
      <div class="form-grid">
        <label>
          车牌号
          <select v-model="form.vehicleId">
            <option value="">请选择（仅空闲车辆可派）</option>
            <option
              v-for="item in store.vehicles"
              :key="item.vehicle.id"
              :value="item.vehicle.id"
              :disabled="item.down || Boolean(item.task)"
            >
              {{ item.vehicle.plate }} / {{ item.vehicle.driver }}
              {{ item.down ? "（保养停机）" : item.task ? "（执行中）" : "（空闲）" }}
            </option>
          </select>
        </label>
        <label>
          配送任务
          <input v-model="form.name" placeholder="如：商超补货" />
        </label>
        <label>
          配送区域
          <select v-model="form.zone">
            <option v-for="zone in ZONES" :key="zone" :value="zone">{{ zone }}</option>
          </select>
        </label>
        <button type="submit" :disabled="dispatchable.length === 0">分配任务</button>
      </div>
    </form>

    <section class="list-panel">
      <div class="toolbar">
        <h2>车辆 / 任务状态</h2>
        <span class="hint">停机或执行中车辆不可重复派车</span>
      </div>
      <div class="record-grid">
        <article v-for="item in store.vehicles" :key="item.vehicle.id" class="record">
          <div class="record-head">
            <p class="record-title">{{ item.vehicle.plate }} / {{ item.vehicle.driver }}</p>
            <span class="status" :class="{ down: item.down, running: !item.down && item.task }">
              {{ item.fleetStatus }}
            </span>
          </div>
          <div class="details">
            <span>区域：{{ item.vehicle.zone }}</span>
            <span>当前里程：{{ item.vehicle.mileage.toLocaleString() }} km</span>
            <span v-if="item.task">
              任务：{{ item.task.name }}
              <em v-if="item.task.status === '已回收'" class="recalled">
                （已紧急回收：{{ item.task.recallReason }}）
              </em>
            </span>
            <span v-else-if="item.activeRepair">
              在修单：{{ item.activeRepair.order.title }}
            </span>
            <span v-else class="muted">无任务，可派车</span>
          </div>
          <div v-if="item.task && item.task.status === '执行中'" class="actions">
            <button type="button" @click="toast.from(store.finishTask(item.task!.id), '任务已完成')">
              任务回场
            </button>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>
