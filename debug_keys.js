const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ROOT = process.cwd();
const envPath = path.resolve(ROOT, '.env');
console.log("Reading .env from:", envPath);

let PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY || PRIVATE_KEY.trim() === '') {
    try {
        const envConfig = dotenv.parse(fs.readFileSync(envPath));
        if (envConfig.PRIVATE_KEY) {
            console.log("Loaded PRIVATE_KEY manually from .env file.");
            PRIVATE_KEY = envConfig.PRIVATE_KEY;
        }
    } catch (e) {
        console.warn("Failed to manually read .env for key:", e);
    }
}

console.log("Final PRIVATE_KEY length:", PRIVATE_KEY ? PRIVATE_KEY.length : 0);
if (PRIVATE_KEY) {
    console.log("Final PRIVATE_KEY starts with:", PRIVATE_KEY.substring(0, 4));
}
