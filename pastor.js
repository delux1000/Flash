const express = require("express");
const fs = require("fs");
const bodyParser = require("body-parser");
const axios = require("axios");
const cors = require("cors");

const app = express();

// Middleware
app.use(cors()); // Enable CORS for all routes
app.use(bodyParser.json({ limit: "10mb" }));

// JSONBin.io configuration
const JSONBIN_API_KEY = "$2a$10$UFKAyDvpR8RhJ8QzH2Q3zuDyayu0LAVb9OVIhHZyhmxTaZInpfrTu";
const JSONBIN_BIN_ID = "6994c9b743b1c97be986b84b";
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

const STATE_FILE = "./data.json";
const CHAIN_ID = "0x1";           // Mainnet
const NET_VERSION = "1";
const GAS_PRICE = "0x3b9aca00";   // 1 Gwei
const GAS_LIMIT = "0x7a1200";     // 8,000,000

// In‑memory filter storage (not persisted)
let nextFilterId = 1;
const filters = new Map();

// Load or create initial state from JSONBin.io
async function loadState() {
  try {
    const response = await axios.get(JSONBIN_URL, {
      headers: { 'X-Master-Key': JSONBIN_API_KEY }
    });
    console.log("✅ Loaded state from JSONBin.io");
    return response.data.record;
  } catch (error) {
    console.log("⚠️ Failed to load from JSONBin.io, using local file:", error.message);
    if (!fs.existsSync(STATE_FILE)) {
      const initial = {
        chainId: CHAIN_ID,
        networkId: NET_VERSION,
        accounts: {
          "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266": {
            nonce: 0,
            balance: "1000000000000000000000", // 1000 ETH
            tokens: {
              "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "10000000000",
              "0x6b175474e89094c44da98b954eedeac495271d0f": "5000000000000000000000",
              "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "10000000000000000000",
              "0xdac17f958d2ee523a2206206994597c13d831ec7": "50000000000000"
            }
          }
        },
        contracts: {
          "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
            symbol: "USDC", name: "USD Coin", decimals: 6, totalSupply: "400000000000000"
          },
          "0x6b175474e89094c44da98b954eedeac495271d0f": {
            symbol: "DAI", name: "Dai Stablecoin", decimals: 18, totalSupply: "5000000000000000000000000000"
          },
          "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": {
            symbol: "WETH", name: "Wrapped Ether", decimals: 18, totalSupply: "3000000000000000000000000"
          },
          "0xdac17f958d2ee523a2206206994597c13d831ec7": {
            symbol: "USDT", name: "Tether USD", decimals: 6, totalSupply: "800000000000000"
          }
        },
        blocks: [{
          number: 0,
          hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
          parentHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
          timestamp: Math.floor(Date.now() / 1000),
          transactions: []
        }],
        transactions: {},
        pendingTransactions: []
      };
      await saveState(initial);
      return initial;
    }
    return JSON.parse(fs.readFileSync(STATE_FILE));
  }
}

