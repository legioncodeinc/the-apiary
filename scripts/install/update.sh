#!/bin/sh
# Apiary one-command fleet UPDATE script (POSIX sh); the-apiary PRD-007.
#
# Usage (the single line a user pastes to move the installed fleet to the blessed set):
#   curl -fsSL https://get.theapiary.sh/update | sh
#
# Opt into the newest published bytes (bypasses the tested fleet set):
#   curl -fsSL https://get.theapiary.sh/update | sh -s -- --latest
#
# Preview only (resolve + print, mutate nothing, send no telemetry):
#   curl -fsSL https://get.theapiary.sh/update | sh -s -- --dry-run
#
# Contract (PRD-007 AC-1..AC-10): this is the THIRD lifecycle script beside install.sh and
# uninstall.sh. It detects which Apiary products are actually installed on the machine and, BY
# DEFAULT, moves each to its hive-release.json manifest-pinned (blessed) version -- matching the
# installer's deliberate no-`@latest` invariant. It is IDEMPOTENT (already-current machines make no
# npm mutation and restart nothing), FAIL-SOFT (one product's failure never blocks the rest), and
# NON-DESTRUCTIVE (it never `npm uninstall`s, never deletes state, and never leaves a daemon stopped
# without saying so). After a package moves it converges + restarts that product's service so the
# running daemon serves the new code, and (when the honeycomb package moved) refreshes the coding
# assistant plugin. It reports on the same anonymous install-site PostHog channel as the installer.
#
# POSIX sh ONLY (no bashisms): this runs under `sh`, which may be dash/ash, not bash.
#
# "mirror, don't share" (PRD-007 Decided): rather than source a shared fragment, this script carries
# its OWN copies of the installer's telemetry seam and manifest resolver, exactly as install.ps1
# mirrors install.sh. Each mirrored function is tagged `# SYNC: mirror of <file> <fn>` so a
# maintainer editing one copy knows to update the other.

# `set -e` would abort on the FIRST non-zero command, surfacing a raw error. We instead handle every
# failure explicitly and print a plain-language line (parent AC-9); so `set -e` is intentionally OFF.
set -u

# ─────────────────────────────────────────────────────────────────────────────
# The Node LTS the installer provisions (referenced only in the "Node is missing" copy below; the
# updater assumes a working Node/npm and never bootstraps one -- that is an installer concern).
# ─────────────────────────────────────────────────────────────────────────────
HONEYCOMB_NODE_VERSION="22"

# Distribution base URL (used only in the "re-run" copy of the Node-missing message).
HONEYCOMB_INSTALL_BASE_URL="https://get.theapiary.sh"

# ── The fleet release manifest (the-apiary superproject's hive-release.json). Same URL + raw-GitHub
# fallback as install.sh; the updater never hardcodes "latest" for a product it did not itself
# publish -- it resolves each installed product's exact pinned version from THIS manifest (unless
# --latest is passed, which bypasses it). Overridable via env purely for local testing. ──
HONEYCOMB_MANIFEST_URL="${HONEYCOMB_MANIFEST_URL:-https://get.theapiary.sh/hive-release.json}"
HONEYCOMB_MANIFEST_FALLBACK_URL="https://raw.githubusercontent.com/legioncodeinc/the-apiary/main/hive-release.json"

# ── Telemetry destination (PRD-007c). The key is EMPTY in source control BY DESIGN; this exact
# `HONEYCOMB_INSTALL_POSTHOG_KEY=""` line is the one site/install/build.mjs patches (via an anchored
# regex on this literal line) at deploy time, injecting the real PostHog project key. An empty value
# (any un-built/local/dev copy) makes `phone_home` a silent no-op; never a hard failure. The same
# public install-site channel, key seam, endpoint, and payload shape as the installer -- only the
# event NAMES differ (update_started / update_completed / update_failed, reusing product_updated). ──
HONEYCOMB_INSTALL_POSTHOG_KEY=""
HONEYCOMB_INSTALL_POSTHOG_HOST="https://us.i.posthog.com"
HONEYCOMB_INSTALL_POSTHOG_PATH="/i/v0/e/"
HONEYCOMB_INSTALL_ID_FILE="${HOME}/.honeycomb/install-id"

# ── Globals (all `set -u` safe: declared up-front so every later reference is well-defined). ──
DRY_RUN=0
LATEST=0
INSTALL_ID=""
IS_REPEAT_INSTALL="false"
# phone_home reads SEL_PRODUCTS/SEL_PROFILE. On update, `products` is "the products that moved"
# (PRD-007c) and there is no profile concept, so SEL_PROFILE stays empty. SEL_PRODUCTS is set to the
# moved list just before the terminal telemetry fires.
SEL_PRODUCTS=""
SEL_PROFILE=""
# Comma list of product slugs that ACTUALLY moved this run (drives product_updated + the summary).
MOVED_PRODUCTS=""
MOVED_COUNT=0
# How many products were detected installed (distinguishes "nothing installed" from "all current").
INSTALLED_COUNT=0
# Set when any INSTALLED product that should have moved failed to update (mirrors install.sh's
# EXTRA_PRODUCT_FAILED): the run reports update_failed / exits non-zero, but only AFTER attempting
# every product (fail-soft, never aborts the loop).
ANY_FAILED=0
# Set when the plugin-bearing `honeycomb` package moved (gates the 007b harness/plugin refresh).
HONEYCOMB_MOVED=0
# Populated by detect_harnesses (007b): HARNESS_STATE in {detected,none,unknown}; HARNESS_OUT is the
# harness list printed when detected. Declared here so every reference is `set -u` safe.
HARNESS_STATE=""
HARNESS_OUT=""

