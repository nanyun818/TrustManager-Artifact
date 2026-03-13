Forta 机器人 - ERC20 授权异常检测

概述
- 检测模式：无限授权、短时间重复授权、异常 spender（EOA/非常见）、稳定币组合授权（同块内多枚稳定币）、Permit/Permit2 语境标记。

配置
- 编辑 `forta-bot/config.json`：
  - `stablecoins`：主网稳定币地址列表。
  - `known_safe_spenders`：常见、可信路由/聚合器地址，降低误报。
  - `known_permit2`：Permit2 合约地址（主网）。
  - `short_interval_blocks`：重复授权判定的区块窗口。
  - `stablecoin_combo_threshold`：同块内稳定币授权触发阈值。
  - `permit_selectors`：EIP-2612/DAI 风格 `permit` 选择器（可按需补充）。
  - `enable_model`：是否启用链下逻辑回归模型（true/false）。
  - `model_threshold`：模型风险阈值，`risk>=threshold` 触发告警（建议 0.2–0.3）。
  - `model_path`：模型权重路径（默认 `models/logreg.json`）。

运行
- 依赖安装：`pip install -r forta-bot/requirements.txt`
- 环境变量：在项目根 `.env` 添加 `RPC_URL`（可选，用于代码判断 EOA）。
- 本地测试：调用 `initialize()` 后，向 `handle_transaction` 提供模拟 `TransactionEvent`。
- Forta 部署：可按 Forta Starter Kit 标准结构引入本模块的检测逻辑。

模型集成说明
- 模型特征映射：
  - `unlimited` ← 授权金额是否为最大值。
  - `freshSpender` ← 该 (owner,spender,token) 组合首次出现。
  - `freqSpike`/`freqNorm` ← 短区块窗口内重复授权（由 `short_interval_blocks` 控制）。
  - `unknownTarget`/`approveToUnusual` ← spender 是否 EOA 或不在白名单。
  - `isApprove`=1，`isSwap`/`gasRatio` 默认 0（可按需补充）。
- 告警门控：
  - 当 `enable_model=true` 时，只有当 `risk>=model_threshold` 或触发 `stable_combo` 强规则时才发出告警；
  - 元数据包含 `risk`、`model_threshold` 与 `features`，便于审计与调试。

备注
- 识别 EIP-2612 因各代币实现差异较大，默认基于选择器与上下文标记为“permit 语境”，如需精细识别可针对目标代币 ABI 细化。