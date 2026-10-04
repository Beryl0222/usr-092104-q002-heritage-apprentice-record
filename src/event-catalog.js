// 师承能力履历事件目录：事件标识、聚合归属、载荷必填项与稳定枚举。
// 契约 schema（contracts/domain.schema.json）与校验器都以本目录为准，测试负责交叉核对，防止两边漂移。

export const EVENT_TYPES = Object.freeze({
  // 既有五个事件，标识与语义保持不变（接入边界）
  CRAFT_REGISTERED: "CRAFT_REGISTERED",
  EVIDENCE_SUBMITTED: "EVIDENCE_SUBMITTED",
  REVIEW_SIGNED: "REVIEW_SIGNED",
  CERTIFICATE_ISSUED: "CERTIFICATE_ISSUED",
  PLACEMENT_TRANSFERRED: "PLACEMENT_TRANSFERRED",
  // 修订与生命周期（新增，仅追加）
  CRAFT_REVISED: "CRAFT_REVISED",
  COURSE_REGISTERED: "COURSE_REGISTERED",
  COURSE_REVISED: "COURSE_REVISED",
  JOB_ROLE_DEFINED: "JOB_ROLE_DEFINED",
  JOB_ROLE_CANCELLED: "JOB_ROLE_CANCELLED",
  MENTORSHIP_ASSIGNED: "MENTORSHIP_ASSIGNED",
  MENTOR_WITHDRAWN: "MENTOR_WITHDRAWN",
  ATTENDANCE_LOGGED: "ATTENDANCE_LOGGED",
  REVIEW_RECONSIDERED: "REVIEW_RECONSIDERED",
  CERTIFICATE_REVOKED: "CERTIFICATE_REVOKED",
  PRACTICE_PLANNED: "PRACTICE_PLANNED",
  PRACTICE_CONTINUED: "PRACTICE_CONTINUED",
  PRACTICE_COMPLETED: "PRACTICE_COMPLETED",
  CONSENT_GRANTED: "CONSENT_GRANTED",
  CONSENT_WITHDRAWN: "CONSENT_WITHDRAWN",
  PLACEMENT_ESTABLISHED: "PLACEMENT_ESTABLISHED",
});

export const AGGREGATE_TYPES = Object.freeze({
  CRAFT_REVISION: "craft_revision",
  COURSE: "course",
  JOB_ROLE: "job_role",
  MENTORSHIP: "mentorship",
  LEARNING_EVIDENCE: "learning_evidence",
  ATTENDANCE_RECORD: "attendance_record",
  COMPETENCY_REVIEW: "competency_review",
  CERTIFICATE: "certificate",
  PRACTICE_PURSUIT: "practice_pursuit",
  CONSENT_GRANT: "consent_grant",
  PLACEMENT_RECORD: "placement_record",
});

// 事件类型 → 允许归属的聚合
export const EVENT_AGGREGATE = Object.freeze({
  CRAFT_REGISTERED: AGGREGATE_TYPES.CRAFT_REVISION,
  CRAFT_REVISED: AGGREGATE_TYPES.CRAFT_REVISION,
  COURSE_REGISTERED: AGGREGATE_TYPES.COURSE,
  COURSE_REVISED: AGGREGATE_TYPES.COURSE,
  JOB_ROLE_DEFINED: AGGREGATE_TYPES.JOB_ROLE,
  JOB_ROLE_CANCELLED: AGGREGATE_TYPES.JOB_ROLE,
  MENTORSHIP_ASSIGNED: AGGREGATE_TYPES.MENTORSHIP,
  MENTOR_WITHDRAWN: AGGREGATE_TYPES.MENTORSHIP,
  EVIDENCE_SUBMITTED: AGGREGATE_TYPES.LEARNING_EVIDENCE,
  ATTENDANCE_LOGGED: AGGREGATE_TYPES.ATTENDANCE_RECORD,
  REVIEW_SIGNED: AGGREGATE_TYPES.COMPETENCY_REVIEW,
  REVIEW_RECONSIDERED: AGGREGATE_TYPES.COMPETENCY_REVIEW,
  CERTIFICATE_ISSUED: AGGREGATE_TYPES.CERTIFICATE,
  CERTIFICATE_REVOKED: AGGREGATE_TYPES.CERTIFICATE,
  PRACTICE_PLANNED: AGGREGATE_TYPES.PRACTICE_PURSUIT,
  PRACTICE_CONTINUED: AGGREGATE_TYPES.PRACTICE_PURSUIT,
  PRACTICE_COMPLETED: AGGREGATE_TYPES.PRACTICE_PURSUIT,
  CONSENT_GRANTED: AGGREGATE_TYPES.CONSENT_GRANT,
  CONSENT_WITHDRAWN: AGGREGATE_TYPES.CONSENT_GRANT,
  PLACEMENT_ESTABLISHED: AGGREGATE_TYPES.PLACEMENT_RECORD,
  PLACEMENT_TRANSFERRED: AGGREGATE_TYPES.PLACEMENT_RECORD,
});

