# PPTX Reference

PPTX files are OOXML ZIP packages. Slide content is stored under `ppt/slides/slideN.xml`; notes are usually under `ppt/notesSlides/notesSlideN.xml`.

## Reading

Use `scripts/read_document.py`. It prefers MarkItDown and falls back to direct OOXML extraction of slide text and notes text.

Read slide text before editing so shape order and repeated strings are clear.

## Editing

Use `scripts/edit_pptx.py` with an operations JSON file.

Good default operations:

- `replace_text` for literal text replacement across slides and notes.
- `set_shape_text` when the target slide and shape index or name is clear.
- `add_textbox` for simple additions when `python-pptx` is available.

Direct replacement may simplify run-level formatting inside affected paragraphs. For layout-sensitive decks, prefer targeted shape edits with `python-pptx`.

## Units

`add_textbox` uses inches for `left`, `top`, `width`, and `height`, matching python-pptx conventions.

## Cautions

Do not promise:

- Complex animation or transition editing.
- SmartArt editing.
- Embedded audio/video editing.
- Pixel-perfect layout repair.
- Slide master redesign.

Always save to a new `.pptx`, then read it back.
