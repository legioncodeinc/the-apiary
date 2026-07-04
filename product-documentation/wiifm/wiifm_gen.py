import os
from weasyprint import HTML
from PIL import Image, ImageDraw

BASE = os.path.dirname(__file__)
ASSETS = os.path.abspath(os.path.join(BASE, "..", "one-pagers", "html", "assets"))
OUT_PDF = os.path.join(BASE, "pdf")
OUT_PNG = os.path.join(BASE, "png")
os.makedirs(OUT_PDF, exist_ok=True); os.makedirs(OUT_PNG, exist_ok=True)

# name, cat, accent, accent2, htext, hsub, mark, optional brand override
BRAND = {
 "honeycomb":{"name":"Honeycomb","cat":"The Memory","accent":"#F7A823","accent2":"#C67B00","htext":"#2A1D00","hsub":"#4A3400","mark":"honeycomb-mark.png"},
 "nectar":   {"name":"Nectar","cat":"The Understanding Layer","accent":"#FFD048","accent2":"#C99400","htext":"#2E2400","hsub":"#4A3B00","mark":"nectar-mark.png"},
 "doctor":   {"name":"Doctor","cat":"The Watchdog","accent":"#3EC8A8","accent2":"#178E77","htext":"#06231E","hsub":"#0C3B31","mark":"doctor-mark.png"},
 "hive":     {"name":"Hive","cat":"The Portal","accent":"#E8722A","accent2":"#B4470F","htext":"#FFFFFF","hsub":"#FFE7D6","mark":"hive-mark.png"},
 "queen":    {"name":"Queen","cat":"The Fleet Orchestrator","accent":"#E0569B","accent2":"#B93A78","htext":"#FFFFFF","hsub":"#FFE1EF","mark":"queen-mark.png"},
 "apiary":   {"name":"The Apiary","cat":"Five Products, One Memory","accent":"#8B7CF0","accent2":"#5A44C0","htext":"#FFFFFF","hsub":"#E7E1FF","mark":"apiary-mark.png","brand":"Legion Code &times; Activeloop"},
}
AUD = {"enterprise":"For the Enterprise", "developer":"For AI-Augmented Developers"}

