// integration-examples.js
// Examples showing how to integrate meta-exec-lib for different use cases

import { ethers } from 'ethers';
import { buildCallData, prepareForward, signForward, executeForward } from 'meta-exec-lib';

// ============================================================================
// EXAMPLE 1: Basic NFT Minting (like Halloween NFT)
// ============================================================================

async function example1_BasicNFTMint() {
    console.log('📝 Example 1: Basic NFT Minting\n');

    // Setup
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const user = new ethers.Wallet(process.env.USER_PRIVATE_KEY, provider);
    const relayer = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);

    const HUB_ADDRESS = process.env.HUB_ADDRESS;
    const NFT_ADDRESS = process.env.NFT_CONTRACT;

    // 1. Build calldata
    const tokenUri = 'ipfs://QmExample123';
    const callData = buildCallData(
        ['function mint(string calldata tokenUri)'],
        'mint',
        [tokenUri]
    );

    console.log('✅ Calldata built');

    // 2. Prepare meta-transaction
    const prep = await prepareForward({
        provider,
        metaAddress: HUB_ADDRESS,
        domainName: 'PermissionedMetaTxHub',
        domainVersion: '1',
        hasCaller: true,
        from: user.address,
        to: NFT_ADDRESS,
        callData,
        caller: relayer.address,
        value: 0n,
        space: 1500,
        nonce: Math.floor(Math.random() * 1000000),
        deadlineSec: 24 * 60 * 60 // 24 hours
    });

    console.log('✅ Meta-transaction prepared');

    // 3. User signs
    const signature = await signForward(user, prep.domain, prep.types, prep.message);
    console.log('✅ User signed transaction');

    // 4. Relayer executes
    const tx = await executeForward({
        provider,
        metaAddress: HUB_ADDRESS,
        fTuple: prep.fTuple,
        callData: prep.callData,
        signature,
        relayer,
        hasCaller: true
    });

    console.log('✅ Transaction executed:', tx.hash);
    await tx.wait();
    console.log('✅ Confirmed!\n');
}

// ============================================================================
// EXAMPLE 2: Token Transfer (ERC-20)
// ============================================================================

async function example2_TokenTransfer() {
    console.log('📝 Example 2: Gasless ERC-20 Transfer\n');

    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const user = new ethers.Wallet(process.env.USER_PRIVATE_KEY, provider);
    const relayer = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);

    const HUB_ADDRESS = process.env.HUB_ADDRESS;
    const TOKEN_ADDRESS = '0xYourERC20TokenAddress';
    const RECIPIENT = '0xRecipientAddress';
    const AMOUNT = ethers.parseEther('10');

    // Build transfer calldata
    const callData = buildCallData(
        ['function transfer(address to, uint256 amount)'],
        'transfer',
        [RECIPIENT, AMOUNT]
    );

    // Prepare and sign
    const prep = await prepareForward({
        provider,
        metaAddress: HUB_ADDRESS,
        domainName: 'PermissionedMetaTxHub',
        domainVersion: '1',
        hasCaller: true,
        from: user.address,
        to: TOKEN_ADDRESS,
        callData,
        caller: relayer.address,
        value: 0n,
        space: 2000,
        nonce: Date.now(),
        deadlineSec: 3600 // 1 hour
    });

    const signature = await signForward(user, prep.domain, prep.types, prep.message);

    // Execute
    const tx = await executeForward({
        provider,
        metaAddress: HUB_ADDRESS,
        fTuple: prep.fTuple,
        callData: prep.callData,
        signature,
        relayer,
        hasCaller: true
    });

    console.log('✅ Token transfer executed:', tx.hash);
    await tx.wait();
    console.log('✅ Tokens transferred!\n');
}

// ============================================================================
// EXAMPLE 3: Batch Operations (Multiple Nonces)
// ============================================================================

