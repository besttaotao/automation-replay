# UniversalMacroRecorder

通用键鼠录制回放工具。它是一个 Electron 桌面程序，界面负责录制、保存、加载和执行模板，底层通过 PowerShell 加载 C# `user32.dll` 实现全局键鼠录制与回放。

## 使用方式

开发模式：

```powershell
npm install
npm run start
```

打包：

```powershell
npm run dist
```

生成的 exe 位于 `dist` 目录。

## 快捷键

- `F8`：停止录制。
- `F9`：停止回放。

界面里的“停止录制”按钮也可用；程序会尽量裁掉这次按钮点击产生的末尾鼠标事件。为了模板最干净，仍建议使用 `F8`。

## 模板

模板保存到 `macros/*.json`。第一版使用屏幕绝对坐标，因此回放时需要保持窗口位置、屏幕缩放和分辨率一致。

不要录制密码、验证码、支付等敏感输入；模板是本地明文 JSON。
