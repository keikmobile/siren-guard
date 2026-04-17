const ext = typeof browser !== "undefined" ? browser : chrome;

const DAILY_TIME_LIMIT_SEC = 10 * 60; // 10分固定

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

function matchesDomain(hostname, ruleDomain) {
  return hostname === ruleDomain || hostname.endsWith("." + ruleDomain);
}

function findMatchingRule(rules, hostname) {
  return rules.find(rule => matchesDomain(hostname, rule.domain));
}

function isBlockedByTime(rule) {
  if (!rule.allowedTimeRange) return false;
  const { start, end } = rule.allowedTimeRange;
  const now = new Date();
  const current = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  if (start <= end) {
    // 通常範囲: start〜end の外はブロック
    return current < start || current >= end;
  } else {
    // 深夜またぎ: start〜翌end の外（ギャップ部分）はブロック
    return current >= end && current < start;
  }
}

async function addToTimeLog(domain, seconds) {
  if (seconds <= 0) return;
  const dateKey = getJSTDateKey();
  const data = await ext.storage.local.get("timeLog");
  const timeLog = data.timeLog || {};
  const todayLog = timeLog[dateKey] || {};
  todayLog[domain] = (todayLog[domain] || 0) + seconds;
  timeLog[dateKey] = todayLog;
  await ext.storage.local.set({ timeLog });
}

// セッション開始をストレージに永続化
async function startSession(tabId, domain) {
  const data = await ext.storage.local.get("sessionStartTimes");
  const sessions = data.sessionStartTimes || {};
  sessions[String(tabId)] = { domain, startTime: Date.now() };
  await ext.storage.local.set({ sessionStartTimes: sessions });
}

// セッションをフラッシュしてtimeLogに加算
async function flushSession(tabId) {
  const data = await ext.storage.local.get("sessionStartTimes");
  const sessions = data.sessionStartTimes || {};
  const key = String(tabId);
  const session = sessions[key];
  if (!session) return;
  // ブラウザ再起動時の古いセッションによる過大計上を防ぐため上限を設ける
  const elapsed = Math.min(
    Math.floor((Date.now() - session.startTime) / 1000),
    DAILY_TIME_LIMIT_SEC
  );
  delete sessions[key];
  await ext.storage.local.set({ sessionStartTimes: sessions });
  await addToTimeLog(session.domain, elapsed);
}

// アラームでの定期チェックポイント（SW kill対策）
async function checkpointSessions() {
  const data = await ext.storage.local.get("sessionStartTimes");
  const sessions = data.sessionStartTimes || {};
  if (Object.keys(sessions).length === 0) return;
  const now = Date.now();
  const newSessions = {};
  for (const [key, session] of Object.entries(sessions)) {
    const elapsed = Math.floor((now - session.startTime) / 1000);
    await addToTimeLog(session.domain, elapsed);
    newSessions[key] = { ...session, startTime: now };
  }
  await ext.storage.local.set({ sessionStartTimes: newSessions });
}

ext.alarms.create("sessionCheckpoint", { periodInMinutes: 1 });
ext.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "sessionCheckpoint") await checkpointSessions();
});

async function pruneOldData() {
  const data = await ext.storage.local.get(["accessLog", "timeLog", "blockedAt", "bypasses"]);
  const todayKey = getJSTDateKey();

  const prunedAccessLog = Object.fromEntries(
    Object.entries(data.accessLog || {}).filter(([k]) => k >= todayKey)
  );
  const prunedTimeLog = Object.fromEntries(
    Object.entries(data.timeLog || {}).filter(([k]) => k >= todayKey)
  );
  const prunedBlockedAt = Object.fromEntries(
    Object.entries(data.blockedAt || {}).filter(([, v]) => v.date === todayKey)
  );
  const prunedBypasses = Object.fromEntries(
    Object.entries(data.bypasses || {}).filter(([, v]) => v.date === todayKey)
  );

  await ext.storage.local.set({
    accessLog: prunedAccessLog,
    timeLog: prunedTimeLog,
    blockedAt: prunedBlockedAt,
    bypasses: prunedBypasses,
  });
}

