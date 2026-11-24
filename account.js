/* 可选账号、云同步、打卡和统计。未配置云端或未登录时，学习数据只留在本机。 */
(function () {
  const syncApi = window.CET4_SYNC;
  const statsKey = "cet4-stats";
  const progressMetaKey = "cet4-progress-meta";
  const favoriteMetaKey = "cet4-favorites-meta";
  const sessionKey = "cet4-session";
  const dirtyKey = "cet4-sync-dirty";
  const syncedAtKey = "cet4-sync-at";

  const modal = document.querySelector("#accountModal");
  const form = document.querySelector("#accountForm");
  const emailInput = document.querySelector("#accountEmail");
  const passwordInput = document.querySelector("#accountPassword");
  const formError = document.querySelector("#accountFormError");
  const submitButton = document.querySelector("#accountSubmit");
  const guestPanel = document.querySelector("#accountGuest");
  const userPanel = document.querySelector("#accountUser");
  const resetPanel = document.querySelector("#accountReset");
  const syncStatus = document.querySelector("#accountSync");
  const emailLabel = document.querySelector("#accountEmailLabel");
  const streakCount = document.querySelector("#streakCount");
  const streakHint = document.querySelector("#streakHint");
  const checkinButton = document.querySelector("#checkinButton");
  const todayCount = document.querySelector("#accountTodayCount");
  const progressBox = document.querySelector("#accountProgress");
  const calendarBox = document.querySelector("#accountCalendar");
  const newPasswordInput = document.querySelector("#accountNewPassword");
  const resetError = document.querySelector("#accountResetError");

  if (!modal || !syncApi) {
    return;
  }

  let mode = "login";
  let syncing = false;
  let syncQueued = false;
  let syncTimer = 0;
  let syncMessage = "";
  let notice = "";
  let recoverySession = null;
  let seenProgress = {};
  let seenFavorites = [];
  let progressMeta = readJson(progressMetaKey, {});
  let favoriteMeta = readJson(favoriteMetaKey, {});
  let stats = normalizeStats(readJson(statsKey, {}));

  function readJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "");
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 存储不可用时仍允许继续浏览。
    }
  }

  function normalizeStats(value) {
    const bundle = syncApi.normalizeBundle({ stats: value });
    return bundle.stats;
  }

  function cloudConfig() {
    const source = window.CET4_CLOUD || {};
    const url = String(source.url || "").trim().replace(/\/+$/, "");
    const anonKey = String(source.anonKey || "").trim();
    if (!url || !anonKey || url.includes("YOUR_PROJECT") || /^your[-_ ]?anon[-_ ]?key$/i.test(anonKey)) {
      return null;
    }
    try {
      const parsed = new URL(url);
      const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      const allowed =
        parsed.protocol === "https:" || (parsed.protocol === "http:" && loopback);
      if (!allowed) {
        return null;
      }
    } catch {
      return null;
    }
    return { url, anonKey };
  }

  function readSession() {
    const session = readJson(sessionKey, null);
    if (!session || !session.access_token || !session.user || !session.user.id) {
      return null;
    }
    return session;
  }

  function writeSession(session) {
    if (!session) {
      try {
        localStorage.removeItem(sessionKey);
      } catch {
        // 退出失败也不影响本机词表。
      }
      return;
    }
    writeJson(sessionKey, {
      access_token: session.access_token,
      refresh_token: session.refresh_token || "",
      expires_at: Number(session.expires_at) || 0,
      user: {
        id: session.user.id,
        email: session.user.email || "",
      },
    });
  }

  function markDirty() {
    try {
      localStorage.setItem(dirtyKey, "1");
    } catch {
      // 记不住就下次打开再同步。
    }
  }

  function clearDirty() {
    try {
      localStorage.removeItem(dirtyKey);
    } catch {
      // 忽略。
    }
  }

  function isDirty() {
    try {
      return localStorage.getItem(dirtyKey) === "1";
    } catch {
      return false;
    }
  }

  function snapshot() {
    if (window.CET4_APP && typeof window.CET4_APP.snapshot === "function") {
      return window.CET4_APP.snapshot();
    }
    return { progress: {}, favorites: [], wordCount: 0 };
  }

  function rememberSeen(next) {
    seenProgress = Object.assign({}, next.progress || {});
    seenFavorites = (next.favorites || []).slice();
  }

  function currentBundle() {
    const current = snapshot();
    return syncApi.bundleFromLocal(
      current.progress,
      current.favorites,
      progressMeta,
      favoriteMeta,
      stats,
    );
  }

  function persistLocal(bundle) {
    const view = syncApi.localFromBundle(bundle);
    progressMeta = view.progressMeta;
    favoriteMeta = view.favoriteMeta;
    stats = view.stats;
    writeJson(progressMetaKey, progressMeta);
    writeJson(favoriteMetaKey, favoriteMeta);
    writeJson(statsKey, stats);
    if (window.CET4_APP && typeof window.CET4_APP.replaceStudyData === "function") {
      window.CET4_APP.replaceStudyData(view.progress, view.favorites);
    }
    rememberSeen(view);
  }

  function setFormError(message) {
    if (!formError) {
      return;
    }
    formError.hidden = !message;
    formError.textContent = message || "";
  }

  function setSyncStatus(kind, text) {
    if (!syncStatus) {
      return;
    }
    syncStatus.className = `account-sync is-${kind}`;
    syncStatus.textContent = text;
  }

  function formatClock(ms) {
    const date = new Date(ms);
    const pad = (value) => String(value).padStart(2, "0");
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function renderSyncStatus() {
    const config = cloudConfig();
    const session = readSession();
    if (!config) {
      setSyncStatus("warn", "云同步未配置。登录还不可用，打卡和统计保存在这台设备。");
      return;
    }
    if (notice) {
      setSyncStatus("warn", notice);
      return;
    }
    if (!session) {
      setSyncStatus("idle", "未登录。学习记录只保存在这台设备，登录后会合并到云端。");
      return;
    }
    if (syncing) {
      setSyncStatus("busy", "正在同步…");
      return;
    }
    if (syncMessage) {
      setSyncStatus("warn", syncMessage);
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setSyncStatus("warn", "当前离线。新的进度已写在本机，联网后会自动同步。");
      return;
    }
    if (isDirty()) {
      setSyncStatus("warn", "还有记录没同步到云端。网络恢复后会自动再试。");
      return;
    }
    const syncedAt = Number(localStorage.getItem(syncedAtKey) || 0);
    const when = syncedAt ? ` · ${formatClock(syncedAt)}` : "";
    setSyncStatus("ok", `已同步${when}。换设备登录同一邮箱可以拿回进度、收藏和打卡。`);
  }

  function renderStats() {
    const now = new Date();
    const today = syncApi.todayKey(now);
    const checkins = stats.checkins || {};
    const streak = syncApi.streakFromCheckins(checkins, now);
    const todayRecord = checkins[today];
    const checked = syncApi.isChecked(checkins, today);
    if (streakCount) {
      streakCount.textContent = String(streak);
    }
    if (streakHint) {
      if (checked) {
        streakHint.textContent = "今天已计入连续打卡。";
      } else if (streak > 0) {
        streakHint.textContent = "今天还没打卡，连续天数暂时算到昨天。";
      } else {
        streakHint.textContent = "今天打卡后，连续天数从 1 开始。";
      }
    }
    if (todayCount) {
      const actions = todayRecord && todayRecord.actions ? todayRecord.actions : 0;
      if (actions) {
        todayCount.textContent = `今天学习 ${actions} 次`;
      } else if (checked) {
        todayCount.textContent = "今天已打卡，还没有做题或标记";
      } else {
        todayCount.textContent = "今天还没有学习记录";
      }
    }
    if (checkinButton) {
      checkinButton.textContent = checked ? "今日已打卡" : "今日打卡";
      checkinButton.setAttribute("aria-pressed", checked ? "true" : "false");
    }
    renderProgress();
    renderCalendar(now);
  }

  function renderProgress() {
    if (!progressBox) {
      return;
    }
    const current = snapshot();
    let mastered = 0;
    let fuzzy = 0;
    Object.values(current.progress || {}).forEach((status) => {
      if (status === "mastered") {
        mastered += 1;
      } else if (status === "fuzzy") {
        fuzzy += 1;
      }
    });
    const total = Number(current.wordCount) || mastered + fuzzy;
    const unknown = Math.max(0, total - mastered - fuzzy);
    const rows = [
      ["已掌握", mastered, "is-mastered"],
      ["模糊", fuzzy, "is-fuzzy"],
      ["生词", unknown, "is-unknown"],
    ];
    progressBox.replaceChildren();
    rows.forEach(([label, count, className]) => {
      const row = document.createElement("div");
      row.className = `account-meter ${className}`;
      const percent = !total || !count ? 0 : Math.max(2, Math.round((count / total) * 100));
      row.innerHTML = `
        <span class="account-meter-label">${label}</span>
        <span class="account-meter-track" aria-hidden="true"><span style="width:${percent}%"></span></span>
        <strong>${count}</strong>
      `;
      progressBox.append(row);
    });
  }

  function renderCalendar(now) {
    if (!calendarBox) {
      return;
    }
    const year = now.getFullYear();
    const month = now.getMonth();
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(year, month + 1, 0).getDate();
    const today = syncApi.todayKey(now);
    calendarBox.replaceChildren();
    const title = document.createElement("p");
    title.className = "account-calendar-title";
    title.textContent = `${year}年${month + 1}月`;
    calendarBox.append(title);
    const grid = document.createElement("div");
    grid.className = "account-calendar-grid";
    ["一", "二", "三", "四", "五", "六", "日"].forEach((label) => {
      const cell = document.createElement("span");
      cell.className = "account-calendar-week";
      cell.textContent = label;
      grid.append(cell);
    });
    for (let index = 0; index < offset; index += 1) {
      const blank = document.createElement("span");
      blank.className = "account-calendar-day is-blank";
      grid.append(blank);
    }
    for (let day = 1; day <= days; day += 1) {
      const key = syncApi.todayKey(new Date(year, month, day));
      const cell = document.createElement("span");
      cell.className = "account-calendar-day";
      cell.textContent = String(day);
      if (syncApi.isChecked(stats.checkins, key)) {
        cell.classList.add("is-checked");
      }
      if (key === today) {
        cell.classList.add("is-today");
      }
      grid.append(cell);
    }
    calendarBox.append(grid);
  }

  function renderAccount() {
    const session = readSession();
    const recovering = Boolean(recoverySession);
    if (guestPanel) {
      guestPanel.hidden = Boolean(session) || recovering;
    }
    if (userPanel) {
      userPanel.hidden = !session || recovering;
    }
    if (resetPanel) {
      resetPanel.hidden = !recovering;
    }
    if (emailLabel && session) {
      emailLabel.textContent = session.user.email || "已登录";
    }
    renderSyncStatus();
    renderStats();
  }

  function recordCheckin(kind) {
    const today = syncApi.todayKey(new Date());
    const current = stats.checkins[today] || { manual: false, study: false, actions: 0 };
    if (kind === "manual") {
      current.manual = true;
    } else {
      current.study = true;
      current.actions += 1;
    }
    stats.checkins[today] = current;
    writeJson(statsKey, stats);
    markDirty();
    renderStats();
    renderSyncStatus();
    scheduleSync();
  }

  function onStudy(event) {
    const kind = event.detail && event.detail.kind;
    const next = snapshot();
    const now = Date.now();
    if (kind === "progress") {
      progressMeta = syncApi.touchProgress(progressMeta, seenProgress, next.progress || {}, now);
      writeJson(progressMetaKey, progressMeta);
    } else if (kind === "favorite") {
      favoriteMeta = syncApi.touchFavorites(
        favoriteMeta,
        seenFavorites,
        next.favorites || [],
        now,
      );
      writeJson(favoriteMetaKey, favoriteMeta);
    }
    rememberSeen(next);
    if (kind === "progress" || kind === "favorite" || kind === "spelling" || kind === "battle") {
      recordCheckin("study");
    }
  }

  function translateError(body, fallback) {
    const raw = body && (body.error_description || body.msg || body.message || body.error || "");
    const text = String(raw || fallback || "请求失败");
    const lower = text.toLowerCase();
    if (lower.includes("invalid login") || lower.includes("invalid_grant")) {
      return "邮箱或密码不正确。";
    }
    if (lower.includes("already registered") || lower.includes("already exists") || lower.includes("user_already")) {
      return "这个邮箱已经注册，直接登录即可。";
    }
    if (lower.includes("email not confirmed") || lower.includes("not confirmed")) {
      return "请先打开确认邮件，完成确认后再登录。";
    }
    if (lower.includes("invalid") && lower.includes("email")) {
      return "邮箱格式不正确。";
    }
    if (lower.includes("password") && (lower.includes("weak") || lower.includes("short") || lower.includes("least"))) {
      return "密码至少 6 位。";
    }
    if (lower.includes("rate") || lower.includes("too many")) {
      return "尝试太频繁，请稍后再试。";
    }
    if (lower.includes("网络不可用")) {
      return "网络不可用。本机记录已保存，联网后再同步。";
    }
    return text;
  }

  async function cloudFetch(path, options) {
    const config = cloudConfig();
    if (!config) {
      const error = new Error("云同步未配置");
      error.code = "unconfigured";
      throw error;
    }
    const headers = Object.assign(
      {
        apikey: config.anonKey,
        "Content-Type": "application/json",
      },
      (options && options.headers) || {},
    );
    let response;
    try {
      response = await fetch(`${config.url}${path}`, {
        method: (options && options.method) || "GET",
        headers,
        body: options && options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch {
      const error = new Error("网络不可用");
      error.code = "offline";
      throw error;
    }
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { message: text };
      }
    }
    if (!response.ok) {
      const error = new Error(translateError(body, "请求失败"));
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  function sessionFromAuth(body) {
    if (!body || typeof body !== "object") {
      return null;
    }
    if (body.access_token && body.user) {
      return body;
    }
    if (body.session && body.session.access_token) {
      return body.session;
    }
    return null;
  }

  async function ensureSession() {
    const session = readSession();
    if (!session) {
      return null;
    }
    const expiresAt = Number(session.expires_at) || 0;
    if (!expiresAt || expiresAt * 1000 > Date.now() + 60000) {
      return session;
    }
    if (!session.refresh_token) {
      return session;
    }
    const body = await cloudFetch("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: session.refresh_token },
    });
    const next = sessionFromAuth(body);
    if (!next) {
      throw new Error("登录状态已失效，请重新登录。");
    }
    writeSession(next);
    return readSession();
  }

  async function fetchRemote(session) {
    const rows = await cloudFetch(
      `/rest/v1/study_state?select=progress,favorites,stats,updated_at&user_id=eq.${encodeURIComponent(session.user.id)}`,
      {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          Accept: "application/json",
        },
      },
    );
    if (!Array.isArray(rows) || !rows.length) {
      return null;
    }
    return rows[0];
  }

  async function writeRemote(session, bundle, remote) {
    const payload = {
      user_id: session.user.id,
      progress: bundle.progress,
      favorites: bundle.favorites,
      stats: bundle.stats,
      updated_at: new Date().toISOString(),
    };
    const headers = {
      Authorization: `Bearer ${session.access_token}`,
      Prefer: "return=representation",
    };
    if (!remote) {
      const created = await cloudFetch("/rest/v1/study_state", {
        method: "POST",
        headers,
        body: payload,
      });
      return Array.isArray(created) ? created[0] : created;
    }
    const updated = await cloudFetch(
      `/rest/v1/study_state?user_id=eq.${encodeURIComponent(session.user.id)}&updated_at=eq.${encodeURIComponent(remote.updated_at)}`,
      {
        method: "PATCH",
        headers,
        body: {
          progress: payload.progress,
          favorites: payload.favorites,
          stats: payload.stats,
          updated_at: payload.updated_at,
        },
      },
    );
    if (Array.isArray(updated) && !updated.length) {
      return null;
    }
    return Array.isArray(updated) ? updated[0] : updated;
  }

  async function syncNow() {
    const config = cloudConfig();
    const existing = readSession();
    if (!config || !existing) {
      renderSyncStatus();
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      renderSyncStatus();
      return;
    }
    if (syncing) {
      syncQueued = true;
      return;
    }
    syncing = true;
    renderSyncStatus();
    try {
      let saved = false;
      for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
        const session = await ensureSession();
        const remote = await fetchRemote(session);
        const remoteBundle = remote
          ? syncApi.normalizeBundle({
              progress: remote.progress,
              favorites: remote.favorites,
              stats: remote.stats,
            })
          : syncApi.emptyBundle();
        const merged = syncApi.mergeStudyState(currentBundle(), remoteBundle);
        if (!syncApi.bundlesEqual(merged, currentBundle())) {
          persistLocal(merged);
        }
        if (remote && syncApi.bundlesEqual(merged, remoteBundle) && !isDirty()) {
          saved = true;
          break;
        }
        try {
          const written = await writeRemote(session, merged, remote);
          saved = Boolean(written);
        } catch (error) {
          if (error.status === 409) {
            continue;
          }
          throw error;
        }
      }
      if (!saved) {
        throw new Error("云端正在被另一台设备更新，请稍后再试。");
      }
      syncMessage = "";
      clearDirty();
      try {
        localStorage.setItem(syncedAtKey, String(Date.now()));
      } catch {
        // 时间记不住不影响数据。
      }
    } catch (error) {
      markDirty();
      if (error.code === "offline" || (typeof navigator !== "undefined" && navigator.onLine === false)) {
        syncMessage = "当前离线。新的进度已写在本机，联网后会自动同步。";
      } else if (error.status === 401) {
        writeSession(null);
        syncMessage = "";
        notice = "登录已过期，请重新登录。本机记录还在。";
      } else {
        syncMessage = `${error.message || "同步失败"} 本机记录还在。`;
      }
    } finally {
      syncing = false;
      renderAccount();
      if (syncQueued) {
        syncQueued = false;
        scheduleSync();
      }
    }
  }

  function scheduleSync() {
    if (!cloudConfig() || !readSession()) {
      return;
    }
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
      syncNow();
    }, 700);
  }

  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  async function submitAccount(event) {
    event.preventDefault();
    setFormError("");
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!cloudConfig()) {
      setFormError("还没有填写云端地址和 anon key，登录暂不可用。打卡和统计已保存在这台设备。");
      return;
    }
    if (!validEmail(email)) {
      setFormError("请填写有效的邮箱。");
      return;
    }
    if (password.length < 6) {
      setFormError("密码至少 6 位。");
      return;
    }
    submitButton.disabled = true;
    notice = "";
    try {
      if (mode === "register") {
        const body = await cloudFetch("/auth/v1/signup", {
          method: "POST",
          body: { email, password },
        });
        const session = sessionFromAuth(body);
        if (!session) {
          setFormError("注册成功。请打开邮箱里的确认信，确认后再回到这里登录。");
          mode = "login";
          submitButton.textContent = "登录";
          return;
        }
        writeSession(session);
      } else {
        const body = await cloudFetch("/auth/v1/token?grant_type=password", {
          method: "POST",
          body: { email, password },
        });
        const session = sessionFromAuth(body);
        if (!session) {
          throw new Error("登录没有返回有效会话。");
        }
        writeSession(session);
      }
      passwordInput.value = "";
      markDirty();
      renderAccount();
      await syncNow();
    } catch (error) {
      setFormError(error.message || "登录失败。");
    } finally {
      submitButton.disabled = false;
    }
  }

  async function signOut() {
    const session = readSession();
    const config = cloudConfig();
    writeSession(null);
    if (session && config) {
      try {
        await cloudFetch("/auth/v1/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
      } catch {
        // 本机退出即可，云端会话过期后自然失效。
      }
    }
    renderAccount();
  }

  async function requestReset() {
    setFormError("");
    const email = emailInput.value.trim();
    if (!cloudConfig()) {
      setFormError("云同步未配置，暂时不能发送重置邮件。");
      return;
    }
    if (!validEmail(email)) {
      setFormError("请先填写注册时使用的邮箱。");
      return;
    }
    try {
      await cloudFetch("/auth/v1/recover", {
        method: "POST",
        body: { email },
      });
      setFormError("如果这个邮箱已注册，你会收到重置邮件。打开邮件后回到这个页面设置新密码。");
    } catch (error) {
      setFormError(error.message || "暂时无法发送重置邮件。");
    }
  }

  async function updatePassword(event) {
    event.preventDefault();
    if (!recoverySession) {
      return;
    }
    const password = newPasswordInput.value;
    if (resetError) {
      resetError.hidden = true;
      resetError.textContent = "";
    }
    if (password.length < 6) {
      if (resetError) {
        resetError.hidden = false;
        resetError.textContent = "新密码至少 6 位。";
      }
      return;
    }
    try {
      await cloudFetch("/auth/v1/user", {
        method: "PUT",
        headers: { Authorization: `Bearer ${recoverySession.access_token}` },
        body: { password },
      });
      const user = await cloudFetch("/auth/v1/user", {
        headers: { Authorization: `Bearer ${recoverySession.access_token}` },
      });
      writeSession({
        access_token: recoverySession.access_token,
        refresh_token: recoverySession.refresh_token,
        expires_at: recoverySession.expires_at,
        user: {
          id: (user && user.id) || recoverySession.user.id,
          email: (user && user.email) || recoverySession.user.email,
        },
      });
      recoverySession = null;
      newPasswordInput.value = "";
      markDirty();
      renderAccount();
      await syncNow();
    } catch (error) {
      if (resetError) {
        resetError.hidden = false;
        resetError.textContent = error.message || "没能更新密码。";
      }
    }
  }

  function setMode(next) {
    mode = next === "register" ? "register" : "login";
    document.querySelectorAll("[data-account-mode]").forEach((button) => {
      const active = button.dataset.accountMode === mode;
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    if (submitButton) {
      submitButton.textContent = mode === "register" ? "注册" : "登录";
    }
    if (passwordInput) {
      passwordInput.autocomplete = mode === "register" ? "new-password" : "current-password";
    }
    setFormError("");
  }

  function syncScrollLock() {
    if (window.CET4_APP && typeof window.CET4_APP.syncScrollLock === "function") {
      window.CET4_APP.syncScrollLock();
      return;
    }
    document.body.classList.toggle("modal-open", !modal.hidden);
  }

  function openAccount() {
    modal.hidden = false;
    renderAccount();
    syncScrollLock();
    const session = readSession();
    const focusTarget = recoverySession
      ? newPasswordInput
      : session
        ? document.querySelector("#accountSignOut")
        : emailInput;
    if (focusTarget) {
      focusTarget.focus();
    }
  }

  function closeAccount() {
    modal.hidden = true;
    syncScrollLock();
    document.querySelectorAll("[data-app-nav]").forEach((item) => {
      const active = item.dataset.appNav === "list";
      item.classList.toggle("is-active", active);
      if (active) {
        item.setAttribute("aria-current", "page");
      } else {
        item.removeAttribute("aria-current");
      }
    });
  }

  function consumeRecoveryHash() {
    if (!location.hash || location.hash.length < 2) {
      return;
    }
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.get("type") !== "recovery" || !params.get("access_token")) {
      return;
    }
    recoverySession = {
      access_token: params.get("access_token"),
      refresh_token: params.get("refresh_token") || "",
      expires_at: Number(params.get("expires_at")) || 0,
      user: { id: "", email: "" },
    };
    const payload = params.get("access_token").split(".")[1];
    if (payload) {
      try {
        const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
        const json = JSON.parse(decodeURIComponent(escape(atob(normalized))));
        recoverySession.user.id = json.sub || "";
        recoverySession.user.email = json.email || "";
      } catch {
        // 打不开令牌也不展示内容，只保留设置新密码的入口。
      }
    }
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    openAccount();
  }

  modal.addEventListener("click", (event) => {
    const action = event.target.closest("[data-account-action]");
    if (!action) {
      return;
    }
    if (action.dataset.accountAction === "close") {
      closeAccount();
    }
  });

  document.querySelectorAll("[data-account-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.accountMode));
  });
  if (form) {
    form.addEventListener("submit", submitAccount);
  }
  const forgotButton = document.querySelector("#accountForgot");
  if (forgotButton) {
    forgotButton.addEventListener("click", requestReset);
  }
  const signOutButton = document.querySelector("#accountSignOut");
  if (signOutButton) {
    signOutButton.addEventListener("click", signOut);
  }
  const resetForm = document.querySelector("#accountResetForm");
  if (resetForm) {
    resetForm.addEventListener("submit", updatePassword);
  }
  if (checkinButton) {
    checkinButton.addEventListener("click", () => recordCheckin("manual"));
  }
  const entry = document.querySelector("#accountButton");
  if (entry) {
    entry.addEventListener("click", () => {
      if (window.CET4_APP && typeof window.CET4_APP.openAccount === "function") {
        window.CET4_APP.openAccount();
        return;
      }
      openAccount();
    });
  }

  window.addEventListener("cet4-study", onStudy);
  window.addEventListener("online", () => {
    renderSyncStatus();
    syncNow();
  });
  window.addEventListener("offline", renderSyncStatus);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      event.preventDefault();
      closeAccount();
    }
  });

  window.CET4_ACCOUNT = {
    open: openAccount,
    close: closeAccount,
  };

  rememberSeen(snapshot());
  renderAccount();
  consumeRecoveryHash();
  if (readSession() && cloudConfig()) {
    syncNow();
  }
})();
