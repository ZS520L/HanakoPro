#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from office_common import (
    DocumentSkillError,
    json_error,
    json_success,
    load_ops,
    parse_page_spec,
    prepare_output,
    require_file,
    write_text_or_json,
)


def require_pypdf():
    try:
        from pypdf import PdfReader, PdfWriter  # type: ignore
        return PdfReader, PdfWriter
    except Exception as exc:
        raise DocumentSkillError(
            "PDF editing requires the optional dependency pypdf.",
            code="missing_dependency",
            details={"package": "pypdf", "original_error": str(exc)},
        ) from exc


def write_pdf(writer, output_path: Path) -> None:
    with output_path.open("wb") as fh:
        writer.write(fh)


def run_ops(input_path: Path, output_path: Path, ops: list[dict]) -> list[dict]:
    PdfReader, PdfWriter = require_pypdf()
    results: list[dict] = []
    current_reader = PdfReader(str(input_path))

    for idx, op in enumerate(ops, 1):
        kind = op["op"]
        writer = PdfWriter()
        if kind == "merge":
            inputs = op.get("inputs")
            if not isinstance(inputs, list) or not inputs:
                raise DocumentSkillError("merge requires a non-empty inputs list.", code="invalid_operation")
            for item in inputs:
                reader = PdfReader(str(require_file(item)))
                for page in reader.pages:
                    writer.add_page(page)
            current_reader = None
            tmp_output = output_path if idx == len(ops) else output_path.with_suffix(f".step{idx}.pdf")
            write_pdf(writer, tmp_output)
            current_reader = PdfReader(str(tmp_output))
            results.append({"op": kind, "inputs": len(inputs), "pages": len(current_reader.pages)})
            continue

        if current_reader is None:
            current_reader = PdfReader(str(input_path))
        total_pages = len(current_reader.pages)

        if kind == "rotate_pages":
            pages = parse_page_spec(op.get("pages", ""), total_pages)
            degrees = int(op.get("degrees", 0))
            if degrees % 90 != 0:
                raise DocumentSkillError("rotate_pages degrees must be a multiple of 90.", code="invalid_operation")
            for page_index, page in enumerate(current_reader.pages):
                if page_index in pages:
                    page.rotate(degrees)
                writer.add_page(page)
            results.append({"op": kind, "pages": [p + 1 for p in pages], "degrees": degrees})
        elif kind == "extract_pages":
            pages = parse_page_spec(op.get("pages", ""), total_pages)
            for page_index in pages:
                writer.add_page(current_reader.pages[page_index])
            results.append({"op": kind, "pages": [p + 1 for p in pages]})
        elif kind == "delete_pages":
            pages = set(parse_page_spec(op.get("pages", ""), total_pages))
            for page_index, page in enumerate(current_reader.pages):
                if page_index not in pages:
                    writer.add_page(page)
            results.append({"op": kind, "deleted_pages": [p + 1 for p in sorted(pages)]})
        elif kind == "set_metadata":
            metadata = op.get("metadata")
            if not isinstance(metadata, dict):
                raise DocumentSkillError("set_metadata requires a metadata object.", code="invalid_operation")
            for page in current_reader.pages:
                writer.add_page(page)
            normalized = {}
            for key, value in metadata.items():
                key_text = str(key)
                normalized[key_text if key_text.startswith("/") else "/" + key_text] = str(value)
            writer.add_metadata(normalized)
            results.append({"op": kind, "keys": sorted(normalized)})
        elif kind in {"replace_text", "edit_text"}:
            raise DocumentSkillError(
                "Arbitrary PDF text replacement is unsupported. PDF text is fixed-layout drawing content.",
                code="unsupported_operation",
            )
        else:
            raise DocumentSkillError(f"Unsupported PDF operation: {kind}", code="unsupported_operation")

        tmp_output = output_path if idx == len(ops) else output_path.with_suffix(f".step{idx}.pdf")
        write_pdf(writer, tmp_output)
        current_reader = PdfReader(str(tmp_output))

    if not ops:
        raise DocumentSkillError("No operations provided.", code="invalid_ops")
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply safe structural edits to PDF files.")
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--ops", required=True, help="JSON operations file.")
    args = parser.parse_args()

    try:
        input_path = require_file(args.input)
        output_path = prepare_output(input_path, args.output)
        if input_path.suffix.lower() != ".pdf" or output_path.suffix.lower() != ".pdf":
            raise DocumentSkillError("edit_pdf.py requires .pdf input and output paths.", code="unsupported_format")
        ops = load_ops(args.ops)
        results = run_ops(input_path, output_path, ops)
        write_text_or_json(None, json_success(input=str(input_path), output=str(output_path), operations=results))
        return 0
    except Exception as exc:
        write_text_or_json(None, json_error(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
