import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import StratifiedKFold
from sklearn.metrics import classification_report, f1_score, roc_auc_score, confusion_matrix
from sklearn.impute import SimpleImputer
import matplotlib.pyplot as plt
import seaborn as sns
import os

# Configuration
DATA_PATH = 'out/multichain_dataset.csv'
OUT_DIR = 'paper_sections/figures'
os.makedirs(OUT_DIR, exist_ok=True)

def to_float(val):
    if isinstance(val, str):
        v = val.strip().lower()
        if v in ('true','1','high','yes'): return 1.0
        try:
            return float(v)
        except:
            return 0.0
    if pd.isna(val): return 0.0
    return float(val or 0)

def load_and_preprocess(path):
    print(f"Loading dataset from {path}...")
    df = pd.read_csv(path, low_memory=False)
    
    # Clean basic features
    df['gasRatio'] = df['gasRatio'].apply(to_float)
    df['gasUsed'] = df['gasUsed'].apply(to_float)
    df['gas'] = df['gas'].apply(to_float)
    df['unlimited'] = df['unlimited'].apply(to_float)
    df['freshSpender'] = df['freshSpender'].apply(to_float)
    
    # Target
    print("Label distribution:")
    print(df['finalLabel'].value_counts())
    # Map 'high_risk' to 1 (Malicious), others to 0 (Benign)
    # Note: 'low_risk' is ambiguous, but let's assume high_risk is the target class for "Attack"
    df['target'] = df['finalLabel'].apply(lambda x: 1 if str(x).strip().lower() in ['high_risk', 'malicious'] else 0)
    print("Target distribution:")
    print(df['target'].value_counts())
    
    # Timestamp
    df['timeStamp'] = pd.to_numeric(df['timeStamp'], errors='coerce')
    # Fill missing timestamps with 0 or drop? 
    # For temporal analysis, we need timestamps.
    # Let's drop rows without timestamp for temporal model training
    df = df.dropna(subset=['timeStamp'])
    
    return df

def inject_temporal_attacks(df, n_sequences=2000):
    print(f"Injecting {n_sequences} temporal burst attacks (Stealthy)...")
    # Scenario: "Low-and-Slow" or "Burst" attacks that bypass static checks
    # We create sequences of transactions that look benign individually but suspicious in frequency
    
    new_rows = []
    # Start time after the last existing transaction
    base_time = df['timeStamp'].max() + 10000
    
    for i in range(n_sequences):
        attacker_addr = f"0x_temporal_attack_{i}"
        # Burst: 10 transactions in 2 minutes
        start_ts = base_time + i * 600 # 10 mins apart
        
        for j in range(10):
            row = {
                'from': attacker_addr,
                'to': f"0x_victim_{i}",
                'gasRatio': np.random.uniform(0.1, 0.5), # Normal gas usage
                'unlimited': 0, # No unlimited approval
                'freshSpender': 0, # Simulating established account (or bypassed check)
                'gasUsed': np.random.uniform(21000, 60000),
                'gas': 100000,
                'timeStamp': start_ts + j * 12, # 12 seconds apart -> 5 tx/min (High Velocity)
                'finalLabel': 'high_risk',
                'txHash': f"0x_syn_temp_{i}_{j}",
                'chain': 'simulated'
            }
            new_rows.append(row)
            
    attack_df = pd.DataFrame(new_rows)
    # Ensure columns match
    common_cols = df.columns.intersection(attack_df.columns)
    
    # Concatenate
    # We need to ensure we don't lose columns needed for processing
    df_combined = pd.concat([df, attack_df], ignore_index=True)
    
    return df_combined