DOCS = {
 ("honeycomb","enterprise"):{"main":"Why pay to teach the same context to AI every single day?","summ":"Your developers' assistants forget everything the moment a session ends, so the team re-explains the same codebase and re-buys the same tokens every morning. Honeycomb gives every agent one shared, lasting memory on Deeplake: what one learns, all recall, and it compounds instead of evaporating.","qa":[
  ("What does a cold start actually cost us?","Every fresh session re-sends context you pay for and re-explains what the tool knew yesterday. Honeycomb primes each session up front, and the ROI page shows real-dollar savings, marked measured or estimated, so it reads like a receipt and not a guess."),
  ("Is our memory secure?","It lives on Deeplake, reached only by a small local daemon and never by the assistant itself. Teams and projects are isolated at the storage layer, secrets are never shown to an agent, and every memory is versioned, so you always know what was known and when."),
  ("Why Deeplake, and not a bolt-on vector store?","Deeplake holds your memory as exact text and as meaning at once, so recall finds the right note even when nobody used the right words, at scale, with full history behind every fact. It grows more powerful and more auditable, instead of rotting into a cache."),
  ("How does one engineer's fix reach the whole team?","A solved problem becomes a skill that appears automatically in every teammate's assistant on their next session, with no wiki and no copy-paste. Sharing is opt-in, so private stays private until someone widens it on purpose."),
 ]},
 ("honeycomb","developer"):{"main":"Why do you re-explain your own project to your AI every morning?","summ":"You taught your assistant your stack and the fix that finally worked at midnight, then closed the window and it forgot all of it. Honeycomb is the memory it never had: install once and it hands the right notes back to any assistant, on any machine. Learn something once, recall it everywhere.","qa":[
  ("I told Cursor yesterday. Why does Claude Code have no idea today?","Their memory dies with the window, and they do not talk to each other. Honeycomb sits underneath all of them (Claude Code, Cursor, and Codex today) and gives them one shared brain, so a note written in one is recalled by another, even on a different laptop."),
  ("Do I have to babysit it?","No. Install opens the Hive dashboard, where you connect your assistants in a couple of clicks, and from then on it captures the useful moments on its own and briefs every new session. Your agent starts smart instead of blank."),
  ("How does it find the right memory when I forget the exact words?","Your memory lives on Deeplake, which searches by meaning and not just keywords, so it surfaces the note you needed even when you would never have guessed the term. It also tidies itself over time, so the more you use it the sharper it gets, not the noisier."),
  ("Is my code safe?","Yes. Your memory sits on Deeplake, reached only by the local helper on your machine and never by the assistant directly, with secrets never shown to the agent. Working on something sensitive? Flip to read-only and nothing new is written, while recall still works."),
 ]},
 ("nectar","enterprise"):{"main":"How much time do your engineers lose because AI reads the wrong code?","summ":"Your developers' agents find code by file name, so in a real codebase they read the wrong files, answer confidently about the wrong thing, and hand the search back to the engineer. Nectar describes every file by what it does and stores that on Deeplake, so agents find the right code by meaning, once, for the whole team.","qa":[
  ("What does 'the agent read the wrong file' actually cost us?","Every wrong file is a wasted turn you pay for and a confident answer your engineer has to catch and correct. Nectar points agents at the files that actually matter, so they spend tokens on the right code the first time."),
  ("How does one engineer's understanding reach everyone?","Nectar's descriptions are a portable registry: build the understanding once and the whole team inherits it when they pull the project, with no re-indexing per person. A new hire's agent is useful on day one instead of week three."),
  ("Where does this live, and is it secure?","On Deeplake, reached only by the local daemon, with teams and projects isolated at the storage layer and secrets never exposed. The descriptions are versioned, so the map of your codebase is auditable, not a black box."),
  ("Why is meaning-based recall a moat, not a nice-to-have?","Deeplake matches on what code does, at scale, so agents find the right file even when nobody named it well, which is most real code. That accuracy compounds across every question every engineer asks, all day."),
 ]},
 ("nectar","developer"):{"main":"Why does your agent open the wrong file when you ask a simple question?","summ":"Ask where you handle logins and your agent hunts for login.ts, misses the real file buried three folders deep, and hands you a confident answer about the wrong code. Nectar gives every file a plain-language description of what it actually does, so your agent finds code by meaning and stops guessing from names.","qa":[
  ("Why can't my agent find code that isn't named after what it does?","Because it searches names and keywords, and real codebases hide login logic in a file called session-refresh.ts. Nectar reads each file and writes down what it does, so a search for logins lands on the right one even when the name never says so."),
  ("Do I have to change how I work?","No. Nectar runs quietly and keeps its descriptions current as files change, and the better answers surface right inside your assistant through Honeycomb's shared memory. You ask the same questions and get the right files back."),
  ("How does it match meaning instead of keywords?","The descriptions live on Deeplake, which searches by meaning, so 'anything about logins' finds the right file even when you would never have guessed its name or where it sits. It is the book index that actually read every chapter."),
  ("Will it keep up as the code moves?","Yes. Nectar re-reads files as they change, so a renamed or relocated file still gets found by what it does. Poorly named, buried, or freshly moved, your agent still lands on it."),
 ]},
 ("doctor","enterprise"):{"main":"What does a silent memory outage cost you across a whole team?","summ":"Your engineers' memory runs on local daemons, and a daemon that dies quietly costs every developer it touches: forgotten sessions and time re-explaining code the agent already knew. Doctor is the watchdog that stands outside every failure it watches, heals the stack automatically, and keeps it current safely, so the outage and the fix both happen without a ticket.","qa":[
  ("Who fixes the stack when it breaks?","Doctor does, on its own. It probes every daemon every 30 seconds, diagnoses the kind of failure, and repairs it on a backoff ladder, escalating with a structured report only when it genuinely cannot. Your team stays in flow instead of filing tickets."),
  ("How do we roll out updates without breaking machines?","Doctor auto-updates only behind a blessed-release gate: a version must be explicitly approved, the update is verified healthy, and a failed verify rolls back on its own. One bad release cannot spread across your fleet."),
  ("Is it a security liability?","No. Doctor is zero-dependency, runs per-user with no admin rights, and has no code that can read or delete credentials. Its escalation reports land on a local status page first and never carry your code or secrets."),
  ("How much operational overhead does it add?","Almost none. It is deliberately boring: silent when healthy, supervised by the OS so it survives reboots, and harder to kill than what it watches. The whole point is that nobody has to think about it."),
 ]},
 ("doctor","developer"):{"main":"What happens to your agent's memory when a daemon dies at 2am?","summ":"Your memory stack runs on local daemons, and when one dies quietly overnight you pay the next morning: a session that forgot everything and twenty minutes re-explaining a codebase your agent knew yesterday. Doctor watches the whole stack, heals what breaks, and has your memory back before your next prompt, usually without you noticing.","qa":[
  ("A daemon crashed. Do I have to fix it?","No. Doctor probes every service every 30 seconds and climbs a repair ladder: restart, reinstall after repeated fails, remove a conflicting package, back off, and stop the instant health returns. Kill one on purpose and it is typically back within one probe."),
  ("Will it nag me?","No. A healthy check is a single debug line, so Doctor stays silent on the happy path. It only speaks up when the ladder runs out, and then it writes a plain do-this-next report on a local status page."),
  ("Could an auto-update brick my setup?","No. Doctor updates the memory daemon only behind a blessed-release gate, verifies health afterward, and rolls a bad update back automatically. A broken release cannot spread itself to your machine."),
  ("Can it touch my credentials?","Never. Doctor has no code that can read or delete your credentials file. If it suspects a credential problem it tells you and stops, full stop."),
 ]},
 ("hive","enterprise"):{"main":"How do your engineers see the health of their AI stack without port-hunting?","summ":"The Apiary runs several local services per developer, and a status view scattered across loopback ports is a status view nobody checks. Hive is one always-on portal at 127.0.0.1:3853 that serves the entire dashboard and a live health rail, built to be the last thing standing when something else goes down.","qa":[
  ("Why does a single portal matter operationally?","Because visibility that takes effort gets skipped. Hive puts memories, graphs, sync, logs, ROI, and per-service health behind one address, so an engineer always knows the state of their stack at a glance."),
  ("Does it become a new point of failure?","No. Hive is its own service, booted at startup and watched by Doctor, and if a service behind it drops, that panel says so while the rest keeps working and recovers on its own. It was built to survive the exact moment you need a status view."),
  ("What is its security surface?","Minimal. It binds to loopback only, so nothing off-device can reach it, and it stores nothing: your session passes straight through to the services that own your data. Sign-in creates your Deeplake credential on your machine, not in the portal."),
  ("What does it give an operator that per-service pages don't?","One honest picture. A health rail on every page, a readiness screen on cold boot, and per-service metrics and logs in one place, so triage starts from a single source of truth instead of a tab hunt."),
 ]},
 ("hive","developer"):{"main":"Which local port was the dashboard on again?","summ":"The Apiary runs several services on your machine, each on its own port, and hunting across loopback tabs is nobody's idea of a dashboard. Hive is the front door: one always-on address at 127.0.0.1:3853 that serves the whole thing. Bookmark it once and you are done.","qa":[
  ("Why one address instead of a port per service?","Because port-hunting is not your job. Hive serves memories, projects, the graphs, sync, logs, ROI, and settings from a single URL, with a live health rail on every page so you always know the state of the fleet."),
  ("What do I see if I open it mid-boot?","An honest readiness screen, one bee per service, that dismisses itself the moment the fleet is ready. You never get a broken page or a false first-time-setup screen just because something was still waking up."),
  ("A panel says unreachable. Is my data gone?","No. It means that one service is not answering right now; Doctor restarts it and the panel recovers on its own. The rest of the dashboard keeps working the whole time."),
  ("Is it exposed to the network?","No. Hive binds to 127.0.0.1 only, so nothing off your machine can reach it, and it passes your session straight through to the services that own your data while storing nothing itself."),
 ]},
 ("queen","enterprise"):{"main":"When your AI memory stack spreads across machines and people, who is in control?","summ":"One machine is clean: four daemons behind one portal on loopback. Across a fleet the hard questions start, which daemons are alive on which boxes, who can enroll a new device, how an admin sees org-wide ROI, what gets cut off when a laptop is stolen. Queen answers exactly those, and never touches your memory content. (Coming soon.)","qa":[
  ("Does the cloud get to see our memory?","No. Queen coordinates identity, presence, and encrypted blobs it cannot decrypt, while your own long-lived orchestrator holds custody of the Deeplake credential. The control plane carries no memory, no prompts, and no plaintext credentials, by design."),
  ("How do we add and remove devices safely?","Every agent, even an ephemeral sub-agent, gets its own attributable, revocable identity, brokered by a signing authority against a pinned key. Revoking a device and rotating the credential are two honest, separate steps, written down before they hit a support ticket."),
  ("Can leadership see ROI across the whole org?","Yes. A hosted admin surface rolls ROI up per org, per team, and per user, with allocated-versus-measured cost on every line and per-user views gated behind verified identity, so no number is fabricated."),
  ("What happens when a machine is stolen?","You revoke that device in Queen and rotate the Deeplake credential, and its access is cut. Recovery, revocation, and escrow are explicit, reversible policy, not improvised in the middle of an incident."),
 ]},
 ("queen","developer"):{"main":"Your agents are spreading across machines. How do you keep them one identity, not a mess?","summ":"The Apiary is clean on one laptop. The moment you add a second machine, a VPS, or throwaway workers, you need to know which agents are alive and who is allowed to join, without handing your memory to the cloud. Queen coordinates all of that and never reads your memory content. (Coming soon.)","qa":[
  ("Do I have to open two laptops to add a device?","No. Approve the new device in the cloud and an existing trusted machine finishes the cryptographic handoff next time it is online. A headless VPS joins with a short-lived token whose only power is to let it in, it cannot read or decrypt anything."),
  ("Can I see all my agents in one place?","Yes. A read-only fleet view shows every agent with a derived health state, so an idle-but-fine daemon and a crashed one stop looking identical. It is scoped to your own fleet, nothing more."),
  ("Does the cloud hold my credentials or memory?","No. Your orchestrator holds the Deeplake credential; the cloud coordinates identity and presence and stores only encrypted blobs it cannot open. No prompts, no session text, no plaintext keys."),
  ("What if I lose a device?","Revoke it and rotate your credential, two clear steps, and it is cut off. Lose every trusted device and the answer is a written re-link path, never a hidden backdoor."),
 ]},
 ("apiary","enterprise"):{"main":"What if every AI tool your team uses shared one memory you actually own?","summ":"AI assistants are brilliant and forgetful, scattered across tools that never share what they learn. The Apiary is a stack of small, sharp programs that give all of them one shared memory on Deeplake, on infrastructure you control, each solving one stubborn problem. Learn something once, and every agent recalls it everywhere.","qa":[
  ("What remembers, and where does it live?","Honeycomb is the shared memory, and it lives on Deeplake, reached only by a local daemon, isolated per team and project, with secrets never shown to an agent. What one assistant learns, all of them recall, across tools and machines."),
  ("How do agents find the right code and context?","Nectar describes every file by what it does and Deeplake searches by meaning, so agents find the right code and notes even when nobody used the right words. Recall gets sharper as your team uses it, not noisier."),
  ("What keeps it running, and how do we see it?","Doctor watches the stack and heals what breaks before the next prompt, and Hive serves the whole dashboard at one local address. You get a system that repairs itself and a single honest status view."),
  ("Does it scale past one machine, safely?","Yes. Queen coordinates identity, presence, and org-wide ROI across a fleet without ever reading your memory content. It is one memory, one hive, on Deeplake, and it stays yours. (Queen coming soon.)"),
 ]},
 ("apiary","developer"):{"main":"What if all your AI coding tools finally shared one memory?","summ":"Your assistants are brilliant and forgetful, and each one hoards what little it learns. The Apiary is a stack of small, sharp programs that give all of them one shared memory on Deeplake, on hardware you control, each fixing one stubborn problem. Learn something once, and every agent recalls it everywhere.","qa":[
  ("What actually remembers my work?","Honeycomb, the shared memory. It captures the useful moments and hands the right notes back to any assistant on any machine, so a decision you reached in one tool is there in the next, even on another laptop."),
  ("How does it find the right thing when I forget the words?","Nectar describes your files by what they do and Deeplake searches by meaning, so your agent lands on the right code and the right note even when you would never have guessed the name. It gets sharper the more you use it."),
  ("What keeps it alive and easy to see?","Doctor heals the stack before your next prompt when something crashes, and Hive gives you the whole thing at one address you bookmark once. Nothing to babysit, nothing to port-hunt."),
  ("Is my code mine?","Yes. Everything lives on Deeplake, reached only by the local helpers on your machine and never by the assistant directly, with secrets never shown. It is one memory, one hive, and it is yours."),
 ]},
}

