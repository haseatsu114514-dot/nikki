const DEFAULT_CONFIG = Object.freeze({
  syncEndpoint: "",
  syncSecret: "",
  spreadsheetUrl: "",
  syncIntervalMs: 60000
});

const CONFIG = Object.freeze({
  ...DEFAULT_CONFIG,
  ...(window.DAILY_REFLECTION_CONFIG || {})
});

const STORAGE_KEY = "daily-reflection-journal-pending-v1";

const state = {
  remoteEntries: [],
  pendingEntries: loadPendingEntries(),
  selectedDateKey: getTodayDateKey(),
  sync: {
    mode: CONFIG.syncEndpoint ? "loading" : "local",
    message: CONFIG.syncEndpoint ? "Google Sheets に接続しています..." : "ローカルモードで動作中です。"
  },
  isSyncing: false
};

const refs = {
  syncBadgeText: document.getElementById("syncBadgeText"),
  syncNowButton: document.getElementById("syncNowButton"),
  openSheetLink: document.getElementById("openSheetLink"),
  statsGrid: document.getElementById("statsGrid"),
  journalForm: document.getElementById("journalForm"),
  dateInput: document.getElementById("dateInput"),
  todayButton: document.getElementById("todayButton"),
  clearButton: document.getElementById("clearButton"),
  goalInput: document.getElementById("goalInput"),
  progressInput: document.getElementById("progressInput"),
  issuesInput: document.getElementById("issuesInput"),
  reflectionInput: document.getElementById("reflectionInput"),
  saveButton: document.getElementById("saveButton"),
  formStatus: document.getElementById("formStatus"),
  entryStateCard: document.getElementById("entryStateCard"),
  selectedEntryDetail: document.getElementById("selectedEntryDetail"),
  historyList: document.getElementById("historyList"),
  historyTableBody: document.getElementById("historyTableBody"),
  tableCountLabel: document.getElementById("tableCountLabel")
};

document.addEventListener("DOMContentLoaded", async () => {
  refs.dateInput.value = state.selectedDateKey;
  if (CONFIG.spreadsheetUrl) {
    refs.openSheetLink.hidden = false;
    refs.openSheetLink.href = CONFIG.spreadsheetUrl;
  }

  hydrateFormForSelectedDate();
  render();
  wireEvents();

  if (CONFIG.syncEndpoint) {
    await runSync(false);
    startAutoSync();
  } else {
    setFormStatus("Google Sheets の URL 未設定のため、今はローカル保存のみです。", "info");
  }
});

function wireEvents() {
  refs.dateInput.addEventListener("input", () => {
    const dateKey = refs.dateInput.value || getTodayDateKey();
    selectDate(dateKey);
  });

  refs.todayButton.addEventListener("click", () => {
    selectDate(getTodayDateKey());
  });

  refs.clearButton.addEventListener("click", () => {
    clearFormFields();
    setFormStatus("フォームの入力を空にしました。保存済みの内容は消えていません。", "info");
  });

  refs.journalForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveEntry();
  });

  refs.syncNowButton.addEventListener("click", async () => {
    await runSync(true);
  });

  refs.historyList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-date-key]");
    if (!button) return;
    selectDate(button.dataset.dateKey);
  });

  refs.historyTableBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-date-key]");
    if (!button) return;
    selectDate(button.dataset.dateKey);
  });
}

function startAutoSync() {
  window.setInterval(() => {
    runSync(false);
  }, CONFIG.syncIntervalMs);

  window.addEventListener("focus", () => {
    runSync(false);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      runSync(false);
    }
  });
}

function selectDate(dateKey) {
  if (!dateKey) return;
  state.selectedDateKey = dateKey;
  refs.dateInput.value = dateKey;
  hydrateFormForSelectedDate();
  render();
}

