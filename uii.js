const express = require("express");
const fs = require("fs");
const bodyParser = require("body-parser");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));

// JSONBin.io configuration
const JSONBIN_API_KEY = "$2a$10$UFKAyDvpR8RhJ8QzH2Q3zuDyayu0LAVb9OVIhHZyhmxTaZInpfrTu";
const JSONBIN_BIN_ID = "6994c9b743b1c97be986b84b";
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

// Real mainnet RPC (Alchemy)
const MAINNET_RPC = "https://eth-mainnet.g.alchemy.com/v2/QFjExKnnaI2I4qTV7EFM7WwB0gl08X0n";

const STATE_FILE = "./data.json"; // Local fallback
const CHAIN_ID = "0x1";           // Mainnet
const NET_VERSION = "1";
const GAS_PRICE = "0x3b9aca00";   // 1 Gwei
const GAS_LIMIT = "0x7a1200";     // 8,000,000

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
              "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "10000000000",      // 10,000 USDC
              "0x6b175474e89094c44da98b954eedeac495271d0f": "5000000000000000000000", // 5,000 DAI
              "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "10000000000000000000", // 10 WETH
              "0xdac17f958d2ee523a2206206994597c13d831ec7": "50000000000000"       // 50,000,000 USDT
            }
          }
        },
        contracts: {
          "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
            symbol: "USDC",
            name: "USD Coin",
            decimals: 6,
            totalSupply: "400000000000000"
          },
          "0x6b175474e89094c44da98b954eedeac495271d0f": {
            symbol: "DAI",
            name: "Dai Stablecoin",
            decimals: 18,
            totalSupply: "5000000000000000000000000000"
          },
          "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": {
            symbol: "WETH",
            name: "Wrapped Ether",
            decimals: 18,
            totalSupply: "3000000000000000000000000"
          },
          "0xdac17f958d2ee523a2206206994597c13d831ec7": {
            symbol: "USDT",
            name: "Tether USD",
            decimals: 6,
            totalSupply: "800000000000000"
          }
        },
        blocks: [
          {
            number: 0,
            hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
            parentHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
            timestamp: Math.floor(Date.now() / 1000),
            transactions: []
          }
        ],
        transactions: {},
        pendingTransactions: []
      };
      await saveState(initial);
      return initial;
    }
    return JSON.parse(fs.readFileSync(STATE_FILE));
  }
}

// Save state to JSONBin.io
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

// Helper to forward requests to mainnet
async function forwardToMainnet(req, res) {
  try {
    const response = await axios.post(MAINNET_RPC, req.body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    res.json(response.data);
  } catch (error) {
    console.error("Mainnet proxy error:", error.message);
    res.status(500).json({
      jsonrpc: "2.0",
      id: req.body.id,
      error: { code: -32603, message: `Mainnet proxy error: ${error.message}` }
    });
  }
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
      // -------------------- Common --------------------
      case "web3_clientVersion":
        result = "MainnetSimulator/1.0 (with mainnet proxy)";
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
        if (state.accounts[lookupAddr]) {
          result = toHex(state.accounts[lookupAddr].balance || "0");
        } else {
          // Forward to mainnet
          return await forwardToMainnet(req, res);
        }
        break;

      case "eth_getTransactionCount":
        const [addr] = params;
        if (state.accounts[addr.toLowerCase()]) {
          result = toHex(state.accounts[addr.toLowerCase()].nonce || 0);
        } else {
          return await forwardToMainnet(req, res);
        }
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
          return await forwardToMainnet(req, res);
        }
        break;

      // -------------------- Blocks --------------------
      case "eth_getBlockByNumber":
      case "eth_getBlockByHash":
        // Forward to mainnet for real block data
        return await forwardToMainnet(req, res);

      // -------------------- Transactions --------------------
      case "eth_getTransactionByHash":
        const txHash = params[0];
        if (state.transactions[txHash]) {
          result = state.transactions[txHash] || null;
        } else {
          return await forwardToMainnet(req, res);
        }
        break;

      case "eth_getTransactionReceipt":
        const receiptTxHash = params[0];
        if (state.transactions[receiptTxHash]) {
          const tx = state.transactions[receiptTxHash];
          const block = state.blocks.find(b => b.hash === tx.blockHash);
          const txIndex = block ? block.transactions.indexOf(tx.hash) : 0;
          result = {
            transactionHash: tx.hash,
            transactionIndex: toHex(txIndex),
            blockHash: tx.blockHash,
            blockNumber: toHex(tx.blockNumber),
            from: tx.from,
            to: tx.to,
            cumulativeGasUsed: toHex(tx.gasUsed),
            gasUsed: toHex(tx.gasUsed),
            contractAddress: null,
            logs: tx.logs || [],
            logsBloom: "0x" + "0".repeat(512),
            status: toHex(1)
          };
        } else {
          return await forwardToMainnet(req, res);
        }
        break;

      // -------------------- Contract calls --------------------
      case "eth_call":
        const callTx = params[0];
        const toAddr = callTx.to?.toLowerCase();
        if (state.contracts[toAddr]) {
          result = handleEthCall(callTx, state);
        } else {
          return await forwardToMainnet(req, res);
        }
        break;

      case "eth_sendTransaction":
        const sendTx = params[0];
        const fromAddr = sendTx.from?.toLowerCase();
        
        // Only handle locally if sender is in our mocked accounts
        if (state.accounts[fromAddr]) {
          const txResult = handleSendTransaction(sendTx, state);
          if (txResult.error) {
            return res.json({ jsonrpc: "2.0", id, error: { code: -32000, message: txResult.error } });
          }
          result = txResult.hash;
          await saveState(state);
        } else {
          return await forwardToMainnet(req, res);
        }
        break;

      case "eth_sendRawTransaction":
        // For raw transactions, we can't easily check if it's local, so forward to mainnet
        return await forwardToMainnet(req, res);

      // -------------------- Logs --------------------
      case "eth_getLogs":
        const filter = params[0];
        const addresses = Array.isArray(filter.address)
          ? filter.address.map(a => a.toLowerCase())
          : [filter.address.toLowerCase()];
        
        // Check if any of the addresses are in our local contracts
        const hasLocalContract = addresses.some(addr => state.contracts[addr]);
        
        if (hasLocalContract) {
          // Handle local logs
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
        } else {
          return await forwardToMainnet(req, res);
        }
        break;

      // Custom method to check storage status
      case "eth_storageStatus":
        result = {
          usingJsonBin: true,
          binId: JSONBIN_BIN_ID,
          status: "connected",
          message: "Storage is persistent via JSONBin.io",
          mainnetProxy: MAINNET_RPC
        };
        break;

      default:
        // Forward unknown methods to mainnet
        return await forwardToMainnet(req, res);
    }

    res.json({ jsonrpc: "2.0", id, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ jsonrpc: "2.0", id, error: { code: -32603, message: "Internal error" } });
  }
});

