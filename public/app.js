// Constants
const API_BASE = '/';
let currentUserId = '';
let currentAssetSlug = '';
let currentWalletId = '';
let nextCursor = null;

// DOM Elements
const userSelect = document.getElementById('user-select');
const walletsContainer = document.getElementById('wallets-container');
const userInfo = document.getElementById('user-info');
const currentUsername = document.getElementById('current-username');
const currentUserIdEl = document.getElementById('current-user-id');
const txForm = document.getElementById('tx-form');
const txAssetSelect = document.getElementById('tx-asset');
const ledgerBody = document.getElementById('ledger-body');
const pagination = document.getElementById('pagination');
const loadMoreBtn = document.getElementById('load-more');
const historyWalletName = document.getElementById('history-wallet-name');
const toastContainer = document.getElementById('toast-container');

// Initialization
async function init() {
    await loadUsers();
    await loadAssets();
    
    userSelect.addEventListener('change', (e) => {
        const userId = e.target.value;
        if (userId) {
            switchUser(userId);
        } else {
            resetDashboard();
        }
    });

    txForm.addEventListener('submit', handleTransaction);
    loadMoreBtn.addEventListener('click', () => loadHistory(currentWalletId, true));
}

// API Functions
async function loadUsers() {
    try {
        const response = await fetch(`${API_BASE}users`);
        const users = await response.json();
        
        userSelect.innerHTML = '<option value="">Select User</option>' + 
            users.map(u => `<option value="${u.id}">${u.username} (${u.email})</option>`).join('');
    } catch (error) {
        showToast('Failed to load users', 'error');
    }
}

async function loadAssets() {
    try {
        const response = await fetch(`${API_BASE}assets`);
        const assets = await response.json();
        
        txAssetSelect.innerHTML = assets.map(a => `<option value="${a.slug}">${a.name}</option>`).join('');
    } catch (error) {
        showToast('Failed to load assets', 'error');
    }
}

async function switchUser(userId) {
    currentUserId = userId;
    const selectedOption = userSelect.options[userSelect.selectedIndex];
    currentUsername.textContent = selectedOption.text.split(' (')[0] + ' Dashboard';
    currentUserIdEl.textContent = userId;
    userInfo.classList.remove('hidden');
    
    await loadWallets();
    resetLedger();
}

async function loadWallets() {
    try {
        const response = await fetch(`${API_BASE}users/${currentUserId}/wallets`);
        const wallets = await response.json();
        
        renderWallets(wallets);
    } catch (error) {
        showToast('Failed to load wallets', 'error');
    }
}

function renderWallets(wallets) {
    walletsContainer.innerHTML = wallets.map(w => `
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:border-indigo-300 transition-colors cursor-pointer" onclick="viewHistory('${w.id}', '${w.asset.name}')">
            <div class="flex justify-between items-start mb-4">
                <div>
                    <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wider">${w.asset.name}</h4>
                    <p class="text-3xl font-bold text-gray-800">${w.balance}</p>
                </div>
                <div class="bg-indigo-50 p-3 rounded-lg text-indigo-600">
                    <i class="fas ${w.asset.slug === 'gold_coins' ? 'fa-coins' : 'fa-gem'}"></i>
                </div>
            </div>
            <div class="flex items-center text-xs text-gray-500">
                <span class="mr-2">ID: ${w.id.substring(0, 8)}...</span>
                <button class="text-indigo-600 font-semibold ml-auto hover:underline">View History</button>
            </div>
        </div>
    `).join('');
}

