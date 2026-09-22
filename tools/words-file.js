/*
 * 共享工具（仅开发期脚本使用，不参与网页运行）。
 *
 * words.js 现在同时包含两个赋值语句：
 *   window.CET4_WORDS = [ ... ];
 *   window.CET4_WORD_DETAILS = { ... };
 * 直接整体 JSON.parse 会失败，所以这里统一按标记切分后分别解析。
 */

"use strict";

const fs = require("fs");

const WORDS_NAME = "CET4_WORDS";
const DETAILS_NAME = "CET4_WORD_DETAILS";
const DETAILS_MARKER = "// 按单词存放的例句、常用搭配和同义词，供词条详情展开使用。";

function parseAssignment(source, name) {
  const json = source
    .replace(new RegExp(`^[\\s\\S]*?window\\.${name}\\s*=\\s*`), "")
    .replace(/;\s*$/, "");
  return JSON.parse(json);
}

// 返回 { words, details }；details 在文件还没有语料表时为 {}。
function readWordsFile(file) {
  const source = fs.readFileSync(file, "utf8");
  const splitAt = source.indexOf(DETAILS_MARKER);
  const wordsPart = splitAt === -1 ? source : source.slice(0, splitAt);
  const words = parseAssignment(wordsPart, WORDS_NAME);
  const details = splitAt === -1 ? {} : parseAssignment(source.slice(splitAt + DETAILS_MARKER.length), DETAILS_NAME);
  return { words, details };
}

// 词库里出现过的唯一单词，已排序。
function readHeadwords(file) {
  const { words } = readWordsFile(file);
  return [...new Set(words.map((item) => item.word))].sort();
}

module.exports = {
  WORDS_NAME,
  DETAILS_NAME,
  DETAILS_MARKER,
  parseAssignment,
  readWordsFile,
  readHeadwords,
};
