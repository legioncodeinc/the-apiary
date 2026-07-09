# Apiary one-command fleet UPDATE script (Windows PowerShell) -- the-apiary PRD-007.
#
# Usage (the single line a user pastes to move the installed fleet to the blessed set):
#   irm https://get.theapiary.sh/update.ps1 | iex
#
# Opt into the newest published bytes (pass args to the script block explicitly, since `irm | iex`
# has no script-level $args of its own):
#   powershell -c "& { $(irm https://get.theapiary.sh/update.ps1) } --latest"
#   powershell -c "& { $(irm https://get.theapiary.sh/update.ps1) } --dry-run"
#
# This is the FUNCTIONAL EQUIVALENT of update.sh (PRD-007 AC-6): the SAME flag grammar, resolution,
# idempotency, restart, harness refresh, and telemetry behavior -- see update.sh's header for the
# full documented contract. It is the THIRD lifecycle script beside install.ps1 and uninstall.ps1.
#
# Thin + idempotent + non-destructive: detect what is installed, move only what is behind, converge
# + restart only what moved, never uninstall, never delete state.
#
# ASCII-only by design: sourced via `irm | iex` and parsed by Windows PowerShell 5.1, which reads a
# non-BOM file as the system ANSI codepage -- non-ASCII glyphs would corrupt the parse. Friendly
# UTF-8 glyphs come from the CLI verbs' output; this script's own prefixes stay ASCII.

# Handle every failure explicitly + print a plain-language line (parent AC-9). We do NOT set
# $ErrorActionPreference='Stop' globally -- that would surface a raw PowerShell exception/trace.
$ErrorActionPreference = 'Continue'

# The Node LTS the installer provisions (referenced only in the "Node is missing" copy; the updater
# assumes a working Node/npm and never bootstraps one -- that is an installer concern).
$HoneycombNodeVersion = '22'

# Distribution base URL (used only in the "re-run" copy of the Node-missing message).
$HoneycombInstallBaseUrl = 'https://get.theapiary.sh'

# The fleet release manifest (same URL + raw-GitHub fallback as install.ps1). The updater never
# hardcodes "latest" for a product it did not itself publish: it resolves each installed product's
# exact pinned version from THIS manifest (unless -Latest is passed, which bypasses it).
$HoneycombManifestUrl = 'https://get.theapiary.sh/hive-release.json'
if ($env:HONEYCOMB_MANIFEST_URL) { $HoneycombManifestUrl = $env:HONEYCOMB_MANIFEST_URL }
$HoneycombManifestFallbackUrl = 'https://raw.githubusercontent.com/legioncodeinc/the-apiary/main/hive-release.json'

# Telemetry destination (PRD-007c). The key is EMPTY in source control BY DESIGN -- this exact
# `$HoneycombInstallPosthogKey = ''` line is the one site/install/build.mjs patches (via an anchored
# regex on this literal line) at deploy time, injecting the real PostHog project key. An empty value
# (any un-built/local/dev copy) makes Send-PhoneHome a silent no-op -- never a hard failure. Same
# public install-site channel, key seam, endpoint, and payload shape as the installer; only the
# event NAMES differ (update_started / update_completed / update_failed, reusing product_updated).
$HoneycombInstallPosthogKey = ''
$HoneycombInstallPosthogHost = 'https://us.i.posthog.com'
$HoneycombInstallPosthogPath = '/i/v0/e/'
$HoneycombInstallIdFile = Join-Path $HOME '.honeycomb\install-id'

# Run-scoped state (avoids threading many params through every function, as update has no
# product-selection/profile grammar to resolve -- unlike install.ps1).
$script:DryRun = $false
$script:Latest = $false
$script:InstallId = ''
$script:Repeat = $false
# Slugs that ACTUALLY moved this run (drives product_updated + the `products` payload + the summary).
$script:MovedProducts = @()
$script:InstalledCount = 0
$script:AnyFailed = $false
$script:HoneycombMoved = $false

# Friendly progress log: step lines to the host, the single failure summary to the error stream.
function Write-Step([string]$m) { Write-Host "-> $m" }
function Write-Ok([string]$m)   { Write-Host "[ok] $m" }
function Write-Warn([string]$m) { Write-Host "[warn] $m" }
function Write-Fail([string]$m) { [Console]::Error.WriteLine("Apiary update could not continue: $m") }

