import { OBSERVATION_KINDS } from "./constants.js";

// 事件重放读模型。所有历史结论都由重放得出，不就地修改任何事件。
// 未知事件类型一律跳过（兼容约定第 5 条）。
export function buildState(events, { asOf } = {}) {
  const state = {
    asOf,
    studios: new Map(),
    masters: new Map(), // master_id -> { master_id, studio_id, status, departed_at }
    craftRevisions: new Map(), // craft_revision_id -> 修订事件负载（含修订链）
    craftCodes: new Map(), // craft_code -> [craft_revision_id...]（版本先后）
    courseOfferings: new Map(),
    evidence: new Map(), // learning_evidence id -> 合并勘误后的证据
    reviews: new Map(), // review_id -> 评议
    reviewChain: new Map(), // learner/skill -> [review_id...]（签署先后）
    certificates: new Map(),
    commitments: new Map(),
    responsibles: new Map(), // party_id -> { type, status: active|withdrawn, via }
    consents: new Map(),
    placements: new Map(),
    learners: new Set(),
  };

  for (const event of [...events].sort(compareEvents)) {
    if (asOf && Date.parse(event.occurred_at) > Date.parse(asOf)) break;
    apply(state, event);
  }
  return state;
}

function compareEvents(a, b) {
  const t = Date.parse(a.occurred_at) - Date.parse(b.occurred_at);
  if (t !== 0) return t;
  const v = a.version - b.version;
  if (v !== 0) return v;
  return a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0;
}

function touchLearner(state, id) {
  if (id) state.learners.add(id);
}

