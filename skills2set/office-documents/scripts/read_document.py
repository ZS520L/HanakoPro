#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from office_common import (
    DocumentSkillError,
    attr_local,
    cell_ref_to_col_index,
    element_text,
    json_error,
    json_success,
    local_name,
    numeric_part_key,
    require_file,
    truncate_text,
    write_text_or_json,
)


def try_markitdown(path: Path) -> tuple[str | None, str | None]:
    try:
        from markitdown import MarkItDown  # type: ignore
    except Exception as exc:
        return None, f"markitdown unavailable: {exc}"

    try:
        md = MarkItDown(enable_plugins=False)
        if hasattr(md, "convert_local"):
            result = md.convert_local(str(path))
        else:
            result = md.convert(str(path))
        text = getattr(result, "text_content", None)
        if isinstance(text, str) and text.strip():
            return text, None
        return None, "markitdown returned empty content"
    except Exception as exc:
        return None, f"markitdown failed: {exc}"


def markdown_table(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    normalized = [row + [""] * (width - len(row)) for row in rows]
    escaped = [[cell.replace("|", "\\|").replace("\n", " ") for cell in row] for row in normalized]
    header = escaped[0]
    sep = ["---"] * width
    body = escaped[1:]
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join(sep) + " |",
    ]
    lines.extend("| " + " | ".join(row) + " |" for row in body)
    return "\n".join(lines)


def read_docx(path: Path) -> tuple[str, list[str], dict]:
    warnings: list[str] = []
    meta: dict = {"reader": "direct-ooxml"}
    with zipfile.ZipFile(path) as zf:
        names = set(zf.namelist())
        if "word/document.xml" not in names:
            raise DocumentSkillError("DOCX is missing word/document.xml", code="invalid_docx")
        root = ET.fromstring(zf.read("word/document.xml"))
        lines: list[str] = [f"# {path.name}", ""]
        paragraph_count = 0
        table_count = 0

        body = next((node for node in root.iter() if local_name(node.tag) == "body"), root)
        for child in list(body):
            lname = local_name(child.tag)
            if lname == "p":
                text = element_text(child).strip()
                if not text:
                    continue
                paragraph_count += 1
                style = ""
                for node in child.iter():
                    if local_name(node.tag) == "pStyle":
                        style = attr_local(node, "val", "") or ""
                        break
                if style.lower().startswith("heading"):
                    level = "".join(ch for ch in style if ch.isdigit()) or "2"
                    lines.append(f"{'#' * max(2, min(6, int(level) + 1))} {text}")
                else:
                    lines.append(text)
                lines.append("")
            elif lname == "tbl":
                table_count += 1
                rows: list[list[str]] = []
                for tr in child.iter():
                    if local_name(tr.tag) != "tr":
                        continue
                    row: list[str] = []
                    for tc in list(tr):
                        if local_name(tc.tag) == "tc":
                            row.append(element_text(tc).strip())
                    if row:
                        rows.append(row)
                if rows:
                    lines.append(f"## Table {table_count}")
                    lines.append("")
                    lines.append(markdown_table(rows))
                    lines.append("")

        comments = []
        if "word/comments.xml" in names:
            croot = ET.fromstring(zf.read("word/comments.xml"))
            for comment in croot.iter():
                if local_name(comment.tag) == "comment":
                    text = element_text(comment).strip()
                    if text:
                        author = attr_local(comment, "author", "") or ""
                        comments.append({"author": author, "text": text})
            if comments:
                lines.append("## Comments")
                lines.append("")
                for i, comment in enumerate(comments, 1):
                    prefix = f"{i}. "
                    if comment["author"]:
                        prefix += f"{comment['author']}: "
                    lines.append(prefix + comment["text"])
                lines.append("")

        media = sorted(name for name in names if name.startswith("word/media/"))
        if media:
            lines.append("## Embedded Media")
            lines.append("")
            lines.extend(f"- {name}" for name in media)
            lines.append("")

        meta.update({"paragraphs": paragraph_count, "tables": table_count, "comments": len(comments), "media": len(media)})
        return "\n".join(lines).strip() + "\n", warnings, meta


