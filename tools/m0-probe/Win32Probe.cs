// M0 probe: validates the Win32 assumptions in docs/02-windows-input-research.md
// before any Rust is written.
//
// Compiled by Add-Type in Windows PowerShell 5.1, which uses the CodeDom C# 5
// compiler: no string interpolation, no expression-bodied members, no `out var`,
// no null-conditional operators. Keep this file C# 5 clean.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace M0Probe
{
    // ---------------------------------------------------------------- native

    public static class Native
    {
        // -- DPI --------------------------------------------------------
        public static readonly IntPtr DPI_UNAWARE = new IntPtr(-1);
        public static readonly IntPtr DPI_SYSTEM_AWARE = new IntPtr(-2);
        public static readonly IntPtr DPI_PER_MONITOR = new IntPtr(-3);
        public static readonly IntPtr DPI_PER_MONITOR_V2 = new IntPtr(-4);
        public static readonly IntPtr DPI_UNAWARE_GDISCALED = new IntPtr(-5);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")]
        public static extern IntPtr GetThreadDpiAwarenessContext();
        [DllImport("user32.dll")]
        public static extern bool AreDpiAwarenessContextsEqual(IntPtr a, IntPtr b);

        // -- screen metrics ---------------------------------------------
        public const int SM_XVIRTUALSCREEN = 76;
        public const int SM_YVIRTUALSCREEN = 77;
        public const int SM_CXVIRTUALSCREEN = 78;
        public const int SM_CYVIRTUALSCREEN = 79;
        public const int SM_CMONITORS = 80;

        [DllImport("user32.dll")]
        public static extern int GetSystemMetrics(int nIndex);

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int left, top, right, bottom; }

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int x, y; }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct MONITORINFOEXW
        {
            public int cbSize;
            public RECT rcMonitor;
            public RECT rcWork;
            public uint dwFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
            public string szDevice;
        }

        public delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, IntPtr lprcClip, IntPtr dwData);

        [DllImport("user32.dll")]
        public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr lprcClip, MonitorEnumProc cb, IntPtr data);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern bool GetMonitorInfoW(IntPtr hMonitor, ref MONITORINFOEXW lpmi);
        [DllImport("Shcore.dll")]
        public static extern int GetDpiForMonitor(IntPtr hmonitor, int dpiType, out uint dpiX, out uint dpiY);

        [DllImport("user32.dll")]
        public static extern bool GetCursorPos(out POINT p);

        // -- input ------------------------------------------------------
        public const uint INPUT_MOUSE = 0;
        public const uint INPUT_KEYBOARD = 1;

        public const uint MOUSEEVENTF_MOVE = 0x0001;
        public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        public const uint MOUSEEVENTF_LEFTUP = 0x0004;
        public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        public const uint MOUSEEVENTF_WHEEL = 0x0800;
        public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
        public const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;

        public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        public const uint KEYEVENTF_KEYUP = 0x0002;
        public const uint KEYEVENTF_UNICODE = 0x0004;
        public const uint KEYEVENTF_SCANCODE = 0x0008;

        [StructLayout(LayoutKind.Sequential)]
        public struct MOUSEINPUT
        {
            public int dx, dy;
            public uint mouseData, dwFlags, time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct KEYBDINPUT
        {
            public ushort wVk, wScan;
            public uint dwFlags, time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL, wParamH; }

        [StructLayout(LayoutKind.Explicit)]
        public struct InputUnion
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
            [FieldOffset(0)] public HARDWAREINPUT hi;
        }

        // Sequential layout gives the correct 8-byte union offset on x64 and 4 on x86,
        // because InputUnion contains an IntPtr and therefore inherits pointer alignment.
        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT { public uint type; public InputUnion U; }

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")]
        public static extern uint MapVirtualKeyW(uint uCode, uint uMapType);
        public const uint MAPVK_VK_TO_VSC_EX = 4;

        [DllImport("user32.dll")]
        public static extern short GetAsyncKeyState(int vKey);

        public const int VK_LCONTROL = 0xA2;
        public const int VK_RCONTROL = 0xA3;
        public const int VK_LMENU = 0xA4;
        public const int VK_RMENU = 0xA5;

        // -- high resolution timer --------------------------------------
        public const uint CREATE_WAITABLE_TIMER_HIGH_RESOLUTION = 0x00000002;
        public const uint TIMER_ALL_ACCESS = 0x1F0003;
        public const uint WAIT_OBJECT_0 = 0;

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern IntPtr CreateWaitableTimerExW(IntPtr attrs, string name, uint flags, uint access);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool SetWaitableTimer(IntPtr hTimer, ref long due, int period,
                                                   IntPtr routine, IntPtr arg, bool resume);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern IntPtr CreateEventW(IntPtr attrs, bool manualReset, bool initial, string name);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool SetEvent(IntPtr h);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, bool waitAll, uint ms);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool CloseHandle(IntPtr h);

        // -- hook -------------------------------------------------------
        public const int WH_KEYBOARD_LL = 13;
        public const int HC_ACTION = 0;
        public const int WM_KEYDOWN = 0x0100;
        public const int WM_KEYUP = 0x0101;
        public const int WM_SYSKEYDOWN = 0x0104;
        public const int WM_SYSKEYUP = 0x0105;
        public const uint LLKHF_EXTENDED = 0x01;
        public const uint LLKHF_INJECTED = 0x10;
        public const uint LLKHF_LOWER_IL_INJECTED = 0x02;

        [StructLayout(LayoutKind.Sequential)]
        public struct KBDLLHOOKSTRUCT
        {
            public uint vkCode, scanCode, flags, time;
            public UIntPtr dwExtraInfo;
        }

        public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern IntPtr SetWindowsHookExW(int idHook, HookProc lpfn, IntPtr hMod, uint threadId);
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool UnhookWindowsHookEx(IntPtr hhk);
        [DllImport("user32.dll")]
        public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        public struct MSG
        {
            public IntPtr hwnd; public uint message; public IntPtr wParam, lParam;
            public uint time; public POINT pt;
        }

        [DllImport("user32.dll")]
        public static extern int GetMessageW(out MSG msg, IntPtr hwnd, uint min, uint max);
        [DllImport("user32.dll")]
        public static extern bool TranslateMessage(ref MSG msg);
        [DllImport("user32.dll")]
        public static extern IntPtr DispatchMessageW(ref MSG msg);
        [DllImport("user32.dll")]
        public static extern bool PostThreadMessageW(uint threadId, uint msg, IntPtr w, IntPtr l);
        [DllImport("kernel32.dll")]
        public static extern uint GetCurrentThreadId();
        public const uint WM_QUIT = 0x0012;
    }

    // ------------------------------------------------------------------- dpi

    public static class Dpi
    {
        public static string Describe(IntPtr ctx)
        {
            if (Native.AreDpiAwarenessContextsEqual(ctx, Native.DPI_PER_MONITOR_V2)) return "PER_MONITOR_AWARE_V2";
            if (Native.AreDpiAwarenessContextsEqual(ctx, Native.DPI_PER_MONITOR)) return "PER_MONITOR_AWARE";
            if (Native.AreDpiAwarenessContextsEqual(ctx, Native.DPI_SYSTEM_AWARE)) return "SYSTEM_AWARE";
            if (Native.AreDpiAwarenessContextsEqual(ctx, Native.DPI_UNAWARE_GDISCALED)) return "UNAWARE_GDISCALED";
            if (Native.AreDpiAwarenessContextsEqual(ctx, Native.DPI_UNAWARE)) return "UNAWARE";
            return "unknown(" + ctx.ToString() + ")";
        }

        public static string Current()
        {
            return Describe(Native.GetThreadDpiAwarenessContext());
        }

        /// Returns null on success, or an explanation string on failure.
        public static string EnsurePerMonitorV2()
        {
            if (Native.AreDpiAwarenessContextsEqual(Native.GetThreadDpiAwarenessContext(), Native.DPI_PER_MONITOR_V2))
                return null;
            if (Native.SetProcessDpiAwarenessContext(Native.DPI_PER_MONITOR_V2))
                return null;
            int err = Marshal.GetLastWin32Error();
            // 5 = ERROR_ACCESS_DENIED: already set, usually by the host's manifest.
            return "SetProcessDpiAwarenessContext failed, error " + err
                 + (err == 5 ? " (ERROR_ACCESS_DENIED - awareness already fixed by the host manifest)" : "");
        }
    }

    // --------------------------------------------------------------- screens

    public class MonitorDesc
    {
        public string Device;
        public Native.RECT Rect;
        public uint DpiX;
        public bool Primary;
        public int Width { get { return Rect.right - Rect.left; } }
        public int Height { get { return Rect.bottom - Rect.top; } }
        public double Scale { get { return DpiX / 96.0; } }
    }

    public static class Screens
    {
        public static void VirtualRect(out int vx, out int vy, out int vw, out int vh)
        {
            vx = Native.GetSystemMetrics(Native.SM_XVIRTUALSCREEN);
            vy = Native.GetSystemMetrics(Native.SM_YVIRTUALSCREEN);
            vw = Native.GetSystemMetrics(Native.SM_CXVIRTUALSCREEN);
            vh = Native.GetSystemMetrics(Native.SM_CYVIRTUALSCREEN);
        }

        public static List<MonitorDesc> All()
        {
            List<MonitorDesc> list = new List<MonitorDesc>();
            Native.MonitorEnumProc cb = delegate(IntPtr hMon, IntPtr hdc, IntPtr clip, IntPtr data)
            {
                Native.MONITORINFOEXW mi = new Native.MONITORINFOEXW();
                mi.cbSize = Marshal.SizeOf(typeof(Native.MONITORINFOEXW));
                if (Native.GetMonitorInfoW(hMon, ref mi))
                {
                    MonitorDesc d = new MonitorDesc();
                    d.Device = mi.szDevice;
                    d.Rect = mi.rcMonitor;
                    d.Primary = (mi.dwFlags & 1) != 0;
                    uint dx, dy;
                    d.DpiX = (Native.GetDpiForMonitor(hMon, 0, out dx, out dy) == 0) ? dx : 96;
                    list.Add(d);
                }
                return true;
            };
            Native.EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, cb, IntPtr.Zero);
            GC.KeepAlive(cb);
            return list;
        }
    }

    // ---------------------------------------------------------------- coords

    /// Two candidate pixel -> normalized formulas. Which one Windows actually
    /// inverts correctly is an empirical question, which is what `cursor` answers.
    public enum CoordFormula
    {
        /// 65535 spans (w - 1), rounded. The reading implied by the MSDN wording.
        SpanMinusOne = 0,
        /// 65536 spans w, truncated. What a lot of shipping code uses.
        SpanWholeWidth = 1,
        /// 65536 spans w, rounded UP. Derived from the measured behaviour of the
        /// inverse Windows actually applies: pixel = floor(n * w / 65536).
        SpanWholeWidthCeil = 2
    }

    public static class Coords
    {
        public static void ToNormalized(CoordFormula f, int x, int y,
                                        int vx, int vy, int vw, int vh,
                                        out int nx, out int ny)
        {
            if (f == CoordFormula.SpanMinusOne)
            {
                long dw = vw > 1 ? vw - 1 : 1;
                long dh = vh > 1 ? vh - 1 : 1;
                nx = (int)(((long)(x - vx) * 65535 + dw / 2) / dw);
                ny = (int)(((long)(y - vy) * 65535 + dh / 2) / dh);
            }
            else if (f == CoordFormula.SpanWholeWidth)
            {
                long dw = vw > 0 ? vw : 1;
                long dh = vh > 0 ? vh : 1;
                nx = (int)(((long)(x - vx) * 65536) / dw);
                ny = (int)(((long)(y - vy) * 65536) / dh);
            }
            else
            {
                // Smallest n such that floor(n * w / 65536) == target pixel.
                long dw = vw > 0 ? vw : 1;
                long dh = vh > 0 ? vh : 1;
                nx = (int)((((long)(x - vx) * 65536) + dw - 1) / dw);
                ny = (int)((((long)(y - vy) * 65536) + dh - 1) / dh);
                if (nx > 65535) nx = 65535;
                if (ny > 65535) ny = 65535;
            }
        }

        public static void FromNormalized(CoordFormula f, int nx, int ny,
                                          int vx, int vy, int vw, int vh,
                                          out int x, out int y)
        {
            if (f == CoordFormula.SpanMinusOne)
            {
                long dw = vw > 1 ? vw - 1 : 1;
                long dh = vh > 1 ? vh - 1 : 1;
                x = (int)(((long)nx * dw + 32767) / 65535) + vx;
                y = (int)(((long)ny * dh + 32767) / 65535) + vy;
            }
            else
            {
                // Both 65536-based formulas share the inverse Windows applies.
                x = (int)(((long)nx * (vw > 0 ? vw : 1)) / 65536) + vx;
                y = (int)(((long)ny * (vh > 0 ? vh : 1)) / 65536) + vy;
            }
        }
    }

    // -------------------------------------------------------------- injector

    public static class Injector
    {
        /// Stamped into dwExtraInfo on everything we inject, so our own hook can
        /// tell our events apart from the user's and from other tools'.
        ///
        /// MUST stay below int.MaxValue. A value with the high bit set (0xC0DEC11C,
        /// say) is a negative int, and IntPtr sign-extends it to 0xFFFFFFFFC0DEC11C
        /// on x64 - which never equals the zero-extended UIntPtr the hook reads back
        /// out of KBDLLHOOKSTRUCT, so the filter silently never matches.
        /// 0x434C4943 is 'CLIC'.
        public const uint STAMP_VALUE = 0x434C4943;
        public static readonly IntPtr STAMP = new IntPtr((int)STAMP_VALUE);
        public static readonly UIntPtr STAMP_U = new UIntPtr(STAMP_VALUE);

        // Measured 0 px error across a 3-monitor mixed-DPI virtual desktop with a
        // negative origin; see tools/m0-probe/README.md.
        public static CoordFormula Formula = CoordFormula.SpanWholeWidthCeil;

        static int Size { get { return Marshal.SizeOf(typeof(Native.INPUT)); } }

        static void Send(Native.INPUT[] inputs)
        {
            uint sent = Native.SendInput((uint)inputs.Length, inputs, Size);
            if (sent != inputs.Length)
            {
                int err = Marshal.GetLastWin32Error();
                throw new InvalidOperationException(
                    "SendInput inserted " + sent + " of " + inputs.Length + " events, error " + err +
                    (err == 5 ? " (ERROR_ACCESS_DENIED - UIPI blocked us; the foreground window is elevated)" : ""));
            }
        }

        public static Native.INPUT MoveAbs(int x, int y)
        {
            int vx, vy, vw, vh;
            Screens.VirtualRect(out vx, out vy, out vw, out vh);
            int nx, ny;
            Coords.ToNormalized(Formula, x, y, vx, vy, vw, vh, out nx, out ny);

            Native.INPUT i = new Native.INPUT();
            i.type = Native.INPUT_MOUSE;
            i.U.mi.dx = nx;
            i.U.mi.dy = ny;
            i.U.mi.dwFlags = Native.MOUSEEVENTF_MOVE | Native.MOUSEEVENTF_ABSOLUTE | Native.MOUSEEVENTF_VIRTUALDESK;
            i.U.mi.dwExtraInfo = STAMP;
            return i;
        }

        public static void MoveTo(int x, int y)
        {
            Send(new Native.INPUT[] { MoveAbs(x, y) });
        }

        public static void ClickAt(int x, int y, int holdMs)
        {
            Send(new Native.INPUT[] { MoveAbs(x, y) });
            Native.INPUT down = new Native.INPUT();
            down.type = Native.INPUT_MOUSE;
            down.U.mi.dwFlags = Native.MOUSEEVENTF_LEFTDOWN;
            down.U.mi.dwExtraInfo = STAMP;
            Send(new Native.INPUT[] { down });

            HiResTimer.Wait(holdMs, IntPtr.Zero);

            Native.INPUT up = new Native.INPUT();
            up.type = Native.INPUT_MOUSE;
            up.U.mi.dwFlags = Native.MOUSEEVENTF_LEFTUP;
            up.U.mi.dwExtraInfo = STAMP;
            Send(new Native.INPUT[] { up });
        }

        /// Scan code for a VK under the current layout, plus whether it is extended.
        public static void ScanFor(int vk, out ushort scan, out bool extended)
        {
            uint sc = Native.MapVirtualKeyW((uint)vk, Native.MAPVK_VK_TO_VSC_EX);
            extended = ((sc >> 8) & 0xFF) == 0xE0;
            scan = (ushort)(sc & 0xFF);
        }

        public static void KeyScan(ushort scan, bool extended, bool up)
        {
            KeyScanRaw(scan, extended, up, STAMP);
        }

        /// extra == IntPtr.Zero produces an event that is injected but NOT stamped,
        /// which is what an unrelated tool's input - or, for test purposes, a stand-in
        /// for a physical key press - looks like to our hook.
        public static void KeyScanRaw(ushort scan, bool extended, bool up, IntPtr extra)
        {
            Native.INPUT i = new Native.INPUT();
            i.type = Native.INPUT_KEYBOARD;
            i.U.ki.wVk = 0;
            i.U.ki.wScan = scan;
            i.U.ki.dwFlags = Native.KEYEVENTF_SCANCODE
                           | (extended ? Native.KEYEVENTF_EXTENDEDKEY : 0u)
                           | (up ? Native.KEYEVENTF_KEYUP : 0u);
            i.U.ki.dwExtraInfo = extra;
            Send(new Native.INPUT[] { i });
        }

        public static void PressVk(int vk, int holdMs)
        {
            PressVkWith(vk, holdMs, STAMP);
        }

        public static void PressVkUnstamped(int vk, int holdMs)
        {
            PressVkWith(vk, holdMs, IntPtr.Zero);
        }

        static void PressVkWith(int vk, int holdMs, IntPtr extra)
        {
            ushort scan; bool ext;
            ScanFor(vk, out scan, out ext);
            KeyScanRaw(scan, ext, false, extra);
            HiResTimer.Wait(holdMs, IntPtr.Zero);
            KeyScanRaw(scan, ext, true, extra);
        }

        public static void TypeUnicode(string text, int perCharMs)
        {
            for (int c = 0; c < text.Length; c++)
            {
                Native.INPUT down = new Native.INPUT();
                down.type = Native.INPUT_KEYBOARD;
                down.U.ki.wScan = text[c];
                down.U.ki.dwFlags = Native.KEYEVENTF_UNICODE;
                down.U.ki.dwExtraInfo = STAMP;

                Native.INPUT up = down;
                up.U.ki.dwFlags = Native.KEYEVENTF_UNICODE | Native.KEYEVENTF_KEYUP;

                Send(new Native.INPUT[] { down, up });
                if (perCharMs > 0) HiResTimer.Wait(perCharMs, IntPtr.Zero);
            }
        }
    }

    // ------------------------------------------------------------ hires wait

    public static class HiResTimer
    {
        public static bool HighResolutionAvailable = true;

        /// Waits ms, returning false if the cancel handle signalled first.
        /// cancel may be IntPtr.Zero.
        public static bool Wait(int ms, IntPtr cancel)
        {
            if (ms <= 0) return true;

            IntPtr timer = Native.CreateWaitableTimerExW(
                IntPtr.Zero, null, Native.CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, Native.TIMER_ALL_ACCESS);
            if (timer == IntPtr.Zero)
            {
                HighResolutionAvailable = false;
                timer = Native.CreateWaitableTimerExW(IntPtr.Zero, null, 0, Native.TIMER_ALL_ACCESS);
            }
            if (timer == IntPtr.Zero) { Thread.Sleep(ms); return true; }

            try
            {
                long due = -10000L * ms; // negative == relative, 100ns units
                if (!Native.SetWaitableTimer(timer, ref due, 0, IntPtr.Zero, IntPtr.Zero, false))
                {
                    Thread.Sleep(ms);
                    return true;
                }
                IntPtr[] handles = (cancel == IntPtr.Zero)
                    ? new IntPtr[] { timer }
                    : new IntPtr[] { timer, cancel };
                uint r = Native.WaitForMultipleObjects((uint)handles.Length, handles, false, 0xFFFFFFFF);
                return r == Native.WAIT_OBJECT_0;
            }
            finally { Native.CloseHandle(timer); }
        }

        public static double MeasureOnce(int ms, bool useThreadSleep)
        {
            Stopwatch sw = Stopwatch.StartNew();
            if (useThreadSleep) Thread.Sleep(ms); else Wait(ms, IntPtr.Zero);
            sw.Stop();
            return sw.Elapsed.TotalMilliseconds;
        }
    }

    // ------------------------------------------------------------------ hook

    public class HookEvent
    {
        public uint Vk, Scan, Flags;
        public bool Up;
        public bool Injected;
        public bool Ours;
        public double CallbackMicros;
    }

    /// A low-level keyboard hook on its own thread with a real message pump,
    /// matching the design in docs/01-architecture.md.
    public class HookThread
    {
        Thread _thread;
        uint _threadId;
        IntPtr _hook = IntPtr.Zero;
        Native.HookProc _proc;      // must outlive the hook; GC would otherwise collect it
        readonly object _gate = new object();

        public int TriggerVk = 0x78;        // F9
        public bool Swallow = false;
        public volatile int TriggerCount = 0;
        public double WorstCallbackMicros = 0;
        public readonly List<HookEvent> Log = new List<HookEvent>();
        public Action OnTrigger;
        /// If non-zero, the worker presses this VK on each trigger. Kept in C# because
        /// a PowerShell scriptblock cannot run on a plain .NET thread (no Runspace).
        public int MacroVk = 0;
        public string InstallError;
        public string CallbackError;
        public string WorkerError;
        public volatile int MacroRuns = 0;

        volatile bool _triggerHeld = false;

        // The callback must not execute macros itself: it enqueues, and this
        // worker drains. See docs/01-architecture.md.
        readonly Queue<int> _work = new Queue<int>();
        readonly AutoResetEvent _workReady = new AutoResetEvent(false);
        Thread _worker;
        volatile bool _running = true;

        void WorkerLoop()
        {
            while (_running)
            {
                _workReady.WaitOne(250);
                while (true)
                {
                    bool has;
                    lock (_work) { has = _work.Count > 0; if (has) _work.Dequeue(); }
                    if (!has) break;
                    try
                    {
                        if (MacroVk != 0) Injector.PressVk(MacroVk, 20);
                        Action h = OnTrigger;
                        if (h != null) h();
                        MacroRuns++;
                    }
                    catch (Exception ex)
                    {
                        if (WorkerError == null) WorkerError = ex.Message;
                    }
                }
            }
        }

        public bool Start()
        {
            _worker = new Thread(new ThreadStart(WorkerLoop));
            _worker.IsBackground = true;
            _worker.Start();

            _proc = new Native.HookProc(Callback);
            ManualResetEvent ready = new ManualResetEvent(false);
            _thread = new Thread(delegate()
            {
                _threadId = Native.GetCurrentThreadId();
                _hook = Native.SetWindowsHookExW(Native.WH_KEYBOARD_LL, _proc, IntPtr.Zero, 0);
                if (_hook == IntPtr.Zero)
                    InstallError = "SetWindowsHookExW failed, error " + Marshal.GetLastWin32Error();
                ready.Set();
                if (_hook == IntPtr.Zero) return;

                Native.MSG msg;
                while (Native.GetMessageW(out msg, IntPtr.Zero, 0, 0) > 0)
                {
                    Native.TranslateMessage(ref msg);
                    Native.DispatchMessageW(ref msg);
                }
                Native.UnhookWindowsHookEx(_hook);
                _hook = IntPtr.Zero;
            });
            _thread.IsBackground = true;
            _thread.SetApartmentState(ApartmentState.STA);
            _thread.Start();
            ready.WaitOne(3000);
            return _hook != IntPtr.Zero;
        }

        public void Stop()
        {
            if (_threadId != 0) Native.PostThreadMessageW(_threadId, Native.WM_QUIT, IntPtr.Zero, IntPtr.Zero);
            if (_thread != null) _thread.Join(2000);
            // let any queued macro finish before tearing the worker down
            Thread.Sleep(300);
            _running = false;
            _workReady.Set();
            if (_worker != null) _worker.Join(2000);
            GC.KeepAlive(_proc);
        }

        IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode != Native.HC_ACTION)
                return Native.CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);

            Stopwatch sw = Stopwatch.StartNew();
            bool swallow = false;
            try
            {
                Native.KBDLLHOOKSTRUCT k =
                    (Native.KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(Native.KBDLLHOOKSTRUCT));
                int m = wParam.ToInt32();
                bool up = (m == Native.WM_KEYUP || m == Native.WM_SYSKEYUP);
                bool ours = k.dwExtraInfo == Injector.STAMP_U;

                HookEvent ev = new HookEvent();
                ev.Vk = k.vkCode; ev.Scan = k.scanCode; ev.Flags = k.flags;
                ev.Up = up;
                ev.Injected = (k.flags & Native.LLKHF_INJECTED) != 0;
                ev.Ours = ours;

                // Log before doing anything else, so a later fault cannot erase the
                // record of the event.
                lock (_gate) { if (Log.Count < 4000) Log.Add(ev); }

                // Rule: never act on our own injected input, or a macro that presses
                // its own trigger key re-triggers itself forever.
                if (!ours && k.vkCode == (uint)TriggerVk)
                {
                    if (!up)
                    {
                        if (!_triggerHeld)      // debounce OS auto-repeat
                        {
                            _triggerHeld = true;
                            TriggerCount++;
                            lock (_work) { _work.Enqueue(1); }
                            _workReady.Set();
                        }
                    }
                    else _triggerHeld = false;
                    swallow = Swallow;
                }

                sw.Stop();
                ev.CallbackMicros = sw.Elapsed.TotalMilliseconds * 1000.0;
                lock (_gate)
                {
                    if (ev.CallbackMicros > WorstCallbackMicros) WorstCallbackMicros = ev.CallbackMicros;
                }
            }
            catch (Exception ex)
            {
                if (CallbackError == null) CallbackError = ex.Message;
            }

            if (swallow) return new IntPtr(1);
            return Native.CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
        }
    }

    // ----------------------------------------------------- echo target form

    /// A window that records exactly what input actually arrived, so injection
    /// can be verified automatically instead of by squinting at Notepad.
    public class EchoForm : Form
    {
        public readonly List<Point> Clicks = new List<Point>();
        public readonly List<int> KeyDowns = new List<int>();
        public TextBox Box;
        /// Closing a Form disposes its controls, so Box.Text reads empty afterwards.
        /// Snapshot it while the form is still alive.
        public string CapturedText = "";
        Panel _target;

        public EchoForm()
        {
            Text = "M0 probe target";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            KeyPreview = true;
            ClientSize = new Size(520, 300);

            _target = new Panel();
            _target.Dock = DockStyle.Top;
            _target.Height = 200;
            _target.BackColor = Color.FromArgb(24, 28, 36);
            _target.MouseDown += delegate(object s, MouseEventArgs e)
            {
                Point screen = _target.PointToScreen(e.Location);
                lock (Clicks) Clicks.Add(screen);
            };

            Box = new TextBox();
            Box.Dock = DockStyle.Fill;
            Box.Multiline = true;
            Box.Font = new Font("Consolas", 10f);

            Controls.Add(Box);
            Controls.Add(_target);

            KeyDown += delegate(object s, KeyEventArgs e)
            {
                lock (KeyDowns) KeyDowns.Add(e.KeyValue);
            };

            FormClosing += delegate(object s, FormClosingEventArgs e)
            {
                CapturedText = Box.Text;
            };
        }

        public Rectangle TargetScreenRect
        {
            get
            {
                Point tl = _target.PointToScreen(Point.Empty);
                return new Rectangle(tl.X, tl.Y, _target.Width, _target.Height);
            }
        }

        public Rectangle BoxScreenRect
        {
            get
            {
                Point tl = Box.PointToScreen(Point.Empty);
                return new Rectangle(tl.X, tl.Y, Box.Width, Box.Height);
            }
        }
    }
}
