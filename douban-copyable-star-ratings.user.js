// ==UserScript==
// @name         Douban Copyable Star Ratings
// @namespace    https://www.douban.com/
// @version      1.4
// @description  Copyable personal stars and community ratings.
// @match        https://book.douban.com/*
// @match        https://movie.douban.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ========================================
    // Configuration
    // ========================================

    const selector = 'span[class*="rating"][class*="-t"]';

    const CACHE_PREFIX = 'douban-community-rating:';
    const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
    const MAX_CONCURRENT = 5;

    const isBookList =
        location.hostname === 'book.douban.com' &&
        (
            /^\/people\/[^/]+\/(do|wish|collect)\/?$/.test(location.pathname) ||
            (
                /^\/mine\/?$/.test(location.pathname) &&
                /^(do|wish|collect)$/.test(new URLSearchParams(location.search).get('status'))
            )
        );

    // ========================================
    // 1. Original personal star conversion
    // ========================================

    function convertRatings(root = document) {
        const elements = root.querySelectorAll(selector);

        for (const el of elements) {
            if (el.dataset.copyableStars) continue;

            const match = el.className.match(/\brating(\d+)-t\b/);
            if (!match) continue;

            const rating = Number(match[1]);
            if (rating < 0 || rating > 5) continue;

            const stars =
                '★'.repeat(rating) + '☆'.repeat(5 - rating);

            el.classList.remove(match[0]);
            el.textContent = stars;

            el.style.cssText = `
                background: none !important;
                width: auto !important;
                height: auto !important;
                display: inline !important;
                color: #f5a623 !important;
                font-size: 14px !important;
                letter-spacing: 1px !important;
                user-select: text !important;
                -webkit-user-select: text !important;
            `;

            el.dataset.copyableStars = 'true';
        }
    }

    // ========================================
    // 2. Persistent community rating cache
    // ========================================

    function readCache(id) {
        try {
            const data = JSON.parse(
                localStorage.getItem(CACHE_PREFIX + id)
            );

            if (
                data &&
                Date.now() - data.timestamp < CACHE_TTL
            ) {
                return data;
            }
        } catch {}

        return null;
    }

    function writeCache(id, data) {
        try {
            localStorage.setItem(
                CACHE_PREFIX + id,
                JSON.stringify({
                    ...data,
                    timestamp: Date.now()
                })
            );
        } catch {}
    }

    // ========================================
    // 3. Fetch community rating
    // ========================================

    async function fetchRating(id) {
        const response = await fetch(`/subject/${id}/`, {
            credentials: 'same-origin'
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();

        const doc = new DOMParser().parseFromString(
            html,
            'text/html'
        );

        const rating = doc.querySelector(
            '#interest_sectl [property="v:average"]'
        )?.textContent.trim();

        const votes = doc.querySelector(
            '#interest_sectl [property="v:votes"]'
        )?.textContent.trim();

        if (
            rating &&
            /^\d+(\.\d+)?$/.test(rating) &&
            Number(rating) >= 0 &&
            Number(rating) <= 10
        ) {
            const data = {
                rating,
                votes: votes || null
            };

            writeCache(id, data);
            return data;
        }

        const ratingSection =
            doc.querySelector('#interest_sectl');

        if (
            ratingSection &&
            /暂无评分|评价人数不足|目前无人评价/.test(
                ratingSection.textContent
            )
        ) {
            const data = {
                rating: null,
                votes: null
            };

            writeCache(id, data);
            return data;
        }

        throw new Error('Community rating not found');
    }

    // ========================================
    // 4. Render community rating
    // ========================================

    function renderRating(label, data) {
        label.textContent = '豆瓣评分：';

        const score = document.createElement('span');

        score.textContent = data.rating ?? '暂无评分';

        score.style.cssText = `
            color: ${data.rating === null ? '#999' : '#e09015'};
            font-weight: bold;
            user-select: text !important;
        `;

        label.appendChild(score);

        label.title = data.votes
            ? `${data.votes} 人评价`
            : '';
    }

    // ========================================
    // 5. Concurrent request queue
    // ========================================

    const queue = [];

    let activeRequests = 0;
    let blocked = false;

    async function processItem({ id, label }) {
        try {
            if (!label.isConnected) return;

            const cached = readCache(id);
            const data = cached || await fetchRating(id);

            renderRating(label, data);

        } catch (error) {
            label.textContent = '豆瓣评分：—';
            label.title = '评分获取失败';

            console.warn(
                `[Douban Ratings] ${id}:`,
                error
            );

            // Stop issuing new requests if blocked.
            if (/HTTP (403|429)/.test(error.message)) {
                blocked = true;
            }

        } finally {
            activeRequests--;
            processQueue();
        }
    }

    function processQueue() {
        if (blocked) {
            for (const { label } of queue.splice(0)) {
                label.textContent = '豆瓣评分：—';
                label.title = '请求受限';
            }

            return;
        }

        while (
            activeRequests < MAX_CONCURRENT &&
            queue.length > 0
        ) {
            activeRequests++;
            processItem(queue.shift());
        }
    }

    // ========================================
    // 6. Insert ratings into book metadata
    // ========================================

    function addCommunityRatings() {
        if (!isBookList) return;

        const items = document.querySelectorAll(
            'li.subject-item'
        );

        for (const item of items) {
            const link = item.querySelector('.info h2 a');
            const pub = item.querySelector('.info .pub');

            if (!link || !pub) continue;

            // Prevent duplicate labels.
            if (
                item.querySelector('.douban-community-rating')
            ) {
                continue;
            }

            const match = link.href.match(
                /\/subject\/(\d+)\//
            );

            if (!match) continue;

            const id = match[1];

            const label = document.createElement('div');

            label.className = 'douban-community-rating';

            label.style.cssText = `
                display: block;
                font-size: 12px;
                font-weight: normal;
                color: #666;
                line-height: 1.5;
                margin: 2px 0 6px;
                user-select: text !important;
                -webkit-user-select: text !important;
            `;

            label.textContent = '豆瓣评分：加载中…';

            // Insert below publication information,
            // outside the personal rating container.
            pub.insertAdjacentElement('afterend', label);

            const cached = readCache(id);

            if (cached) {
                renderRating(label, cached);
            } else {
                queue.push({ id, label });
            }
        }

        processQueue();
    }

    // ========================================
    // 7. Initialization and dynamic updates
    // ========================================

    function update() {
        convertRatings();
        addCommunityRatings();
    }

    update();

    let updateScheduled = false;

    const observer = new MutationObserver(() => {
        if (updateScheduled) return;

        updateScheduled = true;

        requestAnimationFrame(() => {
            updateScheduled = false;
            update();
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();
