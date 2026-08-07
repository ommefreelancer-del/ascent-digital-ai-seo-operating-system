# Idempotently (re)installs the ADASOS-PM2-Watchdog scheduled task.
#
# This is the single source of truth for that task's configuration. It
# exists because the task was originally created by hand (an interactive
# `schtasks /create` run, never captured anywhere), which is why earlier
# fixes silently regressed: nobody could re-apply or audit config that was
# never written down. Re-run this any time -- after a Windows reinstall, if
# the task gets deleted, or to verify current settings are still correct.
#
# Two root causes this fixes (see RUN_GUIDE.md for the full investigation):
#
# 1. The task's DisallowStartIfOnBatteries / StopIfGoingOnBatteries were
#    left at Windows Task Scheduler's defaults (both true). On a laptop
#    that's unplugged more than it's plugged in, that silently skips every
#    firing -- no error, no log line -- while `schtasks /query` still
#    happily reports the task as "Ready"/"Enabled". Confirmed live: this
#    machine was on battery when investigated, and the watchdog's own log
#    (web/.pm2/watchdog.log) had a 39+ hour gap with zero entries despite
#    being configured to run every 5 minutes forever.
#
# 2. A logon trigger is needed for instant recovery on a real reboot
#    (rather than waiting up to 5 minutes for the next timer tick), but an
#    UNSCOPED <LogonTrigger> (fires "at log on of any user") requires
#    elevated privileges to register -- confirmed by direct testing:
#    `schtasks /create` with an unscoped LogonTrigger returns "Access is
#    denied" for a standard (non-admin) user, while the identical XML with
#    the trigger scoped to this user's own SID succeeds. This script scopes
#    it accordingly so it installs without needing an elevated shell.

$ErrorActionPreference = "Stop"

$TaskName = "ADASOS-PM2-Watchdog"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunCmdLong = Join-Path $ScriptDir "run-watchdog.cmd"
if (-not (Test-Path $RunCmdLong)) {
    throw "Cannot find $RunCmdLong -- run this script from its own location or keep the repo layout intact."
}

# Task Scheduler's XML Command element has historically been the more
# reliable path here (see run-watchdog.cmd / RUN_GUIDE.md's PM2_HOME note
# on Windows path-quoting bugs with spaces) -- resolve to the 8.3 short
# path to match what was already proven working.
$fso = New-Object -ComObject Scripting.FileSystemObject
$RunCmd = $fso.GetFile($RunCmdLong).ShortPath

$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$author = "$env:COMPUTERNAME\$env:USERNAME"
$startBoundary = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss")

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>$author</Author>
    <URI>\$TaskName</URI>
  </RegistrationInfo>
  <Principals>
    <Principal id="Author">
      <UserId>$sid</UserId>
      <LogonType>InteractiveToken</LogonType>
    </Principal>
  </Principals>
  <Settings>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
  </Settings>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>$startBoundary</StartBoundary>
      <Repetition>
        <Interval>PT5M</Interval>
      </Repetition>
    </TimeTrigger>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$sid</UserId>
    </LogonTrigger>
  </Triggers>
  <Actions Context="Author">
    <Exec>
      <Command>$RunCmd</Command>
    </Exec>
  </Actions>
</Task>
"@

$xmlPath = Join-Path $env:TEMP "adasos-watchdog-task.xml"
[System.IO.File]::WriteAllText($xmlPath, $xml, [System.Text.Encoding]::Unicode)

try {
    $createOutput = schtasks /create /tn $TaskName /xml $xmlPath /f 2>&1
    $exitCode = $LASTEXITCODE
} finally {
    Remove-Item $xmlPath -Force -ErrorAction SilentlyContinue
}

if ($exitCode -ne 0) {
    Write-Error "Failed to install scheduled task: $createOutput"
    exit $exitCode
}

Write-Output $createOutput
Write-Output ""
Write-Output "'$TaskName' installed:"
Write-Output "  - Repeats every 5 minutes, indefinitely, on battery or AC power"
Write-Output "  - Also fires at logon (this user only) for near-instant recovery on reboot"
Write-Output ""
schtasks /query /tn $TaskName /v /fo list | Select-String "Task To Run|Status|Logon Mode|Scheduled Task State|Next Run Time"
