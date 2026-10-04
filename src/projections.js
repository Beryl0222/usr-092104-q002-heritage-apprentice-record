import {
  CONSENT_PURPOSES,
  CONSENT_SCOPES,
  EVIDENCE_KINDS,
  EVENT_TYPES,
  PRACTICE_SOURCES,
} from "./event-catalog.js";
import { authorizeMaterialAccess } from "./validator.js";

// 只读投影：事件序列不可变，所有查询模型都由完整事件序列折叠得到，不落“最终状态表”。
// 投影只暴露判断所依据的证据链（练习作品 / 现场观察 / 阶段评议 / 有效证书），
// 不把出勤折成能力，也不产出个人打卡排名。

const ts = (s) => Date.parse(s);

export function foldEvents(events) {
  const state = {
    crafts: new Map(), // aggregate_id -> { current event, chain: [ids] }
    courses: new Map(),
    roles: new Map(), // aggregate_id -> { defined, cancelled_at, payload }
    mentorships: new Map(),
    evidence: new Map(), // aggregate_id -> submitted event
    attendance: [],
    reviews: [], // 所有评议事件（含复核）
    certificates: new Map(), // aggregate_id -> { issued, revoked }
    practices: new Map(), // aggregate_id -> { head, events }
    consents: new Map(),
    placements: new Map(), // aggregate_id -> events
  };
  const list = Array.isArray(events) ? events : [];

  for (const e of list) {
    switch (e.event_type) {
      case EVENT_TYPES.CRAFT_REGISTERED:
      case EVENT_TYPES.CRAFT_REVISED:
        state.crafts.set(e.aggregate_id, e);
        break;
      case EVENT_TYPES.COURSE_REGISTERED:
      case EVENT_TYPES.COURSE_REVISED:
        state.courses.set(e.aggregate_id, e);
        break;
      case EVENT_TYPES.JOB_ROLE_DEFINED:
        state.roles.set(e.aggregate_id, { payload: e.payload, cancelled_at: null });
        break;
      case EVENT_TYPES.JOB_ROLE_CANCELLED:
        if (state.roles.has(e.aggregate_id)) state.roles.get(e.aggregate_id).cancelled_at = e.payload.cancelled_at;
        break;
      case EVENT_TYPES.MENTORSHIP_ASSIGNED:
        state.mentorships.set(e.aggregate_id, { assigned: e, withdrawn: null });
        break;
      case EVENT_TYPES.MENTOR_WITHDRAWN:
        if (state.mentorships.has(e.aggregate_id)) state.mentorships.get(e.aggregate_id).withdrawn = e;
        break;
      case EVENT_TYPES.EVIDENCE_SUBMITTED:
        state.evidence.set(e.aggregate_id, e);
        break;
      case EVENT_TYPES.ATTENDANCE_LOGGED:
        state.attendance.push(e);
        break;
      case EVENT_TYPES.REVIEW_SIGNED:
      case EVENT_TYPES.REVIEW_RECONSIDERED:
        state.reviews.push(e);
        break;
      case EVENT_TYPES.CERTIFICATE_ISSUED:
        state.certificates.set(e.aggregate_id, { issued: e, revoked: null });
        break;
      case EVENT_TYPES.CERTIFICATE_REVOKED:
        if (state.certificates.has(e.aggregate_id)) state.certificates.get(e.aggregate_id).revoked = e;
        break;
      case EVENT_TYPES.PRACTICE_PLANNED:
      case EVENT_TYPES.PRACTICE_CONTINUED:
        if (!state.practices.has(e.aggregate_id)) state.practices.set(e.aggregate_id, { head: e, events: [] });
        state.practices.get(e.aggregate_id).head = e;
        state.practices.get(e.aggregate_id).events.push(e);
        break;
      case EVENT_TYPES.PRACTICE_COMPLETED:
        if (!state.practices.has(e.aggregate_id)) state.practices.set(e.aggregate_id, { head: null, events: [] });
        state.practices.get(e.aggregate_id).events.push(e);
        break;
      case EVENT_TYPES.CONSENT_GRANTED:
      case EVENT_TYPES.CONSENT_WITHDRAWN:
        if (!state.consents.has(e.aggregate_id)) state.consents.set(e.aggregate_id, []);
        state.consents.get(e.aggregate_id).push(e);
        break;
      case EVENT_TYPES.PLACEMENT_ESTABLISHED:
      case EVENT_TYPES.PLACEMENT_TRANSFERRED:
        if (!state.placements.has(e.aggregate_id)) state.placements.set(e.aggregate_id, []);
        state.placements.get(e.aggregate_id).push(e);
        break;
    }
  }
  return state;
}

