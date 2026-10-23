// Mobil menü
const toggle = document.querySelector('.nav-toggle');
const nav = document.getElementById('nav');

toggle?.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
});

// Scroll'da header gölgesi
const header = document.getElementById('header');
const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 10);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Görünür olunca beliren bloklar
const revealables = document.querySelectorAll('.card, .value, .stat, .split > *, .info-item');
if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.12 });

    revealables.forEach((el) => {
        el.classList.add('reveal');
        observer.observe(el);
    });
}
