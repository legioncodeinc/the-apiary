# Apiary Desktop Shell

Electron main process that will supervise the Apiary fleet (Honeycomb, Nectar, Doctor, Hive) and render the Hive dashboard in a native window. See `library/requirements/backlog/prd-005-desktop-shell/` for the full spec.

- `npm install` — install dependencies
- `npm start` — build then launch the app
- `npm test` — run the Vitest suite

Scope note: this is currently a scaffold only. Supervisor, window/IPC, tray, and service logic are unimplemented (see `TODO` markers and the empty `src/{supervisor,window,tray,service}/` directories) — later PRD-005 waves fill them in.
