/* 纯函数：从 GitHub Releases JSON 里挑出可以覆盖安装的 APK。网页和安卓共用这一份判断。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.Cet4UpdateCheck = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const ASSET_NAME = /^cet4-words-(\d+\.\d+(?:\.\d+)?)-([1-9]\d*)\.apk$/i;
  const RELEASES_URL =
    "https://api.github.com/repos/2817764844/NDKY-English-1000word/releases?per_page=30";
  // 只给网页展示页面版本。安卓壳必须读系统安装包的 versionName / versionCode，不能用这个常量。
  const PAGE_VERSION_NAME = "1.6";

  function parseAssetName(name) {
    const match = ASSET_NAME.exec(String(name || "").trim());
    if (!match) {
      return null;
    }
    const versionCode = Number(match[2]);
    if (!Number.isSafeInteger(versionCode) || versionCode <= 0) {
      return null;
    }
    return {
      versionName: match[1],
      versionCode,
    };
  }

  function isReleaseDownloadUrl(value) {
    try {
      const url = new URL(String(value));
      return (
        url.protocol === "https:" &&
        url.hostname.toLowerCase() === "github.com" &&
        url.pathname.includes("/releases/download/")
      );
    } catch {
      return false;
    }
  }

  function currentVersionCode(current) {
    if (!current || current.versionCode === undefined || current.versionCode === null || current.versionCode === "") {
      return null;
    }
    const code = Number(current.versionCode);
    if (!Number.isSafeInteger(code) || code < 0) {
      return null;
    }
    return code;
  }

  // versionCode 才是 Android 能否覆盖安装的依据。versionName 只用于展示和文件名。
  function selectUpdate(releases, current) {
    const installed = currentVersionCode(current);
    if (installed === null || !Array.isArray(releases)) {
      return null;
    }
    let best = null;
    releases.forEach((release) => {
      if (!release || release.draft || release.prerelease) {
        return;
      }
      const assets = Array.isArray(release.assets) ? release.assets : [];
      assets.forEach((asset) => {
        const parsed = parseAssetName(asset && asset.name);
        const downloadUrl = asset && asset.browser_download_url;
        if (!parsed || parsed.versionCode <= installed || !isReleaseDownloadUrl(downloadUrl)) {
          return;
        }
        if (!best || parsed.versionCode > best.versionCode) {
          best = {
            versionName: parsed.versionName,
            versionCode: parsed.versionCode,
            downloadUrl,
          };
        }
      });
    });
    return best;
  }

  function formatVersion(current) {
    const code = currentVersionCode(current);
    if (!current || current.ok === false || !current.versionName || code === null) {
      return "";
    }
    return `${current.versionName}（${code}）`;
  }

  // 手动检查的三种安卓结果，以及网页上的诚实说明。自动检查不走这里。
  function describeManualCheck(input) {
    const source = input || {};
    if (source.platform !== "android") {
      return {
        status: "web",
        message: "这是网页版。刷新页面即可使用最新内容。浏览器不能安装安卓包。",
      };
    }
    const current = source.current;
    const installed = formatVersion(current);
    if (!installed) {
      return {
        status: "failed",
        message: "检查更新失败，没有读到当前安装版本。",
      };
    }
    if (source.remoteOk !== true || !Array.isArray(source.releases)) {
      return {
        status: "failed",
        message: "检查更新失败。请检查网络后再试。",
      };
    }
    const update = selectUpdate(source.releases, current);
    if (!update) {
      return {
        status: "latest",
        message: `已经是最新版本 ${installed}。`,
      };
    }
    return {
      status: "available",
      message: `发现新版本 ${update.versionName}（${update.versionCode}）。`,
      update,
    };
  }

  return {
    PAGE_VERSION_NAME,
    RELEASES_URL,
    parseAssetName,
    isReleaseDownloadUrl,
    selectUpdate,
    formatVersion,
    describeManualCheck,
  };
});