function apply(state, event) {
  const body = event.body ?? {};
  switch (event.event_type) {
    case "STUDIO_REGISTERED": {
      state.studios.set(body.studio_id ?? event.aggregate_id, {
        studio_id: body.studio_id ?? event.aggregate_id,
        studio_name: body.studio_name,
        registered_at: event.occurred_at,
      });
      break;
    }

    case "MASTER_DEPARTED": {
      const id = body.master_id;
      state.masters.set(id, {
        master_id: id,
        master_name: body.master_name,
        studio_id: body.studio_id,
        status: "departed",
        departed_at: event.occurred_at,
      });
      state.responsibles.set(id, {
        type: "master",
        status: "withdrawn",
        via: event.event_id,
      });
      break;
    }

    case "CRAFT_REGISTERED": {
      const id = event.aggregate_id;
      state.craftRevisions.set(id, {
        craft_revision_id: id,
        craft_code: body.craft_code,
        craft_name: body.craft_name,
        revision_no: body.revision_no,
        skill_codes: body.skill_codes ?? [],
        supersedes_revision_id: body.supersedes_revision_id ?? null,
        studio_id: body.studio_id,
        registered_event: event.event_id,
        occurred_at: event.occurred_at,
      });
      const list = state.craftCodes.get(body.craft_code) ?? [];
      list.push(id);
      state.craftCodes.set(body.craft_code, list);
      break;
    }

    case "COURSE_REVISED": {
      const id = event.aggregate_id;
      const prev = body.supersedes_offering_id
        ? state.courseOfferings.get(body.supersedes_offering_id)
        : null;
      if (prev) {
        prev.status = "superseded";
        prev.successor_offering_id = id;
      }
      state.courseOfferings.set(id, {
        course_offering_id: id,
        course_code: body.course_code ?? prev?.course_code,
        course_name: body.course_name ?? prev?.course_name,
        revision_no: body.revision_no,
        studio_id: body.studio_id ?? prev?.studio_id,
        skill_codes: body.skill_codes ?? prev?.skill_codes ?? [],
        supersedes_offering_id: body.supersedes_offering_id ?? null,
        status: body.status ?? "active",
        occurred_at: event.occurred_at,
      });
      break;
    }

    case "EVIDENCE_SUBMITTED": {
      touchLearner(state, body.learner_id);
      state.evidence.set(event.aggregate_id, {
        evidence_id: event.aggregate_id,
        event_id: event.event_id,
        learner_id: body.learner_id,
        studio_id: body.studio_id,
        evidence_kind: body.evidence_kind,
        craft_revision_id: body.craft_revision_id ?? null,
        skill_code: body.skill_code ?? null,
        course_offering_id: body.course_offering_id ?? null,
        source_classification: body.source_classification ?? null,
        observer_ids: body.observer_ids ?? [],
        witness_role: body.witness_role ?? null,
        artifact_refs: body.artifact_refs ?? [],
        sensitive_tags: body.sensitive_tags ?? [],
        quantified_result: body.quantified_result ?? null,
        attendance_id_ref: body.attendance_id_ref ?? null,
        tags: body.tags ?? [],
        innovation: body.innovation ?? null,
        submitted_at: event.occurred_at,
        amendments: [],
      });
      break;
    }

    case "EVIDENCE_AMENDED": {
      const ev = state.evidence.get(body.evidence_id ?? event.aggregate_id);
      if (ev) {
        ev.amendments.push({
          event_id: event.event_id,
          at: event.occurred_at,
          note: body.note,
          corrections: body.corrections ?? {},
        });
        // 勘误补充只追加说明；原始字段保留，corrrections 单独存放以便追溯。
      }
      break;
    }

    case "REVIEW_SIGNED": {
      touchLearner(state, body.learner_id);
      const review = {
        review_id: event.aggregate_id,
        event_id: event.event_id,
        learner_id: body.learner_id ?? null,
        studio_id: body.studio_id ?? null,
        skill_code: body.skill_code ?? null,
        craft_revision_id: body.craft_revision_id ?? null,
        decision: body.decision ?? null,
        gap_skills: body.gap_skills ?? [],
        reviewer_ids: body.reviewer_ids ?? [],
        basis_evidence_ids: body.basis_evidence_ids ?? [],
        replaces_review_id: body.replaces_review_id ?? null,
        note: body.note ?? "",
        signed_at: event.occurred_at,
      };
      state.reviews.set(review.review_id, review);
      if (review.learner_id && review.skill_code) {
        const key = `${review.learner_id}/${review.skill_code}`;
        const list = state.reviewChain.get(key) ?? [];
        list.push(review.review_id);
        state.reviewChain.set(key, list);
      }
      break;
    }

    case "CERTIFICATE_ISSUED": {
      touchLearner(state, body.learner_id);
      state.certificates.set(event.aggregate_id, {
        certificate_id: event.aggregate_id,
        certificate_code: body.certificate_code,
        learner_id: body.learner_id,
        skill_codes: body.skill_codes ?? [],
        studio_id: body.studio_id,
        issued_by_master_id: body.issued_by_master_id,
        valid_from: body.valid_from ?? event.occurred_at,
        valid_until: body.valid_until ?? null,
        status: "issued",
        reissue_of_certificate_id: body.reissue_of_certificate_id ?? null,
        replaced_by: null,
        revoke_reason: null,
        history: [{ type: "issued", event_id: event.event_id, at: event.occurred_at }],
      });
      break;
    }

    case "CERTIFICATE_REVOKED": {
      const cert = state.certificates.get(event.aggregate_id);
      if (cert) {
        cert.status = "revoked";
        cert.revoke_reason = body.revoke_reason ?? null;
        cert.history.push({ type: "revoked", event_id: event.event_id, at: event.occurred_at });
      }
      break;
    }

    case "CERTIFICATE_REISSUED": {
      touchLearner(state, body.learner_id);
      const oldId = body.reissue_of_certificate_id;
      const old = state.certificates.get(oldId);
      state.certificates.set(event.aggregate_id, {
        certificate_id: event.aggregate_id,
        certificate_code: body.certificate_code ?? old?.certificate_code,
        learner_id: body.learner_id ?? old?.learner_id,
        skill_codes: body.skill_codes ?? old?.skill_codes ?? [],
        studio_id: body.studio_id ?? old?.studio_id,
        issued_by_master_id: body.issued_by_master_id ?? old?.issued_by_master_id,
        valid_from: body.valid_from ?? event.occurred_at,
        valid_until: body.valid_until ?? old?.valid_until ?? null,
        status: "issued",
        reissue_of_certificate_id: oldId ?? null,
        replaced_by: null,
        revoke_reason: null,
        history: [
          ...(old?.history ?? []),
          { type: "reissued", event_id: event.event_id, at: event.occurred_at },
        ],
      });
      if (old) old.replaced_by = event.aggregate_id;
      break;
    }

    case "PRACTICE_ASSIGNED": {
      touchLearner(state, body.learner_id);
      const partyId = body.responsible_party_id;
      if (partyId && !state.responsibles.has(partyId))
        state.responsibles.set(partyId, {
          type: body.responsible_party_type ?? "unknown",
          status: "active",
          via: event.event_id,
        });
      state.commitments.set(event.aggregate_id, {
        commitment_id: event.aggregate_id,
        learner_id: body.learner_id,
        studio_id: body.studio_id,
        skill_codes: body.skill_codes ?? [],
        responsible_party_id: partyId,
        responsible_party_type: body.responsible_party_type ?? "unknown",
        due_by: body.due_by ?? null,
        status: "open",
        reassignments: [],
        assigned_at: event.occurred_at,
        fulfilled_at: null,
      });
      break;
    }

    case "RESPONSIBILITY_REASSIGNED": {
      const c = state.commitments.get(event.aggregate_id);
      if (!c) break;
      const to = body.reassigned_to;
      if (to && !state.responsibles.has(to))
        state.responsibles.set(to, {
          type: body.reassigned_to_type ?? "unknown",
          status: "active",
          via: event.event_id,
        });
      c.reassignments.push({
        from: body.reassigned_from ?? c.responsible_party_id,
        to,
        reason: body.reason,
        at: event.occurred_at,
        event_id: event.event_id,
      });
      c.responsible_party_id = to;
      c.responsible_party_type = body.reassigned_to_type ?? c.responsible_party_type;
      break;
    }

    case "PRACTICE_FULFILLED": {
      const c = state.commitments.get(event.aggregate_id);
      if (c) {
        c.status = "fulfilled";
        c.fulfilled_at = event.occurred_at;
        c.fulfil_note = body.note ?? "";
      }
      break;
    }

    case "CONSENT_GRANTED": {
      touchLearner(state, body.learner_id);
      state.consents.set(event.aggregate_id, {
        consent_id: event.aggregate_id,
        learner_id: body.learner_id,
        purposes: body.purposes ?? [],
        material_scope: body.material_scope ?? [],
        sensitive_materials: body.sensitive_materials ?? [],
        valid_until: body.valid_until ?? null,
        granted_at: event.occurred_at,
        withdrawn: false,
        withdrawn_at: null,
      });
      break;
    }

    case "CONSENT_WITHDRAWN": {
      const g = state.consents.get(event.aggregate_id);
      if (g) {
        g.withdrawn = true;
        g.withdrawn_at = event.occurred_at;
      }
      break;
    }

    case "PLACEMENT_TRANSFERRED": {
      const id = body.placement_id ?? event.aggregate_id;
      const prev = state.placements.get(id);
      const placement = {
        placement_id: id,
        studio_id: body.studio_id ?? prev?.studio_id,
        learner_id: body.learner_id ?? prev?.learner_id ?? null,
        required_skills: body.required_skills ?? prev?.required_skills ?? [],
        status: body.status ?? (prev?.status ?? "active"),
        reason: body.reason ?? prev?.reason ?? null,
        transferred_to_placement_id:
          body.transferred_to_placement_id ?? prev?.transferred_to_placement_id ?? null,
        updated_at: event.occurred_at,
        history: prev?.history ?? [],
      };
      placement.history.push({
        event_id: event.event_id,
        status: placement.status,
        at: event.occurred_at,
        reason: placement.reason,
      });
      state.placements.set(id, placement);
      if (placement.learner_id) touchLearner(state, placement.learner_id);
      if (body.responsible_party_type === "placement" && !state.responsibles.has(id))
        state.responsibles.set(id, { type: "placement", status: "active", via: event.event_id });
      if (placement.status === "withdrawn")
        state.responsibles.set(id, { type: "placement", status: "withdrawn", via: event.event_id });
      break;
    }

    default:
      // 未知事件类型：跳过，不报错。
      break;
  }
}

