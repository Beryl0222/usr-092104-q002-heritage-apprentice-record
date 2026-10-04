import { NON_QUALIFYING_KINDS, OBSERVATION_KINDS } from "./constants.js";
import {
  evidenceForSkill,
  latestReview,
  observationEvidence,
  reviewHistory,
  skillsCoveredByCertificate,
  validCertificatesFor,
} from "./projections.js";

// 单项能力的完整反查链：岗位能力 → 作品/观察/口授/课程/创意 → 评议 → 证书。
// 出勤记录单独成列，绝不混入合格依据。
export function skillTrace(state, learnerId, skillCode) {
  const all = evidenceForSkill(state, learnerId, skillCode);
  const review = latestReview(state, learnerId, skillCode);
  const reviewChain = reviewHistory(state, learnerId, skillCode);
  const certificates = validCertificatesFor(state, learnerId).filter((c) =>
    c.skill_codes.includes(skillCode)
  );

  const observations = all.filter((e) => OBSERVATION_KINDS.has(e.evidence_kind));
  const artifacts = all.filter((e) => e.evidence_kind === "practice_artifact");
  const certSnapshots = all.filter((e) => e.evidence_kind === "certificate_snapshot");
  const attendance = all.filter((e) => NON_QUALIFYING_KINDS.has(e.evidence_kind));

  // 合格评议引用的作品/观察才算“被采信的依据”
  const basisIds = new Set(review?.basis_evidence_ids ?? []);
  const acceptedBasis = all
    .filter((e) => basisIds.has(e.evidence_id))
    .filter((e) => !NON_QUALIFYING_KINDS.has(e.evidence_kind));

  const sourceBreakdown = all.reduce((acc, e) => {
    const key = e.source_classification ?? "unspecified";
    (acc[key] ??= []).push(e.evidence_id);
    return acc;
  }, {});

  const innovations = all
    .filter((e) => e.source_classification === "learner_innovation" && e.innovation)
    .map((e) => ({
      evidence_id: e.evidence_id,
      status: e.innovation.status,
      adopted_in_craft_revision_id: e.innovation.adopted_in_craft_revision_id ?? null,
      note: e.innovation.note ?? "",
    }));

  const observers = new Map();
  for (const e of observations) {
    for (const observerId of e.observer_ids) {
      const known = observers.get(observerId) ?? {
        observer_id: observerId,
        observer_name: state.masters.get(observerId)?.master_name ?? null,
        role: null,
        seen_via: [],
      };
      known.role = known.role ?? e.witness_role;
      known.seen_via.push({
        evidence_id: e.evidence_id,
        at: e.submitted_at,
        quantified_result: e.quantified_result ?? null,
        craft_revision_id: e.craft_revision_id,
      });
      observers.set(observerId, known);
    }
  }

  const craftRevisionIds = [
    ...new Set(
      [...all, review].filter(Boolean).map((x) => x.craft_revision_id).filter(Boolean)
    ),
  ];
  const crafts = craftRevisionIds.map((id) => state.craftRevisions.get(id)).filter(Boolean);

  return {
    learner_id: learnerId,
    skill_code: skillCode,
    crafts,
    verdict: decideVerdict(state, learnerId, skillCode),
    review: latestView(review),
    review_chain_length: reviewChain.length,
    review_history: reviewChain.map(latestView),
    observers: [...observers.values()],
    observations: observations.map(shortEvidence),
    practice_artifacts: artifacts.map(shortEvidence),
    certificate_snapshots: certSnapshots.map(shortEvidence),
    accepted_basis: acceptedBasis.map(shortEvidence),
    certificates,
    source_breakdown: sourceBreakdown,
    innovations,
    attendance_only_timeline: attendance.map((e) => ({
      evidence_id: e.evidence_id,
      at: e.submitted_at,
      attendance_id_ref: e.attendance_id_ref,
      note: "出勤仅证明到场，不构成合格依据",
    })),
  };
}

// 企业视角：按岗位所需能力反查证据链。
export function reverseLookupByJob(state, { learner_id, required_skills }) {
  return required_skills.map((skillCode) => skillTrace(state, learner_id, skillCode));
}

