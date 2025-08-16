/* =========================================================
   Medication Reminder – FULL APP.JS (with backend & FCM)
   - Keeps original UI behavior (forms, modals, scheduling)
   - Uses backend API instead of localStorage
   - Saves FCM token to user after login
   - Handles MongoDB _id vs local id safely
   ========================================================= */

// -------------------- API Helpers --------------------
// === API helpers ===
const API_BASE = 'http://localhost:5000'; // change to your deployed URL later

function authHeader() {
  const jwt = localStorage.getItem('jwt');
  return jwt ? { Authorization: 'Bearer ' + jwt } : {};
}

async function api(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(),
      ...(opts.headers || {})
    }
  });
  if (!res.ok) {
    // try to extract a friendly message
    let msg;
    try { msg = (await res.json()).message; } catch {}
    throw new Error(msg || (await res.text()) || 'Request failed');
  }
  return res.json();
}
// Auto-login on page load if JWT is present and valid
document.addEventListener('DOMContentLoaded', async () => {
  const jwt = localStorage.getItem('jwt');
  if (!jwt) return; // no token, show login

  try {
    // ping a protected route to verify token
    await api('/api/profile', { method: 'GET' });

    // token is valid → show app and init
    const loginSection = document.getElementById('loginSection');
    const appSection = document.getElementById('medicineSection') || document.getElementById('appSection');
    if (loginSection) loginSection.style.display = 'none';
    if (appSection) appSection.style.display = 'block';




    // expose app instance for onclick handlers
    // expose app instance for onclick handlers (but only once)
if (!window.app) {
  window.app = new MedicationReminderApp();
}

  } catch {
    // invalid/expired → cleanup token
    localStorage.removeItem('jwt');
  }
});


// -------------------- Firebase (Web v9) --------------------
// IMPORTANT: This file must be loaded with: <script type="module" src="app.js"></script>
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.6.11/firebase-app.js';
import { getMessaging, getToken } from 'https://www.gstatic.com/firebasejs/9.6.11/firebase-messaging.js';

// Register the service worker ASAP so background pushes work
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/firebase-messaging-sw.js').catch(console.error);
}

// Use your existing Firebase web config (from your uploaded file)
const firebaseConfig = {
  apiKey: "AIzaSyAl3B0spaQOMC_1u9gSSgw9MYXJzY0AXQ0",
  authDomain: "coffee-spark-sample-app-993fc.firebaseapp.com",
  projectId: "coffee-spark-sample-app-993fc",
  storageBucket: "coffee-spark-sample-app-993fc.firebasestorage.app",
  messagingSenderId: "26725169104",
  appId: "1:26725169104:web:92866671d13f94fb4a6bd5"
};

const fbApp = initializeApp(firebaseConfig);
const messaging = getMessaging(fbApp);

// ask for permission + save device token after login
async function initFCMAndSaveToken() {
  try {
    console.log('[FCM] starting init');
    if (!('Notification' in window)) { console.warn('[FCM] Notification API not available'); return; }

    const perm = await Notification.requestPermission();
    console.log('[FCM] permission:', perm);
    if (perm !== 'granted') return;

    const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    await navigator.serviceWorker.ready;
    console.log('[SW] registered and ready:', !!swReg);

    const token = await getToken(messaging, {
      vapidKey: 'BCofUTLuJ-1gq5xvCJQH9o2lNphd-AQF5FCF808ar-TGY48iAUK6E61AW35L4ncE5vknenH7zmWfC2Gnp179F0c',
      serviceWorkerRegistration: swReg,
    });

    console.log('[FCM] token:', token);
    if (!token) { console.warn('[FCM] getToken returned null'); return; }

    const r = await api('/api/save-fcm-token', {
      method: 'POST',
      body: JSON.stringify({ fcmToken: token })
    });
    console.log('[FCM] token saved:', r);
  } catch (err) {
    console.error('FCM init/save error:', err);
  }
}
// after the function declaration:
window.initFCMAndSaveToken = initFCMAndSaveToken;

// -------------------- Auth (Login / Signup) --------------------
const loginForm = document.getElementById('loginForm');
const loginSection = document.getElementById('loginSection');
const appSection = document.getElementById('medicineSection') || document.getElementById('appSection');

document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  try {
    const { token } = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    localStorage.setItem('jwt', token);

    // swap UI sections
    document.getElementById('loginSection').style.display = 'none';
    (document.getElementById('medicineSection') || document.getElementById('appSection')).style.display = 'block';

    // FCM token registration
    await initFCMAndSaveToken();

    // --- singleton: destroy old app if exists, then create a new one ---
    if (window.app && typeof window.app.destroy === 'function') {
      try { window.app.destroy(); } catch {}
    }
    window.app = new MedicationReminderApp();

  } catch (err) {
    alert(err.message || 'Login failed');
  }
});

const signupForm = document.getElementById('signupForm');
if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('signupEmail')?.value?.trim();
    const password = document.getElementById('signupPassword')?.value;

    try {
      await api('/api/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      alert('Signup successful! Please log in.');
      window.location.href = 'index.html';
    } catch (err) {
      alert(err.message || 'Signup failed');
    }
  });
}

// -------------------- App Class --------------------
class MedicationReminderApp {
constructor() {
  // --- singleton guard: destroy previous instance if it exists ---
  if (window.__medApp && typeof window.__medApp.destroy === 'function') {
    try { window.__medApp.destroy(); } catch {}
  }
  window.__medApp = this;

  this.medications = [];
  this.notifications = new Map();
  this.currentNotification = null;
  this.selectedAutocompleteIndex = -1;

  // keep track of any setInterval IDs so destroy() can clear them
  this._intervalIds = [];

  this.init();
}

  // ID helpers to handle Mongo _id or local id
  getMedId(m) { return m && (m._id ?? m.id); }
  findMedById(id) {
    const sid = String(id);
    return this.medications.find(m => String(this.getMedId(m)) === sid);
  }

  async init() {
  await this.loadData();
  this.setupEventListeners();
  this.requestNotificationPermission();
  this.updateCurrentTime();
  this.renderMedications();
  this.renderMissedDoses();
  this.scheduleAllMedications();

  // store interval IDs
  this._intervalIds.push(setInterval(() => this.updateCurrentTime(), 60_000));
  this._intervalIds.push(setInterval(() => this.checkMissedDoses(), 60_000));
}


