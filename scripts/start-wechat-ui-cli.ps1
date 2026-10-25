param(
    [Parameter(Mandatory = $true)][string]$CliPath,
    [Parameter(Mandatory = $true)][string]$ProjectPath,
    [Parameter(Mandatory = $true)][ValidateRange(1024, 65535)][int]$AutomationPort
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $CliPath -PathType Leaf)) { throw 'WeChat CLI not found.' }
if (-not (Test-Path -LiteralPath $ProjectPath -PathType Container)) { throw 'Fixture project not found.' }
# Native batch execution belongs to PowerShell, never Node spawn(cli.bat).
# All values arrive as -File parameters; do not build an Invoke-Expression command.
& $CliPath auto --project $ProjectPath --auto-port $AutomationPort --trust-project
exit $LASTEXITCODE