# ── Friendly progress log: step lines to stdout, the single failure summary to stderr. ASCII-only
# prefixes (matching uninstall.sh) so a non-UTF-8 pipe never corrupts them. ──
step() { printf '%s\n' "-> $1"; }
ok()   { printf '[ok] %s\n' "$1"; }
warn() { printf '[warn] %s\n' "$1"; }
fail() { printf 'Apiary update could not continue: %s\n' "$1" >&2; }

# `command -v` is the POSIX way to test for a binary (NOT `which`, which is not guaranteed present).
have() { command -v "$1" >/dev/null 2>&1; }

# is_windows_shell: true under git-bash/MSYS/Cygwin, where pid files carry WINDOWS pids that
# `kill -0`/`ps` cannot see (the probe/kill go through PowerShell there).
# SYNC: mirror of uninstall.sh is_windows_shell
is_windows_shell() {
	case "$(uname -s 2>/dev/null || printf 'unknown')" in
		MINGW*|MSYS*|CYGWIN*) return 0 ;;
		*) return 1 ;;
	esac
}

print_usage() {
	cat <<'USAGE'
Usage: update.sh [--latest] [--dry-run] [--help]

  --latest    Update each installed product to its npm 'latest' dist-tag instead of the blessed
              (hive-release.json-pinned) version. Prints a warning; bypasses the tested fleet set.
  --dry-run   Resolve and print every product's current -> target decision and the services it
              would restart; mutate nothing and send no real telemetry (preview only).
  --help,-h   Show this help text.

By default (no flag) every INSTALLED Apiary product is moved to its blessed, manifest-pinned
version; a product that is not installed is left untouched (this is an update, not an installer).
Env equivalent for --latest: APIARY_UPDATE_LATEST=1.
USAGE
}

# Scan argv for the flags this script consumes. `--help`/`-h` is handled by main BEFORE any
# telemetry (a usage request is not a "run"); an unknown flag is a plain usage error (also
# pre-telemetry). Also reads the APIARY_UPDATE_LATEST env equivalent (a-AC-1b: --latest is strictly
# opt-in and never implied by any other flag or default).
parse_args() {
	case "${APIARY_UPDATE_LATEST:-}" in
		1|true|TRUE|True) LATEST=1 ;;
	esac
	for a in "$@"; do
		case "$a" in
			--dry-run) DRY_RUN=1 ;;
			--latest)  LATEST=1 ;;
			--help|-h) : ;;
			*)
				fail "Unknown flag: $a. Use --help to see supported flags."
				return 1
				;;
		esac
	done
	return 0
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════
# PRD-007c; anonymous install id + phone-home (ported verbatim from install.sh: same id file, same
# endpoint, same body shape, same 3s timeout, same empty-key no-op -- only the event names differ).
# ═══════════════════════════════════════════════════════════════════════════════════════════════

# SYNC: mirror of install.sh generate_uuid
# Best-effort UUID-shaped id. ANONYMOUS (no hostname/username/MAC ever folds in, at any tier).
generate_uuid() {
	if have uuidgen; then uuidgen; return 0; fi
	if [ -r /proc/sys/kernel/random/uuid ]; then cat /proc/sys/kernel/random/uuid; return 0; fi
	if have od; then
		hex="$(od -An -N16 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n')"
		if [ "${#hex}" -eq 32 ]; then
			printf '%s-%s-4%s-%s-%s\n' \
				"$(printf '%s' "$hex" | cut -c1-8)" \
				"$(printf '%s' "$hex" | cut -c9-12)" \
				"$(printf '%s' "$hex" | cut -c14-16)" \
				"$(printf '%s' "$hex" | cut -c17-20)" \
				"$(printf '%s' "$hex" | cut -c21-32)"
			return 0
		fi
	fi
	printf 'nohd-%s-%s\n' "$(date +%s 2>/dev/null || echo 0)" "$$"
}

# SYNC: mirror of install.sh resolve_install_id
# Resolve (or, outside --dry-run, mint + persist) the stable anonymous install id (c-AC-5). The
# updater READS the same ~/.honeycomb/install-id the installer wrote; IS_REPEAT_INSTALL is "true"
# iff the id file already existed (an update is inherently a repeat interaction, but the semantics
# stay identical to the installer's -- PRD-007c keeps the field as-is). In --dry-run this NEVER
# writes: an ephemeral id is generated in-memory purely for the preview.
resolve_install_id() {
	if [ -f "$HONEYCOMB_INSTALL_ID_FILE" ] && [ -s "$HONEYCOMB_INSTALL_ID_FILE" ]; then
		INSTALL_ID="$(cat "$HONEYCOMB_INSTALL_ID_FILE" 2>/dev/null | tr -d '\n')"
		IS_REPEAT_INSTALL="true"
		return 0
	fi
	INSTALL_ID="$(generate_uuid)"
	IS_REPEAT_INSTALL="false"
	if [ "$DRY_RUN" -ne 1 ]; then
		mkdir -p "$(dirname "$HONEYCOMB_INSTALL_ID_FILE")" 2>/dev/null
		printf '%s\n' "$INSTALL_ID" > "$HONEYCOMB_INSTALL_ID_FILE" 2>/dev/null || true
	fi
}

