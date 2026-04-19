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

function getTimeUntilJSTMidnight() {
  const now = new Date();
  const jstOffsetMs = 9 * 60 * 60 * 1000;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const jstMs = utcMs + jstOffsetMs;
  const jstNow = new Date(jstMs);
  const nextMidnight = new Date(jstNow);
  nextMidnight.setHours(24, 0, 0, 0);
  const diffMs = nextMidnight - jstNow;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}時間 ${minutes}分`;
}

const DAILY_TIME_LIMIT_SEC = 10 * 60;

const params = new URLSearchParams(window.location.search);
const site = params.get("site") || "このサイト";
const reason = params.get("reason") || "";
const allowedStart = params.get("allowedStart") || "";
const allowedEnd = params.get("allowedEnd") || "";
const whitelistEnd = params.get("whitelistEnd") || "";
const limit = params.get("limit") || "?";
const count = params.get("count") || limit;
const timeSec = parseInt(params.get("timeSec") || "0", 10);

const countExceeded = parseInt(count) >= parseInt(limit);
const timeExceeded = timeSec >= DAILY_TIME_LIMIT_SEC;
const timeMin = Math.floor(timeSec / 60);
const timeSec2 = timeSec % 60;
const timeStr = timeSec2 > 0 ? `${timeMin}分${timeSec2}秒` : `${timeMin}分`;

document.getElementById("site-display").textContent = site;

const statsEl = document.getElementById("stats");

function makeStat(label, value, over) {
  const wrap = document.createElement("div");
  wrap.className = "stat";
  const l = document.createElement("div");
  l.className = "stat-label";
  l.textContent = label;
  const v = document.createElement("div");
  v.className = "stat-value" + (over ? " over" : "");
  v.textContent = value;
  wrap.appendChild(l);
  wrap.appendChild(v);
  return wrap;
}

if (reason === "whitelist") {
  const infoEl = document.createElement("div");
  infoEl.className = "time-block-info";
  const labelEl = document.createElement("div");
  labelEl.className = "time-block-label";
  labelEl.textContent = "ホワイトリストモード中のため、このサイトはアクセスできません";
  infoEl.appendChild(labelEl);
  if (whitelistEnd) {
    const rangeEl = document.createElement("div");
    rangeEl.className = "time-block-range";
    rangeEl.textContent = `ホワイトリストモード終了: ${whitelistEnd}`;
    infoEl.appendChild(rangeEl);
  }
  statsEl.appendChild(infoEl);
} else if (reason === "time") {
  const infoEl = document.createElement("div");
  infoEl.className = "time-block-info";
  const labelEl = document.createElement("div");
  labelEl.className = "time-block-label";
  labelEl.textContent = "この時間帯はアクセスできません";
  const rangeEl = document.createElement("div");
  rangeEl.className = "time-block-range";
  rangeEl.textContent = `アクセス可能: ${allowedStart} 〜 ${allowedEnd}`;
  infoEl.appendChild(labelEl);
  infoEl.appendChild(rangeEl);
  statsEl.appendChild(infoEl);
} else {
  statsEl.appendChild(makeStat("アクセス回数", `${count} / ${limit}回`, countExceeded));
  statsEl.appendChild(makeStat("滞在時間", `${timeStr} / 10分`, timeExceeded));
}

document.getElementById("reset-time").textContent =
  `リセットまで: ${getTimeUntilJSTMidnight()}`;

// クールダウン + 解除ボタン
let shortenCooldown = null; // 理由記録後に呼ぶと残り時間を30秒に短縮

async function initCooldown() {
  const data = await ext.storage.local.get(["rules", "blockedAt"]);
  const rules = data.rules || [];
  const blockedAt = data.blockedAt || {};

  const rule = rules.find(r => site === r.domain || site.endsWith("." + r.domain));
  const cooldownMinutes = (rule && rule.cooldownMinutes) ? rule.cooldownMinutes : 0;

  const blockedEntry = blockedAt[site];
  const dateKey = getJSTDateKey();

  const btnUnblock = document.getElementById("btn-unblock");
  const cooldownText = document.getElementById("cooldown-text");

  if (cooldownMinutes <= 0 || !blockedEntry || blockedEntry.date !== dateKey) {
    cooldownText.textContent = "解除の準備ができています。";
    btnUnblock.disabled = false;
    return;
  }

  const blockedTime = new Date(blockedEntry.time).getTime();
  let availableAt = blockedTime + cooldownMinutes * 60 * 1000;

  shortenCooldown = () => {
    const shortened = Date.now() + 30 * 1000;
    if (shortened < availableAt) availableAt = shortened;
  };

  function updateCooldown() {
    const remaining = availableAt - Date.now();
    if (remaining <= 0) {
      cooldownText.textContent = "解除の準備ができています。";
      btnUnblock.disabled = false;
      return;
    }
    const m = Math.floor(remaining / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    cooldownText.textContent = m > 0
      ? `解除したい場合: ${m}分${s}秒後に解除ボタンが有効になります`
      : `解除したい場合: ${s}秒後に解除ボタンが有効になります`;
  }

  updateCooldown();
  const timer = setInterval(() => {
    const remaining = availableAt - Date.now();
    if (remaining <= 0) clearInterval(timer);
    updateCooldown();
  }, 1000);
}

// 衝動ログの記録
document.getElementById("btn-record").addEventListener("click", async () => {
  const reason = document.getElementById("intent-input").value.trim();
  if (!reason) return;

  const data = await ext.storage.local.get("intentLog");
  const intentLog = data.intentLog || [];

  const now = new Date();
  const jstOffsetMs = 9 * 60 * 60 * 1000;
  const jstTimestamp = new Date(now.getTime() + now.getTimezoneOffset() * 60 * 1000 + jstOffsetMs).toISOString().replace("Z", "+09:00");

  intentLog.push({ timestamp: jstTimestamp, domain: site, reason });

  // 上限1000件
  if (intentLog.length > 1000) intentLog.splice(0, intentLog.length - 1000);

  await ext.storage.local.set({ intentLog });
  document.getElementById("recorded-msg").style.display = "block";
  document.getElementById("intent-input").value = "";

  // クールダウンを30秒に短縮
  if (shortenCooldown) shortenCooldown();
});

document.getElementById("btn-unblock").addEventListener("click", async () => {
  const dateKey = getJSTDateKey();
  const data = await ext.storage.local.get("bypasses");
  const bypasses = data.bypasses || {};
  bypasses[site] = { date: dateKey, grantedAt: new Date().toISOString() };
  await ext.storage.local.set({ bypasses });
  window.location.href = `https://${site}`;
});

initCooldown();
