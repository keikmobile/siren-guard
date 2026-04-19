const ext = typeof browser !== "undefined" ? browser : chrome;

function getJSTDateKey() {
  const now = new Date();
  const jstOffset = 9 * 60;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const jstMs = utcMs + jstOffset * 60 * 1000;
  const jst = new Date(jstMs);
  const y = jst.getFullYear();
  const m = String(jst.getMonth() + 1).padStart(2, "0");
  const d = String(jst.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// 今夜のJST 0時をUTCのISO文字列で返す
function getJSTMidnightISO() {
  const now = new Date();
  const jstOffsetMs = 9 * 60 * 60 * 1000;
  const jstNow = new Date(now.getTime() + now.getTimezoneOffset() * 60 * 1000 + jstOffsetMs);
  // JST翌0時
  jstNow.setHours(24, 0, 0, 0);
  // JSTをUTCに戻す
  return new Date(jstNow.getTime() - jstOffsetMs).toISOString();
}

function isLocked(rule) {
  if (!rule.lockUntil) return false;
  return new Date(rule.lockUntil) > new Date();
}

async function loadAndRender() {
  const data = await ext.storage.local.get(["rules", "accessLog", "timeLog"]);
  const rules = data.rules || [];
  const accessLog = data.accessLog || {};
  const timeLog = data.timeLog || {};
  const todayKey = getJSTDateKey();
  const todayLog = accessLog[todayKey] || {};
  const todayTimeLog = timeLog[todayKey] || {};

  const list = document.getElementById("rule-list");
  list.innerHTML = "";

  if (rules.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-message";
    li.textContent = "ルールがありません。";
    list.appendChild(li);
    return;
  }

  rules.forEach((rule, index) => {
    const count = todayLog[rule.domain] || 0;
    const timeSec = todayTimeLog[rule.domain] || 0;
    const timeMin = Math.floor(timeSec / 60);

    let timeBlocked = false;
    if (rule.allowedTimeRange) {
      const { start, end } = rule.allowedTimeRange;
      const now = new Date();
      const current = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      timeBlocked = start <= end
        ? (current < start || current >= end)
        : (current >= end && current < start);
    }

    const isOver = count >= rule.dailyLimit || timeSec >= 10 * 60 || timeBlocked;
    const locked = isLocked(rule);
    const canEdit = rule.lastEditedDate !== todayKey;

    const li = document.createElement("li");
    li.className = "rule-item";

    // --- メイン行 ---
    const mainRow = document.createElement("div");
    mainRow.className = "rule-main";

    const domainSpan = document.createElement("span");
    domainSpan.className = "rule-domain";
    domainSpan.textContent = rule.domain;
    domainSpan.title = rule.domain;

    const countSpan = document.createElement("span");
    countSpan.className = "rule-count" + (isOver ? " over-limit" : "");
    countSpan.textContent = `${count}/${rule.dailyLimit}回 · ${timeMin}分/10分`;

    mainRow.appendChild(domainSpan);
    mainRow.appendChild(countSpan);

    if (rule.allowedTimeRange) {
      const timeRangeSpan = document.createElement("span");
      timeRangeSpan.className = "rule-time-range" + (timeBlocked ? " time-blocked" : "");
      timeRangeSpan.textContent = `${rule.allowedTimeRange.start}〜${rule.allowedTimeRange.end}`;
      timeRangeSpan.title = "アクセス可能な時間帯";
      mainRow.appendChild(timeRangeSpan);
    }

    // 編集ボタン
    const editBtn = document.createElement("button");
    editBtn.className = "btn-edit";
    editBtn.textContent = "✎";
    editBtn.disabled = !canEdit;
    editBtn.title = canEdit ? "設定を変更" : "本日編集済み";
    mainRow.appendChild(editBtn);

    if (locked) {
      const lockSpan = document.createElement("span");
      lockSpan.className = "rule-lock";
      lockSpan.textContent = "🔒";
      lockSpan.title = "本日中は削除できません";
      mainRow.appendChild(lockSpan);
    }

    li.appendChild(mainRow);

    // --- 編集フォーム（折りたたみ） ---
    const editForm = document.createElement("div");
    editForm.className = "rule-edit-form";

    // 回数制限
    const limitRow = document.createElement("div");
    limitRow.className = "edit-row";
    const limitLabel = document.createElement("label");
    limitLabel.textContent = "上限回数:";
    const limitInput = document.createElement("input");
    limitInput.type = "number";
    limitInput.min = "1";
    limitInput.value = rule.dailyLimit;
    limitRow.appendChild(limitLabel);
    limitRow.appendChild(limitInput);
    editForm.appendChild(limitRow);

    // 時間帯制限
    const timeToggleRow = document.createElement("div");
    timeToggleRow.className = "edit-row";
    const timeCheckbox = document.createElement("input");
    timeCheckbox.type = "checkbox";
    timeCheckbox.checked = !!rule.allowedTimeRange;
    const timeToggleLabel = document.createElement("label");
    timeToggleLabel.textContent = "時間帯制限";
    timeToggleRow.appendChild(timeCheckbox);
    timeToggleRow.appendChild(timeToggleLabel);
    editForm.appendChild(timeToggleRow);

    const timeInputsRow = document.createElement("div");
    timeInputsRow.className = "edit-time-inputs";
    timeInputsRow.style.display = rule.allowedTimeRange ? "flex" : "none";
    const timeStartInput = document.createElement("input");
    timeStartInput.type = "time";
    timeStartInput.value = rule.allowedTimeRange ? rule.allowedTimeRange.start : "09:00";
    const timeSep = document.createElement("span");
    timeSep.textContent = "〜";
    const timeEndInput = document.createElement("input");
    timeEndInput.type = "time";
    timeEndInput.value = rule.allowedTimeRange ? rule.allowedTimeRange.end : "22:00";
    timeInputsRow.appendChild(timeStartInput);
    timeInputsRow.appendChild(timeSep);
    timeInputsRow.appendChild(timeEndInput);
    editForm.appendChild(timeInputsRow);

    timeCheckbox.addEventListener("change", () => {
      timeInputsRow.style.display = timeCheckbox.checked ? "flex" : "none";
    });

    // 保存・キャンセル・削除
    const actionsRow = document.createElement("div");
    actionsRow.className = "edit-actions";
    const saveBtn = document.createElement("button");
    saveBtn.className = "btn-edit-save";
    saveBtn.textContent = "保存";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn-edit-cancel";
    cancelBtn.textContent = "キャンセル";
    actionsRow.appendChild(saveBtn);
    actionsRow.appendChild(cancelBtn);

    if (!locked) {
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "btn-delete";
      deleteBtn.textContent = "削除";
      deleteBtn.addEventListener("click", async () => {
        const data = await ext.storage.local.get("rules");
        const currentRules = data.rules || [];
        currentRules.splice(index, 1);
        await ext.storage.local.set({ rules: currentRules });
        loadAndRender();
      });
      actionsRow.appendChild(deleteBtn);
    }

    editForm.appendChild(actionsRow);

    editBtn.addEventListener("click", () => {
      editForm.classList.toggle("open");
    });
    cancelBtn.addEventListener("click", () => {
      editForm.classList.remove("open");
    });
    saveBtn.addEventListener("click", async () => {
      const newLimit = parseInt(limitInput.value, 10);
      if (isNaN(newLimit) || newLimit < 1) return;
      let newTimeRange = null;
      if (timeCheckbox.checked) {
        const s = timeStartInput.value;
        const e = timeEndInput.value;
        if (s && e && s !== e) newTimeRange = { start: s, end: e };
      }
      const data = await ext.storage.local.get("rules");
      const currentRules = data.rules || [];
      currentRules[index] = {
        ...currentRules[index],
        dailyLimit: newLimit,
        allowedTimeRange: newTimeRange,
        lastEditedDate: todayKey,
      };
      await ext.storage.local.set({ rules: currentRules });
      loadAndRender();
    });

    li.appendChild(editForm);
    list.appendChild(li);
  });
}

document.getElementById("btn-add").addEventListener("click", async () => {
  const domainInput = document.getElementById("input-domain");
  const limitInput = document.getElementById("input-limit");
  const enableTimeRange = document.getElementById("enable-time-range");

  let domain = domainInput.value.trim().toLowerCase();
  const limit = parseInt(limitInput.value, 10);

  if (!domain || isNaN(limit) || limit < 1) return;

  try {
    if (domain.includes("://")) {
      domain = new URL(domain).hostname;
    } else {
      domain = domain.split("/")[0];
    }
  } catch (_) {
    return;
  }

  if (!domain) return;

  const data = await ext.storage.local.get("rules");
  const rules = data.rules || [];

  if (rules.some(r => r.domain === domain)) {
    domainInput.value = "";
    return;
  }

  let allowedTimeRange = null;
  if (enableTimeRange && enableTimeRange.checked) {
    const start = document.getElementById("input-time-start").value;
    const end = document.getElementById("input-time-end").value;
    if (start && end && start !== end) {
      allowedTimeRange = { start, end };
    }
  }

  rules.push({
    domain,
    dailyLimit: limit,
    cooldownMinutes: 10,
    lockUntil: getJSTMidnightISO(),
    allowedTimeRange,
  });
  await ext.storage.local.set({ rules });

  domainInput.value = "";
  limitInput.value = "3";
  if (enableTimeRange) {
    enableTimeRange.checked = false;
    document.getElementById("input-time-start").value = "09:00";
    document.getElementById("input-time-end").value = "22:00";
    document.getElementById("time-range-inputs").style.display = "none";
  }
  loadAndRender();
});

// 時間帯チェックボックス トグル
const enableTimeRangeEl = document.getElementById("enable-time-range");
if (enableTimeRangeEl) {
  enableTimeRangeEl.addEventListener("change", () => {
    document.getElementById("time-range-inputs").style.display =
      enableTimeRangeEl.checked ? "flex" : "none";
  });
}

// エクスポート
document.getElementById("btn-export").addEventListener("click", async () => {
  const data = await ext.storage.local.get(["rules", "intentLog", "whitelistConfig"]);
  const payload = {
    rules: data.rules || [],
    intentLog: data.intentLog || [],
    whitelistConfig: data.whitelistConfig || null,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}-${String(now.getHours()).padStart(2,"0")}${String(now.getMinutes()).padStart(2,"0")}`;
  a.download = `siren-guard-export-${ts}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// インポート
document.getElementById("btn-import").addEventListener("click", () => {
  document.getElementById("import-file").click();
});

document.getElementById("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = "";

  let imported;
  try {
    const text = await file.text();
    imported = JSON.parse(text);
  } catch (_) {
    document.getElementById("import-status").textContent = "読み込み失敗: JSONが不正です";
    return;
  }

  // 新形式 { rules, intentLog, whitelistConfig } と旧形式（配列）の両方に対応
  const importedRules = Array.isArray(imported) ? imported : (imported.rules || []);
  const importedIntentLog = Array.isArray(imported) ? [] : (imported.intentLog || []);
  const importedWhitelistConfig = Array.isArray(imported) ? null : (imported.whitelistConfig || null);

  if (!Array.isArray(importedRules)) {
    document.getElementById("import-status").textContent = "読み込み失敗: フォーマットが不正です";
    return;
  }

  const data = await ext.storage.local.get(["rules", "intentLog", "whitelistConfig"]);
  const existing = data.rules || [];
  const existingDomains = new Set(existing.map(r => r.domain));

  let addedRules = 0;
  for (const rule of importedRules) {
    if (typeof rule.domain !== "string" || typeof rule.dailyLimit !== "number") continue;
    if (existingDomains.has(rule.domain)) continue;
    existing.push({
      domain: rule.domain,
      dailyLimit: rule.dailyLimit,
      cooldownMinutes: 10,
      lockUntil: rule.lockUntil || null,
      allowedTimeRange: rule.allowedTimeRange || null,
      lastEditedDate: rule.lastEditedDate || null,
    });
    existingDomains.add(rule.domain);
    addedRules++;
  }

  // intentLog はタイムスタンプで重複排除してマージ
  const existingLog = data.intentLog || [];
  const existingTimestamps = new Set(existingLog.map(e => e.timestamp));
  const newEntries = importedIntentLog.filter(
    e => e.timestamp && e.domain && e.reason && !existingTimestamps.has(e.timestamp)
  );
  const mergedLog = [...existingLog, ...newEntries];
  if (mergedLog.length > 1000) mergedLog.splice(0, mergedLog.length - 1000);

  const saveData = { rules: existing, intentLog: mergedLog };
  let whitelistImported = false;
  if (importedWhitelistConfig && !data.whitelistConfig) {
    saveData.whitelistConfig = importedWhitelistConfig;
    whitelistImported = true;
  }
  await ext.storage.local.set(saveData);

  const parts = [];
  if (addedRules > 0) parts.push(`ルール ${addedRules}件`);
  if (newEntries.length > 0) parts.push(`衝動ログ ${newEntries.length}件`);
  if (whitelistImported) parts.push("ホワイトリスト設定");
  document.getElementById("import-status").textContent =
    parts.length > 0 ? `${parts.join("・")}を追加しました` : "追加できるデータがありませんでした（重複または無効）";
  if (whitelistImported) loadAndRenderWhitelist();
  loadAndRender();
});

// popup を開いたときアクティブタブのドメインをフォームに候補として入れる
if (location.pathname.endsWith("popup.html")) {
  ext.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs.length) return;
    try {
      const url = new URL(tabs[0].url);
      if (url.protocol.startsWith("http")) {
        document.getElementById("input-domain").value = url.hostname;
      }
    } catch (_) {}
  });
}

