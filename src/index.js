// 师承能力履历服务统一入口（零依赖）。
export * from "./constants.js";
export { EventStore, EventContractError } from "./store.js";
export {
  buildState,
  evidenceForSkill,
  latestReview,
  observationEvidence,
  reviewHistory,
  skillsCoveredByCertificate,
  validCertificatesFor,
} from "./projections.js";
export {
  decideVerdict,
  learnerGapAnalysis,
  missingEvidence,
  reverseLookupByJob,
  skillTrace,
} from "./traceability.js";
export {
  auditContinuity,
  certificateTimeline,
  certificateValidAt,
  governanceReport,
  reviewChainIntact,
  reviewLineage,
} from "./governance.js";
export {
  activeConsents,
  crossStudioShowcasePackage,
  employmentVerificationPackage,
} from "./consent.js";
export { attendanceRanking, culturalAuthorityReport } from "./metrics.js";
