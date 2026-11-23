/* 只在安卓壳里检查 GitHub Releases。网页和桌面浏览器直接返回。检查失败不提示。 */
(function () {
  const dismissedKey = "cet4-update-dismissed";
  let plugin = null;
  let dialog = null;
  let downloaded = false;
  let waitingForPermission = false;
  let progressHandle = null;

  function isAndroidApp() {
    const cap = window.Capacitor;
    return Boolean(
      cap &&
        typeof cap.isNativePlatform === "function" &&
        cap.isNativePlatform() &&
        typeof cap.getPlatform === "function" &&
        cap.getPlatform() === "android",
    );
  }

  function getPlugin() {
    if (plugin) {
      return plugin;
    }
    const cap = window.Capacitor;
    if (!cap) {
      return null;
    }
    if (cap.Plugins && cap.Plugins.Cet4Update) {
      plugin = cap.Plugins.Cet4Update;
      return plugin;
    }
    if (typeof cap.registerPlugin === "function") {
      plugin = cap.registerPlugin("Cet4Update");
      return plugin;
    }
    return null;
  }

  function readDismissed() {
    try {
      const value = Number(localStorage.getItem(dismissedKey));
      return Number.isSafeInteger(value) ? value : 0;
    } catch {
      return 0;
    }
  }

  function rememberDismissed(versionCode) {
    try {
      localStorage.setItem(dismissedKey, String(versionCode));
    } catch {
      // 记不住就下次再问，不影响学习。
    }
  }

  function ensureDialog() {
    if (dialog) {
      return dialog;
    }
    const root = document.createElement("div");
    root.className = "update-modal";
    root.id = "cet4UpdateDialog";
    root.hidden = true;
    root.innerHTML = `
      <div class="update-backdrop" data-update-action="later"></div>
      <section class="update-card" role="dialog" aria-modal="true" aria-labelledby="cet4UpdateTitle">
        <p class="update-kicker">应用更新</p>
        <h2 id="cet4UpdateTitle">发现新版本</h2>
        <p class="update-copy" id="cet4UpdateCopy"></p>
        <div class="update-progress" id="cet4UpdateProgress" hidden>
          <span id="cet4UpdateProgressBar"></span>
        </div>
        <p class="update-status" id="cet4UpdateStatus" hidden></p>
        <div class="update-actions">
          <button class="update-later" id="cet4UpdateLater" type="button" data-update-action="later">稍后再说</button>
          <button class="update-go" id="cet4UpdateGo" type="button" data-update-action="download">下载更新</button>
        </div>
      </section>
    `;
    root.addEventListener("click", (event) => {
      const button = event.target.closest("[data-update-action]");
      if (!button || button.disabled) {
        return;
      }
      const action = button.dataset.updateAction;
      if (action === "later") {
        dismiss();
      } else if (action === "download") {
        beginDownload();
      } else if (action === "settings") {
        openSettings();
      } else if (action === "install") {
        installDownloaded();
      }
    });
    document.body.append(root);
    dialog = root;
    return root;
  }

  function setBusy(busy) {
    const go = document.querySelector("#cet4UpdateGo");
    if (go) {
      go.disabled = busy;
    }
  }

  function showPrompt(update, current) {
    const root = ensureDialog();
    root.dataset.versionCode = String(update.versionCode);
    root.dataset.downloadUrl = update.downloadUrl;
    downloaded = false;
    waitingForPermission = false;
    const currentName = (current && current.versionName) || "当前版本";
    const currentCode = current && current.versionCode ? `（${current.versionCode}）` : "";
    document.querySelector("#cet4UpdateTitle").textContent = "发现新版本";
    document.querySelector("#cet4UpdateCopy").textContent =
      `可安装 ${update.versionName}（${update.versionCode}）。现在是 ${currentName}${currentCode}。下载完成后会打开系统安装界面，系统还会再让你确认一次。覆盖安装会保留收藏和学习进度。`;
    document.querySelector("#cet4UpdateProgress").hidden = true;
    document.querySelector("#cet4UpdateStatus").hidden = true;
    const go = document.querySelector("#cet4UpdateGo");
    go.hidden = false;
    go.dataset.updateAction = "download";
    go.textContent = "下载更新";
    document.querySelector("#cet4UpdateLater").textContent = "稍后再说";
    setBusy(false);
    root.hidden = false;
  }

  function dismiss() {
    if (!dialog) {
      return;
    }
    const code = Number(dialog.dataset.versionCode);
    if (Number.isSafeInteger(code) && code > 0) {
      rememberDismissed(code);
    }
    const native = getPlugin();
    if (native && typeof native.cancelDownload === "function") {
      native.cancelDownload().catch(() => {});
    }
    dialog.hidden = true;
    downloaded = false;
    waitingForPermission = false;
  }

  function showStatus(text, action) {
    const status = document.querySelector("#cet4UpdateStatus");
    status.hidden = false;
    status.textContent = text;
    const go = document.querySelector("#cet4UpdateGo");
    if (action) {
      go.hidden = false;
      go.dataset.updateAction = action.id;
      go.textContent = action.label;
      go.disabled = false;
    }
  }

  async function beginDownload() {
    const native = getPlugin();
    const url = dialog && dialog.dataset.downloadUrl;
    if (!native || !url) {
      showStatus("下载没有完成，可以稍后再试。");
      return;
    }
    setBusy(true);
    document.querySelector("#cet4UpdateProgress").hidden = false;
    document.querySelector("#cet4UpdateProgressBar").style.width = "0%";
    showStatus("正在下载…");
    try {
      if (progressHandle) {
        progressHandle.remove();
        progressHandle = null;
      }
      if (typeof native.addListener === "function") {
        progressHandle = await native.addListener("downloadProgress", (event) => {
          const percent = Number(event && event.percent);
          const bar = document.querySelector("#cet4UpdateProgressBar");
          const status = document.querySelector("#cet4UpdateStatus");
          if (Number.isFinite(percent) && percent >= 0) {
            if (bar) {
              bar.style.width = `${Math.min(100, percent)}%`;
            }
            if (status) {
              status.textContent = `正在下载 ${Math.min(100, percent)}%`;
            }
          }
        });
      }
      const result = await native.downloadApk({ url });
      if (!result || !result.ok) {
        showStatus("下载没有完成，可以稍后再试。");
        setBusy(false);
        return;
      }
      downloaded = true;
      document.querySelector("#cet4UpdateProgressBar").style.width = "100%";
      await installDownloaded();
    } catch {
      showStatus("下载没有完成，可以稍后再试。");
      setBusy(false);
    }
  }

  async function installDownloaded() {
    const native = getPlugin();
    if (!native || !downloaded) {
      return;
    }
    try {
      const permission = await native.canRequestInstall();
      if (permission && permission.allowed === false) {
        waitingForPermission = true;
        setBusy(false);
        showStatus("请先允许本应用安装未知应用。从设置回来后会继续打开安装界面。", {
          id: "settings",
          label: "去设置",
        });
        return;
      }
      waitingForPermission = false;
      showStatus("正在打开系统安装界面…");
      const result = await native.installDownloaded();
      if (!result || !result.ok) {
        if (result && result.reason === "permission") {
          waitingForPermission = true;
          setBusy(false);
          showStatus("请先允许本应用安装未知应用。从设置回来后会继续打开安装界面。", {
            id: "settings",
            label: "去设置",
          });
          return;
        }
        setBusy(false);
        showStatus("暂时无法打开安装界面，可以稍后再试。");
      }
    } catch {
      setBusy(false);
      showStatus("暂时无法打开安装界面，可以稍后再试。");
    }
  }

  async function openSettings() {
    const native = getPlugin();
    if (!native) {
      return;
    }
    waitingForPermission = true;
    try {
      await native.openInstallSettings();
    } catch {
      showStatus("无法打开设置，请到系统设置里允许本应用安装未知应用。");
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && waitingForPermission && downloaded) {
      installDownloaded();
    }
  });

  async function checkForUpdate() {
    if (!isAndroidApp() || !window.Cet4UpdateCheck) {
      return;
    }
    const native = getPlugin();
    if (!native) {
      return;
    }
    try {
      const current = await native.getVersion();
      const remote = await native.fetchReleases();
      if (!remote || !remote.ok || typeof remote.body !== "string") {
        return;
      }
      const releases = JSON.parse(remote.body);
      const update = window.Cet4UpdateCheck.selectUpdate(releases, current);
      if (!update || update.versionCode <= readDismissed()) {
        return;
      }
      showPrompt(update, current);
    } catch {
      // 网络、解析或插件异常都不打断背词。
    }
  }

  window.Cet4AppUpdate = {
    showPrompt,
    checkForUpdate,
  };

  window.addEventListener("load", () => {
    window.setTimeout(checkForUpdate, 1200);
  });
})();