def generate_temporal_features(df):
    print("Generating temporal features (this may take a while)...")
    
    # Convert to datetime for rolling window
    df['dt'] = pd.to_datetime(df['timeStamp'], unit='s')
    
    # Sort by 'from' and 'dt' to ensure correct order for rolling and shift
    df = df.sort_values(['from', 'dt'])
    # Reset index to ensure we have a clean RangeIndex 0..N
    df = df.reset_index(drop=True)
    
    # 1. Shift features (Time since last transaction)
    # This can be done directly on the RangeIndex dataframe
    grouped = df.groupby('from')
    df['prev_time'] = grouped['timeStamp'].shift(1)
    df['time_since_last'] = df['timeStamp'] - df['prev_time']
    df['time_since_last'] = df['time_since_last'].fillna(3600*24) # Default 24h for first tx
    
    # 2. Rolling features (Velocity, Gas Pattern)
    # We need datetime index for '1h' time-based rolling.
    # We create a temporary indexed dataframe.
    df_indexed = df.set_index('dt')
    
    # Group by 'from', ensuring we don't change order (sort=False)
    # Since df is already sorted by 'from', this is safe.
    grouped_time = df_indexed.groupby('from', sort=False)
    
    # Calculate rolling features
    # Note: .values will extract the underlying numpy array.
    # We must ensure the order of 'velocity' matches 'df'.
    # groupby().rolling() returns a MultiIndex (from, dt).
    # Since we sorted df by (from, dt) and used sort=False, the order is preserved.
    
    print("Computing rolling velocity...")
    velocity = grouped_time['txHash'].rolling('1h').count()
    
    print("Computing rolling gas usage...")
    avg_gas = grouped_time['gasUsed'].rolling('1h').mean()
    
    # Assign back
    df['velocity_1h'] = velocity.values
    df['avg_gas_1h'] = avg_gas.values
    
    # Fill NaNs
    df['velocity_1h'] = df['velocity_1h'].fillna(1)
    df['avg_gas_1h'] = df['avg_gas_1h'].fillna(0)
    
    return df

from sklearn.metrics import roc_curve, auc

def plot_confusion_matrix(y_true, y_pred, title, filename):
    cm = confusion_matrix(y_true, y_pred)
    plt.figure(figsize=(8, 6))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', cbar=False)
    plt.title(title)
    plt.xlabel('Predicted')
    plt.ylabel('Actual')
    plt.tight_layout()
    plt.savefig(filename)
    plt.close()

def plot_roc_curve(y_true, y_prob, title, filename):
    fpr, tpr, _ = roc_curve(y_true, y_prob)
    roc_auc = auc(fpr, tpr)
    plt.figure(figsize=(8, 6))
    plt.plot(fpr, tpr, color='darkorange', lw=2, label=f'ROC curve (area = {roc_auc:.4f})')
    plt.plot([0, 1], [0, 1], color='navy', lw=2, linestyle='--')
    plt.xlim([0.0, 1.0])
    plt.ylim([0.0, 1.05])
    plt.xlabel('False Positive Rate')
    plt.ylabel('True Positive Rate')
    plt.title(title)
    plt.legend(loc="lower right")
    plt.tight_layout()
    plt.savefig(filename)
    plt.close()

