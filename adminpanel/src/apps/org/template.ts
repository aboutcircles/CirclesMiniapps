export const HTML = `    <div class="app-shell">
        <div class="card">
            <div class="title-row">
                <h1>Circles Builder Org Manager</h1>
                <span class="badge badge-disconnected" id="badge">Not connected</span>
            </div>

            <!-- ── Login Section ─────────────────────────────────────── -->
            <div id="login-section" class="section">
                <div class="empty-state">
                    <div class="empty-state-icon">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)"
                            stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                    </div>
                    <p class="empty-state-title">Connect your wallet</p>
                    <p class="empty-state-desc">Log in with your wallet in the Circles app to create and manage
                        dedicated organization accounts. Each account can have its own profile and setup for a
                        different application, such as app-specific logic or a shop.</p>
                </div>
                <button id="login-explore-btn" class="btn-secondary">Explore Organizations</button>
            </div>

            <!-- ── Options Section ───────────────────────────────────── -->
            <div id="options-section" class="section hidden">
                <p class="section-desc">
                    This app lets you create and manage Circles Organization avatars with your own Circles account for
                    various different applications. It can also be used by shop owners to setup their own payment
                    flows and accept CRC tokens.
                </p>
                <div class="subsection">
                    <h2>Your Organizations</h2>
                    <div id="options-org-list">
                        <div class="shimmer-block"></div>
                    </div>
                </div>
                <button id="start-create-org-btn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                        stroke-linecap="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Create Organization
                </button>
                <button id="options-explore-btn" class="btn-secondary">Explore Organizations</button>
            </div>

            <!-- ── Explorer Section ──────────────────────────────────── -->
            <div id="explorer-section" class="section hidden">
                <h2>Explore Organizations</h2>
                <p class="section-desc">
                    Paste any organization address to inspect its incoming and outgoing Circles activity.
                </p>
                <div class="field">
                    <div class="input-row">
                        <input type="text" id="explorer-address" placeholder="0x… organization address"
                            autocomplete="off" />
                        <button id="explorer-load-btn">Explore</button>
                    </div>
                </div>

                <div id="explorer-org-header" class="info-box org-header-box hidden">
                    <div class="org-header-top">
                        <div id="explorer-org-avatar-wrap" class="org-dashboard-avatar-wrap hidden">
                            <img id="explorer-org-avatar" class="org-dashboard-avatar" alt="" />
                        </div>
                        <div class="org-header-details">
                            <div id="explorer-org-name" class="org-header-name">—</div>
                            <a id="explorer-org-address" class="mono org-link" href="#" target="_blank"
                                rel="noopener">—</a>
                        </div>
                        <span id="explorer-org-type" class="badge badge-success hidden">Organization</span>
                    </div>
                    <p id="explorer-org-description" class="org-header-description hidden"></p>
                </div>

                <div id="explorer-activity" class="subsection hidden">
                    <h2>Activity</h2>
                    <div id="explorer-activity-list"></div>
                    <button id="explorer-load-more-btn" class="btn-secondary hidden">Load more</button>
                </div>

                <button id="explorer-back-btn" class="btn-secondary">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                        stroke-linecap="round">
                        <line x1="19" y1="12" x2="5" y2="12" />
                        <polyline points="12 19 5 12 12 5" />
                    </svg>
                    Back
                </button>
            </div>

            <!-- ── Register Section ──────────────────────────────────── -->
            <div id="register-section" class="section hidden">
                <h2 id="org-form-title">Create Organization</h2>
                <p id="org-form-description" class="section-desc">
                    Deploy a dedicated Safe for your organization and register it on the Circles Hub.
                </p>

                <div class="field">
                    <label for="org-name">Organization Name</label>
                    <input type="text" id="org-name" placeholder="e.g. My Coffee Shop" autocomplete="off" />
                </div>

                <div class="field">
                    <label for="org-description">Description <span class="optional">(optional)</span></label>
                    <textarea id="org-description" rows="3"
                        placeholder="Briefly describe what your org does…"></textarea>
                </div>

                <div class="field">
                    <label for="org-image">Organization Image <span class="optional">(optional)</span></label>
                    <div id="org-image-dropzone" class="image-dropzone">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--muted)"
                            stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <polyline points="21 15 16 10 5 21" />
                        </svg>
                        <span class="dropzone-label">Click to choose or drag an image</span>
                        <span class="dropzone-hint">PNG, JPG, GIF, or WEBP (max 8 MB)</span>
                    </div>
                    <input type="file" id="org-image" accept="image/*" class="sr-only" />
                    <div id="org-image-preview-wrap" class="org-image-preview-wrap hidden">
                        <img id="org-image-preview" class="org-image-preview" alt="Organization image preview" />
                        <div class="preview-meta">
                            <span class="preview-label">Image ready</span>
                            <button id="clear-org-image-btn" type="button" class="btn-sm btn-secondary">Remove</button>
                        </div>
                    </div>
                </div>

                <button id="register-btn" disabled>Create Organization</button>
                <button id="cancel-register-btn" class="btn-secondary">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                        stroke-linecap="round">
                        <line x1="19" y1="12" x2="5" y2="12" />
                        <polyline points="12 19 5 12 12 5" />
                    </svg>
                    Back
                </button>
            </div>

            <!-- ── Organization Dashboard ────────────────────────────── -->
            <div id="dashboard-section" class="section hidden">

                <!-- Org Info -->
                <div class="info-box org-header-box">
                    <div class="org-header-top">
                        <div id="org-dashboard-avatar-wrap" class="org-dashboard-avatar-wrap hidden">
                            <img id="org-dashboard-avatar" class="org-dashboard-avatar" alt="" />
                        </div>
                        <div class="org-header-details">
                            <div id="org-name-display" class="org-header-name">—</div>
                            <span id="org-address-display" class="mono">—</span>
                        </div>
                        <button id="edit-org-btn" type="button" class="btn-sm btn-secondary">Edit details</button>
                    </div>
                    <p id="org-description-display" class="org-header-description hidden"></p>
                    <div class="info-row">
                        <span class="info-label">Balance</span>
                        <span id="org-balance-display" class="info-value balance-value">0 CRC</span>
                    </div>
                </div>
                <button id="view-org-activity-btn" class="btn-secondary">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                        stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                    </svg>
                    View Activity
                </button>
                <button id="back-to-options-btn" class="btn-secondary">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                        stroke-linecap="round">
                        <line x1="19" y1="12" x2="5" y2="12" />
                        <polyline points="12 19 5 12 12 5" />
                    </svg>
                    Switch Organization
                </button>

                <!-- Step 1 -->
                <div class="subsection step-section">
                    <div class="step-header">
                        <span class="step-number">1</span>
                        <div>
                            <h2>Accepted CRC Tokens</h2>
                            <p class="step-desc">Choose which CRC tokens users can pay with in your app</p>
                        </div>
                    </div>
                    <div class="field">
                        <div class="input-row">
                            <input type="text" id="trust-address" placeholder="Search name/group or paste 0x…"
                                autocomplete="off" />
                            <button id="add-trust-btn">Allow CRC</button>
                        </div>
                    </div>
                    <div id="trust-search-results"></div>
                    <div id="trust-list">
                        <p class="muted">Connect a wallet to view trust relations.</p>
                    </div>
                </div>

                <!-- Step 2 -->
                <div class="subsection step-section">
                    <div class="step-header">
                        <span class="step-number">2</span>
                        <div>
                            <h2>External Signers</h2>
                            <p class="step-desc">Add an EOA to use in your backend for automatic payouts</p>
                        </div>
                    </div>
                    <div class="field">
                        <div class="input-row">
                            <input type="text" id="safe-signer-address" placeholder="0x…" autocomplete="off" />
                            <button id="add-safe-signer-btn">Add signer</button>
                        </div>
                    </div>
                    <div id="safe-signers-list">
                        <p class="muted">Connect a wallet to load signers.</p>
                    </div>
                </div>

                <!-- Step 3 -->
                <div class="subsection step-section">
                    <div class="step-header">
                        <span class="step-number">3</span>
                        <div>
                            <h2>Fund Signers</h2>
                            <p class="step-desc">Send gas (xDAI) to your EOA signers via the faucet</p>
                        </div>
                    </div>
                    <p id="fund-faucet-hint" class="muted">Add at least one EOA signer to enable funding.</p>
                    <div class="field">
                        <label for="fund-amount-xdai">Amount (CRC)</label>
                        <input type="text" id="fund-amount-xdai" placeholder="0.0" autocomplete="off" />
                    </div>
                    <div id="fund-recipient-list">
                        <p class="muted">Add an EOA signer first.</p>
                    </div>
                </div>

                <!-- Step 4 -->
                <div class="subsection step-section">
                    <div class="step-header">
                        <span class="step-number">4</span>
                        <div>
                            <h2>Withdraw CRC</h2>
                            <p class="step-desc">Withdraw the org CRC balance to your connected wallet or another
                                address
                            </p>
                        </div>
                    </div>
                    <div class="field">
                        <label for="withdraw-recipient-address">Withdraw To</label>
                        <input type="text" id="withdraw-recipient-address"
                            placeholder="Defaults to your connected wallet" autocomplete="off" />
                    </div>
                    <div class="field">
                        <label for="withdraw-amount">Amount (CRC)</label>
                        <div class="input-row amount-input-row">
                            <input type="text" id="withdraw-amount" placeholder="0.0" autocomplete="off" />
                            <button id="withdraw-max-btn" type="button" class="btn-secondary btn-icon"
                                title="Use full available amount" aria-label="Use full available amount">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                    stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <ellipse cx="12" cy="6.5" rx="6.5" ry="2.5" />
                                    <path d="M5.5 6.5v5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-5" />
                                    <path d="M5.5 11.5v5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-5" />
                                </svg>
                            </button>
                        </div>
                        <p class="field-hint">Enter a withdrawal amount, or use the icon to fill the full available
                            balance.</p>
                    </div>
                    <p id="withdraw-available" class="balance-tag">Available CRC balance: 0 CRC</p>
                    <div id="withdraw-holdings-list">
                        <p class="muted">Connect a wallet to prepare a full CRC withdrawal.</p>
                    </div>
                    <button id="withdraw-all-btn" disabled>Withdraw CRC</button>
                </div>
            </div>

            <!-- ── Result Messages ───────────────────────────────────── -->
            <div id="result" class="result hidden"></div>
        </div>

    </div>
`;