  // -------------------- Data (Backend) --------------------
  async loadData() {
    try {
      const meds = await api('/api/medications', { method: 'GET' });
      // normalize so rendering never crashes
      this.medications = meds.map(m => ({
        active: m.active ?? true,
        missedDoses: Array.isArray(m.missedDoses) ? m.missedDoses : [],
        times: Array.isArray(m.times) ? m.times : (m.times ? [m.times] : []),
        scheduleType: m.scheduleType || 'daily',
        ...m,
      }));
    } catch (e) {
      console.error('Load meds error:', e);
      this.medications = [];
    }
  }
destroy() {
  // clear all scheduled dose timers
  this.notifications.forEach((tid) => clearTimeout(tid));
  this.notifications.clear();

  // clear periodic intervals if we created them
  if (this._intervalIds && Array.isArray(this._intervalIds)) {
    this._intervalIds.forEach(id => clearInterval(id));
    this._intervalIds = [];
  }
}

  async addMedication() {
    const formData = this.getFormData();
    if (!formData) return;

    const nextDoseISO = this.getNextDoseTime(formData.scheduleType, formData.times);
    const frequencyHours = formData.scheduleType === 'every-x-hours'
      ? parseInt(document.getElementById('intervalHours').value || '0', 10)
      : (formData.scheduleType === 'daily' ? 24 :
         formData.scheduleType === 'twice-daily' ? 12 :
         formData.scheduleType === 'weekly' ? (24 * 7) : 0);

    const payload = {
      name: formData.name,
      dose: formData.dose,
      instructions: formData.instructions,
      nextDose: nextDoseISO,
      frequencyHours,
      scheduleType: formData.scheduleType,
      times: formData.times,
      sideEffects: formData.sideEffects || '',
    };

    try {
      const { medication } = await api('/api/medications', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      this.medications.unshift({
        active: medication.active ?? true,
        missedDoses: Array.isArray(medication.missedDoses) ? medication.missedDoses : [],
        ...medication,
      });
      this.renderMedications();
      this.hideAddForm();
      this.showNotification('Medication added!', 'success');
    } catch (err) {
      this.showNotification(err.message || 'Add medication failed', 'error');
    }
  }

  async deleteMedication(id) {
    if (!confirm('Are you sure you want to delete this medication?')) return;
    try {
      await api(`/api/medications/${id}`, { method: 'DELETE' });
      this.medications = this.medications.filter(m => String(this.getMedId(m)) !== String(id));
      this.renderMedications();
      this.renderMissedDoses();
      this.showNotification('Medication deleted', 'success');
    } catch (err) {
      this.showNotification(err.message || 'Delete failed', 'error');
    }
  }

  // -------------------- UI Event Listeners --------------------
  setupEventListeners() {
    this.setupAutocomplete();

    const toggleBtn = document.getElementById('toggleFormBtn');
    if (toggleBtn) toggleBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.toggleAddForm(); });