function Test-Have([string]$name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

function Test-HasFlag([string[]]$InvocationArgs, [string]$Flag) {
  if (-not $InvocationArgs) { return $false }
  return ($InvocationArgs -contains $Flag)
}

function Test-IsAbsolutePath([string]$PathValue) {
  if ([string]::IsNullOrWhiteSpace($PathValue)) { return $false }
  if ($PathValue -match '^[A-Za-z]:\\') { return $true }
  if ($PathValue.StartsWith('\\')) { return $true }
  if ($PathValue.StartsWith('/')) { return $true }
  return $false
}

function Show-Usage {
  Write-Host 'Usage: update.ps1 [--latest|-Latest] [--dry-run|-DryRun] [--help|-h]'
  Write-Host ''
  Write-Host '  --latest / -Latest     Update each installed product to its npm ''latest'' dist-tag'
  Write-Host '                         instead of the blessed (hive-release.json-pinned) version.'
  Write-Host '                         Prints a warning; bypasses the tested fleet set.'
  Write-Host '  --dry-run / -DryRun    Resolve + print every product''s current -> target decision and'
  Write-Host '                         the services it would restart; mutate nothing, send no telemetry.'
  Write-Host '  --help / -h            Show this help text.'
  Write-Host ''
  Write-Host 'By default (no flag) every INSTALLED Apiary product is moved to its blessed,'
  Write-Host 'manifest-pinned version; a product that is not installed is left untouched.'
  Write-Host 'Env equivalent for --latest: APIARY_UPDATE_LATEST=1.'
}

# Parse flags (both the POSIX `--flag` spelling and the PowerShell-native `-Flag`, kept identical to
# install.ps1's dual grammar). Returns 0 (proceed), 1 (usage error), or 2 (help was shown). Reads
# the APIARY_UPDATE_LATEST env equivalent (a-AC-1b: --latest is strictly opt-in, never implied).
function Get-ArgumentStatus([string[]]$InvocationArgs) {
  if ((Test-HasFlag $InvocationArgs '--help') -or (Test-HasFlag $InvocationArgs '-h') -or (Test-HasFlag $InvocationArgs '-Help')) {
    Show-Usage
    return 2
  }
  if ((Test-HasFlag $InvocationArgs '--dry-run') -or (Test-HasFlag $InvocationArgs '-DryRun')) {
    $script:DryRun = $true
  }
  if ((Test-HasFlag $InvocationArgs '--latest') -or (Test-HasFlag $InvocationArgs '-Latest')) {
    $script:Latest = $true
  }
  if ($env:APIARY_UPDATE_LATEST) {
    $v = "$($env:APIARY_UPDATE_LATEST)".Trim().ToLowerInvariant()
    if ($v -eq '1' -or $v -eq 'true') { $script:Latest = $true }
  }
  if ($InvocationArgs) {
    foreach ($arg in $InvocationArgs) {
      if ($arg -in @('--help', '-h', '-Help', '--dry-run', '-DryRun', '--latest', '-Latest')) { continue }
      if ($arg.StartsWith('-') -or $arg.StartsWith('/')) {
        Write-Fail "Unknown flag: $arg. Use --help to see supported flags."
        return 1
      }
    }
  }
  return 0
}

# -----------------------------------------------------------------------------
# PRD-007c -- anonymous install id + phone-home (ported from install.ps1: same id file, endpoint,
# body shape, 3s timeout, empty-key no-op -- only the event names differ).
# -----------------------------------------------------------------------------

# SYNC: mirror of install.ps1 New-AnonInstallId
function New-AnonInstallId { return [guid]::NewGuid().ToString() }

# SYNC: mirror of install.ps1 Resolve-InstallId
# READ (or, outside -DryRun, mint + persist) the same ~/.honeycomb/install-id the installer wrote
# (c-AC-5). Sets $script:InstallId / $script:Repeat. In -DryRun this NEVER writes.
function Resolve-InstallId {
  if ((Test-Path $HoneycombInstallIdFile) -and ((Get-Item $HoneycombInstallIdFile).Length -gt 0)) {
    $existing = (Get-Content $HoneycombInstallIdFile -Raw -ErrorAction SilentlyContinue)
    if ($existing) {
      $script:InstallId = $existing.Trim()
      $script:Repeat = $true
      return
    }
  }
  $script:InstallId = New-AnonInstallId
  $script:Repeat = $false
  if (-not $script:DryRun) {
    try {
      New-Item -ItemType Directory -Force -Path (Split-Path $HoneycombInstallIdFile) | Out-Null
      Set-Content -Path $HoneycombInstallIdFile -Value $script:InstallId -NoNewline -ErrorAction SilentlyContinue
    } catch {
      # Fail-soft: a persistence hiccup must never abort the update.
    }
  }
}

# SYNC: mirror of install.ps1 Send-PhoneHome
# Fire ONE PostHog capture event. FAIL-SOFT + BOUNDED (TimeoutSec 3). Same endpoint + body shape as
# install.ps1. Allow-list-shaped payload (no PII; no license/code -- there are none here): products
# (the moved set), profile (empty on update), coarse OS family, repeat-vs-first. The optional
# -Product arg is the per-product transition field appended as `product = <slug>`.
function Send-PhoneHome {
  param(
    [string]$EventName,
    [string]$Product = ''
  )
  $productsField = ($script:MovedProducts -join ',')
  if ($script:DryRun) {
    if ($Product) {
      Write-Host "[dry-run] would phone home: $EventName (product=$Product, install_id=$($script:InstallId), repeat=$($script:Repeat), products=$productsField, profile=)"
    } else {
      Write-Host "[dry-run] would phone home: $EventName (install_id=$($script:InstallId), repeat=$($script:Repeat), products=$productsField, profile=)"
    }
    return
  }
  if ([string]::IsNullOrEmpty($HoneycombInstallPosthogKey)) { return }

  $props = @{
    products = $productsField
    profile = ''
    os = 'windows'
    repeat_install = "$($script:Repeat)".ToLowerInvariant()
  }
  if ($Product) { $props.product = $Product }
  $body = @{
    api_key = $HoneycombInstallPosthogKey
    event = $EventName
    distinct_id = $script:InstallId
    properties = $props
  } | ConvertTo-Json -Compress

  try {
    Invoke-RestMethod -Method Post -Uri "$HoneycombInstallPosthogHost$HoneycombInstallPosthogPath" `
      -ContentType 'application/json' -Body $body -TimeoutSec 3 -ErrorAction Stop | Out-Null
  } catch {
    # Fail-soft: a dropped telemetry POST is acceptable; a hung/broken update is not.
  }
}

# -----------------------------------------------------------------------------
# PRD-007a -- manifest resolver (mirrored from install.ps1; the security-critical safe-shape
# validators are kept intact so a tampered manifest field can never reach npm.cmd unvalidated).
# -----------------------------------------------------------------------------

$script:ManifestObject = $null
$script:ManifestFetchAttempted = $false

# SYNC: mirror of install.ps1 Get-Manifest
function Get-Manifest {
  if ($script:ManifestFetchAttempted) { return $script:ManifestObject }
  $script:ManifestFetchAttempted = $true
  try {
    $script:ManifestObject = Invoke-RestMethod -Uri $HoneycombManifestUrl -TimeoutSec 5 -ErrorAction Stop
  } catch {
    try {
      $script:ManifestObject = Invoke-RestMethod -Uri $HoneycombManifestFallbackUrl -TimeoutSec 5 -ErrorAction Stop
    } catch {
      $script:ManifestObject = $null
    }
  }
  return $script:ManifestObject
}

# SYNC: mirror of install.ps1 Test-SafePackageName
function Test-SafePackageName([string]$Name) {
  if ([string]::IsNullOrEmpty($Name)) { return $false }
  return $Name -cmatch '^(@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$'
}

# SYNC: mirror of install.ps1 Test-SafeSemver
function Test-SafeSemver([string]$Version) {
  if ([string]::IsNullOrEmpty($Version)) { return $false }
  return $Version -cmatch '^[0-9]+\.[0-9]+\.[0-9]+([+.-][0-9A-Za-z.+-]+)?$'
}

# SYNC: mirror of install.ps1 Resolve-ProductTarget
# Returns @{ Kind = 'ok'; Target = '<pkg>@<ver>'; Version = '<ver>' }
#      or @{ Kind = 'unpublished'; Pkg = '<pkg>' }   -- do NOT install; leave at current (a-AC-4)
#      or @{ Kind = 'unresolved'; Pkg = '<pkg>' }    -- manifest unreachable/malformed; leave (a-AC-4)
function Resolve-ProductTarget([string]$Slug, [string]$FallbackPkg) {
  $manifest = Get-Manifest
  $pkg = $FallbackPkg
  if ($manifest -and $manifest.products -and $manifest.products.$Slug -and $manifest.products.$Slug.packageName) {
    $candidatePkg = $manifest.products.$Slug.packageName
    if (Test-SafePackageName $candidatePkg) { $pkg = $candidatePkg }
  }
  if (-not $manifest -or -not $manifest.products -or -not $manifest.products.$Slug -or -not $manifest.products.$Slug.version) {
    return @{ Kind = 'unresolved'; Pkg = $pkg }
  }
  $entry = $manifest.products.$Slug
  if (-not (Test-SafeSemver $entry.version)) {
    return @{ Kind = 'unresolved'; Pkg = $pkg }
  }
  $published = $true
  if ($null -ne $entry.published) { $published = [bool]$entry.published }
  if (-not $published) {
    return @{ Kind = 'unpublished'; Pkg = $pkg }
  }
  return @{ Kind = 'ok'; Target = "$pkg@$($entry.version)"; Version = "$($entry.version)" }
}

# -----------------------------------------------------------------------------
# Installed-product detection + version reads (npm ls -g, exactly uninstall.ps1's probe).
# -----------------------------------------------------------------------------

# a-AC-3 authoritative "is this product installed?" signal.
function Test-Installed([string]$Pkg) {
  & npm ls -g $Pkg --depth=0 *> $null
  return ($LASTEXITCODE -eq 0)
}

# Prints the currently-installed global version, or $null. Parses `npm ls -g --json` natively.
function Get-InstalledVersion([string]$Pkg) {
  try {
    $json = (& npm ls -g $Pkg --depth=0 --json 2>$null | Out-String)
    if ([string]::IsNullOrWhiteSpace($json)) { return $null }
    $obj = $json | ConvertFrom-Json
    if (-not $obj.dependencies) { return $null }
    $dep = $obj.dependencies.PSObject.Properties | Where-Object { $_.Name -eq $Pkg } | Select-Object -First 1
    if ($dep -and $dep.Value.version) { return [string]$dep.Value.version }
  } catch {
    return $null
  }
  return $null
}

# Resolve the ABSOLUTE path to an installed product's .cmd shim. `npm i -g` does NOT refresh THIS
# session's PATH, so a bare-name call in the same run can fail (generalized from install.ps1's
# Resolve-HoneycombBin -- prefers the .cmd shim so no visible PowerShell window pops for a daemon).
function Resolve-Bin([string]$BinName) {
  $prefix = (npm prefix -g 2>$null)
  if ($prefix) {
    $candidate = Join-Path $prefix "$BinName.cmd"
    if (Test-Path $candidate) { return $candidate }
  }
  $appdataCmd = Join-Path $env:AppData "npm\$BinName.cmd"
  if (Test-Path $appdataCmd) { return $appdataCmd }
  $cmd = Get-Command $BinName -ErrorAction SilentlyContinue
  if ($cmd) {
    if ($cmd.Source -and $cmd.Source.ToLowerInvariant().EndsWith('.ps1')) {
      $sibling = [System.IO.Path]::ChangeExtension($cmd.Source, '.cmd')
      if (Test-Path $sibling) { return $sibling }
    }
    return $cmd.Source
  }
  return $null
}

# Record a product that actually moved (feeds product_updated + the summary).
function Add-MovedProduct([string]$Slug) {
  $script:MovedProducts += $Slug
  if ($Slug -eq 'honeycomb') { $script:HoneycombMoved = $true }
}

# -----------------------------------------------------------------------------
# Service restart (PRD-007a Decided: converge-first, recycle-only-if-needed).
# -----------------------------------------------------------------------------

function Get-FleetRoot {
  $root = Join-Path $HOME '.apiary'
  if ((-not [string]::IsNullOrWhiteSpace($env:APIARY_HOME)) -and (Test-IsAbsolutePath $env:APIARY_HOME)) {
    $root = $env:APIARY_HOME
  }
  return $root
}

# SYNC: mirror of uninstall.ps1 Stop-DaemonByPidFile (recycle, not remove: the service manager /
# Doctor restarts the daemon after this; the caller re-converges to guarantee it comes back up).
# Returns $true iff it actually stopped a live node daemon (pid-reuse safe, a-AC-6).
function Stop-DaemonByPidFile([string]$PidFilePath, [string]$Label) {
  if (-not (Test-Path -LiteralPath $PidFilePath)) { return $false }
  $raw = ''
  try { $raw = (Get-Content -LiteralPath $PidFilePath -TotalCount 1 -ErrorAction Stop) } catch { return $false }
  $pidText = ($raw -replace '[^0-9]', '')
  if ([string]::IsNullOrEmpty($pidText)) { return $false }
  $processId = 0
  if (-not [int]::TryParse($pidText, [ref]$processId)) { return $false }
  if ($processId -le 0) { return $false }
  $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if (-not $proc) {
    Write-Step "no running $Label daemon (stale pid file)."
    return $false
  }
  if ($proc.ProcessName -ne 'node') {
    Write-Warn "pid $processId from the $Label pid file is not a node process; leaving it alone (pid reuse)."
    return $false
  }
  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  Write-Ok "recycled the running $Label daemon (pid $processId) so it restarts on the new version."
  return $true
}

# Converge a moved product's service onto the new bytes, then recycle its daemon only if it is still
# running old code (a-AC-5/6/7). Converge ALWAYS runs before any kill so Doctor cannot race-restart
# old code. doctor passes no pid files (watchdog; converges last, never recycled here).
function Invoke-ConvergeAndRecycle([string]$Display, [string]$BinName, [string]$Verb, [string[]]$PidFiles) {
  $prodBin = Resolve-Bin $BinName
  if (-not $prodBin) {
    Write-Warn "$Display updated but its '$BinName' command could not be located to restart its service. Open a new terminal (so PATH refreshes) and run: $BinName $Verb"
    return
  }

  Write-Step "converging the $Display service ($BinName $Verb)..."
  & $prodBin $Verb 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Ok "$Display service converged on the new version."
  } else {
    Write-Warn "$Display updated but '$BinName $Verb' did not complete. Run '$BinName $Verb' to finish pointing its service at the new version."
    return
  }

  $recycled = $false
  if ($PidFiles) {
    foreach ($pf in $PidFiles) {
      if ([string]::IsNullOrWhiteSpace($pf)) { continue }
      if (Stop-DaemonByPidFile $pf $Display) { $recycled = $true }
    }
  }

  # If we recycled, re-run the idempotent converge verb so the daemon is brought back up on the new
  # bytes -- so this step never LEAVES a daemon stopped (AC-9), even without Doctor / a keepalive.
  if ($recycled) {
    & $prodBin $Verb 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-Ok "$Display daemon restarted on the new version."
    } else {
      Write-Warn "$Display daemon was recycled but did not restart automatically. Run '$BinName $Verb' to bring it back up."
    }
  }
}

# -----------------------------------------------------------------------------
# Per-product update: detect installed -> resolve target -> skip-if-current -> npm i -g -> converge.
# -----------------------------------------------------------------------------
function Update-OneProduct([string]$Display, [string]$Slug, [string]$Pkg, [string]$BinName, [string]$Verb) {
  # a-AC-3 / AC-4: only INSTALLED products are touched.
  if (-not (Test-Installed $Pkg)) {
    Write-Step "$Display is not installed; skipping."
    return
  }
  $script:InstalledCount++

  $cur = Get-InstalledVersion $Pkg

  # Resolve the target version + install target string per mode.
  $target = $null
  $targetVer = $null
  if ($script:Latest) {
    # a-AC-1b: --latest bypasses the manifest; compare installed vs `npm view` so idempotency holds.
    $targetVer = (& npm view $Pkg version 2>$null | Out-String).Trim()
    if ([string]::IsNullOrWhiteSpace($targetVer) -or -not (Test-SafeSemver $targetVer)) {
      $leave = if ($cur) { $cur } else { 'its current version' }
      Write-Warn "could not resolve the npm latest version for $Display; leaving it at $leave."
      return
    }
    $target = "$Pkg@latest"
  } else {
    $resolved = Resolve-ProductTarget $Slug $Pkg
    if ($resolved.Kind -eq 'ok') {
      $target = $resolved.Target
      $targetVer = $resolved.Version
    } elseif ($resolved.Kind -eq 'unpublished') {
      # a-AC-4: never fall back to @latest in blessed mode; leave it and continue.
      $leave = if ($cur) { $cur } else { 'its current version' }
      Write-Step "could not resolve the blessed version for $Display (not yet published); leaving it at $leave."
      return
    } else {
      $leave = if ($cur) { $cur } else { 'its current version' }
      Write-Step "could not resolve the blessed version for $Display; leaving it at $leave."
      return
    }
  }

  # a-AC-2 / a-AC-1b-2 (idempotent skip): installed already equals target -> no npm, no restart.
  if ($cur -and ($cur -eq $targetVer)) {
    Write-Ok "$Display already current ($cur)."
    return
  }

  $curDisplay = if ($cur) { $cur } else { 'unknown' }

  # a-AC-10 (--dry-run): resolve + print; mutate nothing.
  if ($script:DryRun) {
    Write-Host "[dry-run] $Display`: $curDisplay -> $targetVer"
    Write-Host "[dry-run] would run: npm install -g $target"
    Write-Host "[dry-run] would converge the $Display service: $BinName $Verb"
    if ($Slug -in @('honeycomb', 'hive', 'nectar')) {
      Write-Host "[dry-run] would recycle the $Display daemon (pid file) after converge if it is still running old code"
    }
    Add-MovedProduct $Slug
    return
  }

  # a-AC-1: move the package. Fail-soft per product (warn + mark failed, continue) -- never abort.
  Write-Step "updating $Display ($curDisplay -> $targetVer)..."
  & npm install -g $target 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    $leave = if ($cur) { $cur } else { 'its current version' }
    Write-Warn "could not update $Display (leaving it at $leave). Try: npm install -g $target"
    $script:AnyFailed = $true
    return
  }
  $newVer = Get-InstalledVersion $Pkg
  $newDisplay = if ($newVer) { $newVer } else { $targetVer }
  Write-Ok "$Display updated ($curDisplay -> $newDisplay)."
  Add-MovedProduct $Slug

  # a-AC-5/6/7: converge the service, then recycle its daemon (converge-first). doctor gets no pid
  # file (watchdog; never recycled here).
  $root = Get-FleetRoot
  switch ($Slug) {
    'honeycomb' { Invoke-ConvergeAndRecycle $Display $BinName $Verb @((Join-Path $root 'honeycomb\daemon.pid'), (Join-Path $HOME '.honeycomb\daemon.pid')) }
    'hive'      { Invoke-ConvergeAndRecycle $Display $BinName $Verb @((Join-Path $root 'hive\hive.pid')) }
    'nectar'    { Invoke-ConvergeAndRecycle $Display $BinName $Verb @((Join-Path $root 'nectar\nectar.pid')) }
    'doctor'    { Invoke-ConvergeAndRecycle $Display $BinName $Verb @() }
  }
}

