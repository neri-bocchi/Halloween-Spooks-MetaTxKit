"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";

/**
 * Halloween Spooks – React single-file webapp
 * - Gasless mint via MetaTxHub (EIP-712 sign + relayer POST)
 * - Wallet connect/disconnect
 * - Shows owned NFT (myToken)
 * - Modal with metadata + attributes
 *
 * Notes:
 * - Update CONFIG.RELAYER_ENDPOINT for your relayer URL.
 * - Requires MetaMask (or any provider injecting window.ethereum).
 */

const CONFIG = {
  NFT_CONTRACT: "0x0F835E9947f15A799eB173FEFE39f572279fA7Ac",
  HUB_CONTRACT: "0xe8cB75877D6277bCD423f39177BbEB32eDbd899b",
  RELAYER_ENDPOINT: "http://127.0.0.1:3000/relay",
  CHAIN_ID: 80002, // Polygon Amoy
  HTTP_GATEWAY: "https://ipfs.io/ipfs/",
};

const NFT_ABI = [
  "function mint(string calldata tokenUri) public",
  "function minted(address) public view returns (bool)",
  "function myToken() public view returns (uint256 id, string memory uri)",
  "function tokenURI(uint256 tokenId) public view returns (string)",
];

const SPOOKY_EMOJIS = ["🎃", "👻", "🦇", "🕷️", "💀", "🕸️", "🧛", "🧟", "🍬", "🌙"];

const styles = {
  page: "min-h-screen bg-[#0a0514] text-[#e0e0e0] overflow-x-hidden",
  container: "max-w-[600px] mx-auto px-5 py-10",
  header: "text-center mb-10 pt-2",
  h1: "text-5xl font-black mb-4 bg-gradient-to-br from-[#ff6b00] to-[#8b00ff] bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(255,107,0,0.3)]",
  subtitle: "text-[18px] text-[#b0b0b0] mb-2",
  badgeWrap: "inline-block",
  badge: "inline-block px-5 py-2 rounded-full text-[13px] font-semibold text-[#8b00ff] border border-[#8b00ff]/40 bg-[#8b00ff]/20",
  card: "bg-white/5 border border-white/10 rounded-3xl p-10 backdrop-blur-xl shadow-[0_20px_60px_rgba(0,0,0,0.5)]",
  preview: "w-full aspect-square rounded-2xl border-2 border-[#8b00ff]/30 bg-gradient-to-br from-[#8b00ff]/10 to-[#ff4500]/10 flex items-center justify-center text-[200px] mb-7 overflow-hidden relative select-none",
  infoRow: "flex justify-between py-4 border-b border-white/5 last:border-b-0",
  infoLabel: "text-sm text-gray-400",
  infoValue: "text-sm font-semibold text-white",
  freeBadge: "bg-gradient-to-br from-[#ff6b00] to-[#ff4500] text-white text-xs font-bold px-3 py-1 rounded-xl",
  walletAddr: "mt-4 p-4 rounded-xl font-mono text-sm text-[#8b00ff] text-center border border-[#8b00ff]/20 bg-black/30 break-all",
  btn: "w-full py-4 rounded-2xl text-lg font-bold cursor-pointer transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed",
  btnPrimary: "bg-gradient-to-br from-[#ff6b00] to-[#8b00ff] text-white shadow-[0_10px_40px_rgba(255,107,0,0.3)] hover:translate-y-[-2px] hover:shadow-[0_15px_50px_rgba(255,107,0,0.5)]",
  status: "mt-5 p-4 rounded-xl text-sm text-center hidden",
  statusShow: "block",
  statusSuccess: "bg-green-500/10 border border-green-500/30 text-green-400",
  statusError: "bg-red-500/10 border border-red-500/30 text-red-300",
  statusInfo: "bg-[#8b00ff]/10 border border-[#8b00ff]/30 text-[#8b00ff]",
  ownedCard: "mt-6 bg-white/5 border border-white/10 rounded-2xl p-4",
  ownedGrid: "grid grid-cols-[120px,1fr] gap-4 items-center",
  ownedImg: "w-full aspect-square rounded-xl object-cover border border-white/20 hover:scale-105 hover:border-[#8b00ff]/50 hover:shadow-[0_5px_20px_rgba(139,0,255,0.3)] transition-all cursor-pointer",
  mono: "font-mono break-all text-[#c9c9c9]",
  footer: "mt-10 text-center text-sm text-[#b0b0b0]",
  // Modal
  overlay: "fixed inset-0 bg-black/85 backdrop-blur-sm z-[1000] hidden",
  overlayShow: "flex items-center justify-center p-5",
  modal: "bg-gradient-to-br from-[rgba(20,10,30,0.95)] to-[rgba(10,5,20,0.95)] border-2 border-[#8b00ff]/40 rounded-3xl w-[90%] max-w-[600px] max-h-[90vh] overflow-y-auto shadow-[0_30px_80px_rgba(139,0,255,0.5)] animate-[slideUp_.3s_ease] relative",
  modalHeader: "px-8 pt-8 pb-5 border-b border-white/10 flex items-center justify-between",
  modalTitle: "text-2xl font-bold bg-gradient-to-br from-[#ff6b00] to-[#8b00ff] bg-clip-text text-transparent",
  modalClose: "text-white text-3xl w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-all",
  modalBody: "p-8",
  modalImg: "w-full aspect-square rounded-2xl object-cover mb-6 border-2 border-[#8b00ff]/30",
  metaSection: "bg-black/30 rounded-2xl p-5 mb-5",
  metaTitle: "text-lg font-bold text-[#8b00ff] mb-4 flex items-center gap-2",
  metaRow: "flex justify-between py-3 border-b border-white/5 last:border-b-0",
  metaLabel: "text-sm text-gray-400",
  metaValue: "text-sm font-semibold text-white text-right max-w-[60%] break-words",
  attrsGrid: "grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3",
  attrCard: "text-center bg-[#8b00ff]/10 border border-[#8b00ff]/30 rounded-xl p-3",
  attrType: "text-[11px] text-gray-400 uppercase mb-1",
  attrValue: "text-base font-bold text-[#8b00ff]",
};

