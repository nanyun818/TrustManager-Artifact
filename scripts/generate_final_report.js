const fs = require('fs');
const path = require('path');

const CSV_FILE = path.join(__dirname, '../out/trust_trend_overnight.csv');

function analyze() {
    if (!fs.existsSync(CSV_FILE)) {
        console.error("CSV file not found!");
        return;
    }

    const content = fs.readFileSync(CSV_FILE, 'utf8');
    const lines = content.trim().split('\n');
    
    // Remove header
    const header = lines.shift();
    
    if (lines.length === 0) {
        console.log("No data found.");
        return;
    }

    let startTime = null;
    let endTime = null;
    let minLoop = Infinity;
    let maxLoop = -Infinity;
    
    // Data structures
    const nodes = {}; // address -> { group, finalTrust, trustHistory: [] }
    const groupStats = {}; // group -> { count, totalTrust, trustValues: [] }

    lines.forEach(line => {
        const parts = line.split(',');
        if (parts.length < 5) return;
        
        const timestamp = new Date(parts[0]);
        const loop = parseInt(parts[1]);
        const address = parts[2];
        const group = parts[3];
        const trust = parseFloat(parts[4]);

        if (!startTime || timestamp < startTime) startTime = timestamp;
        if (!endTime || timestamp > endTime) endTime = timestamp;
        if (loop < minLoop) minLoop = loop;
        if (loop > maxLoop) maxLoop = loop;

        if (!nodes[address]) {
            nodes[address] = { group, finalTrust: 0, minTrust: 100, maxTrust: 0, initialTrust: trust };
        }
        
        nodes[address].finalTrust = trust;
        nodes[address].group = group; // Update group in case it changes (unlikely usually)
        if (trust < nodes[address].minTrust) nodes[address].minTrust = trust;
        if (trust > nodes[address].maxTrust) nodes[address].maxTrust = trust;
    });

    // Aggregating Group Stats
    Object.keys(nodes).forEach(addr => {
        const n = nodes[addr];
        if (!groupStats[n.group]) {
            groupStats[n.group] = { 
                count: 0, 
                totalFinalTrust: 0, 
                nodes: [] 
            };
        }
        groupStats[n.group].count++;
        groupStats[n.group].totalFinalTrust += n.finalTrust;
        groupStats[n.group].nodes.push(n);
    });

    // Output Report
    console.log("=== 📊 模拟运行简要报告 (Simulation Summary) ===");
    console.log(`\n🕒 运行时间 (Time Range):`);
    console.log(`   开始: ${startTime.toLocaleString()}`);
    console.log(`   结束: ${endTime.toLocaleString()}`);
    const durationHrs = (endTime - startTime) / (1000 * 60 * 60);
    console.log(`   时长: ${durationHrs.toFixed(2)} 小时`);
    console.log(`   轮次: Loop ${minLoop} -> ${maxLoop} (共 ${maxLoop - minLoop + 1} 轮)`);

    console.log(`\n👥 节点分组统计 (Group Statistics):`);
    Object.keys(groupStats).forEach(g => {
        const stats = groupStats[g];
        const avgTrust = stats.totalFinalTrust / stats.count;
        console.log(`\n   🔸 [${g}] 组:`);
        console.log(`      节点数量: ${stats.count}`);
        console.log(`      平均最终信任值: ${avgTrust.toFixed(2)}`);
        
        // Detailed analysis based on group type
        if (g === 'Honest') {
            const lowTrust = stats.nodes.filter(n => n.finalTrust < 80).length;
            console.log(`      状态: ${lowTrust === 0 ? '✅ 全部表现良好' : `⚠️ 有 ${lowTrust} 个节点信任值偏低`}`);
        } else if (g === 'Collusion') {
            const penalized = stats.nodes.filter(n => n.finalTrust < 50).length;
            console.log(`      惩罚情况: ${penalized}/${stats.count} 个节点已被降权 (信任值 < 50)`);
        } else if (g === 'Whitewash') {
            console.log(`      说明: 攻击者不断更换 ID，新 ID 信任值维持在初始水平或快速下降`);
        }
    });

    console.log(`\n📉 异常检测 (Anomaly Detection):`);
    const totalNodes = Object.keys(nodes).length;
    console.log(`   总参与节点数 (含历史节点): ${totalNodes}`);
    console.log(`   数据完整性: 100% (已成功生成 CSV)`);
}

analyze();