function craftNodeMap(state) {
  // node_id -> { name, critical, requiresObservation, revisionIds }
  const map = new Map();
  for (const e of state.crafts.values()) {
    for (const n of e.payload.craft_nodes ?? []) {
      const prev = map.get(n.node_id) ?? { name: n.name, critical: false, requiresObservation: false, revisionIds: [] };
      prev.critical = prev.critical || n.critical === true;
      prev.requiresObservation = prev.requiresObservation || n.requires_on_site_observation === true || n.critical === true;
      prev.revisionIds.push(e.aggregate_id);
      map.set(n.node_id, prev);
    }
  }
  return map;
}

// 某学员在每个工序上的“最新评议结论”：复核后继意见覆盖展示口径，但原评议仍可追溯。
function latestJudgmentsByNode(state, apprenticeId) {
  const result = new Map(); // node_id -> { conclusion, review_event, based_on }
  const mine = state.reviews
    .filter((e) => e.payload.apprentice_id === apprenticeId)
    .sort((a, b) => ts(a.occurred_at) - ts(b.occurred_at));
  for (const e of mine) {
    for (const j of e.payload.judgments ?? []) {
      result.set(j.node_id, {
        conclusion: j.conclusion,
        review_event: e,
        based_on: j.based_on_evidence_ids ?? [],
      });
    }
  }
  return result;
}

// 学员能力档案：把证据按“来源”分开列示，口授诀窍 / 课程成果 / 个人创意互不混算。
export function apprenticePortfolio(events, apprenticeId) {
  const state = foldEvents(events);
  const nodeMap = craftNodeMap(state);
  const myEvidence = [...state.evidence.values()].filter((e) => e.payload.apprentice_id === apprenticeId);
  const byNode = new Map();

  for (const ev of myEvidence) {
    for (const nodeId of ev.payload.node_ids ?? []) {
      if (!byNode.has(nodeId)) byNode.set(nodeId, []);
      byNode.get(nodeId).push({
        evidence_id: ev.aggregate_id,
        kind: ev.payload.kind,
        title: ev.payload.title,
        craft_revision_id: ev.payload.craft_revision_id,
        observer_ids: ev.payload.observer_ids ?? [],
        course_id: ev.payload.course_id ?? null,
        innovation_adoption: ev.payload.innovation_adoption ?? null,
        produced_at: ev.payload.produced_at,
      });
    }
  }

  const judgments = latestJudgmentsByNode(state, apprenticeId);
  const certificates = [...state.certificates.entries()]
    .filter(([, c]) => c.issued?.payload.apprentice_id === apprenticeId)
    .map(([id, c]) => ({
      certificate_id: id,
      title: c.issued.payload.title,
      issued_at: c.issued.payload.issued_at,
      valid: !c.revoked,
      revoked_reason: c.revoked?.payload.reason ?? null,
      review_ids: c.issued.payload.review_ids,
    }));

  // 未完成实践按接续链归并：从每条链的根出发，只看链尾；已被新聚合接续的旧聚合不再单列。
  const continuations = [...state.practices.values()]
    .map((p) => p.events.find((e) => e.event_type === EVENT_TYPES.PRACTICE_CONTINUED))
    .filter(Boolean);
  const chainTailOf = (rootId) => {
    let cur = rootId;
    const seen = new Set();
    for (;;) {
      if (seen.has(cur)) break;
      seen.add(cur);
      const next = continuations.find((e) => e.payload.predecessor_practice_id === cur);
      if (!next) break;
      cur = next.aggregate_id;
    }
    return cur;
  };
  const openPractices = [];
  for (const [id, p] of state.practices) {
    if (p.events[0]?.event_type !== EVENT_TYPES.PRACTICE_PLANNED) continue;
    if (p.events[0].payload.apprentice_id !== apprenticeId) continue;
    const tailId = chainTailOf(id);
    const tailStream = state.practices.get(tailId).events;
    if (tailStream.some((e) => e.event_type === EVENT_TYPES.PRACTICE_COMPLETED)) continue;
    const head = tailStream[tailStream.length - 1];
    openPractices.push({
      practice_id: tailId,
      root_practice_id: id,
      node_id: head.payload.node_id,
      craft_revision_id: head.payload.craft_revision_id,
      responsible_person_id: head.payload.new_responsible_person_id ?? head.payload.responsible_person_id,
    });
  }

  const nodes = {};
  for (const [nodeId, info] of nodeMap) {
    const j = judgments.get(nodeId);
    nodes[nodeId] = {
      name: info.name,
      critical: info.critical,
      requires_on_site_observation: info.requiresObservation,
      evidence: byNode.get(nodeId) ?? [],
      latest_judgment: j
        ? {
            conclusion: j.conclusion,
            via: j.review_event.event_type === EVENT_TYPES.REVIEW_RECONSIDERED ? "后继复核意见" : "阶段评议",
            review_id: j.review_event.aggregate_id,
            prior_review_id: j.review_event.payload.prior_review_id ?? null,
            stage: j.review_event.payload.stage,
          }
        : null,
    };
  }

  return { apprentice_id: apprenticeId, nodes, certificates, open_practices: openPractices };
}

