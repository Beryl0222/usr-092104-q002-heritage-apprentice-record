import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateEvent, validateEventLog } from "../src/validator.js";
import {
  AGGREGATE_TYPES,
  EVENT_AGGREGATE,
  EVENT_TYPES,
  PAYLOAD_REQUIRED,
} from "../src/event-catalog.js";

const here = (p) => new URL(p, import.meta.url);
const loadJson = (p) => readFile(here(p), "utf8").then(JSON.parse);

test("样例符合领域约定", async () => {
  const sample = await loadJson("../data/sample.json");
  assert.deepEqual(validateEvent(sample), []);
});

test("事件目录与 JSON Schema 的枚举一致且仅追加", async () => {
  const schema = await loadJson("../contracts/domain.schema.json");
  const schemaEvents = schema.properties.event_type.enum;
  const schemaAggregates = schema.properties.aggregate_type.enum;

  // 既有五个事件标识必须原样保留在最前，接入边界不变
  assert.deepEqual(schemaEvents.slice(0, 5), [
    "CRAFT_REGISTERED",
    "EVIDENCE_SUBMITTED",
    "REVIEW_SIGNED",
    "CERTIFICATE_ISSUED",
    "PLACEMENT_TRANSFERRED",
  ]);
  for (const type of Object.values(EVENT_TYPES)) assert.ok(schemaEvents.includes(type), `schema 缺少事件 ${type}`);
  for (const type of Object.values(AGGREGATE_TYPES)) {
    assert.ok(schemaAggregates.includes(type), `schema 缺少聚合 ${type}`);
  }
  for (const type of Object.keys(PAYLOAD_REQUIRED)) {
    assert.ok(EVENT_AGGREGATE[type], `事件 ${type} 未声明聚合归属`);
  }
});

test("事件目录与 JSON Schema 的 payload 必填字段一致", async () => {
  const schema = await loadJson("../contracts/domain.schema.json");
  for (const clause of schema.allOf) {
    const eventType = clause.if.properties.event_type.const;
    const schemaRequired = clause.then.properties.payload.required;
    const catalogRequired = PAYLOAD_REQUIRED[eventType];
    assert.ok(catalogRequired, `目录缺少事件 ${eventType} 的 payload 约定`);
    assert.deepEqual([...schemaRequired].sort(), [...catalogRequired].sort(), `事件 ${eventType} 必填字段漂移`);
    assert.equal(
      clause.then.properties.aggregate_type.const,
      EVENT_AGGREGATE[eventType],
      `事件 ${eventType} 的聚合归属在 schema 与目录间漂移`,
    );
  }
});

test("事件与聚合类型必须配对", () => {
  const bad = {
    event_id: "x1",
    event_type: EVENT_TYPES.ATTENDANCE_LOGGED,
    aggregate_type: AGGREGATE_TYPES.LEARNING_EVIDENCE,
    aggregate_id: "a1",
    occurred_at: "2026-03-02T18:00:00+08:00",
    version: 1,
    summary: "错配",
    payload: { studio_id: "s", apprentice_id: "u", date: "2026-03-02", present: true },
  };
  assert.ok(validateEvent(bad).some((m) => m.includes("必须归属聚合")));
  assert.ok(validateEvent({ ...bad, event_type: "NOT_A_REAL_EVENT" }).some((m) => m.includes("未知事件类型")));
});

// —— 联调场景整体通过 ——

test("烧麦故事流通过全部流级不变量", async () => {
  const events = await loadJson("../data/scenarios/shaomai-story.json");
  const result = validateEventLog(events);
  assert.deepEqual(result.errors, [], JSON.stringify(result.errors, null, 2));
});

test("接续责任故事流通过全部流级不变量", async () => {
  const events = await loadJson("../data/scenarios/successor-story.json");
  const result = validateEventLog(events);
  assert.deepEqual(result.errors, [], JSON.stringify(result.errors, null, 2));
});

// —— 最小反例构造器 ——

let seq = 0;
const envelope = (partial) => ({
  event_id: `e${++seq}`,
  occurred_at: "2026-03-01T09:00:00+08:00",
  version: 1,
  summary: "测试事件",
  ...partial,
});

