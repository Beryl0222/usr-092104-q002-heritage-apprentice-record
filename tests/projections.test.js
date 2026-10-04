import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  apprenticePortfolio,
  roleGapAnalysis,
  roleRequirementTrace,
  studioCultivationSummary,
} from "../src/projections.js";
import { authorizeMaterialAccess } from "../src/validator.js";
import { CONSENT_PURPOSES, CONSENT_SCOPES } from "../src/event-catalog.js";

const here = (p) => new URL(p, import.meta.url);
const loadJson = (p) => readFile(here(p), "utf8").then(JSON.parse);

let story;
let successor;
let all;

test.before(async () => {
  story = await loadJson("../data/scenarios/shaomai-story.json");
  successor = await loadJson("../data/scenarios/successor-story.json");
  all = [...story, ...successor];
});

test("岗位反查列出现行修订的工序要求并标记关键工序", () => {
  const trace = roleRequirementTrace(all, "role-shaomai-chef");
  assert.equal(trace.role_name, "烧麦师傅");
  const wrapper = trace.requirements.find((r) => r.node_id === "node-wrapper-24");
  assert.equal(wrapper.craft_revision_id, "craft-shaomai-v2");
  assert.equal(wrapper.critical, true);
  assert.equal(wrapper.requires_on_site_observation, true);
});

test("企业从岗位反查：林晓达到独立操作，证据链可回溯且不含出勤与未采用创意", () => {
  const gap = roleGapAnalysis(all, "apprentice-lin", "role-shaomai-chef");
  assert.equal(gap.ready_for_independent_work, true);
  for (const item of gap.items) {
    assert.equal(item.satisfied, true, item.node_id);
    const kinds = item.supporting_evidence.map((e) => e.kind);
    assert.ok(!kinds.includes("attendance"), "出勤不得作为支撑证据");
    assert.ok(!kinds.includes("innovation"), "未采用创意不得作为岗位支撑");
    assert.ok(item.latest_judgment, "每项工序都应能回到阶段评议");
  }
  const wrapper = gap.items.find((i) => i.node_id === "node-wrapper-24");
  assert.ok(wrapper.supporting_evidence.some((e) => e.kind === "on_site_observation" && e.observer_ids.includes("master-chen")));
  assert.equal(wrapper.certificate_backed, true);
});

test("门店岗位取消后：岗位标记取消，但赵远已获能力仍可被反查为有效", () => {
  const gap = roleGapAnalysis(all, "apprentice-zhao", "role-chengnan-helper");
  assert.equal(gap.role_cancelled, true);
  assert.equal(gap.ready_for_independent_work, true);
  const cert = apprenticePortfolio(all, "apprentice-zhao").certificates[0];
  assert.equal(cert.valid, true);
});

test("缺证据的学员反查返回稳定缺口 code，而不是简单不及格", () => {
  // 在完整领域事件中查询一个没有任何证据与评议的学员
  const gap = roleGapAnalysis(all, "apprentice-nobody", "role-shaomai-chef");
  assert.equal(gap.ready_for_independent_work, false);
  const wrapper = gap.items.find((i) => i.node_id === "node-wrapper-24");
  const codes = wrapper.blockers.map((b) => b.code);
  assert.ok(codes.includes("NO_REVIEW"));
  assert.ok(codes.includes("CRITICAL_OBSERVATION_MISSING"));
});

test("复核形成后继意见：展示取最新结论，原评议仍可经 prior_review_id 追溯", () => {
  const portfolio = apprenticePortfolio(all, "apprentice-lin");
  const wrapper = portfolio.nodes["node-wrapper-24"];
  assert.equal(wrapper.latest_judgment.via, "后继复核意见");
  assert.equal(wrapper.latest_judgment.prior_review_id, "review-lin-stage2");
});

test("授权核验：按用途、范围、时限与必要性判定", () => {
  const img = { category: "personal_image", ref: "evidence-lin-practice-work#photo" };
  const ok = authorizeMaterialAccess(all, {
    subject_id: "apprentice-lin", material: img,
    purpose: CONSENT_PURPOSES.CROSS_STUDIO_DISPLAY, scope: CONSENT_SCOPES.CROSS_STUDIO,
    at: "2026-09-01T09:00:00+08:00",
  });
  assert.equal(ok.allowed, true);

  const expired = authorizeMaterialAccess(all, {
    subject_id: "apprentice-lin", material: img,
    purpose: CONSENT_PURPOSES.CROSS_STUDIO_DISPLAY, scope: CONSENT_SCOPES.CROSS_STUDIO,
    at: "2027-09-01T09:00:00+08:00",
  });
  assert.equal(expired.allowed, false);

  const innovation = { category: "unused_innovation", ref: "evidence-lin-innovation#draft" };
  const denied = authorizeMaterialAccess(all, {
    subject_id: "apprentice-lin", material: innovation,
    purpose: CONSENT_PURPOSES.CROSS_STUDIO_DISPLAY, scope: CONSENT_SCOPES.CROSS_STUDIO,
    at: "2026-09-01T09:00:00+08:00",
  });
  assert.equal(denied.allowed, false);
});

test("主管部门视图只给工作室级聚合，不提供个人打卡口径", () => {
  const summary = studioCultivationSummary(all, "studio-chenji");
  assert.ok(summary.apprentices_observed >= 2);
  assert.equal(summary.practices_awaiting_successor, 0);
  assert.ok(!("apprentice_ranking" in summary));
  assert.ok(!("attendance_by_apprentice" in summary));
  assert.ok(summary.attendance_days_total >= 2);
  assert.deepEqual(Object.keys(summary.judgment_counts).sort(), ["competent", "developing", "not_yet"]);
  for (const note of summary.governance) assert.equal(typeof note, "string");
});

test("只读模型样例可由当前事件重新生成且内容一致", async () => {
  // 防止 data/read-models 与事件漂移：再算一次投影并与已生成样例比对
  const gapFile = await loadJson("../data/read-models/apprentice-lin-gap.json");
  const fresh = roleGapAnalysis(all, "apprentice-lin", "role-shaomai-chef");
  assert.equal(gapFile.ready_for_independent_work, fresh.ready_for_independent_work);
  assert.equal(gapFile.items.length, fresh.items.length);
  for (let i = 0; i < fresh.items.length; i++) {
    assert.equal(gapFile.items[i].satisfied, fresh.items[i].satisfied);
    assert.equal(gapFile.items[i].supporting_evidence.length, fresh.items[i].supporting_evidence.length);
  }
});