// 证据来源类型：用于区分师傅口授、学校课程成果与学员个人创意，互不混算
export const EVIDENCE_KINDS = Object.freeze({
  PRACTICE_WORK: "practice_work", // 练习作品
  ON_SITE_OBSERVATION: "on_site_observation", // 现场观察记录（谁在现场看过）
  ORAL_KNACK: "oral_knack", // 师傅口授诀窍
  COURSEWORK: "coursework", // 学校课程成果
  INNOVATION: "innovation", // 学员个人改良创意
});

// 创新采用状态
export const ADOPTION_STATES = Object.freeze({
  ADOPTED: "adopted",
  NOT_ADOPTED: "not_adopted",
  PENDING: "pending",
});

// 实践发起来源：决定哪类变动会触发接续责任
export const PRACTICE_SOURCES = Object.freeze({
  MENTORSHIP: "mentorship",
  COURSE: "course",
  PLACEMENT: "placement",
});

// 需按用途授权的敏感材料类别
export const MATERIAL_CATEGORIES = Object.freeze({
  UNPUBLISHED_RECIPE: "unpublished_recipe", // 未公开配方
  PERSONAL_IMAGE: "personal_image", // 个人影像
  UNUSED_INNOVATION: "unused_innovation", // 未被采用的创意
  ORDINARY_WORK: "ordinary_work", // 一般练习材料
});

// 授权用途
export const CONSENT_PURPOSES = Object.freeze({
  EMPLOYMENT_VERIFICATION: "employment_verification", // 企业录用人岗核验
  CROSS_STUDIO_DISPLAY: "cross_studio_display", // 跨工作室展示
  BUREAU_STATISTICS: "bureau_statistics", // 文化主管部门汇总
  PUBLIC_EXHIBITION: "public_exhibition", // 公开展演
});

export const CONSENT_SCOPES = Object.freeze({
  SAME_STUDIO: "same_studio",
  CROSS_STUDIO: "cross_studio",
});

// 各事件 payload 的必填字段（结构层面；跨事件不变量在 validator 的日志校验中处理）
export const PAYLOAD_REQUIRED = Object.freeze({
  CRAFT_REGISTERED: ["studio_id", "craft_name", "craft_nodes"],
  CRAFT_REVISED: ["studio_id", "craft_name", "supersedes_revision_id", "craft_nodes"],
  COURSE_REGISTERED: ["school_id", "course_name"],
  COURSE_REVISED: ["school_id", "course_name", "supersedes_course_id"],
  JOB_ROLE_DEFINED: ["shop_id", "role_name", "required_nodes"],
  JOB_ROLE_CANCELLED: ["shop_id", "cancelled_at"],
  MENTORSHIP_ASSIGNED: ["studio_id", "master_id", "apprentice_id", "started_at"],
  MENTOR_WITHDRAWN: ["studio_id", "master_id", "effective_at"],
  EVIDENCE_SUBMITTED: [
    "studio_id",
    "apprentice_id",
    "kind",
    "craft_revision_id",
    "title",
    "produced_at",
  ],
  ATTENDANCE_LOGGED: ["studio_id", "apprentice_id", "date", "present"],
  REVIEW_SIGNED: ["studio_id", "apprentice_id", "stage", "reviewer_ids", "judgments"],
  REVIEW_RECONSIDERED: [
    "studio_id",
    "apprentice_id",
    "prior_review_id",
    "stage",
    "reviewer_ids",
    "judgments",
  ],
  CERTIFICATE_ISSUED: ["studio_id", "apprentice_id", "title", "review_ids", "issued_at"],
  CERTIFICATE_REVOKED: ["reason", "revoked_at"],
  PRACTICE_PLANNED: [
    "studio_id",
    "apprentice_id",
    "craft_revision_id",
    "node_id",
    "responsible_person_id",
    "source",
    "source_ref",
    "planned_at",
  ],
  PRACTICE_CONTINUED: [
    "studio_id",
    "apprentice_id",
    "craft_revision_id",
    "node_id",
    "predecessor_practice_id",
    "trigger_event_id",
    "new_responsible_person_id",
    "continued_at",
  ],
  PRACTICE_COMPLETED: ["completed_at", "evidence_id"],
  CONSENT_GRANTED: ["subject_id", "materials", "purposes", "scope", "granted_at"],
  CONSENT_WITHDRAWN: ["withdrawn_at"],
  PLACEMENT_ESTABLISHED: ["studio_id", "apprentice_id", "shop_id", "placed_at"],
  PLACEMENT_TRANSFERRED: ["studio_id", "apprentice_id", "to_shop_id", "transferred_at"],
});

export const SENSITIVE_CATEGORIES = Object.freeze([
  MATERIAL_CATEGORIES.UNPUBLISHED_RECIPE,
  MATERIAL_CATEGORIES.PERSONAL_IMAGE,
  MATERIAL_CATEGORIES.UNUSED_INNOVATION,
]);
