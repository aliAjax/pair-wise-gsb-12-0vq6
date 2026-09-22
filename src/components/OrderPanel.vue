<script setup lang="ts">
import { computed, ref } from "vue";
import { useFleetStore } from "../stores/fleet";
import { useToast } from "./toast";
import PartLinesEditor from "./PartLinesEditor.vue";
import OrderDetail from "./OrderDetail.vue";
import type { PartLine } from "../types";

const store = useFleetStore();
const toast = useToast();

const statusFilter = ref("全部");
const filters = ["全部", "待修", "在修", "待料", "已完成"];
const expanded = ref<string | null>(null);

const list = computed(() =>
  store.orders.filter((o) => statusFilter.value === "全部" || o.status === statusFilter.value)
);

function vehiclePlate(vehicleId: string) {
  return store.vehicles.find((v) => v.id === vehicleId)?.plate ?? vehicleId;
}

// 领用表单（每个工单一份，挂在工单上展开）
const issueLines = ref<Record<string, PartLine[]>>({});
const finishingId = ref<string | null>(null);
const amendingId = ref<string | null>(null);

function linesFor(orderId: string): PartLine[] {
  if (!issueLines.value[orderId]) issueLines.value[orderId] = [{ partId: "", qty: 1 }];
  return issueLines.value[orderId];
}

/** 渲染前保证每张在修工单都有可被 v-model 索引的领用行 */
const issueDraft = computed(() => {
  for (const o of list.value) {
    if (o.status === "在修") linesFor(o.id);
  }
  return issueLines.value;
});

function doStart(id: string) {
  const r = store.start(id);
  if (!r.ok) return toast.error(r.error!);
  toast.success("已开工");
}

function doRequest(id: string) {
  const lines = linesFor(id).filter((l) => l.partId && l.qty > 0);
  if (lines.length === 0) return toast.error("请选择备件并填写数量");
  const r = store.requestIssue(id, lines);
  if (!r.ok) return toast.error(r.error!);
  toast.success("已预占备件，请在核销台确认");
  issueLines.value[id] = [{ partId: "", qty: 1 }];
}

function doConfirm(id: string) {
  const r = store.confirm(id);
  if (!r.ok) return toast.error(r.error!);
  toast.success("已核销出库");
}

function doRelease(id: string) {
  const r = store.releaseHeld(id);
  if (!r.ok) return toast.error(r.error!);
  toast.success("已释放预占数量，库存恢复可用");
}

function doRetry(id: string) {
  const r = store.retry(id);
  if (!r.ok) return toast.error(r.error!);
  toast.success("备件已补齐并核销，工单复工");
}

function doCancelWait(id: string) {
  const r = store.cancelWait(id);
  if (!r.ok) return toast.error(r.error!);
  toast.success("已取消待料并返回在修");
}

// 完工表单
const finishMileage = ref(0);
const inspectPass = ref(true);
const inspectNote = ref("");
const oldParts = ref("");

function openFinish(id: string) {
  const v = store.vehicles.find((x) => x.id === store.orders.find((o) => o.id === id)?.vehicleId);
  finishingId.value = id;
  finishMileage.value = v?.mileage ?? 0;
  inspectPass.value = true;
  inspectNote.value = "";
  oldParts.value = "";
}

function doFinish(id: string) {
  const r = store.finish(id, {
    mileage: finishMileage.value,
    inspectPass: inspectPass.value,
    inspectNote: inspectNote.value,
    oldPartsReturned: oldParts.value
  });
  if (!r.ok) return toast.error(r.error!);
  toast.success(inspectPass.value ? "完工合格，备件与里程已冻结" : "质检不合格，已退回待修");
  finishingId.value = null;
}

// 补录表单
const amendReason = ref("");
const amendMileage = ref(0);
const amendOldParts = ref("");
const amendDeltas = ref<PartLine[]>([{ partId: "", qty: 0 }]);

function openAmend(id: string) {
  amendingId.value = id;
  amendReason.value = "";
  amendMileage.value = store.effectiveOrderMileage(id);
  amendOldParts.value = "";
  amendDeltas.value = [{ partId: "", qty: 0 }];
}

function doAmend(id: string) {
  const r = store.amend(id, {
    reason: amendReason.value,
    mileage: amendMileage.value,
    partDeltas: amendDeltas.value.filter((d) => d.partId && d.qty !== 0),
    oldPartsReturned: amendOldParts.value
  });
  if (!r.ok) return toast.error(r.error!);
  toast.success("补录已作为新版本保存，原始记录未改动");
  amendingId.value = null;
}