function hydrateFormForSelectedDate() {
  const entry = getEntryByDate(state.selectedDateKey);
  refs.goalInput.value = entry ? entry.goal : "";
  refs.progressInput.value = entry ? entry.progress : "";
  refs.issuesInput.value = entry ? entry.issues : "";
  refs.reflectionInput.value = entry ? entry.reflection : "";
}

function clearFormFields() {
  refs.goalInput.value = "";
  refs.progressInput.value = "";
  refs.issuesInput.value = "";
  refs.reflectionInput.value = "";
}

function render() {
  const entries = getMergedEntries();
  const stats = buildStats(entries);

  refs.syncBadgeText.textContent = getSyncLabel();
  renderStats(stats);
  renderEntryState();
  renderSelectedEntry();
  renderHistory(entries);
  renderTable(entries);
}

function renderStats(stats) {
  refs.statsGrid.innerHTML = [
    buildStatCard("累計記録日数", `${stats.totalDays}日`, "保存された日記の総数", "is-accent"),
    buildStatCard("今月の記録", `${stats.thisMonthDays}日`, "今月に書いた日数", "is-sea"),
    buildStatCard("未同期", `${stats.pendingDays}件`, "ネット不調時の一時保存", "is-warn"),
    buildStatCard("最終更新", stats.lastUpdatedLabel, "最後に保存した日時", "is-leaf")
  ].join("");
}

function buildStatCard(label, value, note, className) {
  return `
    <article class="stat-card ${className}">
      <span class="stat-label">${escapeHtml(label)}</span>
      <strong class="stat-value">${escapeHtml(value)}</strong>
      <span class="stat-note">${escapeHtml(note)}</span>
    </article>
  `;
}

function renderEntryState() {
  const entry = getEntryByDate(state.selectedDateKey);
  const isEmpty = !entry;

  refs.entryStateCard.classList.toggle("is-empty", isEmpty);
  refs.entryStateCard.innerHTML = entry
    ? `
      <strong class="entry-state-title">${escapeHtml(formatDateKey(state.selectedDateKey))} は保存済みです</strong>
      <p class="field-note">同じ日付で保存すると、その日の内容を上書き更新します。</p>
      <div class="entry-state-meta">
        ${buildStatusPill(entry)}
        <span class="field-note">更新: ${escapeHtml(formatDateTime(entry.updatedAt))}</span>
      </div>
    `
    : `
      <strong class="entry-state-title">${escapeHtml(formatDateKey(state.selectedDateKey))} はまだ未記入です</strong>
      <p class="field-note">4項目を埋めて保存すると、一覧とシートに反映されます。</p>
      <div class="entry-state-meta">
        <span class="status-pill is-local">新規作成</span>
      </div>
    `;
}

function renderSelectedEntry() {
  const entry = getEntryByDate(state.selectedDateKey);
  if (!entry) {
    refs.selectedEntryDetail.innerHTML = `
      <div class="detail-empty">
        <div>
          <strong class="detail-title">${escapeHtml(formatDateKey(state.selectedDateKey))}</strong>
          <p class="empty-text">まだ保存された内容はありません。</p>
          <p class="empty-text">例: 目標「30分だけでも着手する」 / 進捗「資料を2枚作成」 / 問題点「集中が切れた」 / 反省・改善点「午前中に最初の1本を書く」</p>
        </div>
      </div>
    `;
    return;
  }

  refs.selectedEntryDetail.innerHTML = `
    <div class="detail-summary">
      <div class="detail-head">
        <strong class="detail-title">${escapeHtml(formatDateKey(entry.dateKey))}</strong>
        <div class="detail-meta">
          ${buildStatusPill(entry)}
          <span class="field-note">作成: ${escapeHtml(formatDateTime(entry.createdAt))}</span>
          <span class="field-note">更新: ${escapeHtml(formatDateTime(entry.updatedAt))}</span>
        </div>
      </div>
      <div class="detail-grid">
        ${buildDetailBlock("目標", entry.goal)}
        ${buildDetailBlock("進捗", entry.progress)}
        ${buildDetailBlock("問題点", entry.issues)}
        ${buildDetailBlock("反省・改善点", entry.reflection)}
      </div>
    </div>
  `;
}

