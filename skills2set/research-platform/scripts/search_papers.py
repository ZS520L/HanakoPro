#!/usr/bin/env python3
"""论文检索脚本 — 多源检索 + 去重 + 保存 JSON"""

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime

# ── API 配置 ──────────────────────────────────────────
OPENALEX_KEY = "cPDRpQpmBL6N4qsOSDbsnO"
S2_KEY = "s2k-yckUDENda9pMhtrh1pkh6fzppT6liadLC1iTJ4N"
SERPLY_KEY = "wz1SopTskmZF9VaiTxKHMv37"
CORE_KEY = "ckGZyT7I5QranpfVAeg8Lt2KwHq6vE9X"

# ── 工具函数 ──────────────────────────────────────────

def http_get(url, headers=None, timeout=15):
    """发起 HTTP GET 请求"""
    req = urllib.request.Request(url)
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"  ⚠ 请求失败: {e}", file=sys.stderr)
        return None

def http_get_raw(url, headers=None, timeout=15):
    """发起 HTTP GET 请求，返回原始字节"""
    req = urllib.request.Request(url)
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except Exception as e:
        print(f"  ⚠ 请求失败: {e}", file=sys.stderr)
        return None

def safe_get(obj, *keys, default=""):
    """安全获取嵌套字典字段，任一中间值为 None 则返回默认值"""
    for key in keys:
        if obj is None:
            return default
        obj = obj.get(key) if isinstance(obj, dict) else default
    return obj if obj is not None else default

def extract_id(paper):
    """从论文记录中提取规范化 ID（DOI 或 arXiv ID）"""
    doi = paper.get("doi", "")
    if doi:
        doi = doi.replace("https://doi.org/", "").strip()
        if doi:
            return ("doi", doi.lower())
    arxiv = paper.get("arxiv_id", "")
    if arxiv:
        return ("arxiv", arxiv.strip())
    return (None, paper.get("title", "")[:80].lower())

# ── 检索源 ────────────────────────────────────────────

def search_openalex(query, year_start, year_end, max_results):
    """OpenAlex 检索"""
    print(f"[OpenAlex] 检索中...", file=sys.stderr)
    papers = []
    page = 1
    per_page = min(max_results, 100)

    while len(papers) < max_results:
        filter_str = f"publication_year:{year_start}-{year_end}"
        params = {
            "search": query,
            "filter": filter_str,
            "per_page": per_page,
            "page": page,
            "api_key": OPENALEX_KEY,
        }
        url = f"https://api.openalex.org/works?{urllib.parse.urlencode(params)}"

        data = http_get(url, timeout=30)
        if not data or "results" not in data:
            break

        for r in data["results"]:
            doi = r.get("doi", "").replace("https://doi.org/", "")
            arxiv_id = ""
            primary = r.get("primary_location", {})
            landing = primary.get("landing_page_url", "")
            if "arxiv.org" in landing:
                try:
                    arxiv_id = landing.split("/")[-1].replace("v1", "").replace("v2", "")
                except:
                    pass
            # 从 locations 中找 arXiv
            if not arxiv_id:
                for loc in r.get("locations", []):
                    lurl = loc.get("landing_page_url", "")
                    if "arxiv.org" in lurl:
                        try:
                            arxiv_id = lurl.split("/")[-1].replace("v1", "").replace("v2", "")
                        except:
                            pass
                        break

            is_oa = safe_get(r, "open_access", "is_oa", default=False)
            oa_url = safe_get(r, "open_access", "oa_url")
            content_pdf = safe_get(r, "content_urls", "pdf")

            papers.append({
                "title": r.get("title", ""),
                "doi": doi,
                "arxiv_id": arxiv_id,
                "year": r.get("publication_year", 0),
                "venue": safe_get(r, "primary_location", "source", "display_name"),
                "citation_count": r.get("cited_by_count", 0),
                "is_oa": is_oa,
                "oa_url": oa_url,
                "pdf_url": content_pdf or oa_url,
                "abstract": "",  # OpenAlex 返回 inverted index，此处暂不重建
                "authors": [safe_get(a, "author", "display_name") for a in r.get("authorships") or []],
                "source": "openalex",
                "openalex_id": r.get("id", ""),
            })

        count = data["meta"].get("count", 0)
        print(f"  OpenAlex 命中 {count} 篇，已获取 {len(papers)}", file=sys.stderr)
        if len(data["results"]) < per_page:
            break
        page += 1
        time.sleep(0.1)

    return papers

