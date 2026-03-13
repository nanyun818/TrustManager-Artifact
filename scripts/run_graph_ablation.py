
import pandas as pd
import numpy as np
import networkx as nx
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import StratifiedKFold
from sklearn.metrics import f1_score, precision_score, recall_score
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer
import os
import matplotlib.pyplot as plt

# Configuration
DATA_PATH = 'out/multichain_dataset.csv'
OUT_DIR = 'paper_sections/figures'
os.makedirs(OUT_DIR, exist_ok=True)

def load_and_preprocess(path):
    print(f"Loading dataset from {path}...")
    df = pd.read_csv(path, low_memory=False)
    
    # Clean basic features
    numeric_cols = ['gasRatio', 'gasUsed', 'gas', 'unlimited', 'freshSpender']
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
    
    # Target
    df['target'] = df['finalLabel'].apply(lambda x: 1 if str(x).strip().lower() in ['high_risk', 'malicious'] else 0)
    
    # Timestamp for temporal order
    df['timeStamp'] = pd.to_numeric(df['timeStamp'], errors='coerce').fillna(0)
    df = df.sort_values('timeStamp')
    
    return df

def build_graph_features(df):
    print("Building Transaction Graph...")
    G = nx.from_pandas_edgelist(df, 'from', 'to', create_using=nx.DiGraph())
    
    # 1. PageRank
    print("Computing PageRank...")
    pagerank = nx.pagerank(G, alpha=0.85, max_iter=100)
    
    # 2. Degree Centrality
    print("Computing Degree Centrality...")
    in_degree = nx.in_degree_centrality(G)
    out_degree = nx.out_degree_centrality(G)
    
    # Map back to DataFrame
    df['sender_pagerank'] = df['from'].map(pagerank).fillna(0)
    df['sender_in_degree'] = df['from'].map(in_degree).fillna(0)
    df['sender_out_degree'] = df['from'].map(out_degree).fillna(0)
    
    df['receiver_pagerank'] = df['to'].map(pagerank).fillna(0)
    df['receiver_in_degree'] = df['to'].map(in_degree).fillna(0)
    
    return df

def get_temporal_features(df):
    print("Computing Temporal Features...")
    df['time_dt'] = pd.to_datetime(df['timeStamp'], unit='s')
    df = df.sort_values(['from', 'time_dt'])
    
    # 1. Time since last
    df['prev_time'] = df.groupby('from')['timeStamp'].shift(1)
    df['time_since_last'] = df['timeStamp'] - df['prev_time']
    df['time_since_last'] = df['time_since_last'].fillna(3600*24)
    
    # 2. Velocity (Rolling 1h)
    # Using simple rolling count on sorted data
    # Reset index to allow rolling on 'time_dt'
    df_indexed = df.set_index('time_dt').sort_index()
    
    # To correctly map back, we need to be careful. 
    # Simpler approach: groupby transform count for last 1h
    # But rolling on groupby is tricky with time index.
    # Let's use the method from train_gnn.py/train_temporal_rf.py which worked.
    
    # Re-sort by time_dt for rolling
    df_sorted = df.sort_values('time_dt')
    df_sorted = df_sorted.set_index('time_dt')
    
    # This is global rolling, not per-sender. 
    # The correct way per sender is:
    # df.groupby('from').rolling('1h', on='time_dt').count()
    # But that's slow.
    
    # Fast approximation used before:
    # If train_gnn.py used global rolling on filtered groups, it might be slow.
    # Let's stick to a simpler feature if velocity is complex:
    # Just use 'time_since_last' which is already computed.
    # Or reuse the logic from train_gnn.py if it works.
    
    # Logic from train_gnn.py:
    # df_indexed = df.set_index('time_dt')
    # grouped_time = df_indexed.groupby('from', sort=False)
    # velocity = grouped_time['timeStamp'].rolling('1h').count()
    # df['velocity_1h'] = velocity.values
    
    # We will assume train_gnn.py logic is correct enough for this ablation.
    # However, to avoid errors, we'll just use 'time_since_last' as the main temporal feature
    # and 'velocity_1h' if we can compute it safely.
    
    try:
        df_t = df.set_index('time_dt')
        # We need to sort by index for rolling
        df_t = df_t.sort_index() 
        # But we need to preserve 'from' grouping.
        # Let's just use a simplified velocity: count of txs in last 10 records
        # faster and robust.
        # df['velocity_10tx'] = df.groupby('from')['timeStamp'].diff(10).fillna(0)
        # Actually, let's stick to time_since_last as the temporal rep.
        pass
    except:
        pass

    return df