async function example3_BatchOperations() {
    console.log('📝 Example 3: Batch Operations with Parallel Execution\n');

    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const user = new ethers.Wallet(process.env.USER_PRIVATE_KEY, provider);
    const relayer = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);

    const HUB_ADDRESS = process.env.HUB_ADDRESS;
    const CONTRACT_ADDRESS = '0xYourContractAddress';

    // Prepare multiple transactions with different nonces
    const transactions = [];
    
    for (let i = 0; i < 5; i++) {
        const callData = buildCallData(
            ['function doSomething(uint256 value)'],
            'doSomething',
            [i * 100]
        );

        const prep = await prepareForward({
            provider,
            metaAddress: HUB_ADDRESS,
            domainName: 'PermissionedMetaTxHub',
            domainVersion: '1',
            hasCaller: true,
            from: user.address,
            to: CONTRACT_ADDRESS,
            callData,
            caller: relayer.address,
            value: 0n,
            space: 3000,
            nonce: 1000 + i, // Sequential nonces for ordered execution
            deadlineSec: 3600
        });

        const signature = await signForward(user, prep.domain, prep.types, prep.message);

        transactions.push({ prep, signature });
        console.log(`✅ Transaction ${i + 1} prepared and signed`);
    }

    // Execute all transactions (can be done in parallel!)
    console.log('\n🚀 Executing all transactions...\n');
    
    const txPromises = transactions.map(async ({ prep, signature }) => {
        const tx = await executeForward({
            provider,
            metaAddress: HUB_ADDRESS,
            fTuple: prep.fTuple,
            callData: prep.callData,
            signature,
            relayer,
            hasCaller: true
        });
        return tx.wait();
    });

    const receipts = await Promise.all(txPromises);
    
    receipts.forEach((receipt, i) => {
        console.log(`✅ Transaction ${i + 1} confirmed in block ${receipt.blockNumber}`);
    });
    
    console.log('\n✅ All transactions executed!\n');
}

// ============================================================================
// EXAMPLE 4: Contract Interaction with Value (Payable)
// ============================================================================

async function example4_PayableTransaction() {
    console.log('📝 Example 4: Meta-transaction with ETH value\n');

    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const user = new ethers.Wallet(process.env.USER_PRIVATE_KEY, provider);
    const relayer = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);

    const HUB_ADDRESS = process.env.HUB_ADDRESS;
    const CONTRACT_ADDRESS = '0xYourPayableContractAddress';
    const VALUE = ethers.parseEther('0.1'); // 0.1 MATIC/ETH

    // Build calldata for payable function
    const callData = buildCallData(
        ['function deposit() payable'],
        'deposit',
        []
    );

    // Prepare with value
    const prep = await prepareForward({
        provider,
        metaAddress: HUB_ADDRESS,
        domainName: 'PermissionedMetaTxHub',
        domainVersion: '1',
        hasCaller: true,
        from: user.address,
        to: CONTRACT_ADDRESS,
        callData,
        caller: relayer.address,
        value: VALUE, // Include ETH value
        space: 4000,
        nonce: Date.now(),
        deadlineSec: 3600
    });

    const signature = await signForward(user, prep.domain, prep.types, prep.message);

    // Execute (relayer must have sufficient balance)
    const tx = await executeForward({
        provider,
        metaAddress: HUB_ADDRESS,
        fTuple: prep.fTuple,
        callData: prep.callData,
        signature,
        relayer,
        hasCaller: true
    });

    console.log('✅ Payable transaction executed:', tx.hash);
    await tx.wait();
    console.log('✅ Value transferred!\n');
}

// ============================================================================
// EXAMPLE 5: Using Different Nonce Spaces
// ============================================================================

