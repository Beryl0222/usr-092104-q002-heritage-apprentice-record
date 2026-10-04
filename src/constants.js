// 领域事件/聚合代码是接入边界：只增不改（见 contracts/domain.md）。

export const EVENT_TYPES = [
  // v0.1 已发布，语义冻结
  "CRAFT_REGISTERED",
  "EVIDENCE_SUBMITTED",
  "REVIEW_SIGNED",
  "CERTIFICATE_ISSUED",
  "PLACEMENT_TRANSFERRED",
  // v0.2 新增
  "STUDIO_REGISTERED",
  "MASTER_DEPARTED",
  "COURSE_REVISED",
  "EVIDENCE_AMENDED",
  "CERTIFICATE_REVOKED",
  "CERTIFICATE_REISSUED",
  "PRACTICE_ASSIGNED",
  "RESPONSIBILITY_REASSIGNED",
  "PRACTICE_FULFILLED",
  "CONSENT_GRANTED",
  "CONSENT_WITHDRAWN",
];

export const AGGREGATE_TYPES = [
  // v0.1
  "craft_revision",
  "learning_evidence",
  "competency_review",
  "placement_record",
  // v0.2
  "studio_profile",
  "course_offering",
  "certificate_grant",
  "practice_commitment",
  "consent_grant",
];

// v0.1 事件：不强制 event_type_display
export const V01_EVENT_TYPES = new Set([
  "CRAFT_REGISTERED",
  "EVIDENCE_SUBMITTED",
  "REVIEW_SIGNED",
  "CERTIFICATE_ISSUED",
  "PLACEMENT_TRANSFERRED",
]);

// 事件类型与聚合的配对约定
export const EVENT_AGGREGATE = {
  CRAFT_REGISTERED: "craft_revision",
  COURSE_REVISED: "course_offering",
  EVIDENCE_SUBMITTED: "learning_evidence",
  EVIDENCE_AMENDED: "learning_evidence",
  REVIEW_SIGNED: "competency_review",
  CERTIFICATE_ISSUED: "certificate_grant",
  CERTIFICATE_REVOKED: "certificate_grant",
  CERTIFICATE_REISSUED: "certificate_grant",
  PRACTICE_ASSIGNED: "practice_commitment",
  RESPONSIBILITY_REASSIGNED: "practice_commitment",
  PRACTICE_FULFILLED: "practice_commitment",
  CONSENT_GRANTED: "consent_grant",
  CONSENT_WITHDRAWN: "consent_grant",
  PLACEMENT_TRANSFERRED: "placement_record",
  STUDIO_REGISTERED: "studio_profile",
  MASTER_DEPARTED: "studio_profile",
};

export const EVIDENCE_KINDS = [
  "attendance_record", // 单纯到场：永不构成合格依据
  "practice_artifact", // 练习作品
  "on_site_observation", // 责任人现场目击
  "stage_review", // 阶段评议凭据
  "certificate_snapshot", // 证书快照
];

export const SOURCE_CLASSIFICATIONS = [
  "master_oral_secret", // 师傅口授诀窍
  "school_course", // 学校课程成果
  "learner_innovation", // 学员改良创意
  "standard_practice", // 标准工序练习
];

export const REVIEW_DECISIONS = ["pass", "conditional", "fail"];

export const CONSENT_PURPOSES = [
  "employment_verification",
  "cross_studio_showcase",
  "cultural_authority_report",
  "archival",
];

export const SENSITIVE_MATERIALS = [
  "unpublished_recipe", // 未公开配方
  "personal_image", // 个人影像
  "unadopted_innovation", // 未被采用的创意
];

// 可独立支撑“现场看过”判定的证据类型
export const OBSERVATION_KINDS = new Set(["on_site_observation", "stage_review"]);
// 永远不能换算成合格的证据类型
export const NON_QUALIFYING_KINDS = new Set(["attendance_record"]);
