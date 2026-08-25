/**
 * `@deepseek-ai/dsh-client-runtime/client` 在 Node 下的替身。
 *
 * 真身是一份浏览器 bundle：模块体第一行就是 `window.__ModuleLoader__.load(...)`，
 * 在 Node 里 import 会直接 `ReferenceError: window is not defined`，装 jsdom 也没用
 * （缺的是 dsh 自己的模块加载器，不是 DOM）。`vitest.config.ts` 把这个说明符别名到
 * 本文件，好让浏览器半侧那些**与 DOM 无关**的纯逻辑（暂存表单）能被测到。
 *
 * 这里只补 `card-form.ts` 用到的那一个导出，语义与契约一致（见 client-runtime 的
 * `contract/store.d.ts`）。类型仍然从真身的 `.d.ts` 走，所以两边漂了 typecheck 会红。
 */

/** 契约里 SnapshotStore 的最小实现。 */
interface Store<T> {
  getSnapshot: () => T
  subscribe: (fn: () => void) => () => void
  set: (next: T) => void
  update: (mutator: (draft: T) => void) => void
}

/**
 * 造一个同步发布的快照 store。
 * @param init - 初始状态。
 * @returns store。
 */
export function createSnapshotStore<T>(init: T): Store<T> {
  let state = init
  const listeners = new Set<() => void>()
  const publish = (): void => { for (const listener of listeners) listener() }
  return {
    getSnapshot: () => state,
    subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    set: (next) => { state = next; publish() },
    // 真身走 immer 草稿；这里只需要「改完发布」这一点语义
    update: (mutator) => { mutator(state); publish() },
  }
}
