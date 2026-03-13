const fs = require('fs');
const path = require('path');

const files = [
    path.join(__dirname, '../out/trust_trend_overnight.csv'),
    path.join(__dirname, '../out/trust_trend.csv')
];

files.forEach(file => {
    if (fs.existsSync(file)) {
        try {
            const data = fs.readFileSync(file, 'utf-8');
            const lines = data.trim().split(/\r?\n/);
            const uniqueAddresses = new Set();
            
            // Assuming header: timestamp,loop,address,group,trustValue
            // Start from index 1 to skip header
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split(',');
                if (parts.length >= 3) {
                    uniqueAddresses.add(parts[2]);
                }
            }
            console.log(`File: ${path.basename(file)}`);
            console.log(`Unique Nodes Count: ${uniqueAddresses.size}`);
        } catch (e) {
            console.error(`Error reading ${file}:`, e.message);
        }
    } else {
        console.log(`File not found: ${path.basename(file)}`);
    }
});