async function handleTransaction(e) {
    e.preventDefault();
    const type = document.getElementById('tx-type').value;
    const assetSlug = document.getElementById('tx-asset').value;
    const amount = document.getElementById('tx-amount').value;
    const metadata = document.getElementById('tx-metadata').value;
    const submitBtn = document.getElementById('submit-tx');

    if (!currentUserId) {
        showToast('Please select a user first', 'warning');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="spinner"></div>';

    try {
        const response = await fetch(`${API_BASE}transactions/${type}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': crypto.randomUUID()
            },
            body: JSON.stringify({
                userId: currentUserId,
                assetSlug,
                amount,
                metadata
            })
        });

        const result = await response.json();

        if (response.ok) {
            showToast('Transaction successful!', 'success');
            txForm.reset();
            await loadWallets();
            if (currentWalletId) {
                resetLedger();
                loadHistory(currentWalletId);
            }
        } else {
            showToast(result.error || 'Transaction failed', 'error');
        }
    } catch (error) {
        showToast('Network error', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Execute Transaction';
    }
}

async function viewHistory(walletId, assetName) {
    currentWalletId = walletId;
    historyWalletName.textContent = `${assetName} Ledger`;
    resetLedger();
    await loadHistory(walletId);
}

async function loadHistory(walletId, isLoadMore = false) {
    try {
        let url = `${API_BASE}wallets/${walletId}/history?limit=10`;
        if (isLoadMore && nextCursor) {
            url += `&cursor=${encodeURIComponent(nextCursor)}`;
        }

        const response = await fetch(url);
        const result = await response.json();

        if (!response.ok) throw new Error(result.error);

        renderHistory(result.data, isLoadMore);
        nextCursor = result.pagination.nextCursor;
        
        if (nextCursor) {
            pagination.classList.remove('hidden');
        } else {
            pagination.classList.add('hidden');
        }
    } catch (error) {
        showToast('Failed to load history', 'error');
    }
}

function renderHistory(entries, isLoadMore) {
    const rows = entries.map(entry => `
        <tr class="hover:bg-gray-50 transition-colors">
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                ${new Date(entry.createdAt).toLocaleString()}
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="px-2 py-1 text-xs font-bold rounded-full ${getTypeBadgeClass(entry.type)}">
                    ${entry.type}
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="flex items-center text-xs font-semibold ${entry.direction === 'CREDIT' ? 'text-green-600' : 'text-red-600'}">
                    <i class="fas ${entry.direction === 'CREDIT' ? 'fa-arrow-down' : 'fa-arrow-up'} mr-1"></i>
                    ${entry.direction}
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-800">
                ${entry.amount}
            </td>
            <td class="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                ${entry.metadata || '-'}
            </td>
        </tr>
    `).join('');

    if (isLoadMore) {
        ledgerBody.innerHTML += rows;
    } else {
        ledgerBody.innerHTML = rows || '<tr><td colspan="5" class="px-6 py-10 text-center text-gray-400 italic">No transactions found</td></tr>';
    }
}

function getTypeBadgeClass(type) {
    switch (type) {
        case 'TOPUP': return 'bg-blue-100 text-blue-700';
        case 'SPEND': return 'bg-orange-100 text-orange-700';
        case 'BONUS': return 'bg-purple-100 text-purple-700';
        default: return 'bg-gray-100 text-gray-700';
    }
}

function resetLedger() {
    ledgerBody.innerHTML = '<tr><td colspan="5" class="px-6 py-10 text-center text-gray-400 italic">Loading ledger...</td></tr>';
    pagination.classList.add('hidden');
    nextCursor = null;
}

function resetDashboard() {
    currentUserId = '';
    userInfo.classList.add('hidden');
    walletsContainer.innerHTML = '';
    resetLedger();
    historyWalletName.textContent = 'Select a wallet to view history';
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    const colors = {
        success: 'bg-green-600',
        error: 'bg-red-600',
        warning: 'bg-yellow-500',
        info: 'bg-indigo-600'
    };
    
    toast.className = `${colors[type]} text-white px-6 py-3 rounded-lg shadow-xl flex items-center transform transition-all duration-300 translate-y-10 opacity-0`;
    toast.innerHTML = `
        <i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'} mr-2"></i>
        <span class="font-medium">${message}</span>
    `;
    
    toastContainer.appendChild(toast);
    
    // Animate in
    setTimeout(() => {
        toast.classList.remove('translate-y-10', 'opacity-0');
    }, 10);
    
    // Remove after 3s
    setTimeout(() => {
        toast.classList.add('opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

init();