# CET-4 核心词汇 1000

一个无需后端、开箱即用的大学英语四级核心词汇浏览网页。项目把 1000 个词条整理为 10 个 List，支持搜索、词性筛选、收藏、练习模式、真人发音和例句搭配展开，适合用于日常背词、快速查词和自测。

<p align="center">
  <img src="./docs/preview-desktop.png" alt="桌面端预览" width="820">
</p>

<p align="center">
  <img src="./docs/preview-mobile.png" alt="移动端预览" width="260">
</p>

## 功能

| 功能 | 说明 |
| --- | --- |
| 分 List 浏览 | 可在全部词汇和 List 1-10 之间快速切换 |
| 中英文搜索 | 可搜索英文单词、中文释义或序号 |
| 词性筛选 | 支持名词、动词、形容词、副词等词性分类 |
| 真人发音 | 每个词条都有美式/英式真人录音，点击喇叭按钮即可朗读 |
| 音标显示 | 1000 个词条全部带 IPA 音标，随美音/英音切换 |
| 例句搭配 | 每个词条可展开同义词、常用搭配和双语例句，例句也能点读 |
| 收藏生词 | 使用本地浏览器存储收藏状态，无需登录 |
| 练习模式 | 可独立遮住英文单词或中文释义，点击词条逐条查看 |
| 听音辨词 | 遮住单词后朗读按钮仍然可用，可配合「点击即读」做听写练习 |
| 响应式布局 | 同时适配电脑、平板和手机 |
| 无需构建 | 原生 HTML、CSS 和 JavaScript，下载即用 |

> **关于「1000 词」**：这 1000 条词目实际由 190 个不重复单词构成，多数单词会在不同 List 里重复出现，且**每个词条的释义对应不同语境**。例如 `adopt` 分别出现为「采纳；收养」「领养；采纳意见」「采纳方案」「采纳建议」。所以「展开例句」不是附加装饰，而是理解这些差异的关键——同一条语料会同时服务于该单词的所有词条。

## 发音功能说明

- **真人音频**：音频取自有道词典的公开发音接口，按美式/英式分别请求，不是机器合成音。
- **需要联网**：播放发音时才会下载对应音频，**其余功能（浏览、搜索、筛选、收藏、练习模式、例句文字）完全离线可用**。
- **按需加载**：只有滚动到视口附近的词条才会预取音频，不会一次性请求 1000 个文件；已播放过的音频会在内存中缓存，重复点击不再请求。
- **口音切换**：右下角「英语发音」区域的按钮可在美音（US）和英音（UK）之间切换，音标和朗读都会同步切换，选择会记在本机浏览器中。
- **点击即读**：开启后点击词条任意位置即可朗读。
- **整句朗读**：常用搭配和例句都可以点击朗读（接口同样支持整句）。
- **自动降级**：在线音频加载失败时会自动改用浏览器内置语音朗读，并给出提示。

> 首次直接双击 `index.html` 打开时，部分浏览器会限制本地文件联网，导致发音无法播放。此时请改用本地服务器打开（见下文）。

## 例句搭配说明

点击释义右侧的 `⌄` 按钮即可展开该词条的语料：

- **同义词**：按词性分组，帮助建立词义网络。
- **常用搭配**：如 `search and rescue = 搜索与营救`，比孤立背单词更实用。
- **例句**：英文 + 中文对照，可用于体会语境和用法。

右下角「例句搭配」区域提供两个开关：

- **展开例句**：一次性展开所有词条（适合集中阅读，词条较多时页面会很长）。
- **全部收起**：一键收起所有已展开的词条。

语料按「单词」存放（见下文数据格式），所以同一个单词的不同词条显示的是同一份语料，这正是用来对照它们释义差异的依据。

## 直接使用

下载项目后，直接打开以下文件即可：

```text
网页版单词表/index.html
```

Windows 也可以在项目根目录执行：

```powershell
start .\网页版单词表\index.html
```

如果希望通过本地服务器访问（推荐，发音功能更稳定）：

```bash
python -m http.server 8000 --directory 网页版单词表
```

然后访问：

```text
http://localhost:8000
```

## 项目结构

```text
EnglishWord/
├── README.md
├── docs/
│   ├── preview-desktop.png
│   └── preview-mobile.png
├── 网页版单词表/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── words.js
│   └── tools/
│       ├── words-file.js        # 共享：解析含两个赋值语句的 words.js
│       ├── fetch-phonetics.js   # 抓取音标（一次性，不参与运行）
│       ├── phonetics.json       # 音标原始数据
│       ├── apply-phonetics.js   # 单独合并音标（可选）
│       ├── fetch-details.js     # 抓取例句/搭配/同义词（一次性）
│       ├── details.json         # 语料原始数据
│       ├── apply-details.js     # 合并音标 + 语料，重建 words.js
│       └── check.js             # 数据自检（可选）
├── 分List单词表/
│   ├── 大学英语四级核心词汇_List01_1-100.docx
│   ├── 大学英语四级核心词汇_List02_101-200.docx
│   └── ...
└── 大学英语四级核心词汇1000.docx
```

## 数据格式

网页数据保存在 `网页版单词表/words.js`，包含两个赋值语句。

