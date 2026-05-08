const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let recorderProcess = null;
let playbackProcess = null;
let currentMacro = null;
let currentMacroPath = null;
let stopRecordingFromButton = false;
let recordingCountdownCanceled = false;
let playbackCountdownCanceled = false;

const rootDir = app.isPackaged
  ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath))
  : path.join(__dirname, '..');
const engineDir = app.isPackaged
  ? path.join(process.resourcesPath, 'app', 'engine')
  : path.join(rootDir, 'engine');
const macroDir = path.join(rootDir, 'macros');
const tempDir = path.join(rootDir, 'temp');
const logDir = path.join(rootDir, 'logs');

function ensureDirs() {
  for (const dir of [macroDir, tempDir, logDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function safeName(name) {
  const cleaned = String(name || '').trim().replace(/[\\/:*?"<>|]/g, '_');
  return cleaned || `macro_${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function appendLog(message) {
  send('engine-log', String(message));
}

function minimizeMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function powershellArgs(scriptPath, args) {
  return [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    ...args
  ];
}

function spawnPowerShell(scriptName, args) {
  const scriptPath = path.join(engineDir, scriptName);
  return spawn('powershell.exe', powershellArgs(scriptPath, args), {
    cwd: rootDir,
    windowsHide: true
  });
}

function killIfStillRunning(processRef, getCurrentProcess, label) {
  setTimeout(() => {
    const current = getCurrentProcess();
    if (current === processRef && processRef && !processRef.killed) {
      appendLog(`${label}未及时退出，已强制结束子进程。`);
      processRef.kill();
    }
  }, 3000);
}

function readJson(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text);
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function macroStats(macro) {
  const actions = Array.isArray(macro && macro.actions) ? macro.actions : [];
  const durationMs = actions.reduce((sum, action) => sum + (Number(action.delayMs) || 0), 0);
  return { actionCount: actions.length, durationMs };
}

function describeAction(action, index) {
  const prefix = `#${String(index + 1).padStart(3, '0')} +${action.delayMs || 0}ms`;
  switch (action.type) {
    case 'mouseMove':
      return `${prefix} 鼠标移动 (${action.x}, ${action.y})`;
    case 'mouseDown':
      return `${prefix} 鼠标按下 button=${action.button} (${action.x}, ${action.y})`;
    case 'mouseUp':
      return `${prefix} 鼠标抬起 button=${action.button} (${action.x}, ${action.y})`;
    case 'mouseWheel':
      return `${prefix} 鼠标滚轮 delta=${action.delta} (${action.x}, ${action.y})`;
    case 'mouseClick':
      return `${prefix} 鼠标点击 button=${action.button} 坐标=(${action.x}, ${action.y})`;
    case 'keyDown':
      return `${prefix} 键盘按下 ${action.keyName || action.virtualKey}`;
    case 'keyUp':
      return `${prefix} 键盘抬起 ${action.keyName || action.virtualKey}`;
    default:
      return `${prefix} ${action.type}`;
  }
}

function logActionSummary(macro, title) {
  const actions = Array.isArray(macro && macro.actions) ? macro.actions : [];
  const stats = macroStats(macro);
  appendLog(`${title}: ${macro && macro.name ? macro.name : '-'}，动作数 ${stats.actionCount}，总时长 ${(stats.durationMs / 1000).toFixed(2)}s`);
  compactActions(actions).forEach((action, index) => {
    appendLog(describeAction(action, index));
  });
}

function compactActions(actions) {
  const result = [];
  for (let index = 0; index < actions.length; index++) {
    const action = actions[index];
    const next = actions[index + 1];
    if (action.type === 'mouseDown'
      && next
      && next.type === 'mouseUp'
      && action.button === next.button
      && action.x === next.x
      && action.y === next.y) {
      result.push({
        type: 'mouseClick',
        delayMs: action.delayMs,
        x: action.x,
        y: action.y,
        button: action.button
      });
      index++;
      continue;
    }
    result.push(action);
  }
  return result;
}

function isMouseAction(action) {
  return action && typeof action.type === 'string' && action.type.startsWith('mouse');
}

function isInsideWindow(action, bounds) {
  return Number.isFinite(action.x)
    && Number.isFinite(action.y)
    && action.x >= bounds.x
    && action.x <= bounds.x + bounds.width
    && action.y >= bounds.y
    && action.y <= bounds.y + bounds.height;
}

function trimStopButtonClick(macro) {
  if (!macro || !Array.isArray(macro.actions) || !mainWindow) {
    return macro;
  }

  const bounds = mainWindow.getBounds();
  while (macro.actions.length > 0) {
    const last = macro.actions[macro.actions.length - 1];
    if (!isMouseAction(last) || !isInsideWindow(last, bounds)) {
      break;
    }
    macro.actions.pop();
  }
  return macro;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 960,
    minHeight: 680,
    title: 'UniversalMacroRecorder',
    backgroundColor: '#f4f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  ensureDirs();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (recorderProcess) recorderProcess.kill();
  if (playbackProcess) playbackProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('list-macros', async () => {
  ensureDirs();
  return fs.readdirSync(macroDir)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .map((name) => {
      const filePath = path.join(macroDir, name);
      const stat = fs.statSync(filePath);
      try {
        const macro = readJson(filePath);
        const stats = macroStats(macro);
        return {
          name,
          path: filePath,
          modifiedAt: stat.mtime.toISOString(),
          macroName: macro.name || name.replace(/\.json$/i, ''),
          actionCount: stats.actionCount,
          durationMs: stats.durationMs
        };
      } catch (error) {
        return {
          name,
          path: filePath,
          modifiedAt: stat.mtime.toISOString(),
          macroName: name.replace(/\.json$/i, ''),
          actionCount: 0,
          durationMs: 0,
          error: error.message
        };
      }
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
});

ipcMain.handle('delete-macro', async (_event, filePath) => {
  const resolved = path.resolve(filePath);
  const macroRoot = path.resolve(macroDir);
  if (!resolved.toLowerCase().startsWith(macroRoot.toLowerCase())) {
    throw new Error('只能删除 macros 目录中的模板');
  }
  if (!resolved.toLowerCase().endsWith('.json')) {
    throw new Error('只能删除 JSON 模板');
  }
  if (currentMacroPath && path.resolve(currentMacroPath).toLowerCase() === resolved.toLowerCase()) {
    currentMacro = null;
    currentMacroPath = null;
  }
  fs.unlinkSync(resolved);
  appendLog(`模板已删除: ${resolved}`);
  return { ok: true };
});

ipcMain.handle('minimize-window', async () => {
  minimizeMainWindow();
  return { ok: true };
});

ipcMain.handle('focus-window', async () => {
  focusMainWindow();
  return { ok: true };
});

ipcMain.handle('start-recording', async (_event, payload) => {
  if (recorderProcess) {
    throw new Error('录制已经在运行中');
  }

  ensureDirs();
  const name = safeName(payload && payload.name);
  const outputPath = path.join(tempDir, 'current-recording.json');
  const stopFile = path.join(tempDir, 'stop-recording.flag');
  if (fs.existsSync(stopFile)) fs.unlinkSync(stopFile);
  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

  appendLog(`准备录制: ${name}`);
  stopRecordingFromButton = false;
  recordingCountdownCanceled = false;
  recorderProcess = spawnPowerShell('Start-Recorder.ps1', [
    '-OutputPath', outputPath,
    '-MacroName', name,
    '-CountdownSeconds', '3',
    '-StopFile', stopFile
  ]);

  recorderProcess.stdout.on('data', (data) => appendLog(data.toString('utf8').trim()));
  recorderProcess.stderr.on('data', (data) => appendLog(data.toString('utf8').trim()));
  recorderProcess.on('close', (code) => {
    recorderProcess = null;
    try {
      if (recordingCountdownCanceled) {
        recordingCountdownCanceled = false;
        focusMainWindow();
        send('recording-finished', {
          ok: false,
          canceled: true,
          error: '用户取消录制倒计时'
        });
        return;
      }
      if (code === 0 && fs.existsSync(outputPath)) {
        currentMacro = readJson(outputPath);
        if (stopRecordingFromButton) {
          currentMacro = trimStopButtonClick(currentMacro);
          writeJson(outputPath, currentMacro);
          appendLog('已裁剪停止录制按钮产生的末尾鼠标事件。');
        }
        logActionSummary(currentMacro, '录制动作摘要');
        currentMacroPath = outputPath;
        focusMainWindow();
        send('recording-finished', {
          ok: true,
          macro: currentMacro,
          path: currentMacroPath
        });
      } else {
        send('recording-finished', {
          ok: false,
          error: `录制进程退出，代码 ${code}`
        });
      }
    } catch (error) {
      send('recording-finished', { ok: false, error: error.message });
    }
  });

  return { ok: true };
});

ipcMain.handle('stop-recording', async () => {
  const stopFile = path.join(tempDir, 'stop-recording.flag');
  stopRecordingFromButton = true;
  fs.writeFileSync(stopFile, new Date().toISOString(), 'utf8');
  appendLog('已发送停止录制信号。推荐使用 F8 停止，避免把按钮点击录入模板。');
  focusMainWindow();
  return { ok: true };
});

ipcMain.handle('cancel-recording-countdown', async () => {
  const stopFile = path.join(tempDir, 'stop-recording.flag');
  recordingCountdownCanceled = true;
  stopRecordingFromButton = false;
  fs.writeFileSync(stopFile, new Date().toISOString(), 'utf8');
  appendLog('用户取消录制倒计时。');
  if (recorderProcess) {
    killIfStillRunning(recorderProcess, () => recorderProcess, '录制倒计时取消后进程');
  }
  return { ok: true };
});

ipcMain.handle('save-current-macro', async (_event, payload) => {
  if (!currentMacro) {
    throw new Error('当前没有可保存的录制内容');
  }
  const name = safeName(payload && payload.name || currentMacro.name);
  currentMacro.name = name;
  currentMacro.savedAt = new Date().toISOString();
  const filePath = path.join(macroDir, `${name}.json`);
  writeJson(filePath, currentMacro);
  currentMacroPath = filePath;
  appendLog(`模板已保存: ${filePath}`);
  logActionSummary(currentMacro, '已保存模板动作');
  return { ok: true, path: filePath, macro: currentMacro };
});

ipcMain.handle('load-macro', async (_event, filePath) => {
  const resolved = path.resolve(filePath);
  if (!resolved.toLowerCase().startsWith(path.resolve(macroDir).toLowerCase())) {
    throw new Error('只能加载 macros 目录中的模板');
  }
  currentMacro = readJson(resolved);
  currentMacroPath = resolved;
  appendLog(`模板已加载: ${resolved}`);
  logActionSummary(currentMacro, '已加载模板动作');
  return { ok: true, macro: currentMacro, path: currentMacroPath };
});

ipcMain.handle('choose-macro', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择宏模板',
    defaultPath: macroDir,
    filters: [{ name: 'Macro JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false };
  }
  const macro = readJson(result.filePaths[0]);
  currentMacro = macro;
  currentMacroPath = result.filePaths[0];
  return { ok: true, macro, path: currentMacroPath };
});

ipcMain.handle('start-playback', async (_event, payload) => {
  if (playbackProcess) {
    throw new Error('回放已经在运行中');
  }
  if (!currentMacro || !currentMacroPath) {
    throw new Error('请先录制或加载模板');
  }

  ensureDirs();
  const stopFile = path.join(tempDir, 'stop-playback.flag');
  if (fs.existsSync(stopFile)) fs.unlinkSync(stopFile);
  playbackCountdownCanceled = false;

  const args = [
    '-MacroPath', currentMacroPath,
    '-CountdownSeconds', '5',
    '-StopFile', stopFile,
    '-StepIntervalSeconds', String(Math.max(0, Number.parseFloat(payload && payload.stepIntervalSeconds) || 0))
  ];

  if (payload && payload.infinite) {
    args.push('-Infinite');
  } else {
    const loopCount = Math.max(1, Number.parseInt(payload && payload.loopCount, 10) || 1);
    args.push('-LoopCount', String(loopCount));
  }

  logActionSummary(currentMacro, '即将回放模板动作');
  appendLog('准备回放模板，请在倒计时结束前切换到目标窗口。');
  playbackProcess = spawnPowerShell('Start-Playback.ps1', args);
  playbackProcess.stdout.on('data', (data) => appendLog(data.toString('utf8').trim()));
  playbackProcess.stderr.on('data', (data) => appendLog(data.toString('utf8').trim()));
  playbackProcess.on('close', (code) => {
    playbackProcess = null;
    focusMainWindow();
    if (playbackCountdownCanceled) {
      playbackCountdownCanceled = false;
      send('playback-finished', { ok: false, code, canceled: true });
      return;
    }
    send('playback-finished', { ok: code === 0, code });
  });

  return { ok: true };
});

ipcMain.handle('stop-playback', async () => {
  const stopFile = path.join(tempDir, 'stop-playback.flag');
  fs.writeFileSync(stopFile, new Date().toISOString(), 'utf8');
  appendLog('已发送停止回放信号，也可以按 F9 紧急停止。');
  if (playbackProcess && !playbackProcess.killed) {
    playbackProcess.kill();
  }
  focusMainWindow();
  return { ok: true };
});

ipcMain.handle('cancel-playback-countdown', async () => {
  const stopFile = path.join(tempDir, 'stop-playback.flag');
  playbackCountdownCanceled = true;
  fs.writeFileSync(stopFile, new Date().toISOString(), 'utf8');
  appendLog('用户取消回放倒计时。');
  if (playbackProcess) {
    killIfStillRunning(playbackProcess, () => playbackProcess, '回放倒计时取消后进程');
  }
  return { ok: true };
});
