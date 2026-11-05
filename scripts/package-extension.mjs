import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import crx3 from "crx3";

const root = fileURLToPath(new URL("..", import.meta.url));
const keyPath = join(root, ".local", "helper-tools-signing.pem");
const crxPath = join(root, "helper-tools.crx");
const zipPath = join(root, "helper-tools.zip");
const manifest = JSON.parse(await readFile(join(root, "extension", "manifest.json"), "utf8"));

await mkdir(dirname(keyPath), { recursive: true, mode: 0o700 });
try {
  await stat(keyPath);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  await writeFile(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }), {
    flag: "wx", mode: 0o600
  });
}
await chmod(keyPath, 0o600);

await crx3([join(root, "extension", "manifest.json")], {
  keyPath, crxPath, zipPath
});

// Independently verify the CRX3 signature and its embedded ZIP before shipping.
// Format: https://chromium.googlesource.com/chromium/src/+/main/components/crx_file/crx3.proto
function fields(buffer) {
  let offset = 0;
  const result = new Map();
  function varint() {
    let value = 0;
    let shift = 0;
    for (;;) {
      if (offset >= buffer.length || shift > 28) throw new Error("Invalid CRX protobuf");
      const byte = buffer[offset++];
      value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return value;
      shift += 7;
    }
  }
  while (offset < buffer.length) {
    const tag = varint();
    if ((tag & 7) !== 2) throw new Error("Unexpected CRX header field type");
    const length = varint();
    if (offset + length > buffer.length) throw new Error("Truncated CRX header");
    const number = tag >>> 3;
    const entries = result.get(number) ?? [];
    entries.push(buffer.subarray(offset, offset + length));
    result.set(number, entries);
    offset += length;
  }
  return result;
}

const crx = await readFile(crxPath);
const zip = await readFile(zipPath);
if (crx.subarray(0, 4).toString() !== "Cr24" || crx.readUInt32LE(4) !== 3) {
  throw new Error("Invalid CRX3 preamble");
}
const headerEnd = 12 + crx.readUInt32LE(8);
const header = fields(crx.subarray(12, headerEnd));
const proof = fields(header.get(2)[0]);
const signedHeader = header.get(10000)[0];
const payload = crx.subarray(headerEnd);
if (!payload.equals(zip)) throw new Error("CRX and ZIP contents differ");
const signedLength = Buffer.alloc(4);
signedLength.writeUInt32LE(signedHeader.length);
const signedBytes = Buffer.concat([
  Buffer.from("CRX3 SignedData\0"), signedLength, signedHeader, payload
]);
const publicKey = createPublicKey({ key: proof.get(1)[0], type: "spki", format: "der" });
if (!verify("sha256", signedBytes, publicKey, proof.get(2)[0])) {
  throw new Error("CRX signature verification failed");
}
const privateKey = createPrivateKey(await readFile(keyPath));
const expectedPublic = createPublicKey(privateKey).export({ type: "spki", format: "der" });
if (!expectedPublic.equals(proof.get(1)[0])) throw new Error("Unexpected signing key");
const idBytes = createHash("sha256").update(expectedPublic).digest().subarray(0, 16);
if (!fields(signedHeader).get(1)[0].equals(idBytes)) throw new Error("Invalid CRX identity");
const extensionId = [...idBytes.toString("hex")]
  .map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16))).join("");

const sums = ["helper-tools.crx", "helper-tools.zip"].map((name, index) =>
  `${createHash("sha256").update(index ? zip : crx).digest("hex")}  ${name}`
).join("\n") + "\n";
await writeFile(join(root, "SHA256SUMS.txt"), sums);
console.log(`${manifest.name} ${manifest.version}`);
console.log(`Created helper-tools.crx and helper-tools.zip; CRX signature verified.`);
console.log(`Packed extension ID: ${extensionId}`);
console.log("Signing key retained locally in .local/ (excluded from Git).");
