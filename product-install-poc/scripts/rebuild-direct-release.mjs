import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourceDir = path.join(root, "product-install-poc/releases/0.2.3-dev1");
const outputPath = path.join(
  sourceDir,
  "chatgpt-layer-product-0.2.3-dev1.user.js"
);
const expectedSha256 = "ec76d9c02707676e5345f7abf0ffe115d75fb3a54f4790c1ac950ba463bad39d";

const parts = [];
for (const name of [
  "payload-01.txt",
  "payload-02.txt",
  "payload-03.txt",
  "payload-04.txt",
  "payload-05.txt"
]) {
  parts.push((await readFile(path.join(sourceDir, name), "utf8")).trim());
}

const source = gunzipSync(Buffer.from(parts.join(""), "base64"));
const actualSha256 = createHash("sha256").update(source).digest("hex");
if (actualSha256 !== expectedSha256) {
  throw new Error(`Release hash mismatch: ${actualSha256}`);
}

await mkdir(sourceDir, { recursive: true });
await writeFile(outputPath, source);
console.log(`Generated ${path.relative(root, outputPath)} (${actualSha256})`);
