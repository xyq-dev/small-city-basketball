param(
    [string]$CliPath = $env:WECHAT_DEVTOOLS_CLI,
    [string]$AppId
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $CliPath) {
    $candidates = @(
        "${env:ProgramFiles(x86)}\Tencent\微信web开发者工具\cli.bat",
        "${env:ProgramFiles(x86)}\微信web开发者工具\cli.bat",
        "$env:ProgramFiles\Tencent\微信web开发者工具\cli.bat",
        "$env:ProgramFiles\微信web开发者工具\cli.bat"
    )
    $CliPath = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if (-not $CliPath -or -not (Test-Path -LiteralPath $CliPath -PathType Leaf)) {
    throw '找不到微信开发工具CLI，请用 -CliPath 指定cli.bat的真实路径。'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '需要Node.js >=22.12。' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw '找不到npm.cmd。' }
& npm.cmd ci --prefix (Join-Path $repoRoot 'tools/wechat-ui') --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw '本地验收SDK安装失败。' }
$nodeArgs = @((Join-Path $repoRoot 'scripts/wechat-devtools-ui.mjs'), 'capture', '--cli', $CliPath)
if ($AppId) { $nodeArgs += @('--app-id', $AppId) }
& node @nodeArgs
if ($LASTEXITCODE -ne 0) { throw '截图采集未完成，请查看错误或验收目录report.json；不能标记通过。' }
