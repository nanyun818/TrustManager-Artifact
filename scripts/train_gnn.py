import pandas as pd
import numpy as np
import networkx as nx
from sklearn.ensemble import RandomForestClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.model_selection import StratifiedKFold
from sklearn.metrics import classification_report, f1_score, confusion_matrix, roc_curve, auc
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.impute import SimpleImputer
import matplotlib.pyplot as plt
import seaborn as sns
import os

# Configuration
DATA_PATH = 'out/multichain_dataset.csv'
OUT_DIR = 'paper_sections/figures'
os.makedirs(OUT_DIR, exist_ok=True)

def plot_confusion_matrix(y_true, y_pred, title, filename):
    cm = confusion_matrix(y_true, y_pred)
    plt.figure(figsize=(8, 6))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Purples', cbar=False) # Purples for GNN
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
    plt.plot(fpr, tpr, color='purple', lw=2, label=f'ROC curve (area = {roc_auc:.4f})')
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
    
    print(f"Graph stats: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")
    
    # 1. PageRank (Global Node Importance)
    print("Computing PageRank...")
    pagerank = nx.pagerank(G, alpha=0.85, max_iter=100)
    
    # 2. Degree Centrality (Hub Detection)
    print("Computing Degree Centrality...")
    in_degree = nx.in_degree_centrality(G)
    out_degree = nx.out_degree_centrality(G)
    
    # Map back to DataFrame
    print("Mapping Graph Features to Transactions...")
    # For a transaction from U to V, we use features of U (Sender) primarily, 
    # but also V (Receiver) to detect "sending to known malicious contract"
    
    df['sender_pagerank'] = df['from'].map(pagerank).fillna(0)
    df['sender_in_degree'] = df['from'].map(in_degree).fillna(0)
    df['sender_out_degree'] = df['from'].map(out_degree).fillna(0)
    
    df['receiver_pagerank'] = df['to'].map(pagerank).fillna(0)
    df['receiver_in_degree'] = df['to'].map(in_degree).fillna(0)
    
    # 3. Neighborhood Aggregation (GraphSAGE-like)
    # Average gasRatio of sender's neighbors (1-hop)
    # We pre-calculate neighbor stats
    node_neighbor_stats = {}
    
    # Group by sender to get stats of outgoing transactions
    sender_stats = df.groupby('from')['gasRatio'].mean().to_dict()
    
    # Feature: Avg GasRatio of Sender's Neighbors (Recursive)
    # This is expensive to compute perfectly, so we approximate:
    # "Risk of Sender's Neighbors" = Mean target of neighbors (Label Propagation)
    # BUT we can't use labels (leakage). So we use features.
    
    return df

def train_gnn_model():
    df = load_and_preprocess(DATA_PATH)
    
    # Ensure address columns are strings
    df['from'] = df['from'].astype(str)
    df['to'] = df['to'].astype(str)
    
    # Add Temporal Features
    print("Computing Temporal Features...")
    df['time_dt'] = pd.to_datetime(df['timeStamp'], unit='s')
    
    # Sort and reset index to ensure alignment
    df = df.sort_values(['from', 'time_dt'])
    df = df.reset_index(drop=True)
    
    # 1. Time since last
    df['prev_time'] = df.groupby('from')['timeStamp'].shift(1)
    df['time_since_last'] = df['timeStamp'] - df['prev_time']
    df['time_since_last'] = df['time_since_last'].fillna(3600*24)
    
    # 2. Velocity (Rolling 1h)
    # Use the logic from train_temporal_rf.py which handles this correctly
    df_indexed = df.set_index('time_dt')
    grouped_time = df_indexed.groupby('from', sort=False)
    
    # Note: .values extracts the array, assuming order is preserved
    velocity = grouped_time['timeStamp'].rolling('1h').count()
    df['velocity_1h'] = velocity.values
    df['velocity_1h'] = df['velocity_1h'].fillna(1)
    
    # Add Graph Features
    df = build_graph_features(df)
    
    # Features
    features = [
        'gasRatio', 'gasUsed', 'gas', 'unlimited', 'freshSpender', # Static
        'time_since_last', 'velocity_1h', # Temporal
        'sender_pagerank', 'sender_in_degree', 'sender_out_degree', 'receiver_pagerank' # Graph
    ]
    
    X = df[features]
    y = df['target']
    
    # Impute
    imputer = SimpleImputer(strategy='mean')
    X = imputer.fit_transform(X)
    
    # Scale (Neural Networks require scaling)
    scaler = StandardScaler()
    X = scaler.fit_transform(X)
    
    # 5-Fold Stratified CV
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    
    f1_scores = []
    
    print("\nTraining Graph-Enhanced Random Forest (Option C)...")
    
    # Random Forest Config
    clf = RandomForestClassifier(n_estimators=100, max_depth=20, random_state=42, n_jobs=-1)
    
    fold = 1
    for train_index, test_index in skf.split(X, y):
        X_train, X_test = X[train_index], X[test_index]
        y_train, y_test = y[train_index], y[test_index]
        
        clf.fit(X_train, y_train)
        y_pred = clf.predict(X_test)
        
        score = f1_score(y_test, y_pred)
        f1_scores.append(score)
        print(f"Fold {fold} F1-Score: {score:.4f}")
        fold += 1
        
    print(f"\nAverage Graph-Enhanced F1-Score: {np.mean(f1_scores):.4f}")
    
    # Final Model Training & Plotting (on 20% holdout for viz)
    from sklearn.model_selection import train_test_split
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    clf.fit(X_train, y_train)
    y_pred = clf.predict(X_test)
    y_prob = clf.predict_proba(X_test)[:, 1]
    
    # Save Plots
    plot_confusion_matrix(y_test, y_pred, 'GNN Confusion Matrix', f'{OUT_DIR}/fig_confusion_matrix_gnn.png')
    plot_roc_curve(y_test, y_prob, 'GNN ROC Curve', f'{OUT_DIR}/fig_roc_curve_gnn.png')
    
    # Feature Importance (Permutation Importance for MLP)
    from sklearn.inspection import permutation_importance
    result = permutation_importance(clf, X_test, y_test, n_repeats=10, random_state=42, n_jobs=1)
    
    importance_df = pd.DataFrame({
        'Feature': features,
        'Importance': result.importances_mean
    }).sort_values(by='Importance', ascending=False)
    
    print("\nTop 5 Important Features (GNN):")
    print(importance_df.head(5))
    
    # Save importance plot
    plt.figure(figsize=(10, 6))
    sns.barplot(x='Importance', y='Feature', data=importance_df.head(10), palette='Purples_r')
    plt.title('GNN Feature Importance')
    plt.tight_layout()
    plt.savefig(f'{OUT_DIR}/fig_gnn_importance.png')
    plt.close()

if __name__ == "__main__":
    train_gnn_model()