// 岗位反查：从岗位所需能力，逐项回到练习作品、现场观察、阶段评议与有效证书。
export function roleRequirementTrace(events, roleId) {
  const state = foldEvents(events);
  const role = state.roles.get(roleId);
  if (!role) return null;
  return {
    role_id: roleId,
    role_name: role.payload.role_name,
    shop_id: role.payload.shop_id,
    cancelled: Boolean(role.cancelled_at),
    cancelled_at: role.cancelled_at,
    requirements: role.payload.required_nodes.map((r) => {
      const craftEvent = state.crafts.get(r.craft_revision_id);
      const node = (craftEvent?.payload.craft_nodes ?? []).find((n) => n.node_id === r.node_id) ?? null;
      return {
        craft_revision_id: r.craft_revision_id,
        node_id: r.node_id,
        node_name: node?.name ?? r.node_id,
        critical: node?.critical === true,
        requires_on_site_observation:
          node?.requires_on_site_observation === true || node?.critical === true,
      };
    }),
  };
}

// 学员 × 岗位差距分析：缺口用稳定 code 返回，供学员端提示“距离独立操作还缺哪项证据”。
export function roleGapAnalysis(events, apprenticeId, roleId) {
  const state = foldEvents(events);
  const role = state.roles.get(roleId);
  if (!role) return null;
  const portfolio = apprenticePortfolio(events, apprenticeId);
  const myEvidence = [...state.evidence.values()].filter((e) => e.payload.apprentice_id === apprenticeId);
  const reviewById = new Map(state.reviews.map((e) => [e.aggregate_id, e]));
  // 复核形成后继意见：证书挂在原评议上时，沿 prior_review_id 链回溯确认。
  const reviewChainIds = (reviewId) => {
    const chain = [];
    let cur = reviewById.get(reviewId);
    const seen = new Set();
    while (cur && !seen.has(cur.aggregate_id)) {
      seen.add(cur.aggregate_id);
      chain.push(cur.aggregate_id);
      cur = cur.payload.prior_review_id ? reviewById.get(cur.payload.prior_review_id) : null;
    }
    return chain;
  };

  const items = role.payload.required_nodes.map((req) => {
    const nodeView = portfolio.nodes[req.node_id] ?? { evidence: [], latest_judgment: null };
    const blockers = [];
    const supporting = [];

    for (const ref of nodeView.evidence) {
      const onRequiredRevision = ref.craft_revision_id === req.craft_revision_id;
      // 学员个人改良创意只有被工作室采用后才进入岗位能力支撑；未采用创意仅在授权用途内另行查看。
      if (ref.kind === EVIDENCE_KINDS.INNOVATION && ref.innovation_adoption !== "adopted") continue;
      const item = { ...ref, matches_required_revision: onRequiredRevision };
      supporting.push(item);
    }

    const j = nodeView.latest_judgment;
    if (!j) {
      blockers.push({ code: "NO_REVIEW", message: "缺少该工序的阶段评议" });
    } else if (j.conclusion !== "competent") {
      blockers.push({
        code: "NOT_YET_COMPETENT",
        message: `最新结论为 ${j.conclusion === "developing" ? "培养中" : "尚未达标"}，未达独立操作`,
      });
    }

    const nodeIsCritical =
      nodeView.requires_on_site_observation || nodeView.critical;
    if (nodeIsCritical) {
      const onSite = nodeView.evidence.some(
        (x) =>
          x.kind === EVIDENCE_KINDS.ON_SITE_OBSERVATION &&
          x.matches_required_revision !== false &&
          x.observer_ids.length > 0,
      );
      if (!onSite) {
        blockers.push({ code: "CRITICAL_OBSERVATION_MISSING", message: "关键工序缺少指名观察者的现场观察记录" });
      }
    }

    // 岗位钉在某一工艺修订：能力依据来自更旧修订时，需要后继评议确认而非自动顺延。
    const judgmentEvidence = j
      ? myEvidence.filter((e) => {
          const je = state.reviews.find((r) => r.aggregate_id === j.review_id);
          return je && (je.payload.judgments ?? []).some(
            (jj) => jj.node_id === req.node_id && (jj.based_on_evidence_ids ?? []).includes(e.aggregate_id),
          );
        })
      : [];
    if (j?.conclusion === "competent" && judgmentEvidence.length > 0) {
      const allOnOldRevision = judgmentEvidence.every((e) => e.payload.craft_revision_id !== req.craft_revision_id);
      if (allOnOldRevision) {
        blockers.push({
          code: "JUDGMENT_BASED_ON_PRIOR_REVISION",
          message: "合格评议依据的是旧工艺修订，需按现行修订追加后继评议",
        });
      }
    }

    const backedReviewIds = j ? reviewChainIds(j.review_id) : [];
    const hasValidCertificate = portfolio.certificates.some(
      (c) => c.valid && c.review_ids.some((rid) => backedReviewIds.includes(rid)),
    );

    return {
      craft_revision_id: req.craft_revision_id,
      node_id: req.node_id,
      satisfied: blockers.length === 0,
      blockers,
      supporting_evidence: supporting,
      latest_judgment: j,
      certificate_backed: hasValidCertificate,
    };
  });

  return {
    apprentice_id: apprenticeId,
    role_id: roleId,
    role_cancelled: Boolean(role.cancelled_at),
    ready_for_independent_work: items.every((i) => i.satisfied),
    items,
    note: "出勤记录仅证明到场，不参与本分析；未被采用的创意仅在授权用途内可见。",
  };
}

