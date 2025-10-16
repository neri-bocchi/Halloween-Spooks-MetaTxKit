require('dotenv').config();
const { ethers } = require('hardhat');
const { writeFileSync } = require('fs');



const FORWARDER = process.env.HUB_ADDRESS; // tu MinimalForwarder
if (!FORWARDER) {
  console.error('Falta TRUSTED_FORWARDER en .env');
  process.exit(1);
}

// Replacer para JSON.stringify que convierte bigint -> string
const bigintReplacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);

async function main() {
  console.log('🎃 Deploying HalloweenNFT Contract...\n');

  const [deployer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(deployer.address);

  console.log(`📍 Deploying with account: ${deployer.address}`);
  console.log(`💰 Account balance: ${ethers.formatUnits(bal, 18)} MATIC\n`);
  console.log(`🔗 Trusted Forwarder (Hub): ${FORWARDER}\n`);

  console.log('📦 Deploying HalloweenNFT...');
  const NFT = await ethers.getContractFactory('HalloweenNFT');
  const nft = await NFT.deploy(FORWARDER);
  await nft.waitForDeployment();

  const nftAddr = await nft.getAddress();
  console.log(`✅ HalloweenNFT deployed to: ${nftAddr}`);

  // Si querés loguear tx/receipt, convertí los bigint a string
  const deployTx = nft.deploymentTransaction();
  const receipt = await deployTx.wait();

  // Log “seguro” (sin BigInt)
  console.log('🧾 Receipt:');
  console.log(
    JSON.stringify(
      {
        hash: deployTx.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed?.toString(),
      },
      null,
      2
    )
  );

  // Guardar addresses.json con replacer
  const out = {
    network: (await ethers.provider.getNetwork()).name ?? 'custom',
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    forwarder: FORWARDER,
    halloweenNFT: nftAddr,
    deployTxHash: deployTx.hash,
  };
  writeFileSync('./addresses.json', JSON.stringify(out, bigintReplacer, 2));
  console.log('📝 addresses.json escrito.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});