CSS = """
@font-face {{ font-family:'Inter'; src:url('Inter.ttf'); }}
@page {{ size: Letter; margin: 0; }}
* {{ box-sizing: border-box; }}
body {{ margin:0; font-family:'Inter', sans-serif; color:#20242b; }}
.hdr {{ background:linear-gradient(135deg, {accent} 0%, {accent2} 100%); color:{htext}; padding:28px 50px 26px; }}
.hdr-top {{ display:flex; align-items:center; justify-content:space-between; }}
.chiptile {{ height:50px; width:50px; display:block; }}
.aud {{ font-size:8.5pt; font-weight:800; text-transform:uppercase; letter-spacing:.11em;
        background:#241900; color:#ffffff; border-radius:7px; padding:8px 15px; }}
.name {{ font-size:33pt; font-weight:800; letter-spacing:-.025em; margin:16px 0 3px; line-height:1; color:{htext}; }}
.cat {{ font-size:10pt; letter-spacing:.18em; text-transform:uppercase; color:{htext}; opacity:.92; font-weight:700; }}
.brandline {{ font-size:8pt; letter-spacing:.16em; text-transform:uppercase; color:{htext}; opacity:.72; font-weight:600; margin-top:9px; }}
.body {{ padding:30px 50px 0; }}
.mainq {{ font-size:20pt; line-height:1.16; font-weight:800; color:#12161d; letter-spacing:-.015em; margin:0; }}
.rule {{ width:56px; height:4px; background:{accent}; border-radius:2px; margin:14px 0 16px; }}
.summary {{ font-size:11pt; line-height:1.52; color:#2f343c; margin:0 0 26px; }}
.qa {{ margin:0 0 16px; }}
.qa:last-child {{ margin-bottom:0; }}
.q {{ font-size:11.5pt; font-weight:800; color:{accent2}; margin:0 0 4px; letter-spacing:-.01em; }}
.a {{ font-size:10pt; line-height:1.5; color:#3b414a; margin:0; }}
.foot {{ padding:26px 50px 22px; margin-top:26px; border-top:1px solid #e7e3da; display:flex; align-items:center; gap:14px; }}
.foot img {{ height:17px; opacity:.85; }}
.foot .x {{ color:#b9b3a8; font-size:10pt; }}
.foot .tag {{ margin-left:auto; font-size:8pt; letter-spacing:.14em; text-transform:uppercase; color:#a49d90; }}
"""