# SYNC: mirror of install.sh phone_home
# Fire ONE PostHog capture event. FAIL-SOFT + BOUNDED (--max-time 3): a slow/unreachable endpoint
# never hangs or breaks the update. Same endpoint + body shape as install.sh; only `curl` is needed,
# so it fires even before the honeycomb CLI is resolved. Allow-list-shaped payload (no PII; never a
# license/code value -- there are none in this script anyway): products, profile, coarse OS family,
# repeat-vs-first, and the event name (doubling as a coarse terminal-status label). The optional
# second arg is the per-product transition field appended as `"product":"<slug>"`.
# phone_home <event> [product]
phone_home() {
	event="$1"
	product="${2:-}"
	if [ "$DRY_RUN" -eq 1 ]; then
		if [ -n "$product" ]; then
			printf '[dry-run] would phone home: %s (product=%s, install_id=%s, repeat=%s, products=%s, profile=%s)\n' \
				"$event" "$product" "${INSTALL_ID:-unknown}" "$IS_REPEAT_INSTALL" "${SEL_PRODUCTS:-<none>}" "${SEL_PROFILE:-<none>}"
		else
			printf '[dry-run] would phone home: %s (install_id=%s, repeat=%s, products=%s, profile=%s)\n' \
				"$event" "${INSTALL_ID:-unknown}" "$IS_REPEAT_INSTALL" "${SEL_PRODUCTS:-<none>}" "${SEL_PROFILE:-<none>}"
		fi
		return 0
	fi
	[ -z "$HONEYCOMB_INSTALL_POSTHOG_KEY" ] && return 0
	have curl || return 0
	product_prop=""
	[ -n "$product" ] && product_prop="$(printf ',"product":"%s"' "$product")"
	body=$(printf '{"api_key":"%s","event":"%s","distinct_id":"%s","properties":{"products":"%s","profile":"%s","os":"%s","repeat_install":"%s"%s}}' \
		"$HONEYCOMB_INSTALL_POSTHOG_KEY" "$event" "${INSTALL_ID:-unknown}" "${SEL_PRODUCTS:-}" "${SEL_PROFILE:-}" \
		"$(uname -s 2>/dev/null || echo unknown)" "$IS_REPEAT_INSTALL" "$product_prop")
	curl -fsS --max-time 3 -H 'Content-Type: application/json' -d "$body" \
		"${HONEYCOMB_INSTALL_POSTHOG_HOST}${HONEYCOMB_INSTALL_POSTHOG_PATH}" >/dev/null 2>&1 || true
	return 0
}

# SYNC: mirror of install.sh finish (event names retargeted for update)
# Terminal-state telemetry (c-AC-6): every exit from main() funnels through here so exactly one of
# update_completed / update_failed always fires -- including a failure BEFORE the honeycomb CLI ever
# runs (e.g. Node missing).
finish() {
	code="$1"
	if [ "$code" -eq 0 ]; then
		phone_home update_completed
	else
		phone_home update_failed
	fi
	exit "$code"
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════
# PRD-007a; manifest resolver (mirrored from install.sh; the security-critical safe-shape validation
# is kept intact so a tampered manifest field can never reach npm/the shell unvalidated).
# ═══════════════════════════════════════════════════════════════════════════════════════════════

_MANIFEST_JSON=""
_MANIFEST_FETCHED=0

# SYNC: mirror of install.sh fetch_manifest
# Fetch the manifest ONCE per run (cached in _MANIFEST_JSON); a network failure is remembered too
# (no per-field retry) and surfaces as "unresolved" to every caller.
fetch_manifest() {
	[ "$_MANIFEST_FETCHED" -eq 1 ] && { [ -n "$_MANIFEST_JSON" ]; return $?; }
	_MANIFEST_FETCHED=1
	have curl || return 1
	_MANIFEST_JSON="$(curl -fsSL --max-time 5 "$HONEYCOMB_MANIFEST_URL" 2>/dev/null)" || _MANIFEST_JSON=""
	if [ -z "$_MANIFEST_JSON" ]; then
		_MANIFEST_JSON="$(curl -fsSL --max-time 5 "$HONEYCOMB_MANIFEST_FALLBACK_URL" 2>/dev/null)" || _MANIFEST_JSON=""
	fi
	[ -n "$_MANIFEST_JSON" ] || return 1
	return 0
}

# SYNC: mirror of install.sh manifest_field
# manifest_field <slug> <field>; prints the field's value, or nothing (+ returns 1) if unresolved.
# Parses JSON via `node` (guaranteed present by the time a real caller reaches here) rather than a
# hand-rolled sed/grep parser for a document this script does not control byte-for-byte.
manifest_field() {
	slug="$1"; field="$2"
	fetch_manifest || return 1
	have node || return 1
	printf '%s' "$_MANIFEST_JSON" | node -e '
		let raw = "";
		process.stdin.on("data", (d) => { raw += d; });
		process.stdin.on("end", () => {
			try {
				const m = JSON.parse(raw);
				const p = m && m.products && m.products[process.argv[1]];
				if (!p || p[process.argv[2]] === undefined) process.exit(1);
				process.stdout.write(String(p[process.argv[2]]));
			} catch (e) { process.exit(1); }
		});
	' "$slug" "$field" 2>/dev/null
}

# SYNC: mirror of install.sh npm_package_name_is_safe
# A conservative safe-character allowlist matching real npm package-name rules (lowercase, digits,
# `.`/`_`/`-`, optionally `@scope/name`); makes it structurally impossible to smuggle a shell/cmd
# metacharacter through a manifest-sourced package name.
npm_package_name_is_safe() {
	case "$1" in
		@[a-z0-9]*/[a-z0-9]*)
			scope="${1%%/*}"; name="${1#*/}"
			case "$scope" in @*[!a-z0-9._-]*|@) return 1 ;; esac
			case "$name" in *[!a-z0-9._-]*|"") return 1 ;; esac
			return 0
			;;
		[a-z0-9]*)
			case "$1" in *[!a-z0-9._-]*) return 1 ;; esac
			return 0
			;;
		*) return 1 ;;
	esac
}

