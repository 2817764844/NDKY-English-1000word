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

  return {
    RELEASES_URL,
    parseAssetName,
    isReleaseDownloadUrl,
    selectUpdate,
  };
});
