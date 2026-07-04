# One-pager generator for The Apiary products (buyer / technical / hybrid)
import os
from weasyprint import HTML

A = os.path.join(os.path.dirname(__file__), "assets")  # overwritten at runtime
ASSETS = None  # set in main

# ---- Brand ----
PRODUCTS = {
 "doctor": {
   "name":"Doctor","cat":"The Watchdog","accent":"#3EC8A8","accent2":"#178E77",
   "htext":"#06231E","hsub":"#0C3B31","port":"127.0.0.1:3852",
   "tagline":"The watchdog that keeps your memory stack alive.",
   "problem":"A memory daemon dies at 2am and nothing notices. Next morning your agent has the memory of a goldfish, and you burn twenty minutes re-explaining a codebase it knew yesterday.",
   "promise":"Doctor stands outside every failure domain it watches. It catches the crash, climbs a repair ladder, and has the daemon back before your next prompt. You never find out it happened.",
   "value":[("Watches everything, every 30s","Probes each daemon and learns the kind of wrong: down, wedged, or degraded in a specific subsystem."),
            ("Heals on a ladder","Restart, reinstall after three fails, remove a conflicting package, back off, stop the instant health returns."),
            ("Quiet when fine, loud when stuck","A healthy probe is one debug line. When the ladder runs out it writes a structured, do-this-next report."),
            ("Safe by construction","Blessed-release updates with automatic rollback. Never reads or deletes your credentials. Full stop.")],
   "specs":[("Dependencies","Zero. Node built-ins only."),
            ("Supervised by","launchd / systemd / Task Scheduler"),
            ("Privileges","Per-user. No admin, no sudo, no UAC."),
            ("Status surface","127.0.0.1:3852 + /status.json"),
            ("Auto-update","Blessed gate, verified, rollback on fail"),
            ("Platforms","macOS, Linux, Windows")],
   "proof":"Kill honeycomb on purpose. Wait thirty seconds. Run doctor status. It is back, with a fresh last-heal. The failure happened and the fix happened, and you were never on the hook for either.",
   "integrates":"Supervises honeycomb, hive, and nectar. Feeds the live health rail in the Hive portal.",
   "arch":[("OS supervisor","launchd / systemd / Task Scheduler keeps Doctor alive"),
           ("Doctor","probes, classifies, heals, escalates"),
           ("Fleet","honeycomb :3850 · hive :3853 · nectar :3854")],
 },
 "hive": {
   "name":"Hive","cat":"The Portal","accent":"#E8722A","accent2":"#B4470F",
   "htext":"#FFFFFF","hsub":"#FFE7D6","port":"127.0.0.1:3853",
   "tagline":"One address for your whole Apiary.",
   "problem":"The Apiary runs several services on your machine, each on its own port. None of that should be your problem, and port-hunting across loopback tabs is nobody's idea of a dashboard.",
   "promise":"Hive is the front door. One always-on portal at 127.0.0.1:3853 that serves the entire dashboard for everything behind it. Bookmark one address and you are done.",
   "value":[("The whole picture, one URL","Memories, projects, the graphs, sync activity, logs, ROI, and settings, in one place with a live health rail on every page."),
            ("Honest on a cold boot","Open it mid-startup and you get the buzzing readiness screen, one bee per service, that dismisses itself the moment the fleet is ready."),
            ("Last thing standing","Its own service, booted at startup, restarted by Doctor. If one service drops, its panel says so while the rest keeps working."),
            ("Yours only","Binds to 127.0.0.1. Passes your session straight through to the services that own your data and stores nothing itself.")],
   "specs":[("Portal address","127.0.0.1:3853"),
            ("Binding","Loopback only. Nothing off-device."),
            ("Federation","Server-side BFF proxy over local loopback"),
            ("Boot","OS service at startup, watched by Doctor"),
            ("Login","Guided Deeplake device flow at /login"),
            ("Stores","Nothing. Session pass-through.")],
   "proof":"A panel says unreachable. Your data is not gone. It means the service that owns that panel is not answering right now. Doctor restarts it, the panel recovers on its own, and the Health page shows exactly which service and since when.",
   "integrates":"Federates honeycomb, nectar, and Doctor. Renders Doctor's live telemetry feed.",
   "arch":[("Browser","talks to Hive alone, same-origin"),
           ("Hive :3853","portal + BFF proxy, session pass-through"),
           ("Services","honeycomb :3850 · nectar :3854 · doctor :3852")],
 },
 "honeycomb": {
   "name":"Honeycomb","cat":"The Memory","accent":"#F7A823","accent2":"#C67B00",
   "htext":"#2A1D00","hsub":"#4A3400","port":"127.0.0.1:3850",
   "tagline":"One shared, lasting memory for all your AI coding agents.",
   "problem":"AI coding assistants are brilliant in the moment and forgetful the next. Close the window and the context is gone. Open a different tool tomorrow and it has never heard of your project.",
   "promise":"Honeycomb gives every one of your agents a single shared memory that survives sessions, travels across tools, and gets sharper over time. Learn something once, and it is there everywhere.",
   "value":[("Memory that survives","What you figured out yesterday is waiting today, already summarized. No re-explaining every morning."),
            ("Memory that travels","A note written in one assistant is recalled by another. Plugs underneath Claude Code, Cursor, and Codex today."),
            ("Skills that spread","Solve something reusable and Honeycomb turns it into a shareable skill that shows up for the whole team, no copy-paste."),
            ("Sharper, not noisier","It tidies its own notes, merging duplicates and dropping junk, keeping the current version of a fact.")],
   "specs":[("Daemon","127.0.0.1:3850"),
            ("Harnesses","Claude Code, Cursor, Codex (3 more in progress)"),
            ("Interfaces","CLI, HTTP API, MCP tools"),
            ("Storage","Activeloop Deeplake (hosted or self-host pg_deeplake)"),
            ("Dashboard","Hive portal at 127.0.0.1:3853"),
            ("Memory","Three-tier, self-tidying, versioned")],
   "proof":"Capture a decision once in one assistant. Recall it anywhere: same daemon, same Deeplake, any harness. A discovery by one engineer reaches the whole team on their next session.",
   "integrates":"Built on Activeloop Deeplake and Hivemind. Legion Code adds the multi-tier memory, skill sharing, and the local daemon.",
   "arch":[("Surfaces","CLI · dashboard · harness shims"),
           ("Daemon :3850","capture, distill, recall, compound"),
           ("Storage","Deeplake: memory, graph, sessions")],
 },
 "nectar": {
   "name":"Nectar","cat":"The Understanding Layer","accent":"#FFD048","accent2":"#C99400",
   "htext":"#2E2400","hsub":"#4A3B00","port":"127.0.0.1:3854",
   "tagline":"Find code by meaning, not by file name.",
   "problem":"Ask your agent where you handle logins and it hunts for login.ts. But the login logic lives in session-refresh.ts, three folders deep, and no name search will ever guess it. Dead end, every time.",
   "promise":"Nectar gives every file a short plain-language description of what it actually does, so your agent matches on meaning instead of names. You ask the same questions and get the right files back.",
   "value":[("Meaning, not matching","Nectar reads each file and writes down what it does, like refreshes login tokens on each authenticated request."),
            ("Quietly current","Descriptions are written once and kept up to date as files change, moved, or renamed. You do nothing differently."),
            ("Fewer dead ends","Your agent points at the file that does the work, not the file that happens to share a name with your question."),
            ("Team-ready","Once one person builds the understanding, the rest of the team gets it for free when they pull the project.")],
   "specs":[("Daemon","127.0.0.1:3854"),
            ("Surfaces","Auto via Honeycomb recall, plus nectar search"),
            ("Data","Hive graph + portable registry"),
            ("Portability","Understanding ships with the project"),
            ("Embeddings","Provider switching supported"),
            ("Identity","Minted descriptions, trustworthy across a team")],
   "proof":"Ask a meaning-shaped question, where do we handle user authentication, and the right files come back regardless of what they are called. It is the index at the back of a book, but one that actually read every chapter.",
   "integrates":"Surfaces through Honeycomb's shared memory automatically. No search box required.",
   "arch":[("Brooding","reads files, writes plain-language descriptions"),
           ("Hive graph","descriptions + relationships, kept current"),
           ("Recall","surfaces through Honeycomb to your agent")],
 },
 "queen": {
   "name":"Queen","cat":"The Fleet Orchestrator","accent":"#E0569B","accent2":"#B93A78",
   "htext":"#FFFFFF","hsub":"#FFE1EF","port":"cloud control plane",
   "tagline":"See and steer the whole fleet. Never touch the memory.",
   "problem":"The Apiary is clean on one machine. The problem starts when the stack spreads across machines, teammates, and orchestrators that spin up throwaway workers. Nobody can answer which daemons are alive, who can mint identity, or what to cut when a laptop walks out.",
   "promise":"Queen is the control plane beside the Deeplake data plane. It carries what memory was never meant to carry: liveness, identity, enrollment, signed commands, usage observation, and fleet reporting. It answers those questions and nothing else.",
   "value":[("Fleet at a glance","Every agent in your org with derived health, healthy versus offline by heartbeat age, scoped so you only ever see your own fleet."),
            ("Custody stays with you","Your long-lived orchestrator holds the Deeplake credential, not the cloud. Queen coordinates blobs it cannot decrypt."),
            ("Enroll without ceremony","Approve a second machine in the cloud and a custodian device finishes the rewrap. A headless VPS joins with a token that can only join."),
            ("Revocation as policy","Cut a stolen device and rotate the credential as two honest steps. The hard cases have written answers before the support ticket.")],
   "specs":[("Model","Two-application: local agent + cloud control plane"),
            ("Boundary","Postgres behind an edge API. No memory content."),
            ("Stack","Cloudflare Workers + Hyperdrive + managed Postgres"),
            ("Presence","Heartbeat + status-on-change, TTL reaping"),
            ("Dashboard","Read-only fleet view, org-scoped"),
            ("Licensing","Cloud binding and BYOC enforcement")],
   "proof":"Memory and skills stay on Deeplake, where they already work. Queen owns seeing and steering the fleet that writes to it. Presence never writes into the memory dataset, and idle daemons never poll it for coordination work.",
   "integrates":"Sits beside Deeplake. Observes the Apiary daemons without touching memory content.",
   "arch":[("Local agent","reports presence, holds custody, brokers access"),
           ("Cloud control plane","identity, enrollment, signed commands"),
           ("Data plane","Deeplake memory, untouched by Queen")],
 },
}

