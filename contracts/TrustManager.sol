// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title TrustManager
 * @dev 基于区块链的多节点网络信任管理智能合约
 * 实现节点信任评估、动态惩奖、邻域推荐和可追溯记录
 */
contract TrustManager {
    
    // ========== 数据结构定义 ==========
    
    /**
     * @dev 节点信息结构体
     */
    struct Node {
        address nodeAddress;          // 节点地址
        uint trustValue;              // 当前信任值 (0-200)
        uint successRate;             // 交易成功率 (0-100)
        uint responseTime;            // 平均响应时间(ms)
        uint onlineTime;              // 在线时长(秒)
        uint interactionCount;        // 交互次数
        uint lastUpdated;             // 最后更新时间
        bool isActive;                // 节点是否激活
        bool isBlacklisted;           // 是否被列入黑名单
    }
    
    /**
     * @dev 邻域推荐结构体
     */
    struct Recommendation {
        address recommender;          // 推荐者地址
        uint recommendValue;          // 推荐信任值
        uint weight;                  // 推荐权重
        uint timestamp;               // 推荐时间
    }
    
    /**
     * @dev 信任历史记录结构体
     */
    struct TrustHistory {
        uint oldValue;                // 旧信任值
        uint newValue;                // 新信任值
        string reason;                // 变更原因
        uint timestamp;               // 变更时间
    }
    
    // ========== 状态变量 ==========
    
    mapping(address => Node) public nodes;                                    // 节点映射
    mapping(address => Recommendation[]) public recommendations;              // 节点推荐记录
    mapping(address => TrustHistory[]) public trustHistories;                // 信任值历史
    mapping(address => mapping(address => uint)) public interactionWeights;  // 节点间交互权重
    
    address[] public nodeList;                                                // 所有节点地址列表
    address public owner;                                                     // 合约所有者
    
    // 信任值阈值配置
    uint public constant MAX_TRUST_VALUE = 200;           // 最大信任值
    uint public constant INITIAL_TRUST_VALUE = 100;       // 初始信任值
    uint public constant BLACKLIST_THRESHOLD = 80;        // 黑名单阈值 (Increased for stronger defense)
    uint public constant WARNING_THRESHOLD = 90;          // 警告阈值
    uint public constant HIGH_TRUST_THRESHOLD = 150;      // 高信任阈值
    
    // 权重系数 (basis points, 1 bp = 0.01%)
    uint public weightAlpha = 4000;    // α = 0.4
    uint public weightBeta = 3000;     // β = 0.3
    uint public weightGamma = 3000;    // γ = 0.3
    uint public lambdaFusion = 7000;   // λ = 0.7 (融合系数)
    uint public weightTheta = 5000;    // θ = 0.5 (Risk Penalty Weight)
    
    // --- New: Adaptive Parameters State ---
    uint public globalLatencySum;
    uint public globalLatencyCount;
    bool public adaptiveModeEnabled = true;

    uint public responseTimeCap = 1000;
    uint public onlineMaxSeconds = 3600;
    uint public decayPerHourBp = 0;
    uint public penaltyBp = 0;
    mapping(address => uint) public nodeRiskExposure;
    mapping(address => uint) public anomalyWindowUntil;
    mapping(address => uint) public penaltyBpPerNode;
    
    // --- New: EigenTrust Lite State ---
    mapping(address => address[]) public nodeNeighbors; // Adjacency list (Who does node I trust?)
    mapping(address => address[]) public trustedBy;    // Reverse Adjacency list (Who trusts this node?)
    
    // --- New: AI Oracle State (Deprecated mapping, using single agent for simple demo) ---
    // mapping(address => bool) public aiAgents; 
    // event AIAgentUpdated(address indexed agent, bool status);
    event NodeRiskScoreUpdated(address indexed node, uint riskScore, string reason);

    // ... (rest of state vars)

    // --- 熔断/限流/黑名单（spender）扩展 ---
    bool public paused;                                    // 合约暂停状态
    mapping(address => uint256) public spendCaps;          // 代币限额（token => cap）
    mapping(address => bool) public blockedSpenders;       // 黑名单（spender => blocked）
    
    // ========== 事件定义 ==========
    
    event NodeRegistered(address indexed node, uint timestamp);
    event TrustValueUpdated(address indexed node, uint oldValue, uint newValue, string reason, uint timestamp);
    event NodeBlacklisted(address indexed node, uint trustValue, uint timestamp);
    event NodeRemovedFromBlacklist(address indexed node, uint timestamp);
    event RecommendationAdded(address indexed node, address indexed recommender, uint recommendValue, uint weight);
    event InteractionRecorded(address indexed node1, address indexed node2, uint weight);
    event NodeDeactivated(address indexed node, uint timestamp);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event SpendLimitUpdated(address indexed token, uint256 cap);
    event SpenderBlocked(address indexed spender);
    event SpenderUnblocked(address indexed spender);
    event NodePenaltyUpdated(address indexed node, uint bp);
    
    // ========== 修饰器 ==========
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }
    
    modifier onlyActiveNode(address _node) {
        require(nodes[_node].isActive, "Node is not active");
        require(!nodes[_node].isBlacklisted, "Node is blacklisted");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "PAUSED");
        _;
    }
    
    // ========== 构造函数 ==========
    
    constructor() {
        owner = msg.sender;
    }

    // ========== 熔断/限流/黑名单控制 ==========

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setSpendLimit(address token, uint256 cap) external onlyOwner {
        spendCaps[token] = cap;
        emit SpendLimitUpdated(token, cap);
    }

    function blockSpender(address spender) external onlyOwner {
        blockedSpenders[spender] = true;
        emit SpenderBlocked(spender);
    }

    function unblockSpender(address spender) external onlyOwner {
        blockedSpenders[spender] = false;
        emit SpenderUnblocked(spender);
    }
    
    // ========== 核心功能函数 ==========
    
    /**
     * @dev 注册新节点
     * @param _node 节点地址
     */
    function registerNode(address _node) public {
        require(_node != address(0), "Invalid node address");
        require(!nodes[_node].isActive, "Node already registered");
        
        nodes[_node] = Node({
            nodeAddress: _node,
            trustValue: INITIAL_TRUST_VALUE,
            successRate: 100,
            responseTime: 100, // 初始值设为 100ms
            onlineTime: 0,
            interactionCount: 0,
            lastUpdated: block.timestamp,
            isActive: true, // 关键：设置为 true
            isBlacklisted: false
        });
        
        nodeList.push(_node);
        
        // 记录历史
        trustHistories[_node].push(TrustHistory({
            oldValue: 0,
            newValue: INITIAL_TRUST_VALUE,
            reason: "Node Registration",
            timestamp: block.timestamp
        }));
        
        emit NodeRegistered(_node, block.timestamp);
        // 注意：不再调用 _calculateAndUpdateTrustValue，因为初始值可能不合适
    }
    
    /**
     * @dev 更新节点行为指标 (Enhanced with Global Context Awareness)
     */
    function updateNodeMetrics(
        address _node,
        uint _successRate,
        uint _responseTime,
        uint _onlineTime
    ) public onlyActiveNode(_node) {
        require(_successRate <= 100, "Success rate must be <= 100");
        
        Node storage node = nodes[_node];
        node.successRate = _successRate;
        node.responseTime = _responseTime;
        node.onlineTime += _onlineTime;
        node.interactionCount++;
        node.lastUpdated = block.timestamp;

        // Update Global Network State (for Adaptive Logic)
        if (adaptiveModeEnabled) {
            globalLatencySum += _responseTime;
            globalLatencyCount++;
        }
        
        // 自动计算并更新信任值
        _calculateAndUpdateTrustValue(_node);
    }
    
    // AI Agent State (Deprecated single agent, moved to Decentralized Oracle Network)
    address public aiAgent; // Kept for backward compatibility
    
    // --- Decentralized Oracle Network (DON) State ---
    mapping(address => bool) public authorizedOracles;
    uint256 public constant MIN_ORACLE_VOTES = 3; // Require 3-of-N consensus
    
    uint256 public currentEpoch;
    bytes32 public trustRoot; // The consensus Merkle Root of Risk Scores
    
    mapping(uint256 => mapping(bytes32 => uint256)) public rootVotes; // epoch -> root -> voteCount
    mapping(uint256 => mapping(address => bool)) public hasVoted;     // epoch -> oracle -> hasVoted
    
    event OracleAuthorized(address indexed oracle, bool status);
    event TrustRootProposed(uint256 indexed epoch, bytes32 indexed root, address indexed oracle);
    event TrustRootUpdated(uint256 indexed epoch, bytes32 root);

    modifier onlyOracle() {
        require(authorizedOracles[msg.sender], "Not an authorized Oracle");
        _;
    }

    // Admin function to manage Oracles
    function setOracleStatus(address _oracle, bool _status) external onlyOwner {
        authorizedOracles[_oracle] = _status;
        emit OracleAuthorized(_oracle, _status);
    }

    // 1. Submit Vote for Trust Root
    function submitTrustRoot(bytes32 _root) external onlyOracle {
        require(!hasVoted[currentEpoch][msg.sender], "Already voted in this epoch");
        
        hasVoted[currentEpoch][msg.sender] = true;
        rootVotes[currentEpoch][_root]++;
        
        emit TrustRootProposed(currentEpoch, _root, msg.sender);
        
        // Check Consensus
        if (rootVotes[currentEpoch][_root] >= MIN_ORACLE_VOTES) {
            trustRoot = _root;
            emit TrustRootUpdated(currentEpoch, _root);
            currentEpoch++; // Move to next epoch to prevent replay/confusion
        }
    }
    
    // 2. Verify and Update Risk Score using Merkle Proof
    function proveNodeRisk(
        address _node, 
        uint256 _riskScore, 
        bytes32[] calldata _proof
    ) external {
        require(trustRoot != bytes32(0), "Trust Root not set");
        
        // Verify Merkle Proof
        bytes32 leaf = keccak256(abi.encodePacked(_node, _riskScore));
        require(verifyProof(_proof, trustRoot, leaf), "Invalid Merkle Proof");
        
        // Update State
        nodeRiskExposure[_node] = _riskScore;
        
        // Trigger Trust Recalculation
        if (nodes[_node].isActive) {
            // Need to wrap private function call or duplicate logic?
            // Since _calculateAndUpdateTrustValue is private, we can call it here as we are inside the contract
            _calculateAndUpdateTrustValue(_node);
        }
        
        emit NodeRiskScoreUpdated(_node, _riskScore, "Verified via Merkle Proof");
    }
    
    // Merkle Verification Helper
    function verifyProof(bytes32[] memory proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        bytes32 computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];
            if (computedHash <= proofElement) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }
        return computedHash == root;
    }

    // 3. Cross-Chain Verification (Relayer Protocol)
    event CrossChainTrustSynced(uint256 indexed sourceChainId, address indexed node, uint256 riskScore);
    
    struct CrossChainProof {
        uint256 sourceChainId;
        address node;
        uint256 riskScore;
        uint256 timestamp;
        bytes signature; // Signed by a quorum of Oracles on Source Chain
    }
    
    mapping(bytes32 => bool) public processedCrossChainProofs;

    function verifyCrossChainProof(CrossChainProof calldata _proof) external {
        // Prevent replay attacks
        bytes32 proofHash = keccak256(abi.encode(_proof.sourceChainId, _proof.node, _proof.riskScore, _proof.timestamp, _proof.signature));
        require(!processedCrossChainProofs[proofHash], "Proof already processed");
        
        // Check freshness (e.g., within 1 hour)
        require(block.timestamp - _proof.timestamp < 1 hours, "Proof expired");
        
        // Verify Signature (Simplified: Assume single authorized signer for MVP)
        // In production, this would verify a Threshold Signature (BLS) or Multi-sig
        bytes32 messageHash = keccak256(abi.encodePacked(_proof.sourceChainId, _proof.node, _proof.riskScore, _proof.timestamp));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        
        address signer = recoverSigner(ethSignedMessageHash, _proof.signature);
        require(authorizedOracles[signer], "Invalid Cross-Chain Signer");
        
        // Apply Trust Update
        processedCrossChainProofs[proofHash] = true;
        nodeRiskExposure[_proof.node] = _proof.riskScore;
        
        if (nodes[_proof.node].isActive) {
            _calculateAndUpdateTrustValue(_proof.node);
        }
        
        emit CrossChainTrustSynced(_proof.sourceChainId, _proof.node, _proof.riskScore);
    }
    
    function recoverSigner(bytes32 _ethSignedMessageHash, bytes memory _signature) internal pure returns (address) {
        (bytes32 r, bytes32 s, uint8 v) = splitSignature(_signature);
        return ecrecover(_ethSignedMessageHash, v, r, s);
    }

    function splitSignature(bytes memory sig) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
        require(sig.length == 65, "Invalid signature length");
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
    }

    function setAiAgent(address _aiAgent) external onlyOwner {
        aiAgent = _aiAgent;
    }

    function setNodeRiskScore(address _node, uint256 _riskScore) external {
        // Allow both old AI Agent and Owner to force update
        require(msg.sender == aiAgent || msg.sender == owner, "Not authorized");
        require(nodes[_node].isActive, "Node not active");
        require(_riskScore <= 100, "Risk score > 100");
        nodeRiskExposure[_node] = _riskScore;
        _calculateAndUpdateTrustValue(_node);
    }

    // --- Internal Helpers to Avoid Stack Too Deep ---

    function _calculateBaseTrust(address _node, uint currentAlpha, uint currentBeta, uint currentGamma) private view returns (uint) {
        Node storage node = nodes[_node];
        uint normalizedSuccessRate = node.successRate;
        
        uint rt = node.responseTime > responseTimeCap ? responseTimeCap : node.responseTime;
        uint normalizedResponseInverse;
        if (rt == 0) {
            normalizedResponseInverse = 100;
        } else {
            uint rawValue = (responseTimeCap * 100) / (rt + 10);
            normalizedResponseInverse = rawValue > 100 ? 100 : rawValue;
        }

        uint maxSec = onlineMaxSeconds;
        uint normalizedOnlineTime = node.onlineTime > maxSec ? 100 : (node.onlineTime * 100) / maxSec;

        return (
            currentAlpha * normalizedSuccessRate +
            currentBeta * normalizedResponseInverse +
            currentGamma * normalizedOnlineTime
        ) / 10000;
    }

    function _calculateAndUpdateTrustValue(address _node) private {
        Node storage node = nodes[_node];
        uint oldTrustValue = node.trustValue;
        
        uint currentAlpha = weightAlpha;
        uint currentBeta = weightBeta;
        uint currentGamma = weightGamma;

        if (adaptiveModeEnabled && globalLatencyCount > 0) {
            uint avgLatency = globalLatencySum / globalLatencyCount;
            if (avgLatency > 500) {
                currentAlpha = 7000; 
                currentBeta = 0;     
                currentGamma = 3000; 
            }
        }

        uint calculatedTrust = _calculateBaseTrust(_node, currentAlpha, currentBeta, currentGamma);

        uint risk = nodeRiskExposure[_node];
        if (risk > 100) risk = 100;
        uint riskPenalty = (weightTheta * risk) / 10000;
        
        uint newTrustValue = calculatedTrust > riskPenalty ? calculatedTrust - riskPenalty : 0;
        
        // Scale to 0-200
        newTrustValue = (newTrustValue * MAX_TRUST_VALUE) / 100;

        // Apply Anomaly Penalty
        uint p = penaltyBpPerNode[_node];
        if (p == 0) { p = penaltyBp; }
        if (anomalyWindowUntil[_node] > block.timestamp && p > 0) {
            if (p > 10000) p = 10000;
            newTrustValue = (newTrustValue * (10000 - p)) / 10000;
        }

        // Apply Decay
        if (decayPerHourBp > 0) {
            uint dt = (block.timestamp - node.lastUpdated) / 3600;
            if (dt > 0) {
                uint dec = decayPerHourBp * dt;
                if (dec > 10000) dec = 10000;
                newTrustValue = (newTrustValue * (10000 - dec)) / 10000;
            }
        }
        
        uint finalTrustValue = _applyNeighborhoodRecommendation(_node, newTrustValue);
        
        node.trustValue = finalTrustValue;
        
        trustHistories[_node].push(TrustHistory({
            oldValue: oldTrustValue,
            newValue: finalTrustValue,
            reason: "Automatic Calculation",
            timestamp: block.timestamp
        }));
        
        emit TrustValueUpdated(_node, oldTrustValue, finalTrustValue, "Metrics Updated", block.timestamp);
        
        _checkAndApplyPenalty(_node);
    }
    
    /**
     * @dev 建立信任关系 (Simplified EigenTrust Link)
     * msg.sender 信任 _target
     */
    function trustNode(address _target) public onlyActiveNode(msg.sender) onlyActiveNode(_target) whenNotPaused {
        require(msg.sender != _target, "Cannot trust self");
        
        // 检查是否重复 (简单线性检查，生产环境可用 EnumerableSet)
        bool exists = false;
        address[] storage neighbors = nodeNeighbors[msg.sender];
        for(uint i = 0; i < neighbors.length; i++) {
            if(neighbors[i] == _target) {
                exists = true;
                break;
            }
        }
        
        if(!exists) {
            nodeNeighbors[msg.sender].push(_target);
            trustedBy[_target].push(msg.sender); // 维护反向索引用于 EigenTrust 计算
            emit InteractionRecorded(msg.sender, _target, 100);
        }
    }

    /**
     * @dev 应用邻域推荐机制 (Upgraded to EigenTrust Lite)
     * 优先使用动态图结构 (trustedBy)，回退到静态推荐 (recommendations)
     * 公式: T_final = λ * T_self + (1-λ) * Avg(Trust(Neighbors))
     */
    function _applyNeighborhoodRecommendation(address _node, uint _selfTrust) private view returns (uint) {
        // 1. 尝试使用 EigenTrust Lite (动态图)
        address[] storage incoming = trustedBy[_node];
        if (incoming.length > 0) {
            uint totalNeighborTrust = 0;
            uint validCount = 0;
            // 限制遍历数量以防 Gas 耗尽 (取最后 20 个)
            uint start = incoming.length > 20 ? incoming.length - 20 : 0;
            for (uint i = start; i < incoming.length; i++) {
                address neighbor = incoming[i];
                if (nodes[neighbor].isActive && !nodes[neighbor].isBlacklisted) {
                    totalNeighborTrust += nodes[neighbor].trustValue;
                    validCount++;
                }
            }
            
            if (validCount > 0) {
                uint socialTrust = totalNeighborTrust / validCount;
                return (lambdaFusion * _selfTrust + (10000 - lambdaFusion) * socialTrust) / 10000;
            }
        }

        // 2. 回退到旧的静态推荐机制
        Recommendation[] storage recs = recommendations[_node];
        
        if (recs.length == 0) {
            return _selfTrust; // 没有推荐，直接返回自身信任值
        }
        
        uint weightedSum = 0;
        uint totalWeight = 0;
        
        // 计算加权平均，只考虑最近7天的推荐
        for (uint i = 0; i < recs.length; i++) {
            if (block.timestamp - recs[i].timestamp < 7 days) {
                weightedSum += recs[i].recommendValue * recs[i].weight;
                totalWeight += recs[i].weight;
            }
        }
        
        // 安全检查：避免除零
        if (totalWeight == 0) {
            return _selfTrust;
        }
        
        uint neighborhoodTrust = weightedSum / totalWeight;
        
        // 融合自身信任值和邻域推荐
        uint finalTrust = (lambdaFusion * _selfTrust + (10000 - lambdaFusion) * neighborhoodTrust) / 10000;
        
        return finalTrust > MAX_TRUST_VALUE ? MAX_TRUST_VALUE : finalTrust;
    }
    
    /**
     * @dev 添加邻域推荐
     * @param _node 被推荐的节点
     * @param _recommendValue 推荐信任值
     * @param _weight 推荐权重
     */
    function addRecommendation(
        address _node,
        uint _recommendValue,
        uint _weight
    ) public onlyActiveNode(_node) whenNotPaused { // 移除了 onlyActiveNode(msg.sender)
        require(_recommendValue <= MAX_TRUST_VALUE, "Recommend value too high");
        require(_weight > 0 && _weight <= 100, "Invalid weight");
        
        recommendations[_node].push(Recommendation({
            recommender: msg.sender,
            recommendValue: _recommendValue,
            weight: _weight,
            timestamp: block.timestamp
        }));
        
        emit RecommendationAdded(_node, msg.sender, _recommendValue, _weight);
        
        // 重新计算信任值
        _calculateAndUpdateTrustValue(_node);
    }
    
    /**
     * @dev 记录节点间交互权重
     * @param _node1 节点1
     * @param _node2 节点2
     * @param _weight 交互权重
     */
    function recordInteraction(
        address _node1,
        address _node2,
        uint _weight
    ) public onlyActiveNode(_node1) onlyActiveNode(_node2) whenNotPaused {
        require(_node1 != _node2, "Cannot interact with self");
        
        interactionWeights[_node1][_node2] = _weight;
        interactionWeights[_node2][_node1] = _weight;
        
        emit InteractionRecorded(_node1, _node2, _weight);
    }
    
    /**
     * @dev 检查并应用惩罚机制
     * @param _node 节点地址
     */
    function _checkAndApplyPenalty(address _node) private {
        Node storage node = nodes[_node];
        
        // 信任值低于黑名单阈值
        if (node.trustValue < BLACKLIST_THRESHOLD && !node.isBlacklisted) {
            node.isBlacklisted = true;
            // 注意：这里不将 trustValue 设为 0，而是保持其低值，以便移出黑名单时恢复
            
            trustHistories[_node].push(TrustHistory({
                oldValue: node.trustValue,
                newValue: node.trustValue, // 保持原值，只是标记为黑名单
                reason: "Blacklisted - Trust too low",
                timestamp: block.timestamp
            }));
            
            emit NodeBlacklisted(_node, node.trustValue, block.timestamp);
        }
    }
    
    /**
     * @dev 手动更新信任值 (用于特殊情况或管理员干预)
     * @param _node 节点地址
     * @param _newTrustValue 新信任值
     * @param _reason 更新原因
     */
    function manualUpdateTrustValue(
        address _node,
        uint _newTrustValue,
        string memory _reason
    ) public onlyOwner whenNotPaused {
        require(nodes[_node].isActive, "Node not active");
        require(_newTrustValue <= MAX_TRUST_VALUE, "Trust value too high");
        
        uint oldValue = nodes[_node].trustValue;
        nodes[_node].trustValue = _newTrustValue;
        nodes[_node].lastUpdated = block.timestamp;
        
        trustHistories[_node].push(TrustHistory({
            oldValue: oldValue,
            newValue: _newTrustValue,
            reason: _reason,
            timestamp: block.timestamp
        }));
        
        emit TrustValueUpdated(_node, oldValue, _newTrustValue, _reason, block.timestamp);
    }
    
    /**
     * @dev 从黑名单中移除节点
     * @param _node 节点地址
     */
    function removeFromBlacklist(address _node) public onlyOwner whenNotPaused {
        require(nodes[_node].isBlacklisted, "Node not blacklisted");
        
        nodes[_node].isBlacklisted = false;
        // 可以选择重置为初始值，或保持当前计算值
        // 这里选择重置为初始值
        nodes[_node].trustValue = INITIAL_TRUST_VALUE;
        nodes[_node].lastUpdated = block.timestamp;

        emit NodeRemovedFromBlacklist(_node, block.timestamp);
    }
    
    /**
     * @dev 停用节点
     * @param _node 节点地址
     */
    function deactivateNode(address _node) public onlyOwner whenNotPaused {
        require(nodes[_node].isActive, "Node already inactive");
        
        nodes[_node].isActive = false;
        emit NodeDeactivated(_node, block.timestamp);
    }
    
    // ========== 查询功能函数 ==========
    
    /**
     * @dev 查询节点信任值
     * @param _node 节点地址
     * @return 信任值
     */
    function getTrustValue(address _node) public view returns (uint) {
        return nodes[_node].trustValue;
    }
    
    /**
     * @dev 查询节点完整信息
     * @param _node 节点地址
     */
    function getNodeInfo(address _node) public view returns (
        uint trustValue,
        uint successRate,
        uint responseTime,
        uint onlineTime,
        uint interactionCount,
        bool isActive,
        bool isBlacklisted
    ) {
        Node memory node = nodes[_node];
        return (
            node.trustValue,
            node.successRate,
            node.responseTime,
            node.onlineTime,
            node.interactionCount,
            node.isActive,
            node.isBlacklisted
        );
    }
    
    /**
     * @dev 获取节点信任历史记录数量
     * @param _node 节点地址
     */
    function getTrustHistoryCount(address _node) public view returns (uint) {
        return trustHistories[_node].length;
    }
    
    /**
     * @dev 获取节点推荐数量
     * @param _node 节点地址
     */
    function getRecommendationCount(address _node) public view returns (uint) {
        return recommendations[_node].length;
    }
    
    /**
     * @dev 获取所有节点地址
     */
    function getAllNodes() public view returns (address[] memory) {
        return nodeList;
    }
    
    /**
     * @dev 获取活跃节点数量
     */
    function getActiveNodeCount() public view returns (uint) {
        uint count = 0;
        for (uint i = 0; i < nodeList.length; i++) {
            if (nodes[nodeList[i]].isActive && !nodes[nodeList[i]].isBlacklisted) {
                count++;
            }
        }
        return count;
    }
    
    /**
     * @dev 获取节点信任等级
     * @param _node 节点地址
     * @return 信任等级 (0: 黑名单, 1: 低, 2: 中, 3: 高)
     */
    function getTrustLevel(address _node) public view returns (uint) {
        if (nodes[_node].isBlacklisted) return 0;
        
        uint trust = nodes[_node].trustValue;
        if (trust < WARNING_THRESHOLD) return 1;
        if (trust < HIGH_TRUST_THRESHOLD) return 2;
        return 3;
    }
    
    // ========== 配置函数 ==========
    
    /**
     * @dev 更新权重系数
     * @param _alpha α权重 (basis points)
     * @param _beta β权重 (basis points)
     * @param _gamma γ权重 (basis points)
     */
    function updateWeights(uint _alpha, uint _beta, uint _gamma) public onlyOwner whenNotPaused {
        require(_alpha + _beta + _gamma == 10000, "Weights must sum to 10000");
        weightAlpha = _alpha;
        weightBeta = _beta;
        weightGamma = _gamma;
    }
    function updateTheta(uint _theta) public onlyOwner whenNotPaused {
        require(_theta <= 10000, "Theta must be <= 10000");
        weightTheta = _theta;
    }
    function updateCaps(uint _respCap, uint _onlineMax) public onlyOwner whenNotPaused {
        require(_respCap > 0 && _onlineMax > 0, "Invalid caps");
        responseTimeCap = _respCap;
        onlineMaxSeconds = _onlineMax;
    }
    function updateDecayPerHour(uint _bp) public onlyOwner whenNotPaused {
        require(_bp <= 10000, "Invalid decay");
        decayPerHourBp = _bp;
    }
    function updatePenaltyBp(uint _bp) public onlyOwner whenNotPaused {
        require(_bp <= 10000, "Invalid penalty");
        penaltyBp = _bp;
    }
    function updatePenaltyBpFor(address _node, uint _bp) public onlyOwner whenNotPaused {
        require(_bp <= 10000, "Invalid penalty");
        penaltyBpPerNode[_node] = _bp;
        emit NodePenaltyUpdated(_node, _bp);
    }
    function updateRiskExposure(address _node, uint _risk) public onlyOwner whenNotPaused {
        require(_risk <= 100, "Risk must be <= 100");
        nodeRiskExposure[_node] = _risk;
    }
    function setAnomalyWindow(address _node, uint _until) public onlyOwner whenNotPaused {
        anomalyWindowUntil[_node] = _until;
    }
    
    /**
     * @dev 更新融合系数
     * @param _lambda λ融合系数 (basis points)
     */
    function updateLambda(uint _lambda) public onlyOwner whenNotPaused {
        require(_lambda <= 10000, "Lambda must be <= 10000");
        lambdaFusion = _lambda;
    }

    function fastRespond(address _node, uint _risk, uint _bp, uint _until) public onlyOwner whenNotPaused {
        require(_risk <= 100, "Risk must be <= 100");
        nodeRiskExposure[_node] = _risk;
        anomalyWindowUntil[_node] = _until;
        if (_bp > 0) {
            if (_bp > 10000) { _bp = 10000; }
            penaltyBpPerNode[_node] = _bp;
            emit NodePenaltyUpdated(_node, _bp);
        }
        if (!nodes[_node].isActive) {
            nodes[_node].isActive = true;
        }
        _calculateAndUpdateTrustValue(_node);

        // Auto-Blacklist Policy: If trust drops below threshold after penalty
        if (nodes[_node].trustValue < BLACKLIST_THRESHOLD) {
            if (!nodes[_node].isBlacklisted) {
                nodes[_node].isBlacklisted = true;
                emit NodeBlacklisted(_node, nodes[_node].trustValue, block.timestamp);
            }
        }
    }

    // ========================
    // 分关系评估扩展 (C2C/B2C/B2B/G2B/G2C/C2G)
    // ========================

    /**
     * @dev 关系类型枚举，满足论文“至少 5 类社会关系”，并补充 C2G 形成双向政务。
     */
    enum RelationType { C2C, B2C, B2B, G2B, G2C, C2G }

    /**
     * @dev 分关系的状态账簿（不影响原有全局 nodes 存储）。
     */
    struct RelState {
        uint trustValue;       // 0-200
        uint successRate;      // 0-100
        uint responseTime;     // ms
        uint onlineTime;       // 秒（累计）
        uint interactionCount; // 次数
        uint lastUpdated;      // 时间戳
    }

    // 每个 (节点, 关系类型) 独立记账
    mapping(address => mapping(uint8 => RelState)) public relationStates;
    // 分关系的推荐记录（按最近7天融合，沿用原有推荐算法与 λ）
    mapping(address => mapping(uint8 => Recommendation[])) public relationRecommendations;
    uint[6] public relWeightAlpha;
    uint[6] public relWeightBeta;
    uint[6] public relWeightGamma;
    uint[6] public relLambdaFusion;

    event RelTrustUpdated(address indexed node, uint8 indexed rel, uint oldValue, uint newValue, string reason, uint timestamp);
    event RelRecommendationAdded(address indexed node, uint8 indexed rel, address indexed recommender, uint recommendValue, uint weight);

    /**
     * @dev 按关系更新指标
     */
    function updateNodeMetricsRel(
        address _node,
        uint8 _rel,
        uint _successRate,
        uint _responseTime,
        uint _onlineDelta
    ) public onlyActiveNode(_node) whenNotPaused {
        require(_successRate <= 100, "Success rate must be <= 100");
        RelState storage st = relationStates[_node][_rel];
        st.successRate = _successRate;
        st.responseTime = _responseTime;
        st.onlineTime += _onlineDelta;
        st.interactionCount++;
        st.lastUpdated = block.timestamp;
        _recomputeRelTrust(_node, _rel);
    }

    /**
     * @dev 按关系添加推荐
     */
    function addRecommendationRel(
        address _node,
        uint8 _rel,
        uint _recommendValue,
        uint _weight
    ) public onlyActiveNode(_node) whenNotPaused {
        require(_recommendValue <= MAX_TRUST_VALUE, "Recommend value too high");
        require(_weight > 0 && _weight <= 100, "Invalid weight");
        relationRecommendations[_node][_rel].push(Recommendation({
            recommender: msg.sender,
            recommendValue: _recommendValue,
            weight: _weight,
            timestamp: block.timestamp
        }));
        emit RelRecommendationAdded(_node, _rel, msg.sender, _recommendValue, _weight);
        _recomputeRelTrust(_node, _rel);
    }

    /**
     * @dev 读取分关系信任值
     */
    function getTrustValueRel(address _node, uint8 _rel) public view returns (uint) {
        return relationStates[_node][_rel].trustValue;
    }

    /**
     * @dev 读取分关系完整状态
     */
    function getRelState(address _node, uint8 _rel) public view returns (
        uint trustValue,
        uint successRate,
        uint responseTime,
        uint onlineTime,
        uint interactionCount,
        uint lastUpdated
    ) {
        RelState memory st = relationStates[_node][_rel];
        return (st.trustValue, st.successRate, st.responseTime, st.onlineTime, st.interactionCount, st.lastUpdated);
    }

    // 内部：重算分关系信任值（沿用主模型与 λ 融合推荐）
    function _calculateRelBaseTrust(uint8 _rel, RelState storage st) private view returns (uint) {
        uint nsr = st.successRate;
        uint rt = st.responseTime > responseTimeCap ? responseTimeCap : st.responseTime;
        uint nri;
        if (rt == 0) { nri = 100; }
        else {
            uint raw = (responseTimeCap * 100) / (rt + 10);
            nri = raw > 100 ? 100 : raw;
        }
        uint maxSec = onlineMaxSeconds;
        uint not_ = st.onlineTime > maxSec ? 100 : (st.onlineTime * 100) / maxSec;

        uint wa = relWeightAlpha[_rel];
        uint wb = relWeightBeta[_rel];
        uint wg = relWeightGamma[_rel];
        if (wa + wb + wg == 0) { wa = weightAlpha; wb = weightBeta; wg = weightGamma; }
        
        return (wa * nsr + wb * nri + wg * not_) / 10000;
    }

    function _aggregateRelRecommendations(address _node, uint8 _rel) private view returns (uint, bool) {
        Recommendation[] storage recs = relationRecommendations[_node][_rel];
        uint weightedSum = 0; 
        uint totalWeight = 0;
        for (uint i = 0; i < recs.length; i++) {
            if (block.timestamp - recs[i].timestamp < 7 days) {
                weightedSum += recs[i].recommendValue * recs[i].weight;
                totalWeight += recs[i].weight;
            }
        }
        if (totalWeight == 0) return (0, false);
        return (weightedSum / totalWeight, true);
    }

    function _recomputeRelTrust(address _node, uint8 _rel) internal {
        RelState storage st = relationStates[_node][_rel];
        uint oldValue = st.trustValue;


        uint calculated = _calculateRelBaseTrust(_rel, st);
        uint selfTrust = (calculated * MAX_TRUST_VALUE) / 100;

        // 推荐融合
        (uint neighTrust, bool hasRecs) = _aggregateRelRecommendations(_node, _rel);
        
        uint finalTrust;
        if (!hasRecs) finalTrust = selfTrust;
        else {
            uint l = relLambdaFusion[_rel];
            if (l == 0) l = lambdaFusion;
            finalTrust = (l * selfTrust + (10000 - l) * neighTrust) / 10000;
        }
        if (finalTrust > MAX_TRUST_VALUE) finalTrust = MAX_TRUST_VALUE;
        st.trustValue = finalTrust;
        emit RelTrustUpdated(_node, _rel, oldValue, finalTrust, "Rel Metrics Updated", block.timestamp);
    }

    function updateRelWeights(uint8 _rel, uint _alpha, uint _beta, uint _gamma) public onlyOwner whenNotPaused {
        require(_rel < 6, "Invalid rel");
        require(_alpha + _beta + _gamma == 10000, "Weights must sum to 10000");
        relWeightAlpha[_rel] = _alpha;
        relWeightBeta[_rel] = _beta;
        relWeightGamma[_rel] = _gamma;
    }

    function updateRelLambda(uint8 _rel, uint _lambda) public onlyOwner whenNotPaused {
        require(_rel < 6, "Invalid rel");
        require(_lambda <= 10000, "Lambda must be <= 10000");
        relLambdaFusion[_rel] = _lambda;
    }
}
