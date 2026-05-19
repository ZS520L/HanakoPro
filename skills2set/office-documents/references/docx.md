# DOCX Reference

DOCX files are OOXML ZIP packages. The primary content is usually in `word/document.xml`; headers, footers, comments, footnotes, and endnotes live in sibling XML parts.

## Reading

Use `scripts/read_document.py` first. It prefers MarkItDown and falls back to a direct OOXML reader that extracts:

- Paragraph text.
- Heading-like paragraph styles.
- Table rows and cells.
- Comments when present.
- Media file names.

## Editing

Use `scripts/edit_docx.py` with an operations JSON file.

Good default operations:

- `replace_text` for literal text replacement.
- `append_paragraph` for adding simple final text.
- `add_table` for appending a simple table.

`replace_text` can run through direct OOXML and may collapse run-level formatting inside affected paragraphs. Use it for text-correctness edits, not typography-sensitive legal redlines.

`append_paragraph` and `add_table` require `python-docx`. If that dependency is missing, stop and report it.

## Cautions

Do not promise:

- Full Microsoft Word tracked-changes fidelity.
- Complex section layout edits.
- Precise pagination.
- Embedded object editing.
- Macro editing.

Always save to a new `.docx`, then read it back.
