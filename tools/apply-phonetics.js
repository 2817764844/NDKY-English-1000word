/*
 * 音标合并脚本（一次性使用，不参与网页运行）。
 *
 * 用途：把 tools/phonetics.json 里的音标写入 words.js 的每个词条，
 *       为每个词条追加 usphone（美音）和 ukphone（英音）字段。
 *
 * 用法：
 *   node tools/apply-phonetics.js
 *
 * 实现说明：先把 words.js 解析成对象数组，追加字段后整体重新序列化，
 *           避免逐行拼接带来的缩进与逗号问题。写入结果保持严格 JSON，
 *           因此在浏览器中依然是合法的 JS 赋值语句。
 */

"use strict";

const fs = require("fs");
const path = require("path");

const projectDir = path.resolve(__dirname, "..");
const wordsFile = path.join(projectDir, "words.js");
const phoneticsFile = path.join(__dirname, "phonetics.json");
const header = "window.CET4_WORDS = ";

function parseWords(source) {
  const json = source
    .replace(/^\s*window\.CET4_WORDS\s*=\s*/, "")
    .replace(/;\s*$/, "");
  return JSON.parse(json);
}

const source = fs.readFileSync(wordsFile, "utf8");
const words = parseWords(source);
const store = JSON.parse(fs.readFileSync(phoneticsFile, "utf8"));

const missing = [];
let withUs = 0;
let withUk = 0;

const updated = words.map((entry) => {
  const phonetic = store[entry.word] || {};
  const next = {
    list: entry.list,
    number: entry.number,
    word: entry.word,
    part: entry.part,
    meaning: entry.meaning,
  };
  if (phonetic.us) {
    next.usphone = phonetic.us;
    withUs += 1;
  }
  if (phonetic.uk) {
    next.ukphone = phonetic.uk;
    withUk += 1;
  }
  if (!phonetic.us && !phonetic.uk) {
    missing.push(entry.word);
  }
  return next;
});

const indent = "  ";
const body = updated
  .map((entry) => {
    const lines = Object.entries(entry).map(
      ([key, value], index, all) =>
        `${indent}${indent}${JSON.stringify(key)}: ${JSON.stringify(value)}${
          index === all.length - 1 ? "" : ","
        }`,
    );
    return [`${indent}{`, ...lines, `${indent}}`].join("\n");
  })
  .join(",\n");

const output = `${header}[\n${body}\n];\n`;

// 写回前先确认新内容可被严格解析，避免破坏数据文件。
const verify = parseWords(output);
if (verify.length !== words.length) {
  throw new Error(`词条数量不一致：${words.length} -> ${verify.length}`);
}
if (verify.some((entry) => !entry.word || !entry.part || !entry.meaning)) {
  throw new Error("存在字段缺失的词条，已中止写入");
}

fs.writeFileSync(wordsFile, output, "utf8");

console.log(`共写入 ${updated.length} 条词目`);
console.log(`含美音音标 ${withUs} 条，含英音音标 ${withUk} 条`);
if (missing.length) {
  console.log(`无音标 ${missing.length} 条：${[...new Set(missing)].join(", ")}`);
}
