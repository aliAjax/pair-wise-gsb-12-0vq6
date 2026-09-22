import { reactive } from "vue";

export interface ToastItem {
  id: number;
  type: "success" | "error" | "info";
  message: string;
}

const state = reactive<{ items: ToastItem[] }>({ items: [] });
let seq = 0;

function push(type: ToastItem["type"], message: string) {
  const id = ++seq;
  state.items.push({ id, type, message });
  window.setTimeout(() => {
    state.items = state.items.filter((t) => t.id !== id);
  }, 3200);
}

/** 全局轻提示：界面层共享一个单例，不引入组件库 */
export function useToast() {
  return {
    items: state.items,
    success: (m: string) => push("success", m),
    error: (m: string) => push("error", m),
    info: (m: string) => push("info", m)
  };
}
