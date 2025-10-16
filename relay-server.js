// relayer-server.js
// Backend relayer for Halloween NFT minting with meta-transactions
// ADAPTED for frontend with dataHash signature

const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const { executeForward } = require('./meta-exec-lib/src/index.js');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Configuration from environment variables
const CONFIG = {
    PORT: process.env.PORT || 3000,
    RPC_URL: process.env.RPC_URL,
    RELAYER_PRIVATE_KEY: process.env.RELAYER_PRIVATE_KEY,
    HUB_ADDRESS: process.env.HUB_ADDRESS,
    NFT_CONTRACT: process.env.NFT_CONTRACT,
    CHAIN_ID: parseInt(process.env.CHAIN_ID || '80002'),
    MAX_GAS_PRICE: ethers.parseUnits('100', 'gwei') // Max gas price willing to pay
};

// Initialize provider and relayer wallet
const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
const relayerWallet = new ethers.Wallet(CONFIG.RELAYER_PRIVATE_KEY, provider);

// NFT Contract ABI (only what we need)
const NFT_ABI = [
    "function mint(string calldata tokenUri) public",
    "function minted(address) public view returns (bool)"
];

// In-memory cache to prevent duplicate requests (use Redis in production)
const processedRequests = new Set();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Rate limiting: max requests per address per time window
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 5;

console.log('🚀 Starting Relayer Server...');
console.log('📍 Relayer Address:', relayerWallet.address);
console.log('🌐 Network:', CONFIG.CHAIN_ID);
console.log('📜 Hub Contract:', CONFIG.HUB_ADDRESS);
console.log('🎃 NFT Contract:', CONFIG.NFT_CONTRACT);

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        relayer: relayerWallet.address,
        timestamp: Date.now()
    });
});

