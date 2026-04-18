param(
  [string]$Version = $env:VERSION,
  [switch]$NoModifyPath,
  [string]$InstallDir = $env:ULMCODE_INSTALL_DIR,
  [string]$ProfileDir = $env:ULMCODE_PROFILE_DIR,
  [string]$Repo = $env:ULMCODE_GITHUB_REPO
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Repo)) { $Repo = "trevor050/ulmcode" }
if ([string]::IsNullOrWhiteSpace($InstallDir)) { $InstallDir = Join-Path $env:LOCALAPPDATA "ulmcode\\bin" }
if ([string]::IsNullOrWhiteSpace($ProfileDir)) { $ProfileDir = Join-Path $HOME ".config\\ulmcode" }

function Get-Avx2Supported {
  try {
    $sig = '[DllImport("kernel32.dll")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);'
    return (Add-Type -MemberDefinition $sig -Name Kernel32 -Namespace Win32 -PassThru)::IsProcessorFeaturePresent(40)
  } catch {
    return $true
  }
}

$needsBaseline = -not (Get-Avx2Supported)
$target = "windows-x64"
if ($needsBaseline) { $target = "$target-baseline" }

# Release assets are named "opencode-<target>.zip" in this fork; we install the binary as "ulmcode.exe".
$asset = "opencode-$target.zip"
$skillsAsset = "ulmcode-skills.tar.gz"

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("ulmcode-install-" + [System.Guid]::NewGuid().ToString("n"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null

  if ([string]::IsNullOrWhiteSpace($Version)) {
    $cliUrl = "https://github.com/$Repo/releases/latest/download/$asset"
  } else {
    $v = $Version.TrimStart("v")
    $cliUrl = "https://github.com/$Repo/releases/download/v$v/$asset"
  }

  Write-Host "[info] downloading $cliUrl"
  $zipPath = Join-Path $tmp $asset
  Invoke-WebRequest -UseBasicParsing -Uri $cliUrl -OutFile $zipPath

  $extractDir = Join-Path $tmp "cli"
  Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

  $candidates = @(
    (Join-Path $extractDir "ulmcode.exe"),
    (Join-Path $extractDir "opencode.exe"),
    (Join-Path $extractDir "ulmcode"),
    (Join-Path $extractDir "opencode")
  )
  $src = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $src) {
    throw "could not find extracted binary in $extractDir"
  }

  $dst = Join-Path $InstallDir "ulmcode.exe"
  Copy-Item -Force $src $dst
  Write-Host "[ok] installed $dst"

  if (-not $NoModifyPath) {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($null -eq $userPath) { $userPath = "" }
    $parts = $userPath -split ";" | Where-Object { $_ -and $_.Trim() -ne "" }
    if ($parts -notcontains $InstallDir) {
      $newPath = ($parts + $InstallDir) -join ";"
      [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
      $env:Path = $newPath + ";" + $env:Path
      Write-Host "[ok] added $InstallDir to user PATH"
    } else {
      Write-Host "[info] PATH already contains $InstallDir"
    }
  }

  # Skills bundle + profile init
  $skillsUrl = "https://github.com/$Repo/releases/latest/download/$skillsAsset"
  if (-not [string]::IsNullOrWhiteSpace($Version)) {
    $v = $Version.TrimStart("v")
    $skillsUrl = "https://github.com/$Repo/releases/download/v$v/$skillsAsset"
  }

  Write-Host "[info] downloading $skillsUrl"
  $skillsPath = Join-Path $tmp $skillsAsset
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $skillsUrl -OutFile $skillsPath
  } catch {
    Write-Host "[warn] versioned skills bundle missing, falling back to latest"
    $skillsUrl = "https://github.com/$Repo/releases/latest/download/$skillsAsset"
    Invoke-WebRequest -UseBasicParsing -Uri $skillsUrl -OutFile $skillsPath
  }

  # Expect bundle contains "skills/..."
  & tar -xzf $skillsPath -C $ProfileDir
  Write-Host "[ok] extracted skills into $ProfileDir"

  Write-Host "[info] initializing profile: ulmcode profile init --dir `"$ProfileDir`" --force"
  & $dst profile init --dir $ProfileDir --force | Out-Host

  Write-Host ""
  Write-Host "installed. run: ulmcode"
  Write-Host "update later: ulmcode upgrade"
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue | Out-Null
}
