param(
    [string]$OutputPath = "simple-agent.vsix"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$extensionDir = Join-Path $repoRoot "extension"
$resolvedOutput = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
    $OutputPath
} else {
    Join-Path $repoRoot $OutputPath
}

if (-not (Test-Path $extensionDir)) {
    throw "Extension directory not found: $extensionDir"
}

if (Test-Path $resolvedOutput) {
    Remove-Item $resolvedOutput -Force
}

$localVsce = Join-Path $repoRoot "node_modules/.bin/vsce.cmd"
$vsceCommand = if (Test-Path $localVsce) {
    $localVsce
} else {
    $command = Get-Command vsce -ErrorAction SilentlyContinue
    if ($command) { $command.Source } else { $null }
}

if ($vsceCommand) {
    Push-Location $extensionDir
    try {
        & $vsceCommand package --out $resolvedOutput
    } finally {
        Pop-Location
    }
    Write-Host "Created package with vsce: $resolvedOutput"
    exit 0
}

$tempZip = [System.IO.Path]::ChangeExtension($resolvedOutput, ".zip")
if (Test-Path $tempZip) {
    Remove-Item $tempZip -Force
}

Add-Type -AssemblyName "System.IO.Compression.FileSystem"
$zipArchive = [System.IO.Compression.ZipFile]::Open($tempZip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    Get-ChildItem -Path $extensionDir -Recurse -File | ForEach-Object {
        $fullPath = $_.FullName
        if ([System.IO.Path].GetMethod("GetRelativePath", [Type[]]@([string], [string]))) {
            $relativePath = [System.IO.Path]::GetRelativePath($repoRoot, $fullPath)
        } else {
            $baseUri = [System.Uri]::new(($repoRoot.TrimEnd("\", "/") + [System.IO.Path]::DirectorySeparatorChar))
            $fileUri = [System.Uri]::new($fullPath)
            $relativePath = [System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($fileUri).ToString())
        }
        $relativePath = $relativePath.Replace("\", "/")
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zipArchive, $_.FullName, $relativePath) | Out-Null
    }
} finally {
    $zipArchive.Dispose()
}
Move-Item -Path $tempZip -Destination $resolvedOutput -Force
Write-Host "Created fallback package: $resolvedOutput"
