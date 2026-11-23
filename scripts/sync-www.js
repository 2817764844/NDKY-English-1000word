const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const www = path.join(root, "www");
const files = ["index.html", "styles.css", "app.js", "words.js"];

fs.mkdirSync(www, { recursive: true });
for (const name of files) {
  fs.copyFileSync(path.join(root, name), path.join(www, name));
}

console.log(`已复制 ${files.join("、")} 到 www/`);
