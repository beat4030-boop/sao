// ===== 벚꽃 애니메이션 =====
const canvas = document.getElementById('sakura');
if (canvas) {
    const ctx = canvas.getContext('2d');
    let petals = [];
    const PETAL_COUNT = 25;

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    class Petal {
        constructor() { this.reset(true); }
        reset(init = false) {
            this.x = Math.random() * canvas.width;
            this.y = init ? Math.random() * canvas.height : -20;
            this.size = 4 + Math.random() * 8;
            this.speedY = 0.3 + Math.random() * 0.8;
            this.speedX = -0.3 + Math.random() * 0.6;
            this.rotation = Math.random() * Math.PI * 2;
            this.rotSpeed = (Math.random() - 0.5) * 0.03;
            this.opacity = 0.2 + Math.random() * 0.5;
            this.wobble = Math.random() * Math.PI * 2;
            this.wobbleSpeed = 0.01 + Math.random() * 0.02;
        }
        update() {
            this.y += this.speedY;
            this.wobble += this.wobbleSpeed;
            this.x += this.speedX + Math.sin(this.wobble) * 0.3;
            this.rotation += this.rotSpeed;
            if (this.y > canvas.height + 20) this.reset();
        }
        draw() {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.rotation);
            ctx.globalAlpha = this.opacity;
            ctx.beginPath();
            ctx.ellipse(0, 0, this.size, this.size * 0.6, 0, 0, Math.PI * 2);
            ctx.fillStyle = `hsl(${340 + Math.random() * 20}, 70%, ${70 + Math.random() * 15}%)`;
            ctx.fill();
            ctx.restore();
        }
    }

    for (let i = 0; i < PETAL_COUNT; i++) petals.push(new Petal());

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        petals.forEach(p => { p.update(); p.draw(); });
        requestAnimationFrame(animate);
    }
    animate();
}
