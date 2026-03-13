const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../out/trust_trend_overnight.csv');

if (fs.existsSync(file)) {
    const data = fs.readFileSync(file, 'utf-8');
    const lines = data.trim().split(/\r?\n/);
    
    // Map loop -> Set of addresses
    const loopNodes = new Map();
    
    // Start from 1 to skip header
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length >= 3) {
            const loop = parseInt(parts[1]);
            const address = parts[2];
            
            if (!isNaN(loop)) {
                if (!loopNodes.has(loop)) {
                    loopNodes.set(loop, new Set());
                }
                loopNodes.get(loop).add(address);
            }
        }
    }
    
    let maxNodes = 0;
    let maxLoop = 0;
    
    for (const [loop, nodes] of loopNodes.entries()) {
        if (nodes.size > maxNodes) {
            maxNodes = nodes.size;
            maxLoop = loop;
        }
    }
    
    console.log(`Max Concurrent Nodes: ${maxNodes} (at Loop ${maxLoop})`);
} else {
    console.log('File not found');
}
