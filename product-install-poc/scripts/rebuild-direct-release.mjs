import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourceDir = path.join(root, "product-install-poc/releases/0.3.0-dev1");
const outputPath = path.join(
  sourceDir,
  "room-layer-0.3.0-dev1.user.js"
);
const expectedSha256 = "b7ff9e349f800f5dc8a423acc3bd791ea4e2ec516ee5363bb34016c60c7b130e";

const parts = [];
for (const name of [
  "payload-01.txt",
  "payload-02.txt"
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