const craftV1 = (id = "craft-1", nodes = [
  { node_id: "node-plain", name: "一般工序" },
  { node_id: "node-crit", name: "关键工序", critical: true, requires_on_site_observation: true },
]) =>
  envelope({
    event_id: `craft-${id}`,
    event_type: EVENT_TYPES.CRAFT_REGISTERED,
    aggregate_type: AGGREGATE_TYPES.CRAFT_REVISION,
    aggregate_id: id,
    payload: { studio_id: "studio-1", craft_name: "测试技艺", craft_nodes: nodes },
  });

const codes = (events) => validateEventLog(events).errors.map((e) => e.code);

test("关键工序判定合格但缺少现场观察 → 拒绝", () => {
  const work = envelope({
    event_type: EVENT_TYPES.EVIDENCE_SUBMITTED,
    aggregate_type: AGGREGATE_TYPES.LEARNING_EVIDENCE,
    aggregate_id: "ev-work",
    payload: {
      studio_id: "studio-1", apprentice_id: "a1", kind: "practice_work",
      craft_revision_id: "craft-1", node_ids: ["node-crit"], title: "作品",
      produced_at: "2026-03-02T09:00:00+08:00",
    },
  });
  const review = envelope({
    event_type: EVENT_TYPES.REVIEW_SIGNED,
    aggregate_type: AGGREGATE_TYPES.COMPETENCY_REVIEW,
    aggregate_id: "rv-1",
    occurred_at: "2026-03-03T09:00:00+08:00",
    payload: {
      studio_id: "studio-1", apprentice_id: "a1", stage: "结业", reviewer_ids: ["m1"],
      judgments: [{ node_id: "node-crit", conclusion: "competent", based_on_evidence_ids: ["ev-work"] }],
    },
  });
  assert.ok(codes([craftV1(), work, review]).includes("CRITICAL_NODE_WITHOUT_ON_SITE_PROOF"));
});

test("现场观察记录没有写明观察者 → 拒绝", () => {
  const obs = envelope({
    event_type: EVENT_TYPES.EVIDENCE_SUBMITTED,
    aggregate_type: AGGREGATE_TYPES.LEARNING_EVIDENCE,
    aggregate_id: "ev-obs",
    payload: {
      studio_id: "studio-1", apprentice_id: "a1", kind: "on_site_observation",
      craft_revision_id: "craft-1", node_ids: ["node-crit"], title: "观察",
      produced_at: "2026-03-02T09:00:00+08:00",
    },
  });
  assert.ok(codes([craftV1(), obs]).includes("OBSERVATION_WITHOUT_OBSERVER"));
});

test("单纯到场不能换算成合格：出勤不得作为评议依据", () => {
  const attendance = envelope({
    event_type: EVENT_TYPES.ATTENDANCE_LOGGED,
    aggregate_type: AGGREGATE_TYPES.ATTENDANCE_RECORD,
    aggregate_id: "att-1",
    payload: { studio_id: "studio-1", apprentice_id: "a1", date: "2026-03-02", present: true },
  });
  const review = envelope({
    event_type: EVENT_TYPES.REVIEW_SIGNED,
    aggregate_type: AGGREGATE_TYPES.COMPETENCY_REVIEW,
    aggregate_id: "rv-1",
    occurred_at: "2026-03-03T09:00:00+08:00",
    payload: {
      studio_id: "studio-1", apprentice_id: "a1", stage: "结业", reviewer_ids: ["m1"],
      judgments: [{ node_id: "node-plain", conclusion: "competent", based_on_evidence_ids: ["att-1"] }],
    },
  });
  const cs = codes([craftV1(), attendance, review]);
  assert.ok(cs.includes("ATTENDANCE_USED_AS_PROOF"));
});

