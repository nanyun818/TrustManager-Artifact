const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const envPath = path.resolve(ROOT, '.env');
console.log("Reading .env from:", envPath);

const content = fs.readFileSync(envPath);
console.log("Buffer length:", content.length);
console.log("Hex dump of first 100 bytes:", content.subarray(0, 100).toString('hex'));

const str = content.toString('utf8');
console.log("First 100 chars (utf8):", str.substring(0, 100));

const lines = str.split('\n');
for (let i = 0; i < Math.min(lines.length, 15); i++) {
    console.log(`Line ${i}: ${lines[i].trim()}`);
    if (lines[i].includes('PRIVATE_KEY')) {
        console.log(`MATCH at line ${i}:`, lines[i]);
    }
}
