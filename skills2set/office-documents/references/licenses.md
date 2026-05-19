# Licensing Notes

This skill must stay safe to bundle with Hana. Do not copy text, scripts, templates, or examples from Anthropic's document skills.

## Approved Sources

These dependencies have permissive licenses suitable for optional use from bundled scripts:

| Dependency | Purpose | License | Source |
|---|---|---|---|
| Microsoft MarkItDown | Convert PDF, DOCX, XLSX, PPTX to Markdown | MIT | https://github.com/microsoft/markitdown |
| python-docx | Read and update DOCX | MIT | https://github.com/python-openxml/python-docx |
| openpyxl | Read and update XLSX/XLSM | MIT/Expat | https://openpyxl.readthedocs.io/ |
| python-pptx | Read and update PPTX | MIT | https://github.com/scanny/python-pptx |
| pdfplumber | Extract PDF text and tables | MIT | https://github.com/jsvine/pdfplumber |
| pypdf | Split, merge, rotate, and inspect PDFs | BSD-3-Clause | https://github.com/py-pdf/pypdf |

OfficeCLI is Apache-2.0, but this skill intentionally does not require or invoke it.

## Blocked Source

Anthropic's `skills/docx`, `skills/xlsx`, `skills/pptx`, and `skills/pdf` are source-available, not open source. Their license restricts extracting, copying, creating derivatives from, distributing, sublicensing, or transferring the materials. Do not vendor or paraphrase those skill files into Hana.

Reference link: https://github.com/anthropics/skills

## Dependency Rule

Scripts should treat the libraries above as optional runtime dependencies. When a dependency is missing, return a clear error with the package name and the operation that needs it. Do not silently switch to a lower-fidelity path for edits that could corrupt files.
