import { validateEnvelope } from "./validator.js";

// append-only 事件存储：
// - event_id 全局唯一，重复提交按幂等丢弃（同一 event_id 负载不一致则报错）；
// - 每个聚合实例的 version 从 1 起连续，不允许跳号或重复；
// - 事件只追加，不提供修改/删除入口（复核以后继意见表达，见 contracts/domain.md 2.3）。
export class EventStore {
  constructor() {
    this._events = [];
    this._ids = new Map(); // event_id -> 事件
    this._aggregateVersions = new Map(); // aggregate_type/aggregate_id -> Set(version)
  }

  static duplicateKey(aggregateType, aggregateId) {
    return `${aggregateType}/${aggregateId}`;
  }

  append(events) {
    const batch = Array.isArray(events) ? events : [events];
    const accepted = [];

    // 先整批校验，再统一提交，避免半截写入。
    const staged = [];
    for (const event of batch) {
      const errors = validateEnvelope(event);
      if (errors.length) throw new EventContractError(event, errors);

      const known = this._ids.get(event.event_id);
      if (known) {
        if (JSON.stringify(known) !== JSON.stringify(event))
          throw new Error(`event_id 重复但负载不一致：${event.event_id}`);
        continue; // 幂等：同一事件重放，丢弃
      }

      const key = EventStore.duplicateKey(event.aggregate_type, event.aggregate_id);
      staged.push({ event, key });
    }

    // 批内 version 冲突预检
    const batchVersions = new Map();
    for (const { event, key } of staged) {
      const set = batchVersions.get(key) ?? new Set();
      if (set.has(event.version))
        throw new Error(`聚合 ${key} 在同一批次出现重复 version：${event.version}`);
      set.add(event.version);
      batchVersions.set(key, set);
    }

    for (const { event, key } of staged) {
      const existing = this._aggregateVersions.get(key) ?? new Set();
      const merged = new Set(existing);
      merged.add(event.version);
      // 连续性：合并后必须恰好为 1..n
      for (let v = 1; v <= merged.size; v++) {
        if (!merged.has(v))
          throw new Error(`聚合 ${key} 事件版本不连续：缺少 version ${v}`);
      }
      this._aggregateVersions.set(key, merged);
    }

    for (const { event } of staged) {
      this._events.push(event);
      this._ids.set(event.event_id, event);
      accepted.push(event);
    }
    return accepted;
  }

  // 重放顺序：按 occurred_at；同一时刻按聚合内 version，再按 event_id 确定总序。
  replay() {
    return [...this._events].sort((a, b) => {
      const t = Date.parse(a.occurred_at) - Date.parse(b.occurred_at);
      if (t !== 0) return t;
      const v = a.version - b.version;
      if (v !== 0) return v;
      return a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0;
    });
  }

  get size() {
    return this._events.length;
  }
}

export class EventContractError extends Error {
  constructor(event, errors) {
    super(`事件 ${event?.event_id ?? "(无 event_id)"} 不符合信封约定：${errors.join("；")}`);
    this.name = "EventContractError";
    this.errors = errors;
  }
}
