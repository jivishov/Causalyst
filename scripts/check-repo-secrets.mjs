#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const excludedDirs = new Set([
  ".git",
  ".playwright-mcp",
  ".vite",
  ".wrangler",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results"
]);
const excludedPathParts = new Set(["frontend/dist"]);
const skippedExtensions = new Set([
  ".avif",
  ".gif",
  ".ico",
  ".jpg",
  ".jpeg",
  ".pdf",
  ".png",
  ".webm",
  ".woff",
  ".woff2"
]);

const pathPatterns = [
  {
    pattern: /client_secret_[^\\/]+\.apps\.googleusercontent\.com\.json$/i,
    label: "Google OAuth client-secret JSON file"
  }
];

const contentPatterns = [
  {
    pattern: /"client_secret"\s*:\s*"GOCSPX-[^"]+"/i,
    label: "Google OAuth client secret"
  },
  {
    pattern: /"auth_provider_x509_cert_url"\s*:\s*"https:\/\/www\.googleapis\.com\/oauth2\/v1\/certs"[\s\S]{0,2000}"client_secret"\s*:/i,
    label: "Google OAuth client-secret JSON"
  }
];

const findings = [];

function relative(filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function shouldSkip(filePath, stats) {
  const rel = relative(filePath);
  if ([...excludedPathParts].some((part) => rel === part || rel.startsWith(`${part}/`))) return true;
  if (stats.isDirectory()) return excludedDirs.has(path.basename(filePath));
  if (!stats.isFile()) return true;
  return skippedExtensions.has(path.extname(filePath).toLowerCase());
}

function scanFile(filePath) {
  const rel = relative(filePath);
  for (const { pattern, label } of pathPatterns) {
    if (pattern.test(rel)) findings.push(`${label}: ${rel}`);
  }

  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  for (const { pattern, label } of contentPatterns) {
    if (pattern.test(text)) findings.push(`${label}: ${rel}`);
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const filePath = path.join(dir, entry);
    const stats = statSync(filePath);
    if (shouldSkip(filePath, stats)) continue;
    if (stats.isDirectory()) {
      walk(filePath);
    } else {
      scanFile(filePath);
    }
  }
}

walk(root);

if (findings.length) {
  console.error("Repository secret scan failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("Repository secret scan passed.");
