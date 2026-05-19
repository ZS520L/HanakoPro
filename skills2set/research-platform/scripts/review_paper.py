#!/usr/bin/env python3
"""自审脚本 — 对抗性审查论文，发现逻辑漏洞和实验缺陷"""

import argparse, json, sys, os, sqlite3

def main():
    p = argparse.ArgumentParser(description="论文自审")
    p.add_argument("--paper", required=True, help="论文 LaTeX 文件")
    p.add_argument("--db", default="ukg.db")
    p.add_argument("--output", default="review.md")
    args = p.parse_args()

    conn = sqlite3.connect(args.db)
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM papers")
    total = cur.fetchone()[0]
    cur.execute("SELECT title FROM papers ORDER BY citation_count DESC LIMIT 10")
    top_papers = [r[0] for r in cur.fetchall()]
    conn.close()

    # 读取论文
    paper_text = ""
    if os.path.exists(args.paper):
        with open(args.paper, "r", encoding="utf-8") as f:
            paper_text = f.read()

    issues = []

    # 检查 1: Related Work 完整性
    if top_papers:
        cited_in_paper = [tp for tp in top_papers if paper_text and tp[:30].lower() in paper_text.lower()]
        missing = len(top_papers) - len(cited_in_paper)
        if missing > 0:
            issues.append({
                "severity": "中等",
                "category": "Related Work",
                "description": f"可能遗漏 {missing} 篇高引相关工作。UKG Top 10 高引论文中有 {missing} 篇未在论文中出现。",
                "suggestion": "检查是否需要在 Related Work 中补充引用以下论文 [列出具体标题]",
                "auto_fix": True
            })

    # 检查 2: 统计报告
    if "p-value" not in paper_text.lower() and "p value" not in paper_text.lower() and "p <" not in paper_text.lower():
        issues.append({
            "severity": "高",
            "category": "统计规范",
            "description": "论文中未发现统计显著性报告（p 值）。所有主结果应附带 p 值或等效检验。",
            "suggestion": "在实验结果表中追加统计检验结果（推荐 paired t-test + Bonferroni 校正）",
            "auto_fix": False
        })

    # 检查 3: 效应量
    if "cohen" not in paper_text.lower() and "effect size" not in paper_text.lower():
        issues.append({
            "severity": "中等",
            "category": "统计规范",
            "description": "论文未报告效应量。仅有 p 值不足以评估提升的实际意义。",
            "suggestion": "追加 Cohen's d 或相对提升百分比",
            "auto_fix": True
        })

    # 检查 4: 局限性
    if "limitation" not in paper_text.lower():
        issues.append({
            "severity": "低",
            "category": "完整性",
            "description": "论文未包含 Limitations 部分。大多数审稿人期望作者诚实地讨论方法的局限性。",
            "suggestion": "在 Conclusion 中追加 Limitations 段落",
            "auto_fix": True
        })

    # 检查 5: OA 覆盖率
    cur = sqlite3.connect(args.db).cursor()
    cur.execute("SELECT COUNT(*) FROM papers WHERE is_oa=1")
    oa = cur.fetchone()[0]
    if oa < total * 0.3:
        issues.append({
            "severity": "低",
            "category": "可复现性",
            "description": f"仅 {oa}/{total} 篇引用论文可获取全文（OA）。建议在论文中讨论复现限制。",
            "suggestion": "明确标注哪些 baseline 结果来自原始论文报告值而非复现值",
            "auto_fix": True
        })

    # 生成报告
    report = [
        "# 论文审查报告",
        "",
        f"## 总览",
        f"- 发现 {len(issues)} 个问题",
        f"- 高严重度: {sum(1 for i in issues if i['severity']=='高')} 个",
        f"- 中等严重度: {sum(1 for i in issues if i['severity']=='中等')} 个",
        f"- 低严重度: {sum(1 for i in issues if i['severity']=='低')} 个",
        f"- 可自动修正: {sum(1 for i in issues if i['auto_fix'])} 个",
        "",
    ]

    for i, issue in enumerate(issues):
        report.append(f"## 问题 {i+1} [{issue['severity']}] {issue['category']}")
        report.append(f"**描述:** {issue['description']}")
        report.append(f"**建议:** {issue['suggestion']}")
        report.append(f"**自动修正:** {'是' if issue['auto_fix'] else '否'}")
        report.append("")

    md = "\n".join(report)
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(md)

    out_json = args.output.replace(".md", ".json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump({"issues": issues, "total": len(issues)}, f, ensure_ascii=False, indent=2)

    print(f"🔍 审查完成: {len(issues)} 个问题", file=sys.stderr)
    for i, issue in enumerate(issues):
        print(f"  {i+1}. [{issue['severity']}] {issue['category']}: {issue['description'][:80]}", file=sys.stderr)
    print(f"\n📄 报告: {args.output}", file=sys.stderr)

if __name__ == "__main__":
    main()
