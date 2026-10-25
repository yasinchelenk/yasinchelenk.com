// Mobil menü
const toggle = document.querySelector('.nav-toggle');
const nav = document.getElementById('nav');

const setMenu = (open) => {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
};
toggle?.addEventListener('click', () => setMenu(!nav.classList.contains('is-open')));
nav?.querySelectorAll('a[href*="#"]').forEach((a) => a.addEventListener('click', () => setMenu(false)));

// Scroll'da header gölgesi
const header = document.getElementById('header');
const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 10);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

if ('IntersectionObserver' in window) {
    // Görünür olunca beliren bloklar
    const revealables = document.querySelectorAll('.stat, .split > *, .entry, .vessel, .duty, .edu, .skill, .card, .info-item, .form');
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

    // Ekrandaki bölümün menü bağlantısını vurgula
    const links = new Map([...nav.querySelectorAll('a[href*="#"]')].map((a) => [a.hash.slice(1), a]));
    const spy = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                links.forEach((a, id) => a.classList.toggle('is-active', id === entry.target.id));
            }
        });
    }, { rootMargin: '-45% 0px -50% 0px' });

    document.querySelectorAll('main section[id]').forEach((section) => spy.observe(section));
}
