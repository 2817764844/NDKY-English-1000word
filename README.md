# CET-4 核心词汇 1000

一个无需后端、开箱即用的大学英语四级核心词汇浏览网页。项目将 1000 个核心词整理为 10 个 List，并支持搜索、词性筛选、收藏和练习模式，适合用于日常背词、快速查词和自测。

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
| 收藏生词 | 使用本地浏览器存储收藏状态，无需登录 |
| 练习模式 | 可独立遮住英文单词或中文释义，点击词条逐条查看 |
| 响应式布局 | 同时适配电脑、平板和手机 |
| 完全离线 | 不需要服务器、数据库或第三方接口 |

## 直接使用

下载项目后，直接打开以下文件即可：

```text
网页版单词表/index.html
```

Windows 也可以在项目根目录执行：

```powershell
start .\网页版单词表\index.html
```

如果希望通过本地服务器访问：

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
│   └── words.js
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
    list: 1,
    number: 1,
    word: "hesitate",
    part: "vi",
    meaning: "犹豫，迟疑",
  },
];
```

修改或替换 `words.js` 中的数组，即可使用自己的词库。

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

- 修改 `网页版单词表/styles.css` 中的 `:root` 变量可调整配色和视觉样式。
- 修改 `网页版单词表/app.js` 可调整筛选、收藏和练习模式逻辑。
- 修改 `网页版单词表/words.js` 可替换或扩充词汇数据。
- 收藏记录保存在浏览器的 `cet4-favorites` 本地存储项中。

## 浏览器兼容性

推荐使用近期版本的 Chrome、Edge、Firefox 或 Safari。项目使用原生 HTML、CSS 和 JavaScript，不需要构建步骤。

## 内容与授权

项目当前未附 `LICENSE` 文件。公开发布前建议：

1. 确认你有权公开词汇内容及其释义。
2. 为自行编写的代码补充合适的开源许可证，例如 MIT License。
3. 如词汇内容来源于第三方，请保留来源说明或取得相应授权。

词汇内容仅用于学习交流，相关权利归原作者或权利人所有。

## 参与贡献

欢迎提交 Issue 或 Pull Request，例如：

- 修正单词、词性或释义
- 增加更适合移动端的浏览功能
- 增加拼写测试、随机复习或学习进度统计
- 优化无障碍体验和键盘操作
