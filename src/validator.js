import {
  AGGREGATE_TYPES,
  CONSENT_PURPOSES,
  CONSENT_SCOPES,
  EVIDENCE_KINDS,
  EVENT_AGGREGATE,
  EVENT_TYPES,
  MATERIAL_CATEGORIES,
  PAYLOAD_REQUIRED,
  PRACTICE_SOURCES,
  SENSITIVE_CATEGORIES,
} from "./event-catalog.js";

const envelopeRequired = [
  "event_id",
  "event_type",
  "aggregate_type",
  "aggregate_id",
  "occurred_at",
  "version",
  "summary",
];

const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

// 单事件结构校验。保持历史用法：返回中文错误字符串数组，[] 表示通过。
export function validateEvent(record) {
  if (record == null || typeof record !== "object") return ["事件必须是对象"];
  const errors = envelopeRequired
    .filter((name) => !(name in record))
    .map((name) => `缺少字段：${name}`);

  if ("version" in record && (!Number.isInteger(record.version) || record.version < 1)) {
    errors.push("version 必须是正整数");
  }
  if ("event_type" in record) {
    if (!Object.values(EVENT_TYPES).includes(record.event_type)) {
      errors.push(`未知事件类型：${record.event_type}（事件标识只允许追加，不得改名复用）`);
    } else if (
      "aggregate_type" in record &&
      EVENT_AGGREGATE[record.event_type] !== record.aggregate_type
    ) {
      errors.push(
        `事件 ${record.event_type} 必须归属聚合 ${EVENT_AGGREGATE[record.event_type]}，实际为 ${record.aggregate_type}`,
      );
    }
  }
  if ("occurred_at" in record && (typeof record.occurred_at !== "string" || !isoDateTime.test(record.occurred_at))) {
    errors.push("occurred_at 必须是带时区的日期时间字符串");
  }

  const payloadRequired = PAYLOAD_REQUIRED[record.event_type];
  if (payloadRequired) {
    if (!("payload" in record) || typeof record.payload !== "object") {
      errors.push("缺少 payload 对象");
    } else {
      for (const name of payloadRequired) {
        const value = record.payload[name];
        if (value === undefined || value === null || value === "") {
          errors.push(`payload 缺少字段：${name}`);
        }
      }
      const p = record.payload;
      if ("kind" in p && !Object.values(EVIDENCE_KINDS).includes(p.kind)) {
        errors.push(`未知证据来源类型：${p.kind}`);
      }
      if ("source" in p && !Object.values(PRACTICE_SOURCES).includes(p.source)) {
        errors.push(`未知实践发起来源：${p.source}`);
      }
      if ("scope" in p && !Object.values(CONSENT_SCOPES).includes(p.scope)) {
        errors.push(`未知授权范围：${p.scope}`);
      }
      if (Array.isArray(p.purposes)) {
        for (const purpose of p.purposes) {
          if (!Object.values(CONSENT_PURPOSES).includes(purpose)) {
            errors.push(`未知授权用途：${purpose}`);
          }
        }
      }
      if (Array.isArray(p.materials)) {
        for (const m of p.materials) {
          if (!m || !Object.values(MATERIAL_CATEGORIES).includes(m.category)) {
            errors.push("授权材料必须标注有效 category");
          }
        }
      }
      if ("date" in p && !isoDate.test(p.date)) errors.push("date 必须是 YYYY-MM-DD");
      for (const name of ["produced_at", "granted_at", "issued_at", "revoked_at", "completed_at", "continued_at", "planned_at"]) {
        if (name in p && p[name] !== undefined && !isoDateTime.test(p[name])) errors.push(`${name} 格式不正确`);
      }
    }
  }
  return errors;
}

const t = (s) => Date.parse(s);

function err(code, message, eventId) {
  return { code, message, event_id: eventId ?? null };
}

