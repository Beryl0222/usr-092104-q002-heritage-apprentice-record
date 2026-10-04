# 非遗师承能力履历

本仓库保存非遗师承能力履历的**领域词汇、事件约定、流级不变量与只读投影**，供大师工作室、学校、门店企业与文化主管部门统一对象身份、事件顺序和版本语义。

核心理念：

- **从岗位能力反查证据链**：企业按岗位所需工序，逐项回到练习作品、现场观察、阶段评议与有效证书。
- **证据按来源分列，互不混算**：师傅口授诀窍、学校课程成果、学员个人改良创意分账记录。
- **出勤不折算合格**，复核只追加后继意见，**已获能力不因师傅退出、课程调整、岗位取消而失效**。

## 目录

- `contracts/domain.schema.json`：领域事件信封、事件枚举、聚合归属与各事件 payload 结构（JSON Schema 2020-12）。
- `src/event-catalog.js`：事件目录（单一事实来源），事件→聚合归属、证据种类、授权用途等稳定枚举。
- `src/validator.js`：单事件结构校验 `validateEvent`、事件日志流级不变量 `validateEventLog`、材料访问判定 `authorizeMaterialAccess`。
- `src/projections.js`：从事件序列折叠出的只读模型（岗位反查、学员档案与缺口、工作室级汇总）。
- `data/scenarios/`：两套中文联调故事流。
- `data/read-models/`：由事件生成的只读模型样例（`npm run read-models` 可重新生成）。
- `scripts/generate-read-models.js`：只读模型生成脚本。
- `tests/`：契约一致性、流级不变量正反例与投影行为测试。

## 接入边界（不得破坏）

- 事件信封字段：`event_id` / `event_type` / `aggregate_type` / `aggregate_id` / `occurred_at` / `version` / `summary`，业务字段统一放入 `payload`。
- **事件标识只追加、不改名、不复用**；原有五个事件（`CRAFT_REGISTERED`、`EVIDENCE_SUBMITTED`、`REVIEW_SIGNED`、`CERTIFICATE_ISSUED`、`PLACEMENT_TRANSFERRED`）保持原序在前。
- `version` 为同一 `aggregate_id` 流内从 1 起的**严格连续整数**；流内 `aggregate_type` 一致、时间不倒退。

## 事件目录

| 事件 | 聚合 | 语义 |
| --- | --- | --- |
| `CRAFT_REGISTERED` / `CRAFT_REVISED` | `craft_revision` | 技艺登记与修订；修订以 `supersedes_revision_id` 串链，旧版保留可追溯 |
| `COURSE_REGISTERED` / `COURSE_REVISED` | `course` | 课程登记与调整（`supersedes_course_id`） |
| `JOB_ROLE_DEFINED` / `JOB_ROLE_CANCELLED` | `job_role` | 门店岗位及其所需工序；撤店/岗位取消 |
| `MENTORSHIP_ASSIGNED` / `MENTOR_WITHDRAWN` | `mentorship` | 师承关系建立；师傅退出 |
| `EVIDENCE_SUBMITTED` | `learning_evidence` | 证据提交，`kind` 区分五类来源 |
| `ATTENDANCE_LOGGED` | `attendance_record` | 出勤记录，**仅证明到场，永不能作为评议依据** |
| `REVIEW_SIGNED` / `REVIEW_RECONSIDERED` | `competency_review` | 阶段评议；复核以 `prior_review_id` 指向原评议，形成后继意见 |
| `CERTIFICATE_ISSUED` / `CERTIFICATE_REVOKED` | `certificate` | 能力证书签发与吊销（吊销后置于签发） |
| `PRACTICE_PLANNED` / `PRACTICE_CONTINUED` / `PRACTICE_COMPLETED` | `practice_pursuit` | 实践计划、中断后接续（新聚合）、完成 |
| `CONSENT_GRANTED` / `CONSENT_WITHDRAWN` | `consent_grant` | 敏感材料按用途/范围/时限授权与撤回 |
| `PLACEMENT_ESTABLISHED` / `PLACEMENT_TRANSFERRED` | `placement_record` | 就业安置与调动 |

