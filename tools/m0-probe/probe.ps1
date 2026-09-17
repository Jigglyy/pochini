<#
.SYNOPSIS
  M0 probe - validates the Win32 assumptions in docs/02-windows-input-research.md.

.DESCRIPTION
  Read-only tests (no side effects):   info  coords  timer  safe
  Side-effecting tests (need -Yes):    cursor  keys  echo  hook

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File probe.ps1 safe
  powershell -ExecutionPolicy Bypass -File probe.ps1 cursor -Yes
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('safe', 'info', 'coords', 'timer', 'cursor', 'keys', 'echo', 'hook')]
    [string]$Test = 'safe',

    # Required for tests that move the real cursor or send real keystrokes.
    [switch]$Yes,

    # Seconds of grace before an invasive test starts.
    [int]$Countdown = 3,

    # hook: which VK to bind (0x78 = F9).
    [int]$TriggerVk = 0x78,

    # hook: swallow the trigger key instead of passing it through.
    [switch]$Swallow,

    # hook: how long to listen.
    [int]$Seconds = 20,

    # hook: make the macro press the TRIGGER key itself - the runaway-loop case.
    [switch]$SelfPress,

    # hook: inject N unstamped trigger presses instead of waiting for a human.
    [int]$Simulate = 0,

    # cursor: ms to let the input thread settle before reading the cursor back.
    [int]$Settle = 20
)

$ErrorActionPreference = 'Stop'
$script:Failures = 0

function Section($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }
function Pass($m)    { Write-Host "  [PASS] $m" -ForegroundColor Green }
function Fail($m)    { Write-Host "  [FAIL] $m" -ForegroundColor Red; $script:Failures++ }
function Warn($m)    { Write-Host "  [WARN] $m" -ForegroundColor Yellow }
function Info($m)    { Write-Host "         $m" -ForegroundColor DarkGray }

Add-Type -Path (Join-Path $PSScriptRoot 'Win32Probe.cs') `
         -ReferencedAssemblies 'System.Windows.Forms', 'System.Drawing'

# ---------------------------------------------------------------- DPI first
# Rule 1: this must happen before any window exists.
$dpiErr = [M0Probe.Dpi]::EnsurePerMonitorV2()

function Require-Consent($what) {
    if (-not $Yes) {
        Write-Host ''
        Write-Host "  This test $what." -ForegroundColor Yellow
        Write-Host "  Re-run with -Yes once you are ready. Nothing was sent." -ForegroundColor Yellow
        exit 2
    }
    if ($Countdown -gt 0) {
        Write-Host ''
        Write-Host "  Starting in..." -NoNewline -ForegroundColor Yellow
        for ($i = $Countdown; $i -gt 0; $i--) {
            Write-Host " $i" -NoNewline -ForegroundColor Yellow
            Start-Sleep -Milliseconds 1000
        }
        Write-Host ' go' -ForegroundColor Yellow
    }
}

function Get-VirtualRect {
    $vx = 0; $vy = 0; $vw = 0; $vh = 0
    [M0Probe.Screens]::VirtualRect([ref]$vx, [ref]$vy, [ref]$vw, [ref]$vh)
    [pscustomobject]@{ X = $vx; Y = $vy; W = $vw; H = $vh }
}

# ===================================================================== info
function Test-Info {
    Section 'Environment'

    Info ("PowerShell {0}, {1}-bit process" -f $PSVersionTable.PSVersion, ($(if ([IntPtr]::Size -eq 8) { 64 } else { 32 })))
    Info ("sizeof(INPUT) = {0} bytes (expect 40 on x64, 28 on x86)" -f [Runtime.InteropServices.Marshal]::SizeOf([type][M0Probe.Native+INPUT]))

    $ctx = [M0Probe.Dpi]::Current()
    if ($dpiErr) {
        Warn "DPI awareness is '$ctx'"
        Info $dpiErr
        Info 'Coordinates on a non-primary monitor with different scaling will be virtualized.'
        Info 'This is a limitation of the PowerShell host, not of the design - the real app'
        Info 'sets PerMonitorV2 in its manifest before main() runs.'
    } else {
        Pass "DPI awareness = $ctx"
    }

    $v = Get-VirtualRect
    Section 'Displays'
    Info ("virtual desktop: origin ({0}, {1})  size {2} x {3}" -f $v.X, $v.Y, $v.W, $v.H)
    if ($v.X -ne 0 -or $v.Y -ne 0) {
        Info 'origin is non-zero -> coordinate math MUST subtract it (negative coords are real here)'
    }

    $mons = [M0Probe.Screens]::All()
    foreach ($m in $mons) {
        $tag = if ($m.Primary) { ' (primary)' } else { '' }
        Info ("{0}{1}  rect [{2},{3} {4}x{5}]  {6} dpi  {7:P0} scale" -f `
              $m.Device, $tag, $m.Rect.left, $m.Rect.top, $m.Width, $m.Height, $m.DpiX, $m.Scale)
    }

    $scales = @{}
    foreach ($m in $mons) { $scales[$m.Scale] = $true }
    if ($scales.Count -gt 1) {
        Warn ("mixed DPI scaling across {0} monitors - this is the configuration that breaks naive implementations" -f $mons.Count)
    } elseif ($mons.Count -gt 1) {
        Info 'all monitors share one scale factor; the DPI virtualization bug will not reproduce here'
    }
}

