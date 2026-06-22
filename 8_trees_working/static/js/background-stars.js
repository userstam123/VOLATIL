document.addEventListener('DOMContentLoaded', () => {
    // Create container for stars and rocket
    const container = document.createElement('div');
    container.className = 'bg-animation-container';
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.left = '0';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.zIndex = '-1';
    container.style.overflow = 'hidden';
    container.style.pointerEvents = 'none';

    // Generate tons of stars dynamically
    function generateStars() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        let s1 = [], s2 = [], s3 = [];
        
        // Small stars (dense)
        for(let i=0; i<800; i++) s1.push(`${Math.random()*w}px ${Math.random()*h}px #FFF`);
        // Medium stars
        for(let i=0; i<400; i++) s2.push(`${Math.random()*w}px ${Math.random()*h}px #FFF`);
        // Large stars
        for(let i=0; i<100; i++) s3.push(`${Math.random()*w}px ${Math.random()*h}px #FFF`);

        const css = `
            #stars { box-shadow: ${s1.join(',')}; }
            #stars:after { box-shadow: ${s1.join(',')}; }
            #stars2 { box-shadow: ${s2.join(',')}; }
            #stars2:after { box-shadow: ${s2.join(',')}; }
            #stars3 { box-shadow: ${s3.join(',')}; }
            #stars3:after { box-shadow: ${s3.join(',')}; }
        `;
        
        let styleEl = document.getElementById('dynamic-stars-style');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'dynamic-stars-style';
            document.head.appendChild(styleEl);
        }
        styleEl.innerHTML = css;
    }
    
    generateStars();
    window.addEventListener('resize', generateStars);

    // Rocket HTML
    const rocketHTML = `
        <div class="rocket-wrapper" id="bg-rocket">
            <div class="rocket-ship">
                <img src="https://www.micelistudios.com/svg/rocket-144x64.svg" alt="Rocket">
            </div>
            <div class="rocket-fire" id="rocket-fire">
                <svg viewBox="0 0 65 105" width="60" height="120" preserveAspectRatio="none">
                    <polygon class="fire" points="27.8,0.4 31.6,103.5 35.6,0.4"/>
                    <path class="fire" d="M7.4,0.4c0,0-1.1,66.6-1.1,65.8s6.5-65.8,6.5-65.8H7.4z"/>
                    <polygon class="fire" points="19.4,0.4 20.8,32 23.3,0.4"/>
                    <path class="fire" d="M57.7,0.4c0,0,1.1,66.6,1.1,65.8S52.3,0.4,52.3,0.4H57.7z"/>
                    <polygon class="fire" points="45.6,0.4 44.2,32 41.7,0.4"/>
                </svg>
            </div>
        </div>
    `;

    container.innerHTML = rocketHTML;
    document.body.appendChild(container);

    // Theme toggle rocket animation handler - FIXED to always reset properly
    const themeToggleBtn = document.getElementById('theme-toggle');
    const rocket = document.getElementById('bg-rocket');
    let rocketTimer = null;

    if (themeToggleBtn && rocket) {
        themeToggleBtn.addEventListener('click', () => {
            // Clear any existing timer
            if (rocketTimer) clearTimeout(rocketTimer);
            
            const isLight = document.body.classList.contains('light-mode');
            
            // ALWAYS force a complete reset first by removing all classes and forcing reflow
            rocket.classList.remove('flying', 'instantly-below', 'reset-state');
            
            // Force reflow to ensure the browser registers the reset
            void rocket.offsetHeight;
            
            if (isLight) {
                // Flying up and away (switching to light mode)
                rocket.classList.add('flying');
                rocketTimer = setTimeout(() => {
                    rocket.classList.remove('flying');
                }, 1600);
            } else {
                // Flying in from below (switching to dark mode)
                // 1. Add reset class to position instantly below without transition
                rocket.classList.add('reset-state');
                
                // Force another reflow after setting reset state
                void rocket.offsetHeight;
                
                // 2. Now add flying and remove reset to animate in
                rocket.classList.remove('reset-state');
                rocket.classList.add('instantly-below');
                rocket.classList.add('flying');
                
                // Force reflow
                void rocket.offsetHeight;
                
                // 3. Remove instantly-below to trigger the fly-in animation
                rocket.classList.remove('instantly-below');
                
                // 4. Clean up after animation completes
                rocketTimer = setTimeout(() => {
                    rocket.classList.remove('flying');
                }, 1800);
            }
        });
    }
});