function buildDetailBlock(label, value) {
  return `
    <section class="detail-block">
      <span class="detail-label">${escapeHtml(label)}</span>
      <p>${escapeHtml(value || "")}</p>
    </section>
  `;
}

function renderHistory(entries) {
  if (!entries.length) {
    refs.historyList.innerHTML = `
      <div class="detail-empty">
        <div>
          <strong class="detail-title">まだ記録がありません</strong>
          <p class="empty-text">まずは今日の4項目を1行ずつ書いてみてください。</p>
        </div>
      </div>
    `;
    return;
  }

  refs.historyList.innerHTML = entries
    .slice(0, 8)
    .map((entry) => {
      return `
        <article class="history-item">
          <div class="history-item-top">
            <div>
              <strong class="history-item-date">${escapeHtml(formatDateKey(entry.dateKey))}</strong>
              <div class="history-item-meta">
                ${buildStatusPill(entry)}
                <span class="field-note">更新 ${escapeHtml(formatDateTime(entry.updatedAt))}</span>
              </div>
            </div>
            <button class="history-jump" type="button" data-date-key="${escapeHtml(entry.dateKey)}">この日を開く</button>
          </div>
          <div class="history-preview">
            ${buildHistoryPreviewRow("目標", entry.goal)}
            ${buildHistoryPreviewRow("進捗", entry.progress)}
            ${buildHistoryPreviewRow("問題点", entry.issues)}
            ${buildHistoryPreviewRow("反省・改善点", entry.reflection)}
          </div>
        </article>
      `;
    })
    .join("");
}

function buildHistoryPreviewRow(label, value) {
  return `
    <div class="history-preview-row">
      <span class="field-note">${escapeHtml(label)}</span>
      <span>${escapeHtml(truncateText(value, 88))}</span>
    </div>
  `;
}

