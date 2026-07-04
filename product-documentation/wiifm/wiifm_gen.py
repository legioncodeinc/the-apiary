import os
from weasyprint import HTML

BASE = os.path.dirname(__file__)
ASSETS = os.path.join(BASE, "..", "one-pagers", "html", "assets")
OUT_PDF = os.path.join(BASE, "pdf")
OUT_PNG = os.path.join(BASE, "png")

# Per-product brand (accent, deep accent, header text/subtext, mark asset)
BRAND = {
  "honeycomb": {"name":"Honeycomb","cat":"The Memory","accent":"#F7A823","accent2":"#C67B00",
                "htext":"#2A1D00","hsub":"#5A3F00","mark":"honeycomb-mark.png"},
}

AUD = {
  "enterprise": "For the Enterprise",
  "developer":  "For AI-Augmented Developers",
}

# Tightened WIIFM copy. main = main question, summ = summary, qa = [(q,a),...]
DOCS = {
 ("honeycomb","enterprise"): {
   "main":"Why pay to teach the same context to AI every single day?",
   "summ":"Your developers' assistants forget everything the moment a session ends, so the team re-explains the same codebase and re-buys the same tokens every morning. Honeycomb gives every agent one shared, lasting memory on Deeplake: what one learns, all recall, and it compounds instead of evaporating.",
   "qa":[
     ("What does a cold start actually cost us?",
      "Every fresh session re-sends context you pay for and re-explains what the tool knew yesterday. Honeycomb primes each session up front, and the ROI page shows real-dollar savings, marked measured or estimated, so it reads like a receipt and not a guess."),
     ("Is our memory secure?",
      "It lives on Deeplake, reached only by a small local daemon and never by the assistant itself. Teams and projects are isolated at the storage layer, secrets are never shown to an agent, and every memory is versioned, so you always know what was known and when."),
     ("Why Deeplake, and not a bolt-on vector store?",
      "Deeplake holds your memory as exact text and as meaning at once, so recall finds the right note even when nobody used the right words, at scale, with full history behind every fact. It grows more powerful and more auditable, instead of rotting into a cache."),
     ("How does one engineer's fix reach the whole team?",
      "A solved problem becomes a skill that appears automatically in every teammate's assistant on their next session, with no wiki and no copy-paste. Sharing is opt-in, so private stays private until someone widens it on purpose."),
   ],
 },
 ("honeycomb","developer"): {
   "main":"Why do you re-explain your own project to your AI every morning?",
   "summ":"You taught your assistant your stack and the fix that finally worked at midnight, then closed the window and it forgot all of it. Honeycomb is the memory it never had: install once and it hands the right notes back to any assistant, on any machine. Learn something once, recall it everywhere.",
   "qa":[
     ("I told Cursor yesterday. Why does Claude Code have no idea today?",
      "Their memory dies with the window, and they do not talk to each other. Honeycomb sits underneath all of them (Claude Code, Cursor, and Codex today) and gives them one shared brain, so a note written in one is recalled by another, even on a different laptop."),
     ("Do I have to babysit it?",
      "No. Install opens the Hive dashboard, where you connect your assistants in a couple of clicks, and from then on it captures the useful moments on its own and briefs every new session. Your agent starts smart instead of blank."),
     ("How does it find the right memory when I forget the exact words?",
      "Your memory lives on Deeplake, which searches by meaning and not just keywords, so it surfaces the note you needed even when you would never have guessed the term. It also tidies itself over time, so the more you use it the sharper it gets, not the noisier."),
     ("Is my code safe?",
      "Yes. Your memory sits on Deeplake, reached only by the local helper on your machine and never by the assistant directly, with secrets never shown to the agent. Working on something sensitive? Flip to read-only and nothing new is written, while recall still works."),
   ],
 },
}