TRUST = {
 "doctor":["Zero dependencies","OS-supervised","No admin needed","macOS · Linux · Windows"],
 "hive":["Loopback only","One URL to remember","Boot-time service","Stores nothing"],
 "honeycomb":["Claude Code · Cursor · Codex","Deeplake-backed","Self-host option","MCP + CLI + API"],
 "nectar":["Meaning-based recall","Portable registry","Team-ready","Surfaces via Honeycomb"],
 "queen":["Control plane only","Never reads memory","BYOC enforcement","Org-scoped"],
}

CSS = """
@font-face { font-family:'Inter'; src:url('ASSETS/Inter.ttf'); }
@font-face { font-family:'JBMono'; src:url('ASSETS/JBMono.woff2'); }
@page { size:Letter; margin:0; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:'Inter',sans-serif; color:#1A1A1A; -weasy-hyphens:none; }
.page { width:8.5in; height:11in; display:flex; flex-direction:column; overflow:hidden; }
/* HEADER */
.hdr { padding:0.52in 0.55in 0.44in 0.55in; background:linear-gradient(135deg,var(--a) 0%, var(--a2) 100%); color:var(--ht); position:relative; }
.cobrand { position:absolute; top:0.34in; right:0.55in; display:flex; align-items:center; gap:7px; font-size:7.5pt; letter-spacing:.02em; color:var(--ht); opacity:.94; }
.cobrand img { height:16px; width:16px; border-radius:3px; background:#fff; padding:1px; }
.cobrand .x { opacity:.6; }
.hrow { display:flex; align-items:center; gap:16px; }
.badge { width:62px; height:62px; border-radius:15px; }
.hmeta .kicker { font-size:8.5pt; font-weight:700; letter-spacing:.17em; text-transform:uppercase; color:var(--hs); }
.hmeta h1 { font-size:35pt; font-weight:800; letter-spacing:-.02em; line-height:1; margin-top:2px; }
.tag { margin-top:14px; font-size:15pt; font-weight:600; line-height:1.25; max-width:7in; }
/* BODY */
.body { flex:1; padding:0.36in 0.55in 0.18in 0.55in; display:flex; flex-direction:column; gap:0.24in; }
.lbl { font-size:8.5pt; font-weight:800; letter-spacing:.15em; text-transform:uppercase; color:var(--a2); margin-bottom:7px; }
.two { display:flex; gap:0.38in; }
.two > div { flex:1; }
p.t { font-size:11pt; line-height:1.5; color:#2E2E2E; }
.cards { display:flex; flex-wrap:wrap; gap:11px; }
.card { flex:1 1 46%; border:1px solid #ECE6DA; border-left:4px solid var(--a); border-radius:8px; padding:12px 15px; background:#FCFBF8; }
.card h4 { font-size:11pt; font-weight:750; margin-bottom:3px; }
.card p { font-size:9.4pt; line-height:1.4; color:#484848; }
.specs { display:flex; flex-wrap:wrap; gap:0; border:1px solid #ECE6DA; border-radius:9px; overflow:hidden; }
.spec { flex:1 1 33.33%; padding:11px 15px; border-top:1px solid #F0ECE2; border-right:1px solid #F0ECE2; }
.spec .k { font-size:7.5pt; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:#9A8F79; }
.spec .v { font-size:9.8pt; font-weight:600; margin-top:2px; color:#222; }
.arch { display:flex; align-items:stretch; gap:0; }
.arch .node { flex:1; background:#FBF7EF; border:1px solid #EFE7D6; border-radius:8px; padding:9px 11px; }
.arch .node .n { font-size:9pt; font-weight:750; color:var(--a2); }
.arch .node .d { font-size:7.8pt; color:#555; line-height:1.3; margin-top:2px; }
.arch .arr { display:flex; align-items:center; padding:0 6px; color:var(--a); font-weight:800; font-size:13pt; }
.proof { background:linear-gradient(135deg,var(--a) 0%, var(--a2) 100%); color:var(--ht); border-radius:11px; padding:15px 18px; }
.proof .q { font-size:11pt; line-height:1.45; font-weight:600; }
.proof .l { font-size:7.5pt; font-weight:800; letter-spacing:.15em; text-transform:uppercase; opacity:.85; margin-bottom:6px; }
.code { font-family:'JBMono',monospace; font-size:9pt; background:#161514; color:#F3EFE7; border-radius:9px; padding:13px 16px; line-height:1.6; }
.code .c { color:#8A8577; }
.code b { color:var(--a); font-weight:600; }
.cta { display:flex; align-items:center; justify-content:space-between; gap:14px; background:#161514; border-radius:11px; padding:15px 19px; }
.cta .txt { color:#fff; }
.cta .txt .h { font-size:12pt; font-weight:750; }
.cta .txt .s { font-size:9pt; color:#B8B2A6; margin-top:2px; }
.cta .cmd { font-family:'JBMono',monospace; font-size:9.6pt; color:var(--a); white-space:nowrap; }
.chips { display:flex; flex-wrap:wrap; gap:8px; }
.chip { font-size:9pt; font-weight:600; border:1px solid #E4DECF; border-radius:20px; padding:5px 13px; color:#444; background:#fff; }
.chip b { color:var(--a2); font-weight:800; }
.trust { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
/* FOOTER */
.ftr { background:#12110F; color:#C9C2B4; padding:0.16in 0.5in; display:flex; justify-content:space-between; align-items:center; font-size:7.4pt; }
.ftr .l { display:flex; align-items:center; gap:8px; }
.ftr img { height:13px; width:13px; border-radius:3px; background:#fff; padding:1px; }
.ftr b { color:#fff; font-weight:700; }
.variant { font-weight:800; letter-spacing:.1em; text-transform:uppercase; color:var(--a); }
"""

