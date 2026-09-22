# CET-4 核心词汇 1000

一个无需后端、开箱即用的大学英语四级核心词汇浏览网页。项目将 1000 个核心词整理为 10 个 List，并支持搜索、词性筛选、收藏、练习模式和真人发音朗读，适合用于日常背词、快速查词和自测。

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
| 收藏生词 | 使用本地浏览器存储收藏状态，无需登录 |
| 练习模式 | 可独立遮住英文单词或中文释义，点击词条逐条查看 |
| 听音辨词 | 遮住单词后朗读按钮仍然可用，可配合「点击即读」做听写练习 |
| 响应式布局 | 同时适配电脑、平板和手机 |
| 无需构建 | 原生 HTML、CSS 和 JavaScript，下载即用 |

## 发音功能说明

- **真人音频**：音频取自有道词典的公开发音接口，按美式/英式分别请求，不是机器合成音。
- **需要联网**：播放发音时才会下载对应音频，**其余功能（浏览、搜索、筛选、收藏、练习模式）完全离线可用**。
- **按需加载**：只有滚动到视口附近的词条才会预取音频，不会一次性请求 1000 个文件；已播放过的音频会在内存中缓存，重复点击不再请求。
- **口音切换**：右下角「英语发音」区域的按钮可在美音（US）和英音（UK）之间切换，音标和朗读都会同步切换，选择会记在本机浏览器中。
- **点击即读**：开启后点击词条任意位置即可朗读。
- **自动降级**：在线音频加载失败时会自动改用浏览器内置语音朗读，并给出提示。

> 首次直接双击 `index.html` 打开时，部分浏览器会限制本地文件联网，导致发音无法播放。此时请改用本地服务器打开（见下文）。

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
│       ├── fetch-phonetics.js   # 抓取音标（一次性，不参与运行）
│       ├── phonetics.json       # 音标原始数据
│       ├── apply-phonetics.js   # 把音标写入 words.js
│       └── check.js             # 数据自检（可选）
├── 分List单词表/
│   ├── 大学英语四级核心词汇_List01_1-100.docx
│   ├── 大学英语四级核心词汇_List02_101-200.docx
│   └── ...
└── 大学英语四级核心词汇1000.docx
```

## 数据格式

网页数据保存在 `网页版单词表/words.js`，结构如下：

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
];
```

- `usphone`：美式音标，用于「美音」模式显示。
- `ukphone`：英式音标，用于「英音」模式显示。
- 两个字段都可以留空，此时音标位置显示 `—`，发音功能不受影响。

修改或替换 `words.js` 中的数组，即可使用自己的词库。

### 重新生成音标

音标是预先抓取好写进 `words.js` 的，网页运行时不查询音标接口。如果替换了词库，可以重新生成：

```bash
cd 网页版单词表
node tools/fetch-phonetics.js     # 抓取缺失单词的音标，写入 tools/phonetics.json
node tools/apply-phonetics.js     # 合并进 words.js
```

脚本只抓取去重后的单词（当前词库 1000 条中有 190 个不重复单词），需要联网。

改完数据后可以跑一次自检（检查词条完整性、音标缺失和 HTML 标签闭合）：

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
- 修改 `网页版单词表/app.js` 可调整筛选、收藏、练习模式和发音逻辑。
- 修改 `网页版单词表/words.js` 可替换或扩充词汇数据（含音标）。
- 收藏记录保存在浏览器的 `cet4-favorites` 本地存储项中。
- 发音口音保存在 `cet4-accent`，点击即读开关保存在 `cet4-auto-speak`。
- 音频接口地址在 `app.js` 顶部的 `audioBase` 常量处，默认使用有道词典的公开音频接口。

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
