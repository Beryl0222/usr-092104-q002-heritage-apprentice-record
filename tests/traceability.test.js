import assert from "node:assert/strict";
import test from "node:test";

import { buildState } from "../src/projections.js";
import {
  decideVerdict,
  learnerGapAnalysis,
  reverseLookupByJob,
  skillTrace,
} from "../src/traceability.js";
import { loadScenario } from "./helpers.js";

const { events } = await loadScenario();
const state = buildState(events);

const SKILL_24P = "shaomai-wrapper-24pleats";
const SKILL_SEAL = "shaomai-filling-sealing";

test("反查：烧麦皮二十四道褶——能查到谁现场看过、看的是哪个技艺版本", () => {
  const trace = skillTrace(state, "lrnr-aruna", SKILL_24P);

  // 现场目击者链：陈师傅看过两次（5/18、4/20口授），阶段考核周师傅也在场
  const observerIds = trace.observers.map((o) => o.observer_id).sort();
  assert.deepEqual(observerIds, ["mstr-chen", "mstr-zhou"]);

  const chen = trace.observers.find((o) => o.observer_id === "mstr-chen");
  assert.ok(chen.seen_via.length >= 2);
  assert.ok(
    chen.seen_via.some((v) => v.craft_revision_id === "craft-shaomai-wrapper@3")
  );

  // 锚定的技艺版本可追溯（第2版与第3版）
  const revisionIds = trace.crafts.map((c) => c.craft_revision_id);
  assert.ok(revisionIds.includes("craft-shaomai-wrapper@3"));
});

test("反查：来源分类可区分口授诀窍、学校课程、学员创意", () => {
  const trace = skillTrace(state, "lrnr-aruna", SKILL_24P);
  assert.ok(trace.source_breakdown.master_oral_secret.includes("evd-aruna-secret-01"));
  assert.ok(trace.source_breakdown.school_course.includes("evd-aruna-art-01"));
  assert.ok(trace.source_breakdown.learner_innovation.length >= 2);

  const adopted = trace.innovations.filter((i) => i.status === "adopted");
  const proposed = trace.innovations.filter((i) => i.status === "proposed");
  assert.equal(adopted[0].adopted_in_craft_revision_id, "craft-shaomai-wrapper@3");
  assert.ok(proposed.length >= 1, "被否决/未采纳的草案仍在个人履历中留档");
});

test("出勤不换算合格：巴图只有出勤记录，判定为 not_ready", () => {
  const verdict = decideVerdict(state, "lrnr-batu", SKILL_24P);
  assert.equal(verdict.status, "not_ready");
  assert.match(verdict.reason, /出勤/);

  const trace = skillTrace(state, "lrnr-batu", SKILL_24P);
  assert.equal(trace.observations.length, 0);
  assert.equal(trace.attendance_only_timeline.length, 1);
  // 出勤记录不进入合格依据
  assert.equal(trace.accepted_basis.length, 0);
});

test("企业反查岗位能力：阿茹娜两项关键能力均 ready，巴图有缺口", () => {
  const required = [SKILL_24P, SKILL_SEAL];
  const aruna = reverseLookupByJob(state, {
    learner_id: "lrnr-aruna",
    required_skills: required,
  });
  assert.deepEqual(
    aruna.map((t) => t.verdict.status),
    ["ready", "ready"]
  );

  const batu = reverseLookupByJob(state, {
    learner_id: "lrnr-batu",
    required_skills: required,
  });
  assert.notDeepEqual(
    batu.map((t) => t.verdict.status),
    ["ready", "ready"]
  );
});

test("学员差距清单：巴图缺现场目击、练习作品与合格评议；出勤不计入证据数", () => {
  const [gap24p] = learnerGapAnalysis(state, "lrnr-batu", [SKILL_24P]);
  assert.equal(gap24p.ready_for_independent_operation, false);
  assert.ok(gap24p.gaps.some((g) => g.includes("现场目击")));
  assert.ok(gap24p.gaps.some((g) => g.includes("练习作品")));
  assert.ok(gap24p.gaps.some((g) => g.includes("pass")));
  assert.equal(gap24p.current_evidence.attendance_records, 1);
  assert.equal(gap24p.current_evidence.on_site_observations, 0);
});

test("阿茹娜差距清单为空：可独立操作两项关键能力", () => {
  const gaps = learnerGapAnalysis(state, "lrnr-aruna", [SKILL_24P, SKILL_SEAL]);
  assert.ok(gaps.every((g) => g.ready_for_independent_operation));
});

test("辰曦收口能力的合格依据可追到具体现场观察", () => {
  const trace = skillTrace(state, "lrnr-chenxi", SKILL_SEAL);
  assert.equal(trace.verdict.status, "ready");
  assert.deepEqual(trace.review.decision, "pass");
  assert.deepEqual(trace.accepted_basis.map((e) => e.evidence_id), [
    "evd-chenxi-obs-01",
  ]);
});