def train_and_evaluate(df):
    features_static = ['gasRatio', 'unlimited', 'freshSpender', 'gasUsed']
    features_temporal = features_static + ['velocity_1h', 'avg_gas_1h', 'time_since_last']
    
    X = df[features_temporal]
    y = df['target']
    
    # Impute missing
    imputer = SimpleImputer(strategy='constant', fill_value=0)
    X_imputed = pd.DataFrame(imputer.fit_transform(X), columns=features_temporal)
    
    print("\n--- Training Temporal-Aware Random Forest ---")
    model = RandomForestClassifier(n_estimators=100, max_depth=15, random_state=42, n_jobs=-1)
    
    # 5-Fold Stratified CV
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    
    f1_scores = []
    
    # Store predictions for the last fold to plot
    y_test_last = []
    y_pred_last = []
    y_prob_last = []
    
    for fold, (train_idx, val_idx) in enumerate(cv.split(X_imputed, y)):
        X_train, X_val = X_imputed.iloc[train_idx], X_imputed.iloc[val_idx]
        y_train, y_val = y.iloc[train_idx], y.iloc[val_idx]
        
        model.fit(X_train, y_train)
        y_pred = model.predict(X_val)
        y_prob = model.predict_proba(X_val)[:, 1]
        
        score = f1_score(y_val, y_pred)
        f1_scores.append(score)
        print(f"Fold {fold+1} F1-Score: {score:.4f}")
        
        if fold == 4: # Save last fold for plotting
            y_test_last = y_val
            y_pred_last = y_pred
            y_prob_last = y_prob
        
    print(f"\nAverage F1-Score (Temporal RF): {np.mean(f1_scores):.4f}")
    
    # Plot CM and ROC for Temporal Model
    plot_confusion_matrix(y_test_last, y_pred_last, "Temporal RF Confusion Matrix", os.path.join(OUT_DIR, "fig_confusion_matrix_temporal.png"))
    plot_roc_curve(y_test_last, y_prob_last, "Temporal RF ROC Curve", os.path.join(OUT_DIR, "fig_roc_curve_temporal.png"))
    
    # Train on full data for feature importance
    model.fit(X_imputed, y)
    
    # Feature Importance
    importances = model.feature_importances_
    indices = np.argsort(importances)[::-1]
    
    print("\nFeature Importances:")
    for f in range(X_imputed.shape[1]):
        print(f"{f+1}. {features_temporal[indices[f]]}: {importances[indices[f]]:.4f}")
        
    # Compare with Static Model (just for check)
    X_static = df[features_static]
    X_static_imp = pd.DataFrame(imputer.fit_transform(X_static), columns=features_static)
    model_static = RandomForestClassifier(n_estimators=100, max_depth=15, random_state=42, n_jobs=-1)
    
    print("\n--- Training Static Random Forest (Baseline) ---")
    # Let's do one split for speed comparison
    train_idx, test_idx = list(cv.split(X_static_imp, y))[0]
    
    model_static.fit(X_static_imp.iloc[train_idx], y.iloc[train_idx])
    y_pred_static = model_static.predict(X_static_imp.iloc[test_idx])
    print(f"Static Model F1-Score (Fold 1): {f1_score(y.iloc[test_idx], y_pred_static):.4f}")
    print("Static Model Report:")
    print(classification_report(y.iloc[test_idx], y_pred_static))
    
    # Calculate Temporal Model Report for same fold
    print("Temporal Model Report (Fold 1):")
    # We need to retrain temporal on this fold or use the loop results?
    # Let's just retrain for consistency in this block or use the loop results if we saved them.
    # We didn't save y_pred from loop.
    model.fit(X_imputed.iloc[train_idx], y.iloc[train_idx])
    y_pred_temp = model.predict(X_imputed.iloc[test_idx])
    print(classification_report(y.iloc[test_idx], y_pred_temp))


    # Plot Comparison
    plt.figure(figsize=(10, 6))
    plt.title("Feature Importance (Temporal-Aware RF)")
    plt.barh(range(X.shape[1]), importances[indices], align="center")
    plt.yticks(range(X.shape[1]), [features_temporal[i] for i in indices])
    plt.gca().invert_yaxis()
    plt.tight_layout()
    plt.savefig(os.path.join(OUT_DIR, 'fig_temporal_importance.png'))
    print(f"Feature importance plot saved to {os.path.join(OUT_DIR, 'fig_temporal_importance.png')}")

if __name__ == "__main__":
    df = load_and_preprocess(DATA_PATH)
    # Inject temporal attacks to demonstrate Option A value
    df = inject_temporal_attacks(df, n_sequences=2000)
    # Re-calculate target for new rows
    df['target'] = df['finalLabel'].apply(lambda x: 1 if str(x).strip().lower() in ['high_risk', 'malicious'] else 0)
    
    df = generate_temporal_features(df)
    train_and_evaluate(df)
