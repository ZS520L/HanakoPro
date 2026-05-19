#!/usr/bin/env python3
"""知识图谱构建脚本 — 从 papers.json 创建 SQLite UKG"""

import argparse
import json
import sqlite3
import sys
import os
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS papers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    doi TEXT UNIQUE,
    arxiv_id TEXT,
    year INTEGER,
    venue TEXT,
    citation_count INTEGER DEFAULT 0,
    is_oa INTEGER DEFAULT 0,
    oa_url TEXT,
    pdf_url TEXT,
    abstract TEXT,
    sources TEXT,
    ingested_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    paper_id INTEGER REFERENCES papers(id),
    description TEXT,
    source TEXT
);

CREATE TABLE IF NOT EXISTS datasets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    paper_id INTEGER REFERENCES papers(id),
    task_type TEXT,
    description TEXT
);

CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id INTEGER REFERENCES papers(id),
    method_name TEXT,
    dataset_name TEXT,
    metric_name TEXT,
    metric_value REAL,
    std_value REAL,
    baseline_name TEXT,
    is_ablation INTEGER DEFAULT 0,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS citation_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    citing_paper_id INTEGER REFERENCES papers(id),
    cited_title TEXT,
    cited_doi TEXT,
    cited_arxiv_id TEXT,
    relationship TEXT DEFAULT 'cites'
);

CREATE TABLE IF NOT EXISTS gaps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gap_type TEXT NOT NULL,
    description TEXT,
    confidence REAL DEFAULT 1.0,
    source TEXT,
    detected_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hypotheses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    statement TEXT NOT NULL,
    novelty_score REAL,
    feasibility_score REAL,
    impact_score REAL,
    gap_id INTEGER REFERENCES gaps(id),
    status TEXT DEFAULT 'candidate',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS experiments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hypothesis_id INTEGER REFERENCES hypotheses(id),
    method_name TEXT,
    dataset_name TEXT,
    status TEXT DEFAULT 'pending',
    metrics_json TEXT,
    started_at TEXT,
    finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_papers_year ON papers(year);
CREATE INDEX IF NOT EXISTS idx_papers_citations ON papers(citation_count);
CREATE INDEX IF NOT EXISTS idx_papers_doi ON papers(doi);
CREATE INDEX IF NOT EXISTS idx_results_paper ON results(paper_id);
CREATE INDEX IF NOT EXISTS idx_results_metric ON results(metric_name);
"""

def init_db(db_path):
    """初始化数据库"""
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA)
    conn.commit()
    return conn

def ingest_papers(conn, papers):
    """将论文数据导入数据库"""
    count = 0
    oa_count = 0

    for p in papers:
        try:
            conn.execute("""
                INSERT OR IGNORE INTO papers (title, doi, arxiv_id, year, venue, citation_count,
                    is_oa, oa_url, pdf_url, abstract, sources)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                p.get("title", ""),
                p.get("doi", ""),
                p.get("arxiv_id", ""),
                p.get("year", 0),
                p.get("venue", ""),
                p.get("citation_count", 0),
                1 if p.get("is_oa") else 0,
                p.get("oa_url", ""),
                p.get("pdf_url", ""),
                p.get("abstract", ""),
                ",".join(p.get("sources", [])),
            ))
            if conn.total_changes > count:
                count = conn.total_changes
                if p.get("is_oa"):
                    oa_count += 1
        except Exception as e:
            print(f"  ⚠ 入库失败: {p.get('title', '?')[:50]} — {e}", file=sys.stderr)

    conn.commit()
    return count, oa_count

def add_citation_edges(conn, papers):
    """为每篇论文添加引用边（从论文自身数据集添加基础边）"""
    cursor = conn.cursor()
    count = 0

    for p in papers:
        title = p.get("title", "")
        doi = p.get("doi", "")
        paper_id = None

        # 找到刚入库的论文 ID
        if doi:
            cursor.execute("SELECT id FROM papers WHERE doi = ?", (doi,))
            row = cursor.fetchone()
            if row:
                paper_id = row[0]
        if not paper_id and title:
            cursor.execute("SELECT id FROM papers WHERE title = ? LIMIT 1", (title,))
            row = cursor.fetchone()
            if row:
                paper_id = row[0]

        if not paper_id:
            continue

        # 自引用的引用边（基础）— 后续通过 S2 API 补充完整引用图
        conn.execute("""
            INSERT OR IGNORE INTO citation_edges (citing_paper_id, cited_title)
            VALUES (?, ?)
        """, (paper_id, title))
        count += 1

    conn.commit()
    return count

def analyze(conn):
    """分析数据库状态"""
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM papers")
    paper_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM papers WHERE is_oa = 1")
    oa_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(DISTINCT venue) FROM papers WHERE venue != ''")
    venue_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM citation_edges")
    edge_count = cursor.fetchone()[0]

    cursor.execute("""
        SELECT title, citation_count FROM papers
        ORDER BY citation_count DESC LIMIT 5
    """)
    top_papers = cursor.fetchall()

    return {
        "paper_count": paper_count,
        "oa_count": oa_count,
        "oa_ratio": f"{oa_count}/{paper_count} ({100*oa_count//max(1,paper_count)}%)",
        "venue_count": venue_count,
        "edge_count": edge_count,
        "top_papers": [{"title": t, "citations": c} for t, c in top_papers],
    }

def main():
    parser = argparse.ArgumentParser(description="知识图谱构建")
    parser.add_argument("--papers", "-p", required=True, help="papers.json 文件路径")
    parser.add_argument("--db", "-d", default="ukg.db", help="SQLite 数据库路径")
    args = parser.parse_args()

    if not os.path.exists(args.papers):
        print(f"❌ 文件不存在: {args.papers}", file=sys.stderr)
        sys.exit(1)

    print(f"\n📚 读取论文数据: {args.papers}", file=sys.stderr)
    with open(args.papers, "r", encoding="utf-8") as f:
        data = json.load(f)

    papers = data.get("papers", [])
    if isinstance(data, list):
        papers = data  # 兼容直接列表格式

    print(f"📊 论文数量: {len(papers)}", file=sys.stderr)

    print(f"🗄 初始化数据库: {args.db}", file=sys.stderr)
    conn = init_db(args.db)

    print(f"📥 写入论文...", file=sys.stderr)
    ingested, oa = ingest_papers(conn, papers)
    print(f"  入库: {ingested} 篇 (OA: {oa})", file=sys.stderr)

    print(f"🔗 建立引用边...", file=sys.stderr)
    edges = add_citation_edges(conn, papers)

    conn.commit()

    print(f"\n📊 数据库分析:", file=sys.stderr)
    stats = analyze(conn)
    print(f"  论文总数: {stats['paper_count']}", file=sys.stderr)
    print(f"  OA 比例: {stats['oa_ratio']}", file=sys.stderr)
    print(f"  Venue 数: {stats['venue_count']}", file=sys.stderr)
    print(f"\n  Top 5 高引:", file=sys.stderr)
    for tp in stats['top_papers'][:5]:
        print(f"    [{tp['citations']}] {tp['title'][:70]}", file=sys.stderr)

    conn.close()
    print(f"\n✅ UKG 构建完成: {args.db}", file=sys.stderr)

if __name__ == "__main__":
    main()
