import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourceDir = path.join(root, "product-install-poc/releases/0.2.2-dev1");
const outputDir = sourceDir;
const outputPath = path.join(outputDir, "chatgpt-layer-product-0.2.2-dev1.user.js");
const expectedSha256 = "f1f801438a7eb6a8f0453e764b40ca2a2df5cae4f07567064c40b492b01d6233";

const parts = [];
for (const name of [
  "payload-01.js",
  "payload-02.js"
]) {
  const text = await readFile(path.join(sourceDir, name), "utf8");
  const match = text.match(/\.push\("([A-Za-z0-9+/=]+)"\)/);
  if (!match) throw new Error(`Missing payload in ${name}`);
  parts.push(match[1]);
}

const source = gunzipSync(Buffer.from(parts.join(""), "base64"));
const actualSha256 = createHash("sha256").update(source).digest("hex");
if (actualSha256 !== expectedSha256) {
  throw new Error(`Release hash mismatch: ${actualSha256}`);
}

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, source);
console.log(`Generated ${path.relative(root, outputPath)} (${actualSha256})`);