test("复核必须指向原评议，且后继意见时间晚于原判断", () => {
  const review = envelope({
    event_type: EVENT_TYPES.REVIEW_SIGNED,
    aggregate_type: AGGREGATE_TYPES.COMPETENCY_REVIEW,
    aggregate_id: "rv-1",
    occurred_at: "2026-03-03T09:00:00+08:00",
    payload: { studio_id: "studio-1", apprentice_id: "a1", stage: "结业", reviewer_ids: ["m1"], judgments: [] },
  });
  const missingPrior = envelope({
    event_type: EVENT_TYPES.REVIEW_RECONSIDERED,
    aggregate_type: AGGREGATE_TYPES.COMPETENCY_REVIEW,
    aggregate_id: "rv-2",
    occurred_at: "2026-03-04T09:00:00+08:00",
    payload: {
      studio_id: "studio-1", apprentice_id: "a1", prior_review_id: "rv-ghost",
      stage: "复核", reviewer_ids: ["m2"], judgments: [],
    },
  });
  assert.ok(codes([review, missingPrior]).includes("REVIEW_PRIOR_MISSING"));

  const beforePrior = envelope({
    event_type: EVENT_TYPES.REVIEW_RECONSIDERED,
    aggregate_type: AGGREGATE_TYPES.COMPETENCY_REVIEW,
    aggregate_id: "rv-3",
    occurred_at: "2026-03-01T09:00:00+08:00",
    payload: {
      studio_id: "studio-1", apprentice_id: "a1", prior_review_id: "rv-1",
      stage: "复核", reviewer_ids: ["m2"], judgments: [],
    },
  });
  assert.ok(codes([review, beforePrior]).includes("REVIEW_RECONSIDERED_BEFORE_PRIOR"));
});

test("流内版本必须从 1 连续", () => {
  const assigned = envelope({
    event_type: EVENT_TYPES.MENTORSHIP_ASSIGNED,
    aggregate_type: AGGREGATE_TYPES.MENTORSHIP,
    aggregate_id: "m-1",
    payload: { studio_id: "studio-1", master_id: "master-1", apprentice_id: "a1", started_at: "2026-01-01T09:00:00+08:00" },
  });
  const withdrawn = envelope({
    event_type: EVENT_TYPES.MENTOR_WITHDRAWN,
    aggregate_type: AGGREGATE_TYPES.MENTORSHIP,
    aggregate_id: "m-1",
    version: 3,
    occurred_at: "2026-02-01T09:00:00+08:00",
    payload: { studio_id: "studio-1", master_id: "master-1", effective_at: "2026-02-01T09:00:00+08:00" },
  });
  assert.ok(codes([assigned, withdrawn]).includes("VERSION_GAP"));
});

test("修订链不得成环，前驱必须存在", () => {
  const c1 = craftV1("craft-cycle-1");
  const c2 = envelope({
    event_type: EVENT_TYPES.CRAFT_REVISED,
    aggregate_type: AGGREGATE_TYPES.CRAFT_REVISION,
    aggregate_id: "craft-cycle-2",
    occurred_at: "2026-02-01T09:00:00+08:00",
    payload: { studio_id: "studio-1", craft_name: "技艺", supersedes_revision_id: "craft-cycle-1", craft_nodes: [] },
  });
  const c1v2 = envelope({
    event_type: EVENT_TYPES.CRAFT_REVISED,
    aggregate_type: AGGREGATE_TYPES.CRAFT_REVISION,
    aggregate_id: "craft-cycle-1",
    version: 2,
    occurred_at: "2026-03-01T09:00:00+08:00",
    payload: { studio_id: "studio-1", craft_name: "技艺", supersedes_revision_id: "craft-cycle-2", craft_nodes: [] },
  });
  assert.ok(codes([c1, c2, c1v2]).includes("REVISION_CYCLE"));

  const dangling = envelope({
    event_type: EVENT_TYPES.CRAFT_REVISED,
    aggregate_type: AGGREGATE_TYPES.CRAFT_REVISION,
    aggregate_id: "craft-x",
    occurred_at: "2026-02-01T09:00:00+08:00",
    payload: { studio_id: "studio-1", craft_name: "技艺", supersedes_revision_id: "ghost", craft_nodes: [] },
  });
  assert.ok(codes([dangling]).includes("REVISION_PREDECESSOR_MISSING"));
});