function renderTable(entries) {
  refs.tableCountLabel.textContent = `${entries.length}件`;

  if (!entries.length) {
    refs.historyTableBody.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="table-empty">
            <div>
              <strong class="detail-title">一覧はまだ空です</strong>
              <p class="empty-text">保存するとここに過去の日記が並びます。</p>
            </div>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  refs.historyTableBody.innerHTML = entries
    .map((entry) => {
      return `
        <tr>
          <td>
            <button class="table-row-button" type="button" data-date-key="${escapeHtml(entry.dateKey)}">${escapeHtml(entry.dateKey)}</button>
          </td>
          <td><div class="table-snippet">${escapeHtml(truncateText(entry.goal, 50))}</div></td>
          <td><div class="table-snippet">${escapeHtml(truncateText(entry.progress, 50))}</div></td>
          <td><div class="table-snippet">${escapeHtml(truncateText(entry.issues, 50))}</div></td>
          <td><div class="table-snippet">${escapeHtml(truncateText(entry.reflection, 50))}</div></td>
          <td>${buildStatusPill(entry)}</td>
        </tr>
      `;
    })
    .join("");
}

async function saveEntry() {
  const existing = getEntryByDate(state.selectedDateKey);
  const nextEntry = buildEntryFromForm(existing);
  if (!nextEntry) return;

  refs.saveButton.disabled = true;

  try {
    if (CONFIG.syncEndpoint) {
      await postEntryToSheets(nextEntry);
      removePendingEntry(nextEntry.dateKey);
      setFormStatus("Google Sheets に保存しました。別の端末からも同じ内容を見られます。", "success");
    } else {
      upsertPendingEntry(nextEntry);
      setFormStatus("ローカル保存しました。同期 URL を入れるとシートにも送れます。", "info");
    }

    hydrateFormForSelectedDate();
    render();
  } catch (error) {
    upsertPendingEntry(nextEntry);
    setFormStatus("通信に失敗したため、この端末に一時保存しました。あとで同期ボタンで送れます。", "warn");
    render();
  } finally {
    refs.saveButton.disabled = false;
  }
}

function buildEntryFromForm(existingEntry) {
  const dateKey = String(refs.dateInput.value || "").trim();
  const goal = String(refs.goalInput.value || "").trim();
  const progress = String(refs.progressInput.value || "").trim();
  const issues = String(refs.issuesInput.value || "").trim();
  const reflection = String(refs.reflectionInput.value || "").trim();

  if (!dateKey) {
    setFormStatus("日付を選んでください。", "warn");
    return null;
  }
  if (!goal || !progress || !issues || !reflection) {
    setFormStatus("4項目すべてをひとことずつ入力してください。", "warn");
    return null;
  }

  const timestamp = new Date().toISOString();
  return normalizeEntry({
    id: existingEntry?.id || createEntryId(),
    dateKey,
    goal,
    progress,
    issues,
    reflection,
    createdAt: existingEntry?.createdAt || timestamp,
    updatedAt: timestamp
  });
}

async function runSync(forceMessage) {
  if (!CONFIG.syncEndpoint || state.isSyncing) {
    if (forceMessage && !CONFIG.syncEndpoint) {
      setFormStatus("Google Sheets の URL が未設定です。今はローカル保存のみです。", "info");
    }
    return;
  }

  state.isSyncing = true;
  state.sync = {
    mode: "loading",
    message: "Google Sheets と同期しています..."
  };
  refs.syncNowButton.disabled = true;
  render();

  let syncedPendingCount = 0;
  let failedPendingCount = 0;

  try {
    const url = new URL(CONFIG.syncEndpoint);
    url.searchParams.set("action", "entries");
    if (CONFIG.syncSecret) url.searchParams.set("secret", CONFIG.syncSecret);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "entries fetch failed");
    }

    state.remoteEntries = normalizeEntries(payload.entries);

    if (state.pendingEntries.length) {
      const pendingQueue = [...state.pendingEntries].sort((left, right) => {
        return String(left.updatedAt).localeCompare(String(right.updatedAt));
      });

      for (const pendingEntry of pendingQueue) {
        try {
          await postEntryToSheets(pendingEntry);
          removePendingEntry(pendingEntry.dateKey);
          syncedPendingCount += 1;
        } catch (error) {
          failedPendingCount += 1;
        }
      }
    }

    state.sync = {
      mode: "online",
      message: "Google Sheets と同期しています。"
    };

    if (forceMessage) {
      if (syncedPendingCount > 0 && failedPendingCount === 0) {
        setFormStatus(`シートを更新し、未同期 ${syncedPendingCount} 件も反映しました。`, "success");
      } else if (syncedPendingCount > 0 && failedPendingCount > 0) {
        setFormStatus(`一部は同期できましたが、まだ ${failedPendingCount} 件の未同期があります。`, "warn");
      } else if (failedPendingCount > 0) {
        setFormStatus(`シート読込はできましたが、未同期 ${failedPendingCount} 件はまだ残っています。`, "warn");
      } else {
        setFormStatus("Google Sheets の最新内容を反映しました。", "success");
      }
    }
  } catch (error) {
    state.sync = {
      mode: "error",
      message: "シート同期に失敗しました。"
    };
    if (forceMessage) {
      setFormStatus("Sheets 同期に失敗しました。いまある内容はローカルで保持しています。", "error");
    }
  } finally {
    state.isSyncing = false;
    refs.syncNowButton.disabled = false;
    render();
  }
}

async function postEntryToSheets(entry) {
  const body = new URLSearchParams({
    action: "upsertEntry",
    secret: CONFIG.syncSecret || "",
    payload: JSON.stringify(entry)
  });

  const response = await fetch(CONFIG.syncEndpoint, {
    method: "POST",
    headers: {
      Accept: "application/json"
    },
    body
  });

  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "save failed");
  }

  state.remoteEntries = normalizeEntries(payload.entries);
  state.sync = {
    mode: "online",
    message: "Google Sheets と同期しています。"
  };
}