async function loadAndRenderWhitelist() {
  const data = await ext.storage.local.get("whitelistConfig");
  const config = data.whitelistConfig || { enabled: false, timeRange: { start: "09:00", end: "18:00" }, allowedDomains: [] };

  document.getElementById("enable-whitelist").checked = config.enabled;
  document.getElementById("whitelist-config").style.display = config.enabled ? "flex" : "none";
  document.getElementById("whitelist-time-start").value = config.timeRange.start;
  document.getElementById("whitelist-time-end").value = config.timeRange.end;

  const { start, end } = config.timeRange;
  const now = new Date();
  const current = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  const isActive = config.enabled && (start <= end
    ? (current >= start && current < end)
    : (current >= start || current < end));
  document.getElementById("whitelist-badge").style.display = isActive ? "inline" : "none";

  const listEl = document.getElementById("whitelist-domain-list");
  listEl.innerHTML = "";
  for (const domain of (config.allowedDomains || [])) {
    const li = document.createElement("li");
    li.className = "whitelist-domain-item";
    const span = document.createElement("span");
    span.textContent = domain;
    span.title = domain;
    const removeBtn = document.createElement("button");
    removeBtn.className = "whitelist-btn-remove";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", async () => {
      const d = await ext.storage.local.get("whitelistConfig");
      const c = d.whitelistConfig || config;
      c.allowedDomains = c.allowedDomains.filter(x => x !== domain);
      await ext.storage.local.set({ whitelistConfig: c });
      loadAndRenderWhitelist();
    });
    li.appendChild(span);
    li.appendChild(removeBtn);
    listEl.appendChild(li);
  }
}

