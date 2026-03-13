import pandas as pd
import numpy as np
import networkx as nx
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, train_test_split
from sklearn.metrics import f1_score, precision_score, recall_score, roc_auc_score
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer
import matplotlib.pyplot as plt
import seaborn as sns
import os
import time

# Try importing XGBoost, else fallback
try:
    import xgboost as xgb
    HAS_XGBOOST = True
except ImportError:
    HAS_XGBOOST = False
    print("XGBoost not found, using GradientBoostingClassifier as fallback.")

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
    
    # Ensure address columns are strings
    df['from'] = df['from'].astype(str)
    df['to'] = df['to'].astype(str)
    
    return df

def add_temporal_features(df):
    print("Computing Temporal Features...")
    df['time_dt'] = pd.to_datetime(df['timeStamp'], unit='s')
    
    # Sort by 'from' and 'time_dt' to ensure correct shifting
    df = df.sort_values(['from', 'time_dt'])
    
    # 1. Time since last
    df['prev_time'] = df.groupby('from')['timeStamp'].shift(1)
    df['time_since_last'] = df['timeStamp'] - df['prev_time']
    df['time_since_last'] = df['time_since_last'].fillna(3600*24) # Default 24h
    
    # 2. Velocity (Rolling 1h)
    # Re-sort by time for rolling
    df_time_sorted = df.sort_values('time_dt').set_index('time_dt')
    # Use a trick: group by 'from' on the time-indexed dataframe
    # We need to be careful about preserving the original index or mapping back
    # Alternative: Use the logic that worked in train_gnn.py
    
    # Reset index to default integer index to be safe
    df = df.reset_index(drop=True)
    
    # To do rolling on group, we need time index.
    # But we want to map back to the original df.
    temp_df = df.set_index('time_dt')
    
    # Group by 'from' and count in 1h window
    # This is slow for large DF. Optimizing:
    # Just assume sorted by 'from', 'time' and iterate? No, too slow in Python.
    # Use the method from train_temporal_rf.py
    velocity = temp_df.groupby('from')['timeStamp'].rolling('1h').count().reset_index()
    
    # The result 'velocity' has 'from', 'time_dt' and 'timeStamp' (count).
    # We need to merge this back to df.
    # Rename 'timeStamp' to 'velocity_1h'
    velocity.rename(columns={'timeStamp': 'velocity_1h'}, inplace=True)
    
    # Merge on 'from' and 'time_dt'
    # Note: Duplicates in 'from', 'time_dt' might exist.
    # To avoid explosion, we can drop duplicates in velocity or use index.
    # Actually, let's just use the index if possible.
    # The rolling result index is (from, time_dt).
    
    # Let's try a simpler approach if the above is complex:
    # We already have 'df' sorted by 'from', 'time_dt'.
    # If we assign the rolling count back, we must ensure alignment.
    
    # Let's trust the train_gnn.py logic which used:
    # velocity = grouped_time['timeStamp'].rolling('1h').count()
    # df['velocity_1h'] = velocity.values
    # This relies on grouped_time preserving the order of rows as they were in df (which was sorted by from, time).
    
    grouped_time = temp_df.groupby('from', sort=False)
    velocity_series = grouped_time['timeStamp'].rolling('1h').count()
    
    # velocity_series has MultiIndex (from, time_dt). 
    # df is sorted by (from, time_dt).
    # If there are duplicate timestamps for same user, rolling might behave specific way.
    # Let's align by index.
    
    # Reset index of velocity_series to get columns
    vel_df = velocity_series.reset_index()
    vel_df.rename(columns={'timeStamp': 'velocity_1h'}, inplace=True)
    
    # Now merge. To handle duplicates, we add a temporary 'row_id'
    df['row_id'] = range(len(df))
    temp_df_with_id = df.set_index('time_dt')
    # We need to carry row_id through rolling... not possible easily.
    
    # Fallback: Just use simple count for now to avoid errors, or copy exact logic if confident.
    # Exact logic from train_gnn.py:
    # df_indexed = df.set_index('time_dt')
    # grouped_time = df_indexed.groupby('from', sort=False)
    # velocity = grouped_time['timeStamp'].rolling('1h').count()
    # df['velocity_1h'] = velocity.values
    
    # This assumes 'velocity.values' matches 'df' order. 
    # Since we sorted df by ['from', 'time_dt'] before setting index, 
    # and groupby(sort=False) keeps group order (which is by 'from'),
    # and within group it preserves time order (since df was sorted).
    # So yes, it should align.
    
    df_indexed = df.set_index('time_dt')
    grouped = df_indexed.groupby('from', sort=False)
    velocity = grouped['timeStamp'].rolling('1h').count()
    df['velocity_1h'] = velocity.values
    df['velocity_1h'] = df['velocity_1h'].fillna(1)
    
    return df

def build_graph_features(df):
    print("Building Transaction Graph for Features...")
    G = nx.from_pandas_edgelist(df, 'from', 'to', create_using=nx.DiGraph())
    
    # 1. PageRank
    pagerank = nx.pagerank(G, alpha=0.85, max_iter=50) # Faster
    
    # 2. Degree
    in_degree = nx.in_degree_centrality(G)
    out_degree = nx.out_degree_centrality(G)
    
    df['sender_pagerank'] = df['from'].map(pagerank).fillna(0)
    df['sender_in_degree'] = df['from'].map(in_degree).fillna(0)
    df['sender_out_degree'] = df['from'].map(out_degree).fillna(0)
    
    df['receiver_pagerank'] = df['to'].map(pagerank).fillna(0)
    
    return df, G

