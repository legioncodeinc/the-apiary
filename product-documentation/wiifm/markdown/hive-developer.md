# Hive for the AI-Augmented Developer

*The Apiary by Legion Code, in collaboration with Activeloop.*

## Which local port was the dashboard on again?

The Apiary runs several services on your machine, each on its own port, and hunting across loopback tabs is nobody's idea of a dashboard. Hive is the front door: one always-on address at 127.0.0.1:3853 that serves the whole thing. Bookmark it once and you are done.

### Why one address instead of a port per service?

Because port-hunting is not your job. Hive serves memories, projects, the graphs, sync, logs, ROI, and settings from a single URL, with a live health rail on every page so you always know the state of the fleet.

### What do I see if I open it mid-boot?

An honest readiness screen, one bee per service, that dismisses itself the moment the fleet is ready. You never get a broken page or a false first-time-setup screen just because something was still waking up.

### A panel says unreachable. Is my data gone?

No. It means that one service is not answering right now; Doctor restarts it and the panel recovers on its own. The rest of the dashboard keeps working the whole time.

### Is it exposed to the network?

No. Hive binds to 127.0.0.1 only, so nothing off your machine can reach it, and it passes your session straight through to the services that own your data while storing nothing itself.
