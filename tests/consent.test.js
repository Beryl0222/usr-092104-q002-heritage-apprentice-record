import assert from "node:assert/strict";
import test from "node:test";

import { buildState } from "../src/projections.js";
import {
  activeConsents,
  crossStudioShowcasePackage,
  employmentVerificationPackage,
} from "../src/consent.js";
import { loadScenario } from "./helpers.js";

const { events } = await loadScenario();
const state = buildState(events);
const SKILLS = ["shaomai-wrapper-24pleats", "shaomai-filling-sealing"];

test("企业核验包：只含授权范围内材料，未公开配方因获授权可随包，个人影像被脱敏", () => {
  const pkg = employmentVerificationPackage(state, {
    learner_id: "lrnr-aruna",
    required_skills: SKILLS,
    asOf: "2026-08-15T00:00:00+08:00",
  });
  assert.equal(pkg.package_type, "employment_verification");
  assert.deepEqual(pkg.ready_skills.sort(), [...SKILLS].sort());

  const wrapper = pkg.skills.find((s) => s.skill_code === "shaomai-wrapper-24pleats");

  // 口授诀窍证据：获授权且 sensitive 含 unpublished_recipe → included
  const secret = wrapper.observations.find((o) => o.evidence_id === "evd-aruna-secret-01");
  assert.equal(secret.status, "included");

  // 5/18 现场视频：在 material_scope 内，但个人影像未被该授权显式放行 → 脱敏
  const obs0518 = wrapper.observations.find((o) => o.evidence_id === "evd-aruna-obs-0518");
  assert.equal(obs0518.status, "redacted_sensitive");
  assert.equal(obs0518.redacted_tag, "personal_image");

  // 阶段考核证据（evd-aruna-obs-0618）获授权且无敏感标签 → included
  const stage = wrapper.observations.find((o) => o.evidence_id === "evd-aruna-obs-0618");
  assert.equal(stage.status, "included");

  // 包内不出现出勤记录
  const all = [...wrapper.observations, ...wrapper.practice_artifacts];
  assert.ok(all.every((e) => e.evidence_kind !== "attendance_record"));
});

test("企业核验包：未授权材料被剔除并标注原因", () => {
  const pkg = employmentVerificationPackage(state, {
    learner_id: "lrnr-aruna",
    required_skills: SKILLS,
    asOf: "2026-08-15T00:00:00+08:00",
  });
  const wrapper = pkg.skills.find((s) => s.skill_code === "shaomai-wrapper-24pleats");
  // evd-aruna-inno-* 未列入 employment 授权的 material_scope
  const inno = wrapper.practice_artifacts.find((e) =>
    String(e.evidence_id).startsWith("evd-aruna-inno")
  );
  assert.equal(inno.status, "omitted_no_authorization");
});

test("跨工作室展示包：只含被采纳创意与已授权必要材料，未采纳草案与口授诀窍被排除", () => {
  const pkg = crossStudioShowcasePackage(state, {
    learner_id: "lrnr-aruna",
    skills: SKILLS,
    asOf: "2026-08-15T00:00:00+08:00",
  });
  const ids = pkg.materials.map((m) => m.evidence_id);

  assert.ok(ids.includes("evd-aruna-inno-02"), "被采纳创意可跨工作室展示");
  assert.ok(ids.includes("evd-aruna-art-01"), "授权范围内的课程作品可展示");
  assert.ok(!ids.includes("evd-aruna-inno-01"), "未被采用的创意不外流");
  assert.ok(!ids.includes("evd-aruna-secret-01"), "口授诀窍/未公开配方不跨工作室");
  assert.ok(!ids.includes("evd-aruna-obs-0518"), "个人影像不进入展示包");

  const reasons = Object.fromEntries(pkg.excluded.map((e) => [e.evidence_id, e.reason]));
  assert.equal(reasons["evd-aruna-inno-01"], "unadopted_innovation");
  assert.equal(reasons["evd-aruna-secret-01"], "unpublished_recipe");
});

test("授权撤回后材料不再随包提供", () => {
  const withdrawn = [
    ...events,
    {
      event_id: "ev-consent-withdraw",
      event_type: "CONSENT_WITHDRAWN",
      event_type_display: "授权撤回",
      aggregate_type: "consent_grant",
      aggregate_id: "cst-aruna-show-01",
      occurred_at: "2026-08-20T00:00:00+08:00",
      version: 2,
      summary: "阿茹娜撤回跨工作室展示授权",
      body: {},
    },
  ];
  const s = buildState(withdrawn);
  assert.equal(
    activeConsents(s, "lrnr-aruna", "cross_studio_showcase", "2026-08-21T00:00:00+08:00")
      .length,
    0
  );
  const pkg = crossStudioShowcasePackage(s, {
    learner_id: "lrnr-aruna",
    skills: SKILLS,
    asOf: "2026-08-21T00:00:00+08:00",
  });
  assert.deepEqual(pkg.materials, []);
  assert.ok(pkg.excluded.length > 0);
  // 无任何材料随包；具体原因可能是未授权，也可能是配方/未采纳创意等策略性硬排除
  const validReasons = new Set([
    "not_authorized_for_purpose",
    "unpublished_recipe",
    "personal_image",
    "unadopted_innovation",
  ]);
  assert.ok(pkg.excluded.every((e) => validReasons.has(e.reason)));
});

test("授权到期后等同无授权", () => {
  assert.equal(
    activeConsents(state, "lrnr-aruna", "employment_verification", "2028-01-01T00:00:00+08:00")
      .length,
    0
  );
});