function ipfsToHttp(uri) {
  if (!uri) return "";
  const clean = uri.replace("images/", "");
  if (clean.startsWith("ipfs://")) return CONFIG.HTTP_GATEWAY + clean.replace("ipfs://", "");
  return clean;
}

export default function HalloweenSpooksApp() {
  // web3 state
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [nft, setNft] = useState(null);
  const [userAddress, setUserAddress] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [mintDisabled, setMintDisabled] = useState(true);

  // UI state
  const [status, setStatus] = useState({ show: false, type: "info", msg: "" });
  const [emoji, setEmoji] = useState("🎃");
  const prevEmojiRef = useRef("");
  const intervalRef = useRef(null);

  // Owned NFT metadata for card + modal
  const [ownedVisible, setOwnedVisible] = useState(false);
  const [owned, setOwned] = useState({ id: "-", uri: "-", image: "", name: "-", description: "-", attributes: [] });
  const [modalOpen, setModalOpen] = useState(false);

  // -------- Emoji rotation --------
  const rotateEmoji = () => {
    let next = SPOOKY_EMOJIS[Math.floor(Math.random() * SPOOKY_EMOJIS.length)];
    while (next === prevEmojiRef.current) {
      next = SPOOKY_EMOJIS[Math.floor(Math.random() * SPOOKY_EMOJIS.length)];
    }
    prevEmojiRef.current = next;
    setEmoji(next);
  };

  useEffect(() => {
    rotateEmoji();
    intervalRef.current = setInterval(rotateEmoji, 3000);
    return () => clearInterval(intervalRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------- Status helpers --------
  const showStatus = (msg, type = "info") => setStatus({ show: true, type, msg });
  const hideStatusSoon = () => setTimeout(() => setStatus((s) => ({ ...s, show: false })), 2000);

  // -------- Connect / Disconnect --------
  const updateMintEligibility = async (contract, addr) => {
    try {
      const hasMinted = await contract.minted(addr);
      setMintDisabled(!!hasMinted);
      if (hasMinted) {
        await loadOwned(contract);
      }
    } catch (e) {
      // ignore
    }
  };

  const connectWallet = async () => {
    try {
      if (!window.ethereum) throw new Error("No Ethereum provider found. Please install MetaMask.");
      const prov = new ethers.providers.Web3Provider(window.ethereum);
      await prov.send("eth_requestAccounts", []);
      const sig = prov.getSigner();
      const addr = await sig.getAddress();
      const contract = new ethers.Contract(CONFIG.NFT_CONTRACT, NFT_ABI, sig);

      setProvider(prov);
      setSigner(sig);
      setNft(contract);
      setUserAddress(addr);
      setIsConnected(true);
      setMintDisabled(false);
      showStatus("Wallet connected!", "success");

      await updateMintEligibility(contract, addr);
    } catch (e) {
      showStatus(`Error: ${e.message}`, "error");
      disconnectWallet();
    }
  };

  const disconnectWallet = () => {
    setProvider(null);
    setSigner(null);
    setNft(null);
    setUserAddress("");
    setIsConnected(false);
    setMintDisabled(true);
    setOwnedVisible(false);
    setOwned({ id: "-", uri: "-", image: "", name: "-", description: "-", attributes: [] });
    showStatus("Wallet disconnected", "info");
    hideStatusSoon();
  };

  const toggleWallet = async () => {
    if (isConnected) disconnectWallet();
    else await connectWallet();
  };

  // -------- Load owned NFT --------
  const loadOwned = async (contract) => {
    try {
      const res = await contract.myToken();
      const id = res.id ?? res[0];
      const uri = res.uri ?? res[1];
      if (!id || id.toString() === "0") {
        setOwnedVisible(false);
        return;
      }
      const metaUrl = ipfsToHttp(uri);
      const meta = await fetch(metaUrl).then((r) => r.json()).catch(() => ({}));
      const image = ipfsToHttp(meta.image || meta.image_url || "");
      const data = {
        id: id.toString(),
        uri,
        name: meta.name || `Halloween Spook #${id}`,
        description: meta.description || "A spooky NFT from the Halloween collection",
        image,
        attributes: meta.attributes || [],
      };
      setOwned(data);
      setOwnedVisible(true);
    } catch (e) {
      setOwnedVisible(false);
      // console.warn('No NFT found', e)
    }
  };

  // -------- Modal --------
  const openModal = () => setModalOpen(true);
  const closeModal = () => setModalOpen(false);
  const closeOnOverlay = (e) => {
    if (e.target.id === "overlay") closeModal();
  };

  // -------- Mint (gasless) --------
  const mintNFT = async () => {
    if (!signer || !nft) return;
    try {
      const BASE = "ipfs://bafybeidz5soljygj4rjouso7w6dg255ugdwg4iqylh76zvv373473uqwta/";
      const rand = 1 + (crypto.getRandomValues(new Uint32Array(1))[0] % 100);
      const uri = `${BASE}${rand}.json`;

      showStatus("Minting...", "info");

      const iface = new ethers.utils.Interface(NFT_ABI);
      const callData = iface.encodeFunctionData("mint", [uri]);
      const dataHash = ethers.utils.keccak256(callData);

      const domain = {
        name: "PermissionedMetaTxHub",
        version: "1",
        chainId: CONFIG.CHAIN_ID,
        verifyingContract: CONFIG.HUB_CONTRACT,
      };

      const types = {
        Forward: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "space", type: "uint32" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "dataHash", type: "bytes32" },
          { name: "caller", type: "address" },
        ],
      };

      const msg = {
        from: userAddress,
        to: CONFIG.NFT_CONTRACT,
        value: 0,
        space: 111,
        nonce: Date.now(),
        deadline: Math.floor(Date.now() / 1000) + 86400,
        dataHash,
        caller: "0xA7293f15A7c1cF346aafD603a8D0E1Bc681d7b45",
      };

      const signature = await signer._signTypedData(domain, types, msg);

      const resp = await fetch(CONFIG.RELAYER_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forward: msg, signature, callData }),
      });
      const out = await resp.json().catch(() => ({}));

      if (out && out.txHash) {
        showStatus(
          `Minted! <a class="underline" href="https://amoy.polygonscan.com/tx/${out.txHash}" target="_blank" rel="noreferrer">View</a>`,
          "success"
        );
        setMintDisabled(true);
        setTimeout(() => loadOwned(nft), 4000);
      } else {
        showStatus("Mint failed", "error");
      }
    } catch (e) {
      showStatus(`Error: ${e.message}`, "error");
    }
  };

  // ---------- Render ----------
  const connectBtnBg = isConnected
    ? "bg-gradient-to-br from-[#ff4500] to-[#dc143c]"
    : "bg-gradient-to-br from-[#ff6b00] to-[#8b00ff]";
  const connectBtnText = isConnected ? "🔌 Disconnect Wallet" : "🦊 Connect Wallet";

  return (
    <div className={styles.page}>
      {/* subtle ambience */}
      <div className="fixed inset-0 -z-10" aria-hidden>
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 20% 50%, rgba(139,0,255,.15) 0%, transparent 50%)," +
              "radial-gradient(circle at 80% 20%, rgba(255,69,0,.1) 0%, transparent 50%)," +
              "radial-gradient(circle at 50% 80%, rgba(0,0,0,.8) 0%, transparent 50%)",
          }}
        />
        <div className="fixed text-[60px] opacity-10 left-[10%] top-[10%] animate-[float_20s_infinite_ease-in-out]">👻</div>
        <div className="fixed text-[60px] opacity-10 right-[15%] top-[60%] animate-[float_20s_infinite_ease-in-out] [animation-delay:-5s]">🎃</div>
        <style>{`
          @keyframes float { 0%,100%{transform:translateY(0) translateX(0)} 25%{transform:translateY(-30px) translateX(20px)} 50%{transform:translateY(-60px) translateX(-20px)} 75%{transform:translateY(-30px) translateX(20px)} }
          @keyframes slideUp { from{transform:translateY(50px);opacity:0} to{transform:translateY(0);opacity:1} }
        `}</style>
      </div>

      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.h1}>👻 Halloween Spooks 🎃</h1>
          <p className={styles.subtitle}>Free NFT Mint with Gasless Transactions</p>
          <a href="https://github.com/neri-bocchi/PermissionedMetaTxKit" target="_blank" rel="noreferrer">
            <div className={styles.badge}>⚡ Powered by MetaTxKit</div>
          </a>
        </header>

        <div className={styles.card}>
          <div className={styles.preview} aria-live="polite">
            <span
              key={emoji}
              className="transition-all duration-500 inline-block"
              style={{ transform: "scale(1) rotate(0deg)", opacity: 1 }}
            >
              {emoji}
            </span>
          </div>

          <div className="mb-7">
            <div className={styles.infoRow}><span className={styles.infoLabel}>Price</span><span className={styles.freeBadge}>FREE</span></div>
            <div className={styles.infoRow}><span className={styles.infoLabel}>Limit per wallet</span><span className={styles.infoValue}>1 NFT</span></div>
            <div className={styles.infoRow}><span className={styles.infoLabel}>Contract Address:</span><span className={styles.infoValue}>{CONFIG.NFT_CONTRACT}</span></div>
          </div>

          <button className={`${styles.btn} ${connectBtnBg} text-white`} onClick={toggleWallet}>
            <span>{connectBtnText}</span>
          </button>

          {isConnected && (
            <div className={styles.walletAddr}>{userAddress}</div>
          )}

          <div className="mt-4" />

          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={mintNFT} disabled={mintDisabled}>
            <span>Mint my Spook</span>
          </button>

          <div
            className={`${styles.status} ${status.show ? styles.statusShow : ""} ${
              status.type === "success"
                ? styles.statusSuccess
                : status.type === "error"
                ? styles.statusError
                : styles.statusInfo
            }`}
            dangerouslySetInnerHTML={{ __html: status.msg }}
          />

          {ownedVisible && (
            <div className={styles.ownedCard}>
              <div className={styles.ownedGrid}>
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                {owned.image && (<img src={owned.image} className={styles.ownedImg} alt="Your NFT" onClick={openModal} />)}
                <div>
                  <div className="font-semibold">You already mint a token with this address</div>
                  <div><strong>Token ID:</strong> <span>{owned.id}</span></div>
                  <div className="hidden"><strong>Token URI:</strong> <span className={styles.mono}>{owned.uri}</span></div>
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className={styles.footer}>Built with 💜 using MetaTxKit &amp; ERC-2771</footer>
      </div>

      {/* Modal */}
      <div
        id="overlay"
        className={`${styles.overlay} ${modalOpen ? styles.overlayShow : ""}`}
        onClick={closeOnOverlay}
      >
        <div className={styles.modal}>
          <div className={styles.modalHeader}>
            <h2 className={styles.modalTitle}>🎃 Your Halloween Spook</h2>
            <button className={styles.modalClose} onClick={closeModal} aria-label="Close">×</button>
          </div>
          <div className={styles.modalBody}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <img src={owned.image} className={styles.modalImg} />

            <div className={styles.metaSection}>
              <div className={styles.metaTitle}>📋 NFT Details</div>
              <div className={styles.metaRow}><span className={styles.metaLabel}>Name</span><span className={styles.metaValue}>{owned.name}</span></div>
              <div className={styles.metaRow}><span className={styles.metaLabel}>Description</span><span className={styles.metaValue}>{owned.description}</span></div>
              <div className={styles.metaRow}><span className={styles.metaLabel}>Token ID</span><span className={styles.metaValue}>{owned.id}</span></div>
              <div className={styles.metaRow}><span className={`${styles.metaValue} ${styles.mono}`}>{owned.uri}</span></div>
            </div>

            {owned.attributes && owned.attributes.length > 0 && (
              <div className={styles.metaSection}>
                <div className={styles.metaTitle}>✨ Attributes</div>
                <div className={styles.attrsGrid}>
                  {owned.attributes.map((a, i) => (
                    <div key={i} className={styles.attrCard}>
                      <div className={styles.attrType}>{a.trait_type || "Property"}</div>
                      <div className={styles.attrValue}>{String(a.value)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
