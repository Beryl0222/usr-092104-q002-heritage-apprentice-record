import { NON_QUALIFYING_KINDS, SENSITIVE_MATERIALS } from "./constants.js";
import { latestReview, validCertificatesFor } from "./projections.js";
import { skillTrace } from "./traceability.js";

// 找出学员在某用途、某时点仍有效的授权（未撤回且未过期）。
export function activeConsents(state, learnerId, purpose, asOf) {
  const t = asOf ? Date.parse(asOf) : Date.now();
  return [...state.consents.values()].filter((g) => {
    if (g.learner_id !== learnerId || g.withdrawn) return false;
    if (!g.purposes.includes(purpose)) return false;
    if (g.valid_until && Date.parse(g.valid_until) < t) return false;
    if (Date.parse(g.granted_at) > t) return false;
    return true;
  });
}

function allowedMaterialIds(state, learnerId, purpose, asOf) {
  const ids = new Set();
  const sensitive = new Set();
  for (const g of activeConsents(state, learnerId, purpose, asOf)) {
    for (const ref of g.material_scope) ids.add(ref);
    for (const s of g.sensitive_materials) sensitive.add(s);
  }
  return { ids, sensitive };
}

// 判断单条证据的材料是否落在授权范围内。
// material_scope 可用 evidence_id 或具体 artifact_ref；敏感标签必须被显式授权。
function evidencePermitted(evidence, allowed) {
  if (allowed.ids.has(evidence.evidence_id)) return true;
  return evidence.artifact_refs.some((ref) => allowed.ids.has(ref));
}

function sensitiveBlocked(evidence, allowed) {
  const tags = new Set([...(evidence.sensitive_tags ?? []), ...inherentSensitiveTags(evidence)]);
  for (const tag of tags) if (!allowed.sensitive.has(tag)) return tag;
  return null;
}

function inherentSensitiveTags(evidence) {
  const tags = [];
  if (evidence.source_classification === "master_oral_secret") tags.push("unpublished_recipe");
  if (evidence.innovation?.status && evidence.innovation.status !== "adopted")
    tags.push("unadopted_innovation");
  return tags;
}

// —— 企业核验包：岗位所需能力反查 + 按用途裁剪 ——
export function employmentVerificationPackage(state, { learner_id, required_skills, asOf }) {
  const allowed = allowedMaterialIds(state, learner_id, "employment_verification", asOf);
  const traces = required_skills.map((skill) => {
    const trace = skillTrace(state, learner_id, skill);
    const review = latestReview(state, learner_id, skill);

    const filterEvidence = (list) =>
      list
        .filter((e) => !NON_QUALIFYING_KINDS.has(e.evidence_kind))
        .map((e) => {
          if (!evidencePermitted(state.evidence.get(e.evidence_id), allowed))
            return { evidence_id: e.evidence_id, status: "omitted_no_authorization" };
          const blocked = sensitiveBlocked(state.evidence.get(e.evidence_id), allowed);
          if (blocked)
            return {
              evidence_id: e.evidence_id,
              status: "redacted_sensitive",
              redacted_tag: blocked,
              source_classification: e.source_classification,
            };
          return { ...e, status: "included" };
        });

    return {
      skill_code: skill,
      verdict: trace.verdict,
      latest_review: review
        ? {
            review_id: review.review_id,
            decision: review.decision,
            signed_at: review.signed_at,
            reviewer_ids: review.reviewer_ids,
          }
        : null,
      certificates: validCertificatesFor(state, learner_id, asOf)
        .filter((c) => c.skill_codes.includes(skill))
        .map((c) => ({
          certificate_id: c.certificate_id,
          certificate_code: c.certificate_code,
          valid_until: c.valid_until,
          status: c.status,
        })),
      observers: trace.observers,
      observations: filterEvidence(trace.observations),
      practice_artifacts: filterEvidence(trace.practice_artifacts),
      // 出勤不进入企业核验包
    };
  });

  return {
    package_type: "employment_verification",
    learner_id,
    generated_at: asOf ?? new Date().toISOString(),
    required_skills,
    skills: traces,
    ready_skills: traces.filter((t) => t.verdict.status === "ready").map((t) => t.skill_code),
  };
}

// —— 跨工作室展示包：只取必要材料 ——
// 默认仅：被采纳的学员创意、脱敏作品、已公开工序；
// 未公开配方/个人影像/未被采用创意一律剔除。
export function crossStudioShowcasePackage(state, { learner_id, skills = [], asOf }) {
  const allowed = allowedMaterialIds(state, learner_id, "cross_studio_showcase", asOf);
  const skillSet = skills.length ? new Set(skills) : null;

  const included = [];
  const excluded = [];

  for (const e of state.evidence.values()) {
    if (e.learner_id !== learner_id) continue;
    if (NON_QUALIFYING_KINDS.has(e.evidence_kind)) continue;
    if (skillSet && !skillSet.has(e.skill_code)) continue;

    const reason = exclusionReason(e, allowed);
    if (reason) {
      excluded.push({ evidence_id: e.evidence_id, reason });
      continue;
    }
    included.push({
      evidence_id: e.evidence_id,
      skill_code: e.skill_code,
      evidence_kind: e.evidence_kind,
      // 脱敏：不携带 observer 个人影像引用、不带完整作品原件标识
      artifact_refs: e.artifact_refs.filter((ref) => allowed.ids.has(ref)),
      quantified_result: e.quantified_result,
      innovation:
        e.source_classification === "learner_innovation" && e.innovation?.status === "adopted"
          ? {
              status: "adopted",
              adopted_in_craft_revision_id: e.innovation.adopted_in_craft_revision_id,
              note: e.innovation.note,
            }
          : undefined,
      craft_revision_id: e.craft_revision_id,
    });
  }

  return {
    package_type: "cross_studio_showcase",
    learner_id,
    generated_at: asOf ?? new Date().toISOString(),
    principle: "仅含已授权、已公开或已采纳的必要材料；敏感与未采纳材料不跨工作室流转",
    materials: included,
    excluded_count: excluded.length,
    excluded,
  };
}

function exclusionReason(evidence, allowed) {
  // 策略性硬排除优先：即使出现在某授权清单中，这些材料也不允许跨工作室流转
  if (evidence.source_classification === "master_oral_secret") return "unpublished_recipe";
  const blocked = sensitiveBlocked(evidence, allowed);
  if (blocked) return blocked;
  if (
    evidence.source_classification === "learner_innovation" &&
    evidence.innovation &&
    evidence.innovation.status !== "adopted"
  )
    return "unadopted_innovation";
  if (!evidencePermitted(evidence, allowed)) return "not_authorized_for_purpose";
  return null;
}

export const SENSITIVE_TAGS = SENSITIVE_MATERIALS;
