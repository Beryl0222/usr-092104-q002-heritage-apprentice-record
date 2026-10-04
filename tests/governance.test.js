import assert from "node:assert/strict";
import test from "node:test";

import { buildState } from "../src/projections.js";
import {
  auditContinuity,
  certificateTimeline,
  certificateValidAt,
  governanceReport,
  reviewChainIntact,
  reviewLineage,
} from "../src/governance.js";
import { loadScenario } from "./helpers.js";

const { events } = await loadScenario();

test("复核：后继意见追加但不抹去原判断，意见链完整可重放", () => {
  const state = buildState(events);
  const lineage = reviewLineage(state, "rvw-aruna-24p-2");
  assert.deepEqual(
    lineage.map((r) => r.review_id),
    ["rvw-aruna-24p-1", "rvw-aruna-24p-2"]
  );
  assert.equal(lineage[0].decision, "conditional");
  assert.equal(lineage[1].decision, "pass");

  // 5月18日（初判后、复核前）重放，结论仍是 conditional
  const stateAtMay = buildState(events, { asOf: "2026-05-21T00:00:00+08:00" });
  assert.ok(stateAtMay.reviews.has("rvw-aruna-24p-1"));
  assert.ok(!stateAtMay.reviews.has("rvw-aruna-24p-2"));

  // 所有意见链引用完整
  assert.deepEqual(reviewChainIntact(state), []);
});

test("悬空的 replaces_review_id 会被发现", () => {
  const broken = [
    ...events,
    {
      event_id: "ev-broken-review",
      event_type: "REVIEW_SIGNED",
      event_type_display: "能力评议签署",
      aggregate_type: "competency_review",
      aggregate_id: "rvw-broken",
      occurred_at: "2026-09-01T10:00:00+08:00",
      version: 1,
      summary: "指向不存在的原评议",
      body: {
        learner_id: "lrnr-aruna",
        studio_id: "studio-huimin",
        skill_code: "shaomai-wrapper-24pleats",
        decision: "pass",
        replaces_review_id: "rvw-nonexistent",
      },
    },
  ];
  const state = buildState(broken);
  const violations = reviewChainIntact(state);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /原评议不存在/);
});

test("证书：师傅退出与门店撤店后，已发证书继续有效", () => {
  const state = buildState(events);
  // 陈师傅 7/20 退出；辰曦的证书 7/5 由陈师傅签发
  assert.equal(
    certificateValidAt(state, "cert-chenxi-001", "2026-08-15T00:00:00+08:00"),
    true
  );
  const timeline = certificateTimeline(state, "cert-chenxi-001");
  assert.equal(timeline.status, "issued");
  assert.equal(timeline.issued_by_master_id, "mstr-chen");
});

test("证书：撤销为终态；过期证书无效；换发有链", () => {
  const revoked = [
    ...events,
    {
      event_id: "ev-cert-revoke",
      event_type: "CERTIFICATE_REVOKED",
      event_type_display: "证书撤销",
      aggregate_type: "certificate_grant",
      aggregate_id: "cert-aruna-001",
      occurred_at: "2026-09-01T10:00:00+08:00",
      version: 2,
      summary: "因材料不实撤销（示例）",
      body: { revoke_reason: "申报材料不实（示例事件）" },
    },
  ];
  const state = buildState(revoked);
  assert.equal(state.certificates.get("cert-aruna-001").status, "revoked");
  assert.equal(
    certificateValidAt(state, "cert-aruna-001", "2026-09-02T00:00:00+08:00"),
    false
  );

  const expired = buildState([
    ...events,
    {
      event_id: "ev-cert-expire-check",
      event_type: "CERTIFICATE_ISSUED",
      event_type_display: "证书签发",
      aggregate_type: "certificate_grant",
      aggregate_id: "cert-short",
      occurred_at: "2026-01-01T00:00:00+08:00",
      version: 1,
      summary: "短期证书",
      body: {
        learner_id: "lrnr-batu",
        studio_id: "studio-huimin",
        skill_codes: ["shaomai-filling-sealing"],
        valid_from: "2026-01-01T00:00:00+08:00",
        valid_until: "2026-02-01T00:00:00+08:00",
      },
    },
  ]);
  assert.equal(
    certificateValidAt(expired, "cert-short", "2026-03-01T00:00:00+08:00"),
    false
  );
});

test("接续：师傅退出与岗位取消时，未完成实践均在当日改派，审计无孤儿", () => {
  const audit = auditContinuity(events);
  assert.equal(audit.intact, true);
  assert.deepEqual(audit.orphan_commitments, []);
  assert.deepEqual(audit.violations, []);

  const state = buildState(events);
  // 辰曦的承诺：陈 → 周，最终履行
  const chenxi = state.commitments.get("com-chenxi-01");
  assert.equal(chenxi.responsible_party_id, "mstr-zhou");
  assert.equal(chenxi.status, "fulfilled");
  assert.equal(chenxi.reassignments[0].from, "mstr-chen");

  // 阿茹娜的承诺：老门店 → 蒙古路店（岗位取消后仍 open，由新门店承接）
  const aruna = state.commitments.get("com-aruna-01");
  assert.equal(aruna.responsible_party_id, "plc-menggu-store");
  assert.equal(aruna.status, "open");
});

test("接续：师傅退出但未改派、实践也未履行，被判为孤儿", () => {
  // 删除陈→周的改派事件与后续履行事件，模拟“退出后无人接续”
  const missing = events.filter((e) => e.event_id !== "ev-036" && e.event_id !== "ev-040");
  const audit = auditContinuity(missing);
  assert.equal(audit.intact, false);
  assert.ok(
    audit.orphan_commitments.some((o) => o.commitment_id === "com-chenxi-01")
  );
});

test("接续：不得把承诺指派给已退出的责任人", () => {
  const bad = [
    ...events,
    {
      event_id: "ev-bad-assign",
      event_type: "PRACTICE_ASSIGNED",
      event_type_display: "实践带教承诺确立",
      aggregate_type: "practice_commitment",
      aggregate_id: "com-bad-01",
      occurred_at: "2026-08-20T09:00:00+08:00",
      version: 1,
      summary: "指派给已退休的陈师傅（应被拒绝）",
      body: {
        learner_id: "lrnr-batu",
        studio_id: "studio-huimin",
        skill_codes: ["shaomai-wrapper-24pleats"],
        responsible_party_id: "mstr-chen",
        responsible_party_type: "master",
      },
    },
  ];
  const audit = auditContinuity(bad);
  assert.ok(audit.violations.some((v) => v.includes("已退出")));
});

test("治理总报告可一次给出接续与意见链检查", () => {
  const report = governanceReport(events);
  assert.equal(report.continuity.intact, true);
  assert.deepEqual(report.review_chain_violations, []);
});
