import { buildState } from "./projections.js";

// —— 复核意见链：后继意见不抹去原判断 ——

export function reviewLineage(state, reviewId) {
  const chain = [];
  let current = state.reviews.get(reviewId);
  // 找到链首
  while (current?.replaces_review_id) {
    const prev = state.reviews.get(current.replaces_review_id);
    if (!prev) break;
    current = prev;
  }
  let node = current;
  while (node) {
    chain.push({
      review_id: node.review_id,
      decision: node.decision,
      note: node.note,
      reviewer_ids: node.reviewer_ids,
      replaces_review_id: node.replaces_review_id,
      signed_at: node.signed_at,
    });
    const next = [...state.reviews.values()].find((r) => r.replaces_review_id === node.review_id);
    node = next ?? null;
  }
  return chain;
}

export function reviewChainIntact(state) {
  const violations = [];
  for (const review of state.reviews.values()) {
    if (review.replaces_review_id && !state.reviews.has(review.replaces_review_id))
      violations.push(
        `评议 ${review.review_id} 声明 replaces_review_id=${review.replaces_review_id}，但原评议不存在（原判断不得悬空）`
      );
    if (review.replaces_review_id === review.review_id)
      violations.push(`评议 ${review.review_id} 不能以自身为后继意见`);
  }
  return violations;
}

// —— 证书 ——

export function certificateTimeline(state, certificateId) {
  const cert = state.certificates.get(certificateId);
  return cert
    ? {
        certificate_id: cert.certificate_id,
        learner_id: cert.learner_id,
        skill_codes: cert.skill_codes,
        status: cert.status,
        issued_by_master_id: cert.issued_by_master_id,
        valid_from: cert.valid_from,
        valid_until: cert.valid_until,
        reissue_of_certificate_id: cert.reissue_of_certificate_id,
        replaced_by: cert.replaced_by,
        revoke_reason: cert.revoke_reason,
        history: cert.history,
      }
    : null;
}

// 证书是否在指定时点有效：撤销为终态；师傅退出/岗位取消不影响。
export function certificateValidAt(state, certificateId, at) {
  const cert = state.certificates.get(certificateId);
  if (!cert || cert.status !== "issued" || cert.replaced_by) return false;
  const t = Date.parse(at);
  if (Date.parse(cert.valid_from) > t) return false;
  if (cert.valid_until && Date.parse(cert.valid_until) < t) return false;
  return true;
}

// —— 接续责任审计 ——
// 按时序重放，捕捉仅看终态发现不了的问题：
// 1. 责任人退出后，名下 open 承诺无后续改派 → 孤儿实践；
// 2. 把承诺指派/改派给一个已退出的责任人；
// 3. 岗位（placement）取消后仍作为承接方。

export function auditContinuity(events) {
  const parties = new Map(); // party_id -> { status, withdrawn_event }
  const commitments = new Map(); // commitment_id -> { status, party, studio_id }
  const violations = [];

  const ensureParty = (id, type, status = "active") => {
    if (id && !parties.has(id)) parties.set(id, { type, status });
  };

  const ordered = [...events].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));

  for (const event of ordered) {
    const body = event.body ?? {};
    switch (event.event_type) {
      case "MASTER_DEPARTED":
        ensureParty(body.master_id, "master");
        parties.get(body.master_id).status = "withdrawn";
        parties.get(body.master_id).withdrawn_event = event.event_id;
        break;

      case "PLACEMENT_TRANSFERRED": {
        const id = body.placement_id ?? event.aggregate_id;
        ensureParty(id, "placement");
        if (body.status === "withdrawn") parties.get(id).status = "withdrawn";
        else if (body.status) parties.get(id).status = "active";
        break;
      }

      case "PRACTICE_ASSIGNED": {
        const party = body.responsible_party_id;
        ensureParty(party, body.responsible_party_type ?? "unknown");
        if (parties.get(party)?.status === "withdrawn")
          violations.push(
            `承诺 ${event.aggregate_id} 指派给已退出的责任人 ${party}（${event.event_id}）`
          );
        commitments.set(event.aggregate_id, {
          status: "open",
          party,
          studio_id: body.studio_id ?? null,
          learner_id: body.learner_id ?? null,
        });
        break;
      }

      case "RESPONSIBILITY_REASSIGNED": {
        const c = commitments.get(event.aggregate_id);
        const to = body.reassigned_to;
        ensureParty(to, body.reassigned_to_type ?? "unknown");
        if (parties.get(to)?.status === "withdrawn")
          violations.push(
            `承诺 ${event.aggregate_id} 改派给已退出的责任人 ${to}（${event.event_id}）`
          );
        if (!c)
          violations.push(
            `改派事件 ${event.event_id} 找不到承诺 ${event.aggregate_id}`
          );
        if (c) c.party = to;
        break;
      }

      case "PRACTICE_FULFILLED": {
        const c = commitments.get(event.aggregate_id);
        if (c) c.status = "fulfilled";
        break;
      }

      default:
        break;
    }
  }

  const orphans = [];
  for (const [id, c] of commitments) {
    if (c.status === "open" && parties.get(c.party)?.status === "withdrawn")
      orphans.push({
        commitment_id: id,
        learner_id: c.learner_id,
        studio_id: c.studio_id,
        responsible_party_id: c.party,
      });
  }

  return {
    intact: violations.length === 0 && orphans.length === 0,
    violations,
    orphan_commitments: orphans,
  };
}

// 便捷：对一个已建好的状态附带接续审计结果。
export function governanceReport(events) {
  const state = buildState(events);
  const continuity = auditContinuity(events);
  return {
    state,
    continuity,
    review_chain_violations: reviewChainIntact(state),
  };
}
