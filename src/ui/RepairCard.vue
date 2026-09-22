<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { RepairOrder, SupplementKind } from "../data/types";
import { useFleetStore } from "../stores/fleet";
import { toast } from "./toast";

const props = defineProps<{ order: RepairOrder }>();
const store = useFleetStore();

const vehicle = computed(() => store.vehicleById(props.order.vehicleId));
const recalledTask = computed(() =>
  store.state.tasks
    .filter(
      (task) =>
        task.vehicleId === props.order.vehicleId &&
        task.status === "已回收" &&
        task.recalledAt &&
        task.recalledAt >= props.order.createdAt
    )
    .sort((a, b) => (a.recalledAt! < b.recalledAt! ? 1 : -1))[0]
);

const supplements = computed(() => store.supplementsOf(props.order.id));

// ----- 备件占用表单 -----
const reqForm = reactive({ partId: "", qty: 1 });
function occupy() {
  if (!reqForm.partId) return toast.error("请选择备件");
  toast.from(store.holdPart(props.order.id, reqForm.partId, reqForm.qty), "备件已占用");
  reqForm.qty = 1;
}

// ----- 缺件转待料 -----
const showWait = ref(false);
const waitForm = reactive({ partId: "", qty: 1 });
function toWaiting() {
  if (!waitForm.partId) return toast.error("请选择缺件备件");
  toast.from(store.waitForParts(props.order.id, waitForm.partId, waitForm.qty), "已转待料，占用数量已全部释放");
  showWait.value = false;
}

// ----- 完工填报 -----
const showComplete = ref(false);
const completeForm = reactive({
  mileage: 0,
  qcResult: "合格" as "合格" | "不合格",
  oldPartsReturned: 0,
  qcNote: ""
});
function openComplete() {
  completeForm.mileage = vehicle.value?.mileage ?? 0;
  completeForm.qcResult = "合格";
  completeForm.oldPartsReturned = props.order.requisitions.filter((l) => l.status === "已领用").length;
  completeForm.qcNote = "";
  showComplete.value = true;
}
function submitComplete() {
  toast.from(
    store.finishRepair(props.order.id, { ...completeForm }),
    completeForm.qcResult === "合格" ? "质检合格，工单已完工冻结" : "质检不合格，已退回待修"
  );
  showComplete.value = false;
}

// ----- 冻结后补录 -----
const showSupplement = ref(false);
const supForm = reactive<{ kind: SupplementKind; reason: string; mileage: number; partId: string; qty: number }>(
  { kind: "里程补录", reason: "", mileage: 0, partId: "", qty: 1 }
);
function openSupplement() {
  supForm.kind = "里程补录";
  supForm.reason = "";
  supForm.mileage = props.order.completion?.mileage ?? vehicle.value?.mileage ?? 0;
  supForm.partId = "";
  supForm.qty = 1;
  showSupplement.value = true;
}
function submitSupplement() {
  const payload =
    supForm.kind === "里程补录"
      ? { kind: supForm.kind, reason: supForm.reason, mileage: supForm.mileage }
      : { kind: supForm.kind, reason: supForm.reason, partId: supForm.partId, qty: supForm.qty };
  toast.from(store.supplement(props.order.id, payload), "补录已作为新版本留痕");
  showSupplement.value = false;
}

const statusClass = computed(() => ({
  waiting: props.order.status === "待料",
  reject: props.order.status === "质检不合格",
  done: props.order.frozen
}));

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "—");
</script>

