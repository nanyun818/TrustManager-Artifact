import matplotlib.pyplot as plt
import numpy as np
import seaborn as sns
import pandas as pd
import os

# Setup Style
plt.rcParams['font.family'] = 'serif'
plt.rcParams['font.serif'] = ['Times New Roman'] + plt.rcParams['font.serif']
plt.rcParams['axes.grid'] = True
plt.rcParams['grid.alpha'] = 0.3
plt.rcParams['figure.dpi'] = 300
plt.rcParams['font.size'] = 14

OUT_DIR = os.path.join('paper_sections', 'figures')
if not os.path.exists(OUT_DIR):
    os.makedirs(OUT_DIR)

def plot_confusion_matrix():
    print("Generating Figure: Confusion Matrix...")
    # Data from Rigorous Evaluation (RF)
    # TP=24488, FN=512, FP=4422, TN=531512
    cm = np.array([[531512, 4422], [512, 24488]])
    
    plt.figure(figsize=(8, 6))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', cbar=False,
                xticklabels=['Legitimate', 'Malicious'],
                yticklabels=['Legitimate', 'Malicious'],
                annot_kws={"size": 16, "weight": "bold"})
    
    plt.title('Confusion Matrix (Test Set)', fontweight='bold', pad=20)
    plt.xlabel('Predicted Label', fontweight='bold')
    plt.ylabel('True Label', fontweight='bold')
    plt.tight_layout()
    plt.savefig(os.path.join(OUT_DIR, 'fig_confusion_matrix.png'))
    plt.close()

def plot_ablation_study():
    print("Generating Figure: Ablation Study...")
    # Data from Run Ablation
    variants = ['Full Model', 'w/o Unlimited', 'w/o Freshness', 'w/o FreqSpike', 'w/o GasRatio']
    f1_scores = [93.0, 93.1, 93.1, 93.0, 68.2]
    
    colors = ['#2ca02c', '#2ca02c', '#2ca02c', '#2ca02c', '#d62728'] # Red for massive drop
    
    plt.figure(figsize=(10, 6))
    bars = plt.barh(variants[::-1], f1_scores[::-1], color=colors[::-1])
    
    plt.xlabel('F1-Score (%)', fontweight='bold')
    plt.title('Ablation Study: Criticality of GasRatio', fontweight='bold')
    plt.xlim(0, 100)
    
    # Add value labels
    for bar in bars:
        width = bar.get_width()
        plt.text(width + 1, bar.get_y() + bar.get_height()/2, f'{width:.1f}%', 
                 va='center', fontweight='bold')
        
    plt.tight_layout()
    plt.savefig(os.path.join(OUT_DIR, 'fig_ablation_study.png'))
    plt.close()

def plot_feature_importance():
    print("Generating Figure: Feature Importance...")
    # Data from Run Ablation (Feature Importances)
    features = ['Gas Ratio', 'Freshness', 'Unlimited', 'Others']
    importance = [0.42, 0.33, 0.25, 0.00] 
    
    plt.figure(figsize=(8, 6))
    plt.pie(importance, labels=features, autopct='%1.1f%%', startangle=140, 
            colors=sns.color_palette('pastel'), explode=(0.1, 0, 0, 0))
    plt.title('Feature Importance Distribution', fontweight='bold')
    plt.tight_layout()
    plt.savefig(os.path.join(OUT_DIR, 'fig_feature_importance.png'))
    plt.close()

def plot_model_comparison():
    print("Generating Figure: Model Comparison...")
    # Data from Rigorous Evaluation
    models = ['Rule-Based', 'Logistic Regression', 'Gradient Boosting', 'TrustManager (RF)']
    f1_scores = [14.0, 48.0, 89.9, 93.1]
    
    plt.figure(figsize=(10, 6))
    bars = plt.bar(models, f1_scores, color=['#7f7f7f', '#1f77b4', '#ff7f0e', '#2ca02c'])
    
    plt.ylabel('F1-Score (%)', fontweight='bold')
    plt.title('Performance Comparison with Baselines', fontweight='bold')
    plt.ylim(0, 100)
    
    for bar in bars:
        height = bar.get_height()
        plt.text(bar.get_x() + bar.get_width()/2., height + 1,
                 f'{height:.1f}%', ha='center', va='bottom', fontweight='bold')
    
    plt.tight_layout()
    plt.savefig(os.path.join(OUT_DIR, 'fig_model_comparison.png'))
    plt.close()

if __name__ == "__main__":
    plot_confusion_matrix()
    plot_ablation_study()
    plot_feature_importance()
    plot_model_comparison()