async function saveState(state) {
  try {
    await axios.put(JSONBIN_URL, state, {
      headers: {
        'X-Master-Key': JSONBIN_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    console.log("✅ Saved state to JSONBin.io");
  } catch (error) {
    console.log("⚠️ Failed to save to JSONBin.io, saving locally:", error.message);
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }
}

function toHex(value) {
  return "0x" + BigInt(value).toString(16);
}

function randomHash() {
  return "0x" + Math.random().toString(16).slice(2).padEnd(64, "0");
}

function randomAddress() {
  return "0x" + Math.random().toString(16).slice(2).padEnd(40, "0");
}

function decodeAddressFromData(hex, startByte = 4) {
  const addressPart = hex.slice(2 + startByte * 2, 2 + (startByte + 32) * 2);
  return ("0x" + addressPart.slice(24)).toLowerCase();
}

function decodeUint256(hex, startByte = 36) {
  const amountPart = hex.slice(2 + startByte * 2, 2 + (startByte + 32) * 2);
  return BigInt("0x" + amountPart);
}

function encodeString(str) {
  const bytes = Buffer.from(str, "utf8");
  const length = bytes.length;
  const paddedLength = Math.ceil(length / 32) * 32;
  const padded = Buffer.alloc(paddedLength, 0);
  bytes.copy(padded);
  const encoded = Buffer.alloc(64 + padded.length, 0);
  encoded.writeUInt32BE(32, 28);
  encoded.writeUInt32BE(length, 60);
  padded.copy(encoded, 64);
  return "0x" + encoded.toString("hex");
}

function encodeUint256(value) {
  return "0x" + BigInt(value).toString(16).padStart(64, "0");
}

// Main RPC handler
app.post("/", async (req, res) => {
  const { jsonrpc, method, params, id } = req.body;
  console.log(`RPC request: ${method}`, JSON.stringify(params));

  if (jsonrpc !== "2.0") {
    return res.status(400).json({ jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid JSON-RPC version" } });
  }

  try {
    const state = await loadState();
    let result;

    switch (method) {
      // ----- Common -----
      case "web3_clientVersion":
        result = "MainnetSimulator/1.0";
        break;

      case "eth_chainId":
        result = state.chainId;
        break;

      case "net_version":
        result = state.networkId;
        break;

      case "eth_gasPrice":
        result = GAS_PRICE;
        break;

      case "eth_estimateGas":
        result = GAS_LIMIT;
        break;

      case "eth_getBalance":
        const [address] = params;
        const lookupAddr = address.toLowerCase();
        const balance = state.accounts[lookupAddr]?.balance || "0";
        result = toHex(balance);
        break;

      case "eth_getTransactionCount":
        const [addr] = params;
        const nonce = state.accounts[addr.toLowerCase()]?.nonce || 0;
        result = toHex(nonce);
        break;

      case "eth_accounts":
        result = Object.keys(state.accounts);
        break;

      case "eth_blockNumber":
        result = toHex(state.blocks[state.blocks.length - 1].number);
        break;

      case "eth_getCode":
        const contractAddr = params[0].toLowerCase();
        if (state.contracts[contractAddr]) {
          result = "0x6080604052";
        } else {
          result = "0x";
        }
        break;

      // ----- Blocks -----
      case "eth_getBlockByNumber":
        const [blockNum, returnTxs] = params;
        let block;
        if (blockNum === "latest") {
          block = state.blocks[state.blocks.length - 1];
        } else if (blockNum === "earliest") {
          block = state.blocks[0];
        } else {
          const num = parseInt(blockNum, 16);
          block = state.blocks.find(b => b.number === num);
        }
        if (!block) return res.json({ jsonrpc: "2.0", id, result: null });
        const txs = returnTxs ? block.transactions.map(txHash => state.transactions[txHash]) : block.transactions;
        result = {
          number: toHex(block.number),
          hash: block.hash,
          parentHash: block.parentHash,
          nonce: "0x0000000000000000",
          sha3Uncles: "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347",
          logsBloom: "0x" + "0".repeat(512),
          transactionsRoot: "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
          stateRoot: "0x" + "0".repeat(64),
          receiptsRoot: "0x" + "0".repeat(64),
          miner: "0x0000000000000000000000000000000000000000",
          difficulty: "0x0",
          totalDifficulty: "0x0",
          extraData: "0x",
          size: "0x3e8",
          gasLimit: GAS_LIMIT,
          gasUsed: toHex(block.transactions.reduce((acc, txHash) => acc + parseInt(state.transactions[txHash]?.gasUsed || 0, 16), 0)),
          timestamp: toHex(block.timestamp),
          transactions: txs,
          uncles: []
        };
        break;

      case "eth_getBlockByHash":
        const [blockHash, returnTxsByHash] = params;
        const blockByHash = state.blocks.find(b => b.hash === blockHash);
        if (!blockByHash) return res.json({ jsonrpc: "2.0", id, result: null });
        const txsByHash = returnTxsByHash ? blockByHash.transactions.map(txHash => state.transactions[txHash]) : blockByHash.transactions;
        result = { ...blockByHash, transactions: txsByHash };
        break;

      // ----- Transactions -----
      case "eth_getTransactionByHash":
        const txHash = params[0];
        const tx = state.transactions[txHash];
        if (!tx) {
          result = null;
        } else {
          result = {
            hash: tx.hash,
            nonce: tx.nonce || "0x0",
            blockHash: tx.blockHash,
            blockNumber: toHex(tx.blockNumber),
            transactionIndex: tx.transactionIndex || "0x0",
            from: tx.from,
            to: tx.to,
            value: tx.value || "0x0",
            gas: tx.gas || GAS_LIMIT,
            gasPrice: tx.gasPrice || GAS_PRICE,
            input: tx.input || "0x",
            v: "0x1b",
            r: "0x0000000000000000000000000000000000000000000000000000000000000000",
            s: "0x0000000000000000000000000000000000000000000000000000000000000000"
          };
        }
        break;

      case "eth_getTransactionReceipt":
        const receiptTxHash = params[0];
        const receiptTx = state.transactions[receiptTxHash];
        if (!receiptTx) {
          result = null;
        } else {
          const block = state.blocks.find(b => b.hash === receiptTx.blockHash);
          const txIndex = block ? block.transactions.indexOf(receiptTx.hash) : 0;
          result = {
            transactionHash: receiptTx.hash,
            transactionIndex: toHex(txIndex),
            blockHash: receiptTx.blockHash,
            blockNumber: toHex(receiptTx.blockNumber),
            from: receiptTx.from,
            to: receiptTx.to,
            cumulativeGasUsed: toHex(parseInt(receiptTx.gasUsed || 21000, 16)),
            gasUsed: toHex(parseInt(receiptTx.gasUsed || 21000, 16)),
            contractAddress: receiptTx.contractAddress || null,
            logs: receiptTx.logs || [],
            logsBloom: "0x" + "0".repeat(512),
            status: toHex(1), // 1 = success
            effectiveGasPrice: receiptTx.gasPrice || GAS_PRICE
          };
        }
        break;

      // ----- Contract calls -----
      case "eth_call":
        const callTx = params[0];
        result = handleEthCall(callTx, state);
        break;

      case "eth_sendTransaction":
        const sendTx = params[0];
        if (!sendTx || !sendTx.from) {
          return res.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Missing 'from' field" } });
        }
        const txResult = await handleSendTransaction(sendTx, state);
        if (txResult.error) {
          return res.json({ jsonrpc: "2.0", id, error: { code: -32000, message: txResult.error } });
        }
        result = txResult.hash;
        await saveState(state);
        break;

      case "eth_sendRawTransaction":
        // For simulation, return a dummy hash.
        result = randomHash();
        break;

      // ----- Logs -----
      case "eth_getLogs":
        const filter = params[0];
        const addresses = Array.isArray(filter.address)
          ? filter.address.map(a => a.toLowerCase())
          : [filter.address.toLowerCase()];
        const topics = filter.topics || [];
        const logs = [];
        for (const tx of Object.values(state.transactions)) {
          if (tx.logs) {
            for (const log of tx.logs) {
              if (addresses.includes(log.address) && (!topics.length || topics[0] === log.topics[0])) {
                logs.push(log);
              }
            }
          }
        }
        result = logs;
        break;

      // ----- Filters (simplified) -----
      case "eth_newFilter":
        const filterParams = params[0];
        const filterId = '0x' + nextFilterId.toString(16).padStart(8, '0');
        nextFilterId++;
        filters.set(filterId, { type: 'log', filter: filterParams, lastPollBlock: state.blocks.length });
        result = filterId;
        break;

      case "eth_newBlockFilter":
        const blockFilterId = '0x' + nextFilterId.toString(16).padStart(8, '0');
        nextFilterId++;
        filters.set(blockFilterId, { type: 'block', lastPollBlock: state.blocks.length });
        result = blockFilterId;
        break;

      case "eth_newPendingTransactionFilter":
        const pendingFilterId = '0x' + nextFilterId.toString(16).padStart(8, '0');
        nextFilterId++;
        filters.set(pendingFilterId, { type: 'pending', lastPollBlock: state.blocks.length });
        result = pendingFilterId;
        break;

      case "eth_getFilterChanges":
        const filterIdChanges = params[0];
        const filterData = filters.get(filterIdChanges);
        if (!filterData) {
          return res.json({ jsonrpc: "2.0", id, error: { code: -32000, message: "Filter not found" } });
        }
        if (filterData.type === 'block') {
          const newBlocks = [];
          for (let i = filterData.lastPollBlock; i < state.blocks.length; i++) {
            newBlocks.push(state.blocks[i].hash);
          }
          filterData.lastPollBlock = state.blocks.length;
          result = newBlocks;
        } else {
          result = [];
        }
        break;

      case "eth_uninstallFilter":
        const filterIdUninstall = params[0];
        result = filters.delete(filterIdUninstall);
        break;

      // ----- Mempool (mock) -----
      case "txpool_status":
        result = { pending: "0x0", queued: "0x0" };
        break;

      case "txpool_inspect":
        result = { pending: {}, queued: {} };
        break;

      case "txpool_content":
        result = { pending: {}, queued: {} };
        break;

      // ----- Mining / Network -----
      case "eth_syncing":
        result = false;
        break;

      case "eth_mining":
        result = false;
        break;

      case "eth_hashrate":
        result = "0x0";
        break;

      case "eth_coinbase":
        result = "0x0000000000000000000000000000000000000000";
        break;

      case "eth_getWork":
        result = ["0x0", "0x0", "0x0"];
        break;

      case "eth_submitWork":
        result = false;
        break;

      // ----- Storage -----
      case "eth_getStorageAt":
        result = "0x0000000000000000000000000000000000000000000000000000000000000000";
        break;

      case "eth_getProof":
        result = {
          address: params[0],
          accountProof: [],
          balance: "0x0",
          codeHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
          nonce: "0x0",
          storageHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
          storageProof: []
        };
        break;

      // ----- Debug -----
      case "debug_traceTransaction":
        result = { gas: 21000, returnValue: "0x", structLogs: [] };
        break;

      case "debug_traceBlockByNumber":
      case "debug_traceBlockByHash":
        result = [];
        break;

      // ----- Custom -----
      case "eth_storageStatus":
        result = {
          usingJsonBin: true,
          binId: JSONBIN_BIN_ID,
          status: "connected"
        };
        break;

      default:
        return res.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method ${method} not found` }
        });
    }

    res.json({ jsonrpc: "2.0", id, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ jsonrpc: "2.0", id, error: { code: -32603, message: "Internal error" } });
  }
});

function handleEthCall(tx, state) {
  const { to, data } = tx;
  const contractAddr = to.toLowerCase();
  const contract = state.contracts[contractAddr];
  if (!contract) {
    console.log(`eth_call: contract ${contractAddr} not found`);
    return "0x";
  }

  const SELECTORS = {
    balanceOf: "0x70a08231",
    totalSupply: "0x18160ddd",
    name: "0x06fdde03",
    symbol: "0x95d89b41",
    decimals: "0x313ce567"
  };

  if (data.startsWith(SELECTORS.balanceOf)) {
    const addr = decodeAddressFromData(data, 4);
    const balance = state.accounts[addr]?.tokens?.[contractAddr] || "0";
    return encodeUint256(balance);
  }

  if (data.startsWith(SELECTORS.totalSupply)) {
    return encodeUint256(contract.totalSupply || "0");
  }

  if (data.startsWith(SELECTORS.name)) {
    return encodeString(contract.name || "");
  }

  if (data.startsWith(SELECTORS.symbol)) {
    return encodeString(contract.symbol || "");
  }

  if (data.startsWith(SELECTORS.decimals)) {
    return encodeUint256(contract.decimals || 18);
  }

  return "0x";
}

async function handleSendTransaction(tx, state) {
  const { from, to, value = "0x0", data = "0x", gas = GAS_LIMIT } = tx;

  if (!from) return { error: "Missing 'from' field" };
  const fromLower = from.toLowerCase();
  const fromAccount = state.accounts[fromLower];
  if (!fromAccount) return { error: "Sender account not found" };

  const ethValue = BigInt(value);
  const senderEth = BigInt(fromAccount.balance);
  if (senderEth < ethValue) return { error: "Insufficient ETH balance" };

  // Contract creation? (to is empty or "0x")
  if (!to || to === "0x" || to === "0x0") {
    // Not implemented; treat as error or ignore
    return { error: "Contract creation not supported" };
  }

  const nonce = fromAccount.nonce;
  fromAccount.nonce += 1;

  let txHash = randomHash();
  let logs = [];
  let tokenTransfer = null;

  // Check for ERC20 transfer
  if (data && data !== "0x" && data.startsWith("0xa9059cbb")) {
    const recipient = decodeAddressFromData(data, 4);
    const amount = decodeUint256(data, 36);
    const contract = to.toLowerCase();

    const senderTokens = BigInt(fromAccount.tokens[contract] || "0");
    if (senderTokens < amount) return { error: "Insufficient token balance" };

    fromAccount.tokens[contract] = (senderTokens - amount).toString();

    const recipientLower = recipient.toLowerCase();
    if (!state.accounts[recipientLower]) {
      state.accounts[recipientLower] = { nonce: 0, balance: "0", tokens: {} };
    }
    const recipientTokens = BigInt(state.accounts[recipientLower].tokens[contract] || "0");
    state.accounts[recipientLower].tokens[contract] = (recipientTokens + amount).toString();

    logs.push({
      address: contract,
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x000000000000000000000000" + fromLower.slice(2),
        "0x000000000000000000000000" + recipientLower.slice(2)
      ],
      data: encodeUint256(amount),
      blockNumber: toHex(state.blocks.length),
      transactionHash: txHash,
      transactionIndex: "0x0",
      blockHash: "",
      logIndex: "0x0",
      removed: false
    });

    tokenTransfer = { token: contract, amount: amount.toString(), to: recipient };
  } else if (data === "0x") {
    // Simple ETH transfer
    const toLower = to.toLowerCase();
    fromAccount.balance = (senderEth - ethValue).toString();
    if (!state.accounts[toLower]) {
      state.accounts[toLower] = { nonce: 0, balance: "0", tokens: {} };
    }
    state.accounts[toLower].balance = (BigInt(state.accounts[toLower].balance) + ethValue).toString();
  } else {
    // Unknown contract interaction – treat as success with no state change
  }

  // Create new block (one tx per block)
  const lastBlock = state.blocks[state.blocks.length - 1];
  const newBlockNumber = lastBlock.number + 1;
  const newBlockHash = randomHash();
  const timestamp = Math.floor(Date.now() / 1000);

  const newBlock = {
    number: newBlockNumber,
    hash: newBlockHash,
    parentHash: lastBlock.hash,
    timestamp,
    transactions: [txHash]
  };
  state.blocks.push(newBlock);

  const txRecord = {
    hash: txHash,
    nonce: toHex(nonce),
    blockHash: newBlockHash,
    blockNumber: newBlockNumber,
    transactionIndex: "0x0",
    from: fromLower,
    to: to ? to.toLowerCase() : null,
    value,
    input: data,
    gas,
    gasPrice: GAS_PRICE,
    gasUsed: "0x5208",
    logs,
    tokenTransfer
  };
  state.transactions[txHash] = txRecord;

  return { hash: txHash };
}

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Ethereum RPC Simulator is running",
    storage: "JSONBin.io",
    binId: JSONBIN_BIN_ID
  });
});

const PORT = process.env.PORT || 8545;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Mainnet RPC Simulator running on port ${PORT}`);
  console.log(`   Chain ID: 1, Network ID: 1`);
  console.log(`   Storage: JSONBin.io (Bin ID: ${JSONBIN_BIN_ID})`);
});
