import { createCipheriv, randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backupPath = path.join(root, ".local", "personal-backup.json");
const keyPath = path.join(root, ".local", "private-vault-key.txt");
const outputPath = path.join(root, "public", "private-vault.json");
const maxPlaintextBytes = 8 * 1024 * 1024;
const aad = Buffer.from("daily-budget-private-v1", "utf8");

function validateKey(text) {
  const value = text.trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(value))
    throw new Error("已有密钥格式无效，已停止生成，未替换原密钥。");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== value) {
    throw new Error("已有密钥格式无效，已停止生成，未替换原密钥。");
  }
  return bytes;
}

async function main() {
  const info = await stat(backupPath);
  if (info.size > maxPlaintextBytes)
    throw new Error("私有备份超过 8 MB，请缩小快照后重试。");
  const plaintext = await readFile(backupPath);
  try {
    const snapshot = JSON.parse(plaintext.toString("utf8"));
    if (
      snapshot?.version !== 1 ||
      !Array.isArray(snapshot.transactions) ||
      !Array.isArray(snapshot.categories) ||
      !snapshot.settings
    ) {
      throw new Error();
    }
  } catch {
    throw new Error("私有备份不是有效的账本 JSON，未生成加密文件。");
  }
  await mkdir(path.dirname(keyPath), { recursive: true });
  await mkdir(path.dirname(outputPath), { recursive: true });
  let key;
  try {
    key = validateKey(await readFile(keyPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const proposed = randomBytes(32);
    try {
      await writeFile(keyPath, `${proposed.toString("base64url")}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      key = proposed;
    } catch (writeError) {
      if (writeError?.code !== "EEXIST") throw writeError;
      proposed.fill(0);
      key = validateKey(await readFile(keyPath, "utf8"));
    }
  }
  await chmod(keyPath, 0o600);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  key.fill(0);
  plaintext.fill(0);
  const envelope = {
    version: 1,
    algorithm: "AES-GCM",
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
  const temporary = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(envelope)}\n`, {
    mode: 0o644,
    flag: "wx",
  });
  await rename(temporary, outputPath);
  console.log("加密快照已生成。密钥仅保存在被忽略的 .local 目录中，未输出。");
}

main().catch((error) => {
  // Do not print Node's original JSON parsing errors or any private values.
  console.error(
    error instanceof Error ? error.message : "快照加密失败，未发布任何数据。",
  );
  process.exitCode = 1;
});
