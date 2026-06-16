// High Performance Dot Cursor & Explosion System (No Rocket)
(function() {
    const container = document.createElement('div');
    container.id = 'custom-cursor-container';
    container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99999;overflow:hidden;';
    document.body.appendChild(container);

    // DOT: White with black outline
    const dot = document.createElement('div');
    dot.id = 'cursor-dot';
    dot.style.cssText = 'position:absolute;width:8px;height:8px;background:#fff;border:2px solid #000;border-radius:50%;transform:translate(-50%,-50%);transition:transform 0.15s ease, background 0.15s ease;box-shadow:0 0 4px rgba(0,0,0,0.5);z-index:100000;';
    container.appendChild(dot);

    const canvas = document.createElement('canvas');
    canvas.id = 'cursor-canvas';
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:999;pointer-events:none;';
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d', { alpha: true });

    let width, height;
    function resize() { width = canvas.width = window.innerWidth; height = canvas.height = window.innerHeight; }
    window.addEventListener('resize', resize);
    resize();

    let mouseX = -100, mouseY = -100;
    const particles = [];
    const MAX_PARTICLES = 200;

    // Use window mousemove to ensure it never gets stuck
    window.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
        dot.style.left = mouseX + 'px';
        dot.style.top = mouseY + 'px';
    });

    const isClickable = (el) => {
        if (!el) return false;
        const tag = el.tagName;
        if (['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL'].includes(tag)) return true;
        if (el.classList && (el.classList.contains('btn') || el.classList.contains('tab') || el.classList.contains('file-item') || el.classList.contains('plugin-item') || el.classList.contains('browser-item') || el.id === 'theme-toggle' || el.id === 'btn-run-selected')) return true;
        return false;
    };

    document.addEventListener('mouseover', (e) => {
        if (isClickable(e.target)) {
            dot.style.transform = 'translate(-50%, -50%) scale(2)';
            dot.style.background = '#fff';
            dot.style.borderColor = '#000';
        } else {
            dot.style.transform = 'translate(-50%, -50%) scale(1)';
            dot.style.background = '#fff';
            dot.style.borderColor = '#000';
        }
    });

    function explode(x, y) {
        for (let i = 0; i < 60; i++) {
            if (particles.length < MAX_PARTICLES) {
                const angle = Math.random() * Math.PI * 2;
                const speed = Math.random() * 8 + 2;
                particles.push({ x: x, y: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1.0, decay: Math.random() * 0.02 + 0.015, color: `hsl(${Math.random() * 50 + 10}, 100%, 50%)`, size: Math.random() * 4 + 2 });
            }
        }
    }

    // Track if explosion already happened for this run click
    let hasExplodedForRun = false;
    
    document.addEventListener('click', (e) => {
        // Only explode for run button, and only once per click cycle
        if (e.target.id === 'btn-run-selected' && !hasExplodedForRun) {
            hasExplodedForRun = true;
            explode(e.clientX, e.clientY);
            // Reset after a short delay to allow next run click
            setTimeout(() => { hasExplodedForRun = false; }, 200);
        }
    });

    function animate() {
        ctx.clearRect(0, 0, width, height);
        
        // Update and draw particles only (no rocket)
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.vx *= 0.98; p.life -= p.decay;
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            ctx.fill();
            if (p.life <= 0) particles.splice(i, 1);
        }
        ctx.globalAlpha = 1.0;
        requestAnimationFrame(animate);
    }
    animate();
})();