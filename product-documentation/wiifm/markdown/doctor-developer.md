# Doctor for the AI-Augmented Developer

*The Apiary by Legion Code, in collaboration with Activeloop.*

## What happens to your agent's memory when a daemon dies at 2am?

Your memory stack runs on local daemons, and when one dies quietly overnight you pay the next morning: a session that forgot everything and twenty minutes re-explaining a codebase your agent knew yesterday. Doctor watches the whole stack, heals what breaks, and has your memory back before your next prompt, usually without you noticing.

### A daemon crashed. Do I have to fix it?

No. Doctor probes every service every 30 seconds and climbs a repair ladder: restart, reinstall after repeated fails, remove a conflicting package, back off, and stop the instant health returns. Kill one on purpose and it is typically back within one probe.

### Will it nag me?

No. A healthy check is a single debug line, so Doctor stays silent on the happy path. It only speaks up when the ladder runs out, and then it writes a plain do-this-next report on a local status page.

### Could an auto-update brick my setup?

No. Doctor updates the memory daemon only behind a blessed-release gate, verifies health afterward, and rolls a bad update back automatically. A broken release cannot spread itself to your machine.

### Can it touch my credentials?

Never. Doctor has no code that can read or delete your credentials file. If it suspects a credential problem it tells you and stops, full stop.
