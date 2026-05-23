---
name: research-platform
description: "全自动科研平台：从论文检索、知识图谱构建、研究缺口分析、假设生成，到实验执行、论文写作、自审修正的完整科研流水线。Agent 按此 Skill 的指令自主推进研究流程。触发场景：做研究、搜论文、找研究缺口、生成假设、跑实验、写论文、文献综述、benchmark对比 / Triggers: research, literature review, paper search, hypothesis generation, run experiments, write paper, benchmark, find research gap, survey"
compatibility: "需要 Python 3.11+，依赖: requests, sqlite3（内置）。可选: docker, pdflatex, matplotlib"
metadata:
  default-enabled: true
---

# 全自动科研平台

## 核心原则

你是科研助手。你的目标不是代替研究者思考，而是把研究者从重复劳动中解放出来——搜论文、建知识图谱、找缺口、跑实验、写初稿。研究者保留所有决策权。

三条铁律：
1. **数据驱动，不编造。** 每一个声称必须有对应的实验结果或论文引用支撑。没有数据就说没有。
2. **流程透明。** 每一步做了什么、为什么这样做，随时可以向用户汇报。
3. **用户决策，你执行。** 方向选择、假设取舍、最终审阅由用户决定。你可以推荐，不能越权。

---

## 何时启用

用户提到以下任一意图时启用此 Skill：
- 搜索某领域论文、做文献综述
- 找研究缺口、生成研究假设
- 对比 benchmark、设计实验
- 写论文、修改论文
- "帮我研究一下..."、"这个方向有什么可以做的"、"搜一下最新的..."

---

## 研究流程概览

```
Phase 1: 论文检索与摄取
Phase 2: 知识图谱构建
Phase 3: 研究缺口分析
Phase 4: 假设生成
Phase 5: 实验设计与执行  [用户审核节点]
Phase 6: 论文写作
Phase 7: 自审与修正
```

每个 Phase 完成后向用户汇报结果，等待确认再进入下一 Phase。用户说"全自动"或"继续"时跳过确认。

---

## Phase 1：论文检索与摄取

### 目标
在目标领域检索论文，下载 OA 全文，提取结构化信息。

### 执行

#### Step 1.1：确认研究参数
向用户确认（如果未明确）：
- 研究领域/关键词
- 年份范围（默认 2024-2025）
- 偏好 venue（默认不限制）
- 检索深度（默认 100-300 篇）

#### Step 1.2：多源检索
运行 `scripts/search_papers.py`：
```bash
python scripts/search_papers.py --query "<关键词>" --year-start <年份> --year-end <年份> --max-results <数量> --output papers.json
```
脚本自动调用 OpenAlex（主力）+ Semantic Scholar（详情+引用）+ Serply（GS 补缺），去重后保存为 JSON。

#### Step 1.3：展示检索结果
向用户汇报：
- 检索到多少篇论文
- OA 全文可获取比例
- 按引用数 Top 5 论文
- 主要发表 venue 分布

#### Step 1.4：结构化摄取（可选，用户要求时执行）
对需要深度分析的论文，逐篇提取：方法名、数据集、baseline、指标值、超参数、局限性。脚本自动处理，结果写入 UKG。

---

## Phase 2：知识图谱构建

### 目标
将论文的结构化数据存入 SQLite 知识图谱，建立论文-方法-数据集-结果的关系网。

### 执行
运行 `scripts/build_ukg.py`：
```bash
python scripts/build_ukg.py --papers papers.json --db ukg.db
```

脚本自动创建数据库表（papers, methods, datasets, results, citations），从 papers.json 导入数据，建立引用关系边。

汇报：入库论文数、方法数、数据集数、结果条目数。

---

## Phase 3：研究缺口分析

### 目标
在 UKG 中识别尚未被充分研究的方向。

### 执行
运行 `scripts/find_gaps.py`：
```bash
python scripts/find_gaps.py --db ukg.db --output gaps.json
```

