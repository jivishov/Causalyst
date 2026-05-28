import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const distDir = join(process.cwd(), "frontend", "dist");

const patterns = [
  [/OPENAI_API_KEY/i, "OpenAI secret variable name"],
  [/SUPABASE_SERVICE_ROLE_KEY/i, "Supabase service-role variable name"],
  [/SUPABASE_SERVICE_ROLE/i, "Supabase service-role variable name"],
  [/PIN_PEPPER/i, "PIN pepper variable name"],
  [/pin_hash/i, "PIN hash field name"],
  [/openai_file_id/i, "OpenAI file-id field name"],
  [/storage_key/i, "Storage-key field name"],
  [/raw_response/i, "Raw-provider-response field name"],
  [/(?:^|[^A-Za-z0-9_])sk-(?:proj|live|test)?-[A-Za-z0-9_-]{20,}(?:[^A-Za-z0-9_-]|$)/i, "OpenAI-style secret key"],
  [/(?:^|[^A-Za-z0-9_])file-[A-Za-z0-9]{12,}(?:[^A-Za-z0-9]|$)/i, "OpenAI file id"],
  [/eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]*c2VydmljZV9yb2xl[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{12,}/, "service-role JWT-like value"],
  [/(sha256|sha-256)["':=\s]+[A-Fa-f0-9]{64}/i, "SHA-256-like hash"],
  [/(?:audio|writing|simulation-derived)\/[A-Za-z0-9._-]{8,}\/[A-Za-z0-9._-]{8,}/i, "private storage path pattern"],
  [/[A-Za-z]:\\+(?:Users|Documents and Settings)\\+[^\s"'`]+/i, "local Windows path"],
  [/[A-Za-z]:\/+(?:Users|Documents and Settings)\/+[^\s"'`]+/i, "local Windows path"]
];

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

if (!existsSync(distDir)) {
  console.error("frontend/dist does not exist. Run the frontend build first.");
  process.exit(1);
}

const findings = [];
for (const file of walk(distDir)) {
  const content = readFileSync(file, "utf8");
  for (const [pattern, label] of patterns) {
    if (pattern.test(content)) {
      findings.push(`${label}: ${file}`);
    }
  }
}

if (findings.length > 0) {
  console.error("Security scan failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("Security scan passed: no backend-only values found in frontend/dist.");
