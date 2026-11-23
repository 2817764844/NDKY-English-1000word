const assert = require("assert");
const { parseAssetName, isReleaseDownloadUrl, selectUpdate } = require("../update-check.js");

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

console.log("update-check ok");
