using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace UniversalMacroRecorder {
    public class MacroAction {
        public string type { get; set; }
        public long delayMs { get; set; }
        public long timestampMs { get; set; }
        public int x { get; set; }
        public int y { get; set; }
        public int button { get; set; }
        public int delta { get; set; }
        public int virtualKey { get; set; }
        public string keyName { get; set; }
    }

    public class NativeRecorder {
        private const int WH_MOUSE_LL = 14;
        private const int WH_KEYBOARD_LL = 13;
        private const int WM_MOUSEMOVE = 0x0200;
        private const int WM_LBUTTONDOWN = 0x0201;
        private const int WM_LBUTTONUP = 0x0202;
        private const int WM_RBUTTONDOWN = 0x0204;
        private const int WM_RBUTTONUP = 0x0205;
        private const int WM_MBUTTONDOWN = 0x0207;
        private const int WM_MBUTTONUP = 0x0208;
        private const int WM_MOUSEWHEEL = 0x020A;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_KEYUP = 0x0101;
        private const int WM_SYSKEYDOWN = 0x0104;
        private const int WM_SYSKEYUP = 0x0105;
        private const int VK_F8 = 0x77;

        private static readonly object Sync = new object();
        private static readonly List<MacroAction> Actions = new List<MacroAction>();
        private static Stopwatch Watch = new Stopwatch();
        private static long LastActionMs;
        private static long LastMoveMs = -1000;
        private static int LastMoveX = Int32.MinValue;
        private static int LastMoveY = Int32.MinValue;
        private static string StopFilePath;
        private static IntPtr MouseHook = IntPtr.Zero;
        private static IntPtr KeyboardHook = IntPtr.Zero;
        private static LowLevelMouseProc MouseProcRef = MouseHookCallback;
        private static LowLevelKeyboardProc KeyboardProcRef = KeyboardHookCallback;
        private static Timer StopTimer;

        public static List<MacroAction> Record(string stopFilePath) {
            lock (Sync) {
                Actions.Clear();
            }

            StopFilePath = stopFilePath;
            Watch = Stopwatch.StartNew();
            LastActionMs = 0;
            LastMoveMs = -1000;
            LastMoveX = Int32.MinValue;
            LastMoveY = Int32.MinValue;

            MouseHook = SetHook(WH_MOUSE_LL, MouseProcRef);
            KeyboardHook = SetHook(WH_KEYBOARD_LL, KeyboardProcRef);

            StopTimer = new Timer();
            StopTimer.Interval = 200;
            StopTimer.Tick += delegate {
                if (!String.IsNullOrWhiteSpace(StopFilePath) && File.Exists(StopFilePath)) {
                    Stop();
                }
            };
            StopTimer.Start();

            Application.Run();
            Cleanup();

            lock (Sync) {
                return new List<MacroAction>(Actions);
            }
        }

        private static void Stop() {
            try {
                Application.ExitThread();
            } catch {
            }
        }

        private static void Cleanup() {
            if (StopTimer != null) {
                StopTimer.Stop();
                StopTimer.Dispose();
                StopTimer = null;
            }
            if (MouseHook != IntPtr.Zero) {
                UnhookWindowsHookEx(MouseHook);
                MouseHook = IntPtr.Zero;
            }
            if (KeyboardHook != IntPtr.Zero) {
                UnhookWindowsHookEx(KeyboardHook);
                KeyboardHook = IntPtr.Zero;
            }
        }

        private static IntPtr SetHook(int hookId, Delegate proc) {
            using (Process currentProcess = Process.GetCurrentProcess())
            using (ProcessModule currentModule = currentProcess.MainModule) {
                return SetWindowsHookEx(hookId, proc, GetModuleHandle(currentModule.ModuleName), 0);
            }
        }

        private static void AddAction(MacroAction action) {
            long now = Watch.ElapsedMilliseconds;
            action.timestampMs = now;
            action.delayMs = Math.Max(0, now - LastActionMs);
            LastActionMs = now;
            lock (Sync) {
                Actions.Add(action);
            }
            WriteLiveLog(action);
        }

        private static void WriteLiveLog(MacroAction action) {
            if (action == null || action.type == "mouseMove") {
                return;
            }

            string message;
            if (action.type == "mouseWheel") {
                message = String.Format("录制事件: 鼠标滚轮 delta={0} 坐标=({1}, {2})", action.delta, action.x, action.y);
            } else if (action.type == "mouseDown") {
                message = String.Format("录制事件: 鼠标按下 button={0} 坐标=({1}, {2})", action.button, action.x, action.y);
            } else if (action.type == "mouseUp") {
                message = String.Format("录制事件: 鼠标抬起 button={0} 坐标=({1}, {2})", action.button, action.x, action.y);
            } else if (action.type == "keyDown") {
                message = String.Format("录制事件: 键盘按下 {0}", action.keyName);
            } else if (action.type == "keyUp") {
                message = String.Format("录制事件: 键盘抬起 {0}", action.keyName);
            } else {
                message = String.Format("录制事件: {0}", action.type);
            }

            Console.WriteLine("[Recorder] " + message);
            Console.Out.Flush();
        }

        private static IntPtr MouseHookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
            if (nCode >= 0) {
                int message = wParam.ToInt32();
                MSLLHOOKSTRUCT info = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
                POINT cursor = GetCursorPoint(info.pt);
                if (message == WM_MOUSEMOVE) {
                    long now = Watch.ElapsedMilliseconds;
                    int distance = Math.Abs(cursor.x - LastMoveX) + Math.Abs(cursor.y - LastMoveY);
                    if (now - LastMoveMs >= 120 && distance >= 30) {
                        LastMoveMs = now;
                        LastMoveX = cursor.x;
                        LastMoveY = cursor.y;
                        AddAction(new MacroAction { type = "mouseMove", x = cursor.x, y = cursor.y });
                    }
                } else if (message == WM_MOUSEWHEEL) {
                    int delta = (short)((info.mouseData >> 16) & 0xffff);
                    AddAction(new MacroAction { type = "mouseWheel", x = cursor.x, y = cursor.y, delta = delta });
                } else if (message == WM_LBUTTONDOWN || message == WM_RBUTTONDOWN || message == WM_MBUTTONDOWN) {
                    AddAction(new MacroAction { type = "mouseDown", x = cursor.x, y = cursor.y, button = ButtonFromMessage(message) });
                } else if (message == WM_LBUTTONUP || message == WM_RBUTTONUP || message == WM_MBUTTONUP) {
                    AddAction(new MacroAction { type = "mouseUp", x = cursor.x, y = cursor.y, button = ButtonFromMessage(message) });
                }
            }
            return CallNextHookEx(MouseHook, nCode, wParam, lParam);
        }

        private static POINT GetCursorPoint(POINT fallback) {
            POINT point;
            if (GetCursorPos(out point)) {
                return point;
            }
            return fallback;
        }

        private static IntPtr KeyboardHookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
            if (nCode >= 0) {
                int message = wParam.ToInt32();
                KBDLLHOOKSTRUCT info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                if ((message == WM_KEYDOWN || message == WM_SYSKEYDOWN) && info.vkCode == VK_F8) {
                    Stop();
                    return (IntPtr)1;
                }

                if (message == WM_KEYDOWN || message == WM_SYSKEYDOWN || message == WM_KEYUP || message == WM_SYSKEYUP) {
                    bool down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
                    AddAction(new MacroAction {
                        type = down ? "keyDown" : "keyUp",
                        virtualKey = info.vkCode,
                        keyName = ((Keys)info.vkCode).ToString()
                    });
                }
            }
            return CallNextHookEx(KeyboardHook, nCode, wParam, lParam);
        }

        private static int ButtonFromMessage(int message) {
            if (message == WM_RBUTTONDOWN || message == WM_RBUTTONUP) return 2;
            if (message == WM_MBUTTONDOWN || message == WM_MBUTTONUP) return 3;
            return 1;
        }

        private delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);
        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT {
            public int x;
            public int y;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MSLLHOOKSTRUCT {
            public POINT pt;
            public int mouseData;
            public int flags;
            public int time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct KBDLLHOOKSTRUCT {
            public int vkCode;
            public int scanCode;
            public int flags;
            public int time;
            public IntPtr dwExtraInfo;
        }

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, Delegate lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll")]
        private static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll")]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);
    }
}
