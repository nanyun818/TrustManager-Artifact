import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
import os

# Setup Style
plt.rcParams['font.family'] = 'serif'
plt.rcParams['font.serif'] = ['Times New Roman'] + plt.rcParams['font.serif']
plt.rcParams['axes.grid'] = True
plt.rcParams['grid.alpha'] = 0.3
plt.rcParams['figure.dpi'] = 300
plt.rcParams['font.size'] = 12

DATA_DIR = os.path.join('out', 'paper_data')
OUT_DIR = os.path.join('out', 'paper_plots')

if not os.path.exists(OUT_DIR):
    os.makedirs(OUT_DIR)

def plot_convergence():
    print("Generating Figure 1: Convergence Analysis...")
    df = pd.read_csv(os.path.join(DATA_DIR, 'experiment_convergence.csv'))
    
    plt.figure(figsize=(10, 6))
    
    # Pivot for easier plotting if needed, or iterate groups
    for node_type in df['node_type'].unique():
        subset = df[df['node_type'] == node_type]
        if node_type == 'Honest':
            color = 'green'
            style = '-'
        elif node_type == 'Malicious':
            color = 'red'
            style = '--'
        else:
            color = 'orange'
            style = '-.'
            
        plt.plot(subset['round'], subset['trust_score'], label=node_type, color=color, linestyle=style, linewidth=2)

    plt.title('Trust Score Convergence Over Time', fontweight='bold')
    plt.xlabel('Simulation Rounds (Epochs)')
    plt.ylabel('Trust Score (0-100)')
    plt.ylim(0, 105)
    plt.legend(loc='best', frameon=True)
    plt.tight_layout()
    plt.savefig(os.path.join(OUT_DIR, 'Fig1_Convergence.png'))
    plt.close()

def plot_on_off_attack():
    print("Generating Figure 2: On-Off Attack Resilience...")
    df = pd.read_csv(os.path.join(DATA_DIR, 'experiment_on_off_attack.csv'))
    
    plt.figure(figsize=(10, 6))
    
    plt.plot(df['round'], df['trust_score'], color='purple', linewidth=2.5, label='Trust Score')
    
    # Highlight Attack Phase (Round 31-40)
    plt.axvspan(30, 40, color='red', alpha=0.15, label='Attack Phase')
    
    # Annotations
    plt.annotate('Attack Starts', xy=(30, df[df['round']==30]['trust_score'].values[0]), 
                 xytext=(15, 60), arrowprops=dict(facecolor='black', shrink=0.05))
    
    plt.annotate('Sharp Drop\n(Punish Fast)', xy=(32, df[df['round']==32]['trust_score'].values[0]), 
                 xytext=(35, 20), arrowprops=dict(facecolor='red', shrink=0.05))
                 
    plt.annotate('Slow Recovery\n(Forgive Slow)', xy=(45, df[df['round']==45]['trust_score'].values[0]), 
                 xytext=(50, 40), arrowprops=dict(facecolor='blue', shrink=0.05))

    plt.title('System Resilience Against On-Off Attacks', fontweight='bold')
    plt.xlabel('Simulation Rounds')
    plt.ylabel('Trust Score')
    plt.ylim(0, 105)
    plt.legend(loc='upper right')
    plt.tight_layout()
    plt.savefig(os.path.join(OUT_DIR, 'Fig2_OnOff_Attack.png'))
    plt.close()