// ナビゲーション検知（メインロジック）
ext.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;

  let url;
  try {
    url = new URL(details.url);
  } catch (_) {
    return;
  }

  if (!url.protocol.startsWith("http")) return;

  const hostname = url.hostname;
  const dateKey = getJSTDateKey();

  // ドメインが変わる可能性があるのでまず現セッションをフラッシュ
  await flushSession(details.tabId);

  const data = await ext.storage.local.get(["rules", "accessLog", "timeLog", "blockedAt", "bypasses"]);
  const rules = data.rules || [];
  const accessLog = data.accessLog || {};
  const timeLog = data.timeLog || {};
  const blockedAt = data.blockedAt || {};
  const bypasses = data.bypasses || {};

  const rule = findMatchingRule(rules, hostname);
  if (!rule) return;

  // 時間帯制限チェック
  if (isBlockedByTime(rule)) {
    if (bypasses[hostname] && bypasses[hostname].date === dateKey) {
      const newBypasses = { ...bypasses };
      delete newBypasses[hostname];
      await ext.storage.local.set({ bypasses: newBypasses });
      await startSession(details.tabId, hostname);
      return;
    }
    if (!blockedAt[hostname] || blockedAt[hostname].date !== dateKey) {
      await ext.storage.local.set({
        blockedAt: { ...blockedAt, [hostname]: { date: dateKey, time: new Date().toISOString() } },
      });
    }
    const { start, end } = rule.allowedTimeRange;
    const blockedUrl = ext.runtime.getURL(
      `blocked.html?site=${encodeURIComponent(hostname)}&reason=time&allowedStart=${encodeURIComponent(start)}&allowedEnd=${encodeURIComponent(end)}`
    );
    ext.tabs.update(details.tabId, { url: blockedUrl });
    return;
  }

  const todayAccessLog = accessLog[dateKey] || {};
  const count = todayAccessLog[hostname] || 0;
  const timeSpentSec = (timeLog[dateKey] || {})[hostname] || 0;

  const countExceeded = count >= rule.dailyLimit;
  const timeExceeded = timeSpentSec >= DAILY_TIME_LIMIT_SEC;

  if (countExceeded || timeExceeded) {
    // バイパスが有効なら通す（1回使い切り）
    if (bypasses[hostname] && bypasses[hostname].date === dateKey) {
      const newBypasses = { ...bypasses };
      delete newBypasses[hostname];
      const newTodayLog = { ...todayAccessLog, [hostname]: count + 1 };
      await ext.storage.local.set({
        bypasses: newBypasses,
        accessLog: { ...accessLog, [dateKey]: newTodayLog },
      });
      await startSession(details.tabId, hostname);
      return;
    }

    // blockedAt が未設定または今日以外なら記録
    if (!blockedAt[hostname] || blockedAt[hostname].date !== dateKey) {
      await ext.storage.local.set({
        blockedAt: { ...blockedAt, [hostname]: { date: dateKey, time: new Date().toISOString() } },
      });
    }

    const blockedUrl = ext.runtime.getURL(
      `blocked.html?site=${encodeURIComponent(hostname)}&limit=${rule.dailyLimit}&count=${count}&timeSec=${timeSpentSec}`
    );
    ext.tabs.update(details.tabId, { url: blockedUrl });
    return;
  }

  // アクセスカウントを増やして滞在時間の計測を開始
  const newTodayLog = { ...todayAccessLog, [hostname]: count + 1 };
  await ext.storage.local.set({ accessLog: { ...accessLog, [dateKey]: newTodayLog } });
  await startSession(details.tabId, hostname);
});

// タブ切り替え
ext.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const data = await ext.storage.local.get("activeTabPerWindow");
  const atpw = data.activeTabPerWindow || {};
  const prevTabId = atpw[windowId];

  if (prevTabId !== undefined && prevTabId !== tabId) {
    await flushSession(prevTabId);
  }

  atpw[windowId] = tabId;
  await ext.storage.local.set({ activeTabPerWindow: atpw });

  // 切り替え先タブが追跡対象ドメインなら計測再開
  try {
    const tab = await ext.tabs.get(tabId);
    if (!tab.url) return;
    const url = new URL(tab.url);
    if (!url.protocol.startsWith("http")) return;
    const ruleData = await ext.storage.local.get("rules");
    const rule = findMatchingRule(ruleData.rules || [], url.hostname);
    if (rule) await startSession(tabId, url.hostname);
  } catch (_) {}
});

// ウィンドウフォーカス変化
ext.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === ext.windows.WINDOW_ID_NONE) {
    // フォーカス喪失 → 全セッションをフラッシュ
    const data = await ext.storage.local.get("sessionStartTimes");
    const sessions = data.sessionStartTimes || {};
    for (const tabId of Object.keys(sessions)) {
      await flushSession(Number(tabId));
    }
  } else {
    // フォーカス取得 → アクティブタブの計測を再開
    try {
      const tabs = await ext.tabs.query({ active: true, windowId });
      if (tabs.length === 0) return;
      const tab = tabs[0];

      const atpwData = await ext.storage.local.get("activeTabPerWindow");
      const atpw = atpwData.activeTabPerWindow || {};
      atpw[windowId] = tab.id;
      await ext.storage.local.set({ activeTabPerWindow: atpw });

      if (!tab.url) return;
      const url = new URL(tab.url);
      if (!url.protocol.startsWith("http")) return;
      const ruleData = await ext.storage.local.get("rules");
      const rule = findMatchingRule(ruleData.rules || [], url.hostname);
      if (rule) await startSession(tab.id, url.hostname);
    } catch (_) {}
  }
});

// タブを閉じた
ext.tabs.onRemoved.addListener(async (tabId) => {
  await flushSession(tabId);
});

pruneOldData();
