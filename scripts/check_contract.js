const hre = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
    const addressPath = path.join(__dirname, '../contract_address.txt');
    const contractAddress = fs.readFileSync(addressPath, 'utf8').trim();
    console.log(`Checking contract at: ${contractAddress}`);

    const TrustManager = await hre.ethers.getContractFactory("TrustManager");
    
    // Check ABI
    const fragment = TrustManager.interface.getFunction("aiAgent");
    console.log("Has aiAgent in ABI:", !!fragment);
    
    // Check Code
    const code = await hre.ethers.provider.getCode(contractAddress);
    console.log(`Code at ${contractAddress}: ${code.length > 2 ? code.slice(0, 10) + '...' : 'NONE'}`);

    const contract = TrustManager.attach(contractAddress);

    try {
        const owner = await contract.owner();
        console.log(`Owner: ${owner}`);
    } catch (e) {
        console.error("Failed to call owner():", e.code);
    }

    try {
        const aiAgent = await contract.aiAgent();
        console.log(`AI Agent: ${aiAgent}`);
    } catch (e) {
        console.error("Failed to call aiAgent():", e.code);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