脚本执行五类缺口检测：
- 组合缺口：(方法, 问题, 数据集) 未尝试的组合
- 矛盾缺口：同一指标数值冲突
- 局限缺口：各论文 limitation 聚类
- 交叉缺口：相邻领域方法可迁移
- 尺度缺口：方法在更大/更小规模上未测试

汇报：缺口数量和详情，标注优先级。

---

## Phase 4：假设生成

### 目标
基于 UKG 和缺口，生成候选研究假设并排序。

### 执行

#### Step 4.1：生成假设池
运行 `scripts/gen_hypotheses.py`：
```bash
python scripts/gen_hypotheses.py --db ukg.db --gaps gaps.json --output hypotheses.json
```

#### Step 4.2：评分与排序
对每个假设计算：
- 新颖性分：UKG 中最接近已有工作的语义相似度（越高越不新颖）
- 可行性分：数据是否公开、算力是否足够
- 影响力分：缺口涉及论文数、引用增速

#### Step 4.3：展示候选假设
向用户展示 Top 3 假设，每条包含：
- 假设陈述
- 新颖性/可行性/影响力评分
- 因果推理链
- 主要风险
- 建议的实验验证路径

等待用户选择。

---

## Phase 5：实验设计与执行 [用户审核]

### 目标
为选定假设设计完整实验方案并执行。

### 执行

#### Step 5.1：设计实验
基于 UKG：
- 穷举相关 baseline
- 设计消融实验（组件依赖图）
- 确定评估指标和统计方法
- 预估算力和时间

向用户展示实验矩阵，确认后执行。

#### Step 5.2：执行实验
运行 `scripts/run_experiment.py`：
```bash
python scripts/run_experiment.py --hypothesis <假设编号> --db ukg.db --output-dir experiments/
```

实验在 Docker 中并行执行。每 30 分钟汇报进度（完成数、当前最佳指标、预估剩余时间）。

用户可随时：暂停、跳过某实验、追加 baseline、修改超参数。

#### Step 5.3：结果分析
所有实验完成后自动执行统计分析、因果链验证、可视化生成。汇报给用户。

---

## Phase 6：论文写作

### 目标
基于实验结果和 UKG 数据生成论文初稿。

### 执行
运行 `scripts/write_paper.py`：
```bash
python scripts/write_paper.py --db ukg.db --experiments experiments/ --template templates/paper.tex --output paper.pdf
```

生成内容：
- Title（10 个候选，标记最优）
- Abstract（四段模板，数值自动填入）
- Introduction（缺口驱动的问题动机）
- Method（UKG 方法架构描述）
- Experiments（结果表 + 分析段落 + 消融图）
- Related Work（UKG 主题聚类对比）
- Conclusion + Limitations

编译为 PDF，向用户交付。

---

## Phase 7：自审与修正

### 目标
对论文初稿进行对抗性审查，发现漏洞并修正。

### 执行
运行 `scripts/review_paper.py`：
```bash
python scripts/review_paper.py --paper paper.tex --db ukg.db --output review.md
```

审查维度：
- 是否遗漏关键 baseline
- 统计是否规范（p 值、效应量、多重比较校正）
- 声称是否有实验支撑
- Related Work 是否遗漏重要工作
- 图表标注是否清晰

逐条报告问题，用户确认后自动修正（重新运行 Phase 6）。

---

## API 密钥

API 密钥通过环境变量配置：
- OpenAlex: `OPENALEX_API_KEY`
- Semantic Scholar: `SEMANTIC_SCHOLAR_API_KEY`
- CORE: `CORE_API_KEY`
- Serply: `SERPLY_API_KEY`
- Kaggle: `KAGGLE_API_KEY`

---

## 输出文件结构

每次研究任务在工作目录下创建 `research_output/` 目录：
```
research_output/
├── papers.json           ← Phase 1 检索结果
├── ukg.db                ← Phase 2 知识图谱
├── gaps.json             ← Phase 3 缺口分析
├── hypotheses.json       ← Phase 4 假设
├── experiments/          ← Phase 5 实验结果
├── paper.pdf             ← Phase 6 论文
└── review.md             ← Phase 7 审查报告
```