// 文化主管部门视图：工作室级培养—就业衔接汇总。
// 刻意只做聚合，不输出按人的出勤/打卡排名，也不展开未授权材料内容。
export function studioCultivationSummary(events, studioId) {
  const state = foldEvents(events);
  const apprenticeIds = new Set();
  const evidenceByKind = {};
  let reviewCount = 0;
  let reconsiderationCount = 0;
  const judgmentCounts = { competent: 0, developing: 0, not_yet: 0 };
  let validCertificates = 0;
  let revokedCertificates = 0;
  let attendanceDays = 0;
  const placements = { established: 0, transferred: 0, active_shops: new Map() };
  let openPractices = 0;
  let orphanedPractices = 0;

  const inStudio = (e) => e.payload?.studio_id === studioId;

  // 接续发生在新聚合上：按“接续链”归并，每条链只从根统计一次，链尾未完成才算未完成实践。
  const continuations = [...state.practices.values()]
    .map((p) => p.events.find((e) => e.event_type === EVENT_TYPES.PRACTICE_CONTINUED))
    .filter(Boolean);

  const chainTailOf = (rootId) => {
    let cur = rootId;
    const seen = new Set();
    for (;;) {
      if (seen.has(cur)) break;
      seen.add(cur);
      const next = continuations.find((e) => e.payload.predecessor_practice_id === cur);
      if (!next) break;
      cur = next.aggregate_id;
    }
    return cur;
  };

  for (const [id, p] of state.practices) {
    const head = p.events[0];
    if (head?.event_type !== EVENT_TYPES.PRACTICE_PLANNED || !inStudio(head)) continue;
    const tailId = chainTailOf(id);
    const tail = state.practices.get(tailId);
    if (tail.events.some((e) => e.event_type === EVENT_TYPES.PRACTICE_COMPLETED)) continue;
    openPractices += 1;
    const tailHead = tail.events[tail.events.length - 1];
    const sourceRef = rootSourceRef(state, tail.events);
    if (sourceRef && sourceDisruptedAfter(state, sourceRef, tailHead)) orphanedPractices += 1;
  }

  for (const e of state.evidence.values()) {
    if (!inStudio(e)) continue;
    apprenticeIds.add(e.payload.apprentice_id);
    evidenceByKind[e.payload.kind] = (evidenceByKind[e.payload.kind] ?? 0) + 1;
  }
  for (const e of state.reviews) {
    if (!inStudio(e)) continue;
    apprenticeIds.add(e.payload.apprentice_id);
    reviewCount += 1;
    if (e.event_type === EVENT_TYPES.REVIEW_RECONSIDERED) reconsiderationCount += 1;
    for (const j of e.payload.judgments ?? []) judgmentCounts[j.conclusion] = (judgmentCounts[j.conclusion] ?? 0) + 1;
  }
  for (const [, c] of state.certificates) {
    if (c.issued?.payload.studio_id !== studioId) continue;
    apprenticeIds.add(c.issued.payload.apprentice_id);
    if (c.revoked) revokedCertificates += 1;
    else validCertificates += 1;
  }
  for (const e of state.attendance) {
    if (inStudio(e) && e.payload.present) attendanceDays += 1;
  }
  for (const stream of state.placements.values()) {
    for (const e of stream) {
      if (!inStudio(e)) continue;
      apprenticeIds.add(e.payload.apprentice_id);
      if (e.event_type === EVENT_TYPES.PLACEMENT_ESTABLISHED) {
        placements.established += 1;
        placements.active_shops.set(e.aggregate_id, e.payload.shop_id);
      }
      if (e.event_type === EVENT_TYPES.PLACEMENT_TRANSFERRED) {
        placements.transferred += 1;
        placements.active_shops.set(e.aggregate_id, e.payload.to_shop_id);
      }
    }
  }

  return {
    studio_id: studioId,
    apprentices_observed: apprenticeIds.size,
    evidence_by_kind: evidenceByKind,
    stage_reviews: reviewCount,
    reconsiderations_appended: reconsiderationCount,
    judgment_counts: judgmentCounts,
    valid_certificates: validCertificates,
    revoked_certificates: revokedCertificates,
    attendance_days_total: attendanceDays,
    placements: {
      established: placements.established,
      transferred: placements.transferred,
      active_placement_links: placements.active_shops.size,
    },
    open_practices: openPractices,
    practices_awaiting_successor: orphanedPractices,
    governance: [
      "仅提供工作室级聚合，不产出个人出勤/打卡排名",
      "出勤天数单独列示，不并入合格数与能力结论",
      "原评议与后继复核意见同时计数，后继意见不抹去原判断",
      "未公开配方、个人影像、未被采用创意的内容不在本视图展开",
    ],
  };
}