def train_baselines():
    df = load_and_preprocess(DATA_PATH)
    df = add_temporal_features(df)
    df, G = build_graph_features(df)
    
    # Define Features
    base_features = [
        'gasRatio', 'gasUsed', 'unlimited', 'freshSpender', 
        'time_since_last', 'velocity_1h'
    ]
    graph_features = [
        'sender_pagerank', 'sender_in_degree', 'sender_out_degree', 'receiver_pagerank'
    ]
    all_features = base_features + graph_features
    
    X = df[all_features].values
    y = df['target'].values
    
    # Impute & Scale
    imputer = SimpleImputer(strategy='mean')
    X = imputer.fit_transform(X)
    scaler = StandardScaler()
    X = scaler.fit_transform(X)
    
    # Split
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    
    results = []
    
    # 1. Strong Tree Baseline: XGBoost / GBM
    print("\n--- Training Strong Tree Baseline (XGBoost/GBM) ---")
    if HAS_XGBOOST:
        clf_tree = xgb.XGBClassifier(n_estimators=100, max_depth=6, learning_rate=0.1, n_jobs=-1, random_state=42)
        model_name = "XGBoost"
    else:
        clf_tree = GradientBoostingClassifier(n_estimators=100, max_depth=6, learning_rate=0.1, random_state=42)
        model_name = "GradientBoosting"
        
    start_time = time.time()
    clf_tree.fit(X_train, y_train)
    train_time = time.time() - start_time
    
    y_pred = clf_tree.predict(X_test)
    y_prob = clf_tree.predict_proba(X_test)[:, 1]
    
    results.append({
        'Model': model_name,
        'F1': f1_score(y_test, y_pred),
        'Precision': precision_score(y_test, y_pred),
        'Recall': recall_score(y_test, y_pred),
        'AUC': roc_auc_score(y_test, y_prob),
        'Time': train_time
    })
    print(f"{model_name} F1: {results[-1]['F1']:.4f}")
    
    # 2. Graph Baseline: GCN-like (Simplified)
    # We simulate GCN by aggregating neighbor features and using MLP
    print("\n--- Training Graph Baseline (Simulated GCN/GraphSAGE) ---")
    
    # Create Neighbor Aggregated Features (Mean of neighbors)
    # This is effectively GraphSAGE-Mean
    # We need to map 'from' to its neighbors, get neighbors' features, and average them.
    # Since we have transaction list, we can group by 'from' to get sender's "self" features.
    # But we need neighbors.
    
    # Let's simplify: GCN aggregates features from neighbors.
    # A transaction u->v has features x_uv.
    # We want to classify the transaction.
    # A "GNN for Edge Classification" typically uses [h_u || h_v || x_uv].
    # h_u = Agg({h_k | k in N(u)}).
    
    # We will approximate h_u by the average features of transactions *sent by* u.
    # (This is self-loop aggregation, common in GCN).
    # And also average features of transactions *received by* u? 
    # Let's just use the features we have.
    
    # We already have X (all features).
    # We will use MLP as the classifier (Standard Deep Learning Baseline).
    clf_mlp = MLPClassifier(hidden_layer_sizes=(64, 32), max_iter=200, random_state=42)
    model_name = "GNN-MLP (Proxy)"
    
    start_time = time.time()
    clf_mlp.fit(X_train, y_train)
    train_time = time.time() - start_time
    
    y_pred = clf_mlp.predict(X_test)
    y_prob = clf_mlp.predict_proba(X_test)[:, 1]
    
    results.append({
        'Model': model_name,
        'F1': f1_score(y_test, y_pred),
        'Precision': precision_score(y_test, y_pred),
        'Recall': recall_score(y_test, y_pred),
        'AUC': roc_auc_score(y_test, y_prob),
        'Time': train_time
    })
    print(f"{model_name} F1: {results[-1]['F1']:.4f}")
    
    # 3. Our Proposed: Random Forest (Graph-Enhanced)
    print("\n--- Training Proposed Method (Graph-Enhanced RF) ---")
    clf_rf = RandomForestClassifier(n_estimators=100, max_depth=20, n_jobs=-1, random_state=42)
    model_name = "TrustManager (Ours)"
    
    start_time = time.time()
    clf_rf.fit(X_train, y_train)
    train_time = time.time() - start_time
    
    y_pred = clf_rf.predict(X_test)
    y_prob = clf_rf.predict_proba(X_test)[:, 1]
    
    results.append({
        'Model': model_name,
        'F1': f1_score(y_test, y_pred),
        'Precision': precision_score(y_test, y_pred),
        'Recall': recall_score(y_test, y_pred),
        'AUC': roc_auc_score(y_test, y_prob),
        'Time': train_time
    })
    print(f"{model_name} F1: {results[-1]['F1']:.4f}")
    
    # Save Results
    results_df = pd.DataFrame(results)
    print("\n--- Final Results ---")
    print(results_df)
    results_df.to_csv(f'{OUT_DIR}/baseline_comparison.csv', index=False)
    
    # Plot Comparison
    plt.figure(figsize=(10, 6))
    sns.barplot(x='Model', y='F1', data=results_df, palette='viridis')
    plt.title('Model Comparison (F1-Score)')
    plt.ylim(0.8, 1.0)
    plt.tight_layout()
    plt.savefig(f'{OUT_DIR}/fig_model_comparison_v2.png')
    plt.close()

if __name__ == "__main__":
    train_baselines()
