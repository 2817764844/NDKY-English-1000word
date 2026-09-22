/*
 * 音标数据生成脚本（一次性使用，不参与网页运行）。
 *
 * 用途：从有道词典公开接口批量获取美式/英式音标，写入 phonetics.json。
 * 网页端只读取 words.js 中已经内联好的音标字段，运行时不会调用本脚本。
 *
 * 用法：
 *   node tools/fetch-phonetics.js            # 抓取缺失的词，写入 phonetics.json
 *   node tools/fetch-phonetics.js --force    # 忽略已有结果，全部重新抓取
 *
 * 说明：脚本只抓取「唯一」单词（当前词表 1000 条里只有 190 个不重复单词）。
 */

"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { readHeadwords } = require("./words-file");

const projectDir = path.resolve(__dirname, "..");
const wordsFile = path.join(projectDir, "words.js");
const outputFile = path.join(__dirname, "phonetics.json");
const force = process.argv.includes("--force");
const concurrency = 4;
const maxRetries = 3;

function request(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(20000, () => {
      req.destroy(new Error("timeout"));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPhonetic(word) {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const body = await request(
        `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`,
      );
      const data = JSON.parse(body);
      const simple = (data.simple && data.simple.word && data.simple.word[0]) || {};
      const ec = (data.ec && data.ec.word && data.ec.word[0]) || {};
      const us = simple.usphone || ec.usphone || "";
      const uk = simple.ukphone || ec.ukphone || "";
      if (us || uk) {
        return { us, uk };
      }
      if (Array.isArray(data.ec && data.ec.exam_type) || data.ec) {
        // 接口返回正常但没有音标字段，视为该词无音标数据。
        return { us: "", uk: "" };
      }
      throw new Error("unexpected payload");
    } catch (error) {
      if (attempt === maxRetries) {
        return { error: error.message };
      }
      await sleep(700 * attempt);
    }
  }
  return { error: "unknown" };
}

async function main() {
  const headwords = readHeadwords(wordsFile);
  let store = {};
  if (!force && fs.existsSync(outputFile)) {
    store = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  }

  const pending = headwords.filter(
    (word) => force || !store[word] || store[word].error,
  );
  console.log(
    `唯一单词 ${headwords.length} 个，待抓取 ${pending.length} 个，并发 ${concurrency}`,
  );

  let cursor = 0;
  let done = 0;
  async function worker(id) {
    while (cursor < pending.length) {
      const word = pending[cursor];
      cursor += 1;
      const result = await fetchPhonetic(word);
      store[word] = result;
      done += 1;
      const label = result.error ? `ERROR ${result.error}` : `${result.us} / ${result.uk}`;
      console.log(`[${String(done).padStart(3)}/${pending.length}] ${word.padEnd(14)} ${label}`);
      if (done % 20 === 0) {
        fs.writeFileSync(outputFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
      }
      await sleep(120);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, pending.length || 1) }, (_, index) =>
      worker(index + 1),
    ),
  );

  const sorted = {};
  Object.keys(store)
    .sort()
    .forEach((key) => {
      sorted[key] = store[key];
    });
  fs.writeFileSync(outputFile, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");

  const failed = Object.entries(sorted).filter(([, value]) => value.error);
  const empty = Object.entries(sorted).filter(([, value]) => !value.error && !value.us && !value.uk);
  console.log(`\n写入 ${outputFile}`);
  console.log(`成功 ${Object.keys(sorted).length - failed.length - empty.length} 个`);
  if (empty.length) console.log(`无音标字段 ${empty.length} 个：${empty.map(([w]) => w).join(", ")}`);
  if (failed.length) console.log(`失败 ${failed.length} 个：${failed.map(([w]) => w).join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