def plot_comparative():
    print("Generating Figure 3: Comparative Analysis...")
    df = pd.read_csv(os.path.join(DATA_DIR, 'experiment_comparative.csv'))
    
    plt.figure(figsize=(10, 6))
    
    # Plot both lines
    ours = df[df['model_type'].str.contains('Ours')]
    baseline = df[df['model_type'].str.contains('Baseline')]
    
    plt.plot(ours['round'], ours['trust_score'], label='Proposed Multi-Dim Model', color='blue', linewidth=2.5)
    plt.plot(baseline['round'], baseline['trust_score'], label='Baseline (Naive Avg)', color='gray', linestyle='--', linewidth=2)
    
    plt.fill_between(ours['round'], ours['trust_score'], baseline['trust_score'], color='gray', alpha=0.1, label='Detection Gap')

    plt.text(25, 85, "Baseline Fails to Detect\nHigh Latency", color='gray', ha='center')
    plt.text(25, 40, "Proposed Model\nCorrectly Penalizes", color='blue', ha='center')

    plt.title('Trust Assessment: High-Latency Node ("Laggy Node")', fontweight='bold')
    plt.xlabel('Simulation Rounds')
    plt.ylabel('Trust Score')
    plt.ylim(0, 105)
    plt.legend()
    plt.tight_layout()
    plt.savefig(os.path.join(OUT_DIR, 'Fig3_Comparative.png'))
    plt.close()

def plot_adaptive_test():
    # Load data
    df = pd.read_csv(os.path.join(DATA_DIR, 'experiment_adaptive.csv'))
    
    plt.figure(figsize=(10, 6))
    
    # Plot Static vs Adaptive
    plt.plot(df['round'], df['static_trust'], linestyle='--', color='gray', label='Static Parameters (Baseline)', linewidth=2)
    plt.plot(df['round'], df['adaptive_trust'], marker='o', color='green', label='Adaptive Parameters (Ours)', linewidth=2.5)
    
    # Highlight Congestion Zone
    plt.axvspan(20, 30, color='orange', alpha=0.2, label='Network Congestion (High Latency)')
    
    # Annotations
    plt.annotate('False Positive Drop\n(Misjudgment)', xy=(25, df[df['round']==25]['static_trust'].values[0]), 
                 xytext=(20, 40), arrowprops=dict(facecolor='black', shrink=0.05))
    
    plt.annotate('Robust Performance\n(Context Aware)', xy=(25, df[df['round']==25]['adaptive_trust'].values[0]), 
                 xytext=(32, 95), arrowprops=dict(facecolor='green', shrink=0.05))

    plt.title('Impact of Adaptive Parameter Adjustment under Network Storm', fontsize=14, fontweight='bold')
    plt.xlabel('Round', fontsize=12)
    plt.ylabel('Trust Score', fontsize=12)
    plt.ylim(0, 110)
    plt.grid(True, linestyle=':', alpha=0.6)
    plt.legend(loc='lower left')
    
    plt.tight_layout()
    plt.savefig(os.path.join(DATA_DIR, 'figure_adaptive_resilience.png'), dpi=300)
    print("✅ Generated figure_adaptive_resilience.png")

def plot_collusion_test():
    print("Generating Figure 5: Collusion Resistance...")
    df = pd.read_csv(os.path.join(DATA_DIR, 'experiment_collusion.csv'))
    
    # Group by 'group' and calculate mean
    summary = df.groupby('group')[['local_trust', 'global_trust']].mean().reset_index()
    
    fig, ax1 = plt.subplots(figsize=(10, 6))
    
    # Bar Chart
    x = range(len(summary))
    width = 0.35
    
    # Plot Local Trust (Left Axis)
    bars1 = ax1.bar([i - width/2 for i in x], summary['local_trust'] * 100, width, label='Local Trust (Naive)', color='gray', alpha=0.7)
    ax1.set_ylabel('Local Trust Score (0-100)', color='gray', fontsize=12)
    ax1.set_ylim(0, 110)
    ax1.tick_params(axis='y', labelcolor='gray')
    
    # Plot Global Trust (Right Axis)
    ax2 = ax1.twinx()
    # Normalize global trust to relative scale (x 1000 for visibility or relative to max)
    # Let's multiply by 100 to make it look like percentage share (approx)
    # Total sum is 1.0. With 15 nodes, avg is 0.06.
    # Honest should be > 0.06, Colluder < 0.06.
    # Let's scale by 100 to show "Market Share %"
    bars2 = ax2.bar([i + width/2 for i in x], summary['global_trust'] * 100, width, label='Global Trust (Rank %)', color='blue', alpha=0.9)
    ax2.set_ylabel('Global Trust Share (%)', color='blue', fontsize=12)
    ax2.tick_params(axis='y', labelcolor='blue')
    
    ax1.set_xticks(x)
    ax1.set_xticklabels(summary['group'], fontweight='bold', fontsize=12)
    ax1.set_title('Defense Against Decentralized Collusion (Sybil Clique)', fontsize=14, fontweight='bold')
    
    # Add values on top of bars
    for rect in bars1:
        height = rect.get_height()
        ax1.text(rect.get_x() + rect.get_width()/2., height,
                f'{height:.1f}', ha='center', va='bottom', color='gray')
                
    for rect in bars2:
        height = rect.get_height()
        ax2.text(rect.get_x() + rect.get_width()/2., height,
                f'{height:.2f}%', ha='center', va='bottom', color='blue')
    
    # Legend
    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc='upper center')
    
    plt.tight_layout()
    plt.savefig(os.path.join(OUT_DIR, 'Fig5_Collusion_Resistance.png'), dpi=300)
    print("✅ Generated Fig5_Collusion_Resistance.png")

