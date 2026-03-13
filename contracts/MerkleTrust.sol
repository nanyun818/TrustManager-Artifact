// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title MerkleTrust
 * @dev A minimal contract to demonstrate gas costs of a Layer-2 / Rollup style approach.
 * Instead of storing every node's metric on-chain, we only store a Merkle Root of the state.
 */
contract MerkleTrust {
    bytes32 public stateRoot;
    uint256 public lastUpdated;
    address public operator;

    event StateRootUpdated(bytes32 indexed oldRoot, bytes32 indexed newRoot, uint256 timestamp);

    constructor() {
        operator = msg.sender;
    }

    function updateStateRoot(bytes32 _newRoot) external {
        require(msg.sender == operator, "Only operator");
        bytes32 old = stateRoot;
        stateRoot = _newRoot;
        lastUpdated = block.timestamp;
        emit StateRootUpdated(old, _newRoot, block.timestamp);
    }
}
