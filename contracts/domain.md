# 非遗师承能力履历 领域约定（v0.2）

本文件在 v0.1 事件信封（`contracts/domain.schema.json`）之上，约定师承能力履历服务的对象身份、证据分类、修订复核、接续责任、用途授权与主管部门报送口径。事件类型与聚合类型的字符串代码是接入边界，**只增不改**。

## 1. 对象与事件总览

### 1.1 聚合（aggregate_type）

| 代码 | 含义 | 关键不变量 |
|---|---|---|
| `craft_revision` | 技艺/工序修订版本（如“烧麦皮二十四道褶”第 3 版） | 同一技艺代码下版本号只增；旧版本不被覆盖，供历史判定锚定 |
| `course_offering` | 课程开设批次（含停开、换师、调整） | 修订以新事件表达，不就地改历史 |
| `learning_evidence` | 一条学习证据（作品/现场观察/出勤等） | 每条证据分类唯一；出勤类永不构成合格依据 |
| `competency_review` | 师傅/评审对某学员某技能的阶段评议 | 复核追加后继意见，不删原判断 |
| `certificate_grant` | 一张能力证书 | 撤销为终态；换发有链；有效性独立于师傅在岗状态 |
| `practice_commitment` | 未完成实践的带教承诺（责任人=师傅/工作室/门店） | 责任人退出时必须改派，不得留孤儿 |
| `consent_grant` | 学员对证据材料的一次用途授权 | 按用途、按材料清单、按期限授权 |
| `placement_record` | 岗位就业衔接记录（沿用 v0.1 语义） | 岗位取消不影响已发能力凭证 |
| `studio_profile` | 工作室档案（主管视图的汇总主体） | — |

### 1.2 事件（event_type）

| 代码 | 中文名 | 聚合 |
|---|---|---|
| `CRAFT_REGISTERED` | 技艺版本登记 | craft_revision |
| `COURSE_REVISED` | 课程开设修订 | course_offering |
| `EVIDENCE_SUBMITTED` | 学习证据提交 | learning_evidence |
| `EVIDENCE_AMENDED` | 证据勘误补充 | learning_evidence |
| `REVIEW_SIGNED` | 能力评议签署 | competency_review |
| `CERTIFICATE_ISSUED` | 证书签发 | certificate_grant |
| `CERTIFICATE_REVOKED` | 证书撤销 | certificate_grant |
| `CERTIFICATE_REISSUED` | 证书换发 | certificate_grant |
| `PRACTICE_ASSIGNED` | 实践带教承诺确立 | practice_commitment |
| `RESPONSIBILITY_REASSIGNED` | 接续责任改派 | practice_commitment |
| `PRACTICE_FULFILLED` | 实践承诺履行 | practice_commitment |
| `CONSENT_GRANTED` | 材料用途授权 | consent_grant |
| `CONSENT_WITHDRAWN` | 授权撤回 | consent_grant |
| `PLACEMENT_TRANSFERRED` | 就业岗位转接 | placement_record |
| `STUDIO_REGISTERED` | 工作室登记 | studio_profile |
| `MASTER_DEPARTED` | 师傅退出登记 | studio_profile |

v0.1 已登记的 CRAFT_REGISTERED、EVIDENCE_SUBMITTED、REVIEW_SIGNED、CERTIFICATE_ISSUED、PLACEMENT_TRANSFERRED 语义不变。自 v0.2 起，新发出事件必须携带 `event_type_display`（稳定中文名）。

## 2. 领域规则

### 2.1 证据分类：到场 ≠ 合格

每条 EVIDENCE_SUBMITTED 用 `body.evidence_kind` 分类，并通过 `body.skill_code` 锚定能力、通过 `body.craft_revision_id` 锚定当时技艺版本：

