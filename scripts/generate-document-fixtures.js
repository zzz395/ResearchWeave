import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDirectory = resolve(projectRoot, "tests/fixtures/documents");

function pdf(objects) {
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const [id, object] of objects.entries()) {
    if (id === 0 || object === undefined) continue;
    offsets[id] = Buffer.byteLength(body, "ascii");
    body += `${id} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${objects.length}\n`;
  body += "0000000000 65535 f \n";
  for (let id = 1; id < objects.length; id += 1) {
    body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

function stream(contents) {
  return `<< /Length ${Buffer.byteLength(contents, "ascii")} >>\nstream\n${contents}\nendstream`;
}

const twoPageText = pdf([
  undefined,
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
  stream(
    "BT\n/F1 12 Tf\n72 720 Td\n(Page one heading) Tj\n0 -20 Td\n(This paper proposes a new) Tj\n0 -16 Td\n(method for retrieval.) Tj\nET",
  ),
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
  stream("BT\n/F1 12 Tf\n72 720 Td\n(Page two is isolated.) Tj\nET"),
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
]);

const noText = pdf([
  undefined,
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>",
  stream(""),
]);

await mkdir(fixtureDirectory, { recursive: true });
await writeFile(resolve(fixtureDirectory, "two-page-text.pdf"), twoPageText);
await writeFile(resolve(fixtureDirectory, "no-text.pdf"), noText);
await writeFile(
  resolve(fixtureDirectory, "malformed.pdf"),
  Buffer.from("%PDF-1.4\nThis is deliberately not a valid PDF.\n%%EOF\n", "ascii"),
);