document.getElementById("enable-whitelist").addEventListener("change", async (e) => {
  const data = await ext.storage.local.get("whitelistConfig");
  const config = data.whitelistConfig || { enabled: false, timeRange: { start: "09:00", end: "18:00" }, allowedDomains: [] };
  config.enabled = e.target.checked;
  await ext.storage.local.set({ whitelistConfig: config });
  loadAndRenderWhitelist();
});

document.getElementById("whitelist-time-start").addEventListener("change", async (e) => {
  const data = await ext.storage.local.get("whitelistConfig");
  const config = data.whitelistConfig || { enabled: true, timeRange: { start: "09:00", end: "18:00" }, allowedDomains: [] };
  config.timeRange.start = e.target.value;
  await ext.storage.local.set({ whitelistConfig: config });
  loadAndRenderWhitelist();
});

document.getElementById("whitelist-time-end").addEventListener("change", async (e) => {
  const data = await ext.storage.local.get("whitelistConfig");
  const config = data.whitelistConfig || { enabled: true, timeRange: { start: "09:00", end: "18:00" }, allowedDomains: [] };
  config.timeRange.end = e.target.value;
  await ext.storage.local.set({ whitelistConfig: config });
  loadAndRenderWhitelist();
});

document.getElementById("whitelist-btn-add").addEventListener("click", async () => {
  let domain = document.getElementById("whitelist-domain-input").value.trim().toLowerCase();
  if (!domain) return;
  try {
    domain = domain.includes("://") ? new URL(domain).hostname : domain.split("/")[0];
  } catch (_) { return; }
  if (!domain) return;
  const data = await ext.storage.local.get("whitelistConfig");
  const config = data.whitelistConfig || { enabled: true, timeRange: { start: "09:00", end: "18:00" }, allowedDomains: [] };
  if (!config.allowedDomains.includes(domain)) {
    config.allowedDomains.push(domain);
    await ext.storage.local.set({ whitelistConfig: config });
  }
  document.getElementById("whitelist-domain-input").value = "";
  loadAndRenderWhitelist();
});

loadAndRender();
loadAndRenderWhitelist();