CSS = """
@font-face {{ font-family:'Inter'; src:url('Inter.ttf'); }}
@page {{ size: Letter; margin: 0; }}
* {{ box-sizing: border-box; }}
body {{ margin:0; font-family:'Inter', sans-serif; color:#20242b; -weasy-hyphens:none; }}
.hdr {{ background:linear-gradient(135deg, {accent} 0%, {accent2} 100%); color:{htext}; padding:30px 50px 24px; }}
.hdr-top {{ display:flex; align-items:center; justify-content:space-between; }}
.brandline {{ font-size:8pt; letter-spacing:.16em; text-transform:uppercase; color:{hsub}; font-weight:600; }}
.mark {{ height:36px; }}
.aud {{ font-size:8.5pt; font-weight:800; text-transform:uppercase; letter-spacing:.1em;
        border:1.5px solid {htext}; border-radius:999px; padding:4px 12px; color:{htext}; }}
.name {{ font-size:32pt; font-weight:800; letter-spacing:-.025em; margin:14px 0 3px; line-height:1; }}
.cat {{ font-size:10pt; letter-spacing:.18em; text-transform:uppercase; color:{hsub}; font-weight:600; }}
.body {{ padding:30px 50px 0; }}
.mainq {{ font-size:20pt; line-height:1.16; font-weight:800; color:#12161d; letter-spacing:-.015em; margin:0; }}
.rule {{ width:56px; height:4px; background:{accent}; border-radius:2px; margin:14px 0 16px; }}
.summary {{ font-size:11pt; line-height:1.52; color:#2f343c; margin:0 0 26px; }}
.qa {{ margin:0 0 16px; }}
.qa:last-child {{ margin-bottom:0; }}
.q {{ font-size:11.5pt; font-weight:800; color:{accent2}; margin:0 0 4px; letter-spacing:-.01em; }}
.a {{ font-size:10pt; line-height:1.5; color:#3b414a; margin:0; }}
.foot {{ padding:26px 50px 22px; margin-top:26px; border-top:1px solid #e7e3da;
         display:flex; align-items:center; gap:14px; }}
.foot img {{ height:17px; opacity:.85; }}
.foot .x {{ color:#b9b3a8; font-size:10pt; }}
.foot .tag {{ margin-left:auto; font-size:8pt; letter-spacing:.14em; text-transform:uppercase; color:#a49d90; }}
"""

def render(prod, aud):
    b = BRAND[prod]; d = DOCS[(prod,aud)]
    css = CSS.format(accent=b["accent"], accent2=b["accent2"], htext=b["htext"], hsub=b["hsub"])
    qa = "".join(f'<div class="qa"><div class="q">{q}</div><div class="a">{a}</div></div>' for q,a in d["qa"])
    html = f"""<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head><body>
<div class="hdr">
  <div class="hdr-top">
    <img class="mark" src="{b['mark']}"/>
    <span class="aud">{AUD[aud]}</span>
  </div>
  <div class="name">{b['name']}</div>
  <div class="cat">{b['cat']}</div>
  <div class="brandline" style="margin-top:8px">The Apiary &nbsp;·&nbsp; Legion Code &times; Activeloop</div>
</div>
<div class="body">
  <div class="mainq">{d['main']}</div>
  <div class="rule"></div>
  <div class="summary">{d['summ']}</div>
  {qa}
</div>
<div class="foot">
  <img src="legion.png"/><span class="x">&times;</span><img src="activeloop.png"/>
  <span class="tag">{b['name']} &nbsp;·&nbsp; {AUD[aud]}</span>
</div>
</body></html>"""
    stem = f"{prod}-{aud}"
    pdf = os.path.join(OUT_PDF, stem+".pdf")
    HTML(string=html, base_url=os.path.abspath(ASSETS)).write_pdf(pdf)
    return pdf

if __name__ == "__main__":
    for key in [("honeycomb","enterprise"),("honeycomb","developer")]:
        p = render(*key); print("wrote", p)
