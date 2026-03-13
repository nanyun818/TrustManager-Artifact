const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const ROOT = process.cwd();
try {
  const envPath = path.resolve(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const dotenv = require('dotenv');
    const envConfig = dotenv.parse(fs.readFileSync(envPath));
    for (const k in envConfig) {
      if (!process.env[k] || process.env[k] === '') {
        process.env[k] = envConfig[k];
      }
    }
  }
} catch (e) {}

async function main() {
    const rpcUrl = process.env.RPC_URL;
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    
    const contractAddress = fs.readFileSync(path.join(ROOT, 'contract_address.txt'), 'utf8').trim();
    let buildInfoPath = path.join(ROOT, 'artifacts', 'contracts', 'TrustManager.sol', 'TrustManager.json');
    if (!fs.existsSync(buildInfoPath)) buildInfoPath = path.join(ROOT, 'artifacts', 'TrustManager.json');
    
    const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
    const contract = new ethers.Contract(contractAddress, buildInfo.abi, provider);

    const owner = await contract.owner();
    const paused = await contract.paused();
    
    console.log(`Contract: ${contractAddress}`);
    console.log(`Owner:    ${owner}`);
    console.log(`Paused:   ${paused}`);
    
    const myAddress = "0x0402Ab23a93AAFFF89b8AF0e2D4CEd63A82D2200";
    console.log(`My Addr:  ${myAddress}`);
    console.log(`Is Owner? ${owner.toLowerCase() === myAddress.toLowerCase()}`);
}

main();
