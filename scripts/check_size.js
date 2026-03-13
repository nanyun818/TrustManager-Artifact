const fs = require('fs');
const path = require('path');

async function main() {
    const artifactPath = path.join(__dirname, '../artifacts/contracts/TrustManager.sol/TrustManager.json');
    
    if (!fs.existsSync(artifactPath)) {
        console.error("Artifact not found. Please compile first.");
        return;
    }
    
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const bytecode = artifact.deployedBytecode;
    
    // Bytecode string starts with "0x", so length is (chars - 2) / 2
    const size = (bytecode.length - 2) / 2;
    
    console.log(`TrustManager Contract Size: ${size} bytes`);
    console.log(`Limit: 24576 bytes`);
    
    if (size > 24576) {
        console.error(`⚠️  WARNING: Contract exceeds mainnet size limit by ${size - 24576} bytes!`);
    } else {
        console.log(`✅ Contract is within size limits (${(24576 - size)} bytes remaining).`);
    }
}

main();
