import {
  AGGREGATE_TYPES,
  EVENT_AGGREGATE,
  EVENT_TYPES,
  V01_EVENT_TYPES,
} from "./constants.js";

const required = [
  "event_id",
  "event_type",
  "aggregate_type",
  "aggregate_id",
  "occurred_at",
  "version",
  "summary",
];

// v0.1 基础字段校验：语义保持不变，历史调用方继续可用。
export function validateEvent(record) {
  const errors = required
    .filter((name) => !(name in record))
    .map((name) => `缺少字段：${name}`);
  if ("version" in record && (!Number.isInteger(record.version) || record.version < 1))
    errors.push("version 必须是正整数");
  return errors;
}

// v0.2 完整信封校验：枚举、事件↔聚合配对、新事件中文名、时间格式。
export function validateEnvelope(record) {
  const errors = validateEvent(record);
  if (errors.some((e) => e.startsWith("缺少字段"))) return errors;

  if (!EVENT_TYPES.includes(record.event_type))
    errors.push(`未知 event_type：${record.event_type}`);
  if (!AGGREGATE_TYPES.includes(record.aggregate_type))
    errors.push(`未知 aggregate_type：${record.aggregate_type}`);

  const expectedAggregate = EVENT_AGGREGATE[record.event_type];
  if (expectedAggregate && record.aggregate_type !== expectedAggregate)
    errors.push(
      `${record.event_type} 的聚合必须是 ${expectedAggregate}，实际为 ${record.aggregate_type}`
    );

  if (!V01_EVENT_TYPES.has(record.event_type) && !record.event_type_display)
    errors.push("v0.2 起新事件必须携带 event_type_display");

  if (Number.isNaN(Date.parse(record.occurred_at)))
    errors.push("occurred_at 必须是合法的 date-time");

  return errors;
}
