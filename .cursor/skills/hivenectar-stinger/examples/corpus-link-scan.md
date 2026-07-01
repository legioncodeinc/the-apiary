# Corpus Link Scan

> The verification step every guide's procedure ends with. Run this after any corpus edit to confirm cross-links resolve. A broken link is a defect regardless of content quality.

## What it checks

Every `**Related:**` link and inline markdown link in the corpus (and in this skill) must point to a file that exists on disk. The scan catches: depth errors (single `../` where double is needed), renamed files, and moved folders.

## The scanner (Python, run from repo root)

```python
import os, re, glob

REPO = r'C:\Users\mario\GitHub\hivenectar'
# Scan the corpus + the skill itself
TARGETS = [
    os.path.join(REPO, 'library', 'knowledge', 'private', '**', '*.md'),
    os.path.join(REPO, 'library', 'knowledge', 'public', '**', '*.md'),
    os.path.join(REPO, 'skills', 'hivenectar-stinger', '**', '*.md'),
]
link_re = re.compile(r'\]\(([^)]+)\)')
broken = []
files = []
for pat in TARGETS:
    files += glob.glob(pat, recursive=True)
for f in sorted(set(files)):
    fdir = os.path.dirname(f)
    with open(f, encoding='utf-8') as fh:
        for line in fh:
            for link in link_re.findall(line):
                if link.startswith(('http', 'mailto', '#')):
                    continue
                path = link.split('#')[0]
                if not path:
                    continue
                target = os.path.normpath(os.path.join(fdir, path))
                if not os.path.exists(target):
                    broken.append((os.path.relpath(f, REPO), link))
print(f'Scanned {len(files)} files, found {len(broken)} broken link(s):')
for f, link in sorted(broken):
    print(f'  BROKEN  {f}  ->  {link}')
```

Save as `_scan.py` at the repo root, run `python _scan.py`, then delete it. Expected output for a clean corpus: `found 0 broken link(s)`.

## When the scan finds a break

1. Read the broken link's context (which doc, which section).
2. Determine the correct path — usually it's a depth error (`../` → `../../`).
3. Fix the link. Use `Edit` with `replace_all: true` if the same broken link appears in both a `**Related:**` block and inline prose.
4. Re-run the scan to confirm zero breaks.

## History

This scan was built during the corpus audit. Its first run found 9 broken links (all depth errors in `data/source-graph-deep-dive/`), which were fixed. Its second run, after fixing the 5 hallucinations, confirmed 0 broken links across all 45 private deep-dive files. Run it after every corpus edit.