# -----------------------------------------------------------------------------
# PRD-007b -- harness detection + Claude Code plugin refresh (gated on honeycomb moving). The shell
# owns ORDERING + REPORTING; honeycomb owns the wiring -- we invoke its CLI, never re-implement
# detection or the connector here (no hardcoded ~/.claude paths).
# -----------------------------------------------------------------------------

# Detect installed harnesses via honeycomb's OWN CLI surface (b-AC-1/b-AC-6). The verb is
# `honeycomb harness status` (verified on the blessed v0.8.0 build; the older `honeycomb harnesses`
# does not exist and exits 1). PREFERS `honeycomb harness status --json` (PRD-006c/006d) so an empty
# JSON array/object reliably reads as "none"; falls back to plain-text `honeycomb harness status`
# when --json exits non-zero, and treats a non-JSON body (this blessed build prints plain text for
# --json too) as the already-human-readable report. Returns @{ State = 'detected|none|unknown';
# Text = '<list>' }.
function Get-DetectedHarnesses([string]$HcBin) {
  $out = (& $HcBin harness status --json 2>$null | Out-String)
  $ok = ($LASTEXITCODE -eq 0)
  if (-not $ok) {
    $out = (& $HcBin harness status 2>$null | Out-String)
    $ok = ($LASTEXITCODE -eq 0)
  }
  if (-not $ok) { return @{ State = 'unknown'; Text = '' } }

  $trimmed = $out.Trim()
  if ([string]::IsNullOrWhiteSpace($trimmed)) { return @{ State = 'none'; Text = '' } }

  # Try JSON first (robust none-detection); a non-JSON body throws and is handled as plain text.
  try {
    $j = $trimmed | ConvertFrom-Json
    $items = @()
    if ($j -is [System.Array]) {
      $items = @($j)
    } elseif ($j -and ($j.PSObject.Properties.Name -contains 'harnesses')) {
      $items = @($j.harnesses)
    } elseif ($j -is [System.Management.Automation.PSCustomObject]) {
      $items = @($j.PSObject.Properties)
    }
    $lines = @()
    foreach ($it in $items) {
      if ($null -eq $it) { continue }
      if ($it -is [string]) { $lines += $it; continue }
      if ($it -is [System.Management.Automation.PSPropertyInfo]) {
        $name = $it.Name; $val = $it.Value
        $status = if ($val -and $val.status) { [string]$val.status } elseif ($val -and $val.state) { [string]$val.state } else { '' }
        $plugin = ''
        if ($val -and ($val.PSObject.Properties.Name -contains 'pluginEnabled')) { $plugin = 'plugin ' + $(if ([bool]$val.pluginEnabled) { 'enabled' } else { 'disabled' }) }
        $detail = (@($status, $plugin) | Where-Object { $_ }) -join ', '
        $lines += $(if ($detail) { "${name}: $detail" } else { "$name" })
        continue
      }
      $name = $it.name; if (-not $name) { $name = $it.harness }; if (-not $name) { $name = $it.id }
      $status = if ($it.status) { [string]$it.status } elseif ($it.state) { [string]$it.state } else { '' }
      $plugin = ''
      if ($it.PSObject.Properties.Name -contains 'pluginEnabled') { $plugin = 'plugin ' + $(if ([bool]$it.pluginEnabled) { 'enabled' } else { 'disabled' }) }
      $detail = (@($status, $plugin) | Where-Object { $_ }) -join ', '
      $lines += $(if ($detail) { "${name}: $detail" } elseif ($name) { "$name" } else { ($it | ConvertTo-Json -Compress) })
    }
    if ($lines.Count -gt 0) { return @{ State = 'detected'; Text = ($lines -join "`n") } }
    return @{ State = 'none'; Text = '' }
  } catch {
    # Not JSON: the plain text IS the already-human-readable report.
    return @{ State = 'detected'; Text = $out.TrimEnd() }
  }
}

