using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace UniversalMacroRecorder {
    public class InputControl {
        private const int MOUSEEVENTF_LEFTDOWN = 0x0002;
        private const int MOUSEEVENTF_LEFTUP = 0x0004;
        private const int MOUSEEVENTF_RIGHTDOWN = 0x0008;
        private const int MOUSEEVENTF_RIGHTUP = 0x0010;
        private const int MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        private const int MOUSEEVENTF_MIDDLEUP = 0x0040;
        private const int MOUSEEVENTF_WHEEL = 0x0800;
        private const int KEYEVENTF_KEYUP = 0x0002;
        private const int WH_KEYBOARD_LL = 13;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_SYSKEYDOWN = 0x0104;
        private const int VK_F9 = 0x78;

        private static volatile bool StopRequested;
        private static IntPtr KeyboardHook = IntPtr.Zero;
        private static LowLevelKeyboardProc KeyboardProcRef = KeyboardHookCallback;
        private static System.Threading.Thread HookThread;

        public static void MoveTo(int x, int y) {
            SetCursorPos(x, y);
        }

        public static void MouseDown(int button, int x, int y) {
            SetCursorPos(x, y);
            mouse_event(DownFlag(button), x, y, 0, 0);
        }

        public static void MouseUp(int button, int x, int y) {
            SetCursorPos(x, y);
            mouse_event(UpFlag(button), x, y, 0, 0);
        }

        public static void Wheel(int x, int y, int delta) {
            SetCursorPos(x, y);
            mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, 0);
        }

        public static void KeyDown(int virtualKey) {
            keybd_event((byte)virtualKey, 0, 0, 0);
        }

        public static void KeyUp(int virtualKey) {
            keybd_event((byte)virtualKey, 0, KEYEVENTF_KEYUP, 0);
        }

        public static void StartStopHotkey() {
            StopRequested = false;
            HookThread = new System.Threading.Thread(new System.Threading.ThreadStart(delegate {
                using (Process currentProcess = Process.GetCurrentProcess())
                using (ProcessModule currentModule = currentProcess.MainModule) {
                    KeyboardHook = SetWindowsHookEx(WH_KEYBOARD_LL, KeyboardProcRef, GetModuleHandle(currentModule.ModuleName), 0);
                }
                Application.Run();
                if (KeyboardHook != IntPtr.Zero) {
                    UnhookWindowsHookEx(KeyboardHook);
                    KeyboardHook = IntPtr.Zero;
                }
            }));
            HookThread.IsBackground = true;
            HookThread.SetApartmentState(System.Threading.ApartmentState.STA);
            HookThread.Start();
        }

        public static void StopStopHotkey() {
            try {
                if (HookThread != null) {
                    Application.ExitThread();
                }
            } catch {
            }
        }

        public static bool IsStopRequested() {
            return StopRequested;
        }

        private static IntPtr KeyboardHookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
            if (nCode >= 0) {
                int message = wParam.ToInt32();
                KBDLLHOOKSTRUCT info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                if ((message == WM_KEYDOWN || message == WM_SYSKEYDOWN) && info.vkCode == VK_F9) {
                    StopRequested = true;
                    return (IntPtr)1;
                }
            }
            return CallNextHookEx(KeyboardHook, nCode, wParam, lParam);
        }

        private static int DownFlag(int button) {
            if (button == 2) return MOUSEEVENTF_RIGHTDOWN;
            if (button == 3) return MOUSEEVENTF_MIDDLEDOWN;
            return MOUSEEVENTF_LEFTDOWN;
        }

        private static int UpFlag(int button) {
            if (button == 2) return MOUSEEVENTF_RIGHTUP;
            if (button == 3) return MOUSEEVENTF_MIDDLEUP;
            return MOUSEEVENTF_LEFTUP;
        }

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        private struct KBDLLHOOKSTRUCT {
            public int vkCode;
            public int scanCode;
            public int flags;
            public int time;
            public IntPtr dwExtraInfo;
        }

        [DllImport("user32.dll")]
        private static extern bool SetCursorPos(int x, int y);

        [DllImport("user32.dll")]
        private static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);

        [DllImport("user32.dll")]
        private static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll")]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);
    }
}
