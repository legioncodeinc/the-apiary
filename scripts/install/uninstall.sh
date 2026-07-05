#!/bin/sh
# Apiary one-command uninstall script (POSIX sh).
#
# Usage:
#   curl -fsSL https://get.theapiary.sh/uninstall | sh
#   curl -fsSL https://get.theapiary.sh/uninstall | sh -s -- --yes
#
# This script is self-contained by design. It does not call doctor purge.
# It removes only explicit allow-list targets from the frozen coverage inventory
# in library/ledger/EXECUTION_LEDGER-fleet-lifecycle.md.

set -u

YES=0
DRY_RUN=0
REMOVAL_COUNT=0
NOOP_COUNT=0
HAS_WARNINGS=0
NEEDS_MANUAL=0
NPM_UNFINISHED=""
MANUAL_COMMANDS=""

# Frozen coverage inventory (source of truth: EXECUTION_LEDGER-fleet-lifecycle.md).
NPM_PACKAGES='@legioncodeinc/honeycomb
@legioncodeinc/nectar
@legioncodeinc/hive
@legioncodeinc/doctor
@deeplake/hivemind'

LAUNCHD_CURRENT='com.legioncode.honeycomb
com.legioncode.nectar
com.legioncode.doctor
com.legioncode.hive'

LAUNCHD_LEGACY='ai.honeycomb.daemon
com.hivenectar.daemon
com.legioncode.hivedoctor
thehive'

SYSTEMD_CURRENT='honeycomb.service
nectar.service
doctor.service
hive.service'

SYSTEMD_LEGACY='ai.honeycomb.daemon.service
hivenectar.service
hivedoctor.service
thehive.service'

WINDOWS_TASKS_CURRENT='honeycomb
nectar
doctor
hive'

WINDOWS_TASKS_LEGACY='HoneycombDaemon
HivenectarDaemon
HiveDoctor
thehive'

step() { printf '%s\n' "-> $1"; }
ok() { printf '[ok] %s\n' "$1"; }
warn() { printf '[warn] %s\n' "$1"; HAS_WARNINGS=1; }
fail() { printf 'Apiary uninstall could not continue: %s\n' "$1" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }

# strip_trailing_slashes echoes the argument with every trailing slash removed
# ("/" and "///" both collapse to the empty string, which callers treat as the root).
strip_trailing_slashes() {
	_s="$1"
	while :; do
		case "$_s" in
			*/) _s="${_s%/}" ;;
			*) break ;;
		esac
	done
	printf '%s' "$_s"
}

