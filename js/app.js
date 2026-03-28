/**
 * app.js — Index page: case & document management
 */

/** Escape HTML to prevent XSS */
function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

const CaseManager = {
    cases: [],

    async init() {
        await this.loadCases();
        this.bindEvents();
    },

    async loadCases() {
        const container = document.getElementById('cases-container');
        const loading = document.getElementById('loading');
        const error = document.getElementById('error');

        try {
            const res = await fetch('/api/cases');
            if (!res.ok) throw new Error('Failed to load cases');
            const data = await res.json();
            this.cases = data.cases || [];

            loading.style.display = 'none';

            if (this.cases.length === 0) {
                error.style.display = 'block';
                container.innerHTML = '';
                return;
            }

            error.style.display = 'none';
            this.renderCases();
        } catch (err) {
            console.error('Error loading cases:', err);
            loading.style.display = 'none';
            error.style.display = 'block';
        }
    },

    renderCases() {
        const container = document.getElementById('cases-container');
        container.innerHTML = '';

        this.cases.forEach(caseData => {
            const col = document.createElement('div');
            col.className = 'col-lg-6 col-xl-4';

            const docsHtml = caseData.documents.map(doc => `
                <li data-case="${esc(caseData.id)}" data-doc="${esc(doc.id)}">
                    <i class="fas fa-file-alt"></i>
                    <span>${esc(doc.title)}</span>
                    ${doc.date ? `<span class="doc-date">${esc(doc.date)}</span>` : ''}
                    <button class="item-action-btn delete-doc-btn" data-case="${esc(caseData.id)}" data-doc="${esc(doc.id)}" title="מחק מסמך">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </li>
            `).join('');

            col.innerHTML = `
                <div class="case-card" data-case-id="${esc(caseData.id)}">
                    <div class="card-actions">
                        <button class="item-action-btn edit-case-btn" data-case="${esc(caseData.id)}" title="ערוך תיק">
                            <i class="fas fa-pen"></i>
                        </button>
                        <button class="item-action-btn delete-case-btn" data-case="${esc(caseData.id)}" title="מחק תיק">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                    <div class="case-icon">
                        <i class="fas ${esc(caseData.icon || 'fa-gavel')}"></i>
                    </div>
                    <div class="case-title">${esc(caseData.title)}</div>
                    <div class="case-subtitle">${esc(caseData.subtitle || '')}</div>
                    <ul class="doc-list">
                        ${docsHtml}
                    </ul>
                    <button class="btn-add-doc" data-case="${esc(caseData.id)}">
                        <i class="fas fa-plus"></i> הוסף מסמך
                    </button>
                </div>
            `;

            // Click handler on each document item (navigate to viewer)
            col.querySelectorAll('.doc-list li').forEach(li => {
                li.addEventListener('click', (e) => {
                    if (e.target.closest('.delete-doc-btn')) return;
                    const caseId = li.dataset.case;
                    const docId = li.dataset.doc;
                    window.location.href = `viewer.html?case=${caseId}&doc=${docId}`;
                });
            });

            container.appendChild(col);
        });

        // Bind action buttons after rendering
        this.bindCardActions();
    },

    bindEvents() {
        // Add case button
        document.getElementById('addCaseBtn').addEventListener('click', () => this.openCaseModal());

        // Case modal
        document.getElementById('caseModalClose').addEventListener('click', () => this.closeCaseModal());
        document.getElementById('caseModalCancel').addEventListener('click', () => this.closeCaseModal());
        document.getElementById('caseModalSave').addEventListener('click', () => this.saveCaseModal());
        document.getElementById('caseModal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('caseModal')) this.closeCaseModal();
        });

        // Doc modal
        document.getElementById('docModalClose').addEventListener('click', () => this.closeDocModal());
        document.getElementById('docModalCancel').addEventListener('click', () => this.closeDocModal());
        document.getElementById('docModalSave').addEventListener('click', () => this.saveDocModal());
        document.getElementById('docModal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('docModal')) this.closeDocModal();
        });

        // Escape key closes modals
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeCaseModal();
                this.closeDocModal();
            }
        });
    },

    bindCardActions() {
        // Edit case buttons
        document.querySelectorAll('.edit-case-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openCaseModal(btn.dataset.case);
            });
        });

        // Delete case buttons
        document.querySelectorAll('.delete-case-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteCase(btn.dataset.case);
            });
        });

        // Delete doc buttons
        document.querySelectorAll('.delete-doc-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteDoc(btn.dataset.case, btn.dataset.doc);
            });
        });

        // Add doc buttons
        document.querySelectorAll('.btn-add-doc').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openDocModal(btn.dataset.case);
            });
        });
    },

    // ── Case Modal ──────────────────────────────────────

    openCaseModal(editId) {
        const modal = document.getElementById('caseModal');
        const title = document.getElementById('caseModalTitle');
        const idInput = document.getElementById('caseIdInput');
        const editField = document.getElementById('caseEditId');

        if (editId) {
            const c = this.cases.find(c => c.id === editId);
            if (!c) return;
            title.textContent = 'ערוך תיק';
            editField.value = editId;
            idInput.value = c.id;
            idInput.disabled = true;
            document.getElementById('caseTitleInput').value = c.title;
            document.getElementById('caseSubtitleInput').value = c.subtitle || '';
            document.getElementById('caseIconSelect').value = c.icon || 'fa-gavel';
        } else {
            title.textContent = 'הוסף תיק חדש';
            editField.value = '';
            idInput.value = '';
            idInput.disabled = false;
            document.getElementById('caseTitleInput').value = '';
            document.getElementById('caseSubtitleInput').value = '';
            document.getElementById('caseIconSelect').value = 'fa-gavel';
        }

        modal.classList.add('show');
        (editId ? document.getElementById('caseTitleInput') : idInput).focus();
    },

    closeCaseModal() {
        document.getElementById('caseModal').classList.remove('show');
    },

    async saveCaseModal() {
        const editId = document.getElementById('caseEditId').value;
        const id = document.getElementById('caseIdInput').value.trim();
        const title = document.getElementById('caseTitleInput').value.trim();
        const subtitle = document.getElementById('caseSubtitleInput').value.trim();
        const icon = document.getElementById('caseIconSelect').value;

        if (!id || !title) {
            alert('יש למלא מזהה ושם תיק');
            return;
        }

        try {
            if (editId) {
                await fetch(`/api/cases/${editId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title, subtitle, icon })
                });
            } else {
                const res = await fetch('/api/cases', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, title, subtitle, icon, documents: [] })
                });
                if (res.status === 409) {
                    alert('תיק עם מזהה זה כבר קיים');
                    return;
                }
            }
            this.closeCaseModal();
            await this.loadCases();
        } catch (err) {
            console.error('Error saving case:', err);
            alert('שגיאה בשמירת התיק');
        }
    },

    async deleteCase(caseId) {
        const c = this.cases.find(c => c.id === caseId);
        if (!confirm(`למחוק את התיק "${c?.title || caseId}"?\nפעולה זו תמחק את כל המסמכים בתיק.`)) return;

        try {
            await fetch(`/api/cases/${caseId}`, { method: 'DELETE' });
            await this.loadCases();
        } catch (err) {
            console.error('Error deleting case:', err);
            alert('שגיאה במחיקת התיק');
        }
    },

    // ── Document Modal ──────────────────────────────────

    openDocModal(caseId) {
        document.getElementById('docCaseId').value = caseId;
        document.getElementById('docIdInput').value = '';
        document.getElementById('docTitleInput').value = '';
        document.getElementById('docDateInput').value = new Date().getFullYear().toString();
        document.getElementById('docModal').classList.add('show');
        document.getElementById('docIdInput').focus();
    },

    closeDocModal() {
        document.getElementById('docModal').classList.remove('show');
    },

    async saveDocModal() {
        const caseId = document.getElementById('docCaseId').value;
        const id = document.getElementById('docIdInput').value.trim();
        const title = document.getElementById('docTitleInput').value.trim();
        const date = document.getElementById('docDateInput').value.trim();

        if (!id || !title) {
            alert('יש למלא מזהה וכותרת מסמך');
            return;
        }

        try {
            const res = await fetch(`/api/cases/${caseId}/docs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, title, date })
            });
            if (res.status === 409) {
                alert('מסמך עם מזהה זה כבר קיים');
                return;
            }
            this.closeDocModal();
            await this.loadCases();
        } catch (err) {
            console.error('Error adding document:', err);
            alert('שגיאה בהוספת המסמך');
        }
    },

    async deleteDoc(caseId, docId) {
        if (!confirm('למחוק את המסמך? פעולה זו אינה ניתנת לביטול.')) return;

        try {
            await fetch(`/api/cases/${caseId}/docs/${docId}`, { method: 'DELETE' });
            await this.loadCases();
        } catch (err) {
            console.error('Error deleting document:', err);
            alert('שגיאה במחיקת המסמך');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => CaseManager.init());