function toggle(id: string) {
  expanded.value = expanded.value === id ? null : id;
}
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <h2>维修工单台</h2>
      <div class="filter-tabs">
        <button
          v-for="f in filters"
          :key="f"
          type="button"
          class="tab"
          :class="{ active: statusFilter === f }"
          @click="statusFilter = f"
        >
          {{ f }}
        </button>
      </div>
    </div>

    <div v-if="list.length === 0" class="empty">暂无该状态工单</div>

    <article v-for="o in list" :key="o.id" class="order-card" :class="`os-${o.status}`">
      <header class="order-head" @click="toggle(o.id)">
        <div>
          <p class="order-title">
            <span class="order-code">{{ o.code }}</span>
            <span v-if="o.emergency" class="badge-emergency">紧急</span>
            {{ o.title }}
          </p>
          <p class="order-meta">
            {{ vehiclePlate(o.vehicleId) }} · {{ new Date(o.createdAt).toLocaleString("zh-CN") }}
          </p>
        </div>
        <span class="status" :class="`st-${o.status}`">{{ o.status }}</span>
      </header>

      <p class="order-reason">报修原因：{{ o.reason }}</p>
      <p v-if="o.recall" class="recall-note">
        已回收任务「{{ o.recall.taskName }}」；回收原因：{{ o.recall.reason }}
      </p>

      <!-- 在修：领用 + 预占核销 -->
      <div v-if="o.status === '在修'" class="action-block">
        <PartLinesEditor v-if="issueDraft[o.id]" v-model="issueDraft[o.id]" />
        <div class="btn-row">
          <button type="button" @click.stop="doRequest(o.id)">申请领用（预占库存）</button>
          <button type="button" class="secondary" @click.stop="openFinish(o.id)">完工登记</button>
        </div>

        <div v-if="store.heldByOrder(o.id).length" class="held-box">
          <p class="held-title">待核销（已预占，刷新后仍占用库存）：</p>
          <p v-for="l in store.heldByOrder(o.id)" :key="l.partId" class="held-line">
            {{ store.partById(l.partId)?.name }} × {{ l.qty }}
            <span class="muted">（可用库存 {{ store.available(l.partId) }}）</span>
          </p>
          <div class="btn-row">
            <button type="button" @click.stop="doConfirm(o.id)">确认核销</button>
            <button type="button" class="secondary" @click.stop="doRelease(o.id)">释放已占数量</button>
          </div>
        </div>
      </div>

      <!-- 待修 -->
      <div v-else-if="o.status === '待修'" class="btn-row">
        <button type="button" @click.stop="doStart(o.id)">开工</button>
      </div>

      <!-- 待料 -->
      <div v-else-if="o.status === '待料'" class="wait-box">
        <p class="held-title">缺件待料需求（不占用库存）：</p>
        <p v-for="l in o.pendingParts" :key="l.partId" class="held-line">
          {{ store.partById(l.partId)?.name }} 需 {{ l.qty }}
          <span class="muted">（当前可用 {{ store.available(l.partId) }}）</span>
        </p>
        <p v-for="s in o.shortages" :key="s.partId" class="shortage">
          {{ store.partById(s.partId)?.name }}：需 {{ s.need }}，可用仅 {{ s.available }}
        </p>
        <div class="btn-row">
          <button type="button" @click.stop="doRetry(o.id)">到货后复工（重新核销）</button>
          <button type="button" class="secondary" @click.stop="doCancelWait(o.id)">取消待料</button>
        </div>
        <p class="hint">备件到货入库后点「复工」，整单满足才核销，仍缺件则继续待料。</p>
      </div>

      <!-- 已完成：冻结展示 + 补录 -->
      <div v-else class="done-box">
        <div class="freeze-grid">
          <span>冻结里程：<strong>{{ o.finish?.mileage.toLocaleString() }} km</strong></span>
          <span>
            当前有效里程：<strong>{{ store.effectiveOrderMileage(o.id).toLocaleString() }} km</strong>
            <em v-if="o.versions.length" class="amended">（含 V{{ o.versions.length }} 补录）</em>
          </span>
        </div>
        <p class="held-line">质检：合格 / {{ o.finish?.inspectNote }}</p>
        <p class="held-line">旧件回收：{{ o.finish?.oldPartsReturned }}</p>
        <button type="button" class="secondary" @click.stop="amendingId === o.id ? (amendingId = null) : openAmend(o.id)">
          {{ amendingId === o.id ? "收起补录" : "补录（生成带原因版本）" }}
        </button>

        <form v-if="amendingId === o.id" class="amend-form" @submit.stop.prevent="doAmend(o.id)">
          <label>
            补录原因（必填）
            <textarea v-model="amendReason" placeholder="如：完工后复检发现机滤渗漏，追加更换" required />
          </label>
          <label>
            补录里程（km，不小于当前）
            <input v-model.number="amendMileage" type="number" required />
          </label>
          <PartLinesEditor v-model="amendDeltas" signed />
          <p class="hint">正数为补领核销，负数为退库；原始核销与里程快照不变。</p>
          <label>
            补录旧件回收说明
            <input v-model="amendOldParts" placeholder="如：追加回收旧机滤1个" />
          </label>
          <button type="submit">保存补录版本</button>
        </form>
      </div>

      <!-- 完工弹层（内嵌面板） -->
      <form v-if="finishingId === o.id" class="finish-panel" @submit.stop.prevent="doFinish(o.id)">
        <h4>完工登记（里程 / 质检 / 旧件缺一不可）</h4>
        <label>
          完工里程（km）
          <input v-model.number="finishMileage" type="number" required />
        </label>
        <label class="check-line">
          <input v-model="inspectPass" type="checkbox" />
          质检合格（不合格将退回待修，里程不冻结）
        </label>
        <label>
          质检意见
          <textarea v-model="inspectNote" placeholder="如：制动测试合格，无跑偏" required />
        </label>
        <label>
          旧件回收记录
          <textarea v-model="oldParts" placeholder="如：旧刹车片2副已回收，回收单号 HS-..." required />
        </label>
        <div class="btn-row">
          <button type="submit">提交完工</button>
          <button type="button" class="secondary" @click.stop="finishingId = null">取消</button>
        </div>
      </form>

      <OrderDetail v-if="expanded === o.id" :order="o" />
    </article>
  </section>
</template>
