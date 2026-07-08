# Apiary one-command uninstall script (Windows PowerShell).
#
# Usage:
#   irm https://get.theapiary.sh/uninstall.ps1 | iex
#   powershell -NoProfile -File .\uninstall.ps1 -Yes
#
# This script is self-contained by design. It does not call doctor purge.
# It removes only explicit allow-list targets from the frozen coverage inventory
# in library/ledger/EXECUTION_LEDGER-fleet-lifecycle.md.
#
# ASCII-only file: this script is intended for Windows PowerShell 5.1 via irm | iex.

$ErrorActionPreference = 'Continue'

$script:Yes = $false
$script:DryRun = $false
$script:RemovalCount = 0
$script:NoopCount = 0
$script:HasWarnings = $false
$script:NeedsManual = $false
$script:NpmUnfinished = @()
$script:ManualCommands = @()

# Frozen coverage inventory (source of truth: EXECUTION_LEDGER-fleet-lifecycle.md).
$script:NpmPackages = @(
  '@legioncodeinc/honeycomb',
  '@legioncodeinc/nectar',
  '@legioncodeinc/hive',
  '@legioncodeinc/doctor',
  '@deeplake/hivemind'
)

$script:LaunchdCurrent = @(
  'com.legioncode.honeycomb',
  'com.legioncode.nectar',
  'com.legioncode.doctor',
  'com.legioncode.hive'
)

$script:LaunchdLegacy = @(
  'ai.honeycomb.daemon',
  'com.hivenectar.daemon',
  'com.legioncode.hivedoctor',
  'thehive'
)

$script:SystemdCurrent = @(
  'honeycomb.service',
  'nectar.service',
  'doctor.service',
  'hive.service'
)

$script:SystemdLegacy = @(
  'ai.honeycomb.daemon.service',
  'hivenectar.service',
  'hivedoctor.service',
  'thehive.service'
)

$script:WindowsTasksCurrent = @('honeycomb', 'nectar', 'doctor', 'hive')
$script:WindowsTasksLegacy = @('HoneycombDaemon', 'HivenectarDaemon', 'HiveDoctor', 'thehive')
$script:SystemdReloadNeeded = $false

# Markers identifying INSTALLED Apiary daemon processes by command line. Every
# globally-installed daemon runs as `node <...>/node_modules/<scope>/<pkg>/...`, so
# the scoped package segment appears verbatim in argv. A daemon running from a dev
# checkout (e.g. the-apiary/honeycomb/) does NOT contain these, so an active
# dev/test/editor session is never matched - this is the boundary between
# "uninstall the product" and "kill my editor".
$script:DaemonProcessMarkers = @(
  '@legioncodeinc/honeycomb',
  '@legioncodeinc/nectar',
  '@legioncodeinc/hive',
  '@legioncodeinc/doctor',
  '@deeplake/hivemind'
)

function Write-Step([string]$Message) { Write-Host "-> $Message" }
function Write-Ok([string]$Message) { Write-Host "[ok] $Message" }
function Write-Warn([string]$Message) { Write-Host "[warn] $Message"; $script:HasWarnings = $true }
function Write-Fail([string]$Message) { [Console]::Error.WriteLine("Apiary uninstall could not continue: $Message") }

