param(
    [Parameter(Mandatory=$true)][string]$MacroPath,
    [int]$LoopCount = 1,
    [switch]$Infinite,
    [int]$CountdownSeconds = 5,
    [double]$StepIntervalSeconds = 3,
    [string]$StopFile = '',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $OutputEncoding

function Write-Step {
    param([string]$Message)
    Write-Host "[Playback] $Message"
}

function Test-StopRequested {
    if ($StopFile -and (Test-Path -LiteralPath $StopFile)) {
        return $true
    }
    if ($DryRun) {
        return $false
    }
    return [UniversalMacroRecorder.InputControl]::IsStopRequested()
}

if (-not (Test-Path -LiteralPath $MacroPath)) {
    throw "模板不存在: $MacroPath"
}

if (-not $Infinite -and $LoopCount -lt 1) {
    throw 'LoopCount 必须大于等于 1'
}

if ($StepIntervalSeconds -lt 0) {
    throw 'StepIntervalSeconds 不能小于 0'
}

if ($StopFile -and (Test-Path -LiteralPath $StopFile)) {
    Remove-Item -LiteralPath $StopFile -Force
}

$macro = Get-Content -LiteralPath $MacroPath -Encoding utf8 -Raw | ConvertFrom-Json
if (-not $macro.actions -or $macro.actions.Count -lt 1) {
    throw '模板没有可回放动作'
}

if (-not $DryRun) {
    Add-Type -Path (Join-Path $PSScriptRoot 'MacroPlaybackNative.cs') -ReferencedAssemblies 'System.Windows.Forms','System.Drawing'
    [UniversalMacroRecorder.InputControl]::StartStopHotkey()
}

try {
    Write-Step ("模板: {0}, 动作数: {1}, 固定步骤间隔: {2} 秒" -f $macro.name, $macro.actions.Count, $StepIntervalSeconds)
    Write-Step '请不要在回放期间操作鼠标键盘。按 F9 可紧急停止。'
    for ($i = $CountdownSeconds; $i -gt 0; $i--) {
        if (Test-StopRequested) {
            Write-Step '收到取消信号，回放倒计时终止。'
            exit 0
        }
        Write-Step ("{0} 秒后开始回放，请切换到目标窗口..." -f $i)
        Start-Sleep -Seconds 1
    }

    if (Test-StopRequested) {
        Write-Step '收到取消信号，回放倒计时终止。'
        exit 0
    }

    $round = 0
    while ($true) {
        if (-not $Infinite -and $round -ge $LoopCount) {
            break
        }
        $round++
        Write-Step ("开始第 {0} 轮" -f $round)

        foreach ($action in $macro.actions) {
            if (-not $DryRun -and (Test-StopRequested)) {
                Write-Step '收到停止信号，回放终止。'
                exit 0
            }

            $delay = [int]($StepIntervalSeconds * 1000)
            if ($delay -gt 0) {
                Start-Sleep -Milliseconds $delay
            }

            switch ($action.type) {
                'mouseMove' {
                    if ($DryRun) { Write-Step ("DryRun mouseMove ({0},{1})" -f $action.x, $action.y) } else { [UniversalMacroRecorder.InputControl]::MoveTo([int]$action.x, [int]$action.y) }
                }
                'mouseDown' {
                    Write-Step ("回放事件: 鼠标按下 button={0} 坐标=({1}, {2})" -f $action.button, $action.x, $action.y)
                    if ($DryRun) { Write-Step ("DryRun mouseDown button={0} ({1},{2})" -f $action.button, $action.x, $action.y) } else { [UniversalMacroRecorder.InputControl]::MouseDown([int]$action.button, [int]$action.x, [int]$action.y) }
                }
                'mouseUp' {
                    Write-Step ("回放事件: 鼠标抬起 button={0} 坐标=({1}, {2})" -f $action.button, $action.x, $action.y)
                    if ($DryRun) { Write-Step ("DryRun mouseUp button={0} ({1},{2})" -f $action.button, $action.x, $action.y) } else { [UniversalMacroRecorder.InputControl]::MouseUp([int]$action.button, [int]$action.x, [int]$action.y) }
                }
                'mouseWheel' {
                    Write-Step ("回放事件: 鼠标滚轮 delta={0} 坐标=({1}, {2})" -f $action.delta, $action.x, $action.y)
                    if ($DryRun) { Write-Step ("DryRun mouseWheel delta={0} ({1},{2})" -f $action.delta, $action.x, $action.y) } else { [UniversalMacroRecorder.InputControl]::Wheel([int]$action.x, [int]$action.y, [int]$action.delta) }
                }
                'keyDown' {
                    Write-Step ("回放事件: 键盘按下 {0}" -f $action.keyName)
                    if ($DryRun) { Write-Step ("DryRun keyDown {0}" -f $action.virtualKey) } else { [UniversalMacroRecorder.InputControl]::KeyDown([int]$action.virtualKey) }
                }
                'keyUp' {
                    Write-Step ("回放事件: 键盘抬起 {0}" -f $action.keyName)
                    if ($DryRun) { Write-Step ("DryRun keyUp {0}" -f $action.virtualKey) } else { [UniversalMacroRecorder.InputControl]::KeyUp([int]$action.virtualKey) }
                }
            }
        }
    }

    Write-Step '回放完成。'
} finally {
    if (-not $DryRun) {
        [UniversalMacroRecorder.InputControl]::StopStopHotkey()
    }
}