test("师傅退出后未完成实践必须有接续责任人", () => {
  const craft = craftV1();
  const assigned = envelope({
    event_type: EVENT_TYPES.MENTORSHIP_ASSIGNED,
    aggregate_type: AGGREGATE_TYPES.MENTORSHIP,
    aggregate_id: "m-1",
    payload: { studio_id: "studio-1", master_id: "master-1", apprentice_id: "a1", started_at: "2026-01-01T09:00:00+08:00" },
  });
  const planned = envelope({
    event_type: EVENT_TYPES.PRACTICE_PLANNED,
    aggregate_type: AGGREGATE_TYPES.PRACTICE_PURSUIT,
    aggregate_id: "p-1",
    occurred_at: "2026-02-01T09:00:00+08:00",
    payload: {
      studio_id: "studio-1", apprentice_id: "a1", craft_revision_id: "craft-1", node_id: "node-crit",
      responsible_person_id: "master-1", source: "mentorship", source_ref: "m-1",
      planned_at: "2026-02-01T09:00:00+08:00",
    },
  });
  const withdrawn = envelope({
    event_type: EVENT_TYPES.MENTOR_WITHDRAWN,
    aggregate_type: AGGREGATE_TYPES.MENTORSHIP,
    aggregate_id: "m-1",
    version: 2,
    occurred_at: "2026-05-01T09:00:00+08:00",
    payload: { studio_id: "studio-1", master_id: "master-1", effective_at: "2026-05-01T09:00:00+08:00" },
  });
  assert.ok(codes([craft, assigned, planned, withdrawn]).includes("PRACTICE_RESPONSIBILITY_ORPHANED"));
});

test("接续责任人不得仍是退出前的责任人", () => {
  const craft = craftV1();
  const assigned = envelope({
    event_type: EVENT_TYPES.MENTORSHIP_ASSIGNED,
    aggregate_type: AGGREGATE_TYPES.MENTORSHIP,
    aggregate_id: "m-1",
    payload: { studio_id: "studio-1", master_id: "master-1", apprentice_id: "a1", started_at: "2026-01-01T09:00:00+08:00" },
  });
  const planned = envelope({
    event_type: EVENT_TYPES.PRACTICE_PLANNED,
    aggregate_type: AGGREGATE_TYPES.PRACTICE_PURSUIT,
    aggregate_id: "p-1",
    occurred_at: "2026-02-01T09:00:00+08:00",
    payload: {
      studio_id: "studio-1", apprentice_id: "a1", craft_revision_id: "craft-1", node_id: "node-crit",
      responsible_person_id: "master-1", source: "mentorship", source_ref: "m-1",
      planned_at: "2026-02-01T09:00:00+08:00",
    },
  });
  const withdrawn = envelope({
    event_id: "trigger-w",
    event_type: EVENT_TYPES.MENTOR_WITHDRAWN,
    aggregate_type: AGGREGATE_TYPES.MENTORSHIP,
    aggregate_id: "m-1",
    version: 2,
    occurred_at: "2026-05-01T09:00:00+08:00",
    payload: { studio_id: "studio-1", master_id: "master-1", effective_at: "2026-05-01T09:00:00+08:00" },
  });
  const continued = envelope({
    event_type: EVENT_TYPES.PRACTICE_CONTINUED,
    aggregate_type: AGGREGATE_TYPES.PRACTICE_PURSUIT,
    aggregate_id: "p-2",
    occurred_at: "2026-05-03T09:00:00+08:00",
    payload: {
      studio_id: "studio-1", apprentice_id: "a1", craft_revision_id: "craft-1", node_id: "node-crit",
      predecessor_practice_id: "p-1", trigger_event_id: "trigger-w",
      new_responsible_person_id: "master-1", // 仍是原责任人
      continued_at: "2026-05-03T09:00:00+08:00",
    },
  });
  assert.ok(codes([craft, assigned, planned, withdrawn, continued]).includes("PRACTICE_SAME_RESPONSIBLE"));
});

test("跨工作室展示只能取得标注必要的材料", () => {
  const grant = envelope({
    event_type: EVENT_TYPES.CONSENT_GRANTED,
    aggregate_type: AGGREGATE_TYPES.CONSENT_GRANT,
    aggregate_id: "c-1",
    payload: {
      subject_id: "a1",
      materials: [{ category: "personal_image", ref: "img-1" }], // 未标注 necessary
      purposes: ["cross_studio_display"],
      scope: "cross_studio",
      granted_at: "2026-03-01T09:00:00+08:00",
    },
  });
  assert.ok(codes([grant]).includes("CROSS_STUDIO_MATERIAL_NOT_NECESSARY"));
});

test("证书未签发不得吊销", () => {
  const revoked = envelope({
    event_type: EVENT_TYPES.CERTIFICATE_REVOKED,
    aggregate_type: AGGREGATE_TYPES.CERTIFICATE,
    aggregate_id: "cert-1",
    payload: { reason: "核查发现材料不实", revoked_at: "2026-03-01T09:00:00+08:00" },
  });
  assert.ok(codes([revoked]).includes("CERTIFICATE_REVOKED_WITHOUT_ISSUE"));
});
