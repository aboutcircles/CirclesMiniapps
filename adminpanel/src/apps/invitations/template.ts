export const HTML = `
<div class="beta-banner">
    <span class="beta-badge">Beta</span>
    <span class="beta-banner-text">This is an early <strong>beta version</strong>. <a href="https://github.com/aboutcircles/circles-invitation-links-manager/issues" target="_blank" rel="noopener">Report issues on GitHub.</a></span>
</div>

<!-- ── View: Auth ──────────────────────────────────────────────────────────── -->
<div class="card view active" id="view-auth">
    <h2>Invitation Manager</h2>
    <p class="subtitle">Sign in to manage your invitations</p>

    <div style="margin:16px 0;padding:14px 16px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;font-size:13px;color:#4c4570;line-height:1.6;">
        <strong style="display:block;margin-bottom:6px;color:#3b2f6e;">What this app does</strong>
        This tool lets users with quota access create <strong>magic links</strong> that:
        <ul style="margin:6px 0 0 0;padding-left:18px;">
            <li>Let anybody create a Gnosis App account with a Circles invite</li>
            <li>Automatically add new accounts to a group</li>
            <li>Include UTM tags and tracking parameters</li>
            <li>Have an optional expiry date</li>
            <li>Can be put on hold at any time</li>
        </ul>
        <span style="display:block;margin-top:8px;">You can also manage manually created invitation links.</span>
    </div>

    <div class="status disconnected" id="status">
        Waiting for account connection...
    </div>

    <div id="auth-panel" style="display:none">
        <button id="challengeBtn">Sign in</button>
        <div class="result" id="challengeResult"></div>
    </div>
</div>

<!-- ── View: Sessions list ─────────────────────────────────────────────────── -->
<div class="card view" id="view-sessions">
    <div class="nav-tabs">
        <button class="nav-tab nav-tab-sessions active">Magic Links</button>
        <button class="nav-tab nav-tab-invites">Individual Links</button>
    </div>

    <div style="margin:12px 0 16px;padding:12px 14px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;font-size:12px;color:#075985;line-height:1.6;">
        <strong style="display:block;margin-bottom:4px;">How it works</strong>
        <ol style="margin:0;padding-left:18px;">
            <li>Create a new magic link.</li>
            <li>Charge it with invites from your quota.</li>
            <li>Add additional information (group, UTM tags, expiry).</li>
            <li>Manage campaigns by reassigning invites between links.</li>
        </ol>
    </div>

    <div id="quotaBanner" style="display:none;margin-bottom:12px;padding:10px 14px;background:#f0fdf4;border:1px solid #bbf7ca;border-radius:10px;font-size:13px;color:#15803d;">
        Overall quota available: <strong id="quotaBannerValue">0</strong> invites
    </div>

    <div class="sessions-header">
        <h3>Magic Links</h3>
        <button class="btn-sm" id="newSessionBtn">+ New</button>
    </div>

    <div id="sessionsContent">
        <div class="empty-state">Loading…</div>
    </div>

    <div style="margin-top:16px;">
        <div style="display:flex;gap:6px;">
            <input type="text" id="lookupLinkInput" placeholder="Paste any distribution link to see its stats…" style="flex:1;font-size:13px;padding:8px 10px;border:1px solid #ede1d8;border-radius:8px;outline:none;" />
            <button class="btn-sm btn-secondary" id="lookupLinkBtn" style="white-space:nowrap;">Look up</button>
        </div>
        <div id="lookupResult" style="display:none;margin-top:8px;padding:10px 14px;border:1px solid #ede1d8;border-radius:10px;background:#faf5f1;font-size:13px;"></div>
    </div>

    <div style="margin-top:12px;text-align:right;">
        <button class="btn-secondary btn-sm" id="signOutBtn">Sign out</button>
    </div>

</div>

<!-- ── View: Session detail ────────────────────────────────────────────────── -->
<div class="card view" id="view-detail">
    <div class="nav-tabs">
        <button class="nav-tab nav-tab-sessions active">Magic Links</button>
        <button class="nav-tab nav-tab-invites">Individual Links</button>
    </div>

    <button class="back-btn" id="backBtn">← Magic Links</button>

    <div class="detail-header" style="display:flex;align-items:flex-start;justify-content:space-between;">
        <div>
            <div class="detail-label" id="detailLabel">Distribution</div>
            <div class="detail-meta" id="detailMeta"></div>
        </div>
        <div style="display:flex;gap:6px;">
            <button class="btn-secondary btn-sm" id="pauseBtn" title="Pause" style="padding:4px 8px;font-size:14px;line-height:1;">⏸</button>
            <button class="btn-secondary btn-sm" id="refreshDetailBtn" title="Refresh" style="padding:4px 8px;font-size:14px;line-height:1;">↻</button>
            <button class="btn-secondary btn-sm" id="reassignSessionBtn" title="Reassign to another address" style="padding:4px 8px;font-size:14px;line-height:1;">↪</button>
            <button class="btn-secondary btn-sm" id="deleteSessionBtn" title="Delete session" style="padding:4px 8px;font-size:14px;line-height:1;color:#dc2626;border-color:#fca5a5;">🗑</button>
        </div>
    </div>
    <div id="deleteConfirmRow" style="display:none;align-items:center;gap:8px;margin-bottom:8px;padding:8px 10px;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;">
        <span style="font-size:13px;color:#dc2626;flex:1;">Delete this session? This cannot be undone.</span>
        <button class="btn-sm" id="confirmDeleteBtn" style="background:#dc2626;padding:4px 10px;font-size:13px;">Delete</button>
        <button class="btn-secondary btn-sm" id="cancelDeleteBtn" style="padding:4px 10px;font-size:13px;">Cancel</button>
    </div>
    <div id="delegateRow" style="display:none;align-items:center;gap:8px;margin-bottom:8px;padding:8px 10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;">
        <input type="text" id="delegateAddressInput" placeholder="0x… new owner address" style="flex:1;font-size:13px;padding:4px 8px;border:1px solid #bfdbfe;border-radius:6px;outline:none;" />
        <button class="btn-sm" id="confirmDelegateBtn" style="padding:4px 10px;font-size:13px;">Reassign</button>
        <button class="btn-secondary btn-sm" id="cancelDelegateBtn" style="padding:4px 10px;font-size:13px;">Cancel</button>
    </div>

    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <!-- Quota / generate (shown only when quota > 0) -->
        <div id="quotaRow" style="display:none;align-items:center;gap:8px;flex:1;padding:4px 10px;background:#f0fdf4;border:1px solid #bbf7ca;border-radius:8px;">
            <span style="font-size:12px;color:#15803d;flex:1;">Quota: <strong id="quotaValue">0</strong></span>
            <input id="generateCount" type="number" min="1" max="10" value="10" style="width:48px;padding:3px 5px;border:1px solid #bbf7ca;border-radius:6px;font-size:12px;text-align:center;background:#fff;">
            <button class="btn-sm" id="generateInvitesBtn" style="background:#15803d;padding:4px 8px;font-size:16px;line-height:1;" title="Create invites">＋</button>
        </div>
    </div>
    <div class="result" id="generateResult" style="margin-bottom:12px;"></div>

    <!-- Group assignment row -->
    <div class="group-assign-row">
        <span class="group-assign-label">Group</span>
        <span class="group-assign-value none" id="groupAssignValue">No group</span>
    </div>
    <div class="result group-assign-result" id="groupAssignResult"></div>

    <!-- Keys list -->
    <div style="display:flex;align-items:baseline;gap:8px;margin-top:16px;margin-bottom:8px;">
        <div class="section-title" style="margin:0;">Invites</div>
        <span id="statsSummary" style="font-size:12px;color:#6b7280;"></span>
    </div>
    <div id="refreshSpinner" style="display:none;text-align:center;padding:8px;font-size:12px;color:#9b9db3;">Refreshing…</div>
    <div id="keysList"></div>

    <!-- Add keys panel (at bottom of list) -->
    <div id="addKeysPanel" style="display:none;margin-top:12px;">
        <textarea class="keys-textarea" id="keysInput" placeholder="0x1a2b3c...&#10;0x4d5e6f..."></textarea>
        <p class="keys-hint">One private key per line (0x + 64 hex chars)</p>
        <div style="display:flex;gap:8px;">
            <button class="btn-secondary btn-sm" id="cancelAddKeysBtn">Cancel</button>
            <button class="btn-sm" id="submitKeysBtn">Add Keys</button>
        </div>
        <div class="result" id="addKeysResult"></div>
    </div>
    <button class="btn-secondary btn-sm" id="addKeysBtn" style="width:100%;margin-top:10px;">+ Add keys manually</button>
</div>

<!-- ── View: My Invites ────────────────────────────────────────────────────── -->
<div class="card view" id="view-myinvites">
    <div class="nav-tabs">
        <button class="nav-tab nav-tab-sessions">Magic Links</button>
        <button class="nav-tab nav-tab-invites active">Individual Links</button>
    </div>

    <div class="sessions-header">
        <h3>Individual Links</h3>
    </div>
    <p style="font-size:12px;color:#6b7280;margin:-8px 0 14px;">These invitation codes are generated through the app and can be assigned to magic links as well.</p>

    <!-- Add keys to pool panel (hidden by default) -->
    <div id="addToPoolPanel" style="display:none;margin-bottom:16px;">
        <div class="section-title">Store Private Keys (one per line)</div>
        <textarea class="keys-textarea" id="poolKeysInput" placeholder="0x1a2b3c...&#10;0x4d5e6f..."></textarea>
        <p class="keys-hint">Each key is a 32-byte secp256k1 private key (0x + 64 hex chars)</p>
        <div style="display:flex;gap:8px;">
            <button class="btn-secondary btn-sm" id="cancelAddToPoolBtn">Cancel</button>
            <button class="btn-sm" id="submitPoolKeysBtn">Store Keys</button>
        </div>
        <div class="result" id="addToPoolResult"></div>
    </div>

    <div style="margin-bottom:12px;">
        <button id="addToPoolBtn" style="background:none;border:none;padding:0;font-size:12px;color:#9b9db3;cursor:pointer;text-decoration:underline;text-underline-offset:2px;">+ Add keys manually (advanced)</button>
    </div>

    <div id="myInvitesContent">
        <div class="empty-state">Loading…</div>
    </div>

    <div style="margin-top:12px;text-align:right;">
        <button class="btn-secondary btn-sm" id="myInvitesSignOutBtn">Sign out</button>
    </div>
</div>

<!-- ── Modal: Create session ───────────────────────────────────────────────── -->
<div class="modal-overlay" id="createModal">
    <div class="modal">
        <h3>New Magic Link</h3>

        <div class="field">
            <label>Label</label>
            <input type="text" id="newLabel" placeholder="e.g. ETHDenver booth #3" maxlength="80">
        </div>

        <div class="field">
            <label>Expires</label>
            <div class="expiry-opts">
                <span class="expiry-opt selected" data-days="0">Never</span>
                <span class="expiry-opt" data-days="1">1 day</span>
                <span class="expiry-opt" data-days="7">7 days</span>
                <span class="expiry-opt" data-days="30">30 days</span>
            </div>
        </div>

        <div class="result" id="createResult"></div>

        <div class="modal-actions">
            <button class="btn-secondary" id="cancelCreateBtn">Cancel</button>
            <button id="confirmCreateBtn">Create Magic Link</button>
        </div>
    </div>
</div>

<!-- ── Modal: Assign to session (from My Invites) ─────────────────────────── -->
<div class="modal-overlay" id="assignModal">
    <div class="modal">
        <h3>Assign to Magic Link</h3>
        <div class="assign-session-list" id="assignSessionList">
            <div class="empty-state">No sessions available.</div>
        </div>

        <div class="result" id="assignResult" style="margin-top:8px;"></div>

        <div class="modal-actions">
            <button class="btn-secondary" id="cancelAssignBtn">Cancel</button>
        </div>
    </div>
</div>

<!-- ── Modal: Custom GET params for a session ─────────────────────────────── -->
<div class="modal-overlay" id="paramsModal">
    <div class="modal">
        <h3>Add Parameters</h3>
        <p style="font-size:13px;color:#6a6c8c;margin-bottom:14px;">
            These params will be appended to the magic link when copying.<br>
            Useful for UTM tags or any tracking parameters.
        </p>
        <div class="field">
            <label>Parameters</label>
            <textarea class="params-textarea" id="paramsInput" placeholder="utm_source=booth&utm_medium=qr&utm_campaign=ethdenver"></textarea>
        </div>
        <p class="params-hint">Enter as key=value pairs separated by &amp; — do not include the leading ?</p>
        <div class="result" id="paramsResult"></div>
        <div class="modal-actions">
            <button class="btn-secondary" id="cancelParamsBtn">Cancel</button>
            <button id="saveParamsBtn">Save</button>
        </div>
    </div>
</div>

<!-- ── Modal: Pick group for session ──────────────────────────────────────── -->
<div class="modal-overlay" id="groupPickModal">
    <div class="modal">
        <h3>Assign Group</h3>
        <p style="font-size:13px;color:#6a6c8c;margin-bottom:14px;">
            All the invitation accounts in this session will be added to the selected group.
            Switching to No group will remove all the invitation accounts from the group.
        </p>
        <div class="group-pick-list" id="groupPickList">
            <div class="empty-state">Loading groups…</div>
        </div>
        <div style="margin-top:8px;">
            <div class="group-pick-item" id="groupPickNone">
                <span class="group-pick-name" style="color:#9b9db3;">No group</span>
                <span class="group-pick-role">remove assignment</span>
            </div>
        </div>
        <div class="result" id="groupPickResult" style="margin-top:8px;"></div>
        <div class="modal-actions">
            <button class="btn-secondary" id="cancelGroupPickBtn">Cancel</button>
        </div>
    </div>
</div>

<!-- ── Modal: Reassign key to another session (from session detail) ────────── -->
<div class="modal-overlay" id="reassignModal">
    <div class="modal">
        <h3>Move to another Magic Link</h3>
        <div class="assign-session-list" id="reassignSessionList">
            <div class="empty-state">No other sessions available.</div>
        </div>
        <div class="result" id="reassignResult" style="margin-top:8px;"></div>
        <div class="modal-actions">
            <button class="btn-secondary" id="cancelReassignBtn">Cancel</button>
        </div>
    </div>
</div>

<!-- ── Modal: Delegate success ─────────────────────────────────────────────── -->
<div class="modal-overlay" id="delegateSuccessModal">
    <div class="modal" style="text-align:center;">
        <div style="font-size:36px;margin-bottom:8px;">✓</div>
        <h3 style="margin-bottom:6px;">Session Reassigned</h3>
        <p id="delegateSuccessMsg" style="font-size:13px;color:#6a6c8c;margin-bottom:16px;"></p>
        <div class="modal-actions">
            <button id="closeDelegateSuccessBtn">Done</button>
        </div>
    </div>
</div>

`;