def cobrand():
    return ('<div class="cobrand"><img src="ASSETS/legion.png"><span>Legion Code</span>'
            '<span class="x">×</span><span>Activeloop</span><img src="ASSETS/activeloop.png"></div>')

def header(p, variant_label):
    d=PRODUCTS[p]
    return f'''<div class="hdr">{cobrand()}
      <div class="hrow"><img class="badge" src="ASSETS/{p}-badge.png">
        <div class="hmeta"><div class="kicker">The Apiary · {d["cat"]}</div><h1>{d["name"]}</h1></div></div>
      <div class="tag">{d["tagline"]}</div></div>'''

def footer(p, variant_label):
    d=PRODUCTS[p]
    return f'''<div class="ftr"><div class="l"><img src="ASSETS/legion.png"><b>Legion Code Inc.</b>
      <span>in collaboration with Activeloop</span></div>
      <div><span class="variant">{variant_label}</span> &nbsp;·&nbsp; get.theapiary.sh &nbsp;·&nbsp; AGPL-3.0-or-later</div></div>'''

def cards(items):
    return '<div class="cards">'+''.join(f'<div class="card"><h4>{h}</h4><p>{b}</p></div>' for h,b in items)+'</div>'

def specs(items):
    return '<div class="specs">'+''.join(f'<div class="spec"><div class="k">{k}</div><div class="v">{v}</div></div>' for k,v in items)+'</div>'

