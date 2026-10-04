// 从联调事件生成只读模型样例：data/read-models/*.json
// 运行：node scripts/generate-read-models.js
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  apprenticePortfolio,
  roleGapAnalysis,
  roleRequirementTrace,
  studioCultivationSummary,
} from "../src/projections.js";
import { authorizeMaterialAccess } from "../src/validator.js";
import { CONSENT_PURPOSES, CONSENT_SCOPES } from "../src/event-catalog.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = async (p) => JSON.parse(await readFile(join(root, p), "utf8"));
const save = async (p, data) => {
  const full = join(root, p);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, `${JSON.stringify(data, null, 2)}\n`);
};

const story = await load("data/scenarios/shaomai-story.json");
const successor = await load("data/scenarios/successor-story.json");
const all = [...story, ...successor];

// 1. 岗位反查：岗位所需能力 -> 现行修订与工序要求
const roleTrace = roleRequirementTrace(all, "role-shaomai-chef");
await save("data/read-models/role-requirements.json", roleTrace);

// 2. 企业录用反查：林晓对照烧麦师傅岗位（应达到独立操作）
const linGap = roleGapAnalysis(all, "apprentice-lin", "role-shaomai-chef");
await save("data/read-models/apprentice-lin-gap.json", linGap);

// 3. 岗位取消后的赵远：岗位已取消，但已获能力仍可被其他岗位反查
const zhaoGap = roleGapAnalysis(all, "apprentice-zhao", "role-chengnan-helper");
await save("data/read-models/apprentice-zhao-gap.json", zhaoGap);

// 4. 学员视角的能力档案：证据按来源分列、有效证书、未完成实践
await save("data/read-models/apprentice-lin-portfolio.json", apprenticePortfolio(all, "apprentice-lin"));

// 5. 授权核验案例
const accessCases = [
  {
    case: "企业录用核验：林晓的练习作品影像，有 employment_verification 授权",
    request: {
      subject_id: "apprentice-lin",
      material: { category: "personal_image", ref: "evidence-lin-practice-work#photo" },
      purpose: CONSENT_PURPOSES.EMPLOYMENT_VERIFICATION,
      scope: CONSENT_SCOPES.SAME_STUDIO,
      at: "2026-08-01T09:00:00+08:00",
    },
  },
  {
    case: "跨工作室展示：同一张作品影像，已取 cross_studio 必要材料授权",
    request: {
      subject_id: "apprentice-lin",
      material: { category: "personal_image", ref: "evidence-lin-practice-work#photo" },
      purpose: CONSENT_PURPOSES.CROSS_STUDIO_DISPLAY,
      scope: CONSENT_SCOPES.CROSS_STUDIO,
      at: "2026-08-10T09:00:00+08:00",
    },
  },
  {
    case: "跨工作室展示：未被采用的压褶器创意，无跨工作室授权，应拒绝",
    request: {
      subject_id: "apprentice-lin",
      material: { category: "unused_innovation", ref: "evidence-lin-innovation#draft" },
      purpose: CONSENT_PURPOSES.CROSS_STUDIO_DISPLAY,
      scope: CONSENT_SCOPES.CROSS_STUDIO,
      at: "2026-08-10T09:00:00+08:00",
    },
  },
  {
    case: "授权到期后展示：一年期已过，应拒绝",
    request: {
      subject_id: "apprentice-lin",
      material: { category: "personal_image", ref: "evidence-lin-practice-work#photo" },
      purpose: CONSENT_PURPOSES.CROSS_STUDIO_DISPLAY,
      scope: CONSENT_SCOPES.CROSS_STUDIO,
      at: "2027-09-01T09:00:00+08:00",
    },
  },
];
await save(
  "data/read-models/material-access-cases.json",
  accessCases.map((c) => ({ case: c.case, request: c.request, decision: authorizeMaterialAccess(all, c.request) })),
);

// 6. 文化主管部门：工作室级培养—就业衔接（不含个人打卡排名）
await save("data/read-models/studio-summary.json", studioCultivationSummary(all, "studio-chenji"));

console.log("已生成 data/read-models/ 下 6 份只读模型样例");
