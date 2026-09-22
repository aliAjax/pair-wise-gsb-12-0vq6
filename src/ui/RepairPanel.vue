<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useFleetStore } from "../stores/fleet";
import { toast } from "./toast";
import RepairCard from "./RepairCard.vue";

const store = useFleetStore();

const form = reactive({
  vehicleId: "",
  title: "",
  faultDesc: "",
  emergency: false,
  recallReason: ""
});

const selectedVehicle = computed(() => store.vehicles.find((item) => item.vehicle.id === form.vehicleId));
const needsRecall = computed(() => Boolean(selectedVehicle.value?.task));
const statusFilter = ref("全部");

const filters = ["全部", "待修", "在修", "待料", "质检不合格", "已完工", "已取消"];

const shownOrders = computed(() =>
  statusFilter.value === "全部"
    ? store.state.repairs
    : store.state.repairs.filter((order) => order.status === statusFilter.value)
);

function submit() {
  if (!form.vehicleId) return toast.error("请选择报修车辆");
  if (!form.title.trim()) return toast.error("请填写报修标题");
  if (!form.faultDesc.trim()) return toast.error("请描述故障现象");

  if (needsRecall.value && !form.emergency) {
    return toast.error("该车辆任务执行中，普通报修不受理；请勾选紧急报修并先回收任务");
  }

  const result = store.openRepair({
    vehicleId: form.vehicleId,
    title: form.title,
    faultDesc: form.faultDesc,
    emergency: form.emergency,
    recallReason: form.recallReason
  });
  toast.from(result, form.emergency && needsRecall.value ? "紧急报修已受理，任务已回收" : "维修单已创建，车辆开始停机");

  if (result.ok) {
    form.title = "";
    form.faultDesc = "";
    form.emergency = false;
    form.recallReason = "";
    form.vehicleId = "";
  }
}
</script>

<template>
  <div class="two-col">
    <form class="panel" @submit.prevent="submit">
      <h2>保养报修</h2>
      <div class="form-grid">
        <label>
          报修车辆
          <select v-model="form.vehicleId">
            <option value="">请选择车辆</option>
            <option
              v-for="item in store.vehicles"
              :key="item.vehicle.id"
              :value="item.vehicle.id"
              :disabled="item.down"
            >
              {{ item.vehicle.plate }} / {{ item.vehicle.driver }}
              {{ item.down ? `（已有在修单 · ${item.activeRepair?.order.status}）` : "" }}
            </option>
          </select>
        </label>
        <label>
          报修标题
          <input v-model="form.title" placeholder="如：前轮刹车异响" />
        </label>
        <label>
          故障描述
          <textarea v-model="form.faultDesc" placeholder="故障现象、发生场景、是否影响安全" />
        </label>

        <label v-if="selectedVehicle" class="check-line">
          <input v-model="form.emergency" type="checkbox" :disabled="!needsRecall" />
          <span>
            紧急报修
            <template v-if="needsRecall">（该车任务执行中，受理前将先回收任务）</template>
            <template v-else>（当前无执行中任务）</template>
          </span>
        </label>

        <div v-if="form.emergency && needsRecall" class="recall-form">
          <p class="rule-hint">
            规则：执行中车辆不能普通报修；紧急报修必须先回收任务并写明原因。
          </p>
          <label>
            任务回收原因（必填，不少于 5 字）
            <textarea
              v-model="form.recallReason"
              placeholder="如：行驶中制动报警，存在严重安全隐患，立即停场检修"
            />
          </label>
        </div>

        <button type="submit">提交报修</button>
      </div>
    </form>

    <section class="list-panel">
      <div class="toolbar">
        <h2>维修工单</h2>
        <select v-model="statusFilter">
          <option v-for="item in filters" :key="item" :value="item">{{ item }}</option>
        </select>
      </div>

      <div v-if="shownOrders.length === 0" class="empty">暂无该状态的维修单</div>
      <div v-else class="repair-list">
        <RepairCard v-for="order in shownOrders" :key="order.id" :order="order" />
      </div>
    </section>
  </div>
</template>