def plot_gas_cost():
    print("Generating Figure 6: Gas Cost Analysis...")
    df = pd.read_csv(os.path.join(DATA_DIR, 'gas_cost_analysis.csv'))
    
    plt.figure(figsize=(10, 6))
    
    # Filter methods
    baseline = df[df['method'].str.contains('Baseline')]
    periodic = df[df['method'].str.contains('Periodic')]
    merkle = df[df['method'].str.contains('Merkle')]
    
    # Plot Log Scale due to huge difference
    plt.plot(baseline['nodes'], baseline['cost_usd_per_day'], marker='x', linestyle='--', color='red', label='Baseline (Per-Tx On-Chain)')
    plt.plot(periodic['nodes'], periodic['cost_usd_per_day'], marker='o', color='orange', label='Periodic Batch (Ours)')
    plt.plot(merkle['nodes'], merkle['cost_usd_per_day'], marker='s', color='green', label='Merkle Root (Optimized)')
    
    plt.yscale('log')
    plt.title('Scalability Analysis: Daily Gas Cost vs Network Size', fontsize=14, fontweight='bold')
    plt.xlabel('Number of Nodes', fontsize=12)
    plt.ylabel('Daily Cost (USD, Log Scale)', fontsize=12)
    plt.grid(True, which="both", ls="-", alpha=0.3)
    
    # Add currency formatter
    import matplotlib.ticker as mticker
    plt.gca().yaxis.set_major_formatter(mticker.StrMethodFormatter('${x:,.0f}'))
    
    plt.legend()
    plt.tight_layout()
    plt.savefig(os.path.join(OUT_DIR, 'Fig6_Gas_Scalability.png'), dpi=300)
    print("✅ Generated Fig6_Gas_Scalability.png")

def plot_trust_trend_overnight():
    print("Generating Figure: Trust Trend Overnight...")
    file_path = os.path.join('out', 'trust_trend_overnight.csv')
    if not os.path.exists(file_path):
        print(f"⚠️ Warning: {file_path} not found. Skipping.")
        return

    df = pd.read_csv(file_path)
    
    # Calculate average trust value per group per loop
    summary = df.groupby(['loop', 'group'])['trustValue'].mean().reset_index()
    
    plt.figure(figsize=(10, 6))
    
    groups = summary['group'].unique()
    colors = {'Honest': 'green', 'Malicious': 'red', 'Sybil': 'purple', 'Compromised': 'orange'}
    
    for group in groups:
        subset = summary[summary['group'] == group]
        color = colors.get(group, 'blue')
        plt.plot(subset['loop'], subset['trustValue'], label=group, color=color, linewidth=2)
    
    plt.title('Long-Term Trust Evolution (Overnight Test)', fontsize=14, fontweight='bold')
    plt.xlabel('Simulation Loop', fontsize=12)
    plt.ylabel('Average Trust Value', fontsize=12)
    plt.ylim(0, 210) # Max trust is 200
    plt.grid(True, linestyle=':', alpha=0.6)
    plt.legend(loc='best')
    
    plt.tight_layout()
    plt.savefig(os.path.join(OUT_DIR, 'Fig_Trust_Trend_Overnight.png'), dpi=300)
    print("✅ Generated Fig_Trust_Trend_Overnight.png")