# SYNC: mirror of install.sh semver_is_safe
# digits.digits.digits with an optional -prerelease / +build suffix drawn from the same safe set.
semver_is_safe() {
	case "$1" in
		[0-9]*.[0-9]*.[0-9]*)
			case "$1" in *[!0-9A-Za-z.+-]*) return 1 ;; esac
			return 0
			;;
		*) return 1 ;;
	esac
}

# SYNC: mirror of install.sh resolve_product_target
# Resolve the manifest-pinned npm target for a product slug. Prints exactly one of:
#   "ok <pkg>@<version>"   -- the blessed target to install
#   "unpublished <pkg>"    -- manifest declares published:false; skip (never fall back to @latest)
#   "unresolved <pkg>"     -- manifest unreachable/malformed OR a field failed the safe-shape check;
#                             the updater treats this as "leave the product at its current version"
#                             in blessed mode (a-AC-4: never a silent @latest fallback here).
resolve_product_target() {
	slug="$1"; fallback_pkg="$2"
	pkg="$(manifest_field "$slug" packageName)"
	if [ -z "$pkg" ] || ! npm_package_name_is_safe "$pkg"; then pkg="$fallback_pkg"; fi
	version="$(manifest_field "$slug" version)"
	if [ -z "$version" ] || ! semver_is_safe "$version"; then
		printf 'unresolved %s\n' "$pkg"
		return 0
	fi
	published="$(manifest_field "$slug" published)"
	if [ "$published" = "false" ]; then
		printf 'unpublished %s\n' "$pkg"
		return 0
	fi
	printf 'ok %s@%s\n' "$pkg" "$version"
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════
# Installed-product detection + version reads (npm ls -g, exactly uninstall.sh's probe).
# ═══════════════════════════════════════════════════════════════════════════════════════════════

# is_installed <pkg>: true when the global npm package is present (a-AC-3 authoritative signal).
is_installed() {
	npm ls -g "$1" --depth=0 >/dev/null 2>&1
}

# installed_version <pkg>: prints the currently-installed global version, or nothing. Reads
# `npm ls -g --json` and parses with `node` (present here, the same posture install.sh uses to parse
# the manifest) rather than grepping npm's human output.
installed_version() {
	have npm || return 1
	have node || return 1
	npm ls -g "$1" --depth=0 --json 2>/dev/null | node -e '
		let raw = "";
		process.stdin.on("data", (d) => { raw += d; });
		process.stdin.on("end", () => {
			try {
				const j = JSON.parse(raw);
				const deps = j && j.dependencies;
				const e = deps && deps[process.argv[1]];
				if (!e || !e.version) process.exit(1);
				process.stdout.write(String(e.version));
			} catch (err) { process.exit(1); }
		});
	' "$1" 2>/dev/null
}

# Resolve the ABSOLUTE path to an installed product bin. `npm i -g` does NOT refresh the CURRENT
# shell's PATH, so calling a bin by bare name in the same run can fail "command not found"; resolve
# `<npm prefix -g>/bin/<bin>` and invoke THAT (generalized from install.sh's resolve_honeycomb_bin).
resolve_bin() {
	if have "$1"; then command -v "$1"; return 0; fi
	rb_prefix="$(npm prefix -g 2>/dev/null)"
	if [ -n "$rb_prefix" ] && [ -x "${rb_prefix}/bin/$1" ]; then
		printf '%s\n' "${rb_prefix}/bin/$1"
		return 0
	fi
	return 1
}

# Record a product that actually moved (feeds product_updated telemetry + the completion summary).
record_moved() {
	MOVED_PRODUCTS="${MOVED_PRODUCTS}${MOVED_PRODUCTS:+,}$1"
	MOVED_COUNT=$((MOVED_COUNT + 1))
	[ "$1" = "honeycomb" ] && HONEYCOMB_MOVED=1
	return 0
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════
# Service restart (PRD-007a Decided: converge-first, recycle-only-if-needed).
# ═══════════════════════════════════════════════════════════════════════════════════════════════

# SYNC: mirror of uninstall.sh pid_image_name
# Prints the pid's image name, or nothing when the pid is not alive.
pid_image_name() {
	pin_pid="$1"
	if is_windows_shell; then
		powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"ProcessId=$pin_pid\" -ErrorAction SilentlyContinue).Name" 2>/dev/null | tr -d '\r\n '
		return 0
	fi
	if kill -0 "$pin_pid" >/dev/null 2>&1; then
		ps -p "$pin_pid" -o comm= 2>/dev/null | tr -d ' '
	fi
	return 0
}

# Recycle one product's running daemon by pid file so it reloads the new bytes. Verifies a LIVE NODE
# process before signalling (pid-reuse safe, a-AC-6). Returns 0 iff it actually stopped a daemon.
# SYNC: mirror of uninstall.sh stop_daemon_pidfile (recycle, not remove: the service manager/Doctor
# restarts the daemon after this; we re-converge afterwards to guarantee it comes back up).
recycle_one_pidfile() {
	rop_pidfile="$1"; rop_label="$2"
	[ -f "$rop_pidfile" ] || return 1
	rop_pid="$(head -c 32 "$rop_pidfile" 2>/dev/null | tr -cd '0-9')"
	[ -n "$rop_pid" ] || return 1
	rop_image="$(pid_image_name "$rop_pid")"
	if [ -z "$rop_image" ]; then
		step "no running $rop_label daemon (stale pid file)."
		return 1
	fi
	case "$rop_image" in
		node|node.exe|*/node) ;;
		*)
			warn "pid $rop_pid from the $rop_label pid file is not a node process ($rop_image); leaving it alone (pid reuse)."
			return 1
			;;
	esac
	if is_windows_shell; then
		powershell -NoProfile -Command "Stop-Process -Id $rop_pid -Force -ErrorAction SilentlyContinue" >/dev/null 2>&1 || true
	else
		kill "$rop_pid" >/dev/null 2>&1 || true
		sleep 1
		kill -0 "$rop_pid" >/dev/null 2>&1 && kill -9 "$rop_pid" >/dev/null 2>&1 || true
	fi
	ok "recycled the running $rop_label daemon (pid $rop_pid) so it restarts on the new version."
	return 0
}

