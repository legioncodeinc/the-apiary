# Patch overly-long copy (Queen), shorten CTA to one line, validate true single-page fit, re-render all.
import onepager_gen as G
from weasyprint import HTML
import os

# One-line CTA sub so the dark CTA never wraps and steals vertical space
def install_cta(d, sub="One command. The whole stack, Doctor included."):
    return (f'<div class="cta"><div class="txt"><div class="h">Get started</div>'
            f'<div class="s">{sub}</div></div>'
            f'<div class="cmd">curl -fsSL https://get.theapiary.sh | sh</div></div>')
G.install_cta = install_cta

# Trim Queen (densest product) so it clears the footer with margin
q = G.PRODUCTS["queen"]
q["problem"] = ("Clean on one machine, the Apiary gets hard to see once it spreads across machines, "
                "teammates, and throwaway workers. Who is alive, who may mint identity, what to cut "
                "when a laptop walks out.")
q["promise"] = ("Queen is the control plane beside the Deeplake data plane. It carries liveness, "
                "identity, enrollment, signed commands, usage observation, and fleet reporting. "
                "Nothing else.")
q["value"] = [
  ("Fleet at a glance","Every agent in your org with derived health, healthy versus offline by heartbeat age."),
  ("Custody stays with you","Your orchestrator holds the Deeplake credential, not the cloud. Queen coordinates blobs it cannot decrypt."),
  ("Enroll without ceremony","Approve a machine in the cloud and a custodian device finishes the rewrap. A headless VPS joins with a join-only token."),
  ("Revocation as policy","Cut a stolen device and rotate the credential as two honest steps, not improv."),
]
q["proof"] = ("Memory and skills stay on Deeplake, where they already work. Queen owns seeing and steering "
              "the fleet that writes to it, and never touches memory content.")

base = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.abspath(os.path.join(base,"..","..","outputs","onepager","assets"))
OUT_H  = os.path.abspath(os.path.join(base,"..","..","outputs","onepager","html"))
OUT_P  = os.path.abspath(os.path.join(base,"..","..","outputs","onepager","pdf"))

def natural_pages(html):
    probe = html.replace("height:11in; display:flex", "min-height:9.9in; display:flex")
    probe = probe.replace("overflow:hidden;", "overflow:visible;")
    return len(HTML(string=probe, base_url=ASSETS).render().pages)

builders={"buyer":G.build_buyer,"technical":G.build_technical,"hybrid":G.build_hybrid}
bad=0
for p in G.PRODUCTS:
    for v,fn in builders.items():
        html=fn(p).replace("ASSETS",ASSETS)
        open(os.path.join(OUT_H,f"{p}-onepager-{v}.html"),"w",encoding="utf-8").write(html)
        real=natural_pages(html)   # stricter: content must fit in <= ~9.9in usable body zone
        HTML(string=html, base_url=ASSETS).write_pdf(os.path.join(OUT_P,f"{p}-onepager-{v}.pdf"))
        flag = "OK" if real==1 else f"TIGHT(content spills, {real}pp probe)"
        if real!=1: bad+=1
        print(f"{p:10} {v:10} {flag}")
print("ALL CLEAR" if bad==0 else f"{bad} still tight")