def search_semanticscholar(query, year_start, year_end, max_results):
    """Semantic Scholar 检索"""
    print(f"[Semantic Scholar] 检索中...", file=sys.stderr)
    papers = []
    offset = 0
    limit = min(max_results, 100)

    while len(papers) < max_results:
        url = f"https://api.semanticscholar.org/graph/v1/paper/search?query={urllib.parse.quote(query)}&limit={limit}&offset={offset}&year={year_start}-{year_end}&fields=title,externalIds,citationCount,year,openAccessPdf,abstract"
        headers = {"x-api-key": S2_KEY}

        data = http_get(url, headers)
        if not data or "data" not in data:
            break

        for r in data["data"]:
            ext = r.get("externalIds") or {}
            arxiv_id = ext.get("ArXiv", "")
            doi = ext.get("DOI", "")
            pdf_info = r.get("openAccessPdf") or {}

            papers.append({
                "title": r.get("title", ""),
                "doi": doi,
                "arxiv_id": arxiv_id,
                "year": r.get("year", 0),
                "venue": ext.get("venue", ""),
                "citation_count": r.get("citationCount", 0),
                "is_oa": bool(pdf_info.get("url")),
                "oa_url": pdf_info.get("url", ""),
                "pdf_url": pdf_info.get("url", ""),
                "abstract": r.get("abstract", ""),
                "authors": [],
                "source": "semanticscholar",
                "s2_id": r.get("paperId", ""),
            })

        total = data.get("total", 0)
        print(f"  S2 命中 {total} 篇，已获取 {len(papers)}", file=sys.stderr)
        if offset + limit >= total:
            break
        offset += limit
        time.sleep(1.1)  # S2 1 RPS 限制

    return papers

def search_serply(query, max_results):
    """Serply (Google Scholar 代理) 检索"""
    print(f"[Serply/GS] 检索中...", file=sys.stderr)
    papers = []
    url = f"https://api.serply.io/v1/scholar/q={urllib.parse.quote(query)}"
    headers = {"X-Api-Key": SERPLY_KEY}

    data = http_get(url, headers)
    if not data or "articles" not in data:
        return papers

    for r in data["articles"][:max_results]:
        title = r.get("title", "")
        desc = r.get("description", "")
        cite_count = 0
        extras = r.get("extras", {}) or {}
        cite_str = extras.get("citations", {}).get("count", "0")
        try:
            cite_count = int(cite_str.replace("Cited by ", "").strip())
        except:
            pass
        pdf_url = r.get("doc", {}).get("link", "") if r.get("doc") else ""

        papers.append({
            "title": title,
            "doi": "",
            "arxiv_id": "",
            "year": 0,
            "venue": "",
            "citation_count": cite_count,
            "is_oa": bool(pdf_url),
            "oa_url": pdf_url,
            "pdf_url": pdf_url,
            "abstract": desc,
            "authors": [],
            "source": "serply_gs",
            "gs_id": r.get("id", ""),
        })

    print(f"  GS 获取 {len(papers)} 篇", file=sys.stderr)
    return papers

# ── 去重合并 ──────────────────────────────────────────

