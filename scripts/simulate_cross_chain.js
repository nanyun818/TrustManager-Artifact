const hre = require("hardhat");

async function main() {
  console.log("🚀 Starting Cross-Chain Simulation (Relayer Mode)...");

  const [deployer, oracle, user] = await hre.ethers.getSigners();
  console.log("Relayer Oracle Address:", oracle.address);

  // 1. Deploy Contract on "Chain A" (Source) and "Chain B" (Destination)
  const TrustManager = await hre.ethers.getContractFactory("TrustManager");
  const trustManagerA = await TrustManager.deploy();
  await trustManagerA.deployed();
  console.log(`✅ [Chain A] TrustManager deployed at: ${trustManagerA.address}`);

  const trustManagerB = await TrustManager.deploy();
  await trustManagerB.deployed();
  console.log(`✅ [Chain B] TrustManager deployed at: ${trustManagerB.address}`);

  // 2. Authorize Oracle on Destination Chain
  // In a real bridge, the destination contract trusts a set of validators or the source contract itself.
  // Here we trust the Oracle's signature directly for MVP.
  await trustManagerB.connect(deployer).setOracleStatus(oracle.address, true);
  console.log("🔗 Oracle authorized on Chain B.");

  // 3. Simulate Event on Chain A (Detection)
  const targetNode = user.address;
  const riskScore = 95;
  const timestamp = Math.floor(Date.now() / 1000);
  const sourceChainId = 11155111; // Sepolia ID

  console.log(`\n🔍 [Chain A] Detected malicious node: ${targetNode}`);

  // 4. Generate Cross-Chain Proof (Off-chain Relayer Logic)
  console.log("\n📦 [Relayer] Generating Cross-Chain Proof...");
  
  // Pack data exactly as in Solidity: abi.encodePacked(sourceChainId, node, riskScore, timestamp)
  const messageHash = hre.ethers.utils.solidityKeccak256(
    ["uint256", "address", "uint256", "uint256"],
    [sourceChainId, targetNode, riskScore, timestamp]
  );
  
  // Sign the hash
  // Note: Ethers.js 'signMessage' automatically adds the "\x19Ethereum Signed Message:\n32" prefix
  const signature = await oracle.signMessage(hre.ethers.utils.arrayify(messageHash));
  
  const proof = {
    sourceChainId: sourceChainId,
    node: targetNode,
    riskScore: riskScore,
    timestamp: timestamp,
    signature: signature
  };
  
  console.log("   Proof Signature:", signature.substring(0, 20) + "...");

  // 5. Submit Proof to Chain B (Verification)
  console.log("\n📡 [Relayer] Submitting Proof to Chain B...");
  let start = Date.now();
  
  const tx = await trustManagerB.verifyCrossChainProof(proof);
  const receipt = await tx.wait();
  
  let end = Date.now();
  console.log(`✅ [Chain B] Proof Verified! Transaction Hash: ${tx.hash}`);
  console.log(`⏱️  Cross-Chain Latency (Relayer -> Chain B): ${end - start}ms`);

  // 6. Verify State on Chain B
  const nodeRisk = await trustManagerB.nodeRiskExposure(targetNode);
  console.log(`\n📊 [Chain B] Node Risk Score Updated: ${nodeRisk.toString()}`);
  
  if (nodeRisk.toString() === "95") {
    console.log("🎉 SUCCESS: Cross-Chain Synchronization Verified.");
  } else {
    console.log("❌ FAILURE: State mismatch.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
