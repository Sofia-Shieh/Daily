import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import {
  decryptVault,
  fetchVault,
  parseVaultKey,
  type VaultEnvelope,
} from "../src/lib/vault.ts";

// Synthetic test-only key and data; actual access keys are never stored in source.
const keyBytes = Buffer.alloc(32, 17);
const key = keyBytes.toString("base64url");
const snapshot = {
  version: 1,
  transactions: [{ id: "synthetic-only", amount: 1200 }],
  categories: [],
  settings: {},
};
function encrypt(
  value: unknown,
  aad = "daily-budget-private-v1",
): VaultEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    version: 1,
    algorithm: "AES-GCM",
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

test("private vault decrypts authenticated synthetic data with AES-256-GCM", async () => {
  assert.deepEqual(await decryptVault(encrypt(snapshot), key), snapshot);
});

test("wrong keys, tampering and altered authenticated version context fail closed", async () => {
  const packet = encrypt(snapshot);
  await assert.rejects(
    decryptVault(packet, Buffer.alloc(32, 18).toString("base64url")),
    /无法解锁/,
  );
  const modified = Buffer.from(packet.ciphertext, "base64url");
  modified[0] ^= 1;
  await assert.rejects(
    decryptVault(
      { ...packet, ciphertext: modified.toString("base64url") },
      key,
    ),
    /无法解锁/,
  );
  await assert.rejects(
    decryptVault(encrypt(snapshot, "another-context"), key),
    /无法解锁/,
  );
});

test("vault format validation rejects invalid shapes, sizes, IVs, algorithms and noncanonical keys", async () => {
  const packet = encrypt(snapshot);
  for (const invalid of [
    null,
    [],
    {},
    { ...packet, version: 2 },
    { ...packet, algorithm: "AES-CBC" },
    { ...packet, personalMetadata: "test-only" },
    { ...packet, iv: "short" },
    { ...packet, ciphertext: "AAAA" },
    { ...packet, ciphertext: "A".repeat(12 * 1024 * 1024) },
  ]) {
    await assert.rejects(decryptVault(invalid, key), /格式|大小/);
  }
  await assert.rejects(decryptVault(packet, "short"), /密钥格式/);
  await assert.rejects(
    decryptVault(packet, `${key.slice(0, -1)}B`),
    /密钥格式/,
  );
});

test("only a strictly valid key fragment is accepted, not query parameters or mixed fragments", () => {
  assert.equal(parseVaultKey(`#vault=${key}`), key);
  for (const invalid of [
    `?vault=${key}`,
    `#vault=${key}&next=anything`,
    `#key=${key}`,
    "#vault=",
    `#vault=${key}=`,
    `#vault=${key.slice(0, -1)}B`,
  ])
    assert.equal(parseVaultKey(invalid), null);
});

test("fetching the vault sends no key or credentials and decrypts only bounded authenticated payloads", async (t) => {
  const packet = encrypt(snapshot);
  const calls: { url: string; init?: RequestInit }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(packet), {
        headers: { "Content-Type": "application/json" },
      });
    },
  );
  assert.deepEqual(
    await fetchVault(key, { url: "/Daily/private-vault.json" }),
    snapshot,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/Daily/private-vault.json");
  assert.equal(calls[0].init?.credentials, "omit");
  assert.equal(calls[0].init?.referrerPolicy, "no-referrer");
  assert.equal(calls[0].init?.cache, "no-store");
  assert.equal(calls[0].init?.redirect, "error");
  assert.ok(!JSON.stringify(calls).includes(key));
  await assert.rejects(
    fetchVault(key, { url: `/private-vault.json?key=${key}` }),
    /不能包含解锁密钥/,
  );
  assert.equal(calls.length, 1);
});

test("vault loading rejects missing or oversized network payloads without creating any plaintext state", async (t) => {
  let response = new Response("missing", { status: 404 });
  t.mock.method(globalThis, "fetch", async () => response);
  await assert.rejects(fetchVault(key), /尚未发布/);
  response = new Response("{}", {
    headers: { "Content-Length": String(13 * 1024 * 1024) },
  });
  await assert.rejects(fetchVault(key), /超过 12 MB/);
  response = new Response(" ".repeat(12 * 1024 * 1024 + 1));
  await assert.rejects(fetchVault(key), /超过 12 MB/);
});