### 证据种类（`kind`）

- `practice_work` 练习作品；`on_site_observation` 现场观察（**必须填 `observer_ids`，即“谁现场看过”**）；
- `oral_knack` 师傅口授诀窍；`coursework` 学校课程成果（带 `course_id`）；`innovation` 学员个人改良创意（带 `innovation_adoption`，未采用者不进入岗位能力支撑）。

## 关键领域规则（由校验器强制执行）

1. **关键工序**（工序节点 `critical` 或 `requires_on_site_observation`）判定 `competent`，必须引用覆盖该工序、写明观察者的 `on_site_observation` 证据——即“烧麦皮二十四道褶是谁现场看过”必须可查。
2. **出勤记录不得**出现在任何评议的 `based_on_evidence_ids` 中（`ATTENDANCE_USED_AS_PROOF`）。
3. **复核追加不抹除**：`REVIEW_RECONSIDERED` 必须指向存在且同一学员的原评议，且时间更晚；原判断永久保留。
4. **修订链完整无环**：工艺/课程修订的前驱必须存在、类型相符，链不得成环。证据与岗位钉在具体修订上；依据旧修订的合格结论不会自动顺延到新修订，需后继评议确认。
5. **证书基于评议**：`CERTIFICATE_ISSUED` 的 `review_ids` 必须存在且属于同一学员；未签发不得吊销。
6. **实践接续**：
   - 接续是**新聚合**（`PRACTICE_CONTINUED`），以 `predecessor_practice_id` 链接，以 `trigger_event_id` 记录触发事件（师傅退出 / 课程修订 / 岗位取消）。
   - 触发事件必须真实存在，接续时间不得早于触发；学员、工作室、工序不得漂移，新责任人**必须不同于**前任。
   - 来源已中断而实践未完成、又没有接续或完成的，报 `PRACTICE_RESPONSIBILITY_ORPHANED`。
   - **已完成实践、已签发证书不因后续变动失效**；未完成实践才要求找到新的接续责任人。
7. **授权**：未公开配方、个人影像、未被采用的创意按 `purposes`（录用核验 / 跨工作室展示 / 主管部门统计 / 公开展演）、`scope`（本工作室 / 跨工作室）、时限授权；跨工作室展示的每项材料须标注 `necessary: true`，即**只取必要材料**。授权可撤回、可设到期。

## 只读投影（师承能力履历服务的查询侧）

- `roleRequirementTrace(events, roleId)`：岗位 → 所需工序与现行修订、关键工序标记。
- `roleGapAnalysis(events, apprenticeId, roleId)`：逐工序返回支撑证据、最新结论（注明来自原评议还是后继复核）、有效证书与稳定缺口 code（`NO_REVIEW` / `NOT_YET_COMPETENT` / `CRITICAL_OBSERVATION_MISSING` / `JUDGMENT_BASED_ON_PRIOR_REVISION`），学员据此知道**距离独立操作还缺哪项证据**。
- `apprenticePortfolio(events, apprenticeId)`：证据按来源与工序分列的能力档案，含有效/已吊销证书、未完成实践。
- `studioCultivationSummary(events, studioId)`：文化主管部门视图——工作室级培养与就业衔接聚合。**只出工作室总数与结构，不产出个人出勤/打卡排名**；出勤天数单列、不并入合格；原评议与后继复核意见同时计数。
- `authorizeMaterialAccess(events, request)`：某次材料使用是否获得对应用途、范围与时限的授权。

## 样例导读

1. `data/scenarios/shaomai-story.json`（24 条事件）：技艺修订、口授诀窍与课程成果分账、关键工序现场观察、中期 developing→结业 competent 的证据补强、师傅退出后周师傅接续、证书与就业、未采用创意及两类授权、结业复核后继意见。
2. `data/scenarios/successor-story.json`（17 条事件）：课程调整与门店岗位取消两条触发线，未完成实践分别由新教师/转回工作室接续完成；岗位取消后已获能力与证书继续有效。

## 本地检查

```bash
npm test            # 23 项契约、不变量与投影测试
npm run read-models # 从联调事件重新生成 data/read-models/
```
