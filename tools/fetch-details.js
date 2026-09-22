/*
 * 例句 / 搭配 / 同义词抓取脚本（一次性使用，不参与网页运行）。
 *
 * 用途：从有道词典公开接口为每个唯一单词抓取
 *       - 双语例句（英文 + 中文）
 *       - 常用词组搭配
 *       - 同义词（按词性分组）
 *       写入 tools/details.json，再由 apply-details.js 合并进 words.js。
 *
 * 用法：
 *   node tools/fetch-details.js            # 增量抓取（已有结果会跳过）
 *   node tools/fetch-details.js --force    # 全部重新抓取
 *
 * 说明：只抓取去重后的单词（当前词库 1000 条中仅 190 个不重复单词），需要联网。
 */

"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { readHeadwords } = require("./words-file");

const projectDir = path.resolve(__dirname, "..");
const wordsFile = path.join(projectDir, "words.js");
const outputFile = path.join(__dirname, "details.json");
const force = process.argv.includes("--force");
const concurrency = 4;
const maxRetries = 3;
// 单词语料上限，避免数据文件过大。
const limits = { sentences: 3, phrases: 6, synonyms: 3 };

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

// 去掉接口返回里的 <b> 高亮标签和 HTML 实体，并压缩空白。
function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// 有道把单值字段包成 { l: { i: "..." } }，数组时包成 { l: [{ i }] }。
function readL(node) {
  if (!node || !node.l) {
    return "";
  }
  if (typeof node.l === "string") {
    return node.l;
  }
  if (Array.isArray(node.l)) {
    return node.l.map((item) => cleanText(item && item.i)).filter(Boolean).join("；");
  }
  return cleanText(node.l.i);
}

function extractSentences(data) {
  const pairs = (data.blng_sents_part || {})["sentence-pair"] || [];
  return pairs
    .map((pair) => ({
      en: cleanText(pair["sentence-eng"] || pair.sentence),
      cn: cleanText(pair["sentence-translation"]),
    }))
    .filter((item) => item.en && item.cn)
    .slice(0, limits.sentences);
}

function extractPhrases(data) {
  const list = (data.phrs || {}).phrs || [];
  return list
    .map((item) => {
      const phr = item.phr || {};
      const translations = (phr.trs || []).map((t) => readL(t.tr)).filter(Boolean);
      return { en: readL(phr.headword), cn: translations.join("；") };
    })
    .filter((item) => item.en && item.cn)
    // 过滤掉没有空格的碎片（如 "hesitate in"），它们不是可用的搭配。
    .filter((item) => item.en.includes(" "))
    .slice(0, limits.phrases);
}

function extractSynonyms(data) {
  const list = (data.syno || {}).synos || [];
  const seenWordSets = new Set();
  return list
    .map((item) => {
      const syno = item.syno || {};
      return {
        pos: cleanText(syno.pos),
        words: (syno.ws || []).map((w) => cleanText(w.w)).filter(Boolean),
        cn: cleanText(syno.tran),
      };
    })
    .filter((item) => item.words.length)
    // 接口偶尔会在不同词性下返回完全相同的词集，去重避免重复展示。
    .filter((item) => {
      const key = [...item.words].sort().join(",");
      if (seenWordSets.has(key)) {
        return false;
      }
      seenWordSets.add(key);
      return true;
    })
    .slice(0, limits.synonyms);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchDetail(word) {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const body = await request(
        `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`,
      );
      const data = JSON.parse(body);
      return {
        sentences: extractSentences(data),
        phrases: extractPhrases(data),
        synonyms: extractSynonyms(data),
      };
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

  const pending = headwords.filter((word) => force || !store[word] || store[word].error);
  console.log(`唯一单词 ${headwords.length} 个，待抓取 ${pending.length} 个，并发 ${concurrency}`);

  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < pending.length) {
      const word = pending[cursor];
      cursor += 1;
      const result = await fetchDetail(word);
      store[word] = result;
      done += 1;
      const summary = result.error
        ? `ERROR ${result.error}`
        : `例句 ${result.sentences.length} / 搭配 ${result.phrases.length} / 同义 ${result.synonyms.length}`;
      console.log(`[${String(done).padStart(3)}/${pending.length}] ${word.padEnd(14)} ${summary}`);
      if (done % 20 === 0) {
        fs.writeFileSync(outputFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
      }
      await sleep(120);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, pending.length || 1) }, () => worker()),
  );

  const sorted = {};
  Object.keys(store)
    .sort()
    .forEach((key) => {
      sorted[key] = store[key];
    });
  fs.writeFileSync(outputFile, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");

  const failed = Object.entries(sorted).filter(([, v]) => v.error);
  const noSentence = Object.entries(sorted).filter(
    ([, v]) => !v.error && (!v.sentences || v.sentences.length === 0),
  );
  const all = Object.values(sorted).filter((v) => !v.error);
  const avg = (key) =>
    all.length ? (all.reduce((sum, v) => sum + (v[key] || []).length, 0) / all.length).toFixed(2) : "0";

  console.log(`\n写入 ${outputFile}`);
  console.log(`成功 ${all.length} 个 | 平均例句 ${avg("sentences")} 条、搭配 ${avg("phrases")} 条、同义词 ${avg("synonyms")} 组`);
  if (noSentence.length) {
    console.log(`无例句 ${noSentence.length} 个：${noSentence.map(([w]) => w).join(", ")}`);
  }
  if (failed.length) {
    console.log(`失败 ${failed.length} 个：${failed.map(([w]) => w).join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