async function example5_NonceSpaces() {
    console.log('📝 Example 5: Managing Different Nonce Spaces\n');

    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const user = new ethers.Wallet(process.env.USER_PRIVATE_KEY, provider);
    const relayer = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);

    const HUB_ADDRESS = process.env.HUB_ADDRESS;
    const CONTRACT_ADDRESS = '0xYourContractAddress';

    // Use different spaces for different purposes
    const SPACES = {
        CRITICAL: 1000,    // Sequential operations
        PARALLEL: 2000,    // Parallel operations
        TEMPORARY: 3000    // Temporary/experimental
    };

    // Critical operation (space 1000)
    console.log('Executing critical operation in space 1000...');
    const callData1 = buildCallData(['function criticalOp()'], 'criticalOp', []);
    const prep1 = await prepareForward({
        provider,
        metaAddress: HUB_ADDRESS,
        domainName: 'PermissionedMetaTxHub',
        domainVersion: '1',
        hasCaller: true,
        from: user.address,
        to: CONTRACT_ADDRESS,
        callData: callData1,
        caller: relayer.address,
        value: 0n,
        space: SPACES.CRITICAL,
        nonce: 1, // Sequential
        deadlineSec: 3600
    });
    const sig1 = await signForward(user, prep1.domain, prep1.types, prep1.message);
    const tx1 = await executeForward({
        provider,
        metaAddress: HUB_ADDRESS,
        fTuple: prep1.fTuple,
        callData: prep1.callData,
        signature: sig1,
        relayer,
        hasCaller: true
    });
    await tx1.wait();
    console.log('✅ Critical operation completed');

    // Parallel operation (space 2000)
    console.log('\nExecuting parallel operation in space 2000...');
    const callData2 = buildCallData(['function parallelOp()'], 'parallelOp', []);
    const prep2 = await prepareForward({
        provider,
        metaAddress: HUB_ADDRESS,
        domainName: 'PermissionedMetaTxHub',
        domainVersion: '1',
        hasCaller: true,
        from: user.address,
        to: CONTRACT_ADDRESS,
        callData: callData2,
        caller: relayer.address,
        value: 0n,
        space: SPACES.PARALLEL,
        nonce: Math.floor(Math.random() * 1000000), // Random for parallel
        deadlineSec: 3600
    });
    const sig2 = await signForward(user, prep2.domain, prep2.types, prep2.message);
    const tx2 = await executeForward({
        provider,
        metaAddress: HUB_ADDRESS,
        fTuple: prep2.fTuple,
        callData: prep2.callData,
        signature: sig2,
        relayer,
        hasCaller: true
    });
    await tx2.wait();
    console.log('✅ Parallel operation completed\n');
}

// ============================================================================
// EXAMPLE 6: Server-side Signature Collection (2-step flow)
// ============================================================================

async function example6_TwoStepFlow() {
    console.log('📝 Example 6: Two-Step Flow (Client Signs, Server Relays)\n');

    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const user = new ethers.Wallet(process.env.USER_PRIVATE_KEY, provider);

    const HUB_ADDRESS = process.env.HUB_ADDRESS;
    const CONTRACT_ADDRESS = '0xYourContractAddress';

    // STEP 1: Client prepares and signs (frontend)
    console.log('STEP 1: Client-side signing...');
    
    const callData = buildCallData(
        ['function someFunction(uint256 value)'],
        'someFunction',
        [42]
    );

    const prep = await prepareForward({
        provider,
        metaAddress: HUB_ADDRESS,
        domainName: 'PermissionedMetaTxHub',
        domainVersion: '1',
        hasCaller: true,
        from: user.address,
        to: CONTRACT_ADDRESS,
        callData,
        caller: ethers.ZeroAddress, // Will be filled by relayer
        value: 0n,
        space: 5000,
        nonce: Date.now(),
        deadlineSec: 3600
    });

    const signature = await signForward(user, prep.domain, prep.types, prep.message);
    
    console.log('✅ Client signed the transaction');

    // Serialize for transmission
    const payload = {
        forward: prep.message,
        signature: signature,
        callData: prep.callData
    };

    console.log('\n📤 Sending to relayer server...');
    console.log('Payload:', JSON.stringify(payload, null, 2));

    // STEP 2: Server receives and executes (backend)
    console.log('\nSTEP 2: Server-side execution...');
    
    // This would be done in your relayer server
    const relayer = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
    
    // Update forward with actual relayer address
    const forwardWithCaller = {
        ...payload.forward,
        caller: relayer.address
    };

    const fTuple = [
        forwardWithCaller.from,
        forwardWithCaller.to,
        forwardWithCaller.value,
        forwardWithCaller.data,
        forwardWithCaller.deadline,
        forwardWithCaller.caller,
        forwardWithCaller.space,
        forwardWithCaller.nonce
    ];

    const tx = await executeForward({
        provider,
        metaAddress: HUB_ADDRESS,
        fTuple,
        callData: payload.callData,
        signature: payload.signature,
        relayer,
        hasCaller: true
    });

    console.log('✅ Transaction executed:', tx.hash);
    await tx.wait();
    console.log('✅ Confirmed!\n');
}

