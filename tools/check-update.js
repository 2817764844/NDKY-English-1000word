const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  PAGE_VERSION_NAME,
  parseAssetName,
  isReleaseDownloadUrl,
  selectUpdate,
  formatVersion,
  describeManualCheck,
} = require("../update-check.js");

const current = { versionName: "1.2", versionCode: 3 };

function release(name, extra = {}) {
  const versionName = name.match(/^cet4-words-(.+)-\d+\.apk$/)[1];
  return {
    draft: false,
    prerelease: false,
    assets: [
      {
        name,
        browser_download_url: `https://github.com/2817764844/NDKY-English-1000word/releases/download/v${versionName}/${name}`,
      },
    ],
    ...extra,
  };
}

assert.deepStrictEqual(parseAssetName("cet4-words-1.3-4.apk"), {
  versionName: "1.3",
  versionCode: 4,
});
assert.strictEqual(parseAssetName("cet4-words-1.3.apk"), null);
assert.strictEqual(parseAssetName("四级核心词-1.3-4.apk"), null);
assert.strictEqual(parseAssetName("cet4-words-1.3-0.apk"), null);
assert.strictEqual(isReleaseDownloadUrl("http://github.com/a/b/releases/download/v1/cet4-words-1.3-4.apk"), false);
assert.strictEqual(
  isReleaseDownloadUrl("https://example.com/releases/download/v1/cet4-words-1.3-4.apk"),
  false,
);

assert.deepStrictEqual(selectUpdate([release("cet4-words-1.3-4.apk")], current), {
  versionName: "1.3",
  versionCode: 4,
  downloadUrl:
    "https://github.com/2817764844/NDKY-English-1000word/releases/download/v1.3/cet4-words-1.3-4.apk",
});

const chosen = selectUpdate(
  [release("cet4-words-1.4-5.apk"), release("cet4-words-1.3-4.apk")],
  current,
);
assert.strictEqual(chosen.versionCode, 5);

assert.strictEqual(selectUpdate([release("cet4-words-1.2-3.apk")], current), null);
assert.strictEqual(selectUpdate([release("cet4-words-1.0-2.apk")], current), null);
assert.strictEqual(selectUpdate([release("cet4-words-9.9-3.apk")], current), null);
assert.strictEqual(selectUpdate([release("cet4-words-1.3-4.apk", { draft: true })], current), null);
assert.strictEqual(
  selectUpdate([release("cet4-words-1.3-4.apk", { prerelease: true })], current),
  null,
);
assert.strictEqual(selectUpdate({ message: "rate limit" }, current), null);
assert.strictEqual(selectUpdate([], current), null);
assert.strictEqual(selectUpdate([release("cet4-words-1.3-4.apk")], null), null);

const gradle = fs.readFileSync(path.join(__dirname, "../android/app/build.gradle"), "utf8");
const gradleName = gradle.match(/versionName "([^"]+)"/)[1];
const gradleCode = Number(gradle.match(/versionCode (\d+)/)[1]);
assert.strictEqual(gradleName, "1.6");
assert.strictEqual(gradleCode, 7);
assert.strictEqual(PAGE_VERSION_NAME, gradleName);
assert.strictEqual(formatVersion({ versionName: "1.6", versionCode: 7 }), "1.6（7）");
assert.strictEqual(formatVersion({ ok: false, versionName: "1.6", versionCode: 7 }), "");
assert.strictEqual(formatVersion({ versionName: "1.6" }), "");

const installed = { versionName: "1.6", versionCode: 7 };
const newer = describeManualCheck({
  platform: "android",
  current: installed,
  remoteOk: true,
  releases: [release("cet4-words-1.7-8.apk")],
});
assert.strictEqual(newer.status, "available");
assert.strictEqual(newer.update.versionCode, 8);
assert.strictEqual(newer.message, "发现新版本 1.7（8）。");

const same = describeManualCheck({
  platform: "android",
  current: installed,
  remoteOk: true,
  releases: [release("cet4-words-1.6-7.apk"), release("cet4-words-1.5-6.apk", { draft: true })],
});
assert.strictEqual(same.status, "latest");
assert.strictEqual(same.message, "已经是最新版本 1.6（7）。");

const ignoredDraft = describeManualCheck({
  platform: "android",
  current: installed,
  remoteOk: true,
  releases: [release("cet4-words-1.7-8.apk", { prerelease: true })],
});
assert.strictEqual(ignoredDraft.status, "latest");

assert.strictEqual(
  describeManualCheck({
    platform: "android",
    current: installed,
    remoteOk: false,
    releases: null,
  }).status,
  "failed",
);
assert.strictEqual(
  describeManualCheck({
    platform: "android",
    current: installed,
    remoteOk: true,
    releases: { message: "rate limit" },
  }).message,
  "检查更新失败。请检查网络后再试。",
);
assert.strictEqual(
  describeManualCheck({
    platform: "android",
    current: { ok: false },
    remoteOk: true,
    releases: [],
  }).message,
  "检查更新失败，没有读到当前安装版本。",
);

const web = describeManualCheck({ platform: "web" });
assert.strictEqual(web.status, "web");
assert.match(web.message, /网页版/);
assert.match(web.message, /不能安装安卓包/);
assert.strictEqual(web.update, undefined);

console.log("update-check ok");
