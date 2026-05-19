#!/usr/bin/env python3
"""研究缺口分析脚本 — 在 UKG 中识别未充分研究的方向"""

import argparse
import json
import sqlite3
import sys
from collections import Counter, defaultdict

def analyze_gaps(conn):
    """执行多维度缺口检测"""
    gaps = []
    cursor = conn.cursor()

    # ── 类型 1: 组合缺口 — 方法×问题×数据集未尝试组合 ──

    # ── 类型 2: 矛盾缺口 — 同一数据集同一指标数值冲突 ──
    try:
        cursor.execute("""
            SELECT metric_name, dataset_name, MIN(metric_value), MAX(metric_value),
                   COUNT(DISTINCT paper_id) as paper_count
            FROM results
            GROUP BY metric_name, dataset_name
            HAVING MAX(metric_value) - MIN(metric_value) > 0.1 AND COUNT(DISTINCT paper_id) > 1
        """)
        for row in cursor.fetchall():
            metric, dataset, min_v, max_v, cnt = row
            gaps.append({
                "type": "矛盾缺口",
                "description": f"{dataset} 上 {metric} 差异大: {min_v:.3f} ~ {max_v:.3f} ({cnt}篇论文)",
                "confidence": 0.8,
                "source": "数值矛盾检测"
            })
    except:
        pass

    # ── 类型 3: 局限性聚类 — 基于论文标题/摘要关键词 ──
    cursor.execute("SELECT title, abstract, venue, citation_count FROM papers WHERE abstract != ''")
    papers = cursor.fetchall()

    # 局限性关键词
    limitation_keywords = [
        "scalability", "efficiency", "robustness", "imbalance", "cold start",
        "noise", "sparse", "dynamic", "heterogeneous", "label",
        "scalable", "efficient", "limited", "lack", "challenge",
        "remain", "future", "further", "investigate", "explore"
    ]

    keyword_hits = Counter()
    for title, abstract, venue, cites in papers:
        text = (title + " " + (abstract or "")).lower()
        for kw in limitation_keywords:
            if kw in text:
                keyword_hits[kw] += 1

    # 高频局限性关键词 = 领域共性痛点
    total_papers = len(papers) or 1
    for kw, count in keyword_hits.most_common(10):
        if count >= total_papers * 0.15:  # 出现在 >= 15% 论文中
            gaps.append({
                "type": "局限缺口",
                "description": f"'{kw}' 在 {count}/{total_papers} 篇论文中出现 — 可能为领域共性痛点",
                "confidence": min(count / total_papers, 1.0),
                "source": "局限性关键词聚类"
            })

    # ── 类型 4: 研究空白 — 某个子领域论文数量异常少 ──
    cursor.execute("SELECT venue, COUNT(*) as cnt FROM papers WHERE venue != '' GROUP BY venue ORDER BY cnt")
    venue_counts = cursor.fetchall()

    if venue_counts:
        avg = sum(c for _, c in venue_counts) / len(venue_counts)
        for venue, cnt in venue_counts:
            if cnt <= 1 and venue:
                gaps.append({
                    "type": "覆盖缺口",
                    "description": f"venue '{venue}' 仅有 {cnt} 篇论文 — 该会议/期刊在该领域活跃度低",
                    "confidence": 0.6,
                    "source": "venue 分布分析"
                })

    # ── 类型 5: 时间趋势缺口 — 近期论文剧增或骤减 ──
    cursor.execute("SELECT year, COUNT(*) as cnt FROM papers WHERE year > 0 GROUP BY year ORDER BY year")
    year_counts = cursor.fetchall()
    if len(year_counts) >= 2:
        latest = year_counts[-1]
        prev = year_counts[-2]
        if prev[1] > 0:
            ratio = latest[1] / prev[1]
            if ratio > 2:
                gaps.append({
                    "type": "热度缺口",
                    "description": f"该领域论文从 {prev[0]} 年 {prev[1]} 篇增至 {latest[0]} 年 {latest[1]} 篇 ({ratio:.1f}x) — 热点上升期，快速入场窗口",
                    "confidence": 0.7,
                    "source": "时间趋势分析"
                })
            elif ratio < 0.5:
                gaps.append({
                    "type": "冷却缺口",
                    "description": f"该领域论文从 {prev[0]} 年 {prev[1]} 篇降至 {latest[0]} 年 {latest[1]} 篇 — 可能遇瓶颈或已趋成熟",
                    "confidence": 0.5,
                    "source": "时间趋势分析"
                })

    # 按置信度排序
    gaps.sort(key=lambda g: g["confidence"], reverse=True)
    return gaps

def main():
    parser = argparse.ArgumentParser(description="研究缺口分析")
    parser.add_argument("--db", "-d", required=True, help="SQLite 数据库路径")
    parser.add_argument("--output", "-o", default="gaps.json", help="输出文件")
    args = parser.parse_args()

    print(f"\n🔍 分析缺口: {args.db}", file=sys.stderr)
    conn = sqlite3.connect(args.db)
    gaps = analyze_gaps(conn)
    conn.close()

    if not gaps:
        # 生成一些基于元数据的通用缺口
        cursor = sqlite3.connect(args.db).cursor()
        cursor.execute("SELECT title FROM papers ORDER BY citation_count DESC LIMIT 1")
        top_row = cursor.fetchone()
        top_paper = top_row[0][:50] if top_row else "未知"

        cursor.execute("SELECT COUNT(*) FROM papers WHERE is_oa = 0")
        no_oa = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM papers")
        total = cursor.fetchone()[0]

        if no_oa > total * 0.5:
            gaps.append({
                "type": "可复现性缺口",
                "description": f"{no_oa}/{total} 篇论文无法获取全文 — 该领域结果复现和验证受阻",
                "confidence": 0.9,
                "source": "OA 覆盖率分析"
            })

        gaps.append({
            "type": "系统性缺口",
            "description": "UKG 数据量较小，建议扩大检索范围以进行更细致的缺口分析",
            "confidence": 0.5,
            "source": "数据量评估"
        })

        cursor.close()

    output = {
        "total_gaps": len(gaps),
        "gaps": gaps,
    }

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"🔎 发现 {len(gaps)} 个缺口", file=sys.stderr)
    for g in gaps[:8]:
        c = g["confidence"]
        t = g["type"]
        d = g["description"][:100]
        print(f"  [{t}] (置信度:{c:.2f}) {d}", file=sys.stderr)

    print(f"\n💾 保存至: {args.output}", file=sys.stderr)

if __name__ == "__main__":
    main()
