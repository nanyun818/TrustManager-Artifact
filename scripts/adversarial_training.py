import pandas as pd
import numpy as np
import os
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score
import joblib

# --- Configuration ---
DATA_DIR = 'data_cache'
OUT_DIR = 'out/adversarial'
MODEL_PATH = 'out/models/rf_model_v2.pkl' # Start with existing model logic
if not os.path.exists(OUT_DIR):
    os.makedirs(OUT_DIR)

print("🚀 Starting Adversarial Training Pipeline...")

# 1. Load Original Data
print("1️⃣ Loading original training data...")
# We use the labeled dataset generated previously
try:
    df_original = pd.read_csv('labeled_dataset.csv')
except FileNotFoundError:
    print("⚠️ labeled_dataset.csv not found, generating synthetic base data...")
    # Fallback: create synthetic data if file missing (for standalone testing)
    data = {
        'success_rate': np.random.uniform(0.8, 1.0, 1000),
        'failure_rate': np.random.uniform(0, 0.2, 1000),
        'avg_latency': np.random.uniform(10, 100, 1000),
        'error_rate': np.random.uniform(0, 0.1, 1000),
        'total_tx': np.random.randint(100, 1000, 1000),
        'risk_label': [0] * 1000 # Mostly honest
    }
    df_original = pd.DataFrame(data)

# 2. Generate Adversarial Samples (The "Attackers")
print("2️⃣ Generating Adversarial Samples (On-Off Attacks & Camouflage)...")

def generate_on_off_attack(n=500):
    """
    On-Off Attack: Node behaves well mostly (high success rate) but has periodic spikes in failure/latency.
    Traditional thresholds might miss this because 'average' looks okay.
    """
    return pd.DataFrame({
        'success_rate': np.random.uniform(0.85, 0.95, n), # Looks good!
        'failure_rate': np.random.uniform(0.05, 0.15, n), # Slightly elevated
        'avg_latency': np.random.uniform(200, 500, n),    # High latency hidden by averages
        'error_rate': np.random.uniform(0.05, 0.10, n),   # Just below alert thresholds
        'total_tx': np.random.randint(500, 2000, n),      # High volume to mask errors
        'risk_label': [1] * n                             # LABEL AS RISK!
    })

def generate_low_volume_sybil(n=500):
    """
    Sybil Attack: Many nodes with very few transactions, perfect success rate, but exist to dilute trust.
    """
    return pd.DataFrame({
        'success_rate': [1.0] * n,                        # Perfect behavior
        'failure_rate': [0.0] * n,
        'avg_latency': np.random.uniform(10, 50, n),
        'error_rate': [0.0] * n,
        'total_tx': np.random.randint(1, 5, n),           # Suspiciously low volume
        'risk_label': [1] * n                             # LABEL AS RISK (Needs behavioral analysis)
    })

df_on_off = generate_on_off_attack(500)
df_sybil = generate_low_volume_sybil(300)

print(f"   - Generated {len(df_on_off)} On-Off Attack samples")
print(f"   - Generated {len(df_sybil)} Sybil Attack samples")

# 3. Combine Datasets
print("3️⃣ Merging Datasets for Adversarial Training...")
# Ensure columns match
common_cols = ['success_rate', 'failure_rate', 'avg_latency', 'error_rate', 'total_tx', 'risk_label']
df_combined = pd.concat([
    df_original[common_cols],
    df_on_off[common_cols],
    df_sybil[common_cols]
], ignore_index=True)

print(f"   - Total Training Samples: {len(df_combined)}")

# 4. Train Robust Model
print("4️⃣ Training Robust Random Forest Model...")
X = df_combined.drop('risk_label', axis=1)
y = df_combined['risk_label']

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

clf = RandomForestClassifier(n_estimators=100, max_depth=10, random_state=42)
clf.fit(X_train, y_train)

# 5. Evaluate
print("5️⃣ Evaluation Results (Adversarial Robustness):")
y_pred = clf.predict(X_test)
print(classification_report(y_test, y_pred))
auc = roc_auc_score(y_test, y_pred)
print(f"   - Robustness AUC Score: {auc:.4f}")

# 6. Save Artifacts
model_out = os.path.join(OUT_DIR, 'adversarial_rf_model.pkl')
joblib.dump(clf, model_out)
print(f"✅ Adversarial-Resistant Model saved to: {model_out}")

# Save the augmented dataset for paper reference
data_out = os.path.join(OUT_DIR, 'adversarial_dataset.csv')
df_combined.to_csv(data_out, index=False)
print(f"✅ Adversarial Dataset saved to: {data_out}")
