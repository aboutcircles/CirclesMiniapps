export const HTML = `
    <div class="app-shell">
        <div class="frame">
            <div class="hero">
                <h1>Circles Groups Manager</h1>
                <span class="badge badge-disconnected" id="badge">Not connected</span>
            </div>

            <nav id="breadcrumb" class="breadcrumb hidden"></nav>

            <div id="result" class="result hidden"></div>

            <div id="login-section" class="section">
                <div class="panel panel-soft">
                    <h2>Connect Wallet</h2>
                    <p class="muted">Open this miniapp in Circles and connect your wallet.</p>
                </div>
            </div>

            <div id="groups-section" class="section hidden">
                <div class="panel">
                    <div class="panel-head groups-panel-head">
                        <button id="start-create-group-btn" class="btn-inline">+ Create</button>
                    </div>
                    <div id="groups-list" class="stack-list">
                        <p class="muted">Loading groups…</p>
                    </div>
                </div>
            </div>

            <div id="create-section" class="section hidden">
                <div class="panel">
                    <h2>Create Group</h2>

                    <div class="form-section">
                        <span class="form-section-title">Identity</span>
                        <div class="field-grid">
                            <div class="field">
                                <label for="create-group-name">Name</label>
                                <input id="create-group-name" type="text" maxlength="32" required
                                    placeholder="Neighbourhood Garden" autocomplete="off" />
                                <span class="field-error" id="create-group-name-error" aria-live="polite"></span>
                            </div>
                            <div class="field">
                                <label for="create-group-symbol">Ticker</label>
                                <input id="create-group-symbol" type="text" maxlength="8" required
                                    pattern="[A-Za-z0-9]{2,8}" placeholder="GARDEN" autocomplete="off" />
                                <span class="field-error" id="create-group-symbol-error" aria-live="polite"></span>
                            </div>
                        </div>

                        <div class="field">
                            <label for="create-group-description">Description</label>
                            <textarea id="create-group-description" rows="3" required maxlength="600"
                                placeholder="What is this group for? How to join this group?"></textarea>
                            <small class="field-counter" id="create-group-description-counter"></small>
                            <span class="field-error" id="create-group-description-error" aria-live="polite"></span>
                        </div>

                        <div class="field">
                            <label for="create-group-image">Group image</label>
                            <label class="file-input" for="create-group-image">
                                <input id="create-group-image" type="file" accept="image/*" />
                                <span class="file-input__button">Choose file</span>
                                <span class="file-input__filename" id="create-group-image-filename">No file
                                    chosen</span>
                            </label>
                            <div id="create-image-preview-wrap" class="image-preview-wrap hidden">
                                <img id="create-image-preview" class="image-preview" alt="Group image preview" />
                                <button id="clear-create-image-btn" type="button"
                                    class="btn-tonal btn-small">Remove</button>
                            </div>
                        </div>
                    </div>

                    <div class="form-section">
                        <span class="form-section-title">Links</span>
                        <div class="field">
                            <label for="create-website">Website</label>
                            <input id="create-website" type="text" placeholder="https://…" autocomplete="off" />
                            <small class="form-helper">The official URL for this group.</small>
                            <span class="field-error" id="create-website-error" aria-live="polite"></span>
                        </div>

                        <div class="field">
                            <label>Custom link</label>
                            <div class="field-grid">
                                <div class="field">
                                    <label for="create-link-label" class="field-sublabel">Label</label>
                                    <input id="create-link-label" type="text" maxlength="48"
                                        placeholder="e.g. Discord" autocomplete="off" />
                                    <small class="field-counter" id="create-link-label-counter"></small>
                                    <span class="field-error" id="create-link-label-error" aria-live="polite"></span>
                                </div>
                                <div class="field">
                                    <label for="create-link-url" class="field-sublabel">URL</label>
                                    <input id="create-link-url" type="text" placeholder="https://…"
                                        autocomplete="off" />
                                    <span class="field-error" id="create-link-url-error" aria-live="polite"></span>
                                </div>
                            </div>
                            <small class="form-helper">An extra link shown in the group description — e.g. socials,
                                docs, or Discord.</small>
                        </div>
                    </div>

                    <div class="form-section">
                        <span class="form-section-title">Membership rules</span>
                        <div class="field">
                            <label for="create-group-type">Group access</label>
                            <select id="create-group-type">
                                <option value="">Not set</option>
                                <option value="open">Open</option>
                                <option value="closed">Closed</option>
                            </select>
                            <small class="form-helper">Whether anyone can join (Open) or membership is curated
                                (Closed).</small>
                            <span class="field-error" id="create-group-type-error" aria-live="polite"></span>
                        </div>

                        <div class="field-grid">
                            <div class="field">
                                <label for="create-membership-fee">Membership fee (%)</label>
                                <input id="create-membership-fee" type="number" min="0" max="100" step="0.01"
                                    inputmode="decimal" placeholder="0–100" />
                                <span class="field-error" id="create-membership-fee-error" aria-live="polite"></span>
                            </div>
                            <div class="field">
                                <label for="create-min-rep-score">Min. reputation score</label>
                                <input id="create-min-rep-score" type="number" min="0" step="any"
                                    inputmode="decimal" placeholder="0 or greater" />
                                <span class="field-error" id="create-min-rep-score-error" aria-live="polite"></span>
                            </div>
                        </div>

                        <div class="field">
                            <label for="create-additional-criteria">Additional criteria</label>
                            <textarea id="create-additional-criteria" rows="3"
                                placeholder="One criterion per line (max 20)"></textarea>
                            <small class="field-counter" id="create-additional-criteria-counter"></small>
                            <span class="field-error" id="create-additional-criteria-error"
                                aria-live="polite"></span>
                        </div>
                    </div>

                    <div class="form-section">
                        <span class="form-section-title">Contact</span>
                        <div class="field-grid">
                            <div class="field">
                                <label for="create-contact-email">Contact email</label>
                                <input id="create-contact-email" type="email" placeholder="hi@example.org"
                                    autocomplete="off" />
                                <span class="field-error" id="create-contact-email-error" aria-live="polite"></span>
                            </div>
                            <div class="field">
                                <label for="create-contact-website">Contact website</label>
                                <input id="create-contact-website" type="text" placeholder="https://…"
                                    autocomplete="off" />
                                <span class="field-error" id="create-contact-website-error" aria-live="polite"></span>
                            </div>
                        </div>
                    </div>

                    <div class="form-footer">
                        <button id="cancel-create-btn" class="btn-ghost" type="button">Cancel</button>
                        <button id="create-group-btn" class="btn-primary">Create Group</button>
                    </div>
                </div>
            </div>

            <div id="group-section" class="section hidden">
                <div class="panel hero-panel">
                    <div class="group-hero-head">
                        <div class="group-identity">
                            <div id="group-cover" class="group-cover hidden"></div>
                            <div class="group-heading">
                                <p class="eyebrow" id="group-symbol-display">GROUP</p>
                                <div class="group-title-row">
                                    <h2 class="group-title" id="group-name-display">Group</h2>
                                    <a id="group-address-display" class="mono group-address-inline" href="#"
                                        target="_blank" rel="noopener">—</a>
                                </div>
                                <div class="muted markdown-copy" id="group-description-display">No description</div>
                            </div>
                        </div>
                        <div class="group-header-right">
                            <div class="group-header-actions">
                                <button id="edit-group-btn" class="btn-primary btn-small">Edit profile</button>
                                <button id="refresh-group-btn" class="btn-tonal btn-small">Refresh</button>
                                <button id="switch-groups-btn" class="btn-ghost btn-small" type="button">←
                                    Switch groups</button>
                            </div>
                            <div class="group-stats-grid">
                                <div class="hero-stat">
                                    <span class="hero-stat-label">Members</span>
                                    <strong class="hero-stat-value" id="group-member-count-display">0</strong>
                                </div>
                                <div class="hero-stat">
                                    <span class="hero-stat-label">Affiliates</span>
                                    <strong class="hero-stat-value" id="group-affiliate-count-display">0</strong>
                                </div>
                                <div class="hero-stat hero-stat-wide">
                                    <span class="hero-stat-label">Fees Balance</span>
                                    <strong class="hero-stat-value hero-stat-value-balance"
                                        id="group-fee-balance-display">—</strong>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div id="group-management-menu" class="management-grid">
                    <button type="button" class="panel management-card management-picker"
                        data-management-view="members">
                        <span class="management-picker-kicker">Manage</span>
                        <strong class="management-picker-title">Members</strong>
                        <span class="management-picker-copy">Add or remove trusted members.</span>
                    </button>
                    <button type="button" class="panel management-card management-picker"
                        data-management-view="wishlist">
                        <span class="management-picker-kicker">Manage</span>
                        <strong class="management-picker-title">Join Requests</strong>
                        <span class="management-picker-copy">Review people interested in joining and add them as
                            members.</span>
                    </button>


                    <button type="button" class="panel management-card management-picker" data-management-view="tokens">
                        <span class="management-picker-kicker">Manage</span>
                        <strong id="group-token-card-title" class="management-picker-title">Treasury
                            Operations</strong>
                        <span id="group-token-card-copy" class="management-picker-copy">Review collateral and manage
                            minting and sending.</span>
                    </button>

                    <button type="button" class="panel management-card management-picker"
                        data-management-view="overview">
                        <span class="management-picker-kicker">View</span>
                        <strong class="management-picker-title">Group Details</strong>
                        <span class="management-picker-copy">See treasury, holders, ownership, and contract
                            addresses.</span>
                    </button>

                    <button type="button" class="panel management-card management-picker" data-management-view="admins">
                        <span class="management-picker-kicker">Advanced</span>
                        <strong class="management-picker-title">Advanced</strong>
                        <span class="management-picker-copy">Review current admins, add new admins and other advanced
                            functionalities.</span>
                    </button>
                </div>

                <div id="group-management-details" class="management-detail-stack">
                    <div id="group-overview-panel" class="panel management-detail hidden">
                        <div class="panel-head">
                            <h2>Group Details</h2>
                            <button type="button" class="btn-ghost btn-small" data-management-back="1">Back</button>
                        </div>

                        <div class="detail-grid overview-grid">
                            <div class="detail-card">
                                <span class="detail-label">Group</span>
                                <a id="overview-group-address" class="mono detail-link" href="#" target="_blank"
                                    rel="noopener">—</a>
                            </div>
                            <div class="detail-card">
                                <span class="detail-label">Owner Safe</span>
                                <a id="overview-owner-safe" class="mono detail-link" href="#" target="_blank"
                                    rel="noopener">—</a>
                            </div>
                            <div class="detail-card">
                                <span class="detail-label">Treasury</span>
                                <a id="overview-treasury-address" class="mono detail-link" href="#" target="_blank"
                                    rel="noopener">—</a>
                            </div>
                            <div class="detail-card">
                                <span class="detail-label">Mint Handler</span>
                                <a id="overview-mint-handler" class="mono detail-link" href="#" target="_blank"
                                    rel="noopener">—</a>
                            </div>
                            <div class="detail-card">
                                <span class="detail-label">Service</span>
                                <a id="overview-service-address" class="mono detail-link" href="#" target="_blank"
                                    rel="noopener">—</a>
                            </div>
                            <div class="detail-card">
                                <span class="detail-label">Fee Collection</span>
                                <a id="overview-fee-collection-address" class="mono detail-link" href="#"
                                    target="_blank" rel="noopener">—</a>
                            </div>
                            <div class="detail-card">
                                <span class="detail-label">Group Type</span>
                                <div id="overview-group-type" class="detail-value">—</div>
                            </div>
                            <div class="detail-card">
                                <span id="overview-total-supply-label" class="detail-label">Total Supply</span>
                                <div id="overview-total-supply" class="detail-value">—</div>
                            </div>
                        </div>


                    </div>

                    <div id="group-details-panel" class="panel management-detail hidden">
                        <div class="panel-head">
                            <h2>Edit Group Details</h2>
                            <button type="button" class="btn-ghost btn-small" data-management-back="1">Back</button>
                        </div>

                        <div class="form-section">
                            <span class="form-section-title">Identity</span>
                            <div class="field">
                                <label for="profile-description">Description</label>
                                <textarea id="profile-description" rows="4" required maxlength="600"
                                    placeholder="What is this group for? How to join this group?"></textarea>
                                <small class="field-counter" id="profile-description-counter"></small>
                                <span class="field-error" id="profile-description-error" aria-live="polite"></span>
                            </div>

                            <div class="field">
                                <label for="profile-image">Group image</label>
                                <label class="file-input" for="profile-image">
                                    <input id="profile-image" type="file" accept="image/*" />
                                    <span class="file-input__button">Choose file</span>
                                    <span class="file-input__filename" id="profile-image-filename">No file
                                        chosen</span>
                                </label>
                                <div id="profile-image-preview-wrap" class="image-preview-wrap hidden">
                                    <img id="profile-image-preview" class="image-preview"
                                        alt="Updated group image preview" />
                                    <button id="clear-profile-image-btn" type="button"
                                        class="btn-tonal btn-small">Remove</button>
                                </div>
                            </div>
                        </div>

                        <div class="form-section">
                            <span class="form-section-title">Links</span>
                            <div class="field">
                                <label for="profile-website">Website</label>
                                <input id="profile-website" type="text" placeholder="https://…"
                                    autocomplete="off" />
                                <small class="form-helper">The official URL for this group.</small>
                                <span class="field-error" id="profile-website-error" aria-live="polite"></span>
                            </div>

                            <div class="field">
                                <label>Custom link</label>
                                <div class="field-grid">
                                    <div class="field">
                                        <label for="profile-link-label" class="field-sublabel">Label</label>
                                        <input id="profile-link-label" type="text" maxlength="48"
                                            placeholder="e.g. Discord" autocomplete="off" />
                                        <small class="field-counter" id="profile-link-label-counter"></small>
                                        <span class="field-error" id="profile-link-label-error"
                                            aria-live="polite"></span>
                                    </div>
                                    <div class="field">
                                        <label for="profile-link-url" class="field-sublabel">URL</label>
                                        <input id="profile-link-url" type="text" placeholder="https://…"
                                            autocomplete="off" />
                                        <span class="field-error" id="profile-link-url-error"
                                            aria-live="polite"></span>
                                    </div>
                                </div>
                                <small class="form-helper">An extra link shown in the group description — e.g.
                                    socials, docs, or Discord.</small>
                            </div>
                        </div>

                        <div class="form-section">
                            <span class="form-section-title">Membership rules</span>
                            <div class="field">
                                <label for="profile-group-type">Group access</label>
                                <select id="profile-group-type">
                                    <option value="">Not set</option>
                                    <option value="open">Open</option>
                                    <option value="closed">Closed</option>
                                </select>
                                <small class="form-helper">Whether anyone can join (Open) or membership is curated
                                    (Closed).</small>
                                <span class="field-error" id="profile-group-type-error" aria-live="polite"></span>
                            </div>

                            <div class="field-grid">
                                <div class="field">
                                    <label for="profile-membership-fee">Membership fee (%)</label>
                                    <input id="profile-membership-fee" type="number" min="0" max="100"
                                        step="0.01" inputmode="decimal" placeholder="0–100" />
                                    <span class="field-error" id="profile-membership-fee-error"
                                        aria-live="polite"></span>
                                </div>
                                <div class="field">
                                    <label for="profile-min-rep-score">Min. reputation score</label>
                                    <input id="profile-min-rep-score" type="number" min="0" step="any"
                                        inputmode="decimal" placeholder="0 or greater" />
                                    <span class="field-error" id="profile-min-rep-score-error"
                                        aria-live="polite"></span>
                                </div>
                            </div>

                            <div class="field">
                                <label for="profile-additional-criteria">Additional criteria</label>
                                <textarea id="profile-additional-criteria" rows="3"
                                    placeholder="One criterion per line (max 20)"></textarea>
                                <small class="field-counter" id="profile-additional-criteria-counter"></small>
                                <span class="field-error" id="profile-additional-criteria-error"
                                    aria-live="polite"></span>
                            </div>
                        </div>

                        <div class="form-section">
                            <span class="form-section-title">Contact</span>
                            <div class="field-grid">
                                <div class="field">
                                    <label for="profile-contact-email">Contact email</label>
                                    <input id="profile-contact-email" type="email"
                                        placeholder="hi@example.org" autocomplete="off" />
                                    <span class="field-error" id="profile-contact-email-error"
                                        aria-live="polite"></span>
                                </div>
                                <div class="field">
                                    <label for="profile-contact-website">Contact website</label>
                                    <input id="profile-contact-website" type="text"
                                        placeholder="https://…" autocomplete="off" />
                                    <span class="field-error" id="profile-contact-website-error"
                                        aria-live="polite"></span>
                                </div>
                            </div>
                        </div>

                        <div class="form-footer">
                            <button id="cancel-profile-btn" class="btn-ghost" type="button">Cancel</button>
                            <button id="save-profile-btn" class="btn-primary">Save Profile</button>
                        </div>
                    </div>

                    <div id="group-admins-panel" class="panel management-detail hidden">
                        <div class="panel-head">
                            <h2>Group Admins</h2>
                            <button type="button" class="btn-ghost btn-small" data-management-back="1">Back</button>
                        </div>

                        <div class="field">
                            <label>Group Admins</label>
                            <div id="owner-safe-owners-list" class="stack-list">
                                <p class="muted">Open this panel to load Group Admins.</p>
                            </div>
                        </div>

                        <div class="field">
                            <label for="add-owner-input">Add new Group Admins</label>
                            <div class="input-row owner-admin-input-row">
                                <input id="add-owner-input" type="text" placeholder="Search name or paste 0x…"
                                    autocomplete="off" />
                                <button id="add-owner-safe-btn" type="button" class="btn-tonal">Add New Admin</button>
                            </div>
                        </div>
                        <div id="owner-safe-search-results" class="stack-list"></div>

                        <details class="advanced-section">
                            <summary class="advanced-toggle">Advanced</summary>

                            <div class="field">
                                <label for="owner-safe-input">Owner Safe</label>
                                <div class="input-row">
                                    <input id="owner-safe-input" type="text" placeholder="Paste new owner Safe address"
                                        autocomplete="off" />
                                    <button id="update-owner-btn" type="button" class="btn-tonal">Update Owner</button>
                                </div>
                            </div>

                            <div class="field">
                                <label for="service-address-input">Service Address</label>
                                <div class="input-row">
                                    <input id="service-address-input" type="text"
                                        placeholder="Paste new service address" autocomplete="off" />
                                    <button id="update-service-btn" type="button" class="btn-tonal">Update
                                        Service</button>
                                </div>
                            </div>

                            <div class="field">
                                <label for="fee-collection-input">Fee Collection Address</label>
                                <div class="input-row">
                                    <input id="fee-collection-input" type="text"
                                        placeholder="Paste new fee collection address" autocomplete="off" />
                                    <button id="update-fee-collection-btn" type="button" class="btn-tonal">Update Fee
                                        Collection</button>
                                </div>
                            </div>

                            <div class="field">
                                <label>Membership Conditions</label>
                                <div id="membership-conditions-list" class="stack-list">
                                    <p class="muted">Open a group to load membership conditions.</p>
                                </div>
                            </div>

                            <div class="field">
                                <label for="membership-condition-input">Membership Condition Address</label>
                                <div class="input-row">
                                    <input id="membership-condition-input" type="text"
                                        placeholder="Paste condition contract address" autocomplete="off" />
                                    <button id="enable-membership-condition-btn" type="button"
                                        class="btn-tonal">Enable</button>
                                    <button id="disable-membership-condition-btn" type="button"
                                        class="btn-ghost">Disable</button>
                                </div>
                            </div>
                        </details>
                    </div>

                    <div id="group-members-panel" class="panel management-detail hidden">
                        <div class="panel-head">
                            <h2>Manage Group Members</h2>
                            <button type="button" class="btn-ghost btn-small" data-management-back="1">Back</button>
                        </div>

                        <div class="management-toolbar">
                            <span id="members-total-count" class="muted">0 members</span>
                            <div class="management-toolbar-actions">
                                <button id="members-prev-btn" type="button" class="btn-tonal btn-small">Prev</button>
                                <span id="members-page-label" class="muted">Page 1</span>
                                <button id="members-next-btn" type="button" class="btn-tonal btn-small">Next</button>
                            </div>
                        </div>

                        <div class="field">
                            <label for="member-query">Add member</label>
                            <div class="input-row">
                                <input id="member-query" type="text" placeholder="Search name or paste 0x…"
                                    autocomplete="off" />
                                <button id="add-member-btn" class="btn-inline btn-small">Add</button>
                            </div>
                            <label class="checkbox-inline member-search-filter" for="member-include-v1">
                                <input id="member-include-v1" type="checkbox" />
                                <span>Include v1 users</span>
                            </label>
                        </div>

                        <div id="member-search-results" class="stack-list"></div>
                        <div id="members-selection-toolbar" class="members-selection-toolbar hidden">
                            <label class="checkbox-inline">
                                <input id="members-select-all" type="checkbox" />
                                <span id="members-select-all-label">Select all on page</span>
                            </label>
                            <span id="members-selection-count" class="muted">0 selected</span>
                            <button id="members-remove-selected-btn" type="button"
                                class="btn-inline btn-small btn-danger" disabled>Remove selected</button>
                        </div>
                        <div id="members-list" class="stack-list">
                            <p class="muted">Open a group to load members.</p>
                        </div>
                    </div>
                    <div id="group-wishlist-panel" class="panel management-detail hidden">
                        <div class="panel-head">
                            <h2>Join Requests</h2>
                            <button type="button" class="btn-ghost btn-small" data-management-back="1">Back</button>
                        </div>

                        <div class="management-toolbar">
                            <span id="wishlist-total-count" class="muted">0 requests</span>
                            <div class="management-toolbar-actions">
                                <button id="wishlist-prev-btn" type="button" class="btn-tonal btn-small">Prev</button>
                                <span id="wishlist-page-label" class="muted">Page 1</span>
                                <button id="wishlist-next-btn" type="button" class="btn-tonal btn-small">Next</button>
                            </div>
                        </div>

                        <div id="wishlist-selection-toolbar" class="members-selection-toolbar hidden">
                            <label class="checkbox-inline">
                                <input id="wishlist-select-all" type="checkbox" />
                                <span>Select all on page</span>
                            </label>
                            <span id="wishlist-selection-count" class="muted">0 selected</span>
                            <button id="wishlist-trust-selected-btn" type="button" class="btn-inline btn-small"
                                disabled>Trust selected</button>
                        </div>
                        <div id="wishlist-list" class="stack-list">
                            <p class="muted">Open a group to load join requests.</p>
                        </div>
                    </div>


                    <div id="group-tokens-panel" class="panel management-detail hidden">
                        <div class="panel-head">
                            <h2 id="group-token-panel-title">Manage Treasury Operations</h2>
                            <div class="management-panel-actions">
                                <button type="button" class="btn-ghost btn-small" data-management-back="1">Back</button>
                            </div>
                        </div>
                        <div class="info-box">
                            In this section you can convert your group's fees to your group's token and send it to an
                            address of your choice.
                        </div>

                        <div class="management-subsection">
                            <h3 class="management-subsection-title">Convert Fees</h3>
                            <div class="detail-grid" style="margin-bottom:0.75rem">
                                <div class="detail-card">
                                    <span class="detail-label">Fee Collection Balance</span>
                                    <div id="fee-collection-balance-display" class="detail-value">—</div>
                                </div>
                                <div class="detail-card">
                                    <span id="convertible-label" class="detail-label">Convertible to Group CRC</span>
                                    <div id="convertible-fees-display" class="detail-value">—</div>
                                </div>
                            </div>
                            <div class="field">
                                <label id="collect-fees-amount-label" for="collect-fees-amount">Amount to
                                    convert</label>
                                <div class="input-action-field">
                                    <input id="collect-fees-amount" type="text" placeholder="0.0" autocomplete="off" />
                                    <button id="collect-fees-max-btn" type="button"
                                        class="btn-tonal btn-small input-action-btn">Max</button>
                                </div>
                            </div>
                            <button id="collect-fees-btn" class="btn-primary" disabled>Convert Fees</button>
                        </div>

                        <div class="management-subsection">
                            <div class="management-subsection-header">
                                <h3 id="group-token-send-title" class="management-subsection-title">Send Token</h3>
                                <div class="detail-card send-availability-card">
                                    <span class="detail-label">Available</span>
                                    <div id="fee-address-group-token-display" class="detail-value">—</div>
                                </div>
                            </div>
                            <div class="field">
                                <label for="send-recipient">Recipient</label>
                                <input id="send-recipient" type="text" placeholder="Search name or paste 0x…"
                                    autocomplete="off" />
                            </div>
                            <div id="send-search-results" class="stack-list"></div>
                            <div class="field">
                                <label id="send-amount-label" for="send-amount">Amount</label>
                                <div class="input-action-field">
                                    <input id="send-amount" type="text" placeholder="0.0" autocomplete="off" />
                                    <button id="send-max-btn" type="button"
                                        class="btn-tonal btn-small input-action-btn">Max</button>
                                </div>
                            </div>
                            <button id="send-group-btn" class="btn-primary">Send Token</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div id="confirm-modal" class="modal-overlay hidden" aria-hidden="true">
        <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
            <div class="modal-head">
                <h2 id="confirm-modal-title">Confirm Action</h2>
            </div>
            <p id="confirm-modal-message" class="muted modal-copy"></p>
            <div class="modal-actions">
                <button id="confirm-modal-cancel" type="button" class="btn-tonal">Cancel</button>
                <button id="confirm-modal-confirm" type="button" class="btn-primary">Continue</button>
            </div>
        </div>
    </div>
`;
