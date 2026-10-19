/*
 * 从 tools/xlsx-words.json 重建 words.js（一次性使用，不参与网页运行）。
 *
 * 数据来源：
 *   - tools/xlsx-words.json  Excel 词表（list / number / word / part / meaning / 音标兜底）
 *   - tools/phonetics.json   有道抓取的美式 / 英式音标（可缺省）
 *   - tools/details.json     双语例句、常用搭配、同义词（可缺省）
 *
 * 抓取脚本读取 words.js 里的单词，所以先跑一次本脚本生成基础词表，
 * 再运行 fetch-phonetics.js / fetch-details.js，最后再跑一次本脚本合并。
 *
 * 用法：
 *   node tools/build-words.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { parseAssignment } = require("./words-file");

const projectDir = path.resolve(__dirname, "..");
const wordsFile = path.join(projectDir, "words.js");
const xlsxFile = path.join(__dirname, "xlsx-words.json");
const phoneticsFile = path.join(__dirname, "phonetics.json");
const detailsFile = path.join(__dirname, "details.json");
const header = "window.CET4_WORDS = ";
const detailHeader = "window.CET4_WORD_DETAILS = ";
const detailMarker = "// 按单词存放的例句、常用搭配和同义词，供词条详情展开使用。\n";

const indent = "  ";
const blankLine = indent;

function readJson(file, fallback) {
  if (!fs.existsSync(file)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const baseWords = readJson(xlsxFile, null);
if (!Array.isArray(baseWords) || baseWords.length === 0) {
  throw new Error(`缺少词表数据：${xlsxFile}，请先运行 python tools/import-xlsx.py`);
}
const phonetics = readJson(phoneticsFile, {});
const details = readJson(detailsFile, {});

function serializeEntries(entries) {
  return entries
    .map((entry) => {
      const lines = Object.entries(entry).map(
        ([key, value], index, all) =>
          `${indent}${indent}${JSON.stringify(key)}: ${JSON.stringify(value)}${
            index === all.length - 1 ? "" : ","
          }`,
      );
      return [`${indent}{`, ...lines, `${indent}}`].join("\n");
    })
    .join(`,\n${blankLine}\n`);
}

const words = baseWords.map((entry) => {
  const fetched = phonetics[entry.word] || {};
  const us = fetched.us || entry.usphone || "";
  const uk = fetched.uk || entry.ukphone || entry.usphone || "";
  const next = {
    list: entry.list,
    number: entry.number,
    word: entry.word,
    part: entry.part,
    meaning: entry.meaning,
  };
  if (us) {
    next.usphone = us;
  }
  if (uk) {
    next.ukphone = uk;
  }
  return next;
});

// 按单词建立语料表，只保留新词表里实际出现的单词。
const detailKeys = ["sentences", "phrases", "synonyms"];
const detailTable = {};
const seen = new Set();
words.forEach((entry) => {
  if (seen.has(entry.word)) {
    return;
  }
  seen.add(entry.word);
  const source = details[entry.word] || {};
  if (source.error) {
    return;
  }
  const item = {};
  detailKeys.forEach((key) => {
    const value = source[key];
    if (Array.isArray(value) && value.length > 0) {
      item[key] = value;
    }
  });
  if (Object.keys(item).length > 0) {
    detailTable[entry.word] = item;
  }
});

const sortedDetailKeys = Object.keys(detailTable).sort();
const detailBody = sortedDetailKeys
  .map((word) => {
    const inner = Object.entries(detailTable[word])
      .map(
        ([key, value], index, all) =>
          `${indent}${indent}${indent}${JSON.stringify(key)}: ${JSON.stringify(value)}${
            index === all.length - 1 ? "" : ","
          }`,
      )
      .join("\n");
    return `${indent}${indent}${JSON.stringify(word)}: {\n${inner}\n${indent}${indent}}`;
  })
  .join(`,\n${blankLine}\n`);

const output =
  `${header}[\n${serializeEntries(words)}\n];\n\n` +
  detailMarker +
  `${detailHeader}{\n${detailBody}\n};\n`;

// 写回前校验：分段解析，确认词条数量、字段、音标和语料都完整。
const splitAt = output.indexOf(detailMarker);
if (splitAt === -1) {
  throw new Error("生成的输出缺少语料表标记，已中止写入");
}
const verifyWords = parseAssignment(output.slice(0, splitAt), "CET4_WORDS");
const verifyDetails = parseAssignment(
  output.slice(splitAt + detailMarker.length),
  "CET4_WORD_DETAILS",
);
if (verifyWords.length !== baseWords.length) {
  throw new Error(`词条数量不一致：${baseWords.length} -> ${verifyWords.length}`);
}
if (
  verifyWords.some(
    (entry) =>
      !entry.word ||
      !entry.part ||
      !entry.meaning ||
      !entry.list ||
      !entry.number,
  )
) {
  throw new Error("存在字段缺失的词条，已中止写入");
}

const withUs = verifyWords.filter((entry) => entry.usphone).length;
const withUk = verifyWords.filter((entry) => entry.ukphone).length;
const withSentences = Object.values(verifyDetails).filter((item) => item.sentences).length;
const withPhrases = Object.values(verifyDetails).filter((item) => item.phrases).length;
const withSynonyms = Object.values(verifyDetails).filter((item) => item.synonyms).length;

fs.writeFileSync(wordsFile, output, "utf8");

console.log(`写入 ${wordsFile}`);
console.log(
  `词条 ${verifyWords.length} 条 | 美音音标 ${withUs} 条 | 英音音标 ${withUk} 条`,
);
console.log(
  `语料表 ${sortedDetailKeys.length} 个单词 | 含例句 ${withSentences} | 含搭配 ${withPhrases} | 含同义词 ${withSynonyms}`,
);
console.log(`文件大小 ${(Buffer.byteLength(output, "utf8") / 1024).toFixed(0)} KB`);

const missingPhonetic = [...new Set(
  verifyWords.filter((entry) => !entry.usphone && !entry.ukphone).map((entry) => entry.word),
)];
if (missingPhonetic.length) {
  console.log(`无音标 ${missingPhonetic.length} 个：${missingPhonetic.join(", ")}`);
}
const uniqueWords = [...new Set(verifyWords.map((entry) => entry.word))];
const missingDetail = uniqueWords.filter((word) => !verifyDetails[word]);
if (missingDetail.length) {
  console.log(`无语料 ${missingDetail.length} 个：${missingDetail.slice(0, 30).join(", ")}${missingDetail.length > 30 ? " …" : ""}`);
}
