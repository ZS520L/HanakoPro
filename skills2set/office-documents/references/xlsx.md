# XLSX Reference

XLSX and XLSM files are OOXML ZIP packages. Spreadsheet editing should use `openpyxl` because direct XML editing can easily break shared strings, formulas, relationships, and workbook metadata.

## Reading

Use `scripts/read_document.py`. It prefers MarkItDown and falls back to a direct OOXML reader that extracts sheet names, visible cell values, formulas, and compact Markdown tables.

For large workbooks, inspect sheet names first, then focus on relevant sheets and ranges.

## Editing

Use `scripts/edit_xlsx.py` with an operations JSON file. Supported operations include:

- `set_cell`
- `set_formula`
- `append_row`
- `add_sheet`
- `rename_sheet`
- `delete_sheet`
- `set_number_format`
- `set_style`
- `autofit`

Prefer formulas over hardcoded calculated values when the spreadsheet should remain dynamic.

## Formula Handling

`openpyxl` writes and preserves formulas but does not calculate them. When calculated values matter, say that formulas were written but not recalculated locally unless a separate recalculation engine is available.

## Cautions

Do not promise:

- Macro editing.
- Pivot table authoring.
- Slicers.
- External link repair.
- Full chart authoring.
- Workbook protection bypass.

Always save to a new workbook and read it back.