# is_dangerous_root returns 0 (true) when a candidate deletion root is the filesystem root, a
# single-segment top-level directory (/etc, /usr, /home, /Users, /Library, ...), or the resolved
# HOME itself. A relocatable fleet root (APIARY_HOME) must never be one of these: wiping it wholesale
# would delete far outside the Apiary allow-list. This closes the "absolute is not the same as safe"
# gap - `case "$x" in /*)` accepts "/" and "/etc" as "absolute", which then reach `rm -rf`.
is_dangerous_root() {
	_p="$(strip_trailing_slashes "$1")"
	# Empty after stripping means the value was "/" (or only slashes): the filesystem root.
	[ -z "$_p" ] && return 0
	if [ -n "${HOME:-}" ]; then
		_h="$(strip_trailing_slashes "$HOME")"
		[ -n "$_h" ] && [ "$_p" = "$_h" ] && return 0
	fi
	case "$_p" in
		/*/*) return 1 ;;  # two or more segments below root (e.g. /srv/apiary): allowed
		/*) return 0 ;;    # exactly one segment below root (e.g. /etc, /home): dangerous
		*) return 0 ;;     # not absolute: never a valid deletion root
	esac
}

# validate_home refuses to run when HOME is unset, empty, non-absolute, or the filesystem root.
# EVERY deletion target is anchored on HOME, so an empty HOME would expand "$HOME/.deeplake" to
# "/.deeplake" and "$HOME/Library/LaunchAgents/..." to the system "/Library/LaunchAgents/...".
# `set -u` aborts on an *unset* HOME but NOT on an *empty* one, so this guard is required.
validate_home() {
	if [ -z "${HOME:-}" ]; then
		fail "HOME is unset or empty; every deletion target is anchored on it. Refusing to run."
		printf '%s\n' "Set HOME to your home directory and re-run."
		return 1
	fi
	case "$HOME" in
		/*) : ;;
		*)
			fail "HOME is not an absolute path (\"$HOME\"). Refusing to run."
			return 1
			;;
	esac
	if [ -z "$(strip_trailing_slashes "$HOME")" ]; then
		fail "HOME resolves to the filesystem root (\"$HOME\"). Refusing to anchor deletions at \"/\"."
		return 1
	fi
	return 0
}

add_manual_command() {
	if [ -n "$MANUAL_COMMANDS" ]; then
		MANUAL_COMMANDS="${MANUAL_COMMANDS}
$1"
	else
		MANUAL_COMMANDS="$1"
	fi
	NEEDS_MANUAL=1
}

add_npm_unfinished() {
	if [ -n "$NPM_UNFINISHED" ]; then
		NPM_UNFINISHED="${NPM_UNFINISHED} $1"
	else
		NPM_UNFINISHED="$1"
	fi
}

print_usage() {
	cat <<'USAGE'
Usage: uninstall.sh [--yes] [--dry-run] [--help]

  --yes      Skip the interactive destruction confirmation.
  --dry-run  Print what would be removed and perform no deletion.
  --help     Show this help text.

The interactive confirmation is required unless --yes is provided.
USAGE
}

parse_args() {
	for arg in "$@"; do
		case "$arg" in
			--yes) YES=1 ;;
			--dry-run) DRY_RUN=1 ;;
			--help|-h)
				print_usage
				return 2
				;;
			*)
				fail "Unknown flag: $arg. Use --help to see supported flags."
				return 1
				;;
		esac
	done
	return 0
}

confirm_destruction() {
	if [ "$YES" -eq 1 ]; then
		ok "Skipping confirmation because --yes was provided."
		return 0
	fi

	if [ ! -e /dev/tty ] || ! ( : </dev/tty ) 2>/dev/null; then
		fail "Refusing to run without confirmation in a non-interactive session."
		printf '%s\n' "Run with --yes, or download the script and run it interactively."
		return 1
	fi

	if ! cat >/dev/tty <<'PROMPT' 2>/dev/null
This will uninstall Apiary fleet artifacts from this machine.
It will remove service units, npm packages, and these state roots:
  - ~/.apiary (or APIARY_HOME when absolute)
  - ~/.deeplake (shared Deeplake credentials also used by standalone @deeplake/hivemind)
  - ~/.hivemind
  - ~/.honeycomb

Type uninstall to continue:
PROMPT
	then
		fail "Refusing to run without a usable TTY confirmation channel."
		printf '%s\n' "Run with --yes, or download the script and run it interactively."
		return 1
	fi
	printf '> ' >/dev/tty
	if ! IFS= read -r reply </dev/tty; then
		fail "Refusing to run without confirmation in a non-interactive session."
		printf '%s\n' "Run with --yes, or download the script and run it interactively."
		return 1
	fi
	if [ "$reply" != "uninstall" ]; then
		fail "Confirmation did not match. No changes were made."
		return 1
	fi
	ok "Destruction confirmed."
	return 0
}

remove_path_allowlisted() {
	path="$1"
	label="$2"

	if [ -L "$path" ]; then
		# Symlink safety: delete only the link itself, never traverse its target.
		if [ "$DRY_RUN" -eq 1 ]; then
			step "[dry-run] would remove symlink $label at $path"
			return 0
		fi
		if rm -f -- "$path" >/dev/null 2>&1; then
			ok "Removed symlink $label ($path)."
			REMOVAL_COUNT=$((REMOVAL_COUNT + 1))
		else
			warn "Failed to remove symlink $label ($path)."
		fi
		return 0
	fi

	if [ -d "$path" ]; then
		if [ "$DRY_RUN" -eq 1 ]; then
			step "[dry-run] would remove directory $label at $path"
			return 0
		fi
		if rm -rf -- "$path" >/dev/null 2>&1; then
			ok "Removed directory $label ($path)."
			REMOVAL_COUNT=$((REMOVAL_COUNT + 1))
		else
			warn "Failed to remove directory $label ($path)."
		fi
		return 0
	fi

	if [ -e "$path" ]; then
		if [ "$DRY_RUN" -eq 1 ]; then
			step "[dry-run] would remove file $label at $path"
			return 0
		fi
		if rm -f -- "$path" >/dev/null 2>&1; then
			ok "Removed file $label ($path)."
			REMOVAL_COUNT=$((REMOVAL_COUNT + 1))
		else
			warn "Failed to remove file $label ($path)."
		fi
		return 0
	fi

	NOOP_COUNT=$((NOOP_COUNT + 1))
	step "No $label at $path."
	return 0
}

remove_launchd_label() {
	label="$1"
	uid="$(id -u 2>/dev/null || printf '0')"
	user_plist="${HOME}/Library/LaunchAgents/${label}.plist"
	system_plist="/Library/LaunchDaemons/${label}.plist"

	if [ -e "$user_plist" ] || [ -L "$user_plist" ]; then
		if [ "$DRY_RUN" -eq 1 ]; then
			step "[dry-run] would bootout launchd user agent $label"
			step "[dry-run] would remove $user_plist"
		else
			if have launchctl; then
				launchctl bootout "gui/${uid}/${label}" >/dev/null 2>&1 || true
			fi
			if rm -f -- "$user_plist" >/dev/null 2>&1; then
				ok "Removed launchd user agent $label."
				REMOVAL_COUNT=$((REMOVAL_COUNT + 1))
			else
				warn "Failed to remove launchd user agent $label."
			fi
		fi
	else
		NOOP_COUNT=$((NOOP_COUNT + 1))
		step "No launchd user agent $label."
	fi

	if [ -e "$system_plist" ] || [ -L "$system_plist" ]; then
		warn "System launchd daemon exists for $label at $system_plist. Not removing without sudo."
		add_manual_command "sudo launchctl bootout system/${label} 2>/dev/null || true; sudo rm -f \"${system_plist}\""
	fi
}

SYSTEMD_RELOAD_NEEDED=0
remove_systemd_unit() {
	unit="$1"
	user_unit="${HOME}/.config/systemd/user/${unit}"
	system_unit="/etc/systemd/system/${unit}"

	if [ -e "$user_unit" ] || [ -L "$user_unit" ]; then
		if [ "$DRY_RUN" -eq 1 ]; then
			step "[dry-run] would disable and stop systemd user unit $unit"
			step "[dry-run] would remove $user_unit"
		else
			if have systemctl; then
				systemctl --user disable --now "$unit" >/dev/null 2>&1 || true
			fi
			if rm -f -- "$user_unit" >/dev/null 2>&1; then
				ok "Removed systemd user unit $unit."
				REMOVAL_COUNT=$((REMOVAL_COUNT + 1))
				SYSTEMD_RELOAD_NEEDED=1
			else
				warn "Failed to remove systemd user unit $unit."
			fi
		fi
	else
		NOOP_COUNT=$((NOOP_COUNT + 1))
		step "No systemd user unit $unit."
	fi

	if [ -e "$system_unit" ] || [ -L "$system_unit" ]; then
		warn "System systemd unit exists for $unit at $system_unit. Not removing without sudo."
		add_manual_command "sudo systemctl disable --now ${unit} 2>/dev/null || true; sudo rm -f \"${system_unit}\"; sudo systemctl daemon-reload"
	fi
}

is_windows_shell() {
	case "$(uname -s 2>/dev/null || printf 'unknown')" in
		MINGW*|MSYS*|CYGWIN*) return 0 ;;
		*) return 1 ;;
	esac
}

remove_windows_task() {
	task_name="$1"
	if ! have schtasks; then
		return 0
	fi

	if schtasks /Query /TN "$task_name" >/dev/null 2>&1; then
		if [ "$DRY_RUN" -eq 1 ]; then
			step "[dry-run] would end and delete Windows scheduled task $task_name"
			return 0
		fi
		schtasks /End /TN "$task_name" >/dev/null 2>&1 || true
		if schtasks /Delete /TN "$task_name" /F >/dev/null 2>&1; then
			ok "Removed Windows scheduled task $task_name."
			REMOVAL_COUNT=$((REMOVAL_COUNT + 1))
		else
			warn "Failed to remove Windows scheduled task $task_name."
		fi
	else
		NOOP_COUNT=$((NOOP_COUNT + 1))
		step "No Windows scheduled task $task_name."
	fi
}

remove_windows_service() {
	service_name="$1"
	if ! have sc; then
		return 0
	fi

	if sc query "$service_name" >/dev/null 2>&1; then
		if [ "$DRY_RUN" -eq 1 ]; then
			step "[dry-run] would stop and delete Windows service $service_name"
			return 0
		fi
		sc stop "$service_name" >/dev/null 2>&1 || true
		if sc delete "$service_name" >/dev/null 2>&1; then
			ok "Removed Windows service $service_name."
			REMOVAL_COUNT=$((REMOVAL_COUNT + 1))
		else
			warn "Failed to remove Windows service $service_name."
			add_manual_command "sc stop \"$service_name\" && sc delete \"$service_name\""
		fi
	else
		NOOP_COUNT=$((NOOP_COUNT + 1))
		step "No Windows service $service_name."
	fi
}

remove_services() {
	step "Removing service units and task registrations."

	while IFS= read -r label; do
		[ -n "$label" ] || continue
		remove_launchd_label "$label"
	done <<EOF
$LAUNCHD_CURRENT
EOF

	while IFS= read -r label; do
		[ -n "$label" ] || continue
		remove_launchd_label "$label"
	done <<EOF
$LAUNCHD_LEGACY
EOF

	while IFS= read -r unit; do
		[ -n "$unit" ] || continue
		remove_systemd_unit "$unit"
	done <<EOF
$SYSTEMD_CURRENT
EOF

	while IFS= read -r unit; do
		[ -n "$unit" ] || continue
		remove_systemd_unit "$unit"
	done <<EOF
$SYSTEMD_LEGACY
EOF

	if [ "$SYSTEMD_RELOAD_NEEDED" -eq 1 ] && [ "$DRY_RUN" -eq 0 ] && have systemctl; then
		systemctl --user daemon-reload >/dev/null 2>&1 || true
	fi

	if is_windows_shell; then
		while IFS= read -r task_name; do
			[ -n "$task_name" ] || continue
			remove_windows_task "$task_name"
			remove_windows_service "$task_name"
		done <<EOF
$WINDOWS_TASKS_CURRENT
EOF

		while IFS= read -r task_name; do
			[ -n "$task_name" ] || continue
			remove_windows_task "$task_name"
			remove_windows_service "$task_name"
		done <<EOF
$WINDOWS_TASKS_LEGACY
EOF
	fi
}

npm_is_usable() {
	if ! have npm; then
		return 1
	fi
	npm --version >/dev/null 2>&1 || return 1
	return 0
}

remove_npm_packages() {
	step "Removing npm global packages."

	if ! npm_is_usable; then
		warn "npm is unavailable or broken. Skipping npm package removals."
		while IFS= read -r pkg; do
			[ -n "$pkg" ] || continue
			add_npm_unfinished "$pkg"
		done <<EOF
$NPM_PACKAGES
EOF
		return 0
	fi

	while IFS= read -r pkg; do
		[ -n "$pkg" ] || continue
		if npm ls -g "$pkg" --depth=0 >/dev/null 2>&1; then
			if [ "$DRY_RUN" -eq 1 ]; then
				step "[dry-run] would uninstall npm package $pkg"
				continue
			fi
			if npm uninstall -g "$pkg" >/dev/null 2>&1; then
				ok "Removed npm package $pkg."
				REMOVAL_COUNT=$((REMOVAL_COUNT + 1))
			else
				warn "Failed to remove npm package $pkg."
				add_npm_unfinished "$pkg"
			fi
		else
			NOOP_COUNT=$((NOOP_COUNT + 1))
			step "No npm package $pkg."
		fi
	done <<EOF
$NPM_PACKAGES
EOF
}

remove_state_dirs() {
	step "Removing allow-list state directories."

	default_apiary_home="${HOME}/.apiary"
	remove_path_allowlisted "$default_apiary_home" "fleet root"

	apiary_home_env="${APIARY_HOME:-}"
	if [ -n "$apiary_home_env" ]; then
		case "$apiary_home_env" in
			/*)
				if is_dangerous_root "$apiary_home_env"; then
					# Absolute but unsafe: the filesystem root, a single top-level dir, or HOME
					# itself. Honoring it would `rm -rf` an entire tree outside the allow-list.
					warn "Ignoring APIARY_HOME because it points at a protected root: $apiary_home_env"
				elif [ "$apiary_home_env" != "$default_apiary_home" ]; then
					remove_path_allowlisted "$apiary_home_env" "APIARY_HOME fleet root"
				fi
				;;
			*)
				warn "Ignoring APIARY_HOME because it is not absolute: $apiary_home_env"
				;;
		esac
	fi

	remove_path_allowlisted "${HOME}/.deeplake" "Deeplake credentials directory"
	remove_path_allowlisted "${HOME}/.hivemind" "legacy Hivemind directory"
	remove_path_allowlisted "${HOME}/.honeycomb" "legacy Honeycomb directory"
}

print_manual_followups() {
	if [ -n "$NPM_UNFINISHED" ]; then
		warn "Some npm packages could not be removed automatically."
		printf '%s\n' "Run this command to finish npm cleanup:"
		printf '  npm uninstall -g %s\n' "$NPM_UNFINISHED"
	fi

	if [ "$NEEDS_MANUAL" -eq 1 ]; then
		warn "Manual removal is required for one or more system-scope services."
		printf '%s\n' "Run these commands:"
		printf '%s\n' "$MANUAL_COMMANDS" | while IFS= read -r cmd; do
			[ -n "$cmd" ] || continue
			printf '  %s\n' "$cmd"
		done
	fi
}

print_summary() {
	if [ "$DRY_RUN" -eq 1 ]; then
		ok "Dry run complete. No changes were made."
		return 0
	fi

	print_manual_followups

	if [ "$REMOVAL_COUNT" -eq 0 ] && [ "$NEEDS_MANUAL" -eq 0 ] && [ -z "$NPM_UNFINISHED" ]; then
		ok "No Apiary assets found. Nothing to remove."
		return 0
	fi

	ok "Uninstall run complete."
	printf '%s\n' "Removed items: $REMOVAL_COUNT"
	printf '%s\n' "Already absent items: $NOOP_COUNT"
	if [ "$HAS_WARNINGS" -eq 1 ]; then
		printf '%s\n' "Warnings were reported above."
	fi
	return 0
}

main() {
	parse_args "$@"
	parse_status=$?
	if [ "$parse_status" -eq 2 ]; then
		return 0
	fi
	if [ "$parse_status" -ne 0 ]; then
		return 1
	fi

	validate_home || return 1

	confirm_destruction || return 1

	remove_services
	remove_npm_packages
	remove_state_dirs
	print_summary
	return 0
}

main "$@"