<template>
  <article class="record repair-card" :class="{ frozen: order.frozen }">
    <div class="record-head">
      <p class="record-title">
        {{ order.title }}
        <span v-if="order.emergency" class="badge-emergency">紧急</span>
      </p>
      <span class="status" :class="statusClass">
        {{ order.status }}<template v-if="order.frozen"> · 已冻结</template>
      </span>
    </div>

    <div class="details">
      <span>车辆：{{ vehicle?.plate }} / {{ vehicle?.driver }}</span>
      <span>报修时间：{{ fmt(order.createdAt) }}</span>
      <span v-if="order.startedAt">开工时间：{{ fmt(order.startedAt) }}</span>
      <span v-if="order.waitingSince">转待料：{{ fmt(order.waitingSince) }}</span>
    </div>

    <p class="note">故障描述：{{ order.faultDesc }}</p>

    <div v-if="recalledTask" class="recall-box">
      已先回收执行中任务「{{ recalledTask.name }}」（{{ fmt(recalledTask.recalledAt) }}）
      <br />回收原因：{{ recalledTask.recallReason }}
    </div>

    <!-- 备件核销 -->
    <div class="sub-block">
      <h4>备件领用 / 核销</h4>
      <table v-if="order.requisitions.length" class="line-table">
        <thead>
          <tr><th>备件</th><th>数量</th><th>状态</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="line in order.requisitions" :key="line.id">
            <td>{{ line.partName }}</td>
            <td>{{ line.qty }}</td>
            <td>
              <span class="line-state" :class="line.status">{{ line.status }}</span>
            </td>
            <td>
              <button
                v-if="line.status === '占用' && !order.frozen"
                class="mini"
                type="button"
                @click="toast.from(store.issueLine(order.id, line.id), '已领用并核销库存')"
              >
                领用核销
              </button>
              <span v-else-if="line.status === '已领用'" class="muted">出库 {{ fmt(line.issuedAt) }}</span>
              <span v-else class="muted">已释放 {{ fmt(line.releasedAt) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">暂无备件领用记录</p>

      <div v-if="order.status === '在修'" class="inline-form">
        <select v-model="reqForm.partId">
          <option value="">选择备件</option>
          <option v-for="item in store.partsView" :key="item.part.id" :value="item.part.id">
            {{ item.part.name }}（{{ item.part.spec }}）库存{{ item.part.stock }} / 可用{{ item.available }}
          </option>
        </select>
        <input v-model.number="reqForm.qty" type="number" min="1" />
        <button class="secondary" type="button" @click="occupy">占用备件</button>
        <button class="secondary" type="button" @click="showWait = !showWait">缺件转待料</button>
      </div>

      <div v-if="showWait" class="inline-form nested">
        <select v-model="waitForm.partId">
          <option value="">缺哪个件</option>
          <option v-for="item in store.partsView" :key="item.part.id" :value="item.part.id">
            {{ item.part.name }}（{{ item.part.spec }}）
          </option>
        </select>
        <input v-model.number="waitForm.qty" type="number" min="1" placeholder="缺件数量" />
        <button type="button" @click="toWaiting">确认转待料（释放已占数量）</button>
      </div>
    </div>

    <!-- 待料信息 -->
    <div v-if="order.status === '待料'" class="waiting-box">
      缺件：{{ order.waitingPartName }} × {{ order.waitingQty }}，等待入库；车辆继续停机，已占数量已释放。
    </div>

    <!-- 质检不合格记录 -->
    <div v-if="order.lastQc && order.status === '质检不合格'" class="qc-fail-box">
      质检不合格（{{ fmt(order.lastQc.at) }}）：里程 {{ order.lastQc.mileage }} km，
      回收旧件 {{ order.lastQc.oldPartsReturned }} 件
      <template v-if="order.lastQc.qcNote">，意见：{{ order.lastQc.qcNote }}</template>
    </div>

    <!-- 完工冻结快照 -->
    <div v-if="order.completion" class="completion-box">
      <h4>完工快照（已冻结，备件与里程不可修改）</h4>
      <div class="details">
        <span>完工里程：{{ order.completion.mileage.toLocaleString() }} km</span>
        <span>质检：{{ order.completion.qcResult }}</span>
        <span>旧件回收：{{ order.completion.oldPartsReturned }} 件</span>
        <span>完工时间：{{ fmt(order.completion.finishedAt) }}</span>
      </div>
      <p v-if="order.completion.qcNote" class="muted">质检备注：{{ order.completion.qcNote }}</p>
    </div>

    <!-- 补录版本 -->
    <div v-if="supplements.length" class="sub-block">
      <h4>补录版本（只增不改）</h4>
      <div v-for="sup in supplements" :key="sup.id" class="version-row">
        <strong>v{{ sup.version }}</strong>
        <span class="tag">{{ sup.kind }}</span>
        <span v-if="sup.kind === '里程补录'">里程 {{ sup.mileage?.toLocaleString() }} km</span>
        <span v-else>{{ sup.partName }} × {{ sup.qty }}（仅留痕，不扣库存）</span>
        <span class="muted">原因：{{ sup.reason }} ｜ {{ fmt(sup.createdAt) }}</span>
      </div>
    </div>

    <!-- 操作区 -->
    <div class="actions">
      <button v-if="order.status === '待修'" type="button" @click="toast.from(store.beginRepair(order.id), '已开工')">
        开工
      </button>
      <button
        v-if="order.status === '质检不合格'"
        type="button"
        @click="toast.from(store.returnRepairToPending(order.id), '已退回待修，重新维修')"
      >
        退回待修
      </button>
      <button v-if="order.status === '在修'" type="button" @click="openComplete">填报完工</button>
      <button
        v-if="order.status === '待料'"
        type="button"
        @click="toast.from(store.resumeRepair(order.id), '备件到位，已复工')"
      >
        备件到位 · 复工
      </button>
      <button v-if="order.frozen" class="secondary" type="button" @click="openSupplement">补录（生成版本）</button>
      <button
        v-if="!order.frozen"
        class="danger"
        type="button"
        @click="toast.from(store.abandonRepair(order.id), '工单已取消，占用数量已释放')"
      >
        取消工单
      </button>
    </div>

    <!-- 完工弹层（内嵌） -->
    <div v-if="showComplete" class="modal-mask" @click.self="showComplete = false">
      <div class="modal">
        <h3>完工填报：里程 / 质检 / 旧件</h3>
        <label>
          完工里程（km，不小于当前 {{ vehicle?.mileage.toLocaleString() }}）
          <input v-model.number="completeForm.mileage" type="number" min="0" />
        </label>
        <label>
          质量检验
          <select v-model="completeForm.qcResult">
            <option value="合格">合格</option>
            <option value="不合格">不合格（退回待修）</option>
          </select>
        </label>
        <label>
          旧件回收数量（已领用备件时至少 1 件）
          <input v-model.number="completeForm.oldPartsReturned" type="number" min="0" />
        </label>
        <label>
          质检备注
          <textarea v-model="completeForm.qcNote" placeholder="不合格时请写明返修意见" />
        </label>
        <div class="actions">
          <button type="button" @click="submitComplete">提交质检</button>
          <button class="secondary" type="button" @click="showComplete = false">取消</button>
        </div>
      </div>
    </div>

    <!-- 补录弹层 -->
    <div v-if="showSupplement" class="modal-mask" @click.self="showSupplement = false">
      <div class="modal">
        <h3>冻结后补录（仅生成带原因的新版本）</h3>
        <label>
          补录类型
          <select v-model="supForm.kind">
            <option value="里程补录">里程补录</option>
            <option value="备件补录">备件补录（仅留痕）</option>
          </select>
        </label>
        <label v-if="supForm.kind === '里程补录'">
          订正里程（km）
          <input v-model.number="supForm.mileage" type="number" min="0" />
        </label>
        <template v-else>
          <label>
            备件
            <select v-model="supForm.partId">
              <option value="">选择备件</option>
              <option v-for="item in store.partsView" :key="item.part.id" :value="item.part.id">
                {{ item.part.name }}（{{ item.part.spec }}）
              </option>
            </select>
          </label>
          <label>
            数量
            <input v-model.number="supForm.qty" type="number" min="1" />
          </label>
        </template>
        <label>
          补录原因（必填，不少于 5 字）
          <textarea v-model="supForm.reason" placeholder="如：完工时里程表读数登记错误，依据回场小票订正" />
        </label>
        <div class="actions">
          <button type="button" @click="submitSupplement">生成补录版本</button>
          <button class="secondary" type="button" @click="showSupplement = false">取消</button>
        </div>
      </div>
    </div>
  </article>
</template>