// Simulate eth_call (read-only contract call)
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
    console.log(`eth_call balanceOf: addr=${addr}, contract=${contractAddr}`);
    const balance = state.accounts[addr]?.tokens?.[contractAddr] || "0";
    console.log(`eth_call balanceOf: balance=${balance}`);
    return encodeUint256(balance);
  }

  if (data.startsWith(SELECTORS.totalSupply)) {
    console.log(`eth_call totalSupply: contract=${contractAddr}, supply=${contract.totalSupply}`);
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

// Process a transaction (ETH transfer or ERC20 transfer)
function handleSendTransaction(tx, state) {
  const { from, to, value = "0x0", data = "0x", gas = GAS_LIMIT } = tx;

  const fromLower = from.toLowerCase();
  const fromAccount = state.accounts[fromLower];
  if (!fromAccount) {
    return { error: "Sender account not found" };
  }

  const ethValue = BigInt(value);
  const senderEth = BigInt(fromAccount.balance);
  if (senderEth < ethValue) {
    return { error: "Insufficient ETH balance" };
  }

  const nonce = fromAccount.nonce;
  fromAccount.nonce += 1;

  let txHash = randomHash();
  let logs = [];
  let tokenTransfer = null;

  // If data present and matches ERC20 transfer signature
  if (data && data !== "0x" && data.startsWith("0xa9059cbb")) {
    const recipient = decodeAddressFromData(data, 4);
    const amount = decodeUint256(data, 36);
    const contract = to.toLowerCase();

    // Check sender token balance
    const senderTokens = BigInt(fromAccount.tokens[contract] || "0");
    if (senderTokens < amount) {
      return { error: "Insufficient token balance" };
    }

    // Update balances
    fromAccount.tokens[contract] = (senderTokens - amount).toString();

    const recipientLower = recipient.toLowerCase();
    if (!state.accounts[recipientLower]) {
      state.accounts[recipientLower] = { nonce: 0, balance: "0", tokens: {} };
    }
    const recipientTokens = BigInt(state.accounts[recipientLower].tokens[contract] || "0");
    state.accounts[recipientLower].tokens[contract] = (recipientTokens + amount).toString();

    // Create Transfer log
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
    // Unknown contract interaction – treat as successful but no state change
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

  // Build transaction record
  const txRecord = {
    hash: txHash,
    nonce: toHex(nonce),
    blockHash: newBlockHash,
    blockNumber: newBlockNumber,
    transactionIndex: "0x0",
    from: fromLower,
    to: to.toLowerCase(),
    value,
    input: data,
    gas,
    gasPrice: GAS_PRICE,
    gasUsed: "0x5208", // 21000 for ETH, could vary
    logs,
    tokenTransfer
  };
  state.transactions[txHash] = txRecord;

  return { hash: txHash };
}

// Health check endpoint
app.get("/", (req, res) => {
  res.json({ 
    status: "ok", 
    message: "Hybrid Mainnet Proxy RPC",
    features: [
      "Local mocked accounts via JSONBin.io",
      "Real mainnet data via Alchemy",
      "Chain ID: 1"
    ],
    storage: "JSONBin.io",
    binId: JSONBIN_BIN_ID,
    mainnetProxy: MAINNET_RPC
  });
});

// Start server
const PORT = process.env.PORT || 8545;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Hybrid Mainnet Proxy RPC running on port ${PORT}`);
  console.log(`   Chain ID: 1 (0x1)`);
  console.log(`   Local accounts: from JSONBin.io (Bin ID: ${JSONBIN_BIN_ID})`);
  console.log(`   Mainnet proxy: ${MAINNET_RPC}`);
  console.log(`   CORS enabled for all origins`);
});