# =================================================================== coords
function Test-Coords {
    Section 'Coordinate round-trip (pure math, no input sent)'

    # Synthetic layouts, including the nasty ones: negative origin, odd sizes.
    $layouts = @(
        @{ n = 'single 1920x1080';                 x = 0;     y = 0;    w = 1920; h = 1080 },
        @{ n = 'dual side-by-side 3840x1080';      x = 0;     y = 0;    w = 3840; h = 1080 },
        @{ n = 'secondary LEFT of primary';        x = -1920; y = 0;    w = 3840; h = 1080 },
        @{ n = 'secondary ABOVE, mixed heights';   x = -2560; y = -1440; w = 4480; h = 2520 },
        @{ n = 'odd size 2551x1439';               x = -7;    y = 3;    w = 2551; h = 1439 }
    )

    foreach ($f in @([M0Probe.CoordFormula]::SpanMinusOne, [M0Probe.CoordFormula]::SpanWholeWidth, [M0Probe.CoordFormula]::SpanWholeWidthCeil)) {
        $worst = 0
        $worstAt = ''
        foreach ($L in $layouts) {
            $pts = New-Object System.Collections.Generic.List[int[]]
            # corners and edges - where off-by-one lives
            # NOTE: in PowerShell the comma operator binds TIGHTER than + and -, so every
            # arithmetic element of an array literal must be parenthesized or it silently
            # flattens into extra elements.
            foreach ($px in @($L.x, ($L.x + 1), ($L.x + [int]($L.w / 2)), ($L.x + $L.w - 2), ($L.x + $L.w - 1))) {
                foreach ($py in @($L.y, ($L.y + [int]($L.h / 2)), ($L.y + $L.h - 1))) {
                    $pts.Add(@($px, $py))
                }
            }
            $rng = New-Object System.Random 12345
            for ($i = 0; $i -lt 400; $i++) {
                $pts.Add(@(($L.x + $rng.Next($L.w)), ($L.y + $rng.Next($L.h))))
            }

            foreach ($p in $pts) {
                $nx = 0; $ny = 0; $bx = 0; $by = 0
                [M0Probe.Coords]::ToNormalized($f, $p[0], $p[1], $L.x, $L.y, $L.w, $L.h, [ref]$nx, [ref]$ny)
                [M0Probe.Coords]::FromNormalized($f, $nx, $ny, $L.x, $L.y, $L.w, $L.h, [ref]$bx, [ref]$by)
                $err = [Math]::Max([Math]::Abs($bx - $p[0]), [Math]::Abs($by - $p[1]))
                if ($err -gt $worst) { $worst = $err; $worstAt = "$($L.n) at ($($p[0]),$($p[1]))" }
                if ($nx -lt 0 -or $nx -gt 65535 -or $ny -lt 0 -or $ny -gt 65535) {
                    Fail "$f produced out-of-range normalized value ($nx,$ny) for ($($p[0]),$($p[1])) in $($L.n)"
                    return
                }
            }
        }
        if ($worst -eq 0) { Pass "$f - self-inverse to the pixel across all synthetic layouts" }
        else              { Warn "$f - max self-inversion error ${worst}px, worst at $worstAt" }
    }

    Info 'Self-inversion only proves the math is consistent. Whether it matches what'
    Info "Windows does is what 'cursor' measures against the real cursor."
}