def _chip(fname):
    mk = Image.open(os.path.join(ASSETS, fname)).convert("RGBA")
    bb = mk.getbbox()
    if bb: mk = mk.crop(bb)
    S, R, BOX = 240, 46, 138
    tile = Image.new("RGBA", (S, S), (0,0,0,0))
    ImageDraw.Draw(tile).rounded_rectangle([0,0,S-1,S-1], radius=R, fill=(255,255,255,255))
    mw, mh = mk.size; sc = min(BOX/mw, BOX/mh)
    nw, nh = int(round(mw*sc)), int(round(mh*sc))
    tile.alpha_composite(mk.resize((nw,nh), Image.LANCZOS), ((S-nw)//2,(S-nh)//2))
    out = fname.rsplit(".",1)[0]+"-chip.png"; tile.save(os.path.join(ASSETS, out)); return out

def render(prod, aud):
    b = BRAND[prod]; d = DOCS[(prod,aud)]; chip = _chip(b["mark"])
    css = CSS.format(accent=b["accent"], accent2=b["accent2"], htext=b["htext"], hsub=b["hsub"])
    qa = "".join(f'<div class="qa"><div class="q">{q}</div><div class="a">{a}</div></div>' for q,a in d["qa"])
    brand = b.get("brand", "The Apiary &nbsp;&middot;&nbsp; Legion Code &times; Activeloop")
    html = f"""<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head><body>
<div class="hdr">
  <div class="hdr-top"><img class="chiptile" src="{chip}"/><span class="aud">{AUD[aud]}</span></div>
  <div class="name">{b['name']}</div>
  <div class="cat">{b['cat']}</div>
  <div class="brandline">{brand}</div>
</div>
<div class="body">
  <div class="mainq">{d['main']}</div>
  <div class="rule"></div>
  <div class="summary">{d['summ']}</div>
  {qa}
</div>
<div class="foot"><img src="legion.png"/><span class="x">&times;</span><img src="activeloop.png"/>
  <span class="tag">{b['name']} &nbsp;&middot;&nbsp; {AUD[aud]}</span></div>
</body></html>"""
    pdf = os.path.join(OUT_PDF, f"{prod}-{aud}.pdf")
    HTML(string=html, base_url=ASSETS).write_pdf(pdf); return pdf

if __name__ == "__main__":
    order = ["honeycomb","nectar","doctor","hive","queen","apiary"]
    for p in order:
        for a in ("enterprise","developer"):
            render(p,a); print("wrote", f"{p}-{a}.pdf")
