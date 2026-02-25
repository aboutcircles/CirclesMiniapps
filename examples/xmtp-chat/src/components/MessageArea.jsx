import React, { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import { ContentTypeText } from "@xmtp/content-type-text";

function MessageArea({ conversation, xmtpClient }) {
  const { address } = useAccount();
  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [peerInboxId, setPeerInboxId] = useState(null);

  // Load peer inbox ID for DM
  useEffect(() => {
    const loadPeerInboxId = async () => {
      if (conversation && typeof conversation.peerInboxId === "function") {
        try {
          const peerId = await conversation.peerInboxId();
          setPeerInboxId(peerId);
        } catch (error) {
          console.error("Error getting peer inbox ID:", error);
        }
      }
    };

    if (conversation) {
      loadPeerInboxId();
    } else {
      setPeerInboxId(null);
    }
  }, [conversation]);

  // Fetch messages when conversation changes
  useEffect(() => {
    if (!conversation || !xmtpClient) {
      setMessages([]);
      return;
    }

    const loadMessages = async () => {
      setIsLoadingMessages(true);
      try {
        // Sync messages for this conversation
        await conversation.sync();

        // Get messages
        const msgs = await conversation.messages();
        console.log("Loaded messages:", msgs);

        // Filter out metadata/system messages - only show actual content messages
        const textMessages = msgs.filter((msg) => {
          // Check if it's a text message (not a group metadata update)
          const isTextMessage =
            typeof msg.content === "string" ||
            msg.content instanceof Uint8Array ||
            (msg.content &&
              !msg.content.addedInboxes &&
              (msg.content.content || msg.content.contentType));
          return isTextMessage;
        });

        console.log("Filtered text messages:", textMessages);
        setMessages(textMessages);
      } catch (error) {
        console.error("Error loading messages:", error);
      } finally {
        setIsLoadingMessages(false);
      }
    };

    loadMessages();

    // Stream new messages for this conversation
    const startStream = async () => {
      try {
        const stream = await xmtpClient.conversation.streamAllMessages({
          onValue: (message) => {
            console.log("New message:", message);

            // Filter out metadata/system messages
            const isTextMessage =
              typeof message.content === "string" ||
              message.content instanceof Uint8Array ||
              (message.content &&
                !message.content.addedInboxes &&
                (message.content.content || message.content.contentType));

            if (isTextMessage) {
              setMessages((prev) => {
                const exists = prev.some((m) => m.id === message.id);
                if (exists) return prev;
                return [...prev, message];
              });
            }
          },
        });

        return () => {
          stream.end();
        };
      } catch (error) {
        console.error("Error streaming messages:", error);
      }
    };

    const cleanup = startStream();

    return () => {
      cleanup.then((fn) => fn && fn());
    };
  }, [conversation, xmtpClient]);

  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || !conversation || isSending) return;

    setIsSending(true);
    try {
      // Send text message using ContentTypeText codec
      await conversation.sendText(inputValue);
      setInputValue("");
    } catch (error) {
      console.error("Error sending message:", error);
      alert(`Failed to send message: ${error.message}`);
    } finally {
      setIsSending(false);
    }
  }, [inputValue, conversation, isSending]);

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!conversation) {
    return (
      <div className="message-area">
        <div className="no-conversation">
          <div className="no-conversation-content">
            <h2>Select a conversation</h2>
            <p>Choose a conversation from the list to start messaging</p>
          </div>
        </div>
      </div>
    );
  }

  // Use the loaded peerInboxId or conversation name
  const peerAddress = peerInboxId
    ? String(peerInboxId).slice(0, 12) + "..."
    : conversation.name
      ? String(conversation.name)
      : conversation.id
        ? String(conversation.id).slice(0, 8) + "..."
        : "Unknown";

  // Get avatar initials safely
  const avatarText =
    peerAddress && peerAddress.length >= 2
      ? peerAddress.slice(0, 2).toUpperCase()
      : "??";

  return (
    <div className="message-area">
      <div className="message-area-header">
        <div className="conversation-avatar-small">{avatarText}</div>
        <div className="header-info">
          <span className="header-address">{peerAddress}</span>
        </div>
      </div>

      <div className="messages-container">
        {isLoadingMessages ? (
          <div className="no-messages">
            <p>Loading messages...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="no-messages">
            <p>No messages yet</p>
            <p className="no-messages-hint">
              Send a message to start the conversation
            </p>
          </div>
        ) : (
          messages.map((message) => {
            const isSent = message.senderInboxId === xmtpClient?.inboxId;
            const timestamp = new Date(Number(message.sentAtNs) / 1_000_000);

            // Decode message content
            let messageText = "";
            if (typeof message.content === "string") {
              messageText = message.content;
            } else if (message.content instanceof Uint8Array) {
              messageText = new TextDecoder().decode(message.content);
            } else if (message.content?.content) {
              // If content is an object with a content property
              if (message.content.content instanceof Uint8Array) {
                messageText = new TextDecoder().decode(message.content.content);
              } else {
                messageText = String(message.content.content);
              }
            } else {
              messageText = JSON.stringify(message.content);
            }

            return (
              <div
                key={message.id}
                className={`message ${isSent ? "sent" : "received"}`}>
                <div className="message-content">
                  <div className="message-text">{messageText}</div>
                  <div className="message-timestamp">
                    {timestamp.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="message-input-container">
        <textarea
          className="message-input"
          placeholder="Type a message..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={handleKeyPress}
          rows="1"
          disabled={isSending}
        />
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={!inputValue.trim() || isSending}>
          {isSending ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}

export default MessageArea;
