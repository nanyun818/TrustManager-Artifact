# TrustManager: Resilient and Explainable Trust Management for Blockchain

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Artifact Evaluation](https://img.shields.io/badge/Artifact-Available-blue.svg)](https://github.com/nanyun818/TrustManager-Artifact)

This repository contains the official experimental artifacts for **TrustManager**, a decentralized trust management framework that synergizes graph-enhanced machine learning with a hybrid AI-Oracle consensus mechanism.

---



## 🏗 Repository Structure

- `contracts/`: Solidity implementation of the TrustManager core, T-BFT consensus, and Merkle proof verification.
- `scripts/`: 
  - `evaluate_models.py`: Main evaluation engine for RF, GNN, and Logistic Regression baselines.
  - `run_rigorous_evaluation.py`: Automated pipeline for ablation studies and performance metrics.
  - `WSFE_operator.py`: Implementation of the Weighted Structural Feature Engineering (WSFE) operator.
- `forta-bot/`: Real-time monitoring implementation for the Forta decentralized security network.
- `etl/`: High-performance data extraction pipeline for Etherscan V2 and on-chain logs.
- `models/`: Pre-trained model weights and JSON configurations for the Graph-Enhanced Random Forest.

---

## 🛠 Setup & Requirements

### Hardware Requirements
- **CPU**: Intel i7-10700 or better (8+ cores recommended for parallel feature extraction).
- **RAM**: 32GB (for processing the 560k transaction graph).
- **Storage**: 10GB free space.

### Software Dependencies
- **Node.js**: v18.16.0+
- **Python**: v3.10.11+
- **Solidity**: v0.8.19
- **Frameworks**: Hardhat v2.22.0, Scikit-learn v1.2.2, Pandas v2.0.0

### Installation
```bash
git clone https://github.com/nanyun818/TrustManager-Artifact.git
cd TrustManager-Artifact
npm install
pip install -r requirements.txt
```

---

## 📊 Experimental Reproducibility

To reproduce the results presented in the paper, follow the mapping below:

| Result in Paper | Description | Execution Command |
| :--- | :--- | :--- |
| **Table 1** | Main Performance Comparison | `python scripts/evaluate_models.py` |
| **Section 4.3** | Ablation Study & Importance | `python scripts/run_rigorous_evaluation.py --mode ablation` |
| **Section 4.4** | Latency & Gas Analysis | `npx hardhat run scripts/deploy.js --network localhost` |
| **Figure 4** | Feature Importance Distribution | `python scripts/plot_results.py --type importance` |

---

## 📂 Dataset
The study utilizes **560,934 real-world transactions** involving **175,442 unique addresses**.
- **Source**: Scraped via Etherscan V2 API and replayed from known DeFi incidents.
- **Pre-processing**: The scripts in `etl/` handle the conversion from raw JSON to the graph-enhanced labeled dataset used for training.

---

## 📜 License
This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

## ✉️ Contact
For questions or collaborations, please open an issue or contact the authors at `zrf051231@gmail.com`.