// —— 读模型便捷查询 ——

export function reviewHistory(state, learnerId, skillCode) {
  return (state.reviewChain.get(`${learnerId}/${skillCode}`) ?? [])
    .map((id) => state.reviews.get(id))
    .filter(Boolean);
}

export function latestReview(state, learnerId, skillCode) {
  const history = reviewHistory(state, learnerId, skillCode);
  return history[history.length - 1] ?? null;
}

export function evidenceForSkill(state, learnerId, skillCode) {
  return [...state.evidence.values()].filter(
    (e) => e.learner_id === learnerId && e.skill_code === skillCode
  );
}

export function validCertificatesFor(state, learnerId, asOf) {
  const t = asOf ? Date.parse(asOf) : Infinity;
  return [...state.certificates.values()].filter((c) => {
    if (c.learner_id !== learnerId) return false;
    if (c.status !== "issued" || c.replaced_by) return false;
    if (c.valid_until && Date.parse(c.valid_until) < t) return false;
    return true;
  });
}

export function skillsCoveredByCertificate(state, learnerId, asOf) {
  return new Set(validCertificatesFor(state, learnerId, asOf).flatMap((c) => c.skill_codes));
}

export function observationEvidence(state, learnerId, skillCode) {
  return evidenceForSkill(state, learnerId, skillCode).filter((e) =>
    OBSERVATION_KINDS.has(e.evidence_kind)
  );
}
