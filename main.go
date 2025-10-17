package main

import (
	"context"
	"crypto/ecdsa"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
	"github.com/rs/cors"
)

// Configuration holds server configuration
type Config struct {
	Port              string
	RPCURL            string
	RelayerPrivateKey string
	HubAddress        common.Address
	NFTContract       common.Address
	ChainID           *big.Int
	MaxGasPrice       *big.Int
}

// Bytes32 is a custom type for handling hex string to [32]byte conversion
type Bytes32 [32]byte

// UnmarshalJSON implements json.Unmarshaler for Bytes32
func (b *Bytes32) UnmarshalJSON(data []byte) error {
	var hexStr string
	if err := json.Unmarshal(data, &hexStr); err != nil {
		return err
	}

	// Remove 0x prefix if present
	hexStr = strings.TrimPrefix(hexStr, "0x")

	// Decode hex string
	decoded, err := hex.DecodeString(hexStr)
	if err != nil {
		return fmt.Errorf("invalid hex string: %v", err)
	}

	if len(decoded) != 32 {
		return fmt.Errorf("expected 32 bytes, got %d", len(decoded))
	}

	copy(b[:], decoded)
	return nil
}

// MarshalJSON implements json.Marshaler for Bytes32
func (b Bytes32) MarshalJSON() ([]byte, error) {
	return json.Marshal("0x" + hex.EncodeToString(b[:]))
}

// Forward struct matches the smart contract's Forward struct
type Forward struct {
	From     common.Address `json:"from"`
	To       common.Address `json:"to"`
	Value    *big.Int       `json:"value"`
	Space    uint32         `json:"space"`
	Nonce    *big.Int       `json:"nonce"`
	Deadline *big.Int       `json:"deadline"`
	DataHash Bytes32        `json:"dataHash"`
	Caller   common.Address `json:"caller"`
}

// RelayRequest represents the incoming relay request
type RelayRequest struct {
	Forward   Forward `json:"forward"`
	Signature string  `json:"signature"`
	CallData  string  `json:"callData"`
}

// RelayResponse represents the relay response
type RelayResponse struct {
	Success         bool   `json:"success"`
	TxHash          string `json:"txHash,omitempty"`
	TransactionHash string `json:"transactionHash,omitempty"`
	BlockNumber     uint64 `json:"blockNumber,omitempty"`
	GasUsed         string `json:"gasUsed,omitempty"`
	Error           string `json:"error,omitempty"`
	Details         string `json:"details,omitempty"`
}

// HealthResponse represents health check response
type HealthResponse struct {
	Status    string `json:"status"`
	Relayer   string `json:"relayer"`
	Timestamp int64  `json:"timestamp"`
}

// RateLimit tracks request rates per address
type RateLimit struct {
	mu       sync.RWMutex
	requests map[string][]int64
}

// Server holds the relayer server state
type Server struct {
	config            Config
	client            *ethclient.Client
	relayerKey        *ecdsa.PrivateKey
	relayerAddress    common.Address
	processedRequests map[string]time.Time
	reqMutex          sync.RWMutex
	rateLimit         *RateLimit
}

const (
	cacheDuration        = 5 * time.Minute
	rateLimitWindow      = 1 * time.Minute
	maxRequestsPerWindow = 5
	cleanupInterval      = 1 * time.Minute
)

// Hub Contract ABI (execute function)
const hubABI = `[
	{
		"inputs": [
			{
				"components": [
					{"name": "from", "type": "address"},
					{"name": "to", "type": "address"},
					{"name": "value", "type": "uint256"},
					{"name": "space", "type": "uint32"},
					{"name": "nonce", "type": "uint256"},
					{"name": "deadline", "type": "uint256"},
					{"name": "dataHash", "type": "bytes32"},
					{"name": "caller", "type": "address"}
				],
				"name": "forward",
				"type": "tuple"
			},
			{"name": "callData", "type": "bytes"},
			{"name": "signature", "type": "bytes"}
		],
		"name": "execute",
		"outputs": [],
		"stateMutability": "payable",
		"type": "function"
	},
	{
		"inputs": [
			{"name": "user", "type": "address"},
			{"name": "space", "type": "uint32"},
			{"name": "nonce", "type": "uint256"}
		],
		"name": "isNonceUsed",
		"outputs": [{"name": "", "type": "bool"}],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [{"name": "caller", "type": "address"}],
		"name": "isCallerAllowed",
		"outputs": [{"name": "", "type": "bool"}],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"anonymous": false,
		"inputs": [
			{"indexed": true, "name": "signer", "type": "address"},
			{"indexed": false, "name": "deployed", "type": "address"},
			{"indexed": false, "name": "dataHash", "type": "bytes32"}
		],
		"name": "ContractDeployed",
		"type": "event"
	}
]`

