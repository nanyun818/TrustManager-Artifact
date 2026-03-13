const https = require('https');

const apiKey = process.env.ETHERSCAN_API_KEY;
if (!apiKey) {
    console.error("No ETHERSCAN_API_KEY in env");
    process.exit(1);
}

const chainId = 1; // Mainnet
const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=block&action=getblocknobytime&timestamp=${Math.floor(Date.now()/1000)}&closest=before&apikey=${apiKey}`;

console.log(`Testing V2 access for Chain ID ${chainId} (Mainnet)...`);
// console.log(url); 

https.get(url, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
        console.log("Status Code:", res.statusCode);
        console.log("Response:", data);
    });
}).on('error', e => console.error(e));
