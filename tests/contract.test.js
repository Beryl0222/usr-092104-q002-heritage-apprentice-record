import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateEnvelope, validateEvent } from "../src/validator.js";
import { EventStore } from "../src/store.js";
import { loadScenario } from "./helpers.js";

test("v0.1 样例继续符合基础字段校验（后向兼容）", async () => {
  const sample = JSON.parse(
    await readFile(new URL("../data/sample.json", import.meta.url), "utf8")
  );
  assert.deepEqual(validateEvent(sample), []);
  // v0.1 事件不强制 event_type_display
  assert.deepEqual(validateEnvelope(sample), []);
});

test("烧麦皮场景全部事件符合 v0.2 信封约定", async () => {
  const { events } = await loadScenario();
  for (const event of events) {
    assert.deepEqual(
      validateEnvelope(event),
      [],
      `事件 ${event.event_id} 校验应通过`
    );
  }
});

test("事件类型与聚合配对错误会被拒绝", () => {
  const errors = validateEnvelope({
    event_id: "x1",
    event_type: "REVIEW_SIGNED",
    event_type_display: "能力评议签署",
    aggregate_type: "learning_evidence",
    aggregate_id: "a1",
    occurred_at: "2026-05-01T00:00:00+08:00",
    version: 1,
    summary: "错配",
  });
  assert.ok(errors.some((e) => e.includes("聚合必须是 competency_review")));
});

test("v0.2 新事件缺少中文名会被拒绝", () => {
  const errors = validateEnvelope({
    event_id: "x2",
    event_type: "PRACTICE_ASSIGNED",
    aggregate_type: "practice_commitment",
    aggregate_id: "c1",
    occurred_at: "2026-05-01T00:00:00+08:00",
    version: 1,
    summary: "无中文名",
  });
  assert.ok(errors.includes("v0.2 起新事件必须携带 event_type_display"));
});

test("未知事件类型被拒绝，但信封层之外的读取方可容忍", async () => {
  const errors = validateEnvelope({
    event_id: "x3",
    event_type: "FUTURE_EVENT",
    event_type_display: "未来事件",
    aggregate_type: "studio_profile",
    aggregate_id: "s1",
    occurred_at: "2026-05-01T00:00:00+08:00",
    version: 1,
    summary: "未知",
  });
  assert.ok(errors.some((e) => e.includes("未知 event_type")));
});

test("存储：event_id 幂等、聚合版本连续", async () => {
  const { events } = await loadScenario();
  const store = new EventStore();
  store.append(events);
  assert.equal(store.size, events.length);

  // 同批事件重复追加：幂等丢弃，不产生重复
  const accepted = store.append(events);
  assert.equal(accepted.length, 0);
  assert.equal(store.size, events.length);

  // 同 event_id 负载不一致：报错
  const tampered = { ...events[0], summary: "被篡改" };
  assert.throws(() => store.append(tampered), /event_id 重复但负载不一致/);
});

test("存储：版本跳号、同批次重复版本都会被拒绝", async () => {
  const { events } = await loadScenario();
  const store = new EventStore();
  store.append(events);

  assert.throws(
    () =>
      store.append({
        event_id: "ev-bad-version",
        event_type: "STUDIO_REGISTERED",
        event_type_display: "工作室登记",
        aggregate_type: "studio_profile",
        aggregate_id: "studio-huimin",
        occurred_at: "2026-09-01T00:00:00+08:00",
        version: 99,
        summary: "跳号",
        body: { studio_id: "studio-huimin" },
      }),
    /版本不连续/
  );

  assert.throws(
    () =>
      new EventStore().append([
        {
          event_id: "dup-1",
          event_type: "STUDIO_REGISTERED",
          event_type_display: "工作室登记",
          aggregate_type: "studio_profile",
          aggregate_id: "s-new",
          occurred_at: "2026-09-01T00:00:00+08:00",
          version: 1,
          summary: "第一条",
        },
        {
          event_id: "dup-2",
          event_type: "STUDIO_REGISTERED",
          event_type_display: "工作室登记",
          aggregate_type: "studio_profile",
          aggregate_id: "s-new",
          occurred_at: "2026-09-01T01:00:00+08:00",
          version: 1,
          summary: "同批重复版本",
        },
      ]),
    /同一批次出现重复 version/
  );
});
