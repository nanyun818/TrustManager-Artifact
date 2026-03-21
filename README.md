# TrustManager: Resilient and Explainable Trust Management for Blockchain

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Artifact Evaluation](https://img.shields.io/badge/Artifact-Available-blue.svg)]()

This repository provides the experimental artifacts for **TrustManager**, a decentralized trust management framework that combines graph-enhanced machine learning with a hybrid AI-oracle consensus mechanism. The codebase includes the full pipeline for model training, feature engineering, on-chain verification, and reproducible evaluation.

---

## 🏗 Repository Structure

- **`contracts/`**  
  Solidity implementation of the TrustManager core logic, T-BFT consensus layer, and Merkle proof verification.

- **`scripts/`**  
  - `evaluate_models.py`: Evaluation engine for Random Forest, GNN, and Logistic Regression baselines.  
  - `run_rigorous_evaluation.py`: Automated pipeline for ablation studies and performance metrics.  
  - `WSFE_operator.py`: Implementation of the Weighted Structural Feature Engineering (WSFE) operator.

- **`forta-bot/`**  
  Implementation of the real-time monitoring bot for the Forta decentralized security network.

- **`etl/`**  
  Data extraction and preprocessing pipeline for Etherscan V2 and on-chain log data.

- **`models/`**  
  Pre-trained model weights and JSON configurations for the graph-enhanced Random Forest classifier.

---

## 🛠 Setup & Requirements

### Hardware Requirements
- **CPU**: 8+ cores recommended  
- **RAM**: ≥ 32 GB (required for constructing the 560k-transaction interaction graph)  
- **Storage**: ≥ 10 GB  

### Software Dependencies
- **Node.js**: v18.16.0+  
- **Python**: v3.10.11+  
- **Solidity**: v0.8.19  
- **Frameworks**:  
  - Hardhat v2.22.0  
  - Scikit-learn v1.2.2  
  - Pandas v2.0.0  

### Installation
```bash
git clone <repository-url>
cd TrustManager-Artifact
npm install
pip install -r requirements.txt