// NFT Contract ABI (minimal)
const nftABI = `[
	{
		"inputs": [{"name": "tokenUri", "type": "string"}],
		"name": "mint",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [{"name": "", "type": "address"}],
		"name": "minted",
		"outputs": [{"name": "", "type": "bool"}],
		"stateMutability": "view",
		"type": "function"
	}
]`

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}

	// Initialize configuration
	config, err := loadConfig()
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	// Create server
	server, err := NewServer(config)
	if err != nil {
		log.Fatalf("Failed to create server: %v", err)
	}

	// Setup HTTP server
	r := mux.NewRouter()
	r.HandleFunc("/health", server.healthHandler).Methods("GET")
	r.HandleFunc("/relay", server.relayHandler).Methods("POST")

	// CORS configuration
	c := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders: []string{"*"},
	})

	handler := c.Handler(r)

	// Start cleanup routine
	go server.cleanupRoutine()

	// HTTP server with graceful shutdown
	srv := &http.Server{
		Addr:    ":" + config.Port,
		Handler: handler,
	}

	// Start server in goroutine
	go func() {
		log.Printf("\n🎃 Halloween NFT Relayer Server running on port %s\n", config.Port)
		log.Printf("📝 POST /relay - Submit meta-transaction\n")
		log.Printf("💚 GET  /health - Health check\n\n")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("\n👋 Shutting down relayer server...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("Server forced to shutdown:", err)
	}

	log.Println("Server exited")
}

// loadConfig loads configuration from environment variables
func loadConfig() (Config, error) {
	port := getEnv("PORT", "3000")
	rpcURL := os.Getenv("RPC_URL")
	if rpcURL == "" {
		return Config{}, fmt.Errorf("RPC_URL is required")
	}

	relayerKey := os.Getenv("RELAYER_PRIVATE_KEY")
	if relayerKey == "" {
		return Config{}, fmt.Errorf("RELAYER_PRIVATE_KEY is required")
	}

	hubAddr := os.Getenv("HUB_ADDRESS")
	if hubAddr == "" {
		return Config{}, fmt.Errorf("HUB_ADDRESS is required")
	}

	nftAddr := os.Getenv("NFT_CONTRACT")
	if nftAddr == "" {
		return Config{}, fmt.Errorf("NFT_CONTRACT is required")
	}

	chainIDStr := getEnv("CHAIN_ID", "80002")
	chainID, ok := new(big.Int).SetString(chainIDStr, 10)
	if !ok {
		return Config{}, fmt.Errorf("invalid CHAIN_ID")
	}

	maxGasPrice := new(big.Int).Mul(big.NewInt(100), big.NewInt(1e9)) // 100 gwei

	return Config{
		Port:              port,
		RPCURL:            rpcURL,
		RelayerPrivateKey: relayerKey,
		HubAddress:        common.HexToAddress(hubAddr),
		NFTContract:       common.HexToAddress(nftAddr),
		ChainID:           chainID,
		MaxGasPrice:       maxGasPrice,
	}, nil
}

