[CmdletBinding()]
param(
  [string]$RuntimeDir
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Assert-AssetHash {
  param([Parameter(Mandatory)][string]$Path, [AllowNull()][string]$Digest)
  if (-not $Digest -or $Digest -notmatch '^sha256:(.+)$') { return }
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
  if ($actual -ne $Matches[1]) { throw "SHA-256 mismatch for $(Split-Path -Leaf $Path)" }
}

$RuntimeDir = if ($RuntimeDir) { $RuntimeDir } else { Join-Path $PSScriptRoot '..\release\win-unpacked\resources\runtime\poppler' }
$runtimeFullPath = [IO.Path]::GetFullPath($RuntimeDir)
$tempRoot = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ("CodexDesktopShell-poppler-" + [guid]::NewGuid().ToString('N'))))

try {
  New-Item -ItemType Directory -Force -Path $runtimeFullPath,$tempRoot | Out-Null
  $release = Invoke-RestMethod `
    -Uri 'https://api.github.com/repos/oschwartz10612/poppler-windows/releases/latest' `
    -Headers @{ 'User-Agent' = 'CodexDesktopShell-Setup' }
  $asset = @($release.assets | Where-Object { $_.name -match '\.zip$' } | Select-Object -First 1)
  if (-not $asset) { throw '未找到 Poppler Windows x86_64 压缩包。' }

  $archivePath = Join-Path $tempRoot $asset.name
  $extractPath = Join-Path $tempRoot 'extracted'
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $archivePath -Headers @{ 'User-Agent' = 'CodexDesktopShell-Setup' }
  Assert-AssetHash -Path $archivePath -Digest $asset.digest
  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath -Force

  $exe = Get-ChildItem -LiteralPath $extractPath -Recurse -File -Filter 'pdftotext.exe' | Select-Object -First 1
  if (-not $exe) { throw '下载的 Poppler 包中没有 pdftotext.exe。' }
  Copy-Item -Path (Join-Path $exe.DirectoryName '*') -Destination $runtimeFullPath -Recurse -Force
  $installed = Join-Path $runtimeFullPath 'pdftotext.exe'
  if (-not (Test-Path -LiteralPath $installed)) { throw 'Poppler 文件复制后未找到 pdftotext.exe。' }
  & $installed -v 2>&1 | Select-Object -First 1
  Write-Host "Installed Poppler $($release.tag_name) to: $runtimeFullPath"
}
finally {
  $systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if ((Test-Path -LiteralPath $tempRoot) -and $tempRoot.StartsWith($systemTemp, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
