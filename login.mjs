#!/usr/bin/env node
/**
 * AI Logo Generator — sign in for AI agents and scripts.
 *
 * Uses the device authorization flow (RFC 8628): prints a short code, opens
 * https://ailogogenerator.online/connect/?user_code=… in the browser, and waits
 * for the user to click Approve. The resulting token is saved to
 * ~/.config/ailogogenerator.online/auth.json (mode 600).
 *
 * No local server, no API key. Zero dependencies (Node.js >= 18).
 */

import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";

const BASE = "https://ailogogenerator.online";
const CLIENT_ID = "agent-skill";
const CONFIG_DIR = path.join(os.homedir(), ".config", "ailogogenerator.online");
const AUTH_FILE = path.join(CONFIG_DIR, "auth.json");

function readAuth() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveAuth(token, email) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const data = { token, email: email || "", loginAt: new Date().toISOString() };
  fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  return data;
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {}); // no opener on this machine: the URL is printed below
    child.unref();
  } catch {
    // The URL is printed below; the user can open it by hand.
  }
}

async function post(pathname, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({}));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const existing = readAuth();
if (existing?.token) {
  const who = existing.email ? ` (${existing.email})` : "";
  console.log(`Already logged in${who}. Token stored at:\n  ${AUTH_FILE}`);
  console.log("To re-login, delete that file and run this script again.");
  process.exit(0);
}

const code = await post("/api/auth/device/code", { client_id: CLIENT_ID });
if (!code.device_code) {
  console.error(`Could not start login: ${code.error_description || code.error || "unknown error"}`);
  process.exit(1);
}

const userCode = `${code.user_code.slice(0, 4)}-${code.user_code.slice(4)}`;
console.log("Opening your browser to approve this login...");
console.log(`If it doesn't open, visit:\n  ${code.verification_uri_complete}`);
console.log(`Check that the page shows this code: ${userCode}\n`);
openBrowser(code.verification_uri_complete);

let interval = (code.interval || 5) * 1000;
const deadline = Date.now() + (code.expires_in || 600) * 1000;

while (Date.now() < deadline) {
  await sleep(interval);
  const result = await post("/api/auth/device/token", {
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    device_code: code.device_code,
    client_id: CLIENT_ID,
  });
  if (result.access_token) {
    const session = await fetch(`${BASE}/api/auth/get-session`, {
      headers: { Authorization: `Bearer ${result.access_token}` },
    }).then((r) => r.json()).catch(() => null);
    const saved = saveAuth(result.access_token, session?.user?.email);
    const who = saved.email ? ` as ${saved.email}` : "";
    console.log(`Login successful${who}.\nToken saved to:\n  ${AUTH_FILE}`);
    process.exit(0);
  }
  if (result.error === "authorization_pending") continue;
  if (result.error === "slow_down") {
    interval += 5000;
    continue;
  }
  if (result.error === "access_denied") {
    console.error("Login was cancelled in the browser.");
    process.exit(1);
  }
  console.error(`Login failed: ${result.error_description || result.error || "unknown error"}`);
  process.exit(1);
}

console.error("Timeout: the login link expired before it was approved. Run this script again.");
process.exit(1);