// NewServer creates a new relayer server
func NewServer(config Config) (*Server, error) {
	// Connect to Ethereum client
	client, err := ethclient.Dial(config.RPCURL)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Ethereum client: %v", err)
	}

	// Load relayer private key
	privateKey, err := crypto.HexToECDSA(strings.TrimPrefix(config.RelayerPrivateKey, "0x"))
	if err != nil {
		return nil, fmt.Errorf("failed to load private key: %v", err)
	}

	relayerAddress := crypto.PubkeyToAddress(privateKey.PublicKey)

	log.Println("🚀 Starting Relayer Server...")
	log.Printf("📍 Relayer Address: %s\n", relayerAddress.Hex())
	log.Printf("🌐 Network: %s\n", config.ChainID.String())
	log.Printf("📜 Hub Contract: %s\n", config.HubAddress.Hex())
	log.Printf("🎃 NFT Contract: %s\n", config.NFTContract.Hex())

	return &Server{
		config:            config,
		client:            client,
		relayerKey:        privateKey,
		relayerAddress:    relayerAddress,
		processedRequests: make(map[string]time.Time),
		rateLimit:         &RateLimit{requests: make(map[string][]int64)},
	}, nil
}

// healthHandler handles health check requests
func (s *Server) healthHandler(w http.ResponseWriter, r *http.Request) {
	response := HealthResponse{
		Status:    "ok",
		Relayer:   s.relayerAddress.Hex(),
		Timestamp: time.Now().Unix(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// relayHandler handles relay requests
func (s *Server) relayHandler(w http.ResponseWriter, r *http.Request) {
	log.Println("\n=== 🔍 NEW RELAY REQUEST ===")
	log.Printf("Method: %s\n", r.Method)
	log.Printf("Content-Type: %s\n", r.Header.Get("Content-Type"))
	log.Printf("Content-Length: %d\n", r.ContentLength)

	var req RelayRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("❌ JSON Decode Error: %v\n", err)
		s.sendError(w, http.StatusBadRequest, "Invalid request body", err.Error())
		return
	}

	log.Println("✅ Request body decoded successfully")
	log.Printf("Signature present: %v (length: %d)\n", req.Signature != "", len(req.Signature))
	log.Printf("CallData present: %v (length: %d)\n", req.CallData != "", len(req.CallData))

	// Log the entire forward struct for debugging
	log.Println("📦 Forward struct:")
	log.Printf("  From: %s\n", req.Forward.From.Hex())
	log.Printf("  To: %s\n", req.Forward.To.Hex())
	log.Printf("  Value: %s\n", req.Forward.Value.String())
	log.Printf("  Space: %d\n", req.Forward.Space)
	log.Printf("  Nonce: %s\n", req.Forward.Nonce.String())
	log.Printf("  Deadline: %s\n", req.Forward.Deadline.String())
	log.Printf("  DataHash: 0x%s\n", hex.EncodeToString(req.Forward.DataHash[:]))
	log.Printf("  Caller: %s\n", req.Forward.Caller.Hex())

	// Validate required fields
	if req.Signature == "" || req.CallData == "" {
		log.Println("❌ Validation failed: Missing signature or callData")
		s.sendError(w, http.StatusBadRequest, "Missing required fields: forward, signature, callData", "")
		return
	}

	log.Println("✅ Required fields validation passed")

	userAddress := req.Forward.From
	log.Printf("\n📨 Processing mint request from: %s\n", userAddress.Hex())
	log.Printf("🔢 Nonce: %s\n", req.Forward.Nonce.String())
	log.Printf("📦 Space: %d\n", req.Forward.Space)
	deadlineTime := time.Unix(req.Forward.Deadline.Int64(), 0)
	log.Printf("⏰ Deadline: %s (timestamp: %s)\n", deadlineTime.Format(time.RFC3339), req.Forward.Deadline.String())

	// Rate limiting
	log.Println("🔍 Checking rate limit...")
	if !s.checkRateLimit(userAddress.Hex()) {
		log.Printf("❌ Rate limit exceeded for: %s\n", userAddress.Hex())
		s.sendError(w, http.StatusTooManyRequests, "Too many requests. Please try again later.", "")
		return
	}
	log.Println("✅ Rate limit check passed")

	// Check for duplicate requests
	requestID := fmt.Sprintf("%s-%s", userAddress.Hex(), req.Forward.Nonce.String())
	log.Printf("🔍 Checking for duplicate request: %s\n", requestID)
	if s.isProcessed(requestID) {
		log.Printf("❌ Duplicate request detected: %s\n", requestID)
		s.sendError(w, http.StatusBadRequest, "This request has already been processed", "")
		return
	}
	log.Println("✅ Duplicate check passed")

	// Verify target contract
	log.Printf("🔍 Verifying target contract...\n")
	log.Printf("   Expected: %s\n", s.config.NFTContract.Hex())
	log.Printf("   Received: %s\n", req.Forward.To.Hex())
	if !bytes32Equal(req.Forward.To, s.config.NFTContract) {
		log.Printf("❌ Invalid target contract: %s\n", req.Forward.To.Hex())
		s.sendError(w, http.StatusBadRequest, "Invalid target contract", "")
		return
	}
	log.Println("✅ Target contract verification passed")

	// Verify caller
	log.Printf("🔍 Verifying caller address...\n")
	log.Printf("   Expected: %s\n", s.relayerAddress.Hex())
	log.Printf("   Received: %s\n", req.Forward.Caller.Hex())
	if !bytes32Equal(req.Forward.Caller, s.relayerAddress) {
		log.Printf("❌ Caller mismatch. Expected: %s, Got: %s\n", s.relayerAddress.Hex(), req.Forward.Caller.Hex())
		s.sendError(w, http.StatusBadRequest, "Invalid caller address", "")
		return
	}
	log.Println("✅ Caller verification passed")

	// Verify dataHash
	log.Println("🔍 Verifying dataHash...")
	log.Printf("   CallData: %s\n", req.CallData)
	callDataBytes, err := hex.DecodeString(strings.TrimPrefix(req.CallData, "0x"))
	if err != nil {
		log.Printf("❌ Invalid callData format: %v\n", err)
		s.sendError(w, http.StatusBadRequest, "Invalid callData format", err.Error())
		return
	}
	log.Printf("   CallData bytes length: %d\n", len(callDataBytes))

	computedHash := crypto.Keccak256Hash(callDataBytes)
	receivedHash := common.BytesToHash(req.Forward.DataHash[:])
	log.Printf("   Computed hash: %s\n", computedHash.Hex())
	log.Printf("   Received hash: %s\n", receivedHash.Hex())

	if computedHash != receivedHash {
		log.Println("❌ DataHash mismatch!")
		log.Printf("   Computed: %s\n", computedHash.Hex())
		log.Printf("   Received: %s\n", receivedHash.Hex())
		s.sendError(w, http.StatusBadRequest, "DataHash mismatch - signature invalid", "")
		return
	}
	log.Println("✅ DataHash verification passed")

	// Check deadline
	now := time.Now().Unix()
	log.Printf("🔍 Checking deadline...\n")
	log.Printf("   Current time: %d (%s)\n", now, time.Unix(now, 0).Format(time.RFC3339))
	log.Printf("   Deadline: %d (%s)\n", req.Forward.Deadline.Int64(), deadlineTime.Format(time.RFC3339))
	log.Printf("   Time remaining: %d seconds\n", req.Forward.Deadline.Int64()-now)

	if now > req.Forward.Deadline.Int64() {
		log.Println("❌ Transaction deadline expired")
		s.sendError(w, http.StatusBadRequest, "Transaction deadline expired", "")
		return
	}
	log.Println("✅ Deadline check passed")

	// Check if user already minted
	log.Println("🔍 Checking if user already minted...")
	hasMinted, err := s.checkAlreadyMinted(userAddress)
	if err != nil {
		log.Printf("❌ Error checking minted status: %v\n", err)
		s.sendError(w, http.StatusInternalServerError, "Failed to verify minting status", err.Error())
		return
	}

	if hasMinted {
		log.Printf("❌ User already minted: %s\n", userAddress.Hex())
		s.sendError(w, http.StatusBadRequest, "You already minted an NFT", "")
		return
	}
	log.Println("✅ User has not minted yet")

	// Check gas price
	log.Println("🔍 Checking gas price...")
	gasPrice, err := s.client.SuggestGasPrice(context.Background())
	if err != nil {
		log.Printf("⚠️  Error getting gas price: %v\n", err)
	} else {
		gasPriceGwei := new(big.Int).Div(gasPrice, big.NewInt(1e9))
		maxGasPriceGwei := new(big.Int).Div(s.config.MaxGasPrice, big.NewInt(1e9))
		log.Printf("   Current gas price: %s gwei\n", gasPriceGwei.String())
		log.Printf("   Max gas price: %s gwei\n", maxGasPriceGwei.String())

		if gasPrice.Cmp(s.config.MaxGasPrice) > 0 {
			log.Printf("❌ Gas price too high: %s gwei\n", gasPriceGwei.String())
			s.sendError(w, http.StatusServiceUnavailable, "Network gas prices too high. Please try again later.", "")
			return
		}
	}
	log.Println("✅ Gas price check passed")

	log.Println("✅ All validations passed. Executing meta-transaction...")

	// Execute transaction
	txHash, blockNumber, gasUsed, err := s.executeMetaTransaction(req)
	if err != nil {
		log.Printf("❌ Error executing transaction: %v\n", err)
		s.sendError(w, http.StatusInternalServerError, s.parseError(err), err.Error())
		return
	}

	// Mark as processed
	s.markProcessed(requestID)

	log.Printf("✅ Transaction confirmed in block: %d\n", blockNumber)
	log.Printf("⛽ Gas used: %s\n", gasUsed.String())

	// Send success response
	response := RelayResponse{
		Success:         true,
		TxHash:          txHash,
		TransactionHash: txHash,
		BlockNumber:     blockNumber,
		GasUsed:         gasUsed.String(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// executeMetaTransaction executes the meta-transaction through the hub
func (s *Server) executeMetaTransaction(req RelayRequest) (string, uint64, *big.Int, error) {
	log.Println("📝 Preparing transaction data...")

	// Parse Hub ABI
	parsedABI, err := abi.JSON(strings.NewReader(hubABI))
	if err != nil {
		return "", 0, nil, fmt.Errorf("failed to parse Hub ABI: %v", err)
	}

	// Parse signature
	sigBytes, err := hex.DecodeString(strings.TrimPrefix(req.Signature, "0x"))
	if err != nil {
		return "", 0, nil, fmt.Errorf("invalid signature format: %v", err)
	}
	log.Printf("   Signature length: %d bytes\n", len(sigBytes))

	// Parse callData
	callDataBytes, err := hex.DecodeString(strings.TrimPrefix(req.CallData, "0x"))
	if err != nil {
		return "", 0, nil, fmt.Errorf("invalid callData format: %v", err)
	}
	log.Printf("   CallData length: %d bytes\n", len(callDataBytes))

	// Prepare the Forward tuple struct for ABI encoding
	// The order MUST match the Hub contract's Forward struct
	forwardTuple := struct {
		From     common.Address
		To       common.Address
		Value    *big.Int
		Space    uint32
		Nonce    *big.Int
		Deadline *big.Int
		DataHash [32]byte
		Caller   common.Address
	}{
		From:     req.Forward.From,
		To:       req.Forward.To,
		Value:    req.Forward.Value,
		Space:    req.Forward.Space,
		Nonce:    req.Forward.Nonce,
		Deadline: req.Forward.Deadline,
		DataHash: req.Forward.DataHash,
		Caller:   req.Forward.Caller,
	}

	log.Println("📦 Forward tuple prepared:")
	log.Printf("   From: %s\n", forwardTuple.From.Hex())
	log.Printf("   To: %s\n", forwardTuple.To.Hex())
	log.Printf("   Value: %s\n", forwardTuple.Value.String())
	log.Printf("   Space: %d\n", forwardTuple.Space)
	log.Printf("   Nonce: %s\n", forwardTuple.Nonce.String())
	log.Printf("   Deadline: %s\n", forwardTuple.Deadline.String())
	log.Printf("   DataHash: 0x%s\n", hex.EncodeToString(forwardTuple.DataHash[:]))
	log.Printf("   Caller: %s\n", forwardTuple.Caller.Hex())

	// Pack the execute function call
	data, err := parsedABI.Pack("execute", forwardTuple, callDataBytes, sigBytes)
	if err != nil {
		return "", 0, nil, fmt.Errorf("failed to pack execute: %v", err)
	}

	log.Printf("✅ Transaction data packed: %d bytes\n", len(data))
	log.Printf("   Data (first 100 chars): 0x%s...\n", hex.EncodeToString(data[:min(50, len(data))]))

	// Get nonce for relayer
	nonce, err := s.client.PendingNonceAt(context.Background(), s.relayerAddress)
	if err != nil {
		return "", 0, nil, fmt.Errorf("failed to get nonce: %v", err)
	}
	log.Printf("   Relayer nonce: %d\n", nonce)

	// Get gas price
	gasPrice, err := s.client.SuggestGasPrice(context.Background())
	if err != nil {
		return "", 0, nil, fmt.Errorf("failed to get gas price: %v", err)
	}
	log.Printf("   Gas price: %s gwei\n", new(big.Int).Div(gasPrice, big.NewInt(1e9)).String())

	// Estimate gas
	estimatedGas, err := s.client.EstimateGas(context.Background(), ethereum.CallMsg{
		From:     s.relayerAddress,
		To:       &s.config.HubAddress,
		Value:    big.NewInt(0),
		Data:     data,
		GasPrice: gasPrice,
	})
	if err != nil {
		log.Printf("⚠️  Failed to estimate gas: %v\n", err)
		log.Println("   Using default gas limit: 500000")
		estimatedGas = 500000
	} else {
		// Add 20% buffer to estimated gas
		estimatedGas = estimatedGas * 120 / 100
		log.Printf("   Estimated gas (with 20%% buffer): %d\n", estimatedGas)
	}

	// Create transaction
	tx := types.NewTransaction(
		nonce,
		s.config.HubAddress,
		big.NewInt(0),
		estimatedGas,
		gasPrice,
		data,
	)

	log.Println("🔐 Signing transaction...")
	// Sign transaction
	signedTx, err := types.SignTx(tx, types.NewEIP155Signer(s.config.ChainID), s.relayerKey)
	if err != nil {
		return "", 0, nil, fmt.Errorf("failed to sign transaction: %v", err)
	}

	log.Println("📤 Sending transaction to network...")
	// Send transaction
	err = s.client.SendTransaction(context.Background(), signedTx)
	if err != nil {
		return "", 0, nil, fmt.Errorf("failed to send transaction: %v", err)
	}

	log.Printf("📡 Transaction sent: %s\n", signedTx.Hash().Hex())
	log.Println("⏳ Waiting for confirmation...")

	// Wait for receipt
	receipt, err := s.waitForReceipt(signedTx.Hash())
	if err != nil {
		return "", 0, nil, fmt.Errorf("failed to get receipt: %v", err)
	}

	// Check if transaction was successful
	if receipt.Status == 0 {
		log.Printf("❌ Transaction reverted! Receipt status: %d\n", receipt.Status)
		return "", 0, nil, fmt.Errorf("transaction reverted by contract")
	}

	log.Printf("✅ Transaction successful! Status: %d\n", receipt.Status)

	return signedTx.Hash().Hex(), receipt.BlockNumber.Uint64(), new(big.Int).SetUint64(receipt.GasUsed), nil
}

// min returns the minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// checkAlreadyMinted checks if user has already minted
func (s *Server) checkAlreadyMinted(address common.Address) (bool, error) {
	log.Printf("🔍 Checking minted status for: %s\n", address.Hex())

	parsedABI, err := abi.JSON(strings.NewReader(nftABI))
	if err != nil {
		log.Printf("❌ Error parsing ABI: %v\n", err)
		return false, err
	}

	data, err := parsedABI.Pack("minted", address)
	if err != nil {
		log.Printf("❌ Error packing ABI data: %v\n", err)
		return false, err
	}

	log.Printf("   Calling NFT contract at: %s\n", s.config.NFTContract.Hex())
	log.Printf("   Call data: 0x%s\n", hex.EncodeToString(data))

	msg := ethereum.CallMsg{
		To:   &s.config.NFTContract,
		Data: data,
	}

	result, err := s.client.CallContract(context.Background(), msg, nil)
	if err != nil {
		log.Printf("❌ Error calling contract: %v\n", err)
		return false, err
	}

	log.Printf("   Contract response: 0x%s\n", hex.EncodeToString(result))

	var minted bool
	err = parsedABI.UnpackIntoInterface(&minted, "minted", result)
	if err != nil {
		log.Printf("❌ Error unpacking result: %v\n", err)
		return false, err
	}

	log.Printf("   Minted status: %v\n", minted)
	return minted, nil
}

// waitForReceipt waits for transaction receipt
func (s *Server) waitForReceipt(txHash common.Hash) (*types.Receipt, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	for {
		receipt, err := s.client.TransactionReceipt(ctx, txHash)
		if err == nil {
			return receipt, nil
		}

		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("timeout waiting for transaction receipt")
		case <-time.After(2 * time.Second):
			// Continue polling
		}
	}
}

// Rate limiting methods
func (s *Server) checkRateLimit(address string) bool {
	s.rateLimit.mu.Lock()
	defer s.rateLimit.mu.Unlock()

	now := time.Now().Unix()
	requests := s.rateLimit.requests[address]

	// Filter recent requests
	var recentRequests []int64
	for _, reqTime := range requests {
		if now-reqTime < int64(rateLimitWindow.Seconds()) {
			recentRequests = append(recentRequests, reqTime)
		}
	}

	if len(recentRequests) >= maxRequestsPerWindow {
		return false
	}

	recentRequests = append(recentRequests, now)
	s.rateLimit.requests[address] = recentRequests

	return true
}

// Processed requests tracking
func (s *Server) isProcessed(requestID string) bool {
	s.reqMutex.RLock()
	defer s.reqMutex.RUnlock()

	_, exists := s.processedRequests[requestID]
	return exists
}

func (s *Server) markProcessed(requestID string) {
	s.reqMutex.Lock()
	defer s.reqMutex.Unlock()

	s.processedRequests[requestID] = time.Now()
}

// cleanupRoutine periodically cleans up old entries
func (s *Server) cleanupRoutine() {
	ticker := time.NewTicker(cleanupInterval)
	defer ticker.Stop()

	for range ticker.C {
		now := time.Now()

		// Clean processed requests
		s.reqMutex.Lock()
		for id, timestamp := range s.processedRequests {
			if now.Sub(timestamp) > cacheDuration {
				delete(s.processedRequests, id)
			}
		}
		s.reqMutex.Unlock()

		// Clean rate limits
		s.rateLimit.mu.Lock()
		cutoff := now.Add(-rateLimitWindow).Unix()
		for addr, times := range s.rateLimit.requests {
			var recent []int64
			for _, t := range times {
				if t > cutoff {
					recent = append(recent, t)
				}
			}
			if len(recent) == 0 {
				delete(s.rateLimit.requests, addr)
			} else {
				s.rateLimit.requests[addr] = recent
			}
		}
		s.rateLimit.mu.Unlock()
	}
}

// Helper methods
func (s *Server) sendError(w http.ResponseWriter, status int, message, details string) {
	log.Printf("\n❌ ERROR RESPONSE [%d]: %s\n", status, message)
	if details != "" {
		log.Printf("   Details: %s\n", details)
	}

	response := RelayResponse{
		Success: false,
		Error:   message,
		Details: details,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(response)
}

func (s *Server) parseError(err error) string {
	errMsg := err.Error()
	if strings.Contains(errMsg, "Already minted") {
		return "This address has already minted an NFT"
	} else if strings.Contains(errMsg, "insufficient funds") {
		return "Relayer has insufficient funds"
	} else if strings.Contains(errMsg, "nonce") {
		return "Invalid nonce or nonce already used"
	} else if strings.Contains(errMsg, "signature") {
		return "Invalid signature"
	} else if strings.Contains(errMsg, "deadline") {
		return "Transaction deadline expired"
	} else if strings.Contains(errMsg, "dataHash") {
		return "Invalid data hash"
	} else if strings.Contains(errMsg, "caller") {
		return "Invalid caller address"
	}
	return "Transaction failed"
}

func bytes32Equal(a, b common.Address) bool {
	return strings.EqualFold(a.Hex(), b.Hex())
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