// ============================================================================
// EXAMPLE 7: Error Handling and Retry Logic
// ============================================================================

async function example7_ErrorHandling() {
    console.log('📝 Example 7: Error Handling and Retry Logic\n');

    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const user = new ethers.Wallet(process.env.USER_PRIVATE_KEY, provider);
    const relayer = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);

    const HUB_ADDRESS = process.env.HUB_ADDRESS;
    const CONTRACT_ADDRESS = '0xYourContractAddress';

    const callData = buildCallData(
        ['function riskyOperation()'],
        'riskyOperation',
        []
    );

    const prep = await prepareForward({
        provider,
        metaAddress: HUB_ADDRESS,
        domainName: 'PermissionedMetaTxHub',
        domainVersion: '1',
        hasCaller: true,
        from: user.address,
        to: CONTRACT_ADDRESS,
        callData,
        caller: relayer.address,
        value: 0n,
        space: 6000,
        nonce: Date.now(),
        deadlineSec: 3600
    });

    const signature = await signForward(user, prep.domain, prep.types, prep.message);

    // Retry logic
    const MAX_RETRIES = 3;
    let attempt = 0;

    while (attempt < MAX_RETRIES) {
        try {
            console.log(`Attempt ${attempt + 1}/${MAX_RETRIES}...`);

            const tx = await executeForward({
                provider,
                metaAddress: HUB_ADDRESS,
                fTuple: prep.fTuple,
                callData: prep.callData,
                signature,
                relayer,
                hasCaller: true
            });

            console.log('✅ Transaction sent:', tx.hash);
            
            const receipt = await tx.wait();
            console.log('✅ Confirmed in block:', receipt.blockNumber);
            break; // Success!

        } catch (error) {
            attempt++;
            console.error(`❌ Attempt ${attempt} failed:`, error.message);

            if (attempt >= MAX_RETRIES) {
                console.error('❌ Max retries reached. Transaction failed.');
                throw error;
            }

            // Parse error and decide if retry makes sense
            if (error.message.includes('nonce already used')) {
                console.log('⚠️  Nonce already used. Not retrying.');
                break;
            } else if (error.message.includes('gas')) {
                console.log('⏳ Gas issue. Waiting 10 seconds before retry...');
                await new Promise(resolve => setTimeout(resolve, 10000));
            } else {
                console.log('⏳ Waiting 5 seconds before retry...');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    console.log();
}

// ============================================================================
// Main execution
// ============================================================================

async function main() {
    const examples = {
        '1': example1_BasicNFTMint,
        '2': example2_TokenTransfer,
        '3': example3_BatchOperations,
        '4': example4_PayableTransaction,
        '5': example5_NonceSpaces,
        '6': example6_TwoStepFlow,
        '7': example7_ErrorHandling
    };

    const args = process.argv.slice(2);
    const exampleNum = args[0];

    if (!exampleNum || !examples[exampleNum]) {
        console.log(`
╔════════════════════════════════════════════════════════════════╗
║         Meta-Exec-Lib Integration Examples                     ║
╚════════════════════════════════════════════════════════════════╝

Usage: node integration-examples.js [example-number]

Available Examples:

  1 - Basic NFT Minting (Halloween NFT pattern)
  2 - Gasless ERC-20 Token Transfer
  3 - Batch Operations with Parallel Execution
  4 - Meta-transaction with ETH Value (Payable)
  5 - Managing Different Nonce Spaces
  6 - Two-Step Flow (Client Signs, Server Relays)
  7 - Error Handling and Retry Logic

Example:
  node integration-examples.js 1

Environment variables required:
  RPC_URL, USER_PRIVATE_KEY, RELAYER_PRIVATE_KEY,
  HUB_ADDRESS, NFT_CONTRACT (for example 1)
        `);
        process.exit(0);
    }

    try {
        await examples[exampleNum]();
    } catch (error) {
        console.error('❌ Example failed:', error);
        process.exit(1);
    }
}

main().catch(console.error);