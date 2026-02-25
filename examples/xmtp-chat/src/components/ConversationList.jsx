import React from 'react';

function ConversationList({
  conversations,
  selectedConversation,
  onSelectConversation,
  onNewConversation,
  isLoading,
  onRefresh
}) {
  // State to store peer inbox IDs for DMs
  const [peerInboxIds, setPeerInboxIds] = React.useState({});

  // Load peer inbox IDs for DM conversations
  React.useEffect(() => {
    const loadPeerInboxIds = async () => {
      const newIds = {};
      for (const conversation of conversations) {
        // Check if it's a DM by checking if peerInboxId exists as a function
        if (conversation.peerInboxId && typeof conversation.peerInboxId === 'function') {
          try {
            const peerId = await conversation.peerInboxId();
            newIds[conversation.id] = peerId;
          } catch (error) {
            console.error("Error getting peer inbox ID:", error);
          }
        }
      }
      setPeerInboxIds(newIds);
    };

    if (conversations.length > 0) {
      loadPeerInboxIds();
    }
  }, [conversations]);

  // Helper to get peer address from conversation
  const getPeerAddress = (conversation) => {
    // Check if we have a loaded peer inbox ID
    if (peerInboxIds[conversation.id]) {
      return String(peerInboxIds[conversation.id]).slice(0, 8) + "...";
    }
    if (conversation.name) {
      // This is a group - show the group name
      return String(conversation.name);
    }
    // Fallback to conversation ID
    return conversation.id ? String(conversation.id).slice(0, 8) + "..." : "Unknown";
  };

  return (
    <div className="conversation-list">
      <div className="conversation-list-header">
        <h2>Messages</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {onRefresh && (
            <button
              className="refresh-btn"
              onClick={onRefresh}
              disabled={isLoading}
              title="Sync conversations"
            >
              ↻
            </button>
          )}
          <button className="new-message-btn" onClick={onNewConversation}>+</button>
        </div>
      </div>

      <div className="conversation-items">
        {isLoading ? (
          <div className="empty-state">
            <p>Loading conversations...</p>
          </div>
        ) : conversations.length === 0 ? (
          <div className="empty-state">
            <p>No conversations yet</p>
            <p className="empty-hint">Click + to start a new conversation</p>
          </div>
        ) : (
          conversations.map((conversation) => {
            const peerAddress = getPeerAddress(conversation);
            const isGroup = conversation.metadata?.conversationType === 'group';
            // Get avatar initials safely
            const avatarText = peerAddress && peerAddress.length >= 2
              ? peerAddress.slice(0, 2).toUpperCase()
              : "??";

            return (
              <div
                key={conversation.id}
                className={`conversation-item ${
                  selectedConversation?.id === conversation.id ? 'active' : ''
                }`}
                onClick={() => onSelectConversation(conversation)}
              >
                <div className="conversation-avatar">
                  {avatarText}
                </div>
                <div className="conversation-details">
                  <div className="conversation-header">
                    <span className="conversation-address">
                      {isGroup ? `Group: ${peerAddress}` : peerAddress}
                    </span>
                    <span className="conversation-time">
                      {new Date(Number(conversation.createdAtNs) / 1_000_000).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="conversation-preview">
                    {conversation.lastMessage?.content || "No messages yet"}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default ConversationList;