function Update-Harnesses {
  $hcBin = Resolve-Bin 'honeycomb'
  if (-not $hcBin) {
    # b-AC-3: honeycomb CLI not on PATH -> print the exact next command; never claim success; never fail.
    Write-Warn "Honeycomb updated, but the 'honeycomb' command is not on PATH yet, so the coding-assistant plugin could not be refreshed automatically."
    Write-Host ''
    Write-Host 'Open a new terminal (so PATH refreshes), then run:'
    Write-Host ''
    Write-Host '  honeycomb setup'
    Write-Host ''
    Write-Host 'Then restart Claude Code to load the updated plugin.'
    return
  }

  if ($script:DryRun) {
    Write-Host '[dry-run] would list installed harnesses: honeycomb harness status --json'
    Write-Host '[dry-run] would refresh the Claude Code plugin: honeycomb setup'
    Write-Host '[dry-run] would print: restart Claude Code to load the updated plugin'
    return
  }

  # b-AC-1: report which harnesses are installed, via honeycomb's own detection surface (not
  # re-implemented here). Get-DetectedHarnesses drives `honeycomb harness status` (prefers --json).
  $detected = Get-DetectedHarnesses $hcBin
  if ($detected.State -eq 'detected') {
    Write-Step 'detected coding assistants:'
    Write-Host $detected.Text
  } elseif ($detected.State -eq 'none') {
    # b-AC-6: no harness installed -> clean no-op, not an error.
    Write-Ok 'no coding assistants detected.'
    Write-Ok 'no coding assistants to refresh.'
    return
  } else {
    # Detection surface unavailable on this pin: guide to the real verb, never fail (b-AC-5).
    Write-Step "run 'honeycomb harness status' to see which coding assistants are installed."
  }

  # b-AC-2: refresh the plugin via the confirmed-working `honeycomb setup` (PRD-006). Idempotent.
  Write-Step 'refreshing the Claude Code plugin (honeycomb setup)...'
  & $hcBin setup 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Ok 'Claude Code plugin refreshed.'
    # b-AC-4: a running session may not hot-reload; always name the one residual manual action.
    Write-Ok 'restart Claude Code to load the updated plugin.'
  } else {
    # b-AC-5: degrade to a clear message; NEVER fail the update over the harness result.
    Write-Warn 'could not refresh the Claude Code plugin automatically.'
    Write-Host ''
    Write-Host 'Open a new terminal (so PATH refreshes), then run:'
    Write-Host ''
    Write-Host '  honeycomb setup'
    Write-Host ''
    Write-Host 'Then restart Claude Code to load the updated plugin.'
  }
}

