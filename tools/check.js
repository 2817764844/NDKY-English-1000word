"use strict";
/*
 * 数据自检脚本（可选，不参与网页运行）。
 *
 * 用途：改完 words.js 或 index.html 后跑一次，确认没有改坏：
 *   - words.js 是否仍是合法数据、词条数量与字段是否完整、音标是否齐全
 *   - index.html 标签是否闭合、id 是否重复
 *
 * 用法：
 *   node tools/check.js
 */
const fs = require("fs");
const path = require("path");
const dir = path.resolve(__dirname, "..") + path.sep;

function checkWords() {
  const source = fs.readFileSync(dir + "words.js", "utf8");
  const json = source
    .replace(/^\s*window\.CET4_WORDS\s*=\s*/, "")
    .replace(/;\s*$/, "");
  let words;
  try {
    words = JSON.parse(json);
  } catch (error) {
    return `words.js 解析失败: ${error.message}`;
  }
  const withUs = words.filter((w) => w.usphone).length;
  const withUk = words.filter((w) => w.ukphone).length;
  const keys = [...new Set(words.flatMap((w) => Object.keys(w)))];
  const badShape = words.filter((w) => !w.word || !w.part || !w.meaning || !w.list || !w.number);
  return [
    `words.js OK: ${words.length} 条`,
    `字段: ${keys.join(", ")}`,
    `含美音音标 ${withUs} 条 / 含英音音标 ${withUk} 条`,
    `字段缺失 ${badShape.length} 条`,
    `示例: ${JSON.stringify(words[0])}`,
    `末条: ${JSON.stringify(words[words.length - 1])}`,
  ].join("\n  ");
}

function checkHtml() {
  const html = fs.readFileSync(dir + "index.html", "utf8");
  const voidTags = new Set([
    "meta", "link", "br", "hr", "img", "input", "path", "circle",
    "source", "area", "base", "col", "embed", "track", "wbr",
  ]);
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  const stack = [];
  let match;
  while ((match = re.exec(html))) {
    const close = match[1];
    const tag = match[2].toLowerCase();
    const selfClose = match[4];
    if (voidTags.has(tag) || selfClose) continue;
    if (close) {
      const top = stack.pop();
      if (top !== tag) {
        return `index.html 标签不匹配: </${tag}> 对应 <${top}> (偏移 ${match.index})`;
      }
    } else {
      stack.push(tag);
    }
  }
  if (stack.length) return `index.html 未闭合: ${stack.join(", ")}`;
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
  return `index.html 标签闭合 OK，id 共 ${ids.length} 个${dupIds.length ? `，重复 id: ${dupIds.join(",")}` : "，无重复"}`;
}

console.log("  " + checkWords());
console.log("  " + checkHtml());