def shared_strings(zf: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    values: list[str] = []
    for si in root:
        if local_name(si.tag) != "si":
            continue
        values.append(element_text(si))
    return values


def workbook_sheets(zf: zipfile.ZipFile) -> list[tuple[str, str]]:
    rels: dict[str, str] = {}
    try:
        rel_root = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        for rel in rel_root:
            rid = rel.attrib.get("Id")
            target = rel.attrib.get("Target")
            if rid and target:
                if target.startswith("/"):
                    target = target.lstrip("/")
                elif not target.startswith("xl/"):
                    target = "xl/" + target
                rels[rid] = target
    except KeyError:
        pass

    root = ET.fromstring(zf.read("xl/workbook.xml"))
    sheets: list[tuple[str, str]] = []
    for sheet in root.iter():
        if local_name(sheet.tag) != "sheet":
            continue
        name = sheet.attrib.get("name") or f"Sheet{len(sheets) + 1}"
        rid = attr_local(sheet, "id", "")
        target = rels.get(rid or "", f"xl/worksheets/sheet{len(sheets) + 1}.xml")
        sheets.append((name, target))
    return sheets


def read_xlsx(path: Path, max_rows: int, max_cols: int) -> tuple[str, list[str], dict]:
    warnings: list[str] = []
    with zipfile.ZipFile(path) as zf:
        names = set(zf.namelist())
        if "xl/workbook.xml" not in names:
            raise DocumentSkillError("XLSX is missing xl/workbook.xml", code="invalid_xlsx")
        strings = shared_strings(zf)
        sheets = workbook_sheets(zf)
        lines = [f"# {path.name}", ""]
        sheet_meta = []
        for sheet_name, member in sheets:
            if member not in names:
                warnings.append(f"Sheet part missing: {member}")
                continue
            root = ET.fromstring(zf.read(member))
            rows_out: list[list[str]] = []
            formula_count = 0
            for row in root.iter():
                if local_name(row.tag) != "row":
                    continue
                row_index = int(row.attrib.get("r", len(rows_out) + 1))
                if row_index > max_rows:
                    continue
                values = [""] * max_cols
                for cell in list(row):
                    if local_name(cell.tag) != "c":
                        continue
                    ref = cell.attrib.get("r", "")
                    col = cell_ref_to_col_index(ref) - 1
                    if col < 0 or col >= max_cols:
                        continue
                    cell_type = cell.attrib.get("t", "")
                    value = ""
                    formula = ""
                    for part in list(cell):
                        lname = local_name(part.tag)
                        if lname == "f":
                            formula = part.text or ""
                        elif lname == "v":
                            value = part.text or ""
                        elif lname == "is":
                            value = element_text(part)
                    if formula:
                        formula_count += 1
                        display = "=" + formula
                        if value:
                            display += f" [{value}]"
                    elif cell_type == "s" and value:
                        try:
                            display = strings[int(value)]
                        except Exception:
                            display = value
                    else:
                        display = value
                    values[col] = display
                if any(values):
                    while rows_out and len(rows_out) < row_index - 1:
                        rows_out.append([""] * max_cols)
                    rows_out.append(values)
            lines.append(f"## Sheet: {sheet_name}")
            lines.append("")
            if rows_out:
                used_width = 0
                for row in rows_out:
                    for idx, value in enumerate(row):
                        if value:
                            used_width = max(used_width, idx + 1)
                used_width = max(1, used_width)
                lines.append(markdown_table([row[:used_width] for row in rows_out[:max_rows]]))
            else:
                lines.append("[Empty sheet]")
            lines.append("")
            sheet_meta.append({"name": sheet_name, "part": member, "rows_shown": len(rows_out[:max_rows]), "formulas_shown": formula_count})
        return "\n".join(lines).strip() + "\n", warnings, {"reader": "direct-ooxml", "sheets": sheet_meta}


def read_pptx(path: Path) -> tuple[str, list[str], dict]:
    warnings: list[str] = []
    with zipfile.ZipFile(path) as zf:
        names = set(zf.namelist())
        slide_names = sorted([name for name in names if name.startswith("ppt/slides/slide") and name.endswith(".xml")], key=numeric_part_key)
        if not slide_names:
            raise DocumentSkillError("PPTX has no slide XML parts.", code="invalid_pptx")
        lines = [f"# {path.name}", ""]
        for i, slide_name in enumerate(slide_names, 1):
            root = ET.fromstring(zf.read(slide_name))
            paragraphs = []
            for node in root.iter():
                if local_name(node.tag) == "p":
                    text = element_text(node).strip()
                    if text:
                        paragraphs.append(text)
            lines.append(f"## Slide {i}")
            lines.append("")
            lines.extend(f"- {text}" for text in paragraphs)
            if not paragraphs:
                lines.append("[No extracted text]")
            notes_name = f"ppt/notesSlides/notesSlide{i}.xml"
            if notes_name in names:
                nroot = ET.fromstring(zf.read(notes_name))
                notes = [element_text(node).strip() for node in nroot.iter() if local_name(node.tag) == "p" and element_text(node).strip()]
                if notes:
                    lines.append("")
                    lines.append("Notes:")
                    lines.extend(f"- {text}" for text in notes)
            lines.append("")
        return "\n".join(lines).strip() + "\n", warnings, {"reader": "direct-ooxml", "slides": len(slide_names)}


def read_pdf(path: Path) -> tuple[str, list[str], dict]:
    warnings: list[str] = []
    try:
        import pdfplumber  # type: ignore
        lines = [f"# {path.name}", ""]
        tables = 0
        with pdfplumber.open(str(path)) as pdf:
            for i, page in enumerate(pdf.pages, 1):
                text = page.extract_text() or ""
                lines.append(f"## Page {i}")
                lines.append("")
                lines.append(text.strip() or "[No extracted text]")
                try:
                    page_tables = page.extract_tables() or []
                except Exception:
                    page_tables = []
                for table in page_tables:
                    clean = [[("" if cell is None else str(cell)) for cell in row] for row in table if row]
                    if clean:
                        tables += 1
                        lines.append("")
                        lines.append(f"Table {tables}:")
                        lines.append(markdown_table(clean))
                lines.append("")
        return "\n".join(lines).strip() + "\n", warnings, {"reader": "pdfplumber", "tables": tables}
    except Exception as exc:
        warnings.append(f"pdfplumber unavailable or failed: {exc}")

    try:
        from pypdf import PdfReader  # type: ignore
        reader = PdfReader(str(path))
        lines = [f"# {path.name}", ""]
        for i, page in enumerate(reader.pages, 1):
            text = page.extract_text() or ""
            lines.append(f"## Page {i}")
            lines.append("")
            lines.append(text.strip() or "[No extracted text]")
            lines.append("")
        return "\n".join(lines).strip() + "\n", warnings, {"reader": "pypdf", "pages": len(reader.pages)}
    except Exception as exc:
        warnings.append(f"pypdf unavailable or failed: {exc}")

    raise DocumentSkillError(
        "PDF reading requires MarkItDown, pdfplumber, or pypdf.",
        code="missing_pdf_reader",
        details={"warnings": warnings},
    )


def read_document(path: Path, args: argparse.Namespace) -> dict:
    ext = path.suffix.lower()
    warnings: list[str] = []

    md_text, md_warning = try_markitdown(path)
    if md_text is not None:
        text, truncated = truncate_text(md_text, args.max_chars)
        return {
            "path": str(path),
            "format": ext.lstrip("."),
            "reader": "markitdown",
            "markdown": text,
            "warnings": ["content truncated by max-chars"] if truncated else [],
            "metadata": {},
        }
    if md_warning:
        warnings.append(md_warning)

    if ext == ".docx":
        markdown, more_warnings, metadata = read_docx(path)
    elif ext in {".xlsx", ".xlsm"}:
        markdown, more_warnings, metadata = read_xlsx(path, args.max_rows, args.max_cols)
    elif ext == ".pptx":
        markdown, more_warnings, metadata = read_pptx(path)
    elif ext == ".pdf":
        markdown, more_warnings, metadata = read_pdf(path)
    else:
        raise DocumentSkillError(f"Unsupported file extension: {ext}", code="unsupported_format")

    warnings.extend(more_warnings)
    markdown, truncated = truncate_text(markdown, args.max_chars)
    if truncated:
        warnings.append("content truncated by max-chars")
    return {
        "path": str(path),
        "format": ext.lstrip("."),
        "reader": metadata.get("reader", "fallback"),
        "markdown": markdown,
        "warnings": warnings,
        "metadata": metadata,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Read PDF, DOCX, XLSX, and PPTX files as Markdown or JSON.")
    parser.add_argument("input", help="Input document path.")
    parser.add_argument("--format", choices=["markdown", "json"], default="markdown", help="Output format.")
    parser.add_argument("--output", help="Optional output file.")
    parser.add_argument("--max-chars", type=int, default=200000, help="Maximum markdown characters to emit. 0 disables truncation.")
    parser.add_argument("--max-rows", type=int, default=80, help="Maximum rows per sheet for direct XLSX fallback.")
    parser.add_argument("--max-cols", type=int, default=30, help="Maximum columns per sheet for direct XLSX fallback.")
    args = parser.parse_args()

    try:
        path = require_file(args.input)
        result = read_document(path, args)
        if args.format == "json":
            write_text_or_json(args.output, json_success(**result))
        else:
            text = result["markdown"]
            if result["warnings"]:
                text += "\n\n## Reader Warnings\n\n" + "\n".join(f"- {w}" for w in result["warnings"]) + "\n"
            write_text_or_json(args.output, text)
        return 0
    except Exception as exc:
        write_text_or_json(args.output, json_error(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