第一个是词条数组，共 1000 条：

```javascript
window.CET4_WORDS = [
  {
    "list": 1,
    "number": 1,
    "word": "hesitate",
    "part": "vi",
    "meaning": "犹豫，迟疑",
    "usphone": "ˈhezɪteɪt",
    "ukphone": "ˈhezɪteɪt",
  },
  // ...
];
```

- `usphone`：美式音标，用于「美音」模式显示。
- `ukphone`：英式音标，用于「英音」模式显示。
- 两个字段都可以留空，此时音标位置显示 `—`，发音功能不受影响。

第二个是按「单词」存放的语料表：

```javascript
window.CET4_WORD_DETAILS = {
  "hesitate": {
    "sentences": [{ "en": "I hesitate in this work.", "cn": "我对这项工作有所犹豫。" }],
    "phrases": [{ "en": "don't hesitate", "cn": "别再犹豫了" }],
    "synonyms": [{ "pos": "vi.", "words": ["vacillate"], "cn": "踌躇，犹豫" }],
  },
  // ...
};
```

- `sentences`：双语例句，点击可朗读。
- `phrases`：常用搭配，点击可朗读。
- `synonyms`：按词性分组的同义词。
- 三个字段都可以缺省，缺省的区块不会显示，展开按钮也会自动隐藏。

**为什么语料要单独建表**：1000 条词目只对应 190 个不重复单词，若把语料内联到每条词目，同一份内容会重复约 5 次，文件会从约 170KB 涨到约 800KB。查表方式只需约 120KB。

修改或替换这两个结构，即可使用自己的词库。

### 重新生成音标与语料

音标和语料都是预先抓取好写进 `words.js` 的，网页运行时不查询这些接口。如果替换了词库，可以重新生成：

```bash
cd 网页版单词表
node tools/fetch-phonetics.js   # 抓取缺失单词的音标 -> tools/phonetics.json
node tools/fetch-details.js     # 抓取例句/搭配/同义词 -> tools/details.json
node tools/apply-details.js     # 合并进 words.js（可重复运行）
```

- 两个抓取脚本都只处理去重后的单词（当前词库 1000 条中有 190 个不重复单词），需要联网。
- 两个抓取脚本都支持增量运行，加了 `--force` 可强制全部重抓。
- `apply-details.js` 可重复运行，不会重复叠加数据。

改完数据后可以跑一次自检（检查词条完整性、音标与语料覆盖、HTML 标签闭合）：

```bash
node tools/check.js
```

## 发布到 GitHub

在项目根目录执行：

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/你的用户名/你的仓库名.git
git push -u origin main
```

仓库上传后，在 GitHub 页面打开：

```text
Settings -> Pages -> Build and deployment -> Source
```

选择 `GitHub Actions`，然后添加以下工作流文件：

```text
.github/workflows/deploy-pages.yml
```

工作流内容：

```yaml
name: Deploy static site to Pages

on:
  push:
    branches: ["main"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Pages
        uses: actions/configure-pages@v5

      - name: Upload site
        uses: actions/upload-pages-artifact@v3
        with:
          path: "./网页版单词表"

      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
```

推送后等待 Actions 执行完成，即可通过 GitHub Pages 提供的网址访问。

## 自定义

- 修改 `网页版单词表/styles.css` 中的 `:root` 变量可调整配色和视觉样式，单词表的列宽也在这里（`--col-*` 变量，窄屏会在媒体查询中覆写）。
- 修改 `网页版单词表/app.js` 可调整筛选、收藏、练习模式、发音和例句展开逻辑。
- 修改 `网页版单词表/words.js` 可替换或扩充词汇数据（含音标与语料）。
- 收藏记录保存在浏览器的 `cet4-favorites` 本地存储项中。
- 发音口音保存在 `cet4-accent`，点击即读开关保存在 `cet4-auto-speak`，全局展开例句开关保存在 `cet4-detail`。
- 音频接口地址在 `app.js` 顶部的 `audioBase` 常量处，默认使用有道词典的公开音频接口（该接口也支持整句朗读）。

## 浏览器兼容性

推荐使用近期版本的 Chrome、Edge、Firefox 或 Safari。项目使用原生 HTML、CSS 和 JavaScript，不需要构建步骤。

发音功能依赖 `<audio>` 与 `IntersectionObserver`，在以上浏览器中均可正常工作。若需播放失败时的降级行为，还依赖 `speechSynthesis`（浏览器内置语音合成）。

## 内容与授权

项目当前未附 `LICENSE` 文件。公开发布前建议：

1. 确认你有权公开词汇内容及其释义。
2. 为自行编写的代码补充合适的开源许可证，例如 MIT License。
3. 如词汇内容来源于第三方，请保留来源说明或取得相应授权。

词汇内容仅用于学习交流，相关权利归原作者或权利人所有。

发音音频与音标数据来自有道词典的公开接口，仅供学习交流使用；如需商用请自行确认授权，或改用其他音频来源。

## 参与贡献

欢迎提交 Issue 或 Pull Request，例如：

- 修正单词、词性、释义或音标
- 增加更适合移动端的浏览功能
- 增加拼写测试、随机复习或学习进度统计
- 优化无障碍体验和键盘操作
