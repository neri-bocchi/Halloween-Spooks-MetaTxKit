// scripts/deployHalloweenNFT.js
// Hardhat deployment script for HalloweenNFT contract

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    console.log("🎃 Deploying HalloweenNFT Contract...\n");

    // Get the deployer account
    const [deployer] = await hre.ethers.getSigners();
    console.log("📍 Deploying with account:", deployer.address);
    
    const balance = await hre.ethers.provider.getBalance(deployer.address);
    console.log("💰 Account balance:", hre.ethers.formatEther(balance), "MATIC\n");

    // Get the trusted forwarder (PermissionedMetaTxHub) address
    const trustedForwarder = process.env.HUB_ADDRESS;
    
    if (!trustedForwarder) {
        throw new Error("❌ HUB_ADDRESS not set in environment variables");
    }

    console.log("🔗 Trusted Forwarder (Hub):", trustedForwarder);

    // Deploy HalloweenNFT
    console.log("\n📦 Deploying HalloweenNFT...");
    const HalloweenNFT = await hre.ethers.getContractFactory("HalloweenNFT");
    const nft = await HalloweenNFT.deploy(trustedForwarder);
    
    await nft.waitForDeployment();
    const nftAddress = await nft.getAddress();

    console.log("✅ HalloweenNFT deployed to:", nftAddress);

    // Save deployment info
    const deploymentInfo = {
        network: hre.network.name,
        chainId: (await hre.ethers.provider.getNetwork()).chainId,
        contract: "HalloweenNFT",
        address: nftAddress,
        trustedForwarder: trustedForwarder,
        deployer: deployer.address,
        timestamp: new Date().toISOString(),
        blockNumber: await hre.ethers.provider.getBlockNumber()
    };

    // Create deployments directory if it doesn't exist
    const deploymentsDir = path.join(__dirname, "../.deployments");
    if (!fs.existsSync(deploymentsDir)) {
        fs.mkdirSync(deploymentsDir, { recursive: true });
    }

    // Save deployment data
    const filename = path.join(
        deploymentsDir,
        `HalloweenNFT-${hre.network.name}.json`
    );
    fs.writeFileSync(filename, JSON.stringify(deploymentInfo, null, 2));

    console.log("\n💾 Deployment info saved to:", filename);

    // Print summary
    console.log("\n" + "=".repeat(60));
    console.log("📋 DEPLOYMENT SUMMARY");
    console.log("=".repeat(60));
    console.log("Network:          ", hre.network.name);
    console.log("Chain ID:         ", deploymentInfo.chainId.toString());
    console.log("Contract:         ", nftAddress);
    console.log("Trusted Forwarder:", trustedForwarder);
    console.log("Deployer:         ", deployer.address);
    console.log("Block:            ", deploymentInfo.blockNumber);
    console.log("=".repeat(60));

    // Print next steps
    console.log("\n📝 NEXT STEPS:\n");
    console.log("1️⃣  Update frontend config:");
    console.log(`   NFT_CONTRACT: '${nftAddress}'`);
    console.log(`   HUB_CONTRACT: '${trustedForwarder}'`);
    
    console.log("\n2️⃣  Update relayer .env:");
    console.log(`   NFT_CONTRACT=${nftAddress}`);
    console.log(`   HUB_ADDRESS=${trustedForwarder}`);
    
    console.log("\n3️⃣  Configure relayer permissions:");
    console.log("   node scripts/admin/setupCallerAllowlist.js");
    console.log("   node scripts/admin/setupGasLimit.js [RELAYER_ADDRESS] [GAS_LIMIT]");

    // Verify contract (if on a supported network)
    if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
        console.log("\n4️⃣  Verify contract on block explorer:");
        console.log(`   npx hardhat verify --network ${hre.network.name} ${nftAddress} ${trustedForwarder}`);
        
        // Wait a bit before verification attempt
        console.log("\n⏳ Waiting 30 seconds before verification...");
        await new Promise(resolve => setTimeout(resolve, 30000));
        
        try {
            console.log("🔍 Attempting to verify contract...");
            await hre.run("verify:verify", {
                address: nftAddress,
                constructorArguments: [trustedForwarder],
            });
            console.log("✅ Contract verified successfully!");
        } catch (error) {
            console.log("⚠️  Verification failed:", error.message);
            console.log("   You can verify manually later with the command above.");
        }
    }

    console.log("\n✨ Deployment complete!\n");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("\n❌ Deployment failed:", error);
        process.exit(1);
    });