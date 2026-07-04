# Queen for the AI-Augmented Developer

*The Apiary by Legion Code, in collaboration with Activeloop.*

## Your agents are spreading across machines. How do you keep them one identity, not a mess?

The Apiary is clean on one laptop. The moment you add a second machine, a VPS, or throwaway workers, you need to know which agents are alive and who is allowed to join, without handing your memory to the cloud. Queen coordinates all of that and never reads your memory content. (Coming soon.)

### Do I have to open two laptops to add a device?

No. Approve the new device in the cloud and an existing trusted machine finishes the cryptographic handoff next time it is online. A headless VPS joins with a short-lived token whose only power is to let it in, it cannot read or decrypt anything.

### Can I see all my agents in one place?

Yes. A read-only fleet view shows every agent with a derived health state, so an idle-but-fine daemon and a crashed one stop looking identical. It is scoped to your own fleet, nothing more.

### Does the cloud hold my credentials or memory?

No. Your orchestrator holds the Deeplake credential; the cloud coordinates identity and presence and stores only encrypted blobs it cannot open. No prompts, no session text, no plaintext keys.

### What if I lose a device?

Revoke it and rotate your credential, two clear steps, and it is cut off. Lose every trusted device and the answer is a written re-link path, never a hidden backdoor.
