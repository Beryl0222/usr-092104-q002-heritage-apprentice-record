# 非遗师承能力履历

本仓库保存非遗师承能力履历的领域词汇、事件约定与参考服务，供街区非遗人才平台、用工企业、工作室与文化主管部门统一对象身份、事件顺序和版本语义。

## 解决的问题

- 企业只有出勤和结业结论，无法判断**烧麦皮二十四道褶等关键工序是谁现场看过**；
- 分不清**师傅口授诀窍、学校课程成果、学员改良创意**；
- 技艺、课程、评议都会修订，复核要形成**后继意见而不能抹去原判断**；
- **单纯到场不能换算成合格**；
- 师傅退出、课程调整、门店岗位取消时，**已获得能力继续有效，未完成实践必须找到新的接续责任人**；
- 未公开配方、个人影像、未被采用创意**按用途授权**，跨工作室展示只取必要材料；
- 主管部门要看各工作室**培养与就业衔接**，但师承质量不能压成个人打卡排名。

## 目录

- `contracts/domain.schema.json`：领域事件信封与稳定枚举（v0.1 兼容，v0.2 只增扩展）。
- `contracts/domain.md`：领域规则——证据分类、来源区分、复核意见链、证书有效性、接续责任、用途授权、主管视图口径。
- `src/`：零依赖参考实现。
  - `constants.js` 事件/聚合/枚举代码（接入边界）
  - `validator.js` 信封校验（`validateEvent` v0.1 语义不变，`validateEnvelope` v0.2 完整校验）
  - `store.js` append-only 存储（event_id 幂等、聚合 version 连续）
  - `projections.js` 事件重放读模型（支持 asOf 历史时点重放）
  - `traceability.js` 岗位能力反查、证据链、学员差距分析
  - `governance.js` 复核意见链、证书时间线、接续责任审计
  - `consent.js` 用途授权、企业核验包、跨工作室最小化展示包
  - `metrics.js` 工作室级培养就业视图（不提供个人出勤排名）
  - `index.js` 统一出口
- `data/sample.json`：v0.1 中文联调样例（保持可用）。
- `data/scenario/shaomai.json`：烧麦皮二十四道褶全链路样例（40 个事件）。
- `examples/demo.mjs`：端到端演示。
- `tests/`：契约与领域行为测试（30 个）。

## 核心对象与事件

聚合：`craft_revision`、`course_offering`、`learning_evidence`、`competency_review`、`certificate_grant`、`practice_commitment`、`consent_grant`、`placement_record`、`studio_profile`。

事件：v0.1 的 `CRAFT_REGISTERED`、`EVIDENCE_SUBMITTED`、`REVIEW_SIGNED`、`CERTIFICATE_ISSUED`、`PLACEMENT_TRANSFERRED` 语义冻结；v0.2 新增 `STUDIO_REGISTERED`、`MASTER_DEPARTED`、`COURSE_REVISED`、`EVIDENCE_AMENDED`、`CERTIFICATE_REVOKED`、`CERTIFICATE_REISSUED`、`PRACTICE_ASSIGNED`、`RESPONSIBILITY_REASSIGNED`、`PRACTICE_FULFILLED`、`CONSENT_GRANTED`、`CONSENT_WITHDRAWN`。

字符串代码只增不改；新事件必须携带 `event_type_display`（稳定中文名）；读取方容忍未知事件类型。

## 使用示例

```js
import { EventStore, buildState, reverseLookupByJob, learnerGapAnalysis } from "./src/index.js";

const store = new EventStore();
store.append(events);                 // 幂等、校验信封与版本连续性
const state = buildState(store.replay());

// 企业：岗位所需能力 → 练习作品 / 现场观察 / 评议 / 有效证书
const traces = reverseLookupByJob(state, {
  learner_id: "lrnr-aruna",
  required_skills: ["shaomai-wrapper-24pleats", "shaomai-filling-sealing"],
});

// 学员：距离独立操作还缺哪项证据
const gaps = learnerGapAnalysis(state, "lrnr-batu", ["shaomai-wrapper-24pleats"]);
```

历史时点重放（还原复核前结论）：`buildState(events, { asOf: "2026-05-21T00:00:00+08:00" })`。

## 本地检查与演示

```bash
npm test          # 30 个契约/领域行为测试
node examples/demo.mjs
```