// 事件日志（追加序列）的跨事件不变量校验。
// 返回 { valid, errors, warnings }；错误项含稳定 code，供接入方程序处理。
export function validateEventLog(events) {
  const errors = [];
  const warnings = [];
  const list = Array.isArray(events) ? [...events] : [];

  const byId = new Map();
  const streams = new Map(); // aggregate_id -> events in given order

  list.forEach((e, i) => {
    for (const msg of validateEvent(e)) errors.push(err("EVENT_STRUCTURE", msg, e?.event_id ?? `#${i}`));
    if (!e) return;
    if (byId.has(e.event_id)) errors.push(err("EVENT_ID_DUPLICATED", `事件标识重复：${e.event_id}`, e.event_id));
    byId.set(e.event_id, e);
    if (!streams.has(e.aggregate_id)) streams.set(e.aggregate_id, []);
    streams.get(e.aggregate_id).push(e);
  });

  const findEvent = (id) => byId.get(id);
  const streamOf = (id) => streams.get(id) ?? [];
  const latestOf = (id) => streamOf(id).at(-1);

  // —— 流内约定：版本从 1 严格连续、聚合类型一致、时间不倒退 ——
  for (const [aggId, stream] of streams) {
    const byVersion = new Map();
    for (const e of stream) {
      if (byVersion.has(e.version)) {
        errors.push(err("VERSION_DUPLICATED", `聚合 ${aggId} 的版本 ${e.version} 重复`, e.event_id));
      }
      byVersion.set(e.version, e);
      if (e.aggregate_type !== stream[0].aggregate_type) {
        errors.push(err("AGGREGATE_TYPE_DRIFT", `聚合 ${aggId} 内出现不同 aggregate_type`, e.event_id));
      }
    }
    for (let v = 1; v <= stream.length; v++) {
      if (!byVersion.has(v)) errors.push(err("VERSION_GAP", `聚合 ${aggId} 缺少版本 ${v}`, aggId));
    }
    for (let v = 2; v <= stream.length; v++) {
      const prev = byVersion.get(v - 1);
      const cur = byVersion.get(v);
      if (prev && cur && t(cur.occurred_at) < t(prev.occurred_at)) {
        errors.push(err("OCCURRED_AT_OUT_OF_ORDER", `聚合 ${aggId} 版本 ${v} 时间早于前一版本`, cur.event_id));
      }
    }
  }

  // —— 索引工艺修订与工序节点 ——
  const nodeInfo = new Map(); // node_id -> { requiresObservation }
  const craftAggregates = new Set();
  const craftSupersedes = new Map(); // 新修订 id -> 被取代修订 id
  for (const e of list) {
    if (e.event_type === EVENT_TYPES.CRAFT_REGISTERED || e.event_type === EVENT_TYPES.CRAFT_REVISED) {
      craftAggregates.add(e.aggregate_id);
      if (e.event_type === EVENT_TYPES.CRAFT_REVISED) craftSupersedes.set(e.aggregate_id, e.payload.supersedes_revision_id);
      for (const n of e.payload.craft_nodes ?? []) {
        const prev = nodeInfo.get(n.node_id) ?? { requiresObservation: false };
        nodeInfo.set(n.node_id, {
          requiresObservation: prev.requiresObservation || n.requires_on_site_observation === true || n.critical === true,
        });
      }
    }
  }
  const craftRevisionOrEqual = (newerId, olderId) => {
    let cur = newerId;
    const seen = new Set();
    while (cur) {
      if (cur === olderId) return true;
      if (seen.has(cur)) return false;
      seen.add(cur);
      cur = craftSupersedes.get(cur);
    }
    return false;
  };

  // —— 修订链：前驱必须存在，且不得成环 ——
  const revisionSpecs = [
    { eventType: EVENT_TYPES.CRAFT_REVISED, refField: "supersedes_revision_id", label: "工艺", expectedType: AGGREGATE_TYPES.CRAFT_REVISION },
    { eventType: EVENT_TYPES.COURSE_REVISED, refField: "supersedes_course_id", label: "课程", expectedType: AGGREGATE_TYPES.COURSE },
  ];
  for (const spec of revisionSpecs) {
    for (const e of list.filter((x) => x.event_type === spec.eventType)) {
      const refId = e.payload[spec.refField];
      const predecessor = streamOf(refId)[0];
      if (!predecessor || predecessor.aggregate_type !== spec.expectedType) {
        errors.push(err("REVISION_PREDECESSOR_MISSING", `${spec.label}修订的前驱不存在：${refId}`, e.event_id));
        continue;
      }
      const seen = new Set();
      let cur = e;
      while (cur) {
        if (seen.has(cur.aggregate_id)) {
          errors.push(err("REVISION_CYCLE", `${spec.label}修订链出现环路：${e.aggregate_id}`, e.event_id));
          break;
        }
        seen.add(cur.aggregate_id);
        const prevId = cur.payload?.[spec.refField];
        cur = prevId ? streamOf(prevId)[0] : null;
      }
    }
  }

  // —— 证据 ——
  const evidenceById = new Map(); // aggregate_id -> submitted event
  for (const e of list) {
    if (e.event_type !== EVENT_TYPES.EVIDENCE_SUBMITTED) continue;
    evidenceById.set(e.aggregate_id, e);
    if (!craftAggregates.has(e.payload.craft_revision_id)) {
      errors.push(err("EVIDENCE_CRAFT_MISSING", "证据引用的工艺修订不存在", e.event_id));
    }
    for (const nodeId of e.payload.node_ids ?? []) {
      if (!nodeInfo.has(nodeId)) {
        warnings.push(err("EVIDENCE_NODE_UNKNOWN", `证据引用了未登记工序：${nodeId}`, e.event_id));
      }
    }
    if (e.payload.kind === EVIDENCE_KINDS.ON_SITE_OBSERVATION) {
      if (!Array.isArray(e.payload.observer_ids) || e.payload.observer_ids.length === 0) {
        errors.push(err("OBSERVATION_WITHOUT_OBSERVER", "现场观察记录必须写明在场观察者（谁现场看过）", e.event_id));
      }
    }
  }

  // —— 阶段评议：合格判定必须有证据，关键工序须有现场观察支撑 ——
  const reviewAggregates = new Set();
  const reviewEvents = [];
  for (const e of list) {
    if (e.event_type === EVENT_TYPES.REVIEW_SIGNED || e.event_type === EVENT_TYPES.REVIEW_RECONSIDERED) {
      reviewAggregates.add(e.aggregate_id);
      reviewEvents.push(e);
    }
  }
  for (const e of reviewEvents) {
    if (e.event_type === EVENT_TYPES.REVIEW_RECONSIDERED) {
      const prior = streamOf(e.payload.prior_review_id)[0];
      if (!prior || prior.aggregate_type !== AGGREGATE_TYPES.COMPETENCY_REVIEW) {
        errors.push(err("REVIEW_PRIOR_MISSING", "复核必须指向一条原评议（原判断保留，不得抹去）", e.event_id));
      } else {
        if (prior.payload.apprentice_id !== e.payload.apprentice_id) {
          errors.push(err("REVIEW_SUBJECT_MISMATCH", "复核与原评议的学员不一致", e.event_id));
        }
        if (t(e.occurred_at) <= t(prior.occurred_at)) {
          errors.push(err("REVIEW_RECONSIDERED_BEFORE_PRIOR", "后继意见的时间必须晚于原评议", e.event_id));
        }
      }
    }
    for (const j of e.payload.judgments ?? []) {
      for (const evId of j.based_on_evidence_ids ?? []) {
        const ev = evidenceById.get(evId);
        if (!ev) {
          errors.push(err("REVIEW_EVIDENCE_MISSING", `评议依据的证据不存在：${evId}`, e.event_id));
          continue;
        }
        if (ev.payload.apprentice_id !== e.payload.apprentice_id) {
          errors.push(err("REVIEW_EVIDENCE_WRONG_SUBJECT", "评议不得引用其他学员的证据", e.event_id));
        }
      }
      if (j.conclusion === "competent" && nodeInfo.get(j.node_id)?.requiresObservation) {
        const hasOnSite = (j.based_on_evidence_ids ?? []).some((id) => {
          const ev = evidenceById.get(id);
          return (
            ev?.payload.kind === EVIDENCE_KINDS.ON_SITE_OBSERVATION &&
            (ev.payload.node_ids ?? []).includes(j.node_id)
          );
        });
        if (!hasOnSite) {
          errors.push(
            err(
              "CRITICAL_NODE_WITHOUT_ON_SITE_PROOF",
              `关键工序 ${j.node_id} 判定合格缺少现场观察证据（单纯到场不能换算成合格）`,
              e.event_id,
            ),
          );
        }
      }
    }
  }
  // 出勤永远不能充当评议依据：attendance_record 不得出现在 based_on_evidence_ids 中
  for (const e of list) {
    if (e.event_type === EVENT_TYPES.ATTENDANCE_LOGGED) {
      const referenced = reviewEvents.some((r) =>
        (r.payload.judgments ?? []).some((j) => (j.based_on_evidence_ids ?? []).includes(e.aggregate_id)),
      );
      if (referenced) {
        errors.push(err("ATTENDANCE_USED_AS_PROOF", "出勤记录不得折算为合格依据", e.event_id));
      }
    }
  }

  // —— 证书：签发须基于评议；吊销只能后置于签发 ——
  for (const [aggId, stream] of streams) {
    if (stream[0].aggregate_type !== AGGREGATE_TYPES.CERTIFICATE) continue;
    const issued = stream.find((e) => e.event_type === EVENT_TYPES.CERTIFICATE_ISSUED);
    for (const e of stream) {
      if (e.event_type === EVENT_TYPES.CERTIFICATE_ISSUED) {
        if (stream.indexOf(e) !== 0) errors.push(err("CERTIFICATE_REISSUED", "同一证书聚合不得重复签发", e.event_id));
        for (const rid of e.payload.review_ids ?? []) {
          const first = streamOf(rid)[0];
          if (!first || first.aggregate_type !== AGGREGATE_TYPES.COMPETENCY_REVIEW) {
            errors.push(err("CERTIFICATE_REVIEW_MISSING", `证书引用的评议不存在：${rid}`, e.event_id));
          } else if (first.payload.apprentice_id !== e.payload.apprentice_id) {
            errors.push(err("CERTIFICATE_REVIEW_WRONG_SUBJECT", "证书不得引用其他学员的评议", e.event_id));
          }
        }
      }
      if (e.event_type === EVENT_TYPES.CERTIFICATE_REVOKED && (!issued || stream.indexOf(e) < stream.indexOf(issued))) {
        errors.push(err("CERTIFICATE_REVOKED_WITHOUT_ISSUE", "证书须先签发才能吊销", e.event_id));
      }
    }
  }

  // —— 实践接续 ——
  const practiceStreams = new Map(); // aggregate_id -> stream
  for (const [aggId, stream] of streams) {
    if (stream[0].aggregate_type === AGGREGATE_TYPES.PRACTICE_PURSUIT) practiceStreams.set(aggId, stream);
  }
  const chainRoot = new Map(); // continuation aggregate -> root planned aggregate
  const sourceTypeOk = {
    [PRACTICE_SOURCES.MENTORSHIP]: AGGREGATE_TYPES.MENTORSHIP,
    [PRACTICE_SOURCES.COURSE]: AGGREGATE_TYPES.COURSE,
    [PRACTICE_SOURCES.PLACEMENT]: AGGREGATE_TYPES.PLACEMENT_RECORD,
  };

  function practiceHead(aggId) {
    return practiceStreams.get(aggId)?.[0];
  }
  function rootPlan(aggId) {
    let cur = aggId;
    const seen = new Set();
    while (practiceHead(cur)?.event_type === EVENT_TYPES.PRACTICE_CONTINUED) {
      if (seen.has(cur)) return null;
      seen.add(cur);
      cur = practiceHead(cur).payload.predecessor_practice_id;
    }
    return practiceHead(cur)?.event_type === EVENT_TYPES.PRACTICE_PLANNED ? practiceStreams.get(cur)[0] : null;
  }
  function chainTail(aggId) {
    // 从某实践聚合沿后继接续走到最后一个聚合
    let cur = aggId;
    const seen = new Set();
    for (;;) {
      if (seen.has(cur)) return cur;
      seen.add(cur);
      const next = [...practiceStreams.values()].find(
        (s) => s[0].event_type === EVENT_TYPES.PRACTICE_CONTINUED && s[0].payload.predecessor_practice_id === cur,
      );
      if (!next) return cur;
      cur = next[0].aggregate_id;
    }
  }

  for (const [aggId, stream] of practiceStreams) {
    const head = stream[0];
    if (head.version !== 1 || ![EVENT_TYPES.PRACTICE_PLANNED, EVENT_TYPES.PRACTICE_CONTINUED].includes(head.event_type)) {
      errors.push(err("PRACTICE_BAD_HEAD", "实践流必须以 PRACTICE_PLANNED 或 PRACTICE_CONTINUED 起始", head.event_id));
    }
    if (head.event_type === EVENT_TYPES.PRACTICE_PLANNED) {
      const expected = sourceTypeOk[head.payload.source];
      const refHead = streamOf(head.payload.source_ref)[0];
      if (!refHead || refHead.aggregate_type !== expected) {
        errors.push(err("PRACTICE_SOURCE_MISSING", `实践引用的发起来源不存在或类型不符：${head.payload.source}`, head.event_id));
      }
    }
    if (head.event_type === EVENT_TYPES.PRACTICE_CONTINUED) {
      const predStream = practiceStreams.get(head.payload.predecessor_practice_id);
      const predHead = predStream?.[0];
      if (!predHead) {
        errors.push(err("PRACTICE_PREDECESSOR_MISSING", "接续实践缺少前身实践", head.event_id));
      } else {
        const root = rootPlan(aggId);
        if (!root) {
          errors.push(err("PRACTICE_CHAIN_BROKEN", "接续链追溯不到 PRACTICE_PLANNED", head.event_id));
        } else {
          for (const field of ["apprentice_id", "studio_id", "node_id"]) {
            if (head.payload[field] !== root.payload[field]) {
              errors.push(err("PRACTICE_SUBJECT_DRIFT", `接续实践与原实践的 ${field} 不一致`, head.event_id));
            }
          }
          // 工艺可顺延到后继修订，但不得跳到不相干的修订
          if (!craftRevisionOrEqual(head.payload.craft_revision_id, root.payload.craft_revision_id)) {
            errors.push(err("PRACTICE_CRAFT_DRIFT", "接续实践的工艺修订不在原修订的后继链上", head.event_id));
          }
          // 前任责任人 = 前身聚合上最近一次责任安排，不沿后继链向前找
          const predArrangement = [...predStream]
            .reverse()
            .find((x) => [EVENT_TYPES.PRACTICE_PLANNED, EVENT_TYPES.PRACTICE_CONTINUED].includes(x.event_type));
          const predResponsible =
            predArrangement?.payload.new_responsible_person_id ?? predArrangement?.payload.responsible_person_id;
          if (predResponsible && head.payload.new_responsible_person_id === predResponsible) {
            errors.push(err("PRACTICE_SAME_RESPONSIBLE", "接续责任人必须不同于退出/调整前的责任人", head.event_id));
          }
        }
        const trigger = findEvent(head.payload.trigger_event_id);
        const allowedTriggers = [
          EVENT_TYPES.MENTOR_WITHDRAWN,
          EVENT_TYPES.COURSE_REVISED,
          EVENT_TYPES.JOB_ROLE_CANCELLED,
        ];
        if (!trigger || !allowedTriggers.includes(trigger.event_type)) {
          errors.push(err("PRACTICE_TRIGGER_INVALID", "接续必须由师傅退出、课程调整或门店岗位取消事件触发", head.event_id));
        } else if (t(head.occurred_at) < t(trigger.occurred_at) || t(head.payload.continued_at) < t(trigger.occurred_at)) {
          errors.push(err("PRACTICE_CONTINUED_BEFORE_TRIGGER", "接续时间不得早于触发事件", head.event_id));
        }
      }
    }
    const completed = stream.find((e) => e.event_type === EVENT_TYPES.PRACTICE_COMPLETED);
    if (completed) {
      if (completed !== stream.at(-1)) errors.push(err("PRACTICE_EVENT_AFTER_COMPLETION", "实践完成后不得再追加接续事件", completed.event_id));
      if (!evidenceById.has(completed.payload.evidence_id)) {
        errors.push(err("PRACTICE_EVIDENCE_MISSING", "实践完成必须关联练习/观察证据", completed.event_id));
      }
    }
  }

  // 未完成实践：责任人来源已断（师傅退出 / 课程调整 / 岗位取消）而没有后续接续或完成
  for (const [aggId, stream] of practiceStreams) {
    if (stream[0].event_type !== EVENT_TYPES.PRACTICE_PLANNED) continue;
    const tailId = chainTail(aggId);
    const tailStream = practiceStreams.get(tailId);
    const tail = tailStream[0];
    const isCompleted = tailStream.some((e) => e.event_type === EVENT_TYPES.PRACTICE_COMPLETED);
    if (isCompleted) continue;
    const tailTs = tail.payload.continued_at ?? tail.payload.planned_at;
    const handledTrigger = tail.event_type === EVENT_TYPES.PRACTICE_CONTINUED ? tail.payload.trigger_event_id : null;
    const root = stream[0];
    const disruptions = [];

    if (root.payload.source === PRACTICE_SOURCES.MENTORSHIP) {
      const last = latestOf(root.payload.source_ref);
      if (last?.event_type === EVENT_TYPES.MENTOR_WITHDRAWN && t(last.payload.effective_at) > t(tailTs)) {
        disruptions.push(last);
      }
    } else if (root.payload.source === PRACTICE_SOURCES.COURSE) {
      const last = latestOf(root.payload.source_ref);
      if (last?.event_type === EVENT_TYPES.COURSE_REVISED && t(last.occurred_at) > t(tailTs)) {
        disruptions.push(last);
      }
    } else if (root.payload.source === PRACTICE_SOURCES.PLACEMENT) {
      const placementEvents = streamOf(root.payload.source_ref);
      const roleId = [...placementEvents].reverse().find((e) => e.payload.role_id)?.payload.role_id;
      const roleLast = roleId ? latestOf(roleId) : null;
      if (!roleId) {
        warnings.push(err("PRACTICE_PLACEMENT_ROLE_UNLINKED", "门店实践未挂岗位，无法校验岗位取消后的接续", tail.event_id));
      } else if (roleLast?.event_type === EVENT_TYPES.JOB_ROLE_CANCELLED && t(roleLast.payload.cancelled_at) > t(tailTs)) {
        disruptions.push(roleLast);
      }
    }
    for (const d of disruptions) {
      if (d.event_id === handledTrigger) continue;
      errors.push(
        err(
          "PRACTICE_RESPONSIBILITY_ORPHANED",
          `未完成实践 ${tailId} 的责任来源已中断（${d.event_type}），必须指定新的接续责任人或完成实践`,
          tail.event_id,
        ),
      );
    }
  }

  // —— 授权：用途授权、跨工作室最小必要 ——
  for (const [aggId, stream] of streams) {
    if (stream[0].aggregate_type !== AGGREGATE_TYPES.CONSENT_GRANT) continue;
    const grant = stream.find((e) => e.event_type === EVENT_TYPES.CONSENT_GRANTED);
    const withdrawal = stream.find((e) => e.event_type === EVENT_TYPES.CONSENT_WITHDRAWN);
    if (!grant) {
      errors.push(err("CONSENT_WITHOUT_GRANT", "授权流必须先有 CONSENT_GRANTED", stream[0].event_id));
      continue;
    }
    if (!Array.isArray(grant.payload.purposes) || grant.payload.purposes.length === 0) {
      errors.push(err("CONSENT_PURPOSE_EMPTY", "授权必须列明用途", grant.event_id));
    }
    for (const m of grant.payload.materials ?? []) {
      if (SENSITIVE_CATEGORIES.includes(m.category) && !(grant.payload.purposes ?? []).length) {
        errors.push(err("SENSITIVE_MATERIAL_WITHOUT_PURPOSE", `敏感材料 ${m.category} 必须按用途授权`, grant.event_id));
      }
    }
    if ((grant.payload.purposes ?? []).includes(CONSENT_PURPOSES.CROSS_STUDIO_DISPLAY)) {
      if (grant.payload.scope !== CONSENT_SCOPES.CROSS_STUDIO) {
        errors.push(err("CROSS_STUDIO_SCOPE_MISSING", "跨工作室展示须取得 cross_studio 范围授权", grant.event_id));
      }
      for (const m of grant.payload.materials ?? []) {
        if (m.necessary !== true) {
          errors.push(err("CROSS_STUDIO_MATERIAL_NOT_NECESSARY", "跨工作室展示只取得必要材料，每项材料须标注 necessary: true", grant.event_id));
        }
      }
    }
    if (grant.payload.expires_at && t(grant.payload.expires_at) <= t(grant.payload.granted_at)) {
      errors.push(err("CONSENT_EXPIRY_INVALID", "授权到期时间必须晚于授权时间", grant.event_id));
    }
    if (withdrawal && t(withdrawal.payload.withdrawn_at) < t(grant.payload.granted_at)) {
      errors.push(err("CONSENT_WITHDRAWN_BEFORE_GRANT", "撤回授权时间早于授权时间", withdrawal.event_id));
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// 读模型取用的访问判定：敏感材料按用途授权；跨工作室仅可取“必要”材料。
// request: { subject_id, material: {ref, category}, purpose, scope, at }
export function authorizeMaterialAccess(events, request) {
  const { subject_id, material, purpose, scope = CONSENT_SCOPES.SAME_STUDIO, at = new Date().toISOString() } = request;
  const reasons = [];
  const sensitive = SENSITIVE_CATEGORIES.includes(material?.category);
  const crossStudio = scope === CONSENT_SCOPES.CROSS_STUDIO;

  if (!sensitive && !crossStudio && purpose === CONSENT_PURPOSES.EMPLOYMENT_VERIFICATION) {
    return { allowed: true, reasons: ["一般练习材料可在本工作室录用核验中使用"] };
  }

  const grants = [];
  for (const e of events ?? []) {
    if (e.event_type !== EVENT_TYPES.CONSENT_GRANTED || e.payload.subject_id !== subject_id) continue;
    const withdrawn = (e.aggregate_id && (events || []).some(
      (x) =>
        x.aggregate_id === e.aggregate_id &&
        x.event_type === EVENT_TYPES.CONSENT_WITHDRAWN &&
        t(x.payload.withdrawn_at) <= t(at),
    ));
    if (withdrawn) continue;
    grants.push(e);
  }

  const match = grants.find((g) => {
    const p = g.payload;
    if (!(p.purposes ?? []).includes(purpose)) return false;
    if (crossStudio && p.scope !== CONSENT_SCOPES.CROSS_STUDIO) return false;
    if (t(p.granted_at) > t(at)) return false;
    if (p.expires_at && t(p.expires_at) <= t(at)) return false;
    return (p.materials ?? []).some((m) => m.ref === material.ref && m.category === material.category);
  });

  if (!match) {
    reasons.push(sensitive ? "敏感材料缺少覆盖该用途/时限的有效授权" : "该用途缺少有效授权");
    return { allowed: false, reasons };
  }
  if (crossStudio && !(match.payload.materials ?? []).some((m) => m.ref === material.ref && m.necessary === true)) {
    return { allowed: false, reasons: ["跨工作室展示仅限必要材料，该材料未标注必要"] };
  }
  return { allowed: true, reasons: ["授权有效"] };
}
