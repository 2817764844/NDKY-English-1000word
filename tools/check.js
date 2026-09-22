"use strict";
/*
 * 数据自检脚本（可选，不参与网页运行）。
 *
 * 用途：改完 words.js 或 index.html 后跑一次，确认没有改坏：
 *   - words.js 是否仍是合法数据、词条数量与字段是否完整、音标是否齐全
 *   - 语料表（例句/搭配/同义词）是否覆盖到每个唯一单词
 *   - index.html 标签是否闭合、id 是否重复
 *
 * 用法：
 *   node tools/check.js
 */
const fs = require("fs");
const path = require("path");
const dir = path.resolve(__dirname, "..") + path.sep;

const DETAIL_MARKER = "// 按单词存放的例句、常用搭配和同义词，供词条详情展开使用。";

function parseAssignment(source, name) {
  const json = source
    .replace(new RegExp(`^[\\s\\S]*?window\\.${name}\\s*=\\s*`), "")
    .replace(/;\s*$/, "");
  return JSON.parse(json);
}

function checkWords() {
  const source = fs.readFileSync(dir + "words.js", "utf8");
  const splitAt = source.indexOf(DETAIL_MARKER);
  const wordsPart = splitAt === -1 ? source : source.slice(0, splitAt);
  const detailPart = splitAt === -1 ? null : source.slice(splitAt + DETAIL_MARKER.length);

  const lines = [];
  let words;
  try {
    words = parseAssignment(wordsPart, "CET4_WORDS");
  } catch (error) {
    return `words.js 解析失败: ${error.message}`;
  }

  const withUs = words.filter((w) => w.usphone).length;
  const withUk = words.filter((w) => w.ukphone).length;
  const keys = [...new Set(words.flatMap((w) => Object.keys(w)))];
  const badShape = words.filter((w) => !w.word || !w.part || !w.meaning || !w.list || !w.number);

  lines.push(`words.js OK: ${words.length} 条词目`);
  lines.push(`字段: ${keys.join(", ")}`);
  lines.push(`含美音音标 ${withUs} 条 / 含英音音标 ${withUk} 条`);
  lines.push(`字段缺失 ${badShape.length} 条`);
  lines.push(`示例: ${JSON.stringify(words[0])}`);

  if (!detailPart) {
    lines.push("未找到语料表（CET4_WORD_DETAILS）");
    return lines.join("\n  ");
  }

  let details;
  try {
    details = parseAssignment(detailPart, "CET4_WORD_DETAILS");
  } catch (error) {
    lines.push(`语料表解析失败: ${error.message}`);
    return lines.join("\n  ");
  }

  const uniqueWords = [...new Set(words.map((w) => w.word))];
  const detailKeys = Object.keys(details);
  const covered = uniqueWords.filter((w) => details[w]);
  const noDetail = uniqueWords.filter((w) => !details[w]);
  const orphan = detailKeys.filter((key) => !uniqueWords.includes(key));
  const count = (key) => detailKeys.filter((k) => details[k][key]).length;
  const badSentence = detailKeys.filter((k) =>
    (details[k].sentences || []).some((s) => !s.en || !s.cn),
  );

  lines.push(
    `语料表 ${detailKeys.length} 个单词 | 含例句 ${count("sentences")} | 含搭配 ${count("phrases")} | 含同义词 ${count("synonyms")}`,
  );
  lines.push(`唯一单词 ${uniqueWords.length} 个，已覆盖 ${covered.length} 个，缺失 ${noDetail.length} 个`);
  if (noDetail.length) {
    lines.push(`  缺语料: ${noDetail.slice(0, 12).join(", ")}${noDetail.length > 12 ? " …" : ""}`);
  }
  if (orphan.length) {
    lines.push(`  语料表里存在词库中没有的词: ${orphan.join(", ")}`);
  }
  if (badSentence.length) {
    lines.push(`  例句缺少英文或中文: ${badSentence.slice(0, 8).join(", ")}`);
  }
  const size = (fs.statSync(dir + "words.js").size / 1024).toFixed(0);
  lines.push(`words.js 体积: ${size} KB`);
  return lines.join("\n  ");
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
