[CmdletBinding()]
param(
  [string]$CudaVersion = '12.4',
  [string]$RuntimeDir
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Select-ReleaseAsset {
  param(
    [Parameter(Mandatory)] [object[]]$Assets,
    [Parameter(Mandatory)] [string]$Pattern,
    [string]$PreferredFragment
  )

  $matches = @($Assets | Where-Object { $_.name -match $Pattern })
  if (-not $matches) {
    throw "GitHub release does not contain an asset matching: $Pattern"
  }

  if ($PreferredFragment) {
    $preferred = @($matches | Where-Object { $_.name -like "*$PreferredFragment*" })
    if ($preferred) { return $preferred[0] }
  }
  return $matches[0]
}

function Assert-AssetHash {
  param(
    [Parameter(Mandatory)] [string]$Path,
    [AllowNull()] [string]$Digest
  )

  if (-not $Digest -or $Digest -notmatch '^sha256:(.+)$') { return }
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
  if ($actual -ne $Matches[1]) {
    throw "SHA-256 mismatch for $(Split-Path -Leaf $Path)"
  }
}

$RuntimeDir = if ($RuntimeDir) { $RuntimeDir } else { Join-Path $PSScriptRoot '..\release\win-unpacked\resources\runtime\llama' }
$runtimeFullPath = [IO.Path]::GetFullPath($RuntimeDir)
$tempRoot = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ("CodexDesktopShell-llama-" + [guid]::NewGuid().ToString('N'))))

try {
  New-Item -ItemType Directory -Force -Path $runtimeFullPath,$tempRoot | Out-Null

  Write-Host 'Querying the latest official ggml-org/llama.cpp release...'
  $release = Invoke-RestMethod `
    -Uri 'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest' `
    -Headers @{ 'User-Agent' = 'CodexDesktopShell-Setup' }

  $mainAsset = Select-ReleaseAsset `
    -Assets $release.assets `
    -Pattern '^llama-.*-bin-win-cuda-[^-]+-x64\.zip$' `
    -PreferredFragment "cuda-$CudaVersion-x64"
  $cudaAsset = Select-ReleaseAsset `
    -Assets $release.assets `
    -Pattern '^cudart-llama-bin-win-cuda-[^-]+-x64\.zip$' `
    -PreferredFragment "cuda-$CudaVersion-x64"

  $downloads = @($mainAsset, $cudaAsset)
  foreach ($asset in $downloads) {
    $archivePath = Join-Path $tempRoot $asset.name
    $extractPath = Join-Path $tempRoot ([IO.Path]::GetFileNameWithoutExtension($asset.name))
    Write-Host "Downloading $($asset.name)..."
    Invoke-WebRequest `
      -Uri $asset.browser_download_url `
      -OutFile $archivePath `
      -Headers @{ 'User-Agent' = 'CodexDesktopShell-Setup' }
    Assert-AssetHash -Path $archivePath -Digest $asset.digest
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath -Force
    Copy-Item -Path (Join-Path $extractPath '*') -Destination $runtimeFullPath -Recurse -Force
  }

  $server = Get-ChildItem -LiteralPath $runtimeFullPath -Recurse -File -Filter 'llama-server.exe' | Select-Object -First 1
  if (-not $server) { throw 'The downloaded archives did not contain llama-server.exe.' }

  if ($server.DirectoryName -ne $runtimeFullPath) {
    Copy-Item -Path (Join-Path $server.DirectoryName '*') -Destination $runtimeFullPath -Recurse -Force
    $server = Get-Item -LiteralPath (Join-Path $runtimeFullPath 'llama-server.exe')
  }

  & $server.FullName --version
  if ($LASTEXITCODE -ne 0) { throw "llama-server.exe validation failed with exit code $LASTEXITCODE" }

  Write-Host "Installed llama.cpp $($release.tag_name) to: $runtimeFullPath"
}
finally {
  $systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if ((Test-Path -LiteralPath $tempRoot) -and $tempRoot.StartsWith($systemTemp, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
