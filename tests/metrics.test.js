import assert from "node:assert/strict";
import test from "node:test";

import { attendanceRanking, culturalAuthorityReport } from "../src/metrics.js";
import { loadScenario } from "./helpers.js";

const { events } = await loadScenario();

test("主管视图：以工作室为最小粒度汇总培养与就业衔接", () => {
  const report = culturalAuthorityReport(events, {
    asOf: "2026-08-15T00:00:00+08:00",
  });
  assert.equal(report.granularity, "studio");
  assert.equal(report.studios.length, 1);

  const row = report.studios[0];
  assert.equal(row.studio_id, "studio-huimin");

  // 有合格评议的学员：阿茹娜、辰曦
  assert.equal(row.apprentice_count, 2);

  // 合格（学员×技能）对：阿茹娜×24褶、阿茹娜×收口、辰曦×收口 = 3
  assert.equal(row.skill_pass_count, 3);

  // 当前有效证书：cert-aruna-001、cert-chenxi-001
  assert.equal(row.certificate_valid_count, 2);

  // 就业匹配：阿茹娜两技能齐备=匹配；巴图不匹配 → 2 人在岗，匹配率 0.5
  assert.equal(row.employed_learner_count, 2);
  assert.equal(row.employment_match_rate, 0.5);

  // 待接续实践：阿茹娜的顶岗实践仍 open（由蒙古路店承接）
  assert.ok(row.open_commitment_count >= 1);
  assert.equal(row.orphan_commitment_count, 0);

  // 修订计数：4 个技艺版本登记 + 2 个课程批次事件 = 6
  assert.equal(row.revision_count, 6);
  // 两次接续改派（陈→周、老门店→蒙古路店）
  assert.equal(row.reassigned_party_count, 2);

  assert.equal(report.continuity_intact, true);
});

test("主管视图：不产出任何个人出勤/打卡数据，且显式拒绝排名接口", () => {
  const report = culturalAuthorityReport(events);
  const json = JSON.stringify(report);
  for (const banned of ["att-2026", "attendance_id_ref", "attendance_record", "lrnr-batu"]) {
    assert.ok(!json.includes(banned), `主管视图不得泄露字段：${banned}`);
  }
  assert.throws(() => attendanceRanking(), /打卡/);
});

test("主管视图：存在孤儿实践时工作室行会被标出，督促接续", () => {
  const missing = events.filter((e) => e.event_id !== "ev-039");
  const report = culturalAuthorityReport(missing, {
    asOf: "2026-09-01T00:00:00+08:00",
  });
  const row = report.studios[0];
  assert.equal(row.orphan_commitment_count, 1);
  assert.equal(report.continuity_intact, false);
});