def arch(items):
    parts=[]
    for i,(n,dd) in enumerate(items):
        if i: parts.append('<div class="arr">›</div>')
        parts.append(f'<div class="node"><div class="n">{n}</div><div class="d">{dd}</div></div>')
    return '<div class="arch">'+''.join(parts)+'</div>'

def proof(d):
    return f'<div class="proof"><div class="l">See it hold up</div><div class="q">{d["proof"]}</div></div>'

def page(p, variant, inner):
    d=PRODUCTS[p]
    style=f'--a:{d["accent"]};--a2:{d["accent2"]};--ht:{d["htext"]};--hs:{d["hsub"]}'
    labels={"buyer":"Overview","technical":"Technical Brief","hybrid":"At a Glance"}
    html=f'''<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head>
      <body><div class="page" style="{style}">{header(p,labels[variant])}
      <div class="body">{inner}</div>{footer(p,labels[variant])}</div></body></html>'''
    return html

def install_cta(d, sub="One command. Installer sets up the whole stack, Doctor included."):
    return (f'<div class="cta"><div class="txt"><div class="h">Get started</div>'
            f'<div class="s">{sub}</div></div>'
            f'<div class="cmd">curl -fsSL https://get.theapiary.sh | sh</div></div>')

def trust_row(p):
    chips=''.join(f'<span class="chip"><b>✓</b> {t}</span>' for t in TRUST[p])
    return f'<div><div class="lbl">Why it holds up</div><div class="trust">{chips}</div></div>'

