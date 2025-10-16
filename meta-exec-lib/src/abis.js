export const META_ABI = [
  "function execute((address,address,uint256,uint32,uint256,uint256,bytes32,address),bytes,bytes) payable",
  "function isNonceUsed(address,uint32,uint256) view returns (bool)",
  "function isCallerAllowed(address) view returns (bool)",
  "event ContractDeployed(address indexed signer, address deployed, bytes32 dataHash)"
];

export const EXECUTE_SIG =
  "execute((address,address,uint256,uint32,uint256,uint256,bytes32,address),bytes,bytes)";