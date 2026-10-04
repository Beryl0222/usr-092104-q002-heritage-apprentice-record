// 端到端联调演示：node examples/demo.mjs
import { readFile } from "node:fs/promises";

import {
  EventStore,
  auditContinuity,
  buildState,
  crossStudioShowcasePackage,
  culturalAuthorityReport,
  employmentVerificationPackage,
  learnerGapAnalysis,
  reverseLookupByJob,
  reviewLineage,
  skillTrace,
} from "../src/index.js";

const scenario = JSON.parse(
  await readFile(new URL("../data/scenario/shaomai.json", import.meta.url), "utf8")
);

const store = new EventStore();
store.append(scenario.events);
const state = buildState(store.replay());

const line = (s) => console.log(`\n${"─".repeat(8)}\n${s}`);

line("① 企业按岗位反查：阿茹娜 × 岗位所需两项能力");
const job = reverseLookupByJob(state, {
  learner_id: "lrnr-aruna",
  required_skills: ["shaomai-wrapper-24pleats", "shaomai-filling-sealing"],
});
for (const t of job) {
  console.log(
    `${t.skill_code}：${t.verdict.status}（${t.verdict.reason}）；现场目击者=${t.observers
      .map((o) => o.observer_id)
      .join(",") || "无"}`
  );
}

line("② 关键工序是谁现场看过（二十四道褶）");
const trace = skillTrace(state, "lrnr-aruna", "shaomai-wrapper-24pleats");
for (const o of trace.observers) {
  console.log(
    `${o.observer_name ?? o.observer_id}（${o.role}）看过 ${o.seen_via.length} 次：` +
      o.seen_via.map((v) => `${v.at} 依据${v.craft_revision_id}`).join("；")
  );
}

line("③ 学员差距：巴图距离独立操作还缺什么");
for (const g of learnerGapAnalysis(state, "lrnr-batu", [
  "shaomai-wrapper-24pleats",
  "shaomai-filling-sealing",
])) {
  console.log(`${g.skill_code}：${g.status} —— 缺口：${g.gaps.join("、") || "无"}`);
}

line("④ 复核意见链（原判断不抹除）");
for (const r of reviewLineage(state, "rvw-aruna-24p-2")) {
  console.log(`${r.signed_at} ${r.decision}（${r.review_id}）${r.note ? "：" + r.note : ""}`);
}

line("⑤ 接续审计");
const audit = auditContinuity(store.replay());
console.log(
  `intact=${audit.intact}；孤儿实践=${audit.orphan_commitments.length}；违规=${audit.violations.length}`
);

line("⑥ 企业核验包（按用途裁剪，个人影像脱敏）");
const emp = employmentVerificationPackage(state, {
  learner_id: "lrnr-aruna",
  required_skills: ["shaomai-wrapper-24pleats", "shaomai-filling-sealing"],
  asOf: "2026-08-15T00:00:00+08:00",
});
console.log(JSON.stringify(emp.skills[0].observations, null, 2));

line("⑦ 跨工作室展示包（仅必要材料）");
const show = crossStudioShowcasePackage(state, {
  learner_id: "lrnr-aruna",
  skills: ["shaomai-wrapper-24pleats", "shaomai-filling-sealing"],
  asOf: "2026-08-15T00:00:00+08:00",
});
console.log("随包材料：", show.materials.map((m) => m.evidence_id));
console.log("排除：", show.excluded.map((e) => `${e.evidence_id}(${e.reason})`));

line("⑧ 文化主管部门视图（工作室级，无个人打卡）");
console.table(culturalAuthorityReport(scenario.events).studios);
