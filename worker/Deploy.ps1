param([Parameter(Mandatory=$true)][string]$ManifestUrl)
$ErrorActionPreference = 'Stop'
$manifestUri = [Uri]$ManifestUrl
if ($manifestUri.Scheme -ne 'https' -or $manifestUri.Host -ne 'raw.githubusercontent.com' -or $manifestUri.Query -or $manifestUri.UserInfo -or $ManifestUrl -notmatch '/[a-f0-9]{40}/(?:[^?#]+/)?manifest\.json$') {
    throw 'Provide the immutable raw.githubusercontent.com URL with a full 40-character commit SHA.'
}
Push-Location $PSScriptRoot
try {
    if (-not (Test-Path -LiteralPath '.\node_modules\.bin\wrangler.cmd')) {
        npm ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    }
    $configPath = Join-Path $PSScriptRoot 'wrangler.toml'
    $config = Get-Content -LiteralPath $configPath -Raw
    $config = $config -replace '(?m)^MANIFEST_URL = .*$', ('MANIFEST_URL = "' + $ManifestUrl + '"')
    Set-Content -LiteralPath $configPath -Value $config -Encoding utf8
    npm run check
    if ($LASTEXITCODE -ne 0) { throw 'Worker dry-run failed' }
    Write-Host 'Deployment requires an authorized Cloudflare account. Run npx wrangler login first if necessary.'
    .\node_modules\.bin\wrangler.cmd deploy
    if ($LASTEXITCODE -ne 0) { throw 'Deployment failed; no successful endpoint is claimed.' }
} finally { Pop-Location }