def plot_ai_intervention():
    print("Generating Figure 4: AI Intervention Impact...")
    csv_path = os.path.join(DATA_DIR, 'experiment_ai_intervention.csv')
    if not os.path.exists(csv_path):
        print("Skipping Figure 4: Data not found.")
        return

    df = pd.read_csv(csv_path)
    
    plt.figure(figsize=(10, 6))
    
    # Plot line
    plt.plot(df['round'], df['trust_score'], color='darkblue', linewidth=3, marker='o', markersize=6, label='Trust Score')
    
    # Highlight Phases
    # Normal: 1-5
    # Degradation: 6-10
    # Penalized: 11-15
    # Recovery: 16-20
    
    plt.axvspan(6, 10, color='orange', alpha=0.1, label='Performance Degradation')
    plt.axvspan(11, 15, color='red', alpha=0.2, label='AI Intervention Active')
    
    # Annotations
    plt.annotate('AI Detects Risk\n(Risk Score set to 80%)', xy=(11, 104), 
                 xytext=(12, 140), arrowprops=dict(facecolor='red', shrink=0.05))
                 
    plt.annotate('Rapid Recovery\n(Risk Removed)', xy=(16, 200), 
                 xytext=(16, 150), arrowprops=dict(facecolor='green', shrink=0.05))

    plt.title('Impact of AI Oracle on Malicious Node Trust', fontweight='bold')
    plt.xlabel('Block Rounds')
    plt.ylabel('On-Chain Trust Score (0-200)')
    plt.ylim(0, 220)
    plt.grid(True, linestyle='--', alpha=0.7)
    plt.legend(loc='lower right')
    plt.tight_layout()
    plt.savefig(os.path.join(OUT_DIR, 'Fig4_AI_Intervention.png'))
    plt.close()

def plot_long_duration_stability():
    print("Generating Figure 7: Long Duration Stability...")
    csv_path = os.path.join('out', 'trust_trend_long_duration.csv')
    if not os.path.exists(csv_path):
        print("Skipping Figure 7: Data not found.")
        return

    df = pd.read_csv(csv_path)
    
    # Create Subplots: 1. Trust Trend, 2. Gas Cost
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 10), sharex=True)
    
    # 1. Trust Trend
    summary = df.groupby(['Round', 'Type'])['TrustScore'].mean().reset_index()
    types = summary['Type'].unique()
    colors = {'Honest': 'green', 'Unstable': 'orange', 'Malicious': 'red'}
    
    for t in types:
        subset = summary[summary['Type'] == t]
        ax1.plot(subset['Round'], subset['TrustScore'], label=t, color=colors.get(t, 'blue'), linewidth=2)
    
    ax1.set_title('(a) Trust Score Evolution over 500 Epochs (48h Simulated)', fontweight='bold')
    ax1.set_ylabel('Average Trust Score')
    ax1.set_ylim(0, 220)
    ax1.legend(loc='center right')
    ax1.grid(True, linestyle=':', alpha=0.6)

    # 2. Gas Cost Stability
    gas_summary = df.groupby('Round')['GasUsed'].mean().reset_index()
    ax2.plot(gas_summary['Round'], gas_summary['GasUsed'], color='purple', linewidth=1, alpha=0.7, label='Gas Cost per Tx')
    
    # Add Trend Line for Gas
    z = np.polyfit(gas_summary['Round'], gas_summary['GasUsed'], 1)
    p = np.poly1d(z)
    ax2.plot(gas_summary['Round'], p(gas_summary['Round']), "k--", linewidth=2, label=f'Trend: {z[0]:.4f} gas/round')

    ax2.set_title('(b) System Economic Stability (Gas Cost)', fontweight='bold')
    ax2.set_xlabel('Simulation Rounds')
    ax2.set_ylabel('Gas Used (Wei)')
    ax2.legend()
    ax2.grid(True, linestyle=':', alpha=0.6)
    
    plt.tight_layout()
    plt.savefig(os.path.join(OUT_DIR, 'Fig7_Long_Duration_Stability.png'), dpi=300)
    print("✅ Generated Fig7_Long_Duration_Stability.png")