def deduplicate(all_papers):
    """按 DOI > arXiv ID > 标题 去重，保留最完整记录"""
    seen = {}
    for p in all_papers:
        id_type, id_val = extract_id(p)
        if id_type and id_val and id_val not in seen:
            seen[id_val] = p
        elif not id_type:
            # 标题模糊匹配去重
            title_key = id_val
            if title_key not in seen:
                seen[title_key] = p
            else:
                # 保留引用数更高的
                if p.get("citation_count", 0) > seen[title_key].get("citation_count", 0):
                    seen[title_key] = p

    # 合并同一条论文的不同来源信息
    merged = []
    doi_map = {}
    for key, p in seen.items():
        doi = p.get("doi", "")
        if doi and doi in doi_map:
            existing = doi_map[doi]
            # 合并字段
            for field in ["abstract", "arxiv_id", "oa_url", "pdf_url"]:
                if not existing.get(field) and p.get(field):
                    existing[field] = p[field]
            existing["sources"] = existing.get("sources", []) + [p["source"]]
        else:
            p["sources"] = [p["source"]]
            if doi:
                doi_map[doi] = p
            merged.append(p)

    # 按引用数排序
    merged.sort(key=lambda x: x.get("citation_count", 0), reverse=True)
    return merged

# ── 主函数 ────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="多源论文检索")
    parser.add_argument("--query", "-q", required=True, help="检索关键词")
    parser.add_argument("--year-start", type=int, default=2024, help="起始年份")
    parser.add_argument("--year-end", type=int, default=2025, help="结束年份")
    parser.add_argument("--max-results", type=int, default=100, help="最大结果数")
    parser.add_argument("--output", "-o", default="papers.json", help="输出文件")
    parser.add_argument("--sources", default="openalex,s2,serply", help="检索源，逗号分隔")
    args = parser.parse_args()

    sources = [s.strip() for s in args.sources.split(",")]

    print(f"\n🔍 检索: {args.query}", file=sys.stderr)
    print(f"📅 年份: {args.year_start}-{args.year_end}", file=sys.stderr)
    print(f"📊 目标: {args.max_results} 篇", file=sys.stderr)
    print(f"📡 来源: {', '.join(sources)}\n", file=sys.stderr)

    all_papers = []

    if "openalex" in sources:
        papers = search_openalex(args.query, args.year_start, args.year_end, args.max_results)
        all_papers.extend(papers)

    if "s2" in sources:
        papers = search_semanticscholar(args.query, args.year_start, args.year_end, args.max_results)
        all_papers.extend(papers)

    if "serply" in sources:
        papers = search_serply(args.query, min(args.max_results, 30))
        all_papers.extend(papers)

    # 去重
    unique = deduplicate(all_papers)
    unique = unique[:args.max_results]

    # 统计
    oa_count = sum(1 for p in unique if p.get("is_oa"))
    has_doi = sum(1 for p in unique if p.get("doi"))
    has_arxiv = sum(1 for p in unique if p.get("arxiv_id"))

    # 保存
    output = {
        "query": args.query,
        "year_range": [args.year_start, args.year_end],
        "timestamp": datetime.now().isoformat(),
        "total_found": len(unique),
        "oa_count": oa_count,
        "oa_ratio": f"{oa_count}/{len(unique)} ({100*oa_count//max(1,len(unique))}%)",
        "has_doi": has_doi,
        "has_arxiv": has_arxiv,
        "papers": unique,
    }

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n✅ 检索完成", file=sys.stderr)
    print(f"📄 去重后: {len(unique)} 篇", file=sys.stderr)
    print(f"📖 OA 全文: {oa_count}/{len(unique)} ({100*oa_count//max(1,len(unique))}%)", file=sys.stderr)
    print(f"🏷 DOI: {has_doi} 篇 | arXiv: {has_arxiv} 篇", file=sys.stderr)
    print(f"💾 保存至: {args.output}\n", file=sys.stderr)

    # 打印 Top 5
    print("=" * 60, file=sys.stderr)
    print("📋 Top 5 高引论文:", file=sys.stderr)
    for i, p in enumerate(unique[:5]):
        title = p["title"][:80]
        cites = p.get("citation_count", 0)
        yr = p.get("year", "?")
        oa = "🔓" if p.get("is_oa") else "🔒"
        print(f"  {i+1}. {oa} [{yr}] {title} (引用: {cites})", file=sys.stderr)
    print("=" * 60, file=sys.stderr)

if __name__ == "__main__":
    main()
