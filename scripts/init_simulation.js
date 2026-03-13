const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'simulation_state.json');

// Addresses from snapshot (known valid addresses in Ganache potentially, or just placeholders)
// NOTE: In a real environment, we'd need private keys for them to sign recommendations, 
// but here the contract allows any address to recommend any address (simulation mode).
const HONEST_NODES = [
  '0x10AAe54E3F84C39C51936538b64C90c780315306',
  '0x7B9EB440516A1e5f3Cb1e3593189943Da8574A64',
  '0x71090B985Ec887977AAE1d20C141cf7a11a27380',
  '0x3018018c44338B9728d02be12d632C6691E020d1',
  '0x4aC094fB46784E74B7F3b6dEDEb1DfF42B00f5B1',
  '0xD37BbE5744D730a1d98d8DC97c42F0Ca46aD7146',
  '0x81b2F8Fc75Bab64A6b144aa6d2fAa127B4Fa7fD9',
  '0x413B13d160e74Ce337A87D5020eaaef0150E2df9',
  '0x4c52ca29388A8A854095Fd2BeB83191D68DC840b',
  '0x000000000022D473030F116dDEE9F6B43aC78BA3'
];

const ON_OFF_NODES = [
  '0xa7Ca2C8673bcFA5a26d8ceeC2887f2CC2b0Db22A',
  '0x1111111254EEB25477B68fb85Ed929f73A960582',
  '0x738c581921325E19fd701C983231a4c31C0a90A0',
  '0xC8E05f26C658fe83DFfBef8bB1733FfCdE703AcF',
  '0x3208684f96458c540Eb08F6F01b9e9afb2b7d4f0'
];

const COLLUSION_NODES = [
  '0x4a585e0F7c18e2C414221D6402652D5e0990E5F8',
  '0xeA5B523263bea6a5574858528bd591A3c2BEa0f6',
  '0x9107192584DE051e2b50E6293A3A19bf400bF034',
  '0x8D90113A1e286a5aB3e496fbD1853F265e5913c6',
  '0x95E6F48254609A6ee006F7D493c8e5fB97094ceF',
  '0x35b6F1F7279d2B2Bb9644fC5c569506f417C8807',
  '0xa3584158c36a8276708a6180ac2e7F9F97d584c5',
  '0x579752Cff8feE7Af09446b2133EE2f9ff10C4fbf',
  '0x1715a3E4A142d8b698131108995174F37aEBA10D',
  '0x3a23F943181408EAC424116Af7b7790c94Cb97a5'
];

// Whitewashers will be generated dynamically
const WHITEWASH_NODES = [];

const initialState = {
  loop: 0,
  groups: {
    honest: HONEST_NODES,
    on_off: ON_OFF_NODES,
    collusion: COLLUSION_NODES,
    whitewash: WHITEWASH_NODES
  },
  whitewash_active_map: {} // maps current_address -> loop_started
};

fs.writeFileSync(STATE_FILE, JSON.stringify(initialState, null, 2));
console.log('Simulation state initialized at:', STATE_FILE);
