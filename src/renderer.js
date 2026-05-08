const state = {
  currentMacro: null,
  currentPath: null,
  recording: false,
  playing: false,
  countdown: null
};

const els = {
  statusText: document.getElementById('statusText'),
  recordBtn: document.getElementById('recordBtn'),
  stopRecordBtn: document.getElementById('stopRecordBtn'),
  infiniteLoop: document.getElementById('infiniteLoop'),
  loopCount: document.getElementById('loopCount'),
  stepIntervalSeconds: document.getElementById('stepIntervalSeconds'),
  playBtn: document.getElementById('playBtn'),
  stopPlayBtn: document.getElementById('stopPlayBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  macroList: document.getElementById('macroList'),
  templateHint: document.getElementById('templateHint'),
  readyHint: document.getElementById('readyHint'),
  statusBadge: document.getElementById('statusBadge'),
  saveModal: document.getElementById('saveModal'),
  saveNameInput: document.getElementById('saveNameInput'),
  confirmSaveBtn: document.getElementById('confirmSaveBtn'),
  closeSaveBtn: document.getElementById('closeSaveBtn'),
  discardSaveBtn: document.getElementById('discardSaveBtn'),
  countdownModal: document.getElementById('countdownModal'),
  countdownTitle: document.getElementById('countdownTitle'),
  countdownNumber: document.getElementById('countdownNumber'),
  countdownMessage: document.getElementById('countdownMessage'),
  cancelCountdownBtn: document.getElementById('cancelCountdownBtn'),
  closeCountdownBtn: document.getElementById('closeCountdownBtn'),
  currentName: document.getElementById('currentName'),
  actionCount: document.getElementById('actionCount'),
  duration: document.getElementById('duration'),
  coordinateMode: document.getElementById('coordinateMode'),
  log: document.getElementById('log'),
  clearLogBtn: document.getElementById('clearLogBtn')
};

function setStatus(text, badge = '就绪') {
  els.statusBadge.textContent = badge;
  els.statusText.textContent = text;
}

function appendLog(message) {
  if (!message) return;
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  els.log.textContent += `${line}\n`;
  els.log.scrollTop = els.log.scrollHeight;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return '0 ms';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatFileTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function updateButtons() {
  els.recordBtn.disabled = state.recording || state.playing;
  els.stopRecordBtn.disabled = !state.recording;
  els.playBtn.disabled = state.recording || state.playing || !state.currentMacro;
  els.stopPlayBtn.disabled = !state.playing;
  els.refreshBtn.disabled = state.recording || state.playing;
  els.loopCount.disabled = els.infiniteLoop.checked;
  els.stepIntervalSeconds.disabled = state.recording || state.playing;
  els.confirmSaveBtn.disabled = state.recording || state.playing;
  els.discardSaveBtn.disabled = state.recording || state.playing;
}

function setMacro(macro, filePath) {
  state.currentMacro = macro;
  state.currentPath = filePath || null;
  const actions = Array.isArray(macro && macro.actions) ? macro.actions : [];
  const duration = actions.reduce((sum, action) => sum + (Number(action.delayMs) || 0), 0);

  els.currentName.textContent = macro && macro.name ? macro.name : '-';
  els.actionCount.textContent = String(actions.length);
  els.duration.textContent = formatDuration(duration);
  els.coordinateMode.textContent = macro && macro.coordinateMode ? macro.coordinateMode : 'screenAbsolute';
  els.readyHint.textContent = actions.length > 0
    ? '模板已准备好。确认循环次数后，可以点击“启动执行”。'
    : '当前模板没有动作，请重新录制或加载其他模板。';
  updateButtons();
}

function showSaveModal(defaultName) {
  els.saveNameInput.value = defaultName || `macro_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  els.saveModal.classList.remove('hidden');
  els.saveNameInput.focus();
  els.saveNameInput.select();
}

function hideSaveModal() {
  els.saveModal.classList.add('hidden');
}

function discardUnsavedRecording() {
  hideSaveModal();
  state.currentMacro = null;
  state.currentPath = null;
  els.currentName.textContent = '-';
  els.actionCount.textContent = '0';
  els.duration.textContent = '0 ms';
  els.coordinateMode.textContent = 'screenAbsolute';
  els.readyHint.textContent = '本次录制未保存。可以重新录制，或从模板列表加载已有模板。';
  setStatus('本次录制已关闭，未保存文件。', '未保存');
  appendLog('用户关闭保存弹窗，本次录制未保存。');
  updateButtons();
}

function updateCountdownModal() {
  if (!state.countdown) return;
  els.countdownNumber.textContent = String(state.countdown.remaining);
  if (state.countdown.type === 'recording') {
    els.countdownTitle.textContent = '录制倒计时';
    els.countdownMessage.textContent = `录制将在 ${state.countdown.remaining} 秒后开始，请切换到目标窗口。`;
  } else {
    els.countdownTitle.textContent = '回放倒计时';
    els.countdownMessage.textContent = `回放将在 ${state.countdown.remaining} 秒后开始，请切换到目标窗口。`;
  }
}

function showCountdownModal(type, seconds) {
  closeCountdownModal(false);
  state.countdown = {
    type,
    remaining: seconds,
    timer: null
  };
  updateCountdownModal();
  els.countdownModal.classList.remove('hidden');
  state.countdown.timer = window.setInterval(() => {
    if (!state.countdown) return;
    state.countdown.remaining -= 1;
    if (state.countdown.remaining <= 0) {
      completeCountdown();
      return;
    }
    updateCountdownModal();
  }, 1000);
}

function completeCountdown() {
  if (!state.countdown) return;
  const countdown = state.countdown;
  closeCountdownModal(false);
  if (countdown.type === 'recording' || countdown.type === 'playback') {
    window.macroApi.minimizeWindow().catch((error) => {
      appendLog(error.message || String(error));
    });
  }
}

function closeCountdownModal(shouldCancel) {
  if (!state.countdown) return;
  const countdown = state.countdown;
  if (countdown.timer) {
    window.clearInterval(countdown.timer);
  }
  state.countdown = null;
  els.countdownModal.classList.add('hidden');
  if (shouldCancel) {
    cancelCountdown(countdown.type);
  }
}

async function cancelCountdown(type) {
  try {
    if (type === 'recording') {
      setStatus('正在取消录制倒计时。', '取消中');
      await window.macroApi.cancelRecordingCountdown();
    } else {
      setStatus('正在取消回放倒计时。', '取消中');
      await window.macroApi.cancelPlaybackCountdown();
    }
  } catch (error) {
    appendLog(error.message || String(error));
    setStatus('取消倒计时失败，请查看日志。', '异常');
  }
}

async function refreshMacros() {
  const macros = await window.macroApi.listMacros();
  els.macroList.innerHTML = '';
  if (macros.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'macroEmpty';
    empty.textContent = '暂无已保存模板';
    els.macroList.appendChild(empty);
    els.templateHint.textContent = '当前没有已保存模板。录制完成后点击“保存模板”，这里会出现模板文件。';
    updateButtons();
    return;
  }
  for (const macro of macros) {
    els.macroList.appendChild(createMacroItem(macro));
  }
  els.templateHint.textContent = '选择列表中的 JSON 模板后，会自动加载为当前执行模板。';
  updateButtons();
}

function createMacroItem(macro) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'macroItem';
  item.dataset.path = macro.path;
  if (state.currentPath === macro.path) {
    item.classList.add('selected');
  }

  const main = document.createElement('span');
  main.className = 'macroItemMain';

  const name = document.createElement('strong');
  name.textContent = macro.macroName || macro.name;

  const file = document.createElement('span');
  file.className = 'macroFile';
  file.textContent = macro.name;

  const meta = document.createElement('span');
  meta.className = 'macroMeta';
  meta.textContent = `动作 ${macro.actionCount || 0} · ${formatDuration(macro.durationMs || 0)} · ${formatFileTime(macro.modifiedAt)}`;

  main.appendChild(name);
  main.appendChild(file);
  main.appendChild(meta);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'deleteMacroBtn';
  deleteBtn.textContent = '删除';
  deleteBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    deleteMacro(macro);
  });

  item.appendChild(main);
  item.appendChild(deleteBtn);
  item.addEventListener('click', () => loadMacroPath(macro.path));
  return item;
}

function markSelectedMacro(filePath) {
  els.macroList.querySelectorAll('.macroItem').forEach((item) => {
    item.classList.toggle('selected', item.dataset.path === filePath);
  });
}

async function loadMacroPath(filePath) {
  if (!filePath) return;
  els.templateHint.textContent = '正在加载选中的模板...';
  const result = await window.macroApi.loadMacro(filePath);
  setMacro(result.macro, result.path);
  markSelectedMacro(result.path);
  els.templateHint.textContent = '已自动加载选中模板。右侧确认循环次数后可以启动执行。';
  setStatus('模板已加载。确认循环次数后可以启动执行。', '已加载');
}

async function deleteMacro(macro) {
  const ok = window.confirm(`确认删除模板？\n\n${macro.name}`);
  if (!ok) return;
  await window.macroApi.deleteMacro(macro.path);
  if (state.currentPath === macro.path) {
    state.currentMacro = null;
    state.currentPath = null;
    els.currentName.textContent = '-';
    els.actionCount.textContent = '0';
    els.duration.textContent = '0 ms';
    els.coordinateMode.textContent = 'screenAbsolute';
    els.readyHint.textContent = '当前模板已删除。请重新录制或从模板列表加载一个模板。';
    setStatus('当前模板已删除，请重新选择。', '已删除');
  }
  await refreshMacros();
}

async function runAction(action) {
  try {
    await action();
  } catch (error) {
    appendLog(error.message || String(error));
    setStatus('出现错误');
  } finally {
    updateButtons();
  }
}

els.recordBtn.addEventListener('click', () => runAction(async () => {
  state.recording = true;
  setStatus('录制倒计时中。请准备切换到目标窗口，完成操作后按 F8 停止。', '录制准备');
  updateButtons();
  await window.macroApi.startRecording({ name: 'unsaved_recording' });
  showCountdownModal('recording', 3);
}));

els.stopRecordBtn.addEventListener('click', () => runAction(async () => {
  if (state.countdown && state.countdown.type === 'recording') {
    closeCountdownModal(true);
    return;
  }
  setStatus('正在停止录制，稍等片刻生成模板。', '停止录制');
  await window.macroApi.stopRecording();
  await window.macroApi.focusWindow();
}));

els.confirmSaveBtn.addEventListener('click', () => runAction(async () => {
  const result = await window.macroApi.saveCurrentMacro({ name: els.saveNameInput.value });
  setMacro(result.macro, result.path);
  hideSaveModal();
  await refreshMacros();
  if (result.path) {
    markSelectedMacro(result.path);
  }
  setStatus('模板已保存并加载。确认循环次数后可以启动执行。', '已保存');
}));

els.saveNameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    els.confirmSaveBtn.click();
  }
});
els.closeSaveBtn.addEventListener('click', discardUnsavedRecording);
els.discardSaveBtn.addEventListener('click', discardUnsavedRecording);

els.refreshBtn.addEventListener('click', () => runAction(refreshMacros));

els.playBtn.addEventListener('click', () => runAction(async () => {
  state.playing = true;
  setStatus('回放倒计时中。请切换到目标窗口，执行中按 F9 可停止。', '执行准备');
  updateButtons();
  await window.macroApi.startPlayback({
    loopCount: els.loopCount.value,
    infinite: els.infiniteLoop.checked,
    stepIntervalSeconds: els.stepIntervalSeconds.value
  });
  showCountdownModal('playback', 5);
}));

els.stopPlayBtn.addEventListener('click', () => runAction(async () => {
  if (state.countdown && state.countdown.type === 'playback') {
    closeCountdownModal(true);
    return;
  }
  setStatus('正在发送停止执行信号。', '停止执行');
  await window.macroApi.stopPlayback();
  await window.macroApi.focusWindow();
  state.playing = false;
  updateButtons();
}));

els.infiniteLoop.addEventListener('change', updateButtons);
els.clearLogBtn.addEventListener('click', () => {
  els.log.textContent = '';
});
els.cancelCountdownBtn.addEventListener('click', () => closeCountdownModal(true));
els.closeCountdownBtn.addEventListener('click', () => closeCountdownModal(true));

window.macroApi.onLog((message) => appendLog(message));

window.macroApi.onRecordingFinished((payload) => {
  state.recording = false;
  closeCountdownModal(false);
  if (payload.canceled) {
    window.macroApi.focusWindow().catch((error) => appendLog(error.message || String(error)));
    setStatus('录制倒计时已取消。', '已取消');
    appendLog(payload.error || '用户取消录制倒计时');
    updateButtons();
    return;
  }
  if (payload.ok) {
    window.macroApi.focusWindow().catch((error) => appendLog(error.message || String(error)));
    setMacro(payload.macro, payload.path);
    showSaveModal(`macro_${new Date().toISOString().replace(/[:.]/g, '-')}`);
    setStatus('录制完成。请在弹窗中输入名称保存模板。', '等待保存');
  } else {
    setStatus('录制失败，请查看运行日志。', '失败');
    appendLog(payload.error);
  }
  updateButtons();
});

window.macroApi.onPlaybackFinished((payload) => {
  state.playing = false;
  closeCountdownModal(false);
  if (payload.canceled) {
    setStatus('回放倒计时已取消。', '已取消');
    appendLog('用户取消回放倒计时');
    window.macroApi.focusWindow().catch((error) => appendLog(error.message || String(error)));
    updateButtons();
    return;
  }
  setStatus(payload.ok ? '回放完成。可以调整次数后再次执行。' : `回放结束，退出代码 ${payload.code}`, payload.ok ? '完成' : '异常');
  window.macroApi.focusWindow().catch((error) => appendLog(error.message || String(error)));
  updateButtons();
});

refreshMacros().then(updateButtons).catch((error) => appendLog(error.message || String(error)));
