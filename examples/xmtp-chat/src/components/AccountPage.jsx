import React, { useState, useEffect } from "react";
import { useAccount, useConnect, useDisconnect, useSignMessage } from "wagmi";
import { Client, LogLevel } from "@xmtp/browser-sdk";
import { createEOASigner } from "../helpers/createSigner";

function AccountPage() {
  const { address, isConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [showConnectors, setShowConnectors] = useState(false);
  const [activeTab, setActiveTab] = useState("connect");
  const [xmtpClient, setXmtpClient] = useState(null);
  const [isCreatingInbox, setIsCreatingInbox] = useState(false);
  const [inboxError, setInboxError] = useState(null);

  // Format address for display
  const formatAddress = (addr) => {
    if (!addr) return "";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  // Filter connectors to only show MetaMask and WalletConnect
  const availableConnectors = connectors.filter(
    (connector) =>
      connector.name === "MetaMask" || connector.name === "WalletConnect",
  );

  // Load XMTP client from localStorage on mount
  useEffect(() => {
    const loadClient = async () => {
      if (isConnected && address) {
        try {
          // Check if client exists in localStorage
          const storedInboxId = localStorage.getItem(
            `xmtp-inbox-${address.toLowerCase()}`,
          );
          if (storedInboxId) {
            // Client was previously created, we can show it as connected
            setXmtpClient({ inboxId: storedInboxId });
          }
        } catch (error) {
          console.error("Error loading XMTP client:", error);
        }
      } else {
        setXmtpClient(null);
      }
    };
    loadClient();
  }, [isConnected, address]);

  // Create XMTP inbox
  const handleCreateInbox = async () => {
    console.log("handleCreateInbox called", { address, isConnected });

    if (!address || !isConnected) {
      console.log("Missing address or not connected");
      return;
    }

    setIsCreatingInbox(true);
    setInboxError(null);

    try {
      console.log("Creating signer...");
      // Create signer
      const signer = createEOASigner(address, (message) => {
        console.log("Sign message requested:", message);
        return signMessageAsync({ message });
      });

      console.log("Signer created, calling Client.create...");
      console.log("Signer object:", signer);
      console.log(
        "Testing signer.getIdentifier():",
        await signer.getIdentifier(),
      );

      // Add timeout to detect hanging
      const createClientWithTimeout = Promise.race([
        (async () => {
          console.log("Starting Client.create with options:", {
            env: "dev",
            appVersion: "xmtp-miniapp/0",
          });
          const client = await Client.create(signer, {
            env: "dev", // Use dev environment
            dbEncryptionKey: undefined,
            appVersion: "xmtp-miniapp/0",
            loggingLevel: LogLevel.Debug, // Enable debug logging
          });
          console.log("Client.create completed");
          return client;
        })(),
        new Promise((_, reject) =>
          setTimeout(() => {
            console.error("Client.create timed out!");
            reject(new Error("Client creation timed out after 60 seconds"));
          }, 60000),
        ),
      ]);

      const client = await createClientWithTimeout;

      console.log("Client created:", client);

      // Store inbox ID in localStorage
      localStorage.setItem(
        `xmtp-inbox-${address.toLowerCase()}`,
        client.inboxId,
      );

      setXmtpClient(client);
      console.log("Inbox created successfully");
    } catch (error) {
      console.error("Error creating XMTP inbox:", error);
      console.error("Error stack:", error.stack);
      setInboxError(error.message || "Failed to create inbox");
    } finally {
      setIsCreatingInbox(false);
    }
  };

  // Handle disconnect
  const handleDisconnect = () => {
    disconnect();
    setXmtpClient(null);
  };

  return (
    <div className="account-page">
      <div className="account-tabs">
        <button
          className={`account-tab ${activeTab === "connect" ? "active" : ""}`}
          onClick={() => setActiveTab("connect")}>
          Connect
        </button>
      </div>

      <div className="account-content">
        {activeTab === "connect" && (
          <div className="connect-section">
            {!isConnected ? (
              <div className="connect-container">
                <h2>Connect Wallet</h2>
                <p>Choose a wallet to connect to XMTP Chat</p>

                <div className="connector-list">
                  {availableConnectors.map((connector) => (
                    <button
                      key={connector.id}
                      onClick={() => connect({ connector })}
                      className="connector-button">
                      <span className="connector-name">{connector.name}</span>
                      <span className="connector-arrow">→</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="connected-container">
                <h2>Wallet & XMTP Inbox</h2>
                <div className="connected-info">
                  <div className="connected-address-box">
                    <span className="connected-label">Wallet Address</span>
                    <span className="connected-address-full">{address}</span>
                    <span className="connected-address-short">
                      {formatAddress(address)}
                    </span>
                  </div>

                  {xmtpClient ? (
                    <div className="inbox-status-box">
                      <span className="inbox-status-label">XMTP Inbox</span>
                      <span className="inbox-status-connected">
                        ✓ Connected
                      </span>
                      <span className="inbox-id">{xmtpClient.inboxId}</span>
                    </div>
                  ) : (
                    <div className="inbox-create-box">
                      <span className="inbox-label">XMTP Inbox</span>
                      <p className="inbox-description">
                        Create your XMTP inbox to start sending and receiving
                        messages. You'll be asked to sign a message to verify
                        your wallet.
                      </p>
                      <button
                        className="create-inbox-button"
                        onClick={handleCreateInbox}
                        disabled={isCreatingInbox}>
                        {isCreatingInbox
                          ? "Connecting to XMTP..."
                          : "Connect to XMTP"}
                      </button>
                      {inboxError && (
                        <div className="inbox-error">{inboxError}</div>
                      )}
                    </div>
                  )}

                  <button
                    className="disconnect-button"
                    onClick={handleDisconnect}>
                    Disconnect
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default AccountPage;
