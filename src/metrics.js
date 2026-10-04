import { decideVerdict } from "./traceability.js";
import { auditContinuity } from "./governance.js";
import { buildState } from "./projections.js";

// 文化主管部门视图：以工作室为最小粒度的培养与就业衔接情况。
// 刻意不提供：出勤次数、个人时长、个人排名 —— 师承质量不压成打卡榜单。
export function culturalAuthorityReport(events, { asOf } = {}) {
  const cutoff = asOf ? Date.parse(asOf) : Infinity;
  const inWindow = (e) => Date.parse(e.occurred_at) <= cutoff;
  const state = buildState(events, { asOf });

  const studios = new Map();
  const ensure = (studioId) => {
    if (!studios.has(studioId))
      studios.set(studioId, {
        studio_id: studioId,
        studio_name: state.studios.get(studioId)?.studio_name ?? studioId,
        apprentice_count: 0,
        skill_pass_count: 0,
        certificate_valid_count: 0,
        employed_learner_count: 0,
        employment_matched_count: 0,
        employment_match_rate: null,
        open_commitment_count: 0,
        orphan_commitment_count: 0,
        revision_count: 0,
        reassigned_party_count: 0,
      });
    return studios.get(studioId);
  };

  // 合格（学员×技能）对，按评议签署时的 studio_id 归属
  const passedPairs = new Map(); // studio -> Set(learner/skill)
  const passedLearners = new Map(); // studio -> Set(learner)
  for (const review of state.reviews.values()) {
    if (review.decision !== "pass" || !review.studio_id) continue;
    ensure(review.studio_id);
    const pairKey = `${review.learner_id}/${review.skill_code}`;
    const pairs = passedPairs.get(review.studio_id) ?? new Set();
    pairs.add(pairKey);
    passedPairs.set(review.studio_id, pairs);
    const learners = passedLearners.get(review.studio_id) ?? new Set();
    learners.add(review.learner_id);
    passedLearners.set(review.studio_id, learners);
  }

  // 证书：当前有效且未过期
  const t = asOf ? Date.parse(asOf) : Date.now();
  for (const cert of state.certificates.values()) {
    if (cert.status !== "issued" || cert.replaced_by) continue;
    if (cert.valid_until && Date.parse(cert.valid_until) < t) continue;
    if (!cert.studio_id) continue;
    ensure(cert.studio_id).certificate_valid_count += 1;
  }

  // 就业衔接：岗位所需技能是否都具备合格证据链
  for (const placement of state.placements.values()) {
    if (placement.status !== "active" || !placement.studio_id || !placement.learner_id) continue;
    const row = ensure(placement.studio_id);
    row.employed_learner_count += 1;
    const matched = placement.required_skills.every(
      (skill) => decideVerdict(state, placement.learner_id, skill).status === "ready"
    );
    if (matched) row.employment_matched_count += 1;
  }

  // 实践承诺与接续
  for (const c of state.commitments.values()) {
    if (!c.studio_id) continue;
    const row = ensure(c.studio_id);
    if (c.status === "open") row.open_commitment_count += 1;
  }
  const continuity = auditContinuity(events.filter(inWindow));
  for (const orphan of continuity.orphan_commitments) {
    if (!orphan.studio_id) continue;
    ensure(orphan.studio_id).orphan_commitment_count += 1;
  }

  // 修订与改派计数（按事件流，归属事件负载中的 studio_id）
  for (const event of events) {
    if (!inWindow(event)) continue;
    const studioId = event.body?.studio_id;
    if (!studioId) continue;
    if (event.event_type === "CRAFT_REGISTERED" || event.event_type === "COURSE_REVISED")
      ensure(studioId).revision_count += 1;
    if (event.event_type === "RESPONSIBILITY_REASSIGNED")
      ensure(studioId).reassigned_party_count += 1;
  }

  for (const [studioId, row] of studios) {
    row.apprentice_count = (passedLearners.get(studioId) ?? new Set()).size;
    row.skill_pass_count = (passedPairs.get(studioId) ?? new Set()).size;
    row.employment_match_rate =
      row.employed_learner_count === 0
        ? null
        : Number((row.employment_matched_count / row.employed_learner_count).toFixed(4));
  }

  return {
    report_type: "cultural_authority_report",
    generated_at: asOf ?? new Date().toISOString(),
    granularity: "studio",
    note: "仅含工作室级培养就业衔接口径；不含任何个人出勤/打卡数据。",
    continuity_intact: continuity.intact,
    continuity_violations: continuity.violations,
    studios: [...studios.values()].sort((a, b) => a.studio_id.localeCompare(b.studio_id)),
  };
}

// 明确拒绝生成个人出勤排行，防止调用方误用。
export function attendanceRanking() {
  throw new Error("师承质量不以出勤打卡排名衡量：该视图不予提供");
}
