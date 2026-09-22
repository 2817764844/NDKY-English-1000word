/*
 * 音标 + 语料合并脚本（一次性使用，不参与网页运行）。
 *
 * 用途：读取 tools/phonetics.json 和 tools/details.json，重建 words.js：
 *       - 每条词目内联 usphone / ukphone（保持原有结构不变）
 *       - 新增 window.CET4_WORD_DETAILS 查表，按「单词」存放例句、搭配、同义词
 *
 * 为什么语料要单独建表：1000 条词目只有 190 个不重复单词，若把例句内联到每条，
 * 同一份语料会重复约 5 次，文件会从约 170KB 涨到约 800KB。查表方式只需约 120KB。
 *
 * 用法：
 *   node tools/apply-details.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { parseAssignment, readWordsFile } = require("./words-file");

const projectDir = path.resolve(__dirname, "..");
const wordsFile = path.join(projectDir, "words.js");
const phoneticsFile = path.join(__dirname, "phonetics.json");
const detailsFile = path.join(__dirname, "details.json");
const header = "window.CET4_WORDS = ";
const detailHeader = "window.CET4_WORD_DETAILS = ";

// 允许重复运行：words.js 可能已经含语料表，这里统一由共享模块切分解析。
const { words: baseWords } = readWordsFile(wordsFile);
const phonetics = JSON.parse(fs.readFileSync(phoneticsFile, "utf8"));
const details = JSON.parse(fs.readFileSync(detailsFile, "utf8"));

const indent = "  ";
// 空行用两个空格填充，与原文件风格保持一致。
const blankLine = indent;

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

const missingPhonetic = [];
const words = baseWords.map((entry) => {
  const phonetic = phonetics[entry.word] || {};
  const next = {
    list: entry.list,
    number: entry.number,
    word: entry.word,
    part: entry.part,
    meaning: entry.meaning,
  };
  if (phonetic.us) {
    next.usphone = phonetic.us;
  }
  if (phonetic.uk) {
    next.ukphone = phonetic.uk;
  }
  if (!phonetic.us && !phonetic.uk) {
    missingPhonetic.push(entry.word);
  }
  return next;
});

// 按单词建立语料表，跳过没有内容的词。
const detailKeys = ["sentences", "phrases", "synonyms"];
const detailTable = {};
const missingDetail = [];
const seen = new Set();
words.forEach((entry) => {
  if (seen.has(entry.word)) {
    return;
  }
  seen.add(entry.word);
  const source = details[entry.word] || {};
  const item = {};
  detailKeys.forEach((key) => {
    const value = source[key];
    if (Array.isArray(value) && value.length > 0) {
      item[key] = value;
    }
  });
  if (Object.keys(item).length === 0) {
    missingDetail.push(entry.word);
    return;
  }
  detailTable[entry.word] = item;
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
  `// 按单词存放的例句、常用搭配和同义词，供词条详情展开使用。\n` +
  `${detailHeader}{\n${detailBody}\n};\n`;

// 写回前校验，避免破坏数据文件。
// 注意：输出里同时含 CET4_WORDS 数组和 CET4_WORD_DETAILS 对象，必须分段解析。
const detailMarker = `// 按单词存放的例句、常用搭配和同义词，供词条详情展开使用。\n`;
const splitAt = output.indexOf(detailMarker);
if (splitAt === -1) {
  throw new Error("生成的输出缺少语料表标记，已中止写入");
}const verifyWords = parseAssignment(output.slice(0, splitAt), "CET4_WORDS");
const verifyDetails = parseAssignment(output.slice(splitAt + detailMarker.length), "CET4_WORD_DETAILS");
if (verifyWords.length !== baseWords.length) {
  throw new Error(`词条数量不一致：${baseWords.length} -> ${verifyWords.length}`);
}
if (
  verifyWords.some(
    (entry) => !entry.word || !entry.part || !entry.meaning || !entry.list || !entry.number,
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
console.log(`词条 ${verifyWords.length} 条 | 美音音标 ${withUs} 条 | 英音音标 ${withUk} 条`);
console.log(
  `语料表 ${sortedDetailKeys.length} 个单词 | 含例句 ${withSentences} | 含搭配 ${withPhrases} | 含同义词 ${withSynonyms}`,
);
console.log(`文件大小 ${(Buffer.byteLength(output, "utf8") / 1024).toFixed(0)} KB`);
if (missingPhonetic.length) {
  console.log(`无音标 ${missingPhonetic.length} 条：${[...new Set(missingPhonetic)].join(", ")}`);
}
if (missingDetail.length) {
  console.log(`无语料 ${missingDetail.length} 个：${missingDetail.join(", ")}`);
}