// 学员视角：距离独立操作还缺哪项证据。
export function learnerGapAnalysis(state, learnerId, skillCodes) {
  return skillCodes.map((skillCode) => {
    const trace = skillTrace(state, learnerId, skillCode);
    const gaps = missingEvidence(state, learnerId, skillCode);
    return {
      skill_code: skillCode,
      status: trace.verdict.status,
      reason: trace.verdict.reason,
      gaps,
      current_evidence: {
        on_site_observations: trace.observations.length,
        practice_artifacts: trace.practice_artifacts.length,
        signed_reviews: trace.review_chain_length,
        valid_certificates: trace.certificates.length,
        attendance_records: trace.attendance_only_timeline.length,
      },
      ready_for_independent_operation: trace.verdict.status === "ready",
    };
  });
}

export function decideVerdict(state, learnerId, skillCode) {
  const all = evidenceForSkill(state, learnerId, skillCode);
  const review = latestReview(state, learnerId, skillCode);
  const certCovered = skillsCoveredByCertificate(state, learnerId).has(skillCode);
  const hasObservation = observationEvidence(state, learnerId, skillCode).length > 0;
  const hasArtifact = all.some((e) => e.evidence_kind === "practice_artifact");
  const hasOnlyAttendance =
    all.length > 0 && all.every((e) => NON_QUALIFYING_KINDS.has(e.evidence_kind));

  if (review?.decision === "pass" || certCovered)
    return {
      status: "ready",
      reason: review?.decision === "pass" ? "最近一次评议为合格" : "持有效证书覆盖该能力",
      grounded_in_observation: hasObservation,
    };

  if (review?.decision === "conditional")
    return {
      status: "conditional",
      reason: review.note || "评议为有条件通过",
      gap_skills: review.gap_skills,
    };

  if (review?.decision === "fail")
    return { status: "not_ready", reason: "最近一次评议为不合格" };

  if (hasOnlyAttendance)
    return { status: "not_ready", reason: "仅有出勤记录：到场不换算为合格" };
  if (hasObservation)
    return { status: "not_ready", reason: "已有现场目击证据，但尚缺合格评议" };
  if (hasArtifact)
    return { status: "not_ready", reason: "已有练习作品，但尚缺现场目击与合格评议" };
  return { status: "missing", reason: "尚无任何学习证据" };
}

export function missingEvidence(state, learnerId, skillCode) {
  const gaps = [];
  const all = evidenceForSkill(state, learnerId, skillCode);
  const review = latestReview(state, learnerId, skillCode);
  const certCovered = skillsCoveredByCertificate(state, learnerId).has(skillCode);
  const hasObservation = observationEvidence(state, learnerId, skillCode).length > 0;
  const hasArtifact = all.some((e) => e.evidence_kind === "practice_artifact");
  const hasOnlyAttendance =
    all.length > 0 && all.every((e) => NON_QUALIFYING_KINDS.has(e.evidence_kind));

  if (review?.decision !== "pass" && !certCovered) {
    if (hasOnlyAttendance || all.length === 0) gaps.push("现场目击记录（关键工序由责任人现场看过）");
    if (!hasObservation && !hasOnlyAttendance && all.length > 0)
      gaps.push("现场目击记录（关键工序由责任人现场看过）");
    if (!hasArtifact) gaps.push("可核验的练习作品");
    gaps.push("一次 decision=pass 的阶段评议");
    if (review?.decision === "conditional") gaps.push(...review.gap_skills);
  } else if (!hasObservation && !certCovered) {
    gaps.push("补充现场目击记录，以说明合格判定由谁现场看过");
  }
  return [...new Set(gaps)];
}

function latestView(review) {
  if (!review) return null;
  return {
    review_id: review.review_id,
    decision: review.decision,
    skill_code: review.skill_code,
    craft_revision_id: review.craft_revision_id,
    reviewer_ids: review.reviewer_ids,
    basis_evidence_ids: review.basis_evidence_ids,
    replaces_review_id: review.replaces_review_id,
    note: review.note,
    signed_at: review.signed_at,
  };
}

function shortEvidence(e) {
  return {
    evidence_id: e.evidence_id,
    evidence_kind: e.evidence_kind,
    source_classification: e.source_classification,
    craft_revision_id: e.craft_revision_id,
    course_offering_id: e.course_offering_id,
    observer_ids: e.observer_ids,
    artifact_refs: e.artifact_refs,
    quantified_result: e.quantified_result,
    submitted_at: e.submitted_at,
  };
}