def run_ablation():
    df = load_and_preprocess(DATA_PATH)
    
    # Ensure address columns are strings
    df['from'] = df['from'].astype(str)
    df['to'] = df['to'].astype(str)
    
    # Add features
    df = get_temporal_features(df)
    df = build_graph_features(df)
    
    # Base Features
    base_features = ['gasRatio', 'gasUsed', 'gas', 'unlimited', 'freshSpender', 'time_since_last']
    
    # Graph Feature Sets
    graph_features_map = {
        'pagerank': ['sender_pagerank', 'receiver_pagerank'],
        'in_degree': ['sender_in_degree', 'receiver_in_degree'],
        'out_degree': ['sender_out_degree']
    }
    
    all_graph_features = []
    for feats in graph_features_map.values():
        all_graph_features.extend(feats)
        
    # Define Experiments
    experiments = {
        'Full Model (All Features)': base_features + all_graph_features,
        '- Remove PageRank': [f for f in base_features + all_graph_features if f not in graph_features_map['pagerank']],
        '- Remove In-Degree': [f for f in base_features + all_graph_features if f not in graph_features_map['in_degree']],
        '- Remove Out-Degree': [f for f in base_features + all_graph_features if f not in graph_features_map['out_degree']],
        'Baseline (No Graph)': base_features
    }
    
    results = []
    
    # Prepare Data Matrix
    # We use a fixed split for speed and consistency across ablations
    # (Using CV for every ablation takes too long for this interactive session, 
    # but we can use a single 5-fold run if dataset is small. 
    # Dataset is 600k? That's big.
    # Let's use a fixed 80/20 split.)
    
    y = df['target'].values
    
    # Pre-impute to save time
    print("Preparing data matrix...")
    # We need to select max features first to fit imputer/scaler
    # actually, let's just create the full X matrix and slice it.
    all_possible_features = base_features + all_graph_features
    X_full = df[all_possible_features].values
    
    imputer = SimpleImputer(strategy='mean')
    X_full = imputer.fit_transform(X_full)
    
    scaler = StandardScaler()
    X_full = scaler.fit_transform(X_full)
    
    # Create feature index map
    feat_to_idx = {f: i for i, f in enumerate(all_possible_features)}
    
    # Split
    from sklearn.model_selection import train_test_split
    # Stratified split
    X_train_full, X_test_full, y_train, y_test = train_test_split(
        X_full, y, test_size=0.2, random_state=42, stratify=y
    )
    
    print(f"Training set: {len(y_train)}, Test set: {len(y_test)}")
    
    for name, features in experiments.items():
        print(f"\n--- Running Experiment: {name} ---")
        
        # Select columns
        indices = [feat_to_idx[f] for f in features]
        X_train = X_train_full[:, indices]
        X_test = X_test_full[:, indices]
        
        # Train RF
        clf = RandomForestClassifier(n_estimators=100, max_depth=None, random_state=42, n_jobs=-1)
        clf.fit(X_train, y_train)
        
        y_pred = clf.predict(X_test)
        
        f1 = f1_score(y_test, y_pred)
        prec = precision_score(y_test, y_pred)
        rec = recall_score(y_test, y_pred)
        
        print(f"F1: {f1:.4f} | Prec: {prec:.4f} | Rec: {rec:.4f}")
        
        # Feature Importance for Full Model
        if name == 'Full Model (All Features)':
            importances = pd.DataFrame({
                'Feature': features,
                'Importance': clf.feature_importances_
            }).sort_values('Importance', ascending=False)
            print("\nFeature Importance (Top 10):")
            print(importances.head(10))
        
        results.append({
            'Experiment': name,
            'F1': f1,
            'Precision': prec,
            'Recall': rec,
            'Num_Features': len(features)
        })
        
    # Print Summary Table
    print("\n=== Ablation Results Summary ===")
    res_df = pd.DataFrame(results)
    print(res_df)
    
    # Calculate drops
    full_f1 = res_df.loc[res_df['Experiment'] == 'Full Model (All Features)', 'F1'].values[0]
    
    print("\n=== Impact Analysis (Drop in F1) ===")
    for idx, row in res_df.iterrows():
        if row['Experiment'] != 'Full Model (All Features)':
            drop = full_f1 - row['F1']
            print(f"{row['Experiment']}: -{drop:.4f} ({drop/full_f1*100:.2f}%)")

if __name__ == "__main__":
    run_ablation()
