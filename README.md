# TrustManager: Resilient and Explainable Trust Management for Blockchain

This repository contains the experimental artifacts and source code for **TrustManager**, a decentralized trust management framework designed to detect Sybil attacks and malicious behaviors in blockchain networks.

## 🌟 Core Contributions

- **Hybrid AI-Oracle Consensus**: A decentralized mechanism for off-chain AI inference with on-chain verification.
- **Weighted Structural Feature Engineering (WSFE)**: A graph-based feature extraction operator that captures topological reputation.
- **Optimistic Security**: A game-theoretic challenge period that ensures economic finality for trust scores.

## 🏗 Repository Structure

- `contracts/`: Solidity implementation of the TrustManager core and Merkle proof verification.
- `scripts/`: 
  - `evaluate_models.py`: Main evaluation script for RF, GNN, and Logistic Regression baselines.
  - `run_rigorous_evaluation.py`: Script for generating the ablation study and performance metrics.
  - `deploy.js`: Hardhat deployment script for the Sepolia testnet.
- `forta-bot/`: Real-time monitoring bot implementation for the Forta network.
- `etl/`: Data extraction pipeline for Etherscan and blockchain interaction data.
- `models/`: Configuration and pre-trained weights for the Graph-Enhanced Random Forest.

## 🛠 Installation & Usage

### 1. Environment Setup
```bash
# Install Node.js dependencies
npm install

# Install Python dependencies
pip install -r requirements.txt
```

### 2. Running the AI Pipeline
To reproduce the model performance results:
```bash
python scripts/evaluate_models.py
```

### 3. On-chain Verification
To deploy and test the contract on a local network:
```bash
npx hardhat node
npx hardhat run scripts/deploy.js --network localhost
```

## 📊 Dataset
The experimental data (560,934 transactions) is processed using the scripts in `etl/`. Due to size constraints, the raw CSV files are not included in this repository but can be reconstructed using the provided extraction tools.

## 📜 License
This project is licensed under the ISC License.
