/**
 * entities.js — Entity highlighting, cross-references, and popover system
 */

/** Escape HTML to prevent XSS */
function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

const EntityProcessor = {
    entities: {},
    activePopover: null,

    /**
     * Initialize with entity definitions from document.json
     */
    init(entityDefs) {
        this.entities = {};
        if (!entityDefs) return;

        // Index all entity types
        const types = {
            people: { icon: 'fa-user', cssClass: 'entity-people' },
            organizations: { icon: 'fa-building', cssClass: 'entity-org' },
            evidence: { icon: 'fa-file-pdf', cssClass: 'entity-evidence' },
            cases: { icon: 'fa-gavel', cssClass: 'entity-case' },
            laws: { icon: 'fa-paragraph', cssClass: 'entity-law' }
        };

        for (const [type, config] of Object.entries(types)) {
            if (entityDefs[type]) {
                entityDefs[type].forEach(ent => {
                    this.entities[ent.id] = {
                        ...ent,
                        type,
                        icon: config.icon,
                        cssClass: config.cssClass
                    };
                });
            }
        }

        // Close popover on outside click
        document.addEventListener('click', (e) => {
            if (this.activePopover && !e.target.closest('.entity-badge')) {
                this.closePopover();
            }
        });
    },

    /**
     * Process content string, replacing {{tokens}} with HTML badges
     */
    processContent(html) {
        if (!html) return '';

        // {{entity:id}} — generic entity reference
        html = html.replace(/\{\{entity:([^}]+)\}\}/g, (match, id) => {
            return this.renderBadge(id);
        });

        // {{evidence:id}} — evidence with PDF link
        html = html.replace(/\{\{evidence:([^}]+)\}\}/g, (match, id) => {
            return this.renderBadge(id, 'evidence');
        });

        // {{evidence:id:page}} — evidence with specific page
        html = html.replace(/\{\{evidence:([^:}]+):(\d+)\}\}/g, (match, id, page) => {
            return this.renderBadge(id, 'evidence', page);
        });

        // {{cite:id}} — legal citation
        html = html.replace(/\{\{cite:([^}]+)\}\}/g, (match, id) => {
            return this.renderBadge(id, 'law');
        });

        // {{sheet:id}} — Google Sheets embed
        html = html.replace(/\{\{sheet:([^}]+)\}\}/g, (match, id) => {
            return this.renderSheetEmbed(id);
        });

        return html;
    },

    /**
     * Render an entity badge
     */
    renderBadge(id, forceType, page) {
        const entity = this.entities[id];
        if (!entity) {
            return `<span class="entity-badge entity-people"><i class="fas fa-question-circle"></i> ${id}</span>`;
        }

        const cssClass = entity.cssClass;
        const icon = entity.icon;
        const label = entity.label || entity.name || entity.ref || id;

        let attrs = `data-entity-id="${esc(id)}"`;
        if (entity.pdf) {
            attrs += ` data-pdf="${esc(entity.pdf)}"`;
        }
        if (page) {
            attrs += ` data-page="${esc(String(page))}"`;
        }

        return `<span class="entity-badge ${esc(cssClass)}" ${attrs} tabindex="0" role="button" onclick="EntityProcessor.onBadgeClick(this, event)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();EntityProcessor.onBadgeClick(this,event)}"><i class="fas ${esc(icon)}" aria-hidden="true"></i> ${esc(label)}</span>`;
    },

    /**
     * Render a Google Sheets embed placeholder
     */
    renderSheetEmbed(id) {
        // Sheets are handled by the viewer when it encounters these in the document embeds
        return `<div class="sheet-embed" data-sheet-id="${id}">
            <div class="sheet-embed-header">
                <i class="fas fa-table"></i>
                <span>טבלה: ${id}</span>
            </div>
            <div class="sheet-embed-body"></div>
        </div>`;
    },

    /**
     * Handle badge click
     */
    onBadgeClick(el, event) {
        event.stopPropagation();
        const entityId = el.dataset.entityId;
        const entity = this.entities[entityId];

        if (!entity) return;

        // If evidence with PDF, open PDF modal
        if (entity.pdf || el.dataset.pdf) {
            const pdf = entity.pdf || el.dataset.pdf;
            const page = el.dataset.page || null;
            if (typeof ViewerApp !== 'undefined' && ViewerApp.openPdf) {
                ViewerApp.openPdf(pdf, entity.label || entity.name, page);
            }
            return;
        }

        // Otherwise show popover
        this.closePopover();
        this.showPopover(el, entity);
    },

    /**
     * Show entity popover
     */
    showPopover(anchorEl, entity) {
        const popover = document.createElement('div');
        popover.className = 'entity-popover show';

        let detailsHtml = '';
        if (entity.role) detailsHtml += `<div class="entity-role">${esc(entity.role)}</div>`;
        if (entity.description) detailsHtml += `<div class="entity-refs">${esc(entity.description)}</div>`;
        if (entity.ref) detailsHtml += `<div class="entity-refs" style="direction: ltr; text-align: right;">${esc(entity.ref)}</div>`;
        if (entity.url && /^https?:\/\//.test(entity.url)) {
            detailsHtml += `<div class="entity-refs"><a href="${esc(entity.url)}" target="_blank" rel="noopener"><i class="fas fa-external-link-alt"></i> פתח קישור</a></div>`;
        }

        // Cross-references: find chapters mentioning this entity
        if (typeof ViewerApp !== 'undefined' && ViewerApp.docData) {
            const mentions = this.findMentions(entity.id, ViewerApp.docData.chapters || []);
            if (mentions.length > 0) {
                detailsHtml += `<div class="entity-mentions"><div class="mentions-title"><i class="fas fa-link"></i> אזכורים (${mentions.length})</div>`;
                mentions.forEach(m => {
                    detailsHtml += `<a class="mention-link" data-chapter-id="${esc(m.id)}" href="#${esc(m.id)}">${esc(String(m.num))}. ${esc(m.title)}</a>`;
                });
                detailsHtml += `</div>`;
            }
        }

        popover.innerHTML = `
            <button class="popover-close"><i class="fas fa-times"></i></button>
            <div class="entity-name">${esc(entity.name || entity.label || entity.ref || entity.id)}</div>
            ${detailsHtml}
        `;

        // Bind close button
        popover.querySelector('.popover-close').addEventListener('click', (e) => {
            e.stopPropagation();
            this.closePopover();
        });

        // Bind mention links
        popover.querySelectorAll('.mention-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const chId = link.dataset.chapterId;
                if (typeof ViewerApp !== 'undefined') {
                    const idx = ViewerApp.flatChapters.findIndex(c => c.id === chId);
                    if (idx >= 0) ViewerApp.showChapter(idx);
                }
                this.closePopover();
            });
        });

        // Position fixed relative to the badge
        document.body.appendChild(popover);
        const rect = anchorEl.getBoundingClientRect();
        popover.style.top = (rect.bottom + 8) + 'px';
        popover.style.right = (window.innerWidth - rect.right) + 'px';

        // Keep popover in viewport
        requestAnimationFrame(() => {
            const popRect = popover.getBoundingClientRect();
            if (popRect.bottom > window.innerHeight) {
                popover.style.top = (rect.top - popRect.height - 8) + 'px';
            }
            if (popRect.left < 0) {
                popover.style.right = 'auto';
                popover.style.left = '8px';
            }
        });

        this.activePopover = popover;
    },

    /**
     * Find chapters that mention a given entity id
     */
    findMentions(entityId, chapters) {
        const results = [];
        const pattern = new RegExp(`\\{\\{(entity|evidence|cite):${entityId}(:[^}]*)?\\}\\}|data-entity-id="${entityId}"`, 'g');

        chapters.forEach((ch, i) => {
            const content = ch.content || '';
            if (pattern.test(content)) {
                results.push({ id: ch.id, title: ch.title, num: i + 1 });
            }
            pattern.lastIndex = 0;

            if (ch.subsections) {
                ch.subsections.forEach((sub, j) => {
                    const subContent = sub.content || '';
                    if (pattern.test(subContent)) {
                        results.push({ id: sub.id, title: sub.title, num: `${i + 1}.${j + 1}` });
                    }
                    pattern.lastIndex = 0;
                });
            }
        });
        return results;
    },

    /**
     * Close active popover
     */
    closePopover() {
        if (this.activePopover) {
            this.activePopover.remove();
            this.activePopover = null;
        }
    }
};
