import React, { useState, useEffect, useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { Client, IdentifierKind } from "@xmtp/browser-sdk";
import ConversationList from "./components/ConversationList";
import MessageArea from "./components/MessageArea";
import BottomTabs from "./components/BottomTabs";
import AccountPage from "./components/AccountPage";
import NewConversationModal from "./components/NewConversationModal";
import { createEOASigner } from "./helpers/createSigner";

function App() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [activeTab, setActiveTab] = useState("chat");
  const [isNewConversationModalOpen, setIsNewConversationModalOpen] =
    useState(false);
  const [xmtpClient, setXmtpClient] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [conversationStream, setConversationStream] = useState(null);

  // Load XMTP client on mount
  useEffect(() => {
    const loadClient = async () => {
      if (isConnected && address) {
        try {
          const storedInboxId = localStorage.getItem(
            `xmtp-inbox-${address.toLowerCase()}`,
          );
          if (storedInboxId) {
            // Create client from stored inbox
            const signer = createEOASigner(address, (message) =>
              signMessageAsync({ message }),
            );
            const client = await Client.create(signer, {
              env: "dev",
              appVersion: "xmtp-miniapp/0",
            });
            setXmtpClient(client);
          }
        } catch (error) {
          console.error("Error loading XMTP client:", error);
        }
      } else {
        setXmtpClient(null);
        setConversations([]);
      }
    };
    loadClient();
  }, [isConnected, address, signMessageAsync]);

  // Sync conversations when client is available
  const syncConversations = useCallback(async () => {
    if (!xmtpClient) return;

    setIsLoadingConversations(true);
    try {
      // Sync from network
      await xmtpClient.conversations.sync();

      // Get list of conversations
      const convos = await xmtpClient.conversations.list();
      console.log("Synced conversations:", convos);
      setConversations(convos);
    } catch (error) {
      console.error("Error syncing conversations:", error);
    } finally {
      setIsLoadingConversations(false);
    }
  }, [xmtpClient]);

  // Sync conversations on client load
  useEffect(() => {
    if (xmtpClient) {
      syncConversations();
    }
  }, [xmtpClient, syncConversations]);

  // Stream new conversations
  useEffect(() => {
    if (!xmtpClient) return;

    const startStream = async () => {
      try {
        const stream = await xmtpClient.conversations.stream({
          onValue: (conversation) => {
            console.log("New conversation:", conversation);
            setConversations((prev) => {
              // Check if conversation already exists
              const exists = prev.some((c) => c.id === conversation.id);
              if (exists) return prev;
              return [conversation, ...prev];
            });
          },
        });
        setConversationStream(stream);
      } catch (error) {
        console.error("Error starting conversation stream:", error);
      }
    };

    startStream();

    return () => {
      if (conversationStream) {
        conversationStream.end();
      }
    };
  }, [xmtpClient]);

  const handleSelectConversation = (conversation) => {
    setSelectedConversation(conversation);
  };

  const handleCreateConversation = async (recipientAddress) => {
    if (!xmtpClient) {
      console.error("XMTP client not available");
      return;
    }

    try {
      // Check if the recipient address is valid (basic validation)
      if (!recipientAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        console.error("Invalid Ethereum address");
        alert("Please enter a valid Ethereum address");
        return;
      }

      console.log("Creating DM with:", recipientAddress);

      // Check if the address is registered on XMTP by fetching inbox ID
      // Note: fetchInboxIdByIdentifier might not exist in all SDK versions
      // If it fails, we'll catch the error and handle it
      let inboxId;
      try {
        inboxId = await xmtpClient.fetchInboxIdByIdentifier({
          identifier: recipientAddress,
          identifierKind: IdentifierKind.Ethereum,
        });
        console.log("Inbox ID result:", inboxId);
      } catch (fetchError) {
        console.log(
          "fetchInboxIdByIdentifier not available, trying alternate method",
        );
        // Fallback: try canMessage to validate, then use address directly
        const canMessageResult = await xmtpClient.canMessage([
          recipientAddress,
        ]);
        if (!canMessageResult || !canMessageResult[recipientAddress]) {
          alert("This address is not registered on the XMTP network");
          return;
        }
        // Use address as inbox ID (SDK might handle conversion internally)
        inboxId = recipientAddress;
      }

      if (!inboxId) {
        console.error("Recipient not registered on XMTP");
        alert("This address is not registered on the XMTP network");
        return;
      }

      // According to MESSAGE_GUIDE.md, use createDm() with inbox ID
      // This will create the DM if it doesn't exist, or return the existing one
      console.log("Creating/getting DM with inbox ID:", inboxId);
      const dm = await xmtpClient.conversations.createDm(inboxId);
      console.log("DM created/retrieved:", dm);

      // Sync to ensure conversation is in local DB
      await xmtpClient.conversations.sync();

      // Add to conversations list if not already there
      setConversations((prev) => {
        const exists = prev.some((c) => c.id === dm.id);
        if (exists) return prev;
        return [dm, ...prev];
      });

      // Select the new conversation
      setSelectedConversation(dm);

      console.log("Conversation selected:", dm);
    } catch (error) {
      console.error("Error creating conversation:", error);
      alert(`Failed to create conversation: ${error.message}`);
    }
  };

  // Format address for display
  const formatAddress = (addr) => {
    if (!addr) return "";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className="header-left">
            <h1>XMTP Chat</h1>
            {isConnected && address && (
              <div className="connected-address">
                <span className="address-value">{formatAddress(address)}</span>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="app-content">
        {activeTab === "chat" ? (
          !isConnected ? (
            <div className="connect-prompt">
              <div className="connect-card">
                <h2>Welcome to XMTP Chat</h2>
                <p>Connect your wallet to start messaging</p>
                <p className="connect-hint">
                  Go to Account tab to connect your wallet
                </p>
              </div>
            </div>
          ) : !xmtpClient ? (
            <div className="connect-prompt">
              <div className="connect-card">
                <h2>Connect to XMTP</h2>
                <p>Create your XMTP inbox to start messaging</p>
                <p className="connect-hint">
                  Go to Account tab to connect to XMTP
                </p>
              </div>
            </div>
          ) : (
            <div className="chat-container">
              <ConversationList
                conversations={conversations}
                selectedConversation={selectedConversation}
                onSelectConversation={handleSelectConversation}
                onNewConversation={() => setIsNewConversationModalOpen(true)}
                isLoading={isLoadingConversations}
                onRefresh={syncConversations}
              />
              <MessageArea
                conversation={selectedConversation}
                xmtpClient={xmtpClient}
              />
            </div>
          )
        ) : (
          <AccountPage />
        )}
      </div>

      <BottomTabs activeTab={activeTab} onTabChange={setActiveTab} />

      <NewConversationModal
        isOpen={isNewConversationModalOpen}
        onClose={() => setIsNewConversationModalOpen(false)}
        onCreateConversation={handleCreateConversation}
      />
    </div>
  );
}

export default App;