def build_buyer(p):
    d=PRODUCTS[p]
    inner=f'''
      <div class="two"><div><div class="lbl">The problem</div><p class="t">{d["problem"]}</p></div>
      <div><div class="lbl">The promise</div><p class="t">{d["promise"]}</p></div></div>
      <div><div class="lbl">What you get</div>{cards(d["value"])}</div>
      {trust_row(p)}
      {proof(d)}
      {install_cta(d)}'''
    return page(p,"buyer",inner)

def build_technical(p):
    d=PRODUCTS[p]
    inner=f'''
      <div><div class="lbl">What it is</div><p class="t">{d["promise"]}</p></div>
      <div><div class="lbl">Architecture at a glance</div>{arch(d["arch"])}</div>
      <div><div class="lbl">Key specs</div>{specs(d["specs"])}</div>
      <div class="two"><div><div class="lbl">Install</div>
        <div class="code"><span class="c"># macOS / Linux</span><br>curl -fsSL https://get.theapiary.sh | sh<br><br><span class="c"># standalone</span><br>npm i -g <b>@legioncodeinc/{p}</b></div></div>
      <div><div class="lbl">Integrates with</div><p class="t">{d["integrates"]}</p>
        <div class="lbl" style="margin-top:11px">Binds</div><div class="chips"><span class="chip">{d["port"]}</span><span class="chip">loopback only</span><span class="chip">AGPL-3.0</span></div></div></div>
      <div><div class="lbl">Highlights</div><div class="trust">{''.join('<span class="chip"><b>&#10003;</b> '+t+'</span>' for t in TRUST[p])}</div></div>
      {proof(d)}'''
    return page(p,"technical",inner)

def build_hybrid(p):
    d=PRODUCTS[p]
    v=d["value"][:3]
    inner=f'''
      <div class="two"><div style="flex:1.15"><div class="lbl">Why it matters</div><p class="t">{d["problem"]}</p>
        <p class="t" style="margin-top:8px">{d["promise"]}</p></div>
      <div><div class="lbl">What you get</div>{cards(v)}</div></div>
      <div><div class="lbl">The specs</div>{specs(d["specs"])}</div>
      {install_cta(d)}'''
    return page(p,"hybrid",inner)

def main():
    global ASSETS
    base=os.path.dirname(os.path.abspath(__file__))
    out_html=os.path.join(base,"..","..","outputs","onepager","html")
    out_pdf=os.path.join(base,"..","..","outputs","onepager","pdf")
    assets=os.path.join(base,"..","..","outputs","onepager","assets")
    out_html=os.path.abspath(out_html); out_pdf=os.path.abspath(out_pdf); assets=os.path.abspath(assets)
    os.makedirs(out_html,exist_ok=True); os.makedirs(out_pdf,exist_ok=True)
    builders={"buyer":build_buyer,"technical":build_technical,"hybrid":build_hybrid}
    for p in PRODUCTS:
        for v,fn in builders.items():
            html=fn(p).replace("ASSETS",assets)
            hp=os.path.join(out_html,f"{p}-onepager-{v}.html")
            open(hp,"w",encoding="utf-8").write(html)
            pdf=os.path.join(out_pdf,f"{p}-onepager-{v}.pdf")
            doc=HTML(string=html, base_url=assets).render()
            npages=len(doc.pages)
            doc.write_pdf(pdf)
            print(f"{p:10} {v:10} pages={npages}  {'OK' if npages==1 else 'OVERFLOW'}")

if __name__=="__main__":
    main()