function Test-Have([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-HasFlag([string[]]$InvocationArgs, [string]$Flag) {
  if (-not $InvocationArgs) { return $false }
  return ($InvocationArgs -contains $Flag)
}

function Get-FlagValue([string[]]$InvocationArgs, [string]$Prefix) {
  if (-not $InvocationArgs) { return $null }
  foreach ($arg in $InvocationArgs) {
    if ($arg -and $arg.StartsWith($Prefix)) {
      return $arg.Substring($Prefix.Length)
    }
  }
  return $null
}

function Show-Usage {
  Write-Host 'Usage: uninstall.ps1 [--yes|-Yes] [--dry-run|-DryRun] [--help|-h]'
  Write-Host ''
  Write-Host '  --yes / -Yes            Skip the interactive destruction confirmation.'
  Write-Host '  --dry-run / -DryRun     Print what would be removed and perform no deletion.'
  Write-Host '  --help / -h             Show this help text.'
  Write-Host ''
  Write-Host 'The interactive confirmation is required unless --yes or -Yes is provided.'
}

function Add-ManualCommand([string]$CommandText) {
  $script:ManualCommands += $CommandText
  $script:NeedsManual = $true
}

function Add-NpmUnfinished([string]$PackageName) {
  $script:NpmUnfinished += $PackageName
}

function Test-IsAbsolutePath([string]$PathValue) {
  if ([string]::IsNullOrWhiteSpace($PathValue)) { return $false }
  if ($PathValue -match '^[A-Za-z]:\\') { return $true }
  if ($PathValue.StartsWith('\\')) { return $true }
  if ($PathValue.StartsWith('/')) { return $true }
  return $false
}

# Test-IsDangerousRoot returns $true when a candidate deletion root is the filesystem/drive root,
# a single top-level segment (C:\Windows, /etc), a UNC share root, or the resolved home itself.
# "Absolute" is necessary but NOT sufficient for a relocatable fleet root: APIARY_HOME='C:\' or '/'
# would otherwise reach Remove-Item -Recurse -Force and wipe an entire tree outside the allow-list.
function Test-IsDangerousRoot([string]$PathValue, [string]$HomePath) {
  if ([string]::IsNullOrWhiteSpace($PathValue)) { return $true }
  $p = $PathValue.TrimEnd('\', '/')
  if ([string]::IsNullOrWhiteSpace($p)) { return $true }   # was "/" or "\" only
  if ($p -match '^[A-Za-z]:$') { return $true }            # drive root, e.g. C:
  if (-not [string]::IsNullOrWhiteSpace($HomePath)) {
    if ($p -eq $HomePath.TrimEnd('\', '/')) { return $true }
  }
  # Count path segments below the root; fewer than two means a top-level dir or a bare root.
  $segments = $p -split '[\\/]+' | Where-Object { $_ -ne '' -and $_ -notmatch '^[A-Za-z]:$' }
  if ($segments.Count -lt 2) { return $true }
  return $false
}

function Get-ArgumentStatus([string[]]$InvocationArgs) {
  if ((Test-HasFlag $InvocationArgs '--help') -or (Test-HasFlag $InvocationArgs '-h')) {
    Show-Usage
    return 2
  }

  if ((Test-HasFlag $InvocationArgs '--yes') -or (Test-HasFlag $InvocationArgs '-Yes')) {
    $script:Yes = $true
  }
  if ((Test-HasFlag $InvocationArgs '--dry-run') -or (Test-HasFlag $InvocationArgs '-DryRun')) {
    $script:DryRun = $true
  }

  foreach ($arg in $InvocationArgs) {
    if ($arg -in @('--help', '-h', '--yes', '-Yes', '--dry-run', '-DryRun')) {
      continue
    }
    if ($arg -like '--yes=*' -or $arg -like '--dry-run=*') {
      Write-Fail "Unsupported flag format: $arg"
      return 1
    }
    if ($arg.StartsWith('-') -or $arg.StartsWith('/')) {
      Write-Fail "Unknown flag: $arg. Use --help to see supported flags."
      return 1
    }
  }

  return 0
}

function Test-IsInteractiveHost {
  try {
    if ($null -eq $Host) { return $false }
    if ($null -eq $Host.UI) { return $false }
    if ($null -eq $Host.UI.RawUI) { return $false }
    if ([Console]::IsInputRedirected) { return $false }
    return $true
  } catch {
    return $false
  }
}

function Confirm-Destruction {
  if ($script:Yes) {
    Write-Ok 'Skipping confirmation because --yes/-Yes was provided.'
    return $true
  }

  if (-not (Test-IsInteractiveHost)) {
    Write-Fail 'Refusing to run without confirmation in a non-interactive session.'
    Write-Host 'Run with --yes (or -Yes), or download the script and run it interactively.'
    return $false
  }

  Write-Host 'This will uninstall Apiary fleet artifacts from this machine.'
  Write-Host 'It will remove service units, npm packages, and these state roots:'
  Write-Host '  - ~/.apiary (or APIARY_HOME when absolute)'
  Write-Host '  - ~/.deeplake (shared Deeplake credentials also used by standalone @deeplake/hivemind)'
  Write-Host '  - ~/.hivemind'
  Write-Host '  - ~/.honeycomb'
  $reply = Read-Host 'Type uninstall to continue'
  if ($reply -ne 'uninstall') {
    Write-Fail 'Confirmation did not match. No changes were made.'
    return $false
  }
  Write-Ok 'Destruction confirmed.'
  return $true
}

function Get-HomeDirectory {
  if (Test-IsAbsolutePath $env:APIARY_UNINSTALL_HOME) {
    return $env:APIARY_UNINSTALL_HOME
  }
  if (Test-IsAbsolutePath $env:HOME) {
    return $env:HOME
  }
  if (Test-IsAbsolutePath $env:USERPROFILE) {
    return $env:USERPROFILE
  }
  return $HOME
}

function Remove-AllowlistedPath {
  param(
    [string]$PathValue,
    [string]$Label
  )

  if (-not (Test-Path -LiteralPath $PathValue)) {
    $script:NoopCount++
    Write-Step "No $Label at $PathValue."
    return
  }

  $item = Get-Item -LiteralPath $PathValue -Force -ErrorAction SilentlyContinue
  if ($null -eq $item) {
    Write-Warn "Could not inspect $Label at $PathValue."
    return
  }

  $isSymlink = $item.Attributes.ToString().Contains('ReparsePoint')
  if ($isSymlink) {
    # Symlink safety: delete only the link itself, never traverse its target.
    if ($script:DryRun) {
      Write-Step "[dry-run] would remove symlink $Label at $PathValue"
      return
    }
    try {
      Remove-Item -LiteralPath $PathValue -Force -ErrorAction Stop
      Write-Ok "Removed symlink $Label ($PathValue)."
      $script:RemovalCount++
    } catch {
      Write-Warn "Failed to remove symlink $Label ($PathValue)."
    }
    return
  }

  if ($script:DryRun) {
    Write-Step "[dry-run] would remove $Label at $PathValue"
    return
  }

  try {
    if ($item.PSIsContainer) {
      Remove-Item -LiteralPath $PathValue -Recurse -Force -ErrorAction Stop
    } else {
      Remove-Item -LiteralPath $PathValue -Force -ErrorAction Stop
    }
    Write-Ok "Removed $Label ($PathValue)."
    $script:RemovalCount++
  } catch {
    Write-Warn "Failed to remove $Label ($PathValue)."
  }
}

function Remove-LaunchdLabel([string]$Label, [string]$HomePath) {
  $userPlist = Join-Path $HomePath "Library/LaunchAgents/$Label.plist"
  $systemPlist = "/Library/LaunchDaemons/$Label.plist"

  if (Test-Path -LiteralPath $userPlist) {
    if ($script:DryRun) {
      Write-Step "[dry-run] would bootout launchd user agent $Label"
      Write-Step "[dry-run] would remove $userPlist"
    } else {
      if (Test-Have 'launchctl') {
        $uid = ''
        if (Test-Have 'id') { $uid = (& id -u 2>$null) }
        if (-not [string]::IsNullOrWhiteSpace($uid)) {
          & launchctl bootout "gui/$uid/$Label" *> $null
        }
      }
      try {
        Remove-Item -LiteralPath $userPlist -Force -ErrorAction Stop
        Write-Ok "Removed launchd user agent $Label."
        $script:RemovalCount++
      } catch {
        Write-Warn "Failed to remove launchd user agent $Label."
      }
    }
  } else {
    $script:NoopCount++
    Write-Step "No launchd user agent $Label."
  }

  if (Test-Path -LiteralPath $systemPlist) {
    Write-Warn "System launchd daemon exists for $Label at $systemPlist. Not removing without sudo."
    Add-ManualCommand "sudo launchctl bootout system/$Label 2>/dev/null || true; sudo rm -f `"$systemPlist`""
  }
}

function Remove-SystemdUnit([string]$Unit, [string]$HomePath) {
  $userUnit = Join-Path $HomePath ".config/systemd/user/$Unit"
  $systemUnit = "/etc/systemd/system/$Unit"

  if (Test-Path -LiteralPath $userUnit) {
    if ($script:DryRun) {
      Write-Step "[dry-run] would disable and stop systemd user unit $Unit"
      Write-Step "[dry-run] would remove $userUnit"
    } else {
      if (Test-Have 'systemctl') {
        & systemctl --user disable --now $Unit *> $null
      }
      try {
        Remove-Item -LiteralPath $userUnit -Force -ErrorAction Stop
        Write-Ok "Removed systemd user unit $Unit."
        $script:RemovalCount++
        $script:SystemdReloadNeeded = $true
      } catch {
        Write-Warn "Failed to remove systemd user unit $Unit."
      }
    }
  } else {
    $script:NoopCount++
    Write-Step "No systemd user unit $Unit."
  }

  if (Test-Path -LiteralPath $systemUnit) {
    Write-Warn "System systemd unit exists for $Unit at $systemUnit. Not removing without sudo."
    Add-ManualCommand "sudo systemctl disable --now $Unit 2>/dev/null || true; sudo rm -f `"$systemUnit`"; sudo systemctl daemon-reload"
  }
}

function Remove-WindowsTask([string]$TaskName) {
  if (-not (Test-Have 'schtasks')) { return }

  & schtasks /Query /TN $TaskName *> $null
  if ($LASTEXITCODE -ne 0) {
    $script:NoopCount++
    Write-Step "No Windows scheduled task $TaskName."
    return
  }

  if ($script:DryRun) {
    Write-Step "[dry-run] would end and delete Windows scheduled task $TaskName"
    return
  }

  & schtasks /End /TN $TaskName *> $null
  & schtasks /Delete /TN $TaskName /F *> $null
  if ($LASTEXITCODE -eq 0) {
    Write-Ok "Removed Windows scheduled task $TaskName."
    $script:RemovalCount++
  } else {
    Write-Warn "Failed to remove Windows scheduled task $TaskName."
  }
}

function Remove-WindowsService([string]$ServiceName) {
  if (-not (Test-Have 'sc.exe')) { return }

  & sc.exe query $ServiceName *> $null
  if ($LASTEXITCODE -ne 0) {
    $script:NoopCount++
    Write-Step "No Windows service $ServiceName."
    return
  }

  if ($script:DryRun) {
    Write-Step "[dry-run] would stop and delete Windows service $ServiceName"
    return
  }

  & sc.exe stop $ServiceName *> $null
  & sc.exe delete $ServiceName *> $null
  if ($LASTEXITCODE -eq 0) {
    Write-Ok "Removed Windows service $ServiceName."
    $script:RemovalCount++
  } else {
    Write-Warn "Failed to remove Windows service $ServiceName."
    Add-ManualCommand "sc.exe stop `"$ServiceName`" && sc.exe delete `"$ServiceName`""
  }
}

function Remove-Services([string]$HomePath) {
  Write-Step 'Removing service units and task registrations.'

  foreach ($label in $script:LaunchdCurrent) { Remove-LaunchdLabel $label $HomePath }
  foreach ($label in $script:LaunchdLegacy) { Remove-LaunchdLabel $label $HomePath }

  foreach ($unit in $script:SystemdCurrent) { Remove-SystemdUnit $unit $HomePath }
  foreach ($unit in $script:SystemdLegacy) { Remove-SystemdUnit $unit $HomePath }

  if ($script:SystemdReloadNeeded -and -not $script:DryRun -and (Test-Have 'systemctl')) {
    & systemctl --user daemon-reload *> $null
  }

  foreach ($taskName in $script:WindowsTasksCurrent) {
    Remove-WindowsTask $taskName
    Remove-WindowsService $taskName
  }
  foreach ($taskName in $script:WindowsTasksLegacy) {
    Remove-WindowsTask $taskName
    Remove-WindowsService $taskName
  }
}

# Stop running daemon processes by pid file. Service deregistration only stops
# task-managed instances; a daemon started DIRECTLY (for example the installer's
# direct-startup fallback) survives it and keeps squatting the loopback port with
# stale code. Each product writes a pid file inside its own state dir; verify the
# pid is a LIVE NODE process (never kill a reused pid) before terminating it.
function Stop-DaemonByPidFile([string]$PidFilePath, [string]$Label) {
  if (-not (Test-Path -LiteralPath $PidFilePath)) { return }
  $raw = ''
  try { $raw = (Get-Content -LiteralPath $PidFilePath -TotalCount 1 -ErrorAction Stop) } catch { return }
  $pidText = ($raw -replace '[^0-9]', '')
  if ([string]::IsNullOrEmpty($pidText)) { return }
  $processId = 0
  if (-not [int]::TryParse($pidText, [ref]$processId)) { return }
  if ($processId -le 0) { return }
  $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if (-not $proc) {
    Write-Step "No running $Label daemon (stale pid file)."
    return
  }
  if ($proc.ProcessName -ne 'node') {
    Write-Warn "Pid $processId from the $Label pid file is not a node process; leaving it alone (pid reuse)."
    return
  }
  if ($script:DryRun) {
    Write-Step "[dry-run] would stop the running $Label daemon (pid $processId)"
    return
  }
  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  Write-Ok "Stopped the running $Label daemon (pid $processId)."
  $script:RemovalCount++
}

# Catch-all process scan. The pid-file pass above only reaches daemons that wrote
# a pid file in a known location; a daemon started DIRECTLY (installer fallback,
# `HONEYCOMB_DAEMON_SERVICE=spawn`, manual `hive start`, a leftover from a
# previous version with a different pid location) survives it and keeps squatting
# its loopback port with stale code. Scan every live node.exe command line for one
# of the installed-package markers and terminate it. We deliberately match the
# scoped npm package segment (e.g. @legioncodeinc/honeycomb), which is present
# only for an INSTALLED daemon - a dev/test/editor session running from the repo
# checkout (the-apiary/honeycomb/) does not contain it and is left alone.
function Stop-DaemonsByProcessScan {
  Write-Step 'Scanning running processes for Apiary daemons (catch-all).'

  $nodeProcesses = @()
  try {
    $nodeProcesses = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue)
  } catch {
    Write-Warn 'Could not enumerate running node.exe processes; skipping process scan.'
    return
  }
  if ($nodeProcesses.Count -eq 0) {
    Write-Step 'No running node.exe processes found by scan.'
    return
  }

  $scanKilled = 0
  $seen = @{}
  foreach ($proc in $nodeProcesses) {
    $cmdLine = $proc.CommandLine
    if ([string]::IsNullOrWhiteSpace($cmdLine)) { continue }
    # Normalize backslashes to forward slashes so a single marker substring match
    # works regardless of whether the bin path was recorded with \ or /.
    $cmdLineNorm = $cmdLine -replace '\\', '/'
    $matchedMarker = $null
    foreach ($marker in $script:DaemonProcessMarkers) {
      if ($cmdLineNorm -like "*$marker*") { $matchedMarker = $marker; break }
    }
    if (-not $matchedMarker) { continue }

    $processId = $proc.ProcessId
    if ($seen.ContainsKey($processId)) { continue }
    $seen[$processId] = $true

    if ($script:DryRun) {
      Write-Step "[dry-run] would stop running daemon pid $processId ($matchedMarker)"
      continue
    }
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    Write-Ok "Stopped running daemon pid $processId ($matchedMarker)."
    $script:RemovalCount++
    $scanKilled++
  }

  if ($scanKilled -eq 0 -and -not $script:DryRun) {
    Write-Step 'No additional Apiary daemon processes found by scan.'
  }
}

function Stop-RunningDaemons([string]$HomePath) {
  Write-Step 'Stopping running daemon processes (pid files).'

  $roots = @((Join-Path $HomePath '.apiary'))
  $apiaryHomeEnv = $env:APIARY_HOME
  if (-not [string]::IsNullOrEmpty($apiaryHomeEnv) -and (Test-IsAbsolutePath $apiaryHomeEnv) -and
      -not (Test-IsDangerousRoot $apiaryHomeEnv $HomePath) -and ($apiaryHomeEnv -ne (Join-Path $HomePath '.apiary'))) {
    $roots += $apiaryHomeEnv
  }

  foreach ($root in $roots) {
    Stop-DaemonByPidFile (Join-Path $root 'hive\hive.pid') 'hive'
    Stop-DaemonByPidFile (Join-Path $root 'nectar\nectar.pid') 'nectar'
    Stop-DaemonByPidFile (Join-Path $root 'honeycomb\daemon.pid') 'honeycomb'
  }

  # Legacy pre-fleet-root location (honeycomb owned ~/.honeycomb before ADR-0003).
  Stop-DaemonByPidFile (Join-Path $HomePath '.honeycomb\daemon.pid') 'legacy honeycomb'

  # Catch-all: also kill any installed Apiary daemon still running that wrote no
  # pid file we know about (directly-started instances, leftover from prior
  # versions). Runs after service deregistration so nothing auto-restarts them.
  Stop-DaemonsByProcessScan
}

function Test-NpmUsable {
  if (-not (Test-Have 'npm')) { return $false }
  & npm --version *> $null
  return ($LASTEXITCODE -eq 0)
}

function Remove-NpmPackages {
  Write-Step 'Removing npm global packages.'

  if (-not (Test-NpmUsable)) {
    Write-Warn 'npm is unavailable or broken. Skipping npm package removals.'
    foreach ($pkg in $script:NpmPackages) { Add-NpmUnfinished $pkg }
    return
  }

  foreach ($pkg in $script:NpmPackages) {
    & npm ls -g $pkg --depth=0 *> $null
    if ($LASTEXITCODE -ne 0) {
      $script:NoopCount++
      Write-Step "No npm package $pkg."
      continue
    }

    if ($script:DryRun) {
      Write-Step "[dry-run] would uninstall npm package $pkg"
      continue
    }

    & npm uninstall -g $pkg *> $null
    if ($LASTEXITCODE -eq 0) {
      Write-Ok "Removed npm package $pkg."
      $script:RemovalCount++
    } else {
      Write-Warn "Failed to remove npm package $pkg."
      Add-NpmUnfinished $pkg
    }
  }
}

function Remove-StateDirectories([string]$HomePath) {
  Write-Step 'Removing allow-list state directories.'

  $defaultApiary = Join-Path $HomePath '.apiary'
  Remove-AllowlistedPath $defaultApiary 'fleet root'

  if (-not [string]::IsNullOrWhiteSpace($env:APIARY_HOME)) {
    if (-not (Test-IsAbsolutePath $env:APIARY_HOME)) {
      Write-Warn "Ignoring APIARY_HOME because it is not absolute: $($env:APIARY_HOME)"
    } elseif (Test-IsDangerousRoot $env:APIARY_HOME $HomePath) {
      # Absolute but unsafe: a drive/filesystem root, a single top-level dir, or the home itself.
      # Honoring it would Remove-Item -Recurse an entire tree outside the Apiary allow-list.
      Write-Warn "Ignoring APIARY_HOME because it points at a protected root: $($env:APIARY_HOME)"
    } elseif ($env:APIARY_HOME -ne $defaultApiary) {
      Remove-AllowlistedPath $env:APIARY_HOME 'APIARY_HOME fleet root'
    }
  }

  Remove-AllowlistedPath (Join-Path $HomePath '.deeplake') 'Deeplake credentials directory'
  Remove-AllowlistedPath (Join-Path $HomePath '.hivemind') 'legacy Hivemind directory'
  Remove-AllowlistedPath (Join-Path $HomePath '.honeycomb') 'legacy Honeycomb directory'
}

function Write-ManualFollowups {
  if ($script:NpmUnfinished.Count -gt 0) {
    Write-Warn 'Some npm packages could not be removed automatically.'
    Write-Host 'Run this command to finish npm cleanup:'
    Write-Host ('  npm uninstall -g ' + ($script:NpmUnfinished -join ' '))
  }

  if ($script:NeedsManual -and $script:ManualCommands.Count -gt 0) {
    Write-Warn 'Manual removal is required for one or more system-scope services.'
    Write-Host 'Run these commands:'
    foreach ($cmd in $script:ManualCommands) {
      Write-Host "  $cmd"
    }
  }
}

function Write-Summary {
  if ($script:DryRun) {
    Write-Ok 'Dry run complete. No changes were made.'
    return 0
  }

  Write-ManualFollowups

  if ($script:RemovalCount -eq 0 -and -not $script:NeedsManual -and $script:NpmUnfinished.Count -eq 0) {
    Write-Ok 'No Apiary assets found. Nothing to remove.'
    return 0
  }

  Write-Ok 'Uninstall run complete.'
  Write-Host "Removed items: $($script:RemovalCount)"
  Write-Host "Already absent items: $($script:NoopCount)"
  if ($script:HasWarnings) {
    Write-Host 'Warnings were reported above.'
  }
  return 0
}

function Invoke-Main([string[]]$InvocationArgs) {
  $parseStatus = Get-ArgumentStatus $InvocationArgs
  if ($parseStatus -eq 2) { return 0 }
  if ($parseStatus -ne 0) { return 1 }

  if (-not (Confirm-Destruction)) { return 1 }

  $homePath = Get-HomeDirectory
  # Every deletion target is anchored on the resolved home. Refuse to run if it is empty,
  # non-absolute, or a bare drive/filesystem root (which would anchor deletions at the root).
  if ([string]::IsNullOrWhiteSpace($homePath) -or -not (Test-IsAbsolutePath $homePath) -or
      ($homePath.TrimEnd('\', '/') -eq '') -or ($homePath -match '^[A-Za-z]:$')) {
    Write-Fail "Home directory resolved to an unsafe value (`"$homePath`"). Refusing to run."
    return 1
  }
  Remove-Services $homePath
  # After deregistration (so nothing auto-restarts what we stop), kill daemons that
  # were started directly and therefore survive task removal.
  Stop-RunningDaemons $homePath
  Remove-NpmPackages
  Remove-StateDirectories $homePath
  return (Write-Summary)
}

# Set the exit code once and propagate process exit for -File runs only.
$script:IsTopLevelFileInvocation = $false
if ($null -ne $MyInvocation -and $null -ne $MyInvocation.MyCommand) {
  $commandType = [string]$MyInvocation.MyCommand.CommandType
  $commandPath = [string]$MyInvocation.MyCommand.Path
  if (-not [string]::IsNullOrWhiteSpace($commandPath) -or $commandType -eq 'ExternalScript') {
    $script:IsTopLevelFileInvocation = $true
  }
}

$script:ExitCode = Invoke-Main $args
$global:LASTEXITCODE = $script:ExitCode
if ($script:IsTopLevelFileInvocation) {
  exit $script:ExitCode
}
