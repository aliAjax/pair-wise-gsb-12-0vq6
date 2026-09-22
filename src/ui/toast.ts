// ===== 界面层：轻量提示（不耦合业务） =====
import { reactive } from "vue";

export interface Toast {
  id: number;
  type: "success" | "error";
  text: string;
}

export const toasts = reactive<Toast[]>([]);
let seq = 0;

function push(type: Toast["type"], text: string): void {
  const id = ++seq;
  toasts.push({ id, type, text });
  window.setTimeout(() => {
    const index = toasts.findIndex((item) => item.id === id);
    if (index >= 0) toasts.splice(index, 1);
  }, 3200);
}

export const toast = {
  success(text: string): void {
    push("success", text);
  },
  error(text: string): void {
    push("error", text);
  },
  /** 对接规则层返回的 ActionResult */
  from(result: { ok: true } | { ok: false; message: string }, okText: string): void {
    if (result.ok) toast.success(okText);
    else toast.error(result.message);
  }
};
