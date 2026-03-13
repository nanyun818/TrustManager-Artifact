const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

async function main() {
    const rpcUrl = 'http://127.0.0.1:7545';
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    
    const contractAddress = fs.readFileSync(path.join(__dirname, '../contract_address.txt'), 'utf8').trim();
    console.log(`Contract Address: ${contractAddress}`);
    
    // Check code
    const code = await provider.getCode(contractAddress);
    console.log(`Code at address: ${code.substring(0, 50)}... (Length: ${code.length})`);
    
    if (code === '0x') {
        console.error('❌ No code at contract address! (Contract does not exist)');
        return;
    }
    
    const abi = ['function owner() public view returns (address)'];
    const contract = new ethers.Contract(contractAddress, abi, provider);
    
    try {
        const owner = await contract.owner();
        console.log(`✅ Owner: ${owner}`);
    } catch (e) {
        console.error(`❌ Failed to fetch owner: ${e.message}`);
    }
}

main().catch(console.error);
