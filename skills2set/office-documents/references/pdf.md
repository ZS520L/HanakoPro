# PDF Reference

PDF is a fixed-layout format. Treat it differently from DOCX/XLSX/PPTX.

## Reading

Use `scripts/read_document.py`.

It tries:

1. MarkItDown.
2. pdfplumber.
3. pypdf.

If all PDF readers are unavailable, ask the user to install one of the optional packages or use another environment with PDF extraction support.

## Editing

Use `scripts/edit_pdf.py` for structural PDF operations:

- `rotate_pages`
- `extract_pages`
- `delete_pages`
- `merge`
- `set_metadata`

PDF arbitrary text replacement is intentionally unsupported. Text in a PDF is usually positioned drawing commands, and safe replacement needs a renderer or specialized PDF editor.

## Page Ranges

Page ranges are 1-based:

- `1`
- `1,3,5`
- `2-4`
- `1,3-5,9`

## Cautions

Do not promise:

- OCR for scanned documents without an OCR engine or vision model.
- Reflowing text.
- Editing arbitrary paragraphs in place.
- Preserving digital signatures after modification.
- Editing encrypted files without credentials.

Always save to a new PDF and read or inspect it after editing.
