// Navigation button handler for signals_responsible.html
(function () {
    'use strict';

    function initNavigation() {
        const navButtons = document.querySelectorAll('.nav-btn');

        if (navButtons.length === 0) {
            console.warn('No navigation buttons found');
            return;
        }

        console.log(`Found ${navButtons.length} navigation buttons`);

        navButtons.forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();

                const navTarget = this.dataset.nav;
                console.log('Navigation button clicked:', navTarget);

                // Get responsibleId from multiple sources
                const params = new URLSearchParams(window.location.search);
                const responsibleId = params.get('responsibleId') ||
                    params.get('responsible_id') ||
                    params.get('id') ||
                    localStorage.getItem('signals.responsibleId');

                if (!responsibleId) {
                    console.error('No responsibleId found');
                    alert('معرف المسؤول مفقود');
                    return;
                }

                // Update active state
                navButtons.forEach(b => b.classList.remove('active'));
                this.classList.add('active');

                // Navigate based on target
                if (navTarget === 'signals') {
                    // Already on signals page, just reload to ensure clean state
                    console.log('Already on signals page');
                } else if (navTarget === 'settings') {
                    console.log('Navigating to settings page');
                    window.location.href = `parametres.html?responsibleId=${responsibleId}`;
                } else if (navTarget === 'statistics') {
                    console.log('Navigating to statistics page');
                    window.location.href = `signals_statistique.html?responsibleId=${responsibleId}`;
                }
            });
        });

        console.log('Navigation buttons initialized successfully');
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initNavigation);
    } else {
        // DOM is already ready
        initNavigation();
    }
})();