# Converge a moved product's service onto the new bytes, then recycle its daemon only if it is still
# running old code (a-AC-5/6/7). Converge ALWAYS runs before any kill so Doctor cannot race-restart
# the old code. Signature: converge_and_recycle <display> <bin> <verb> [pidfile...] -- doctor passes
# no pid files (it is the watchdog; it converges last and is never recycled here).
converge_and_recycle() {
	cr_display="$1"; cr_bin="$2"; cr_verb="$3"
	shift 3

	cr_prodbin="$(resolve_bin "$cr_bin")"
	if [ -z "$cr_prodbin" ]; then
		warn "$cr_display updated but its '$cr_bin' command could not be located to restart its service. Open a new terminal (so PATH refreshes) and run: $cr_bin $cr_verb"
		return 0
	fi

	step "converging the $cr_display service ($cr_bin $cr_verb)..."
	# $cr_verb is a single trusted literal token (install / install-service); left unquoted to match
	# install.sh's post-install verb invocation.
	if "$cr_prodbin" $cr_verb >/dev/null 2>&1; then
		ok "$cr_display service converged on the new version."
	else
		warn "$cr_display updated but '$cr_bin $cr_verb' did not complete. Run '$cr_bin $cr_verb' to finish pointing its service at the new version."
		return 0
	fi

	# Recycle (only AFTER converge). "$@" preserves pid-file paths that contain spaces.
	cr_recycled=0
	for cr_pf in "$@"; do
		[ -n "$cr_pf" ] || continue
		if recycle_one_pidfile "$cr_pf" "$cr_display"; then
			cr_recycled=1
		fi
	done

	# If we recycled, re-run the idempotent converge verb so the daemon is brought back up on the new
	# bytes -- so this step never LEAVES a daemon stopped (AC-9), even without Doctor / a keepalive.
	if [ "$cr_recycled" -eq 1 ]; then
		if "$cr_prodbin" $cr_verb >/dev/null 2>&1; then
			ok "$cr_display daemon restarted on the new version."
		else
			warn "$cr_display daemon was recycled but did not restart automatically. Run '$cr_bin $cr_verb' to bring it back up."
		fi
	fi
	return 0
}

