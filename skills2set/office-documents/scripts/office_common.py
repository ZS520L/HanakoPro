#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

for _prefix, _uri in {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
}.items():
    ET.register_namespace(_prefix, _uri)


class DocumentSkillError(Exception):
    def __init__(self, message: str, *, code: str = "error", details: dict[str, Any] | None = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details or {}


def json_success(**payload: Any) -> str:
    return json.dumps({"ok": True, **payload}, ensure_ascii=False, indent=2)


def json_error(err: Exception) -> str:
    if isinstance(err, DocumentSkillError):
        payload = {"ok": False, "error": err.message, "code": err.code}
        if err.details:
            payload["details"] = err.details
        return json.dumps(payload, ensure_ascii=False, indent=2)
    return json.dumps({"ok": False, "error": str(err), "code": "unexpected_error"}, ensure_ascii=False, indent=2)


def require_file(path: str | Path) -> Path:
    p = Path(path).expanduser().resolve()
    if not p.exists():
        raise DocumentSkillError(f"File not found: {p}", code="file_not_found")
    if not p.is_file():
        raise DocumentSkillError(f"Path is not a file: {p}", code="not_a_file")
    return p


def prepare_output(input_path: Path, output_path: str | Path) -> Path:
    out = Path(output_path).expanduser().resolve()
    if out == input_path.resolve():
        raise DocumentSkillError("Output path must differ from input path. Save edits to a new file.", code="unsafe_overwrite")
    out.parent.mkdir(parents=True, exist_ok=True)
    return out


def load_ops(path: str | Path) -> list[dict[str, Any]]:
    p = require_file(path)
    try:
      data = json.loads(p.read_text("utf-8"))
    except json.JSONDecodeError as exc:
        raise DocumentSkillError(f"Invalid JSON operations file: {exc}", code="invalid_ops") from exc
    if isinstance(data, dict) and isinstance(data.get("operations"), list):
        data = data["operations"]
    if not isinstance(data, list):
        raise DocumentSkillError("Operations JSON must be a list or an object with an operations list.", code="invalid_ops")
    for i, op in enumerate(data):
        if not isinstance(op, dict) or not isinstance(op.get("op"), str):
            raise DocumentSkillError(f"Operation at index {i} must be an object with an op string.", code="invalid_ops")
    return data


def write_text_or_json(path: str | Path | None, content: str) -> None:
    if path:
        out = Path(path).expanduser().resolve()
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(content, "utf-8")
    else:
        print(content)


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def attr_local(element: ET.Element, name: str, default: str | None = None) -> str | None:
    for key, value in element.attrib.items():
        if local_name(key) == name:
            return value
    return default


def element_text(element: ET.Element) -> str:
    parts: list[str] = []
    for node in element.iter():
        lname = local_name(node.tag)
        if lname in {"t", "delText"} and node.text:
            parts.append(node.text)
        elif lname == "tab":
            parts.append("\t")
        elif lname in {"br", "cr"}:
            parts.append("\n")
    return "".join(parts)


def text_nodes_under(element: ET.Element) -> list[ET.Element]:
    return [node for node in element.iter() if local_name(node.tag) in {"t", "delText"}]


def replace_text_in_containers(
    root: ET.Element,
    *,
    container_names: set[str],
    find: str,
    replace: str,
    max_count: int | None = None,
) -> int:
    if not find:
        raise DocumentSkillError("replace_text requires a non-empty find string.", code="invalid_operation")

    changed = 0
    remaining = max_count
    for container in root.iter():
        if local_name(container.tag) not in container_names:
            continue
        nodes = text_nodes_under(container)
        if not nodes:
            continue
        original = "".join(node.text or "" for node in nodes)
        if find not in original:
            continue
        count = -1 if remaining is None else remaining
        updated = original.replace(find, replace, count)
        delta = original.count(find) if remaining is None else min(original.count(find), remaining)
        if delta <= 0 or updated == original:
            continue
        nodes[0].text = updated
        for node in nodes[1:]:
            node.text = ""
        changed += delta
        if remaining is not None:
            remaining -= delta
            if remaining <= 0:
                break
    return changed


def read_xml_from_zip(zip_path: Path, member: str) -> ET.Element:
    with zipfile.ZipFile(zip_path) as zf:
        try:
            data = zf.read(member)
        except KeyError as exc:
            raise DocumentSkillError(f"Missing OOXML part: {member}", code="missing_part") from exc
    return ET.fromstring(data)


def write_modified_zip(input_path: Path, output_path: Path, replacements: dict[str, bytes]) -> None:
    tmp_dir = Path(tempfile.mkdtemp(prefix="office-documents-"))
    tmp_path = tmp_dir / output_path.name
    try:
        with zipfile.ZipFile(input_path, "r") as zin, zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zout:
            seen: set[str] = set()
            for info in zin.infolist():
                data = replacements.get(info.filename)
                if data is None:
                    data = zin.read(info.filename)
                zout.writestr(info, data)
                seen.add(info.filename)
            for name, data in replacements.items():
                if name not in seen:
                    zout.writestr(name, data)
        shutil.move(str(tmp_path), str(output_path))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def xml_bytes(root: ET.Element) -> bytes:
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def numeric_part_key(name: str) -> tuple[int, str]:
    match = re.search(r"(\d+)(?=\.[^.]+$)", name)
    return (int(match.group(1)) if match else 0, name)


def parse_page_spec(spec: str | int | list[int], total_pages: int) -> list[int]:
    if isinstance(spec, int):
        values = [spec]
    elif isinstance(spec, list):
        values = spec
    elif isinstance(spec, str):
        values = []
        for chunk in spec.split(","):
            chunk = chunk.strip()
            if not chunk:
                continue
            if "-" in chunk:
                start_s, end_s = chunk.split("-", 1)
                start, end = int(start_s), int(end_s)
                step = 1 if start <= end else -1
                values.extend(range(start, end + step, step))
            else:
                values.append(int(chunk))
    else:
        raise DocumentSkillError("Page spec must be an integer, list, or range string.", code="invalid_pages")

    result: list[int] = []
    for value in values:
        if value < 1 or value > total_pages:
            raise DocumentSkillError(
                f"Page {value} is out of range. Document has {total_pages} pages.",
                code="page_out_of_range",
            )
        idx = value - 1
        if idx not in result:
            result.append(idx)
    return result


def cell_ref_to_col_index(ref: str) -> int:
    letters = "".join(ch for ch in ref if ch.isalpha()).upper()
    if not letters:
        return 1
    value = 0
    for ch in letters:
        value = value * 26 + (ord(ch) - ord("A") + 1)
    return value


def truncate_text(text: str, max_chars: int) -> tuple[str, bool]:
    if max_chars <= 0 or len(text) <= max_chars:
        return text, False
    return text[:max_chars] + "\n\n[Truncated by read_document.py max-chars limit]\n", True
