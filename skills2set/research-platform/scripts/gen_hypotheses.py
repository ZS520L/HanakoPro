#!/usr/bin/env python3
"""假设生成脚本 — 基于 UKG 和缺口生成候选研究假设"""

import argparse
import json
import sqlite3
import sys

def generate_hypotheses(db_path, gaps_path):
    """基于缺口生成假设"""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # 读取缺口
    with open(gaps_path, "r", encoding="utf-8") as f:
        gaps_data = json.load(f)
    gaps = gaps_data.get("gaps", [])

    # 读取 UKG 中最高引论文作为参考
    cursor.execute("SELECT title, venue FROM papers ORDER BY citation_count DESC LIMIT 3")
    top_papers = cursor.fetchall()

    cursor.execute("SELECT COUNT(*) FROM papers WHERE is_oa=1")
    oa_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM papers")
    total = cursor.fetchone()[0]

    conn.close()

    hypotheses = []

    # 基于热度缺口生成假设
    hot_gaps = [g for g in gaps if g["type"] == "热度缺口"]
    if hot_gaps:
        hypotheses.append({
            "statement": "该领域处于快速上升期（论文增速 2x+），建议优先选择 2025 年最新方法作为 baseline，重点关注被忽视的子问题（如动态图、异构图）",
            "novelty_score": 0.75,
            "feasibility_score": 0.85,
            "impact_score": 0.82,
            "rationale": "热点上升期意味着：(1) 竞争尚未白热化；(2) 很多子方向还未被充分探索；(3) 发表窗口充裕",
            "risk": "热点可能消退或转向，需持续监控",
            "suggested_action": "聚焦一个尚未被顶级 venue 覆盖的子方向，快速出探针结果"
        })

    # 基于覆盖缺口生成假设
    coverage_gaps = [g for g in gaps if g["type"] == "覆盖缺口"]
    if coverage_gaps:
        # 找一个有趣的方向
        venues = [g["description"].split("'")[1] if "'" in g["description"] else "unknown" for g in coverage_gaps[:3]]
        hypotheses.append({
            "statement": f"多个 venue（{', '.join(venues[:2])}等）在该领域仅有 1 篇论文，说明该领域与这些 venue 的 scope 存在交叉但未被充分开发",
            "novelty_score": 0.70,
            "feasibility_score": 0.80,
            "impact_score": 0.65,
            "rationale": "跨 venue 覆盖低意味着：同一工作在不同社区视角下可能有不同解读，存在跨社区创新空间",
            "risk": "某些 venue 可能本身就不太发表该主题的论文",
            "suggested_action": "选择 1-2 个相邻 venue 的目标，设计符合它们审稿偏好的实验方案"
        })

    # 通用假设
    if oa_count < total * 0.5:
        hypotheses.append({
            "statement": f"该领域 OA 覆盖率低（{oa_count}/{total}），建议优先复现和对比已有 OA 方法的公开结果，系统性验证声称",
            "novelty_score": 0.60,
            "feasibility_score": 0.95,
            "impact_score": 0.70,
            "rationale": "低 OA 覆盖率 → 结果不可验证 → 存在系统性偏差风险。一份独立的可复现性验证本身就是有价值的贡献",
            "risk": "纯验证性工作可能被认为 novelty 不足",
            "suggested_action": "选择 10-15 篇高引 OA 论文，系统对比其声称结果和复现结果"
        })

    return hypotheses

def main():
    parser = argparse.ArgumentParser(description="假设生成")
    parser.add_argument("--db", "-d", required=True, help="SQLite 数据库路径")
    parser.add_argument("--gaps", "-g", default="gaps.json", help="缺口 JSON 文件")
    parser.add_argument("--output", "-o", default="hypotheses.json", help="输出文件")
    args = parser.parse_args()

    print(f"\n🧠 生成假设...", file=sys.stderr)
    hypotheses = generate_hypotheses(args.db, args.gaps)

    output = {"hypotheses": hypotheses, "count": len(hypotheses)}

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"💡 生成 {len(hypotheses)} 个假设:", file=sys.stderr)
    for i, h in enumerate(hypotheses):
        scores = f"N:{h['novelty_score']:.2f} F:{h['feasibility_score']:.2f} I:{h['impact_score']:.2f}"
        print(f"  {i+1}. [{scores}] {h['statement'][:90]}", file=sys.stderr)

    print(f"\n💾 保存至: {args.output}", file=sys.stderr)

if __name__ == "__main__":
    main()
