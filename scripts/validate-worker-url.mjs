#!/usr/bin/env node
import process from "node:process";

const value = (process.argv[2] ?? "").trim();
let url;
try {
  url = new URL(value);
} catch {
  console.error("Cloudflare deployment did not return a valid Worker URL.");
  process.exit(1);
}

if (url.protocol !== "https:" || url.origin !== value) {
  console.error("Cloudflare deployment URL must be an HTTPS origin without a path.");
  process.exit(1);
}

console.log("Cloudflare deployment returned a valid Worker URL.");