function rootSourceRef(state, practiceEvents) {
  // 沿 predecessor_practice_id 找回 PRACTICE_PLANNED 的 source/source_ref
  let head = practiceEvents[0];
  const seen = new Set();
  while (head && head.event_type === EVENT_TYPES.PRACTICE_CONTINUED && !seen.has(head.aggregate_id)) {
    seen.add(head.aggregate_id);
    head = state.practices.get(head.payload.predecessor_practice_id)?.events[0];
  }
  return head?.event_type === EVENT_TYPES.PRACTICE_PLANNED
    ? { source: head.payload.source, source_ref: head.payload.source_ref }
    : null;
}

function sourceDisruptedAfter(state, ref, practiceHead) {
  const at = practiceHead.payload.continued_at ?? practiceHead.payload.planned_at;
  if (ref.source === PRACTICE_SOURCES.MENTORSHIP) {
    const w = state.mentorships.get(ref.source_ref)?.withdrawn;
    return w && ts(w.payload.effective_at) > ts(at);
  }
  if (ref.source === PRACTICE_SOURCES.COURSE) {
    const courseEvents = [...state.courses.entries()].find(([id]) => id === ref.source_ref);
    const latest = courseEvents ? courseEvents[1] : null;
    return latest?.event_type === EVENT_TYPES.COURSE_REVISED && ts(latest.occurred_at) > ts(at);
  }
  if (ref.source === PRACTICE_SOURCES.PLACEMENT) {
    const stream = [...state.placements.values()].find((es) => es.some((e) => e.aggregate_id === ref.source_ref));
    const roleId = [...(stream ?? [])].reverse().find((e) => e.payload.role_id)?.payload.role_id;
    const cancelledAt = roleId ? state.roles.get(roleId)?.cancelled_at : null;
    return cancelledAt && ts(cancelledAt) > ts(at);
  }
  return false;
}

// 企业录用核验：按用途反查一份具体材料是否可展示。
export function checkMaterialAccess(events, request) {
  return authorizeMaterialAccess(events, {
    purpose: CONSENT_PURPOSES.EMPLOYMENT_VERIFICATION,
    scope: CONSENT_SCOPES.SAME_STUDIO,
    ...request,
  });
}