// Main relay endpoint
app.post('/relay', async (req, res) => {
    try {
        const { forward, signature, callData } = req.body;

        // Validation
        if (!forward || !signature || !callData) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: forward, signature, callData'
            });
        }

        const userAddress = forward.from;
        console.log(`\n📨 Received mint request from: ${userAddress}`);
        console.log('🔢 Nonce:', forward.nonce);
        console.log('📦 Space:', forward.space);
        console.log('⏰ Deadline:', new Date(forward.deadline * 1000).toISOString());

        // Rate limiting
        if (!checkRateLimit(userAddress)) {
            console.log('⚠️  Rate limit exceeded for:', userAddress);
            return res.status(429).json({
                success: false,
                error: 'Too many requests. Please try again later.'
            });
        }

        // Check for duplicate requests
        const requestId = `${userAddress}-${forward.nonce}`;
        if (processedRequests.has(requestId)) {
            console.log('⚠️  Duplicate request detected:', requestId);
            return res.status(400).json({
                success: false,
                error: 'This request has already been processed'
            });
        }

        // Verify the forward is for the correct contract
        if (forward.to.toLowerCase() !== CONFIG.NFT_CONTRACT.toLowerCase()) {
            console.log('⚠️  Invalid target contract:', forward.to);
            return res.status(400).json({
                success: false,
                error: 'Invalid target contract'
            });
        }

        // Verify caller matches relayer (frontend should send relayer address)
        if (forward.caller.toLowerCase() !== relayerWallet.address.toLowerCase()) {
            console.log('⚠️  Caller mismatch. Expected:', relayerWallet.address, 'Got:', forward.caller);
            return res.status(400).json({
                success: false,
                error: 'Invalid caller address'
            });
        }

        // Verify dataHash matches callData
        const computedHash = ethers.keccak256(callData);
        if (forward.dataHash && computedHash.toLowerCase() !== forward.dataHash.toLowerCase()) {
            console.log('⚠️  DataHash mismatch!');
            console.log('   Computed:', computedHash);
            console.log('   Received:', forward.dataHash);
            return res.status(400).json({
                success: false,
                error: 'DataHash mismatch - signature invalid'
            });
        }

        // Check deadline
        const now = Math.floor(Date.now() / 1000);
        if (now > forward.deadline) {
            console.log('⚠️  Transaction deadline expired');
            return res.status(400).json({
                success: false,
                error: 'Transaction deadline expired'
            });
        }

        // Check if user has already minted (prevents wasting gas)
        const nftContract = new ethers.Contract(CONFIG.NFT_CONTRACT, NFT_ABI, provider);
        const hasMinted = await nftContract.minted(userAddress);
        
        if (hasMinted) {
            console.log('⚠️  User already minted:', userAddress);
            return res.status(400).json({
                success: false,
                error: '    ed an NFT'
            });
        }

        // Check gas price
        const feeData = await provider.getFeeData();
        if (feeData.gasPrice > CONFIG.MAX_GAS_PRICE) {
            console.log('⚠️  Gas price too high:', ethers.formatUnits(feeData.gasPrice, 'gwei'), 'gwei');
            return res.status(503).json({
                success: false,
                error: 'Network gas prices too high. Please try again later.'
            });
        }

        console.log('✅ All validations passed. Executing meta-transaction...');

        // Prepare the fTuple (Forward tuple) for the contract
        // IMPORTANT: Order must match your Hub contract's Forward struct
        const fTuple = [
            forward.from,      // address from
            forward.to,        // address to
            forward.value,     // uint256 value
            forward.space,     // uint32 space
            forward.nonce,     // uint256 nonce
            forward.deadline,  // uint256 deadline
            forward.dataHash,  // bytes32 dataHash
            forward.caller     // address caller
        ];

        console.log('📦 Prepared fTuple:', fTuple);

        // Execute the meta-transaction through the hub
        const tx = await executeForward({
            provider,
            metaAddress: CONFIG.HUB_ADDRESS,
            fTuple,
            callData,
            signature,
            relayer: relayerWallet,
            hasCaller: true
        });

        console.log('📡 Transaction sent:', tx.hash);
        console.log('⏳ Waiting for confirmation...');

        // Mark as processed immediately
        processedRequests.add(requestId);
        setTimeout(() => processedRequests.delete(requestId), CACHE_DURATION);

        // Wait for confirmation
        const receipt = await tx.wait();
        
        console.log('✅ Transaction confirmed in block:', receipt.blockNumber);
        console.log('⛽ Gas used:', receipt.gasUsed.toString());

        // Return success response
        res.json({
            success: true,
            txHash: tx.hash,
            transactionHash: tx.hash, // frontend compatibility
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString()
        });

    } catch (error) {
        console.error('❌ Error processing relay request:', error);
        console.error('Stack trace:', error.stack);
        
        // Parse error message
        let errorMessage = 'Transaction failed';
        if (error.message.includes('Already minted')) {
            errorMessage = 'This address has already minted an NFT';
        } else if (error.message.includes('insufficient funds')) {
            errorMessage = 'Relayer has insufficient funds';
        } else if (error.message.includes('nonce')) {
            errorMessage = 'Invalid nonce or nonce already used';
        } else if (error.message.includes('signature')) {
            errorMessage = 'Invalid signature';
        } else if (error.message.includes('deadline')) {
            errorMessage = 'Transaction deadline expired';
        } else if (error.message.includes('dataHash')) {
            errorMessage = 'Invalid data hash';
        } else if (error.message.includes('caller')) {
            errorMessage = 'Invalid caller address';
        }

        res.status(500).json({
            success: false,
            error: errorMessage,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Rate limiting helper
function checkRateLimit(address) {
    const now = Date.now();
    const userLimits = rateLimits.get(address) || [];
    
    // Remove old entries
    const recentRequests = userLimits.filter(time => now - time < RATE_LIMIT_WINDOW);
    
    if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
        return false;
    }
    
    recentRequests.push(now);
    rateLimits.set(address, recentRequests);
    
    return true;
}

// Clean up rate limits periodically
setInterval(() => {
    const now = Date.now();
    for (const [address, times] of rateLimits.entries()) {
        const recent = times.filter(time => now - time < RATE_LIMIT_WINDOW);
        if (recent.length === 0) {
            rateLimits.delete(address);
        } else {
            rateLimits.set(address, recent);
        }
    }
}, RATE_LIMIT_WINDOW);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// Start server
app.listen(CONFIG.PORT, () => {
    console.log(`\n🎃 Halloween NFT Relayer Server running on port ${CONFIG.PORT}`);
    console.log(`📝 POST /relay - Submit meta-transaction`);
    console.log(`💚 GET  /health - Health check\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down relayer server...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n👋 Shutting down relayer server...');
    process.exit(0);
});