    const cancelBtn = document.getElementById('cancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.hideAddForm(); });

    const scheduleType = document.getElementById('scheduleType');
    if (scheduleType) scheduleType.addEventListener('change', (e) => this.showScheduleOptions(e.target.value));

    const medicationForm = document.getElementById('medicationForm');
    if (medicationForm) medicationForm.addEventListener('submit', (e) => { e.preventDefault(); e.stopPropagation(); this.addMedication(); });

    const editForm = document.getElementById('editMedicationForm');
    if (editForm) editForm.addEventListener('submit', (e) => { e.preventDefault(); e.stopPropagation(); this.updateMedication(); });

    const closeEditModal = document.getElementById('closeEditModal');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    [closeEditModal, cancelEditBtn].forEach(btn => {
      if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.hideEditModal(); });
    });

    const closeSideEffectsModal = document.getElementById('closeSideEffectsModal');
    const closeSideEffectsBtn = document.getElementById('closeSideEffectsBtn');
    [closeSideEffectsModal, closeSideEffectsBtn].forEach(btn => {
      if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.hideSideEffectsModal(); });
    });

    const markTakenBtn = document.getElementById('markTakenBtn');
    if (markTakenBtn) markTakenBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.markAsTaken(); });

    const markMissedBtn = document.getElementById('markMissedBtn');
    if (markMissedBtn) markMissedBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.markAsMissed(); });

    document.querySelectorAll('.snooze-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const minutes = parseInt(e.target.dataset.minutes);
        this.snoozeNotification(minutes);
      });
    });

    document.addEventListener('click', (e) => { if (e.target.classList.contains('modal')) e.target.classList.add('hidden'); });
  }

  // -------------------- Autocomplete + Side Effects --------------------
  setupAutocomplete() {
    const medicationNameInput = document.getElementById('medicationName');
    const autocompleteDropdown = document.getElementById('autocompleteDropdown');
    const sideEffectsField = document.getElementById('medicationSideEffects');
    const editSideEffectsBtn = document.getElementById('editSideEffectsBtn');

    if (!medicationNameInput || !autocompleteDropdown || !sideEffectsField) return;

    medicationNameInput.addEventListener('input', (e) => {
      const query = e.target.value.trim().toLowerCase();
      if (query.length === 0) {
        this.hideAutocomplete();
        this.clearSideEffects();
        return;
      }

      const matches = Object.keys(medicinesDatabase)
        .filter(med => med.toLowerCase().includes(query))
        .slice(0, 8);

      if (matches.length > 0) {
        this.showAutocomplete(matches, query);
      } else {
        this.hideAutocomplete();
        this.clearSideEffects();
      }
    });

    medicationNameInput.addEventListener('keydown', (e) => {
      const dropdown = document.getElementById('autocompleteDropdown');
      const items = dropdown.querySelectorAll('.autocomplete-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.selectedAutocompleteIndex = Math.min(this.selectedAutocompleteIndex + 1, items.length - 1);
        this.highlightAutocompleteItem();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.selectedAutocompleteIndex = Math.max(this.selectedAutocompleteIndex - 1, -1);
        this.highlightAutocompleteItem();
      } else if (e.key === 'Enter' && this.selectedAutocompleteIndex >= 0) {
        e.preventDefault();
        const selectedItem = items[this.selectedAutocompleteIndex];
        if (selectedItem) this.selectMedication(selectedItem.textContent);
      } else if (e.key === 'Escape') {
        this.hideAutocomplete();
      }
    });

    document.addEventListener('click', (e) => {
      if (!medicationNameInput.contains(e.target) && !autocompleteDropdown.contains(e.target)) {
        this.hideAutocomplete();
      }
    });

    if (editSideEffectsBtn) {
      editSideEffectsBtn.addEventListener('click', () => {
        sideEffectsField.removeAttribute('readonly');
        sideEffectsField.focus();
        editSideEffectsBtn.textContent = 'Save';
        editSideEffectsBtn.onclick = () => {
          sideEffectsField.setAttribute('readonly', true);
          editSideEffectsBtn.textContent = 'Edit Side Effects';
          editSideEffectsBtn.onclick = null;
          this.setupEditSideEffectsHandler();
        };
      });
    }
  }

  setupEditSideEffectsHandler() {
    const editSideEffectsBtn = document.getElementById('editSideEffectsBtn');
    if (editSideEffectsBtn) {
      editSideEffectsBtn.addEventListener('click', () => {
        const sideEffectsField = document.getElementById('medicationSideEffects');
        sideEffectsField.removeAttribute('readonly');
        sideEffectsField.focus();
        editSideEffectsBtn.textContent = 'Save';
        editSideEffectsBtn.onclick = () => {
          sideEffectsField.setAttribute('readonly', true);
          editSideEffectsBtn.textContent = 'Edit Side Effects';
          editSideEffectsBtn.onclick = null;
          this.setupEditSideEffectsHandler();
        };
      });
    }
  }

  showAutocomplete(matches, query) {
    const dropdown = document.getElementById('autocompleteDropdown');
    if (!dropdown) return;

    this.selectedAutocompleteIndex = -1;

    dropdown.innerHTML = matches.map(med => {
      const highlightedName = med.replace(new RegExp(`(${query})`, 'gi'), '<strong>$1</strong>');
      return `<div class="autocomplete-item" data-medication="${med}">${highlightedName}</div>`;
    }).join('');

    dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('click', () => this.selectMedication(item.dataset.medication));
    });

    dropdown.classList.remove('hidden');
  }

  hideAutocomplete() {
    const dropdown = document.getElementById('autocompleteDropdown');
    if (dropdown) dropdown.classList.add('hidden');
    this.selectedAutocompleteIndex = -1;
  }

  highlightAutocompleteItem() {
    const dropdown = document.getElementById('autocompleteDropdown');
    const items = dropdown.querySelectorAll('.autocomplete-item');
    items.forEach((item, index) => {
      item.classList.toggle('highlighted', index === this.selectedAutocompleteIndex);
    });
  }

  selectMedication(medicationName) {
    const medicationNameInput = document.getElementById('medicationName');
    const sideEffectsField = document.getElementById('medicationSideEffects');
    const editSideEffectsBtn = document.getElementById('editSideEffectsBtn');

    if (medicationNameInput) medicationNameInput.value = medicationName;
    if (medicinesDatabase[medicationName] && sideEffectsField) {
      sideEffectsField.value = medicinesDatabase[medicationName];
      sideEffectsField.setAttribute('readonly', true);
      if (editSideEffectsBtn) editSideEffectsBtn.classList.remove('hidden');
    }
    this.hideAutocomplete();
  }

  clearSideEffects() {
    const sideEffectsField = document.getElementById('medicationSideEffects');
    const editSideEffectsBtn = document.getElementById('editSideEffectsBtn');
    if (sideEffectsField) {
      sideEffectsField.value = '';
      sideEffectsField.removeAttribute('readonly');
      sideEffectsField.placeholder = 'Enter side effects manually if medication is not in our database...';
    }
    if (editSideEffectsBtn) editSideEffectsBtn.classList.add('hidden');
  }

  // -------------------- UI Basics --------------------
  updateCurrentTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const dateString = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const currentTimeEl = document.getElementById('currentTime');
    if (currentTimeEl) currentTimeEl.textContent = `${dateString} - ${timeString}`;
  }

  toggleAddForm() {
    const form = document.getElementById('addMedicationForm');
    const btn = document.getElementById('toggleFormBtn');
    if (!form || !btn) return;
    if (form.classList.contains('hidden')) {
      form.classList.remove('hidden');
      btn.innerHTML = '<span class="btn-icon">−</span>Cancel';
    } else {
      this.hideAddForm();
    }
  }

  hideAddForm() {
    const form = document.getElementById('addMedicationForm');
    const btn = document.getElementById('toggleFormBtn');
    if (!form || !btn) return;
    form.classList.add('hidden');
    btn.innerHTML = '<span class="btn-icon">+</span>Add Medication';
    const medicationForm = document.getElementById('medicationForm');
    if (medicationForm) medicationForm.reset();
    this.showScheduleOptions('daily');
    this.clearSideEffects();
    this.hideAutocomplete();
  }

  showScheduleOptions(scheduleType) {
    document.querySelectorAll('.schedule-option').forEach(option => option.classList.add('hidden'));
    const optionMap = {
      'daily': 'dailySchedule',
      'twice-daily': 'twiceDailySchedule',
      'every-x-hours': 'everyHoursSchedule',
      'weekly': 'weeklySchedule'
    };
    const targetOption = document.getElementById(optionMap[scheduleType]);
    if (targetOption) targetOption.classList.remove('hidden');
  }

  // -------------------- Side Effects Modal --------------------
  showSideEffectsModal(medication) {
    const modal = document.getElementById('sideEffectsModal');
    const content = document.getElementById('sideEffectsDetailsContent');
    if (!modal || !content) return;

    const sideEffects = medication.sideEffects || 'No side effects information available';
    const sideEffectsList = sideEffects.split(',').map(effect => effect.trim());

    content.innerHTML = `
      <div class="side-effects-medication-name">${medication.name}</div>
      <div class="side-effects-list">
        <h4><span class="warning-icon">⚠️</span> Possible Side Effects</h4>
        <ul class="side-effects-items">
          ${sideEffectsList.map(effect => `<li>${effect}</li>`).join('')}
        </ul>
        <p style="margin-top: 16px; font-size: 12px; color: var(--color-text-secondary);">
          <strong>Note:</strong> This is not a complete list. Contact your healthcare provider if you experience any concerning symptoms.
        </p>
      </div>
    `;
    modal.classList.remove('hidden');
  }

  hideSideEffectsModal() {
    const editModal = document.getElementById('sideEffectsModal');
    if (editModal) editModal.classList.add('hidden');
  }

  // -------------------- Edit (local only for now) --------------------
  editMedication(id) {
    const medication = this.findMedById(id);
    if (!medication) return;

    const editIdEl = document.getElementById('editMedicationId');
    const editNameEl = document.getElementById('editMedicationName');
    const editDoseEl = document.getElementById('editMedicationDose');
    const editInstructionsEl = document.getElementById('editMedicationInstructions');
    const editSideEffectsEl = document.getElementById('editMedicationSideEffects');
    const editModalEl = document.getElementById('editModal');

    if (editIdEl) editIdEl.value = this.getMedId(medication);
    if (editNameEl) editNameEl.value = medication.name;
    if (editDoseEl) editDoseEl.value = medication.dose;
    if (editInstructionsEl) editInstructionsEl.value = medication.instructions || '';
    if (editSideEffectsEl) editSideEffectsEl.value = medication.sideEffects || '';
    if (editModalEl) editModalEl.classList.remove('hidden');
  }

  async updateMedication() {
  const editIdEl = document.getElementById('editMedicationId');
  const editNameEl = document.getElementById('editMedicationName');
  const editDoseEl = document.getElementById('editMedicationDose');
  const editInstructionsEl = document.getElementById('editMedicationInstructions');
  const editSideEffectsEl = document.getElementById('editMedicationSideEffects');
  if (!editIdEl || !editNameEl || !editDoseEl || !editInstructionsEl) return;

  const id = editIdEl.value; // Mongo _id (string)
  const name = editNameEl.value.trim();
  const dose = editDoseEl.value.trim();
  const instructions = editInstructionsEl.value;
  const sideEffects = editSideEffectsEl ? editSideEffectsEl.value.trim() : '';

  if (!name || !dose) {
    this.showNotification('Please fill in all required fields', 'error');
    return;
  }

  try {
    // call backend to persist
    const { medication: updated } = await api(`/api/medications/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, dose, instructions, sideEffects }),
    });

    // update local list with server copy
    const idx = this.medications.findIndex(m => String(this.getMedId(m)) === String(id));
    if (idx !== -1) this.medications[idx] = { ...this.medications[idx], ...updated };

    this.renderMedications();
    this.hideEditModal();
    this.showNotification('Medication updated!', 'success');
  } catch (err) {
    console.error('Update error:', err);
    this.showNotification(err.message || 'Update failed', 'error');
  }
}


  hideEditModal() {
    const editModal = document.getElementById('editModal');
    if (editModal) editModal.classList.add('hidden');
  }

  // -------------------- Rendering --------------------
  renderMedications() {
    const grid = document.getElementById('medicationsGrid');
    if (!grid) return;

    if (this.medications.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">💊</div>
          <p>No medications added yet. Click "Add Medication" to get started.</p>
        </div>`;
      return;
    }

    grid.innerHTML = this.medications.map(medication => {
      const nextDose = new Date(medication.nextDose);
      const now = new Date();
      const isOverdue = nextDose < now;
      const timeUntilDose = this.getTimeUntilDose(nextDose);
      const hasSideEffects = medication.sideEffects && medication.sideEffects.trim();
      const safeMed = JSON.stringify(medication).replace(/"/g, '&quot;');

      return `
        <div class="card medication-card">
          <div class="card__body">
            <div class="medication-header">
              <div>
                <h3 class="medication-name">${medication.name}</h3>
                <p class="medication-dose">${medication.dose}</p>
              </div>
              <div class="medication-actions">
                <button class="action-btn edit-btn" onclick="window.app.editMedication('${this.getMedId(medication)}')">Edit</button>
                <button class="action-btn delete-btn" onclick="window.app.deleteMedication('${this.getMedId(medication)}')">Delete</button>
              </div>
            </div>

            <div class="medication-details">
              <div class="detail-row">
                <span class="detail-label">Instructions:</span>
                <span class="detail-value">${medication.instructions || ''}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Schedule:</span>
                <span class="detail-value">${this.getScheduleDisplay(medication)}</span>
              </div>
            </div>

            ${hasSideEffects ? `
              <div class="side-effects-display">
                <div class="side-effects-label">
                  <span class="warning-icon">⚠️</span> Side Effects
                </div>
                <div class="side-effects-text" onclick="window.app.showSideEffectsModal(${safeMed})">
                  ${medication.sideEffects.length > 50 ? medication.sideEffects.substring(0, 50) + '... (click for details)' : medication.sideEffects}
                </div>
              </div>` : ''}

            <div class="next-dose ${isOverdue ? 'overdue' : ''}">
              <div class="next-dose-label">${isOverdue ? 'OVERDUE' : 'NEXT DOSE'}</div>
              <div class="next-dose-time">${timeUntilDose}</div>
            </div>

            <div class="medication-card-actions">
              <button class="take-btn" onclick="window.app.markAsTaken('${this.getMedId(medication)}')">Mark as Taken</button>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  getScheduleDisplay(medication) {
    const { scheduleType, times = [] } = medication;
    switch (scheduleType) {
      case 'daily':
        return times[0] ? `Daily at ${times[0]}` : 'Daily';
      case 'twice-daily':
        return times.length ? `Twice daily at ${times.join(' and ')}` : 'Twice daily';
      case 'every-x-hours': {
        const interval = times.length > 1 ? Math.round(24 / times.length) : (medication.frequencyHours || 24);
        return `Every ${interval} hours`;
      }
      case 'weekly': {
        if (!times[0]) return 'Weekly';
        const [day, time] = times[0].split(':');
        const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        return `Weekly on ${days[parseInt(day, 10)]} at ${time}`;
      }
      default:
        return 'Custom schedule';
    }
  }

  getTimeUntilDose(doseTime) {
    const now = new Date();
    const diff = doseTime - now;
    if (diff < 0) {
      const overdue = Math.abs(diff);
      const hours = Math.floor(overdue / (1000 * 60 * 60));
      const minutes = Math.floor((overdue % (1000 * 60 * 60)) / (1000 * 60));
      if (hours > 0) return `${hours}h ${minutes}m overdue`;
      return `${minutes}m overdue`;
    }
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  renderMissedDoses() {
    const container = document.getElementById('missedDosesList');
    if (!container) return;

    const allMissedDoses = [];
    this.medications.forEach(medication => {
      const missed = Array.isArray(medication.missedDoses) ? medication.missedDoses : [];
      missed.forEach(missedDose => {
        allMissedDoses.push({
          ...missedDose,
          medicationName: medication.name,
          medicationId: this.getMedId(medication),
        });
      });
    });

    if (allMissedDoses.length === 0) {
      container.innerHTML = `
        <div class="no-missed-doses">
          <p>No missed doses yet. Great job staying on track! 🎉</p>
        </div>`;
      return;
    }

    allMissedDoses.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    container.innerHTML = allMissedDoses.map(dose => {
      const missedTime = new Date(dose.timestamp);
      const timeString = missedTime.toLocaleString();
      return `
        <div class="missed-dose-item">
          <div class="missed-dose-info">
            <div class="missed-dose-medication">${dose.medicationName}</div>
            <div class="missed-dose-time">Missed on ${timeString}</div>
          </div>
        </div>`;
    }).join('');
  }

  // -------------------- Notification Logic --------------------
  async requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') this.showNotification('Notification permissions granted!', 'success');
    }
  }

  scheduleAllMedications() {
    this.medications.forEach(medication => { if (medication.active) this.scheduleMedication(medication); });
  }

  scheduleMedication(medication) {
  const nextDose = new Date(medication.nextDose);

  // ✅ Guard: skip invalid dates to avoid console errors
  if (isNaN(nextDose)) {
    console.warn('Skipping schedule: invalid nextDose for', medication.name, medication.nextDose);
    return;
  }

  const now = new Date();
  const timeUntilDose = nextDose - now;

  if (timeUntilDose <= 0) {
    this.showMedicationNotification(medication);
    return;
  }

  const key = this.getMedId(medication);
  if (this.notifications.has(key)) clearTimeout(this.notifications.get(key));

  const timeoutId = setTimeout(() => this.showMedicationNotification(medication), timeUntilDose);
  this.notifications.set(key, timeoutId);
}

  showMedicationNotification(medication) {
  // ❌ Do NOT mutate medication.nextDose here; let user action decide the next time
  // ❌ Do NOT auto-reschedule; we will reschedule after the user clicks an action (Taken/Missed/Snooze)

  if (Notification.permission === 'granted') {
    const notification = new Notification(`Time for ${medication.name}`, {
      body: `${medication.dose} - ${medication.instructions || ''}`,
      tag: `medication-${this.getMedId(medication)}`,
      requireInteraction: true,
    });
    notification.onclick = () => {
      window.focus();
      this.showNotificationModal(medication);
      notification.close();
    };
  }

  this.showNotificationModal(medication);
}

  showNotificationModal(medication) {
    this.currentNotification = medication;
    const content = document.getElementById('notificationContent');
    const modal = document.getElementById('notificationModal');
    if (content) {
      content.innerHTML = `
        <div class="notification-medication">${medication.name}</div>
        <div class="notification-dose">${medication.dose}</div>
        <div class="notification-instructions">${medication.instructions || ''}</div>`;
    }
    if (modal) modal.classList.remove('hidden');
  }

  async snoozeNotification(minutes) {
  if (!this.currentNotification) return;

  const med = this.findMedById(this.getMedId(this.currentNotification));
  if (!med) return;

  const snoozeTime = new Date();
  snoozeTime.setMinutes(snoozeTime.getMinutes() + minutes);
  const nextDose = snoozeTime.toISOString();

  try {
    // ✅ Persist to backend so cron won’t send another push
    await api(`/api/medications/${this.getMedId(med)}`, {
      method: 'PUT',
      body: JSON.stringify({ nextDose })
    });

    // Update local and reschedule cleanly
    med.nextDose = nextDose;

    const key = this.getMedId(med);
    if (this.notifications.has(key)) {
      clearTimeout(this.notifications.get(key));
      this.notifications.delete(key);
    }
    this.scheduleMedication(med);

    // Close modal
    const modal = document.getElementById('notificationModal');
    if (modal) modal.classList.add('hidden');
    this.currentNotification = null;

    this.renderMedications();
    this.showNotification(`Snoozed for ${minutes} minutes`, 'info');
  } catch (err) {
    console.error('Snooze PUT failed:', err);
    this.showNotification(err.message || 'Failed to snooze', 'error');
  }
}

computeNextDoseAfter(med) {
  const now = new Date();

  // Try schedule-based next dose first
  const times = Array.isArray(med.times) ? med.times.filter(Boolean) : [];
  let iso;
  try {
    iso = this.getNextDoseTime(med.scheduleType, times);
  } catch {
    iso = null;
  }

  const nd = iso ? new Date(iso) : new Date(NaN);
  if (!isNaN(nd) && nd > now) {
    return nd.toISOString();
  }

  // Fallback by interval if schedule/time is missing or invalid
  let hours = 0;
  if (Number.isFinite(+med.frequencyHours) && +med.frequencyHours > 0) {
    hours = +med.frequencyHours;
  } else {
    switch (med.scheduleType) {
      case 'twice-daily': hours = 12; break;
      case 'daily':       hours = 24; break;
      case 'weekly':      hours = 24 * 7; break;
      default:            hours = 24;
    }
  }

  const next = new Date(now);
  next.setHours(next.getHours() + hours);
  return next.toISOString();
}

  async markAsTaken(medicationId = null) {
  const id = medicationId || this.getMedId(this.currentNotification);
  if (!id) return;

  const med = this.findMedById(id);
  if (!med) return;

  // compute a strictly future next dose based on schedule or sensible fallback
  const nextDose = this.computeNextDoseAfter(med);

  try {
    // persist so the server cron won't find it again
    await api(`/api/medications/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ nextDose })
    });

    // update local copy and reschedule
    med.nextDose = nextDose;

    const key = this.getMedId(med);
    if (this.notifications.has(key)) {
      clearTimeout(this.notifications.get(key));
      this.notifications.delete(key);
    }
    this.scheduleMedication(med);

    // close modal if open
    if (this.currentNotification) {
      const modal = document.getElementById('notificationModal');
      if (modal) modal.classList.add('hidden');
      this.currentNotification = null;
    }

    this.renderMedications();
    this.showNotification('Dose marked as taken!', 'success');
  } catch (err) {
    console.error('Mark taken PUT failed:', err);
    this.showNotification(err.message || 'Failed to update next dose', 'error');
  }
}


  async markAsMissed() {
  if (!this.currentNotification) return;

  const id = this.getMedId(this.currentNotification);
  const med = this.findMedById(id);
  if (!med) return;

  // record the missed dose
  if (!Array.isArray(med.missedDoses)) med.missedDoses = [];
  med.missedDoses.push({ timestamp: new Date().toISOString(), scheduledTime: med.nextDose });

  // compute the next future dose (no 1-min bump)
  const nextDose = this.computeNextDoseAfter(med);

  try {
    await api(`/api/medications/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ nextDose, missedDoses: med.missedDoses })
    });

    med.nextDose = nextDose;

    // clear any pending timer and reschedule
    const key = this.getMedId(med);
    if (this.notifications.has(key)) {
      clearTimeout(this.notifications.get(key));
      this.notifications.delete(key);
    }
    this.scheduleMedication(med);

    // close modal and refresh UI
    const modal = document.getElementById('notificationModal');
    if (modal) modal.classList.add('hidden');
    this.currentNotification = null;

    this.renderMedications();
    this.renderMissedDoses();
    this.showNotification('Dose marked as missed', 'warning');
  } catch (err) {
    console.error('Mark missed PUT failed:', err);
    this.showNotification(err.message || 'Failed to update missed dose', 'error');
  }
}



  async checkMissedDoses() {
  const now = new Date();
  let changedMeds = [];

  for (const med of this.medications) {
    const nextDose = new Date(med.nextDose);
    if (isNaN(nextDose)) continue;

    const overdueMs = now - nextDose;
    if (overdueMs > 30 * 60 * 1000) { // > 30 min overdue
      // Avoid duplicating the same missed entry
      const missed = Array.isArray(med.missedDoses) ? med.missedDoses : (med.missedDoses = []);
      const lastMissed = missed[missed.length - 1];
      const alreadyMissed = lastMissed && Math.abs(new Date(lastMissed.scheduledTime) - nextDose) < 60_000;
      if (alreadyMissed) continue;

      // Record missed & compute a safe future next dose
      missed.push({ timestamp: new Date().toISOString(), scheduledTime: med.nextDose });
      const newNext = this.computeNextDoseAfter(med);

      try {
        // ✅ Persist missed + next dose so cron doesn’t re-alert
        await api(`/api/medications/${this.getMedId(med)}`, {
          method: 'PUT',
          body: JSON.stringify({ nextDose: newNext, missedDoses: missed })
        });

        med.nextDose = newNext;
        changedMeds.push(med);

        // clear and reschedule
        const key = this.getMedId(med);
        if (this.notifications.has(key)) {
          clearTimeout(this.notifications.get(key));
          this.notifications.delete(key);
        }
        this.scheduleMedication(med);
      } catch (err) {
        console.error('Auto-miss PUT failed:', err);
      }
    }
  }

  if (changedMeds.length) {
    this.renderMedications();
    this.renderMissedDoses();
  }
}


  // -------------------- Scheduling Helpers --------------------
getFormData() {
  const name = document.getElementById('medicationName')?.value?.trim();
  const dose = document.getElementById('medicationDose')?.value?.trim();
  const instructions = document.getElementById('medicationInstructions')?.value?.trim() || '';
  const sideEffects = document.getElementById('medicationSideEffects')?.value?.trim() || '';
  const scheduleType = document.getElementById('scheduleType')?.value;

  if (!name || !dose || !scheduleType) {
    this.showNotification('Please fill all required fields', 'error');
    return null;
  }

  let times = [];
  let frequencyHours = 0;

  if (scheduleType === 'weekly') {
    // 🟢 WEEKLY: serialize as "D:HH:MM" (e.g., "3:08:30" for Wed 08:30)
    const day = document.getElementById('weeklyDay')?.value;      // "0".."6"
    const time = document.getElementById('weeklyTime')?.value;    // "HH:MM"
    if (!day || !time) {
      this.showNotification('Pick a day and time for weekly schedule', 'error');
      return null;
    }
    const [hh, mm] = time.split(':');
    times = [`${day}:${hh}:${mm}`];
    frequencyHours = 24 * 7;
  } else if (scheduleType === 'daily') {
    const t = document.getElementById('dailyTime')?.value;        // "HH:MM"
    if (!t) { this.showNotification('Pick a time', 'error'); return null; }
    times = [t];
    frequencyHours = 24;
  } else if (scheduleType === 'twice-daily') {
    const m = document.getElementById('morningTime')?.value;      // "HH:MM"
    const e = document.getElementById('eveningTime')?.value;      // "HH:MM"
    if (!m || !e) { this.showNotification('Pick both times', 'error'); return null; }
    times = [m, e];
    frequencyHours = 12;
  } else if (scheduleType === 'every-x-hours') {
    const interval = parseInt(document.getElementById('intervalHours')?.value || '0', 10);
    const start = document.getElementById('startTime')?.value;    // "HH:MM"
    if (!interval || !start) { this.showNotification('Set interval and start time', 'error'); return null; }
    frequencyHours = interval;

    // If you already have a generator for the intra-day times, keep using it:
    if (typeof this.generateEveryXHoursTimes === 'function') {
      times = this.generateEveryXHoursTimes(start, interval);
    } else {
      // Minimal fallback: just store the start time; nextDose calculator can handle it
      times = [start];
    }
  } else {
    this.showNotification('Choose a schedule type', 'error');
    return null;
  }

  return {
    name,
    dose,
    instructions,
    sideEffects,
    scheduleType,
    times,           // <-- weekly will now be ["D:HH:MM"]
    frequencyHours,  // 168 for weekly, 24 for daily, etc.
  };
}

  generateHourlyTimes(startTime, intervalHours) {
    const times = [];
    const [hours, minutes] = startTime.split(':').map(Number);
    let currentHour = hours;
    const iterations = Math.max(1, Math.floor(24 / Math.max(1, intervalHours)));

    for (let i = 0; i < iterations; i++) {
      const timeString = `${currentHour.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      times.push(timeString);
      currentHour = (currentHour + intervalHours) % 24;
    }
    return times;
  }

  getNextDoseTime(scheduleType, times) {
  const now = new Date();
  const t = Array.isArray(times) ? times : (times ? [times] : []);
  switch (scheduleType) {
    case 'daily':
    case 'twice-daily':
      return this.getNextDailyDose(t, now);
    case 'every-x-hours':
      return this.getNextHourlyDose(t, now);
    case 'weekly':
      return this.getNextWeeklyDose(t[0], now);
    default:
      // fallback: 1 minute from now to avoid crashes
      const d = new Date(now); d.setMinutes(d.getMinutes() + 1); return d.toISOString();
  }
}

getNextDailyDose(times, now) {
  if (!times.length || !/^\d{2}:\d{2}$/.test(times[0])) {
    const d = new Date(now); d.setMinutes(d.getMinutes() + 1); return d.toISOString();
  }
  const today = new Date(now); today.setSeconds(0, 0);
  for (const time of times) {
    if (!/^\d{2}:\d{2}$/.test(time)) continue;
    const [h, m] = time.split(':').map(Number);
    const doseTime = new Date(today); doseTime.setHours(h, m, 0, 0);
    if (doseTime > now) return doseTime.toISOString();
  }
  const [h0, m0] = times[0].split(':').map(Number);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(h0, m0, 0, 0);
  return tomorrow.toISOString();
}

getNextHourlyDose(times, now) {
  // times is a generated list; if empty/malformed, fallback
  if (!times.length || !/^\d{2}:\d{2}$/.test(times[0])) {
    const d = new Date(now); d.setMinutes(d.getMinutes() + 1); return d.toISOString();
  }
  const current = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  for (const time of times) {
    if (time > current && /^\d{2}:\d{2}$/.test(time)) {
      const [h, m] = time.split(':').map(Number);
      const doseTime = new Date(now); doseTime.setHours(h, m, 0, 0);
      return doseTime.toISOString();
    }
  }
  const [h0, m0] = times[0].split(':').map(Number);
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(h0, m0, 0, 0);
  return tomorrow.toISOString();
}

getNextWeeklyDose(dayTime, now) {
  // Expect "D:HH:MM"
  const parts = typeof dayTime === 'string' ? dayTime.split(':') : [];
  if (parts.length !== 3) {
    const d = new Date(now); d.setHours(d.getHours() + 24); return d.toISOString();
  }

  const [dayStr, hhStr, mmStr] = parts;
  const targetDay = parseInt(dayStr, 10);
  const h = parseInt(hhStr, 10);
  const m = parseInt(mmStr, 10);

  if (
    Number.isNaN(targetDay) || targetDay < 0 || targetDay > 6 ||
    Number.isNaN(h) || h < 0 || h > 23 ||
    Number.isNaN(m) || m < 0 || m > 59
  ) {
    const d = new Date(now); d.setHours(d.getHours() + 24); return d.toISOString();
  }

  const currentDay = now.getDay();
  let daysUntilTarget = (targetDay - currentDay + 7) % 7;

  if (daysUntilTarget === 0) {
    const todayDose = new Date(now); todayDose.setHours(h, m, 0, 0);
    if (todayDose > now) return todayDose.toISOString();
    daysUntilTarget = 7;
  }
  const nextDose = new Date(now);
  nextDose.setDate(nextDose.getDate() + daysUntilTarget);
  nextDose.setHours(h, m, 0, 0);
  return nextDose.toISOString();
}


  // -------------------- Toasts --------------------
  showNotification(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `status status--${type}`;
    toast.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 1001;
      padding: 12px 16px; border-radius: 8px; font-weight: 500;
      animation: slideInRight 0.3s ease-out;`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'slideOutRight 0.3s ease-in forwards';
      setTimeout(() => { if (document.body.contains(toast)) document.body.removeChild(toast); }, 300);
    }, 3000);
  }
}

// -------------------- Lightweight Medicines DB (demo) --------------------
// Keep or replace with your full list as in your original file
const medicinesDatabase = {
    "Aspirin": "nausea, stomach upset, heartburn, bleeding risk, tinnitus",
    "Paracetamol": "liver damage (high doses), nausea, skin rash",
    "Ibuprofen": "stomach upset, nausea, dizziness, kidney problems, heartburn",
    "Naproxen": "stomach pain, nausea, headache, dizziness, drowsiness",
    "Diclofenac": "stomach upset, nausea, diarrhea, dizziness, headache",
    "Tramadol": "nausea, dizziness, drowsiness, constipation, headache",
    "Codeine": "drowsiness, nausea, constipation, dizziness, vomiting",
    "Morphine": "drowsiness, nausea, constipation, confusion, respiratory depression",
    "Amoxicillin": "nausea, diarrhea, stomach upset, skin rash, yeast infections",
    "Azithromycin": "nausea, diarrhea, stomach pain, headache, dizziness",
    "Ciprofloxacin": "nausea, diarrhea, dizziness, headache, tendon problems",
    "Doxycycline": "nausea, upset stomach, photosensitivity, diarrhea",
    "Cephalexin": "diarrhea, nausea, stomach upset, skin rash, dizziness",
    "Clindamycin": "diarrhea, nausea, stomach pain, metallic taste",
    "Metronidazole": "nausea, metallic taste, diarrhea, dizziness, headache",
    "Flucloxacillin": "nausea, diarrhea, stomach upset, skin rash",
    "Clarithromycin": "nausea, diarrhea, stomach pain, headache, taste changes",
    "Erythromycin": "nausea, vomiting, stomach pain, diarrhea",
    "Amlodipine": "swollen ankles, fatigue, dizziness, flushing, palpitations",
    "Lisinopril": "dry cough, dizziness, headache, fatigue, nausea",
    "Losartan": "dizziness, fatigue, back pain, diarrhea, cough",
    "Atenolol": "fatigue, dizziness, cold hands/feet, nausea, depression",
    "Metoprolol": "fatigue, dizziness, depression, nausea, cold extremities",
    "Furosemide": "dehydration, dizziness, electrolyte imbalance, nausea",
    "Warfarin": "bleeding, bruising, nausea, fatigue, hair loss",
    "Digoxin": "nausea, vomiting, diarrhea, confusion, vision changes",
    "Ramipril": "dry cough, dizziness, fatigue, headache, nausea",
    "Candesartan": "dizziness, headache, back pain, fatigue",
    "Metformin": "nausea, diarrhea, stomach upset, metallic taste, vitamin B12 deficiency",
    "Gliclazide": "hypoglycemia, nausea, diarrhea, skin rash, weight gain",
    "Insulin": "hypoglycemia, weight gain, injection site reactions, swelling",
    "Sitagliptin": "headache, runny nose, sore throat, upper respiratory infection",
    "Sertraline": "nausea, diarrhea, dry mouth, drowsiness, sexual dysfunction",
    "Fluoxetine": "nausea, headache, drowsiness, dry mouth, sexual dysfunction",
    "Citalopram": "nausea, dry mouth, drowsiness, sweating, sexual dysfunction",
    "Escitalopram": "nausea, drowsiness, dry mouth, constipation, sexual dysfunction",
    "Venlafaxine": "nausea, drowsiness, dry mouth, constipation, sweating",
    "Mirtazapine": "drowsiness, weight gain, dry mouth, constipation, dizziness",
    "Amitriptyline": "drowsiness, dry mouth, constipation, blurred vision, weight gain",
    "Lorazepam": "drowsiness, dizziness, weakness, confusion, memory problems",
    "Diazepam": "drowsiness, muscle weakness, fatigue, confusion, memory impairment",
    "Alprazolam": "drowsiness, dizziness, fatigue, confusion, memory problems",
    "Salbutamol": "tremor, nervousness, headache, rapid heartbeat, throat irritation",
    "Prednisolone": "increased appetite, weight gain, mood changes, insomnia, stomach upset",
    "Beclomethasone": "throat irritation, hoarse voice, oral thrush, cough",
    "Montelukast": "headache, stomach pain, fatigue, fever, cough",
    "Theophylline": "nausea, vomiting, headache, insomnia, rapid heartbeat",
    "Omeprazole": "headache, stomach pain, nausea, diarrhea, constipation",
    "Lansoprazole": "headache, nausea, stomach pain, constipation, diarrhea",
    "Ranitidine": "headache, dizziness, constipation, diarrhea, fatigue",
    "Domperidone": "headache, dry mouth, stomach cramps, breast tenderness",
    "Metoclopramide": "drowsiness, restlessness, fatigue, depression, movement disorders",
    "Loperamide": "constipation, dizziness, drowsiness, nausea, dry mouth",
    "Senna": "stomach cramps, diarrhea, nausea, electrolyte imbalance",
    "Lactulose": "bloating, gas, stomach cramps, nausea, diarrhea",
    "Levothyroxine": "headache, insomnia, nervousness, tremor, increased appetite",
    "Estradiol": "nausea, headache, breast tenderness, mood changes, bloating",
    "Testosterone": "acne, mood swings, increased aggression, fluid retention",
    "Prednisone": "increased appetite, weight gain, mood changes, insomnia, high blood sugar",
    "Gabapentin": "dizziness, drowsiness, fatigue, coordination problems, blurred vision",
    "Pregabalin": "dizziness, drowsiness, dry mouth, blurred vision, weight gain",
    "Carbamazepine": "dizziness, drowsiness, nausea, blurred vision, skin rash",
    "Phenytoin": "gum overgrowth, drowsiness, confusion, skin rash, coordination problems",
    "Levetiracetam": "drowsiness, weakness, dizziness, infection, behavioral changes",
    "Cetirizine": "drowsiness, dry mouth, fatigue, dizziness, sore throat",
    "Loratadine": "headache, drowsiness, fatigue, dry mouth, nausea",
    "Fexofenadine": "headache, drowsiness, nausea, dizziness, menstrual changes",
    "Chlorpheniramine": "drowsiness, dry mouth, blurred vision, constipation, difficulty urinating",
    "Diphenhydramine": "drowsiness, dry mouth, blurred vision, constipation, dizziness",
    "Promethazine": "drowsiness, dry mouth, blurred vision, constipation, dizziness",
    "Zolpidem": "drowsiness, dizziness, diarrhea, drugged feeling, headache",
    "Zopiclone": "metallic taste, dry mouth, drowsiness, dizziness, headache",
    "Temazepam": "drowsiness, dizziness, headache, nausea, confusion",
    "Vitamin D": "nausea, vomiting, weakness, kidney problems (high doses)",
    "Vitamin B12": "diarrhea, itching, blood clots, allergic reactions",
    "Iron": "constipation, nausea, stomach upset, dark stools, metallic taste",
    "Calcium": "constipation, kidney stones, nausea, interference with other medications",
    "Folic Acid": "nausea, loss of appetite, bloating, gas, bitter taste",
    "Timolol": "eye irritation, blurred vision, headache, dizziness, fatigue",
    "Latanoprost": "eye irritation, blurred vision, eye color changes, eyelash growth",
    "Chloramphenicol": "eye irritation, blurred vision, allergic reactions",
    "Hydrocortisone": "skin thinning, burning, itching, irritation, stretch marks",
    "Clotrimazole": "skin irritation, burning, itching, redness, swelling",
    "Aciclovir": "skin irritation, burning, itching, rash, dry skin",
    "Allopurinol": "skin rash, nausea, diarrhea, drowsiness, headache",
    "Simvastatin": "muscle pain, headache, nausea, constipation, memory problems",
    "Atorvastatin": "muscle pain, joint pain, nausea, headache, insomnia",
    "Bisoprolol": "fatigue, dizziness, headache, cold extremities, nausea",
    "Spironolactone": "dizziness, headache, stomach upset, breast tenderness, irregular periods",
    "Tamsulosin": "dizziness, headache, abnormal ejaculation, rhinitis, weakness",
    "Finasteride": "decreased libido, erectile dysfunction, breast tenderness, depression",
    "Sildenafil": "headache, flushing, upset stomach, abnormal vision, nasal congestion",
    "Tadalafil": "headache, indigestion, back pain, muscle aches, flushing",
    "Doxazosin": "dizziness, fatigue, headache, nausea, drowsiness",
    "Indapamide": "headache, dizziness, fatigue, nausea, muscle cramps",
    "Bendroflumethiazide": "dizziness, headache, nausea, muscle cramps, electrolyte imbalance",
    "Alendronic Acid": "stomach upset, nausea, heartburn, muscle pain, jaw problems",
    "Risedronate": "stomach upset, heartburn, nausea, diarrhea, headache",
    "Calcium Carbonate": "constipation, gas, nausea, kidney stones, interference with medications",
    "Magnesium": "diarrhea, nausea, stomach upset, muscle weakness, irregular heartbeat",
    "Multivitamin": "nausea, stomach upset, constipation, dark stools, allergic reactions",
    "Omega-3": "fishy aftertaste, nausea, diarrhea, heartburn, bad breath",
    "Probiotics": "gas, bloating, upset stomach, skin rash, infections (rare)",
    "Melatonin": "drowsiness, headache, nausea, dizziness, irritability",
    "Zinc": "nausea, vomiting, diarrhea, metallic taste, stomach upset",
    "Vitamin C": "nausea, diarrhea, stomach cramps, heartburn, kidney stones (high doses)",
    "Biotin": "nausea, cramping, diarrhea, skin rash, interference with lab tests",
    "Turmeric": "stomach upset, nausea, dizziness, diarrhea, blood thinning",
    "Ginkgo": "headache, nausea, diarrhea, dizziness, skin reactions",
    "Echinacea": "nausea, stomach pain, dizziness, skin rash, allergic reactions",
    "St John's Wort": "nausea, diarrhea, confusion, fatigue, drug interactions",
    "Valerian": "headache, dizziness, stomach upset, dry mouth, vivid dreams",
    "Hydrochlorothiazide": "dizziness, headache, dehydration, electrolyte imbalance, nausea",
    "Pantoprazole": "headache, nausea, stomach pain, diarrhea, dizziness",
    "Esomeprazole": "headache, nausea, diarrhea, stomach pain, dry mouth",
    "Terbinafine": "headache, nausea, stomach upset, taste changes, skin rash",
    "Fluconazole": "nausea, headache, stomach pain, dizziness, skin rash",
    "Ketoconazole": "nausea, vomiting, stomach pain, headache, dizziness",
    "Miconazole": "skin irritation, burning, itching, redness, allergic reactions",
    "Nystatin": "nausea, vomiting, diarrhea, stomach upset, skin irritation",
    "Acetaminophen": "liver damage (high doses), nausea, skin rash, allergic reactions",
    "Cyclobenzaprine": "drowsiness, dry mouth, dizziness, fatigue, blurred vision",
    "Baclofen": "drowsiness, dizziness, weakness, fatigue, nausea",
    "Tizanidine": "drowsiness, dizziness, dry mouth, weakness, fatigue",
    "Methocarbamol": "drowsiness, dizziness, nausea, blurred vision, headache"
};
