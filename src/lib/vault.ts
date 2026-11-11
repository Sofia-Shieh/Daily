/** Private snapshots are decrypted in the browser. Keys never enter request URLs or headers. */
const AAD = new TextEncoder().encode("daily-budget-private-v1");
const MAX_ENVELOPE_BYTES = 12 * 1024 * 1024;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export type VaultEnvelope = {
  version: 1;
  algorithm: "AES-GCM";
  iv: string;
  ciphertext: string;
};

function encodeBase64Url(bytes: Uint8Array): string {
  // Keep conversion chunks small so larger encrypted snapshots cannot overflow the call stack.
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!value || !BASE64URL.test(value) || value.length % 4 === 1) {
    throw new Error("加密数据格式无效，请重新获取账本快照。");
  }
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("加密数据格式无效，请重新获取账本快照。");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64Url(bytes) !== value) {
    throw new Error("加密数据格式无效，请重新获取账本快照。");
  }
  return bytes;
}

function keyBytes(key: string): Uint8Array {
  if (typeof key !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(key)) {
    throw new Error("解锁密钥格式不正确，请使用完整的专属入口或密钥。");
  }
  let decoded: Uint8Array;
  try {
    decoded = decodeBase64Url(key);
  } catch {
    throw new Error("解锁密钥格式不正确，请使用完整的专属入口或密钥。");
  }
  if (decoded.length !== 32) {
    throw new Error("解锁密钥格式不正确，请使用完整的专属入口或密钥。");
  }
  return decoded;
}

/** Only recognize a fragment; query parameters and additional fragment fields are rejected. */
export function parseVaultKey(hash: string): string | null {
  if (typeof hash !== "string") return null;
  const match = /^#vault=([A-Za-z0-9_-]{43})$/.exec(hash);
  if (!match) return null;
  try {
    keyBytes(match[1]);
    return match[1];
  } catch {
    return null;
  }
}

function validateEnvelope(value: unknown): {
  iv: Uint8Array;
  ciphertext: Uint8Array;
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("无法识别加密账本格式。");
  }
  const packet = value as Record<string, unknown>;
  if (
    Object.keys(packet).length !== 4 ||
    packet.version !== 1 ||
    packet.algorithm !== "AES-GCM" ||
    typeof packet.iv !== "string" ||
    packet.iv.length !== 16 ||
    typeof packet.ciphertext !== "string" ||
    packet.ciphertext.length < 22 ||
    packet.ciphertext.length > MAX_ENVELOPE_BYTES - 128
  ) {
    throw new Error("加密账本格式或大小不受支持，请重新获取快照。");
  }
  const iv = decodeBase64Url(packet.iv);
  const ciphertext = decodeBase64Url(packet.ciphertext);
  if (iv.length !== 12 || ciphertext.length < 16) {
    throw new Error("加密账本格式无效，请重新获取快照。");
  }
  return { iv, ciphertext };
}

export async function decryptVault(
  envelope: unknown,
  key: string,
): Promise<unknown> {
  const bytes = keyBytes(key);
  const { iv, ciphertext } = validateEnvelope(envelope);
  if (!globalThis.crypto?.subtle) {
    throw new Error(
      "当前浏览器不支持安全解锁，请使用 HTTPS 地址和较新版本浏览器。",
    );
  }
  let decrypted: ArrayBuffer;
  try {
    const importedKey = await crypto.subtle.importKey(
      "raw",
      bytes,
      "AES-GCM",
      false,
      ["decrypt"],
    );
    decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: AAD, tagLength: 128 },
      importedKey,
      ciphertext,
    );
  } catch {
    throw new Error("无法解锁账本：密钥不匹配或文件已变化，请核对专属入口。");
  } finally {
    bytes.fill(0);
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(decrypted),
    );
  } catch {
    throw new Error("解锁后的账本格式无效，请重新生成快照。");
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const statedSize = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(statedSize) && statedSize > MAX_ENVELOPE_BYTES) {
    throw new Error("加密账本超过 12 MB，请缩小快照后重试。");
  }
  if (!response.body) throw new Error("加密账本内容为空，请稍后重试。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ENVELOPE_BYTES) {
        await reader.cancel();
        throw new Error("加密账本超过 12 MB，请缩小快照后重试。");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("无法读取加密账本文件，请稍后重试。");
  }
}

export async function fetchVault(
  key: string,
  options: { url?: string; signal?: AbortSignal } = {},
): Promise<unknown> {
  keyBytes(key).fill(0);
  const url = options.url ?? "/private-vault.json";
  // Defense in depth: callers must pass only a static snapshot path, never a key-bearing URL.
  if (url.includes(key) || /(?:[?#&])(?:vault|key|token)=/i.test(url)) {
    throw new Error("快照地址不能包含解锁密钥。");
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      signal: options.signal,
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error("暂时无法连接加密账本，请检查网络后重试。");
  }
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "加密账本尚未发布，请稍后重试。"
        : "暂时无法读取加密账本，请稍后重试。",
    );
  }
  return decryptVault(await readBoundedJson(response), key);
}
