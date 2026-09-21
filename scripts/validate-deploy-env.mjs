#!/usr/bin/env node
import process from "node:process";

const mode = process.argv[2];
const frontendKeys = [
  "VITE_BASE_PATH",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_WORKER_URL"
];
const workerKeys = [
  "SUPABASE_URL",
  "SUPABASE_JWKS_URL",
  "APP_ENV",
  "ALLOWED_ORIGINS",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "PIN_PEPPER",
  "TEACHER_SETUP_CODE",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID"
];

if (mode !== "frontend" && mode !== "worker") {
  fail("Usage: validate-deploy-env.mjs <frontend|worker>");
}

const requiredKeys = mode === "frontend" ? frontendKeys : workerKeys;
const missing = requiredKeys.filter((key) => !clean(key));
if (missing.length > 0) {
  fail(`Missing deployment configuration: ${missing.join(", ")}`);
}

const placeholderKeys = requiredKeys.filter((key) => /YOUR_|replace-with|example\.com/i.test(clean(key)));
if (placeholderKeys.length > 0) {
  fail(`Placeholder deployment configuration: ${placeholderKeys.join(", ")}`);
}

if (mode === "frontend") {
  requireSupabaseUrl("VITE_SUPABASE_URL");
  requireHttpsUrl("VITE_WORKER_URL");
  const basePath = clean("VITE_BASE_PATH");
  if (!basePath.startsWith("/") || !basePath.endsWith("/")) {
    fail("VITE_BASE_PATH must start and end with a slash");
  }
} else {
  requireSupabaseUrl("SUPABASE_URL");
  requireHttpsUrl("SUPABASE_JWKS_URL");
  if (clean("APP_ENV").toLowerCase() !== "production") {
    fail("APP_ENV must be production for a production deployment");
  }
  if (clean("PIN_PEPPER").length < 32) {
    fail("PIN_PEPPER must be at least 32 characters");
  }
  if (clean("TEACHER_SETUP_CODE").length < 16) {
    fail("TEACHER_SETUP_CODE must be at least 16 characters");
  }
  for (const origin of clean("ALLOWED_ORIGINS").split(",").map((value) => value.trim()).filter(Boolean)) {
    const url = parseUrl(origin, "ALLOWED_ORIGINS");
    if (url.origin !== origin || !["https:", "http:"].includes(url.protocol)) {
      fail("ALLOWED_ORIGINS must contain comma-separated origins without paths");
    }
  }
}

console.log(`${mode} deployment configuration is present and structurally valid.`);

function clean(key) {
  return (process.env[key] ?? "").trim();
}

function requireSupabaseUrl(key) {
  const url = parseUrl(clean(key), key);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co")) {
    fail(`${key} must be an https://*.supabase.co URL`);
  }
}

function requireHttpsUrl(key) {
  const url = parseUrl(clean(key), key);
  if (url.protocol !== "https:") fail(`${key} must use HTTPS`);
}

function parseUrl(value, key) {
  try {
    return new URL(value);
  } catch {
    fail(`${key} must be a valid URL`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
