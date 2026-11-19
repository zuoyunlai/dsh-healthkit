// 采集降级通道（P2-4）。
//
// 审计发现：src/ 里有 16 处「空 catch」——`catch (e) { /* 坏行跳过 */ }`。
// 单看每一处都合理，合起来会造出一种最坏的错觉：**采集失败了，报告却显示「一切正常」**。
// 本仓自己的原则是「判不了就写 UNKNOWN」，所以降级必须留痕、必须能出现在一行结论里。
//
// 设计克制：
//   · 只记录**影响结论完整性**的降级（账本坏行、快照读不出、能力域取不到）；
//   · 每条带 code + 计数 + 一句人话，不塞堆栈；
//   · 渲染成一行，出现在报告与周报里；空数组时**什么都不显示**（正常路径零噪声）。
export const DEGRADE_SCHEMA = 'dsh-healthkit/degradations/v1';

export function createSink() {
  const items = [];
  return {
    add(code, detail, count) {
      const c = typeof count === 'number' ? count : 1;
      const hit = items.find((x) => x.code === code);
      if (hit) { hit.count += c; return hit; }
      const item = { code: code, detail: String(detail || '').slice(0, 200), count: c };
      items.push(item);
      return item;
    },
    list() { return items.slice(); },
    clear() { items.length = 0; },
    get size() { return items.length; },
  };
}

// 进程内单例：采集发生在多个模块（history / snapshot / capability-map），
// 让它们往同一个桶里加，最后由 engine 一次性取出**并清空**。
// 清空很重要——否则一次降级会在之后每次体检里重复出现。
const globalSink = createSink();

export function note(code, detail, count) { return globalSink.add(code, detail, count); }

export function drain() {
  const out = globalSink.list();
  globalSink.clear();
  return out;
}

// 测试与需要隔离的场景用
export function resetSink() { globalSink.clear(); }

export function renderDegradations(list) {
  if (!list || !list.length) return '';
  const total = list.reduce((a, x) => (x && typeof x.count === 'number' ? a + x.count : a), 0);
  const parts = list.map((x) => x.code + '×' + x.count).join(' / ');
  return '采集降级 ' + total + ' 处（' + parts + '）——这些地方**判不了**，不代表没问题；' + (list[0].detail || '');
}
