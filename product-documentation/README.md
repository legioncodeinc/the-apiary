# The Apiary Product Documentation

Compiled from the public documentation in each product repo, plus each repo's README and the relevant private architecture, data, and security docs promoted into the technical manuals. Every file is co-branded Legion Code Inc. with Activeloop, US Letter, with a live table of contents, a running header, and page numbers.

Five products are covered: Doctor, Hive, Honeycomb, Nectar, and Queen. Website docs were folded into Honeycomb as its umbrella specs and reference.

## Word documents (`word/`)

Two documents per product, plus one combined compendium.

| Product | Stories & User Guide | Technical Manual & Specification |
|---|---|---|
| Doctor | doctor-stories-user-guide.docx | doctor-technical-manual.docx |
| Hive | hive-stories-user-guide.docx | hive-technical-manual.docx |
| Honeycomb | honeycomb-stories-user-guide.docx | honeycomb-technical-manual.docx |
| Nectar | nectar-stories-user-guide.docx | nectar-technical-manual.docx |
| Queen | queen-stories-user-guide.docx | queen-technical-manual.docx |

Combined: **the-apiary-complete-compendium.docx** holds all ten in one file, split into five parts.

`_brand-template.docx` is the reference used for styling. Point any future pandoc build at it with `--reference-doc` to match the look.

## Markdown sources (`markdown/`)

The assembled markdown behind each Word file, if you want to edit content and re-render.

## A note on the table of contents

The TOC is a real field and is already populated. If a viewer ever shows it blank, click into it and update the field (Word: right-click, Update Field; or select all and press F9).