```json
{
  "event_id": "ev-2026-0007",
  "event_type": "EVIDENCE_SUBMITTED",
  "event_type_display": "学习证据提交",
  "aggregate_type": "learning_evidence",
  "aggregate_id": "evd-0007",
  "occurred_at": "2026-05-18T10:20:00+08:00",
  "version": 1,
  "summary": "阿茹娜在陈师傅注视下独立完成烧麦皮二十四道褶，20 张中 18 张达标",
  "body": {
    "learner_id": "lrnr-01",
    "studio_id": "studio-huimin",
    "evidence_kind": "on_site_observation",
    "craft_revision_id": "craft-shaomai-wrapper@3",
    "skill_code": "shaomai-wrapper-24pleats",
    "observer_ids": ["mstr-chen"],
    "witness_role": "master",
    "artifact_refs": ["media/video-20260518-03.mp4"],
    "quantified_result": { "batch_size": 20, "qualified": 18 },
    "attendance_id_ref": "att-2026-0518",
    "source_classification": "master_oral_secret"
  }
}
```

| evidence_kind | 含义 | 能否支撑能力判定 |
|---|---|---|
| `attendance_record` | 单纯到场记录 | 仅作时间线佐证，**永不出现在合格依据中** |
| `practice_artifact` | 练习作品（提交即存证，不代表合格） | 需与合格评议配对 |
| `on_site_observation` | 责任人现场目击关键工序 | 能力判定的主要依据之一 |
| `stage_review` | 阶段评议所凭据的现场/作品 | 与 REVIEW_SIGNED 联动 |
| `certificate_snapshot` | 有效证书快照 | 外部凭证 |

反查“烧麦皮二十四道褶是谁现场看过”时，只有 `on_site_observation` / `stage_review` 且带合格评议的证据会进入能力链；出勤记录只回答“当天是否在场”。

### 2.2 口授诀窍、课程成果与学员创意的区分

`body.source_classification` 单值取以下之一（多属性时另以字符串数组 `body.tags` 补充）：

- `master_oral_secret`：师傅口授诀窍；材料可能涉及未公开配方，按 consent_grant 严格限用途。
- `school_course`：学校课程成果；锚定 `course_offering_id`，课程调整不溯及既往。
- `learner_innovation`：学员自己的改良创意；权益默认归学员，**未被采用的创意不进入跨工作室分享包**。
- `standard_practice`：标准工序练习。

创意采纳状态机（`body.innovation.status`）：`proposed → reviewed → adopted / rejected`。被采纳的创意通过 `adopted_in_craft_revision_id` 回链技艺版本；被否决的创意留档但展示时默认剔除。

### 2.3 复核：只追加后继意见，不抹去原判断

REVIEW_SIGNED 可对同一（学习者, 技能）多次签署，以 `body.replaces_review_id` 串成意见链：

- 无 `replaces_review_id`：初判；
- 有 `replaces_review_id`：后继意见（含复核改判），**原评议事件不删不改**，任一历史时点结论可重放还原；
- `body.decision`：`pass / conditional / fail`；`conditional` 必须给出 `gap_skills`；
- 判定锚定签署当时有效的 `skill_codes` 与 `craft_revision_ids`；技艺、课程、评议标准修订后，旧判定不自动失效。

### 2.4 证书：有效性独立于师傅与岗位

- CERTIFICATE_ISSUED / CERTIFICATE_REVOKED / CERTIFICATE_REISSUED 只描述证书本身状态；
- 证书有效性不依赖签发师傅是否在岗、门店岗位是否取消；
- `reissue_of_certificate_id` 记录换发链；`revoked` 为终态，撤销须有 `revoke_reason`；
- 岗位取消只触发 PLACEMENT_TRANSFERRED，与证书状态互不影响。

### 2.5 退出与调整：能力保留，未完成实践必须接续

