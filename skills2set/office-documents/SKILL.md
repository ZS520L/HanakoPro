---
name: office-documents
description: "Use when the user asks to open, read, inspect, understand, summarize, analyze, extract tables/text from, modify, update, repair, split, merge, rotate, or convert information from PDF, DOCX, XLSX, XLSM, or PPTX files, including when they mention Word, Excel, PowerPoint, spreadsheet, presentation, Office document, or PDF in passing. 读取或修改 PDF、Word、Excel、PPT 文件时必须使用。"
compatibility: "Uses bundled Python scripts. Optional libraries improve coverage: markitdown, python-docx, openpyxl, python-pptx, pdfplumber, pypdf. No OfficeCLI, Microsoft Office, LibreOffice, or GUI viewer is required."
metadata:
  default-enabled: true
---

# Office Documents

Use this skill for document files, not for building an Office viewer. The goal is to let the agent understand and safely modify files through deterministic scripts.

Supported formats:

- PDF: `.pdf`
- Word: `.docx`
- Excel: `.xlsx`, `.xlsm`
- PowerPoint: `.pptx`

Do not use Anthropic/Claude document skills as source material. This skill is independently written and relies on permissive open-source libraries or direct OOXML parsing. See `references/licenses.md` before changing dependencies.

## Core Workflow

1. Identify the file type from the extension and the user's requested outcome.
2. Read first, edit second. Always inspect the source file before modifying it.
3. For reading, run `scripts/read_document.py`.
4. For edits, write a small JSON operations file and run the matching edit script.
5. Save edits to a new output file unless the user explicitly asks to overwrite.
6. Read the output file again with `scripts/read_document.py` and verify the requested change.
7. If the requested operation is outside the supported surface, say so clearly and stop.

## Reading

Use `read_document.py` for every supported format:

```bash
python3 skills2set/office-documents/scripts/read_document.py input.docx --format markdown
python3 skills2set/office-documents/scripts/read_document.py input.xlsx --format json --output summary.json
python3 skills2set/office-documents/scripts/read_document.py input.pdf --max-chars 120000
```

Behavior:

- It tries MarkItDown first when available.
- If MarkItDown is unavailable, it uses direct OOXML readers for DOCX, XLSX, and PPTX.
- For PDF text extraction it tries pdfplumber, then pypdf.
- It returns clear JSON errors when required PDF libraries are unavailable or the file is unsupported.

For large documents, read enough to understand structure first, then narrow by sheet, slide, page, heading, or searched text.

## Editing

Use JSON operations. Keep each operation explicit and small enough to verify.

### DOCX

```bash
python3 skills2set/office-documents/scripts/edit_docx.py input.docx output.docx --ops ops.json
```

Supported operations:

```json
[
  { "op": "replace_text", "find": "old text", "replace": "new text" },
  { "op": "append_paragraph", "text": "New paragraph" },
  { "op": "add_table", "rows": [["Name", "Value"], ["A", "10"]] }
]
```

Use `replace_text` for safe text updates. `append_paragraph` and `add_table` require `python-docx`.

### XLSX

```bash
python3 skills2set/office-documents/scripts/edit_xlsx.py input.xlsx output.xlsx --ops ops.json
```

Supported operations:

```json
[
  { "op": "set_cell", "sheet": "Sheet1", "cell": "B2", "value": "Approved" },
  { "op": "set_formula", "sheet": "Sheet1", "cell": "C10", "formula": "=SUM(C2:C9)" },
  { "op": "append_row", "sheet": "Sheet1", "values": ["Total", 1200] },
  { "op": "add_sheet", "name": "Summary" },
  { "op": "rename_sheet", "sheet": "Sheet1", "name": "Data" },
  { "op": "set_style", "sheet": "Data", "cell": "A1", "bold": true, "font_color": "FFFFFF", "fill_color": "1F4E79" }
]
```

XLSX editing requires `openpyxl`. Preserve formulas unless the user asks to replace them.

### PPTX

```bash
python3 skills2set/office-documents/scripts/edit_pptx.py input.pptx output.pptx --ops ops.json
```

Supported operations:

```json
[
  { "op": "replace_text", "find": "Q1", "replace": "Q2" },
  { "op": "set_shape_text", "slide": 1, "shape_index": 2, "text": "Updated title" },
  { "op": "add_textbox", "slide": 3, "text": "Speaker note", "left": 1, "top": 1, "width": 8, "height": 1 }
]
```

Use `replace_text` for direct OOXML text updates. Shape targeting and text boxes require `python-pptx`.

### PDF

```bash
python3 skills2set/office-documents/scripts/edit_pdf.py input.pdf output.pdf --ops ops.json
```

Supported operations:

```json
[
  { "op": "rotate_pages", "pages": "1,3-4", "degrees": 90 },
  { "op": "extract_pages", "pages": "1-2,5" },
  { "op": "delete_pages", "pages": "7" },
  { "op": "merge", "inputs": ["a.pdf", "b.pdf"] },
  { "op": "set_metadata", "metadata": { "/Title": "Updated document" } }
]
```

PDF editing requires `pypdf`. Do not claim support for arbitrary PDF text replacement. PDF text is drawing instructions, not normal document text.

## Verification

After any edit:

1. Confirm the output file exists and is non-empty.
2. Read the output with `read_document.py`.
3. Check that requested content changed and unrelated content still appears intact.
4. Report any limitation, dependency failure, or partial edit.

For XLSX formulas, openpyxl preserves formulas but does not calculate them. If calculated values matter and no recalculation engine is available, say that formulas were written but not recalculated locally.

## Unsupported Or Caution Cases

Be explicit when the requested task needs a real Office renderer or advanced document engine:

- Pixel-perfect layout repair.
- Scanned PDF OCR when no OCR engine or model is available.
- PDF arbitrary text replacement.
- Macros, VBA, encrypted files, password-protected files.
- Complex PowerPoint animations, transitions, SmartArt, embedded media, OLE objects.
- Excel pivot table authoring, slicers, external links, macros.
- Redline or track-changes fidelity matching Microsoft Word.

If the user needs one of these, explain the specific limitation and suggest the smallest safe alternative.

## References

Read only the relevant reference file when needed:

- `references/docx.md` for Word details.
- `references/xlsx.md` for spreadsheet details.
- `references/pptx.md` for PowerPoint details.
- `references/pdf.md` for PDF details.
- `references/licenses.md` for licensing and dependency constraints.
