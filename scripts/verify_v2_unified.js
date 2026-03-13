require('dotenv').config();
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');

const apiKey = process.env.ETHERSCAN_API_KEY;
if (!apiKey) {
    console.error("❌ Error: ETHERSCAN_API_KEY not found in .env");
    process.exit(1);
}

// Proxy Configuration (Based on your Clash Verge settings)
const PROXY_URL = 'http://127.0.0.1:7897';
const agent = new HttpsProxyAgent(PROXY_URL);

console.log(`🔑 Using Etherscan API Key: ${apiKey.slice(0, 5)}...`);
console.log(`🔌 Using Proxy: ${PROXY_URL}`);
console.log("🌐 Testing Unified V2 API for Multi-Chain Access...");

const chains = [
    { name: 'Mainnet', id: 1 },
    { name: 'BSC', id: 56 },
    { name: 'Polygon', id: 137 }
];

function testChain(chain) {
    return new Promise((resolve) => {
        // V2 Unified Endpoint: https://api.etherscan.io/v2/api
        const url = `https://api.etherscan.io/v2/api?chainid=${chain.id}&module=proxy&action=eth_blockNumber&apikey=${apiKey}`;
        
        const options = {
            agent: agent,
            timeout: 10000 // 10s timeout
        };

        const req = https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.result && !json.result.startsWith('Max rate limit') && !json.message?.includes('NOTOK')) {
                        const blockDecimal = parseInt(json.result, 16);
                        console.log(`✅ [${chain.name} (ID:${chain.id})] Success! Latest Block: ${blockDecimal}`);
                        resolve(true);
                    } else {
                        console.log(`❌ [${chain.name} (ID:${chain.id})] Failed: ${json.message || json.result || 'Unknown Error'}`);
                        // if (json.message) console.log(`   Response: ${JSON.stringify(json)}`);
                        resolve(false);
                    }
                } catch (e) {
                    console.log(`❌ [${chain.name} (ID:${chain.id})] JSON Parse Error: ${e.message}`);
                    resolve(false);
                }
            });
        });
        
        req.on('error', (e) => {
            console.log(`❌ [${chain.name} (ID:${chain.id})] Network Error: ${e.message}`);
            resolve(false);
        });
        
        req.end();
    });
}

async function runTests() {
    console.log("---------------------------------------------------");
    let allSuccess = true;
    for (const chain of chains) {
        const success = await testChain(chain);
        if (!success) allSuccess = false;
        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 1000));
    }
    console.log("---------------------------------------------------");
    if (allSuccess) {
        console.log("🎉 Great! Your Etherscan API Key supports Unified V2 access for ALL chains via Proxy.");
    } else {
        console.log("⚠️  Warning: Even with proxy, some chains failed.");
        console.log("   This confirms that Etherscan V2 Unified access requires a PRO plan or independent keys for BSC/Polygon.");
    }
}

runTests();
