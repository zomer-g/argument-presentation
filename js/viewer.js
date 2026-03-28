/**
 * viewer.js — Book/presentation navigation engine + chapter management
 */

/** Escape HTML to prevent XSS */
function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

const ViewerApp = {
    docData: null,
    flatChapters: [],
    currentIndex: 0,
    caseId: null,
    docId: null,
    editMode: false,

    async init() {
        const params = new URLSearchParams(window.location.search);
        this.caseId = params.get('case');
        this.docId = params.get('doc');

        if (!this.caseId || !this.docId) {
            window.location.href = 'index.html';
            return;
        }

        await this.loadDocument();
        if (!this.docData) return;

        document.title = this.docData.meta.title + ' — מצגת טיעונים';
        document.getElementById('docTitle').textContent = this.docData.meta.title;

        EntityProcessor.init(this.docData.entities);
        this.buildFlatChapters();
        this.buildTOC();
        this.renderEntitiesPanel();

        const hash = window.location.hash.slice(1);
        const startIndex = hash ? this.flatChapters.findIndex(c => c.id === hash) : 0;
        this.showChapter(startIndex >= 0 ? startIndex : 0);

        this.bindEvents();
        this.resolveSheetEmbeds();
    },

    async loadDocument() {
        try {
            const res = await fetch(`/api/cases/${this.caseId}/docs/${this.docId}`);
            if (!res.ok) throw new Error('Document not found');
            this.docData = await res.json();
        } catch (err) {
            console.error('Error loading document:', err);
            document.getElementById('chapterContent').innerHTML = `
                <div style="text-align: center; padding: 80px 20px; color: var(--text-muted);">
                    <i class="fas fa-exclamation-triangle fa-3x" style="margin-bottom: 16px;"></i>
                    <p>לא ניתן לטעון את המסמך</p>
                    <a href="index.html" style="color: var(--accent);">חזרה לרשימת התיקים</a>
                </div>
            `;
            this.docData = null;
        }
    },

    async reloadAndRefresh() {
        await this.loadDocument();
        if (!this.docData) return;
        EntityProcessor.init(this.docData.entities);
        this.buildFlatChapters();
        this.buildTOC();
        this.renderEntitiesPanel();
        const idx = Math.min(this.currentIndex, this.flatChapters.length - 1);
        this.showChapter(Math.max(0, idx));
    },

    // ── Flat chapters ───────────────────────────────────

    buildFlatChapters() {
        this.flatChapters = [];
        if (!this.docData.chapters) return;

        this.docData.chapters.forEach((ch, i) => {
            this.flatChapters.push({
                ...ch,
                level: 0,
                parentIndex: null,
                chapterNum: i + 1
            });

            if (ch.subsections) {
                ch.subsections.forEach((sub, j) => {
                    this.flatChapters.push({
                        ...sub,
                        level: 1,
                        parentIndex: i,
                        chapterNum: `${i + 1}.${j + 1}`
                    });
                });
            }
        });
    },

    // ── TOC ─────────────────────────────────────────────

    buildTOC() {
        const tocList = document.getElementById('tocList');
        tocList.innerHTML = '';

        let currentParent = null;
        let subList = null;

        this.flatChapters.forEach((ch, index) => {
            const li = document.createElement('li');
            li.className = 'toc-item';

            const btn = document.createElement('button');
            btn.className = 'toc-link';
            btn.dataset.index = index;
            btn.dataset.chapterId = ch.id;

            let editControls = '';
            if (this.editMode && ch.level === 0) {
                editControls = `
                    <span class="toc-edit-actions">
                        <span class="toc-action-btn" data-action="edit" data-ch="${ch.id}" title="ערוך"><i class="fas fa-pen"></i></span>
                        <span class="toc-action-btn" data-action="up" data-ch="${ch.id}" title="הזז למעלה"><i class="fas fa-arrow-up"></i></span>
                        <span class="toc-action-btn" data-action="down" data-ch="${ch.id}" title="הזז למטה"><i class="fas fa-arrow-down"></i></span>
                        <span class="toc-action-btn danger" data-action="delete" data-ch="${ch.id}" title="מחק"><i class="fas fa-trash-alt"></i></span>
                    </span>
                `;
            }

            btn.innerHTML = `
                <span class="chapter-num">${esc(String(ch.chapterNum))}</span>
                <i class="fas ${esc(ch.icon || 'fa-circle')}" style="font-size: 0.5rem;"></i>
                <span class="toc-title-text">${esc(ch.title)}</span>
                ${editControls}
            `;

            btn.addEventListener('click', (e) => {
                if (e.target.closest('.toc-action-btn')) return;
                this.showChapter(index);
            });

            li.appendChild(btn);

            if (ch.level === 0) {
                tocList.appendChild(li);
                currentParent = li;
                subList = null;
            } else {
                if (!subList) {
                    subList = document.createElement('ul');
                    subList.className = 'toc-sub-list';
                    currentParent.appendChild(subList);
                }
                subList.appendChild(li);
            }
        });

        // Bind edit action buttons
        tocList.querySelectorAll('.toc-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const chId = btn.dataset.ch;
                if (action === 'edit') this.openChapterModal(chId);
                else if (action === 'delete') this.deleteChapter(chId);
                else if (action === 'up') this.moveChapter(chId, 'up');
                else if (action === 'down') this.moveChapter(chId, 'down');
            });
        });

        // Show/hide add chapter button
        const addBtn = document.getElementById('addChapterBtn');
        if (addBtn) addBtn.style.display = this.editMode ? 'flex' : 'none';
    },

    // ── Entities Panel ──────────────────────────────────

    renderEntitiesPanel() {
        const container = document.getElementById('entitiesList');
        if (!container || !this.docData.entities) return;

        const types = {
            people: { label: 'אנשים', icon: 'fa-user', css: 'entity-people' },
            organizations: { label: 'ארגונים', icon: 'fa-building', css: 'entity-org' },
            evidence: { label: 'ראיות', icon: 'fa-file-pdf', css: 'entity-evidence' },
            cases: { label: 'תיקים', icon: 'fa-gavel', css: 'entity-case' },
            laws: { label: 'חקיקה ופסיקה', icon: 'fa-paragraph', css: 'entity-law' }
        };

        let html = '';
        for (const [type, config] of Object.entries(types)) {
            const items = this.docData.entities[type];
            if (!items || items.length === 0) continue;
            html += `<div class="entity-group">
                <div class="entity-group-title"><i class="fas ${config.icon}"></i> ${config.label}</div>`;
            items.forEach(ent => {
                const label = ent.name || ent.label || ent.ref || ent.id;
                html += `<span class="entity-badge ${esc(config.css)}" data-entity-id="${esc(ent.id)}" onclick="EntityProcessor.onBadgeClick(this, event)"><i class="fas ${esc(config.icon)}"></i> ${esc(label)}</span>`;
            });
            html += `</div>`;
        }
        container.innerHTML = html;
    },

    // ── Show Chapter ────────────────────────────────────

    showChapter(index) {
        if (index < 0 || index >= this.flatChapters.length) return;

        this.currentIndex = index;
        const chapter = this.flatChapters[index];

        history.replaceState(null, '', `#${chapter.id}`);

        const contentArea = document.getElementById('chapterContent');
        let processedContent = EntityProcessor.processContent(chapter.content || '');

        contentArea.innerHTML = `
            <div class="chapter-enter">
                <div class="chapter-header">
                    <div class="chapter-icon">
                        <i class="fas ${esc(chapter.icon || 'fa-bookmark')}"></i>
                    </div>
                    <div class="chapter-number">פרק ${esc(String(chapter.chapterNum))}</div>
                    <h1>${esc(chapter.title)}</h1>
                </div>
                <div class="chapter-body">
                    ${processedContent}
                </div>
            </div>
        `;

        document.querySelectorAll('.toc-link').forEach(link => {
            link.classList.toggle('active', parseInt(link.dataset.index) === index);
        });

        const activeLink = document.querySelector('.toc-link.active');
        if (activeLink) {
            activeLink.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }

        this.updateNavButtons();
        this.updateProgress();
        window.scrollTo({ top: 0, behavior: 'smooth' });

        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebarOverlay').classList.remove('show');
    },

    updateNavButtons() {
        const prevBtn = document.getElementById('prevChapterBtn');
        const nextBtn = document.getElementById('nextChapterBtn');
        const prevTitle = document.getElementById('prevChapterTitle');
        const nextTitle = document.getElementById('nextChapterTitle');

        if (this.currentIndex < this.flatChapters.length - 1) {
            const next = this.flatChapters[this.currentIndex + 1];
            nextBtn.classList.remove('disabled');
            nextTitle.textContent = next.title;
        } else {
            nextBtn.classList.add('disabled');
            nextTitle.textContent = '';
        }

        if (this.currentIndex > 0) {
            const prev = this.flatChapters[this.currentIndex - 1];
            prevBtn.classList.remove('disabled');
            prevTitle.textContent = prev.title;
        } else {
            prevBtn.classList.add('disabled');
            prevTitle.textContent = '';
        }
    },

    updateProgress() {
        const progress = ((this.currentIndex + 1) / this.flatChapters.length) * 100;
        document.getElementById('readingProgress').style.width = progress + '%';
    },

    // ── Edit Mode ───────────────────────────────────────

    toggleEditMode() {
        this.editMode = !this.editMode;
        const btn = document.getElementById('editModeToggle');
        const banner = document.getElementById('editModeBanner');

        if (this.editMode) {
            btn.classList.add('active-action');
            banner.style.display = 'flex';
        } else {
            btn.classList.remove('active-action');
            banner.style.display = 'none';
        }

        this.buildTOC();
        // Re-highlight active chapter
        document.querySelectorAll('.toc-link').forEach(link => {
            link.classList.toggle('active', parseInt(link.dataset.index) === this.currentIndex);
        });
    },

    // ── Chapter CRUD ────────────────────────────────────

    openChapterModal(editId) {
        const modal = document.getElementById('chapterModal');
        const title = document.getElementById('chapterModalTitle');
        const idInput = document.getElementById('chapterIdInput');
        const editField = document.getElementById('chapterEditId');

        if (editId) {
            const ch = this.docData.chapters.find(c => c.id === editId);
            if (!ch) return;
            title.textContent = 'ערוך פרק';
            editField.value = editId;
            idInput.value = ch.id;
            idInput.disabled = true;
            document.getElementById('chapterTitleInput').value = ch.title;
            document.getElementById('chapterIconSelect').value = ch.icon || 'fa-bookmark';
            document.getElementById('chapterContentInput').value = ch.content || '';
        } else {
            title.textContent = 'הוסף פרק חדש';
            editField.value = '';
            idInput.value = '';
            idInput.disabled = false;
            document.getElementById('chapterTitleInput').value = '';
            document.getElementById('chapterIconSelect').value = 'fa-bookmark';
            document.getElementById('chapterContentInput').value = '';
        }

        modal.classList.add('show');
        (editId ? document.getElementById('chapterTitleInput') : idInput).focus();
    },

    closeChapterModal() {
        document.getElementById('chapterModal').classList.remove('show');
    },

    async saveChapterModal() {
        const editId = document.getElementById('chapterEditId').value;
        const id = document.getElementById('chapterIdInput').value.trim();
        const chTitle = document.getElementById('chapterTitleInput').value.trim();
        const icon = document.getElementById('chapterIconSelect').value;
        const content = document.getElementById('chapterContentInput').value;

        if (!id || !chTitle) {
            alert('יש למלא מזהה וכותרת');
            return;
        }

        const base = `/api/cases/${this.caseId}/docs/${this.docId}/chapters`;

        try {
            if (editId) {
                await fetch(`${base}/${editId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: chTitle, icon, content })
                });
            } else {
                const res = await fetch(base, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, title: chTitle, icon, content })
                });
                if (!res.ok) {
                    const err = await res.json();
                    alert(err.error || 'שגיאה');
                    return;
                }
            }
            this.closeChapterModal();
            await this.reloadAndRefresh();
        } catch (err) {
            console.error('Error saving chapter:', err);
            alert('שגיאה בשמירת הפרק');
        }
    },

    async deleteChapter(chId) {
        const ch = this.docData.chapters.find(c => c.id === chId);
        if (!confirm(`למחוק את הפרק "${ch?.title || chId}"?`)) return;

        try {
            await fetch(`/api/cases/${this.caseId}/docs/${this.docId}/chapters/${chId}`, {
                method: 'DELETE'
            });
            await this.reloadAndRefresh();
        } catch (err) {
            console.error('Error deleting chapter:', err);
            alert('שגיאה במחיקת הפרק');
        }
    },

    async moveChapter(chId, direction) {
        const chapters = this.docData.chapters;
        const idx = chapters.findIndex(c => c.id === chId);
        if (idx < 0) return;

        const newIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (newIdx < 0 || newIdx >= chapters.length) return;

        // Build new order
        const order = chapters.map(c => c.id);
        [order[idx], order[newIdx]] = [order[newIdx], order[idx]];

        try {
            await fetch(`/api/cases/${this.caseId}/docs/${this.docId}/chapters/reorder`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order })
            });
            await this.reloadAndRefresh();
        } catch (err) {
            console.error('Error reordering chapters:', err);
        }
    },

    // ── Events ──────────────────────────────────────────

    bindEvents() {
        // Next/Prev buttons
        document.getElementById('nextChapterBtn').addEventListener('click', () => {
            this.showChapter(this.currentIndex + 1);
        });
        document.getElementById('prevChapterBtn').addEventListener('click', () => {
            this.showChapter(this.currentIndex - 1);
        });

        // Edit mode toggle
        document.getElementById('editModeToggle').addEventListener('click', () => {
            this.toggleEditMode();
        });

        // Add chapter button
        document.getElementById('addChapterBtn').addEventListener('click', () => {
            this.openChapterModal();
        });

        // Chapter modal
        document.getElementById('chapterModalClose').addEventListener('click', () => this.closeChapterModal());
        document.getElementById('chapterModalCancel').addEventListener('click', () => this.closeChapterModal());
        document.getElementById('chapterModalSave').addEventListener('click', () => this.saveChapterModal());
        document.getElementById('chapterModal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('chapterModal')) this.closeChapterModal();
        });

        // Sidebar tabs
        document.querySelectorAll('.sidebar-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const tabName = tab.dataset.tab;
                document.getElementById('tocTab').style.display = tabName === 'toc' ? '' : 'none';
                document.getElementById('entitiesTab').style.display = tabName === 'entities' ? '' : 'none';
            });
        });

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                this.showChapter(this.currentIndex + 1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                this.showChapter(this.currentIndex - 1);
            } else if (e.key === 'Escape') {
                this.closePdf();
                this.closeChapterModal();
                EntityProcessor.closePopover();
            }
        });

        // Theme toggle
        document.getElementById('themeToggle').addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme');
            const next = current === 'light' ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', next);
            const icon = document.querySelector('#themeToggle i');
            icon.className = next === 'light' ? 'fas fa-moon' : 'fas fa-sun';
            localStorage.setItem('theme', next);
        });

        // Restore saved theme
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            document.documentElement.setAttribute('data-theme', savedTheme);
            const icon = document.querySelector('#themeToggle i');
            icon.className = savedTheme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
        }

        // Print
        document.getElementById('printBtn').addEventListener('click', () => window.print());

        // Sidebar toggle (mobile)
        document.getElementById('sidebarToggle').addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('open');
            document.getElementById('sidebarOverlay').classList.toggle('show');
        });

        document.getElementById('sidebarOverlay').addEventListener('click', () => {
            document.getElementById('sidebar').classList.remove('open');
            document.getElementById('sidebarOverlay').classList.remove('show');
        });

        // PDF modal close
        document.getElementById('pdfModalClose').addEventListener('click', () => this.closePdf());
        document.getElementById('pdfModal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('pdfModal')) this.closePdf();
        });

        // Hash change
        window.addEventListener('hashchange', () => {
            const hash = window.location.hash.slice(1);
            const idx = this.flatChapters.findIndex(c => c.id === hash);
            if (idx >= 0 && idx !== this.currentIndex) {
                this.showChapter(idx);
            }
        });
    },

    // ── PDF Modal ───────────────────────────────────────

    openPdf(pdfPath, title, page) {
        const modal = document.getElementById('pdfModal');
        const modalBody = document.getElementById('pdfModalBody');
        const modalTitle = document.getElementById('pdfModalTitle');

        modalTitle.textContent = title || 'מסמך';

        // Only allow relative paths (no http/javascript/data URLs)
        if (/^(https?:|javascript:|data:)/i.test(pdfPath)) {
            modalBody.innerHTML = `<div class="pdf-placeholder"><i class="fas fa-exclamation-triangle"></i><p>קישור חיצוני אינו נתמך</p></div>`;
            modal.classList.add('show');
            return;
        }

        const basePath = `data/${encodeURI(this.caseId)}/${encodeURI(this.docId)}/`;
        let fullPath = basePath + pdfPath;
        if (page) fullPath += `#page=${page}`;

        const iframe = document.createElement('iframe');
        iframe.src = fullPath;
        iframe.title = title || 'PDF';
        modalBody.innerHTML = '';
        modalBody.appendChild(iframe);
        modal.classList.add('show');
    },

    closePdf() {
        const modal = document.getElementById('pdfModal');
        modal.classList.remove('show');
        document.getElementById('pdfModalBody').innerHTML = `
            <div class="pdf-placeholder">
                <i class="fas fa-file-pdf"></i>
                <p>המסמך אינו זמין כעת</p>
            </div>
        `;
    },

    // ── Sheet Embeds ────────────────────────────────────

    resolveSheetEmbeds() {
        if (!this.docData.embeds || !this.docData.embeds.sheets) return;

        this.sheetLookup = {};
        this.docData.embeds.sheets.forEach(sheet => {
            this.sheetLookup[sheet.id] = sheet;
        });

        const observer = new MutationObserver(() => {
            document.querySelectorAll('.sheet-embed[data-sheet-id]').forEach(el => {
                const id = el.dataset.sheetId;
                const sheet = this.sheetLookup[id];
                if (sheet && !el.dataset.resolved) {
                    el.dataset.resolved = 'true';
                    const header = el.querySelector('.sheet-embed-header span');
                    if (header) header.textContent = sheet.title || id;
                    const body = el.querySelector('.sheet-embed-body');
                    if (body && sheet.url && /^https:\/\/docs\.google\.com\//.test(sheet.url)) {
                        const iframe = document.createElement('iframe');
                        iframe.src = sheet.url;
                        iframe.style.cssText = 'width: 100%; min-height: 400px; border: none; background: #fff;';
                        body.innerHTML = '';
                        body.appendChild(iframe);
                    }
                }
            });
        });
        observer.observe(document.getElementById('contentArea'), { childList: true, subtree: true });
    }
};

document.addEventListener('DOMContentLoaded', () => ViewerApp.init());