def plot_sensitivity_analysis():
    print("Generating Figure 8: Parameter Sensitivity Heatmap...")
    csv_path = os.path.join(DATA_DIR, 'sensitivity_analysis.csv')
    if not os.path.exists(csv_path):
        print("Skipping Figure 8: Data not found.")
        return

    df = pd.read_csv(csv_path)
    
    # Pivot for Heatmap: X=Alpha, Y=Beta, Z=Score
    # Filter where Alpha + Beta <= 1.0
    pivot_table = df.pivot_table(index='beta', columns='alpha', values='trust_score')
    
    plt.figure(figsize=(8, 6))
    plt.imshow(pivot_table, cmap='RdYlGn', origin='lower', extent=[0, 1, 0, 1])
    plt.colorbar(label='Trust Score')
    
    plt.title('Parameter Sensitivity: Impact of Weight Configuration', fontweight='bold')
    plt.xlabel('Alpha (Weight for Success Rate)')
    plt.ylabel('Beta (Weight for Response Time)')
    
    # Add annotation for "Optimal Zone"
    plt.text(0.7, 0.2, "High Success\nDominates", color='white', fontweight='bold', ha='center')
    plt.text(0.2, 0.7, "High Latency\nPenalized", color='black', fontweight='bold', ha='center')

    plt.tight_layout()
    plt.savefig(os.path.join(OUT_DIR, 'Fig8_Sensitivity_Analysis.png'), dpi=300)
    print("✅ Generated Fig8_Sensitivity_Analysis.png")

def plot_feature_importance():
    print("Generating Figure 9: Feature Importance...")
    csv_path = os.path.join(DATA_DIR, 'feature_importance.csv')
    if not os.path.exists(csv_path):
        print("Skipping Figure 9: Data not found.")
        return

    df = pd.read_csv(csv_path)
    # Sort by importance
    df = df.sort_values('importance', ascending=True)

    plt.figure(figsize=(10, 6))
    bars = plt.barh(df['feature'], df['importance'], color='teal', alpha=0.8)
    
    plt.xlabel('Relative Importance Score')
    plt.title('Feature Importance for AI Risk Classification', fontweight='bold')
    plt.grid(axis='x', linestyle='--', alpha=0.5)
    
    # Add value labels
    for bar in bars:
        width = bar.get_width()
        plt.text(width + 0.01, bar.get_y() + bar.get_height()/2, 
                 f'{width:.4f}', va='center', fontsize=10)

    plt.tight_layout()
    plt.savefig(os.path.join(OUT_DIR, 'Fig9_Feature_Importance.png'))
    plt.close()
    print("✅ Generated Fig9_Feature_Importance.png")

if __name__ == "__main__":
    if os.path.exists(os.path.join(DATA_DIR, 'experiment_convergence.csv')):
        plot_convergence()
    if os.path.exists(os.path.join(DATA_DIR, 'experiment_on_off_attack.csv')):
        plot_on_off_attack()
    if os.path.exists(os.path.join(DATA_DIR, 'experiment_comparative.csv')):
        plot_comparative()
    
    # New experiments
    if os.path.exists(os.path.join(DATA_DIR, 'experiment_adaptive.csv')):
        plot_adaptive_test()
    if os.path.exists(os.path.join(DATA_DIR, 'experiment_collusion.csv')):
        plot_collusion_test()
    if os.path.exists(os.path.join(DATA_DIR, 'gas_cost_analysis.csv')):
        plot_gas_cost()
    if os.path.exists(os.path.join('out', 'trust_trend_overnight.csv')):
        plot_trust_trend_overnight()
        
    plot_ai_intervention()
    plot_long_duration_stability()
    plot_sensitivity_analysis()
    plot_feature_importance()
    print("All figures generated in out/paper_plots/")
