const slides = [...document.querySelectorAll('.slide')], prev = document.querySelector('#prev'), next = document.querySelector('#next'), current = document.querySelector('#current'), total = document.querySelector('#total'), progress = document.querySelector('#progress');
let index = 0;
let transitionTimer;

total.textContent = String(slides.length).padStart(2, '0');
progress.setAttribute('aria-valuemax', String(slides.length));
slides.forEach((slide, slideIndex) => slide.dataset.slide = String(slideIndex + 1).padStart(2, '0'));

function show(nextIndex) {
    const direction = nextIndex < index ? 'reverse' : 'forward';
    const previousIndex = index;
    const boundedIndex = Math.max(0, Math.min(slides.length - 1, nextIndex));
    if (boundedIndex === previousIndex && slides[previousIndex].classList.contains('active')) {
        return;
    }
    index = boundedIndex;
    clearTimeout(transitionTimer);
    slides.forEach((slide, slideIndex) => {
        slide.classList.remove('active', 'reverse', 'exiting');
        if (slideIndex === previousIndex) slide.classList.add('exiting');
        if (slideIndex === index) slide.classList.add('active', ...(direction === 'reverse' ? ['reverse'] : []));
    });
    current.textContent = String(index + 1).padStart(2, '0');
    prev.disabled = index === 0;
    next.disabled = index === slides.length - 1;
    progress.style.width = `${(index + 1) / slides.length * 100}%`;
    progress.setAttribute('aria-valuenow', String(index + 1));
    transitionTimer = setTimeout(() => {
        slides.forEach((slide, slideIndex) => {
            if (slideIndex !== index) slide.classList.remove('exiting');
        });
    }, 920);
}

prev.onclick = () => show(index - 1);
next.onclick = () => show(index + 1);
document.addEventListener('keydown', event => {
    if (['ArrowRight', 'PageDown', ' '].includes(event.key)) show(index + 1);
    if (['ArrowLeft', 'PageUp'].includes(event.key)) show(index - 1);
    if (event.key === 'Home') show(0);
    if (event.key === 'End') show(slides.length - 1);
});

let startX = 0;
document.addEventListener('touchstart', event => startX = event.changedTouches[0].screenX);
document.addEventListener('touchend', event => {
    const distance = event.changedTouches[0].screenX - startX;
    if (Math.abs(distance) > 50) show(index + (distance < 0 ? 1 : -1));
});

show(0);
