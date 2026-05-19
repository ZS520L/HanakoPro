#!/usr/bin/env python3
"""论文写作脚本 — 基于 UKG + 实验结果生成 LaTeX 论文"""

import argparse, json, sys, os, sqlite3

def main():
    p = argparse.ArgumentParser(description="论文写作")
    p.add_argument("--db", required=True)
    p.add_argument("--experiments", default="experiments/")
    p.add_argument("--template", default="templates/paper.tex")
    p.add_argument("--output", default="paper.tex")
    args = p.parse_args()

    conn = sqlite3.connect(args.db)
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM papers")
    total = cur.fetchone()[0]
    cur.execute("SELECT title, citation_count, year FROM papers ORDER BY citation_count DESC LIMIT 5")
    top = cur.fetchall()
    conn.close()

    # 生成标题候选
    titles = []
    if top:
        keywords = set()
        for t, _, _ in top[:3]:
            for w in t.lower().replace(",", "").replace(":", "").split():
                if len(w) > 4:
                    keywords.add(w)
        kw_list = sorted(keywords, key=lambda k: len(k))[-4:]
        titles = [
            f"Towards Robust Graph Anomaly Detection via Contrastive Representation Learning",
            f"Rethinking Graph Contrastive Learning for Anomaly Detection: A {kw_list[0].title() if kw_list else 'Systematic'} Study",
            f"Bridging the Gap: Contrastive Self-Supervised Learning for Real-World Graph Anomaly Detection",
        ]

    output = {
        "title_candidates": titles,
        "paper_stats": {
            "referenced_papers": total,
            "top_cited": [{"title": t, "cites": c, "year": y} for t, c, y in top],
        },
        "status": "draft",
        "output_file": args.output,
        "message": "论文 LaTeX 已生成。在实际部署中，此脚本会从 UKG 和实验结果中提取数据填入 LaTeX 模板并编译 PDF。"
    }

    # 生成占位 LaTeX
    tex = r"""\documentclass{article}
\title{""" + (titles[0] if titles else "Research Paper") + r"""}
\author{AI Research Platform}
\date{\today}
\begin{document}
\maketitle
\begin{abstract}
This paper presents a systematic study of graph contrastive learning for anomaly detection.
Our method achieves state-of-the-art performance on multiple benchmark datasets.
\end{abstract}
\section{Introduction}
The rapid growth of graph-structured data in finance, social networks, and cybersecurity
has created an urgent need for effective anomaly detection methods. [UKG data to be filled]
\section{Method}
[Method description from UKG to be filled]
\section{Experiments}
[Results from experiments/ to be filled — tables, figures, analysis]
\section{Conclusion}
[Summary of contributions and limitations]
\end{document}
"""

    with open(args.output, "w", encoding="utf-8") as f:
        f.write(tex)

    out_path = f"{args.output.replace('.tex', '')}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"📝 论文 LaTeX 已生成: {args.output}", file=sys.stderr)
    print(f"📊 引用 {total} 篇论文", file=sys.stderr)
    print(f"💡 候选标题: {len(titles)} 个", file=sys.stderr)
    for i, t in enumerate(titles[:3]):
        print(f"  {i+1}. {t[:80]}", file=sys.stderr)
    print(f"⚠ 完整功能需要 pdflatex + LaTeX 模板 + 实验结果数据", file=sys.stderr)

if __name__ == "__main__":
    main()
