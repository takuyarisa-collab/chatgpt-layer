import { gunzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourceDir = path.join(root, "product-install-poc/releases/0.2.0-dev1");
const outputDir = path.join(root, "product-install-poc/releases/0.2.0-dev3");
const outputPath = path.join(outputDir, "chatgpt-layer-product-0.2.0-dev3.user.js");

const parts = [];
for (const name of ["payload-01.js", "payload-02.js", "payload-03.js"]) {
  const text = await readFile(path.join(sourceDir, name), "utf8");
  const match = text.match(/\.push\("([A-Za-z0-9+/=]+)"\)/);
  if (!match) throw new Error(`Missing payload in ${name}`);
  parts.push(match[1]);
}

let source = gunzipSync(Buffer.from(parts.join(""), "base64")).toString("utf8");
source = source.replace("// @version      0.2.0-dev1", "// @version      0.2.0-dev3");

const marker = "// ==/UserScript==";
const banner = `${marker}\n\n// ============================================================\n// ✅ インストール完了後、ブラウザの「戻る」を1回押してください\n// ✅ After installation, tap the browser Back button once.\n// ============================================================`;
source = source.replace(marker, banner);

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, source, "utf8");
console.log(`Generated ${path.relative(root, outputPath)}`);
