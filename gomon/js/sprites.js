// Buddy walk scene: a little parallax diorama on <canvas> where your buddy
// monster bobs along as you actually walk. Sprite images are drawn with
// pixelated scaling to keep the retro look.
export function createWalkScene(canvas) {
    const ctx = canvas.getContext("2d");
    let buddy = null;
    let buddyUrl = null;
    let walking = false;
    let scroll = 0;
    let raf = 0;
    let disposed = false;
    let last = performance.now();
    function setBuddy(jpeg) {
        if (buddyUrl)
            URL.revokeObjectURL(buddyUrl);
        buddyUrl = null;
        buddy = null;
        if (!jpeg)
            return;
        const url = URL.createObjectURL(new Blob([jpeg], { type: "image/jpeg" }));
        const img = new Image();
        img.onload = () => {
            buddy = img;
            buddyUrl = url;
        };
        img.src = url;
    }
    function frame(now) {
        if (disposed)
            return;
        const dt = Math.min(100, now - last) / 1000;
        last = now;
        if (walking)
            scroll += dt * 60;
        const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
        const h = (canvas.height = canvas.clientHeight * devicePixelRatio);
        if (!ctx || w === 0) {
            raf = requestAnimationFrame(frame);
            return;
        }
        ctx.imageSmoothingEnabled = false;
        // sky
        const sky = ctx.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, "#28304e");
        sky.addColorStop(0.7, "#4b4470");
        sky.addColorStop(1, "#7a5b6e");
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h);
        // stars
        ctx.fillStyle = "rgba(255,255,255,.5)";
        for (let i = 0; i < 24; i++) {
            const sx = ((i * 97 + 31) % 199) / 199;
            const sy = ((i * 53 + 11) % 97) / 97;
            ctx.fillRect(sx * w, sy * h * 0.45, 2 * devicePixelRatio, 2 * devicePixelRatio);
        }
        // far hills (slow parallax)
        ctx.fillStyle = "#39355c";
        drawHills(ctx, w, h, h * 0.62, 90 * devicePixelRatio, scroll * 0.25 * devicePixelRatio);
        // near hills
        ctx.fillStyle = "#2e2a4d";
        drawHills(ctx, w, h, h * 0.72, 55 * devicePixelRatio, scroll * 0.5 * devicePixelRatio);
        // ground
        const groundY = h * 0.8;
        ctx.fillStyle = "#243b2f";
        ctx.fillRect(0, groundY, w, h - groundY);
        ctx.fillStyle = "#2f4d3b";
        const dashW = 26 * devicePixelRatio;
        const off = (scroll * devicePixelRatio) % (dashW * 2);
        for (let x = -off; x < w; x += dashW * 2) {
            ctx.fillRect(x, groundY + (h - groundY) * 0.45, dashW, 5 * devicePixelRatio);
        }
        // buddy
        const bob = Math.sin(now / (walking ? 160 : 420)) * (walking ? 7 : 3) * devicePixelRatio;
        const size = Math.min(w, h) * 0.38;
        const bx = w * 0.5 - size / 2;
        const by = groundY - size + bob + 6 * devicePixelRatio;
        if (buddy) {
            // soft shadow
            ctx.fillStyle = "rgba(0,0,0,.35)";
            ctx.beginPath();
            ctx.ellipse(w * 0.5, groundY + 8 * devicePixelRatio, size * 0.32, size * 0.08, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.drawImage(buddy, bx, by, size, size);
        }
        else {
            // empty slot: a monball waiting for a buddy
            drawBall(ctx, w * 0.5, groundY - size * 0.3 + bob, size * 0.22);
        }
        raf = requestAnimationFrame(frame);
    }
    function drawHills(c, w, h, baseY, amp, offset) {
        c.beginPath();
        c.moveTo(0, h);
        const step = 8 * devicePixelRatio;
        for (let x = 0; x <= w; x += step) {
            const t = (x + offset) / (120 * devicePixelRatio);
            c.lineTo(x, baseY - Math.abs(Math.sin(t)) * amp);
        }
        c.lineTo(w, h);
        c.closePath();
        c.fill();
    }
    function drawBall(c, x, y, r) {
        c.save();
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.clip();
        c.fillStyle = "#e5484d";
        c.fillRect(x - r, y - r, r * 2, r);
        c.fillStyle = "#f5f2eb";
        c.fillRect(x - r, y, r * 2, r);
        c.fillStyle = "#232323";
        c.fillRect(x - r, y - r * 0.12, r * 2, r * 0.24);
        c.beginPath();
        c.arc(x, y, r * 0.28, 0, Math.PI * 2);
        c.fillStyle = "#232323";
        c.fill();
        c.beginPath();
        c.arc(x, y, r * 0.16, 0, Math.PI * 2);
        c.fillStyle = "#f5f2eb";
        c.fill();
        c.restore();
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.lineWidth = Math.max(2, r * 0.09);
        c.strokeStyle = "#232323";
        c.stroke();
    }
    raf = requestAnimationFrame(frame);
    return {
        setBuddy,
        setWalking: (v) => (walking = v),
        dispose: () => {
            disposed = true;
            cancelAnimationFrame(raf);
            if (buddyUrl)
                URL.revokeObjectURL(buddyUrl);
        },
    };
}