# -----------------------------------------------------------------------------
# Node/npm presence (a-AC-9/AC-10). The updater does NOT bootstrap Node; it requires a working
# Node/npm and reports plainly if either is missing, touching nothing.
# -----------------------------------------------------------------------------
function Test-NodePresent {
  if ((Test-Have 'node') -and (Test-Have 'npm')) {
    Write-Ok "Node $(node --version) and npm $(npm --version) found."
    return $true
  }
  Write-Fail "the update needs Node $HoneycombNodeVersion and npm, but neither was found on PATH."
  Write-Host ''
  Write-Host "Install Node $HoneycombNodeVersion with ONE of these, then re-run the update:"
  Write-Host ''
  Write-Host '  # winget (recommended on Windows 10/11):'
  Write-Host '  winget install OpenJS.NodeJS.LTS'
  Write-Host ''
  Write-Host '  # or via the official MSI:'
  Write-Host '  https://nodejs.org/en/download'
  Write-Host ''
  Write-Host '  # Then re-run:'
  Write-Host "  irm $HoneycombInstallBaseUrl/update.ps1 | iex"
  Write-Host ''
  return $false
}

# One product_updated per product that ACTUALLY moved (c-AC-7); never for skipped/absent products.
# Dry-run previews only.
function Send-ProductUpdatedEvents {
  foreach ($p in $script:MovedProducts) {
    if ([string]::IsNullOrWhiteSpace($p)) { continue }
    Send-PhoneHome 'product_updated' $p
  }
}

