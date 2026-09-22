// 规则引擎端到端冒烟脚本：用 esbuild 把 TS 转译成临时 ESM 后执行。
import { writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// 简易断言计数
let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log("  ✓", msg); }
  else { failed++; console.error("  ✗", msg); }
}
function expectThrow(fn, fragment, msg) {
  try { fn(); failed++; console.error("  ✗", msg, "（未抛错）"); }
  catch (e) {
    if (fragment && !String(e.message).includes(fragment)) {
      failed++; console.error("  ✗", msg, "（错误信息不符：", e.message, "）");
    } else { passed++; console.log("  ✓", msg); }
  }
}

// 动态加载编译后的引擎（先 esbuild 打包成临时 esm）
const { build } = await import("esbuild");
const result = await build({
  entryPoints: ["src/rules/engine.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent"
});
const code = result.outputFiles[0].text;
const tmp = join(tmpdir(), `engine-check-${Date.now()}.mjs`);
writeFileSync(tmp, code);
const engine = await import(tmp);
rmSync(tmp, { force: true });

// 自建最小 state（不依赖 seed 的时间戳）
function baseState() {
  return {
    schemaVersion: 1,
    vehicles: [
      { id: "v1", plate: "A", driver: "d1", zone: "城北", taskStatus: "空闲", taskName: "", taskAssignedAt: null, mileage: 1000, note: "" },
      { id: "v2", plate: "B", driver: "d2", zone: "城东", taskStatus: "执行中", taskName: "冷链配送", taskAssignedAt: new Date().toISOString(), mileage: 2000, note: "" }
    ],
    parts: [
      { id: "p1", code: "P1", name: "机油", spec: "", unit: "桶" },
      { id: "p2", code: "P2", name: "轮胎", spec: "", unit: "条" }
    ],
    orders: [],
    movements: [
      { id: "m1", partId: "p1", type: "入库", qty: 3, at: new Date().toISOString(), reason: "" },
      { id: "m2", partId: "p2", type: "入库", qty: 2, at: new Date().toISOString(), reason: "" }
    ],
    reservations: []
  };
}

const {
  createOrder, startOrder, requestParts, confirmIssue, releaseReserved,
  retryPending, receiveStock, finishOrder, amendOrder, assignTask,
  stockOf, reservedOf, availableOf, openOrderOf, phaseOf, effectiveMileage,
  effectiveParts, RuleError
} = engine;

console.log("R1 执行中不能报修 / 紧急报修先回收任务");
let s = baseState();
expectThrow(() => createOrder({ vehicleId: "v2", title: "t", reason: "r", emergency: false }, s), "执行中", "执行中普通报修被拒绝");
expectThrow(
  () => createOrder({ vehicleId: "v2", title: "t", reason: "r", emergency: true, recallReason: "  " }, s),
  "写明原因", "紧急报修缺原因被拒绝"
);
s = createOrder({ vehicleId: "v2", title: "水温高", reason: "报警", emergency: true, recallReason: "高速水温报警" }, s);
assert(s.vehicles[1].taskStatus === "空闲", "紧急报修后任务被回收");
assert(s.orders[0].recall?.taskName === "冷链配送" && s.orders[0].recall?.reason === "高速水温报警", "工单留存回收记录与原因");

console.log("R2 单车一张在修单 + 派工停机校验");
expectThrow(
  () => createOrder({ vehicleId: "v2", title: "t2", reason: "r", emergency: false }, s),
  "一张在修单", "重复报修被拒绝"
);
expectThrow(() => assignTask(s, "v2", "新任务"), "停机", "停机车辆不能派工");
assert(phaseOf(s, s.vehicles[1]) === "保养停机", "阶段派生为保养停机");

console.log("R3/R4 领用不超库存、缺件回滚释放");
let s2 = baseState();
s2 = createOrder({ vehicleId: "v1", title: "保养", reason: "到期", emergency: false }, s2);
const oid = s2.orders[0].id;
s2 = startOrder(s2, oid);
// p1 需5，可用仅3 → 转待料，回滚
s2 = requestParts(s2, oid, [{ partId: "p1", qty: 5 }]);
assert(s2.orders[0].status === "待料", "缺件整单转待料");
assert(stockOf(s2, "p1") === 3 && reservedOf(s2, "p1") === 0 && availableOf(s2, "p1") === 3, "转待料后已占数量全部释放");
assert(s2.orders[0].pendingParts[0].qty === 5, "待料需求登记为5");

console.log("  原子性：多行间前几行占用、后行缺件也全部回滚");
let s3 = baseState();
s3 = createOrder({ vehicleId: "v1", title: "x", reason: "r", emergency: false }, s3);
s3 = startOrder(s3, s3.orders[0].id);
s3 = requestParts(s3, s3.orders[0].id, [{ partId: "p1", qty: 3 }, { partId: "p2", qty: 9 }]);
assert(s3.orders[0].status === "待料", "混合申请因 p2 缺件转待料");
assert(reservedOf(s3, "p1") === 0, "p1 已预占的3被回滚释放");

console.log("  正常预占 → 核销两阶段");
let s4 = baseState();
s4 = createOrder({ vehicleId: "v1", title: "保养", reason: "到期", emergency: false }, s4);
const o4 = s4.orders[0].id;
s4 = startOrder(s4, o4);
s4 = requestParts(s4, o4, [{ partId: "p1", qty: 2 }]);
assert(availableOf(s4, "p1") === 1 && stockOf(s4, "p1") === 3, "预占2后结存3、可用1");
s4 = confirmIssue(s4, o4);
assert(stockOf(s4, "p1") === 1 && reservedOf(s4, "p1") === 0, "核销后结存1、预占清零");
assert(s4.orders[0].parts[0].qty === 2, "工单记录已核销2");

console.log("  释放预占恢复库存");
let s5 = baseState();
s5 = createOrder({ vehicleId: "v1", title: "t", reason: "r", emergency: false }, s5);
s5 = startOrder(s5, s5.orders[0].id);
s5 = requestParts(s5, s5.orders[0].id, [{ partId: "p1", qty: 2 }]);
s5 = releaseReserved(s5, s5.orders[0].id);
assert(availableOf(s5, "p1") === 3 && reservedOf(s5, "p1") === 0, "释放后可用恢复3");

console.log("  待料 → 入库 → 复工自动核销");
let s6 = baseState();
s6 = createOrder({ vehicleId: "v1", title: "t", reason: "r", emergency: false }, s6);
s6 = startOrder(s6, s6.orders[0].id);
s6 = requestParts(s6, s6.orders[0].id, [{ partId: "p2", qty: 4 }]);
assert(s6.orders[0].status === "待料", "需4仅有2，转待料");
s6 = receiveStock(s6, "p2", 3, "采购入库");
s6 = retryPending(s6, s6.orders[0].id);
assert(s6.orders[0].status === "在修", "到货后复工");
assert(stockOf(s6, "p2") === 1, "复工核销后 p2 结存1（5−4）");
assert(s6.orders[0].pendingParts.length === 0, "待料需求清空");

console.log("R5 完工三必填 + 不合格退回待修 + 合格冻结");
let s7 = baseState();
s7 = createOrder({ vehicleId: "v1", title: "t", reason: "r", emergency: false }, s7);
s7 = startOrder(s7, s7.orders[0].id);
s7 = requestParts(s7, s7.orders[0].id, [{ partId: "p1", qty: 1 }]);
s7 = confirmIssue(s7, s7.orders[0].id);
expectThrow(() => finishOrder(s7, s7.orders[0].id, { mileage: 500, inspectPass: true, inspectNote: "ok", oldPartsReturned: "旧件" }), "当前里程", "里程小于当前被拒绝");
expectThrow(() => finishOrder(s7, s7.orders[0].id, { mileage: 1200, inspectPass: true, inspectNote: "ok", oldPartsReturned: "" }), "旧件", "缺旧件回收被拒绝");
// 不合格
s7 = finishOrder(s7, s7.orders[0].id, { mileage: 1200, inspectPass: false, inspectNote: "漏油", oldPartsReturned: "旧机滤" });
assert(s7.orders[0].status === "待修" && s7.orders[0].finish === null, "质检不合格退回待修，无冻结快照");
assert(s7.vehicles[0].mileage === 1000, "不合格里程不写车辆");
// 重新开工再合格完工
s7 = startOrder(s7, s7.orders[0].id);
s7 = finishOrder(s7, s7.orders[0].id, { mileage: 1200, inspectPass: true, inspectNote: "合格", oldPartsReturned: "旧机滤回收 HS-1" });
assert(s7.orders[0].status === "已完成" && s7.orders[0].finish.mileage === 1200, "合格完工冻结");
assert(s7.vehicles[0].mileage === 1200, "车辆里程更新为1200");
// 有未核销预占不能完工
let s7b = baseState();
s7b = createOrder({ vehicleId: "v1", title: "t", reason: "r", emergency: false }, s7b);
s7b = startOrder(s7b, s7b.orders[0].id);
s7b = requestParts(s7b, s7b.orders[0].id, [{ partId: "p1", qty: 1 }]);
expectThrow(() => finishOrder(s7b, s7b.orders[0].id, { mileage: 1100, inspectPass: true, inspectNote: "ok", oldPartsReturned: "x" }), "未核销", "有预占未核销时禁止完工");

console.log("R6 补录只追加带原因版本");
expectThrow(() => amendOrder(s7, s7.orders[0].id, { reason: "  ", mileage: 1300, partDeltas: [], oldPartsReturned: "" }), "原因", "补录缺原因被拒绝");
s7 = amendOrder(s7, s7.orders[0].id, { reason: "复检渗漏补换机滤", mileage: 1300, partDeltas: [{ partId: "p2", qty: 1 }], oldPartsReturned: "旧件2" });
const o7 = s7.orders[0];
assert(o7.versions.length === 1 && o7.versions[0].version === 1 && o7.versions[0].reason.includes("复检"), "生成 V1 带原因版本");
assert(o7.finish.mileage === 1200, "原始冻结里程仍为1200");
assert(effectiveMileage(o7) === 1300, "有效里程为最新版本1300");
assert(s7.vehicles[0].mileage === 1300, "车辆里程同步1300");
assert(o7.parts[0].qty === 1, "原始备件明细未被改写");
// 退库
s7 = amendOrder(s7, o7.id, { reason: "多领退回", mileage: 1300, partDeltas: [{ partId: "p1", qty: -1 }], oldPartsReturned: "" });
const o7v2 = s7.orders[0];
assert(
  effectiveParts(o7v2).filter((l) => l.partId === "p1").length === 0,
  "退1后 p1 净核销为0"
);
assert(stockOf(s7, "p1") === 3, "退库后 p1 结存恢复3");
assert(o7v2.versions.length === 2, "版本追加为 V2");
// 超退被拒绝
expectThrow(
  () => amendOrder(s7, o7v2.id, { reason: "x", mileage: 1300, partDeltas: [{ partId: "p1", qty: -5 }], oldPartsReturned: "" }),
  "超过", "退库超过已核销数量被拒绝"
);

console.log("\n结果：", passed, "通过，", failed, "失败");
process.exit(failed ? 1 : 0);
