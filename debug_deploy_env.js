const fs = require('fs');
const path = require('path');
const ROOT = __dirname ? path.resolve(__dirname, '.') : process.cwd();

// Load .env without overriding existing environment variables.
// This ensures shell-provided env vars (e.g., PROVIDER_URL) take precedence.
const dotenv = require('dotenv');
// Hard force load: Read .env file directly and assign to process.env
try {
  const envPath = path.resolve(ROOT, '.env');
  console.log("Loading .env from:", envPath);
  if (fs.existsSync(envPath)) {
    const envConfig = dotenv.parse(fs.readFileSync(envPath));
    for (const k in envConfig) {
      if (!process.env[k]) {
        process.env[k] = envConfig[k];
      }
    }
  } else {
    console.log(".env file not found at:", envPath);
  }
} catch (e) {
  console.warn("Failed to manually load .env:", e);
}

const RPC_URL = process.env.RPC_URL || process.env.PROVIDER_URL || 'http://127.0.0.1:8545';
const PRIVATE_KEY = process.env.PRIVATE_KEY_OVERRIDE || process.env.PRIVATE_KEY;

console.log("--- Debug Script Config Check ---");
console.log("ROOT:", ROOT);
console.log("RPC_URL:", RPC_URL);
console.log("PRIVATE_KEY present:", !!PRIVATE_KEY);
if (PRIVATE_KEY) {
    console.log("PRIVATE_KEY length:", PRIVATE_KEY.length);
    console.log("PRIVATE_KEY start:", PRIVATE_KEY.substring(0, 4));
}
console.log("----------------------------------");