function Write-Summary {
  $moved = ($script:MovedProducts -join ',')
  if ($script:DryRun) {
    if ($script:MovedProducts.Count -eq 0) {
      if ($script:InstalledCount -eq 0) {
        Write-Ok '[dry-run] no Apiary products are installed; nothing would be updated.'
      } else {
        Write-Ok '[dry-run] already up to date; nothing would be updated.'
      }
    } else {
      Write-Ok "[dry-run] would update: $moved."
    }
    return
  }
  if ($script:InstalledCount -eq 0) {
    Write-Ok 'No Apiary products are installed; nothing to update.'
    return
  }
  # AC-3 / a-AC-8: whole fleet already at target -> no npm, no restart, "already up to date".
  if ($script:MovedProducts.Count -eq 0) {
    Write-Ok 'already up to date.'
    return
  }
  Write-Ok "Update complete. Updated: $moved."
  if ($script:AnyFailed) {
    Write-Host 'Some products could not be updated (see the notes above); nothing was removed.'
  }
}

# -----------------------------------------------------------------------------
# Entrypoint. Returns a status CODE (never calls `exit` in the `irm | iex` bootstrap, which would
# terminate the CALLER's PowerShell host and can close the user's terminal). Funnels every terminal
# exit through the $finish scriptblock so exactly one update_completed / update_failed fires (c-AC-6).
# -----------------------------------------------------------------------------
function Invoke-Main([string[]]$InvocationArgs) {
  $parseStatus = Get-ArgumentStatus $InvocationArgs
  if ($parseStatus -eq 2) { return 0 }   # --help shown; no telemetry (a usage request is not a run)
  if ($parseStatus -ne 0) {              # unknown flag; usage error, no telemetry
    Show-Usage
    return 1
  }

  # c-AC-5: update_started fires FIRST, before any resolution work, using only Invoke-RestMethod
  # (no Node/npm dependency -- native to PowerShell).
  Resolve-InstallId
  Send-PhoneHome 'update_started'

  $finish = {
    param([int]$Code)
    if ($Code -eq 0) {
      Send-PhoneHome 'update_completed'
    } else {
      Send-PhoneHome 'update_failed'
    }
    return $Code
  }

  # a-AC-1b-1: one up-front warning when --latest bypasses the blessed set.
  if ($script:Latest) {
    Write-Warn '--latest bypasses the blessed fleet set; products may land on untested or mismatched versions.'
  }

  # a-AC-9 / AC-10: require a working Node/npm; in -DryRun, report presence but never stop.
  if ($script:DryRun) {
    if ((Test-Have 'node') -and (Test-Have 'npm')) {
      Write-Ok "Node $(node --version) and npm $(npm --version) found (dry-run: nothing will be changed)."
    } else {
      Write-Warn 'node/npm not found (dry-run; a real run requires them and would stop here without touching anything).'
    }
  } else {
    if (-not (Test-NodePresent)) { return (& $finish 1) }
  }

  Write-Step 'checking installed Apiary products (blessed = hive-release.json-pinned)...'
  # doctor is converged LAST (watchdog); the fixed slug order below guarantees that.
  Update-OneProduct 'Honeycomb' 'honeycomb' '@legioncodeinc/honeycomb' 'honeycomb' 'install'
  Update-OneProduct 'Hive'      'hive'      '@legioncodeinc/hive'      'hive'      'install-service'
  Update-OneProduct 'Nectar'    'nectar'    '@legioncodeinc/nectar'    'nectar'    'install'
  Update-OneProduct 'Doctor'    'doctor'    '@legioncodeinc/doctor'    'doctor'    'install-service'

  # 007b: refresh the coding-assistant plugin ONLY when the plugin-bearing honeycomb package moved.
  if ($script:HoneycombMoved) {
    Update-Harnesses
  }

  # c-AC-7: one product_updated per moved product. $script:MovedProducts is already the moved list,
  # so the terminal event's `products` field is honest about what changed (PRD-007c).
  Send-ProductUpdatedEvents

  Write-Summary

  # AC-9: a per-product failure is non-blocking but still surfaces as update_failed / non-zero exit
  # (mirrors install.ps1's extra-product-failed posture); an all-clean run is update_completed / 0.
  if ($script:AnyFailed) { return (& $finish 1) }
  return (& $finish 0)
}

# Set the exit code once and propagate process exit for -File runs only. Under the documented
# `irm ... | iex` bootstrap, calling `exit` would terminate the CALLER's PowerShell host (closing the
# user's terminal), so we only `exit` when this script is the top-level `-File` invocation -- exactly
# uninstall.ps1's IsTopLevelFileInvocation pattern, so `-File update.ps1` propagates its exit code.
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
