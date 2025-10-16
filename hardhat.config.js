// hardhat.config.js
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

export default {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      metadata: { bytecodeHash: "none" }, // <- MUY importante si el deploy se hizo así
    },
  },
  networks: {
    amoy: {
      url: process.env.RPC_URL || "https://rpc-amoy.polygon.technology/",
      accounts: process.env.RELAYER_PK ? [process.env.RELAYER_PK] : [],
      chainId: 80002,
      // ✅ usa number o string, NO BigInt:
      gasPrice: 30_000_000_000,       // number en wei (30 gwei)
      // o: gasPrice: "30000000000",
      // o simplemente: omite gasPrice y deja "auto"
    },
  },
};