# Compute the fleet root for pid files: the default ~/.apiary, or an absolute APIARY_HOME override.
fleet_root() {
	fr_root="${HOME}/.apiary"
	case "${APIARY_HOME:-}" in
		/*) fr_root="${APIARY_HOME}" ;;
	esac
	printf '%s' "$fr_root"
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════
# Per-product update: detect installed -> resolve target -> skip-if-current -> npm i -g -> converge.
# ═══════════════════════════════════════════════════════════════════════════════════════════════
# update_one_product <display> <slug> <pkg> <bin> <verb>
update_one_product() {
	uop_display="$1"; uop_slug="$2"; uop_pkg="$3"; uop_bin="$4"; uop_verb="$5"

	# a-AC-3 / AC-4: only INSTALLED products are touched. An absent product is never mentioned as
	# updated (this is an update, not an installer).
	if ! is_installed "$uop_pkg"; then
		step "$uop_display is not installed; skipping."
		return 0
	fi
	INSTALLED_COUNT=$((INSTALLED_COUNT + 1))

	uop_cur="$(installed_version "$uop_pkg")"

	# Resolve the target version + install target string per mode.
	if [ "$LATEST" -eq 1 ]; then
		# a-AC-1b: --latest bypasses the manifest; compare the installed version to `npm view` so the
		# idempotent no-op + single-product_updated-per-move properties still hold without a pin.
		uop_target_ver="$(npm view "$uop_pkg" version 2>/dev/null | tr -d '[:space:]')"
		if [ -z "$uop_target_ver" ] || ! semver_is_safe "$uop_target_ver"; then
			warn "could not resolve the npm latest version for $uop_display; leaving it at ${uop_cur:-its current version}."
			return 0
		fi
		uop_target="${uop_pkg}@latest"
	else
		uop_resolved="$(resolve_product_target "$uop_slug" "$uop_pkg")"
		uop_kind="${uop_resolved%% *}"
		uop_payload="${uop_resolved#* }"
		case "$uop_kind" in
			ok)
				uop_target="$uop_payload"
				# uop_payload is "<@scope/pkg>@<ver>"; the version is after the LAST '@'.
				uop_target_ver="${uop_payload##*@}"
				;;
			unpublished)
				# a-AC-4: never fall back to @latest in blessed mode; leave it and continue.
				step "could not resolve the blessed version for $uop_display (not yet published); leaving it at ${uop_cur:-its current version}."
				return 0
				;;
			*)
				step "could not resolve the blessed version for $uop_display; leaving it at ${uop_cur:-its current version}."
				return 0
				;;
		esac
	fi

	# a-AC-2 / a-AC-1b-2 (idempotent skip): installed already equals target -> no npm, no restart.
	if [ -n "$uop_cur" ] && [ "$uop_cur" = "$uop_target_ver" ]; then
		ok "$uop_display already current ($uop_cur)."
		return 0
	fi

	# a-AC-10 (--dry-run): resolve + print the move and the services it would restart; mutate nothing.
	if [ "$DRY_RUN" -eq 1 ]; then
		printf '[dry-run] %s: %s -> %s\n' "$uop_display" "${uop_cur:-unknown}" "$uop_target_ver"
		printf '[dry-run] would run: npm install -g %s\n' "$uop_target"
		printf '[dry-run] would converge the %s service: %s %s\n' "$uop_display" "$uop_bin" "$uop_verb"
		case "$uop_slug" in
			honeycomb|hive|nectar) printf '[dry-run] would recycle the %s daemon (pid file) after converge if it is still running old code\n' "$uop_display" ;;
		esac
		record_moved "$uop_slug"
		return 0
	fi

	# a-AC-1: move the package. Fail-soft per product (warn + mark failed, continue) -- never abort
	# the loop (AC-9), mirroring install_extra_product.
	step "updating $uop_display ($uop_cur -> $uop_target_ver)..."
	if ! npm install -g "$uop_target" >/dev/null 2>&1; then
		warn "could not update $uop_display (leaving it at ${uop_cur:-its current version}). Try: npm install -g $uop_target"
		ANY_FAILED=1
		return 0
	fi
	uop_new="$(installed_version "$uop_pkg")"
	ok "$uop_display updated ($uop_cur -> ${uop_new:-$uop_target_ver})."
	record_moved "$uop_slug"

	# a-AC-5/6/7: converge the service, then recycle its daemon (converge-first). doctor gets no pid
	# file (watchdog; never recycled here).
	uop_fr="$(fleet_root)"
	case "$uop_slug" in
		honeycomb) converge_and_recycle "$uop_display" "$uop_bin" "$uop_verb" "${uop_fr}/honeycomb/daemon.pid" "${HOME}/.honeycomb/daemon.pid" ;;
		hive)      converge_and_recycle "$uop_display" "$uop_bin" "$uop_verb" "${uop_fr}/hive/hive.pid" ;;
		nectar)    converge_and_recycle "$uop_display" "$uop_bin" "$uop_verb" "${uop_fr}/nectar/nectar.pid" ;;
		doctor)    converge_and_recycle "$uop_display" "$uop_bin" "$uop_verb" ;;
	esac
	return 0
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════
# PRD-007b; harness detection + Claude Code plugin refresh (gated on the honeycomb package moving).
# The shell owns ORDERING + REPORTING; honeycomb owns the wiring -- we invoke its CLI, never
# re-implement detection or the connector in shell (no hardcoded ~/.claude paths).
# ═══════════════════════════════════════════════════════════════════════════════════════════════

# Detect installed harnesses via honeycomb's OWN CLI surface (b-AC-1/b-AC-6), never re-implemented
# in shell. The verb is `honeycomb harness status` (verified on the blessed v0.8.0 build; the older
# `honeycomb harnesses` does not exist and exits 1). PREFERS `honeycomb harness status --json`
# (PRD-006c/006d) so the "none detected" case is caught robustly even when a build emits an empty
# JSON array/object; falls back to the plain-text `honeycomb harness status` when --json exits
# non-zero, and treats a non-JSON body (this blessed build prints plain text for --json too) as the
# already-human-readable report. Sets two globals consumed by refresh_harnesses:
#   HARNESS_STATE = detected | none | unknown
#   HARNESS_OUT   = the harness list to print (when detected)
detect_harnesses() {
	dh_bin="$1"
	HARNESS_STATE="unknown"
	HARNESS_OUT=""

	dh_out="$("$dh_bin" harness status --json 2>/dev/null)"
	dh_st=$?
	if [ "$dh_st" -ne 0 ]; then
		# --json errored (an older pin without the flag): fall back to the plain-text form.
		dh_out="$("$dh_bin" harness status 2>/dev/null)"
		dh_st=$?
	fi
	if [ "$dh_st" -ne 0 ]; then
		HARNESS_STATE="unknown"
		return 0
	fi

	# Try to interpret the output as JSON so an empty array/object reliably reads as "none". A
	# non-JSON body (the current blessed build prints plain text for --json) makes `node` exit 2 and
	# falls through to the plain-text handling below.
	if have node; then
		dh_parsed="$(printf '%s' "$dh_out" | node -e '
			let raw = "";
			process.stdin.on("data", (d) => { raw += d; });
			process.stdin.on("end", () => {
				let j;
				try { j = JSON.parse(raw); } catch (e) { process.exit(2); }
				let items = [];
				if (Array.isArray(j)) items = j;
				else if (j && Array.isArray(j.harnesses)) items = j.harnesses;
				else if (j && typeof j === "object") items = Object.keys(j).map((k) => {
					const v = j[k];
					return (v && typeof v === "object") ? Object.assign({ name: k }, v) : { name: k, value: v };
				});
				for (const it of items) {
					if (it == null) continue;
					if (typeof it === "string") { process.stdout.write(it + "\n"); continue; }
					const name = it.name || it.harness || it.id || "";
					const status = it.status || it.state || "";
					let plugin = "";
					if (it.pluginEnabled !== undefined) plugin = "plugin " + (it.pluginEnabled ? "enabled" : "disabled");
					const detail = [status, plugin].filter(Boolean).join(", ");
					const line = detail ? (name + ": " + detail) : (name || JSON.stringify(it));
					process.stdout.write(line + "\n");
				}
				process.exit(0);
			});
		' 2>/dev/null)"
		dh_pst=$?
		if [ "$dh_pst" -eq 0 ]; then
			if [ -n "$dh_parsed" ]; then
				HARNESS_STATE="detected"
				HARNESS_OUT="$dh_parsed"
			else
				HARNESS_STATE="none"
			fi
			return 0
		fi
	fi

	# Not JSON: the plain-text status IS the human-readable report. Non-blank -> detected.
	dh_trim="$(printf '%s' "$dh_out" | tr -d '[:space:]')"
	if [ -n "$dh_trim" ]; then
		HARNESS_STATE="detected"
		HARNESS_OUT="$dh_out"
	else
		HARNESS_STATE="none"
	fi
	return 0
}

refresh_harnesses() {
	rh_bin="$(resolve_bin honeycomb)"
	if [ -z "$rh_bin" ]; then
		# b-AC-3: honeycomb CLI not on PATH -> print the exact next command, never claim success,
		# never fail the update.
		warn "Honeycomb updated, but the 'honeycomb' command is not on PATH yet, so the coding-assistant plugin could not be refreshed automatically."
		printf '\nOpen a new terminal (so PATH refreshes), then run:\n\n  honeycomb setup\n\n'
		printf 'Then restart Claude Code to load the updated plugin.\n'
		return 0
	fi

	if [ "$DRY_RUN" -eq 1 ]; then
		printf '[dry-run] would list installed harnesses: honeycomb harness status --json\n'
		printf '[dry-run] would refresh the Claude Code plugin: honeycomb setup\n'
		printf '[dry-run] would print: restart Claude Code to load the updated plugin\n'
		return 0
	fi

	# b-AC-1: report which harnesses are installed, via honeycomb's own detection surface (not
	# re-implemented in shell). detect_harnesses drives `honeycomb harness status` (prefers --json).
	detect_harnesses "$rh_bin"
	case "$HARNESS_STATE" in
		detected)
			step "detected coding assistants:"
			printf '%s\n' "$HARNESS_OUT"
			;;
		none)
			# b-AC-6: no harness installed -> clean no-op, not an error.
			ok "no coding assistants detected."
			ok "no coding assistants to refresh."
			return 0
			;;
		*)
			# Detection surface unavailable on this pin: guide to the real verb, never fail (b-AC-5).
			step "run 'honeycomb harness status' to see which coding assistants are installed."
			;;
	esac

	# b-AC-2: refresh the plugin via the confirmed-working `honeycomb setup` (PRD-006). Idempotent.
	step "refreshing the Claude Code plugin (honeycomb setup)..."
	if "$rh_bin" setup >/dev/null 2>&1; then
		ok "Claude Code plugin refreshed."
		# b-AC-4: a running session may not hot-reload; always name the one residual manual action.
		ok "restart Claude Code to load the updated plugin."
	else
		# b-AC-5: degrade to a clear message; NEVER fail the update over the harness result.
		warn "could not refresh the Claude Code plugin automatically."
		printf '\nOpen a new terminal (so PATH refreshes), then run:\n\n  honeycomb setup\n\n'
		printf 'Then restart Claude Code to load the updated plugin.\n'
	fi
	return 0
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════
# Node/npm presence (a-AC-9/AC-10). The updater does NOT bootstrap Node (that is an installer
# concern); it requires a working Node/npm and reports plainly if either is missing, touching nothing.
# ═══════════════════════════════════════════════════════════════════════════════════════════════
ensure_node_present() {
	if have node && have npm; then
		ok "Node $(node --version) and npm $(npm --version) found."
		return 0
	fi
	# a-AC-9: mirror install.sh's elevation_required_node copy (adapted to the update entry point).
	fail "the update needs Node ${HONEYCOMB_NODE_VERSION} and npm, but neither was found on PATH."
	printf '\nInstall Node %s with ONE of these, then re-run the update:\n\n' "$HONEYCOMB_NODE_VERSION"
	printf '  # macOS (Homebrew):\n'
	printf '  brew install node@%s\n\n' "$HONEYCOMB_NODE_VERSION"
	printf '  # Debian/Ubuntu:\n'
	printf '  curl -fsSL https://deb.nodesource.com/setup_%s.x | sudo -E bash - && sudo apt-get install -y nodejs\n\n' "$HONEYCOMB_NODE_VERSION"
	printf '  # Then re-run:\n'
	printf '  curl -fsSL %s/update | sh\n\n' "$HONEYCOMB_INSTALL_BASE_URL"
	return 1
}

# One product_updated per product that ACTUALLY moved (c-AC-7); never for skipped/absent products.
# Dry-run previews only. Runs before the terminal funnel.
fire_product_updated_events() {
	[ -n "$MOVED_PRODUCTS" ] || return 0
	fpu_ifs="$IFS"
	IFS=','
	for fpu_p in $MOVED_PRODUCTS; do
		IFS="$fpu_ifs"
		[ -n "$fpu_p" ] && phone_home product_updated "$fpu_p"
		IFS=','
	done
	IFS="$fpu_ifs"
	return 0
}

print_summary() {
	if [ "$DRY_RUN" -eq 1 ]; then
		if [ "$MOVED_COUNT" -eq 0 ]; then
			if [ "$INSTALLED_COUNT" -eq 0 ]; then
				ok "[dry-run] no Apiary products are installed; nothing would be updated."
			else
				ok "[dry-run] already up to date; nothing would be updated."
			fi
		else
			ok "[dry-run] would update: ${MOVED_PRODUCTS}."
		fi
		return 0
	fi
	if [ "$INSTALLED_COUNT" -eq 0 ]; then
		ok "No Apiary products are installed; nothing to update."
		return 0
	fi
	# AC-3 / a-AC-8: whole fleet already at target -> no npm, no restart, "already up to date".
	if [ "$MOVED_COUNT" -eq 0 ]; then
		ok "already up to date."
		return 0
	fi
	ok "Update complete. Updated: ${MOVED_PRODUCTS}."
	if [ "$ANY_FAILED" -ne 0 ]; then
		printf '%s\n' "Some products could not be updated (see the notes above); nothing was removed."
	fi
	return 0
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════
# main() -- ordered, funnels every terminal exit through finish() so exactly one update_completed /
# update_failed fires (c-AC-6).
# ═══════════════════════════════════════════════════════════════════════════════════════════════
main() {
	# --help is a usage request, not a run: handled before any id/telemetry (mirrors install.sh).
	for a in "$@"; do
		case "$a" in
			--help|-h) print_usage; return 0 ;;
		esac
	done

	# An unknown flag is a plain usage error, also before any telemetry.
	if ! parse_args "$@"; then
		print_usage
		return 1
	fi

	# c-AC-5: update_started fires FIRST, before any resolution work, using only `curl` (no Node).
	resolve_install_id
	phone_home update_started

	# a-AC-1b-1: one up-front warning when --latest bypasses the blessed set.
	if [ "$LATEST" -eq 1 ]; then
		warn "--latest bypasses the blessed fleet set; products may land on untested or mismatched versions."
	fi

	# a-AC-9 / AC-10: require a working Node/npm; in --dry-run, report presence but never stop.
	if [ "$DRY_RUN" -eq 1 ]; then
		if have node && have npm; then
			ok "Node $(node --version) and npm $(npm --version) found (dry-run: nothing will be changed)."
		else
			warn "node/npm not found (dry-run; a real run requires them and would stop here without touching anything)."
		fi
	else
		ensure_node_present || finish 1
	fi

	step "checking installed Apiary products (blessed = hive-release.json-pinned)..."
	# doctor is converged LAST (watchdog); the fixed slug order below guarantees that.
	update_one_product "Honeycomb" honeycomb "@legioncodeinc/honeycomb" honeycomb install
	update_one_product "Hive"      hive      "@legioncodeinc/hive"      hive      install-service
	update_one_product "Nectar"    nectar    "@legioncodeinc/nectar"    nectar    install
	update_one_product "Doctor"    doctor    "@legioncodeinc/doctor"    doctor    install-service

	# 007b: refresh the coding-assistant plugin ONLY when the plugin-bearing honeycomb package moved.
	if [ "$HONEYCOMB_MOVED" -eq 1 ]; then
		refresh_harnesses
	fi

	# c-AC-7: one product_updated per moved product. Set SEL_PRODUCTS to the moved list first so the
	# terminal event's `products` field is honest about what changed (PRD-007c).
	SEL_PRODUCTS="$MOVED_PRODUCTS"
	fire_product_updated_events

	print_summary

	# AC-9: a per-product failure is non-blocking but still surfaces as update_failed / non-zero exit
	# (mirrors install.sh's EXTRA_PRODUCT_FAILED posture); an all-clean run is update_completed / 0.
	if [ "$ANY_FAILED" -ne 0 ]; then
		finish 1
	fi
	finish 0
}

main "$@"
