// frontend/assets/js/loadHeader.js
async function loadHeader(titleKey, subtitleKey, defaultTitle, defaultSubtitle) {
    const headerPlaceholder = document.getElementById('app-header-placeholder');
    if (!headerPlaceholder) {
        console.error('Header placeholder #app-header-placeholder not found.');
        return;
    }

    try {
        const response = await fetch('../components/header.html');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const headerHtml = await response.text();
        headerPlaceholder.innerHTML = headerHtml;

        // Apply dynamic content and translations
        const titleElement = document.getElementById('page-header-title');
        const subtitleElement = document.getElementById('page-header-subtitle');

        if (titleElement) {
            if (typeof window.translate === 'function' && titleKey) {
                titleElement.dataset.translate = titleKey;
            } else {
                titleElement.textContent = defaultTitle || '';
            }
        }
        if (subtitleElement) {
            if (typeof window.translate === 'function' && subtitleKey) {
                subtitleElement.dataset.translate = subtitleKey;
            } else {
                subtitleElement.textContent = defaultSubtitle || '';
            }
        }

        // Initialize language selector logic (assuming translations.js is loaded)
        const languageSelector = document.getElementById('languageSelector');
        if (languageSelector && typeof window.setLanguage === 'function') {
            const savedLanguage = localStorage.getItem('language') || localStorage.getItem('lang') || 'ar';
            languageSelector.value = savedLanguage;
            languageSelector.addEventListener('change', function(event) {
                window.setLanguage(event.target.value);
            });
        } else if (languageSelector) {
            console.warn('Language selector found but setLanguage function not available.');
        }

        // Ensure translations are applied after header content is loaded
        if (typeof updatePageTranslations === 'function') {
            updatePageTranslations();
        } else {
            console.warn('updatePageTranslations is not defined. Translations might not be applied.');
        }

    } catch (error) {
        console.error('Failed to load header:', error);
    }
}
