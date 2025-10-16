// test-relayer.js
// Script to test the relayer server functionality

import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

const CONFIG = {
    RELAYER_ENDPOINT: 'http://localhost:3000',
    RPC_URL: process.env.RPC_URL,
    USER_PRIVATE_KEY: process.env.USER_PRIVATE_KEY, // Test user wallet
    HUB_ADDRESS: process.env.HUB_ADDRESS,
    NFT_CONTRACT: process.env.NFT_CONTRACT,
    CHAIN_ID: parseInt(process.env.CHAIN_ID || '80002')
};

const NFT_ABI = [
    "function mint(string calldata tokenUri) public",
    "function minted(address) public view returns (bool)"
];

async function testRelayer() {
    console.log('🧪 Testing Relayer Server\n');

    try {
        // 1. Test health endpoint
        console.log('1️⃣  Testing health endpoint...');
        const healthResponse = await fetch(`${CONFIG.RELAYER_ENDPOINT}/health`);
        const health = await healthResponse.json();
        console.log('   ✅ Health check:', health);
        console.log('   📍 Relayer:', health.relayer);

        // 2. Setup provider and user wallet
        console.log('\n2️⃣  Setting up test wallet...');
        const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
        const userWallet = new ethers.Wallet(CONFIG.USER_PRIVATE_KEY, provider);
        console.log('   👤 User address:', userWallet.address);

        // Check if already minted
        const nftContract = new ethers.Contract(CONFIG.NFT_CONTRACT, NFT_ABI, provider);
        const hasMinted = await nftContract.minted(userWallet.address);
        
        if (hasMinted) {
            console.log('   ⚠️  User has already minted. Use a different test wallet.');
            return;
        }

        // 3. Build calldata
        console.log('\n3️⃣  Building meta-transaction...');
        const tokenUri = `ipfs://QmTest${Date.now()}`;
        const iface = new ethers.Interface(NFT_ABI);
        const callData = iface.encodeFunctionData('mint', [tokenUri]);
        console.log('   📝 Token URI:', tokenUri);

        // 4. Prepare EIP-712 signature
        console.log('\n4️⃣  Preparing EIP-712 signature...');
        const domain = {
            name: 'PermissionedMetaTxHub',
            version: '1',
            chainId: CONFIG.CHAIN_ID,
            verifyingContract: CONFIG.HUB_ADDRESS
        };

        const types = {
            Forward: [
                { name: 'from', type: 'address' },
                { name: 'to', type: 'address' },
                { name: 'value', type: 'uint256' },
                { name: 'data', type: 'bytes' },
                { name: 'deadline', type: 'uint256' },
                { name: 'caller', type: 'address' },
                { name: 'space', type: 'uint32' },
                { name: 'nonce', type: 'uint256' }
            ]
        };

        const nonce = Math.floor(Math.random() * 1000000);
        const deadline = Math.floor(Date.now() / 1000) + (24 * 60 * 60);

        const message = {
            from: userWallet.address,
            to: CONFIG.NFT_CONTRACT,
            value: 0,
            data: callData,
            deadline: deadline,
            caller: ethers.ZeroAddress,
            space: 1500,
            nonce: nonce
        };

        console.log('   🔢 Nonce:', nonce);
        console.log('   ⏰ Deadline:', new Date(deadline * 1000).toISOString());

        // 5. Sign the message
        console.log('\n5️⃣  Signing meta-transaction...');
        const signature = await userWallet.signTypedData(domain, types, message);
        console.log('   ✍️  Signature:', signature.slice(0, 20) + '...');

        // 6. Send to relayer
        console.log('\n6️⃣  Sending to relayer...');
        const relayResponse = await fetch(`${CONFIG.RELAYER_ENDPOINT}/relay`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                forward: message,
                signature: signature,
                callData: callData
            })
        });

        const result = await relayResponse.json();

        if (result.success) {
            console.log('\n🎉 SUCCESS!');
            console.log('   📜 Transaction Hash:', result.txHash);
            console.log('   📦 Block Number:', result.blockNumber);
            console.log('   ⛽ Gas Used:', result.gasUsed);
            console.log(`\n   🔗 View on explorer:`);
            console.log(`   https://amoy.polygonscan.com/tx/${result.txHash}`);
        } else {
            console.log('\n❌ FAILED');
            console.log('   Error:', result.error);
            if (result.details) {
                console.log('   Details:', result.details);
            }
        }

        // 7. Verify mint
        console.log('\n7️⃣  Verifying mint status...');
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for block confirmation
        const mintedAfter = await nftContract.minted(userWallet.address);
        console.log('   Minted:', mintedAfter ? '✅ Yes' : '❌ No');

    } catch (error) {
        console.error('\n💥 Test failed with error:', error.message);
        console.error(error);
    }
}

// Test rate limiting
async function testRateLimit() {
    console.log('\n\n🧪 Testing Rate Limiting\n');
    
    const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
    const userWallet = new ethers.Wallet(CONFIG.USER_PRIVATE_KEY, provider);
    
    console.log('Sending 6 rapid requests (limit is 5 per minute)...\n');
    
    for (let i = 1; i <= 6; i++) {
        try {
            const response = await fetch(`${CONFIG.RELAYER_ENDPOINT}/relay`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    forward: {
                        from: userWallet.address,
                        to: CONFIG.NFT_CONTRACT,
                        value: 0,
                        data: '0x',
                        deadline: Math.floor(Date.now() / 1000) + 3600,
                        caller: ethers.ZeroAddress,
                        space: 1500,
                        nonce: Math.floor(Math.random() * 1000000)
                    },
                    signature: '0x',
                    callData: '0x'
                })
            });
            
            const result = await response.json();
            const status = response.status;
            
            console.log(`Request ${i}: ${status === 429 ? '🚫 Rate limited' : status === 400 ? '⚠️  Invalid (expected)' : '✅ Accepted'}`);
            
            if (status === 429) {
                console.log('   ✅ Rate limiting working correctly!\n');
                break;
            }
        } catch (error) {
            console.log(`Request ${i}: ❌ Error -`, error.message);
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--rate-limit')) {
        await testRateLimit();
    } else if (args.includes('--help')) {
        console.log(`
Halloween NFT Relayer Test Script

Usage:
  node test-relayer.js              # Test full mint flow
  node test-relayer.js --rate-limit # Test rate limiting
  node test-relayer.js --help       # Show this help

Environment variables required:
  RPC_URL              # Network RPC endpoint
  USER_PRIVATE_KEY     # Test user wallet
  HUB_ADDRESS          # PermissionedMetaTxHub address
  NFT_CONTRACT         # HalloweenNFT address
  CHAIN_ID             # Network chain ID
        `);
    } else {
        await testRelayer();
    }
}

main().catch(console.error);