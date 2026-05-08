param(
    [Parameter(Mandatory=$true)][string]$OutputPath,
    [string]$MacroName = 'new_macro',
    [int]$CountdownSeconds = 3,
    [string]$StopFile = ''
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $OutputEncoding

function Write-Step {
    param([string]$Message)
    Write-Host "[Recorder] $Message"
}

function Test-StopRequested {
    return ($StopFile -and (Test-Path -LiteralPath $StopFile))
}

$outputDirectory = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $outputDirectory)) {
    New-Item -ItemType Directory -Path $outputDirectory | Out-Null
}

if ($StopFile -and (Test-Path -LiteralPath $StopFile)) {
    Remove-Item -LiteralPath $StopFile -Force
}

Write-Step '录制即将开始。请不要录制密码、验证码或支付等敏感操作。'
for ($i = $CountdownSeconds; $i -gt 0; $i--) {
    if (Test-StopRequested) {
        Write-Step '收到取消信号，录制倒计时终止。'
        exit 0
    }
    Write-Step ("{0} 秒后开始录制，请切换到目标窗口..." -f $i)
    Start-Sleep -Seconds 1
}

if (Test-StopRequested) {
    Write-Step '收到取消信号，录制倒计时终止。'
    exit 0
}

Add-Type -Path (Join-Path $PSScriptRoot 'MacroRecorderNative.cs') -ReferencedAssemblies 'System.Windows.Forms','System.Drawing'

Write-Step '开始录制。按 F8 停止录制。'
$actions = [UniversalMacroRecorder.NativeRecorder]::Record($StopFile)

Add-Type -AssemblyName System.Windows.Forms
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds

$macroActions = @()
foreach ($action in $actions) {
    $macroActions += [pscustomobject]@{
        type = $action.type
        delayMs = [int64]$action.delayMs
        timestampMs = [int64]$action.timestampMs
        x = [int]$action.x
        y = [int]$action.y
        button = [int]$action.button
        delta = [int]$action.delta
        virtualKey = [int]$action.virtualKey
        keyName = [string]$action.keyName
    }
}

$macro = [pscustomobject]@{
    schemaVersion = 1
    name = $MacroName
    createdAt = (Get-Date).ToString('s')
    coordinateMode = 'screenAbsolute'
    stopRecordingKey = 'F8'
    stopPlaybackKey = 'F9'
    screen = [pscustomobject]@{
        width = [int]$bounds.Width
        height = [int]$bounds.Height
        left = [int]$bounds.Left
        top = [int]$bounds.Top
    }
    actions = $macroActions
}

$json = $macro | ConvertTo-Json -Depth 8
Set-Content -LiteralPath $OutputPath -Value $json -Encoding utf8
Write-Step ("录制完成。动作数: {0}" -f $macroActions.Count)
Write-Step ("模板已写入: {0}" -f $OutputPath)