| 情形 | 应发事件 | 已获得能力 | 未完成实践 |
|---|---|---|---|
| 师傅退出 | MASTER_DEPARTED + RESPONSIBILITY_REASSIGNED | 继续有效 | 其名下 open 承诺必须改派 |
| 课程停开/换师 | COURSE_REVISED + RESPONSIBILITY_REASSIGNED | 已修课程成果有效 | 未完成批次由新 offering 承接 |
| 门店岗位取消 | PLACEMENT_TRANSFERRED | 证书/评议仍可验证 | 待入职承诺改派至 status=active 的岗位 |

接续规则（读模型校验层强制执行）：

1. 每条 practice_commitment 始终持有唯一 `responsible_party_id`；
2. 责任人退出后，其名下所有 `open` 承诺必须在同批接入事件中出现对应 RESPONSIBILITY_REASSIGNED，否则报“存在孤儿实践”；
3. 已 `withdrawn` 的责任人不得再承接新承诺；
4. 改派事件携带 `reassigned_from`、`reassigned_to`、`reason`，接续链可溯。

### 2.6 按用途授权与最小化分享

consent_grant 的 CONSENT_GRANTED 事件携带：

- `purposes`：用途代码，取值 `employment_verification` / `cross_studio_showcase` / `cultural_authority_report` / `archival`；
- `material_scope`：材料清单，逐条指向 learning_evidence 的 `artifact_refs` 或聚合标识；
- `valid_until`：授权截止时间；
- `sensitive_materials`：`unpublished_recipe`（未公开配方）、`personal_image`（个人影像）、`unadopted_innovation`（未被采用的创意）。敏感类默认不进入任何分享包，除非授权显式包含；跨工作室展示只取必要材料。

分享包按用途生成（见 `src/consent.js`）：

- **跨工作室展示包**：仅被采纳创意、脱敏作品、已公开工序；
- **企业核验包**：岗位所需技能的证据链；未获该用途授权的未公开配方段以摘要替换；
- **主管报送包**：仅工作室级汇总（见 2.7）。

CONSENT_WITHDRAWN 后生成分享包一律剔除相关材料。

### 2.7 文化主管部门视图：培养与就业衔接，不做个人打卡排名

`cultural_authority_report` 读模型每工作室一行：

| 字段 | 口径 |
|---|---|
| `studio_id` / `studio_name` | 工作室 |
| `apprentice_count` | 期内有过合格评议的学员人数（去重） |
| `skill_pass_count` | 合格的（学员×技能）对数 |
| `certificate_valid_count` | 当前有效证书数 |
| `employment_match_rate` | 已就业学员中岗位所需技能具备合格证据链者占比 |
| `open_commitment_count` / `orphan_commitment_count` | 待接续实践数 / 孤儿实践数（督促接续，非个人考核） |
| `revision_count` | 技艺/课程修订次数 |
| `reassigned_party_count` | 接续改派次数 |

**不输出**出勤次数、出勤排名、个人时长榜单。出勤仅在个人证据链中作时间线佐证；报送最小粒度为工作室。

## 3. 版本与兼容约定

1. 事件类型、聚合类型字符串代码只增不改；新增事件必须携带 `event_type_display`。
2. 信封 `version` 是该聚合实例上的事件序号，从 1 起连续递增；`event_id` 全局唯一，重复追加按幂等处理。
3. v0.1 的 5 类事件、4 类聚合语义不变；历史事件无需补字段。
4. 聚合内修订一律通过新事件表达，不就地修改历史事件。
5. 读取方应容忍未知事件类型（跳过而非报错），为后续扩展留余地。

## 4. 参考实现

- `src/store.js`：append-only 事件存储、幂等与版本连续性校验。
- `src/projections.js`：事件重放读模型。
- `src/traceability.js`：岗位能力反查与学员差距分析。
- `src/governance.js`：意见链、证书状态、接续校验。
- `src/consent.js`：用途授权与最小化分享包。
- `src/metrics.js`：工作室级培养就业视图。
- `data/scenario/shaomai.json`：烧麦皮二十四道褶全链路联调样例。