function getMergedEntries() {
  const entriesByDate = new Map();

  state.remoteEntries.forEach((entry) => {
    entriesByDate.set(entry.dateKey, {
      ...entry,
      syncState: "synced"
    });
  });

  state.pendingEntries.forEach((entry) => {
    entriesByDate.set(entry.dateKey, {
      ...entry,
      syncState: "pending"
    });
  });

  return Array.from(entriesByDate.values()).sort(sortEntriesDesc);
}

function getEntryByDate(dateKey) {
  return getMergedEntries().find((entry) => entry.dateKey === dateKey) || null;
}

function buildStats(entries) {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const lastUpdated = entries.reduce((latest, entry) => {
    if (!entry.updatedAt) return latest;
    if (!latest) return entry.updatedAt;
    return String(entry.updatedAt).localeCompare(String(latest)) > 0 ? entry.updatedAt : latest;
  }, "");

  return {
    totalDays: entries.length,
    thisMonthDays: entries.filter((entry) => entry.dateKey.startsWith(monthKey)).length,
    pendingDays: CONFIG.syncEndpoint ? state.pendingEntries.length : 0,
    lastUpdatedLabel: lastUpdated ? formatDateTime(lastUpdated) : "まだなし"
  };
}

function getSyncLabel() {
  if (state.sync.mode === "online") return "Sheets 同期中";
  if (state.sync.mode === "loading") return "同期しています";
  if (state.sync.mode === "error") return "同期失敗";
  return "ローカルモード";
}

function loadPendingEntries() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return normalizeEntries(parsed);
  } catch (error) {
    return [];
  }
}

function persistPendingEntries() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.pendingEntries));
}

function upsertPendingEntry(entry) {
  const normalized = normalizeEntry(entry);
  const nextEntries = state.pendingEntries.filter((item) => item.dateKey !== normalized.dateKey);
  nextEntries.unshift(normalized);
  state.pendingEntries = nextEntries.sort(sortEntriesDesc);
  persistPendingEntries();
}

function removePendingEntry(dateKey) {
  const nextEntries = state.pendingEntries.filter((item) => item.dateKey !== dateKey);
  state.pendingEntries = nextEntries;
  persistPendingEntries();
}

function normalizeEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map(normalizeEntry)
    .filter(Boolean)
    .sort(sortEntriesDesc);
}

function normalizeEntry(entry) {
  if (!entry || !entry.dateKey) return null;

  return {
    id: String(entry.id || createEntryId()),
    dateKey: String(entry.dateKey || "").trim(),
    goal: String(entry.goal || "").trim(),
    progress: String(entry.progress || "").trim(),
    issues: String(entry.issues || "").trim(),
    reflection: String(entry.reflection || "").trim(),
    createdAt: String(entry.createdAt || new Date().toISOString()),
    updatedAt: String(entry.updatedAt || entry.createdAt || new Date().toISOString()),
    syncState: entry.syncState === "pending" ? "pending" : "synced"
  };
}

function sortEntriesDesc(left, right) {
  if (left.dateKey !== right.dateKey) {
    return left.dateKey < right.dateKey ? 1 : -1;
  }
  return String(right.updatedAt).localeCompare(String(left.updatedAt));
}

function setFormStatus(message, tone = "info") {
  refs.formStatus.textContent = message;
  refs.formStatus.dataset.tone = tone;
}

function buildStatusPill(entry) {
  if (!CONFIG.syncEndpoint) {
    return `<span class="status-pill is-local">ローカル保存</span>`;
  }
  if (entry.syncState === "pending") {
    return `<span class="status-pill is-pending">未同期</span>`;
  }
  return `<span class="status-pill is-synced">シート保存済み</span>`;
}

function formatDateKey(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  if (!year || !month || !day) return dateKey;
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function truncateText(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function getTodayDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createEntryId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `entry-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
