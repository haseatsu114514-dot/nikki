const PROP = PropertiesService.getScriptProperties();

const CONFIG = Object.freeze({
  DEFAULT_SHEET_NAME: "4項目日記",
  HEADER: ["日付", "目標", "進捗", "問題点", "反省・改善点", "作成日時", "更新日時", "ID"]
});

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    if (!isAuthorized_(params.secret)) {
      return json_({ ok: false, error: "unauthorized" });
    }

    const action = params.action || "entries";
    if (action === "entries") {
      return json_(buildPayload_());
    }
    if (action === "setup") {
      setupSheet();
      return json_({ ok: true, message: "setup completed", sheetName: getSheet_().getName() });
    }

    return json_({ ok: false, error: "unknown_action" });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    if (!isAuthorized_(body.secret)) {
      return json_({ ok: false, error: "unauthorized" });
    }

    if (body.action === "upsertEntry") {
      const entry = normalizeEntry_(body.entry || {});
      upsertEntry_(entry);
      return json_(buildPayload_());
    }

    return json_({ ok: false, error: "unknown_action" });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function setupSheet() {
  const sheet = getSheet_();
  ensureHeader_(sheet, CONFIG.HEADER);
  sheet.setFrozenRows(1);
  if (sheet.getMaxColumns() < CONFIG.HEADER.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), CONFIG.HEADER.length - sheet.getMaxColumns());
  }
  sheet.autoResizeColumns(1, CONFIG.HEADER.length);
}

function buildPayload_() {
  return {
    ok: true,
    entries: readEntries_(),
    syncedAt: new Date().toISOString()
  };
}

function readEntries_() {
  const sheet = getSheet_();
  ensureHeader_(sheet, CONFIG.HEADER);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const rows = sheet.getRange(2, 1, lastRow - 1, CONFIG.HEADER.length).getValues();
  return rows
    .map(function(row) {
      return {
        dateKey: normalizeDateCell_(row[0]),
        goal: String(row[1] || "").trim(),
        progress: String(row[2] || "").trim(),
        issues: String(row[3] || "").trim(),
        reflection: String(row[4] || "").trim(),
        createdAt: normalizeDateTimeCell_(row[5]),
        updatedAt: normalizeDateTimeCell_(row[6]),
        id: String(row[7] || "")
      };
    })
    .filter(function(entry) {
      return entry.dateKey;
    })
    .sort(function(left, right) {
      if (left.dateKey !== right.dateKey) return left.dateKey < right.dateKey ? 1 : -1;
      return String(right.updatedAt).localeCompare(String(left.updatedAt));
    });
}

function upsertEntry_(entry) {
  const sheet = getSheet_();
  ensureHeader_(sheet, CONFIG.HEADER);

  const lastRow = sheet.getLastRow();
  const rowValues = [
    entry.dateKey,
    entry.goal,
    entry.progress,
    entry.issues,
    entry.reflection,
    entry.createdAt,
    entry.updatedAt,
    entry.id
  ];

  if (lastRow < 2) {
    sheet.appendRow(rowValues);
    return;
  }

  const dateColumn = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var index = 0; index < dateColumn.length; index += 1) {
    if (normalizeDateCell_(dateColumn[index][0]) === entry.dateKey) {
      sheet.getRange(index + 2, 1, 1, CONFIG.HEADER.length).setValues([rowValues]);
      return;
    }
  }

  sheet.appendRow(rowValues);
}

function normalizeEntry_(input) {
  const dateKey = normalizeDateString_(input.dateKey || input.date || input.targetDate);
  if (!dateKey) throw new Error("dateKey is required");

  const goal = String(input.goal || "").trim();
  const progress = String(input.progress || "").trim();
  const issues = String(input.issues || "").trim();
  const reflection = String(input.reflection || "").trim();

  if (!goal || !progress || !issues || !reflection) {
    throw new Error("all four fields are required");
  }

  return {
    id: String(input.id || Utilities.getUuid()),
    dateKey: dateKey,
    goal: goal,
    progress: progress,
    issues: issues,
    reflection: reflection,
    createdAt: normalizeIsoString_(input.createdAt || new Date().toISOString()),
    updatedAt: normalizeIsoString_(input.updatedAt || new Date().toISOString())
  };
}

function getSheet_() {
  const spreadsheetId = PROP.getProperty("SPREADSHEET_ID");
  const sheetName = PROP.getProperty("ENTRIES_SHEET_NAME") || CONFIG.DEFAULT_SHEET_NAME;
  const spreadsheet = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }
  return sheet;
}

function ensureHeader_(sheet, header) {
  const range = sheet.getRange(1, 1, 1, header.length);
  const current = range.getValues()[0];
  var shouldWrite = false;

  for (var index = 0; index < header.length; index += 1) {
    if (String(current[index] || "") !== String(header[index])) {
      shouldWrite = true;
      break;
    }
  }

  if (shouldWrite) {
    range.setValues([header]);
  }
}

function isAuthorized_(secret) {
  const required = PROP.getProperty("API_SECRET");
  if (!required) return true;
  return String(secret || "") === required;
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  return JSON.parse(e.postData.contents);
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizeDateString_(value) {
  if (!value) return "";
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");

  const text = String(value).trim();
  if (!text) return "";
  const direct = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (direct) return text;

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return Utilities.formatDate(parsed, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function normalizeDateCell_(value) {
  return normalizeDateString_(value);
}

function normalizeDateTimeCell_(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return normalizeIsoString_(value);
}

function normalizeIsoString_(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}