# ==================================================================== timer
function Test-Timer {
    Section 'Wait accuracy (no input sent)'

    foreach ($target in @(1, 5, 15, 50)) {
        $hi = New-Object System.Collections.Generic.List[double]
        $th = New-Object System.Collections.Generic.List[double]
        $n = if ($target -le 5) { 200 } else { 60 }
        for ($i = 0; $i -lt $n; $i++) { $hi.Add([M0Probe.HiResTimer]::MeasureOnce($target, $false)) }
        for ($i = 0; $i -lt $n; $i++) { $th.Add([M0Probe.HiResTimer]::MeasureOnce($target, $true)) }

        $hiS = ($hi | Sort-Object)
        $thS = ($th | Sort-Object)
        $hiMed = $hiS[[int]($n * 0.5)]
        $hiP99 = $hiS[[int]($n * 0.99)]
        $thMed = $thS[[int]($n * 0.5)]

        Info ("{0,3} ms requested | waitable timer p50 {1,6:N2} p99 {2,6:N2} | Thread.Sleep p50 {3,6:N2}" -f `
              $target, $hiMed, $hiP99, $thMed)

        $slack = [Math]::Max(2.0, $target * 0.25)
        if ($hiMed -le $target + $slack) { Pass "waitable timer within ${slack}ms of ${target}ms" }
        else { Fail "waitable timer overshot: ${hiMed}ms for a ${target}ms request" }
    }

    if (-not [M0Probe.HiResTimer]::HighResolutionAvailable) {
        Warn 'CREATE_WAITABLE_TIMER_HIGH_RESOLUTION unavailable; fell back to a coarse timer'
    } else {
        Pass 'CREATE_WAITABLE_TIMER_HIGH_RESOLUTION is available'
    }
}

# =================================================================== cursor
function Test-Cursor {
    Require-Consent 'moves your mouse cursor around every monitor (no clicks)'
    Section 'Cursor placement accuracy (real SendInput)'

    $v = Get-VirtualRect
    $mons = [M0Probe.Screens]::All()
    $start = New-Object M0Probe.Native+POINT
    [void][M0Probe.Native]::GetCursorPos([ref]$start)

    $results = @{}
    $script:Raced = 0
    foreach ($f in @([M0Probe.CoordFormula]::SpanMinusOne, [M0Probe.CoordFormula]::SpanWholeWidth, [M0Probe.CoordFormula]::SpanWholeWidthCeil)) {
        [M0Probe.Injector]::Formula = $f
        $worst = 0; $worstAt = ''; $sum = 0; $count = 0

        foreach ($m in $mons) {
            $pts = @(
                ,@($m.Rect.left,                          $m.Rect.top)
                ,@(($m.Rect.right - 1),                   $m.Rect.top)
                ,@($m.Rect.left,                          ($m.Rect.bottom - 1))
                ,@(($m.Rect.right - 1),                   ($m.Rect.bottom - 1))
                ,@(($m.Rect.left + [int]($m.Width / 2)),  ($m.Rect.top + [int]($m.Height / 2)))
            )
            $rng = New-Object System.Random 777
            for ($i = 0; $i -lt 25; $i++) {
                $pts += , @(($m.Rect.left + $rng.Next($m.Width)), ($m.Rect.top + $rng.Next($m.Height)))
            }

            foreach ($p in $pts) {
                [M0Probe.Injector]::MoveTo($p[0], $p[1])
                [void][M0Probe.HiResTimer]::Wait($Settle, [IntPtr]::Zero)
                $got = New-Object M0Probe.Native+POINT
                [void][M0Probe.Native]::GetCursorPos([ref]$got)
                # a second read catches the case where the first raced the input thread
                [void][M0Probe.HiResTimer]::Wait($Settle, [IntPtr]::Zero)
                $got2 = New-Object M0Probe.Native+POINT
                [void][M0Probe.Native]::GetCursorPos([ref]$got2)
                if ($got2.x -ne $got.x -or $got2.y -ne $got.y) { $script:Raced++; $got = $got2 }
                $err = [Math]::Max([Math]::Abs($got.x - $p[0]), [Math]::Abs($got.y - $p[1]))
                $sum += $err; $count++
                if ($err -gt $worst) { $worst = $err; $worstAt = "$($m.Device) asked ($($p[0]),$($p[1])) got ($($got.x),$($got.y))" }
            }
        }
        $results[$f.ToString()] = $worst
        $avg = if ($count) { $sum / $count } else { 0 }
        Info ("{0,-16} max error {1} px, mean {2:N2} px over {3} points" -f $f, $worst, $avg, $count)
        if ($worst -gt 0) { Info "                 worst: $worstAt" }
    }

    [M0Probe.Injector]::MoveTo($start.x, $start.y)
    if ($script:Raced -gt 0) { Info ("{0} reads raced the input thread and were re-read" -f $script:Raced) }

    $best = ''; $bestErr = [int]::MaxValue
    foreach ($k in $results.Keys) { if ($results[$k] -lt $bestErr) { $bestErr = $results[$k]; $best = $k } }

    if ($bestErr -eq 0) { Pass "$best lands exactly on target everywhere -> use this formula in the Rust port" }
    elseif ($bestErr -le 1) { Pass "$best is within 1 px everywhere (best available); worst case ${bestErr}px" }
    else { Fail "best formula ($best) is off by up to ${bestErr}px - investigate before writing the Rust layer" }
}

# ===================================================================== keys
function Test-Keys {
    Require-Consent 'presses and releases modifier keys (Right Ctrl)'
    Section 'Scan codes and the extended-key flag (real SendInput)'

    $VK_RCONTROL = [M0Probe.Native]::VK_RCONTROL
    $VK_LCONTROL = [M0Probe.Native]::VK_LCONTROL

    $scan = [uint16]0; $ext = $false
    [M0Probe.Injector]::ScanFor($VK_RCONTROL, [ref]$scan, [ref]$ext)
    Info ("VK_RCONTROL -> scan 0x{0:X2}, MapVirtualKey says extended = {1}" -f $scan, $ext)
    if ($ext) { Pass 'MAPVK_VK_TO_VSC_EX correctly reports Right Ctrl as an extended key' }
    else { Fail 'MAPVK_VK_TO_VSC_EX did not flag Right Ctrl as extended - a hardcoded table is required' }

    function Probe-Ctrl([bool]$withExtended) {
        [M0Probe.Injector]::KeyScan($scan, $withExtended, $false)
        [void][M0Probe.HiResTimer]::Wait(30, [IntPtr]::Zero)
        $r = ([M0Probe.Native]::GetAsyncKeyState($VK_RCONTROL) -band 0x8000) -ne 0
        $l = ([M0Probe.Native]::GetAsyncKeyState($VK_LCONTROL) -band 0x8000) -ne 0
        [M0Probe.Injector]::KeyScan($scan, $withExtended, $true)
        [void][M0Probe.HiResTimer]::Wait(30, [IntPtr]::Zero)
        [pscustomobject]@{ Right = $r; Left = $l }
    }

    $with = Probe-Ctrl $true
    if ($with.Right -and -not $with.Left) { Pass 'scan code + KEYEVENTF_EXTENDEDKEY registers as RIGHT Ctrl' }
    else { Fail ("with EXTENDEDKEY: right={0} left={1} (expected right only)" -f $with.Right, $with.Left) }

    $without = Probe-Ctrl $false
    if ($without.Left -and -not $without.Right) {
        Pass 'same scan code WITHOUT the flag registers as LEFT Ctrl - the flag is load-bearing, as documented'
    } else {
        Warn ("without EXTENDEDKEY: right={0} left={1}" -f $without.Right, $without.Left)
    }

    # Nothing may be left held.
    $stuck = @()
    foreach ($vk in @($VK_RCONTROL, $VK_LCONTROL, [M0Probe.Native]::VK_RMENU, [M0Probe.Native]::VK_LMENU)) {
        if (([M0Probe.Native]::GetAsyncKeyState($vk) -band 0x8000) -ne 0) { $stuck += ('0x{0:X2}' -f $vk) }
    }
    if ($stuck.Count -eq 0) { Pass 'no modifier left stuck down after the test' }
    else { Fail ("modifiers still held: {0} - this is the release-pass bug the docs warn about" -f ($stuck -join ', ')) }
}

# ===================================================================== echo
function Test-Echo {
    Require-Consent 'opens a window, then clicks in it and types into it'
    Section 'End-to-end click + keystroke delivery (real SendInput into a real window)'

    $form = New-Object M0Probe.EchoForm
    $v = Get-VirtualRect
    $form.Location = New-Object System.Drawing.Point(($v.X + 80), ($v.Y + 80))

    $expected = New-Object System.Collections.Generic.List[object]
    $typed = 'Probe 123 xyz'
    $script:echoDone = $false

    $worker = {
        param($form, $expected, $typed)
        Start-Sleep -Milliseconds 700
        $r = $form.TargetScreenRect
        $rng = New-Object System.Random 4242
        for ($i = 0; $i -lt 8; $i++) {
            $x = $r.X + 20 + $rng.Next($r.Width - 40)
            $y = $r.Y + 20 + $rng.Next($r.Height - 40)
            $expected.Add(@([int]$x, [int]$y))
            [M0Probe.Injector]::ClickAt($x, $y, 25)
            [void][M0Probe.HiResTimer]::Wait(60, [IntPtr]::Zero)
        }
        # Focus the textbox by clicking it, the way a real macro would. Calling
        # Focus() from another thread is not enough: if the form is not the
        # foreground window the keystrokes go to whatever is.
        $b = $form.BoxScreenRect
        [M0Probe.Injector]::ClickAt(($b.X + [int]($b.Width / 2)), ($b.Y + [int]($b.Height / 2)), 25)
        Start-Sleep -Milliseconds 250
        [M0Probe.Injector]::TypeUnicode($typed, 12)
        Start-Sleep -Milliseconds 300
        $form.BeginInvoke([Action] { $form.Close() }) | Out-Null
    }

    $ps = [PowerShell]::Create()
    $ps.Runspace = [RunspaceFactory]::CreateRunspace()
    $ps.Runspace.Open()
    $ps.Runspace.SessionStateProxy.SetVariable('PSScriptRoot2', $PSScriptRoot)
    [void]$ps.AddScript({
        param($root)
        Add-Type -Path (Join-Path $root 'Win32Probe.cs') -ReferencedAssemblies 'System.Windows.Forms','System.Drawing' -ErrorAction SilentlyContinue
    }).AddArgument($PSScriptRoot)
    [void]$ps.Invoke()
    $ps.Commands.Clear()
    [void]$ps.AddScript($worker).AddArgument($form).AddArgument($expected).AddArgument($typed)
    $handle = $ps.BeginInvoke()

    [System.Windows.Forms.Application]::Run($form)
    $ps.EndInvoke($handle) | Out-Null
    foreach ($e in $ps.Streams.Error) { Warn ("worker error: {0}" -f $e.Exception.Message) }
    $ps.Dispose()

    # --- verify clicks
    $got = @($form.Clicks)
    if ($got.Count -ne $expected.Count) {
        Fail ("sent {0} clicks, window received {1}" -f $expected.Count, $got.Count)
    } else {
        $worst = 0
        for ($i = 0; $i -lt $got.Count; $i++) {
            $e = $expected[$i]
            $d = [Math]::Max([Math]::Abs($got[$i].X - $e[0]), [Math]::Abs($got[$i].Y - $e[1]))
            if ($d -gt $worst) { $worst = $d }
        }
        if ($worst -eq 0) { Pass "all $($got.Count) clicks landed on the exact pixel requested" }
        elseif ($worst -le 1) { Pass "all $($got.Count) clicks landed within 1 px (worst ${worst}px)" }
        else { Fail "click position off by up to ${worst}px" }
    }

    # --- verify typing
    $text = $form.CapturedText
    Info ("{0} key-down events reached the window" -f $form.KeyDowns.Count)
    if ($text -eq $typed) { Pass "typed text arrived exactly: '$text'" }
    else { Fail "typed '$typed' but the window received '$text'" }

    $form.Dispose()
}

# ===================================================================== hook
function Test-Hook {
    Require-Consent 'installs a global keyboard hook and watches your keystrokes (nothing is logged to disk)'
    Section 'WH_KEYBOARD_LL: pass-through, self-injection filtering, callback latency'

    $h = New-Object M0Probe.HookThread
    $h.TriggerVk = $TriggerVk
    $h.Swallow = [bool]$Swallow

    # On trigger, run a tiny "macro" that types a key - which the hook will also
    # see. If the stamp filter works, that must NOT re-trigger.
    if ($SelfPress) { $h.MacroVk = $TriggerVk } else { $h.MacroVk = 0x41 }   # 'A'

    if (-not $h.Start()) {
        Fail ("hook did not install: {0}" -f $h.InstallError)
        return
    }
    Pass 'hook installed on a dedicated thread with a message pump'

    $keyName = ('0x{0:X2}' -f $TriggerVk)
    Info ("trigger = VK $keyName, swallow = {0}" -f $h.Swallow)
    Info "Press it a few times. Also type normally to confirm other keys pass through."
    if (-not $h.Swallow) { Info "With swallow off, the trigger key should STILL work in other apps." }
    if ($Simulate -gt 0) {
        Info "Injecting $Simulate unstamped trigger presses (no human needed)..."
        for ($i = 0; $i -lt $Simulate; $i++) {
            [M0Probe.Injector]::PressVkUnstamped($TriggerVk, 20)
            [void][M0Probe.HiResTimer]::Wait(400, [IntPtr]::Zero)
        }
        [void][M0Probe.HiResTimer]::Wait(800, [IntPtr]::Zero)
    } else {
        Info "Listening for $Seconds seconds..."
        $deadline = (Get-Date).AddSeconds($Seconds)
        while ((Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
    }

    $h.Stop()

    Section 'Hook results'
    $log = @($h.Log)
    $ours = @($log | Where-Object { $_.Ours })
    $injected = @($log | Where-Object { $_.Injected })
    if ($Simulate -gt 0) {
        $triggerEvents = @($log | Where-Object { $_.Vk -eq $TriggerVk -and -not $_.Up -and -not $_.Ours })
    } else {
        $triggerEvents = @($log | Where-Object { $_.Vk -eq $TriggerVk -and -not $_.Up -and -not $_.Injected })
    }

    Info ("{0} key events seen, {1} flagged injected, {2} carrying our stamp" -f $log.Count, $injected.Count, $ours.Count)
    Info ("trigger fired {0} times; {1} physical trigger key-downs observed; {2} macro runs completed" -f `
          $h.TriggerCount, $triggerEvents.Count, $h.MacroRuns)
    if ($h.CallbackError) { Fail ("callback threw: {0}" -f $h.CallbackError) }
    if ($h.WorkerError)   { Fail ("worker threw: {0}" -f $h.WorkerError) }

    if ($h.TriggerCount -eq 0) {
        Warn "the trigger never fired - was VK $keyName actually pressed?"
    } else {
        Pass "trigger fired $($h.TriggerCount) times"
        if ($ours.Count -gt 0) {
            Pass "the hook saw $($ours.Count) of our own injected events and matched them by stamp"
        } else {
            Warn 'no stamped events observed - could not verify self-injection filtering'
        }
        # In -Simulate mode half the injected events are unstamped on purpose, so the
        # invariant is "every event the MACRO produced is stamped", not "every injected
        # event is stamped".
        $expectedStamped = $h.MacroRuns * 2
        if ($ours.Count -ne $expectedStamped) {
            Fail ("macro produced {0} events but only {1} carried the stamp - the dwExtraInfo round-trip is broken" -f `
                  $expectedStamped, $ours.Count)
        } else {
            Pass "every one of the macro's $expectedStamped injected events round-tripped its dwExtraInfo stamp"
        }
        if ($Simulate -gt 0) {
            $unstamped = $injected.Count - $ours.Count
            Info ("{0} injected-but-unstamped events (the simulated external presses)" -f $unstamped)
        }
        if ($Simulate -gt 0 -and $h.TriggerCount -ne $Simulate) {
            Fail ("injected {0} unstamped presses but the hook fired {1} times" -f $Simulate, $h.TriggerCount)
        }
        if ($SelfPress) {
            if ($h.TriggerCount -eq $triggerEvents.Count) {
                Pass ("macro pressed the trigger key itself {0} times and did NOT re-trigger - no runaway loop" -f $h.MacroRuns)
            } else {
                Fail ("runaway: {0} triggers from only {1} physical key-downs" -f $h.TriggerCount, $triggerEvents.Count)
            }
        }
    }

    $worst = $h.WorstCallbackMicros
    Info ("worst callback latency: {0:N1} us (LowLevelHooksTimeout is 300,000 us)" -f $worst)
    if ($worst -lt 1000) { Pass 'callback stays far inside the hook timeout budget' }
    elseif ($worst -lt 50000) { Warn 'callback is slower than it should be, but within the timeout' }
    else { Fail 'callback latency is dangerously close to LowLevelHooksTimeout' }
}

# ==================================================================== driver
Write-Host ''
Write-Host "M0 probe - $Test" -ForegroundColor White

switch ($Test) {
    'safe'   { Test-Info; Test-Coords; Test-Timer }
    'info'   { Test-Info }
    'coords' { Test-Coords }
    'timer'  { Test-Timer }
    'cursor' { Test-Info; Test-Cursor }
    'keys'   { Test-Keys }
    'echo'   { Test-Echo }
    'hook'   { Test-Hook }
}

Write-Host ''
if ($script:Failures -eq 0) {
    Write-Host 'No failures.' -ForegroundColor Green
    exit 0
} else {
    Write-Host "$($script:Failures) failure(s)." -ForegroundColor Red
    exit 1
}
