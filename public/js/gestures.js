// Touch gestures: swipe a diary row left to delete it, swipe the day header to change
// days, and drag a sheet's title bar down to close it.

function track(el, { onMove, onEnd, axis = 'x' }) {
  let sx, sy, dx, dy, active, decided;
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    dx = dy = 0;
    active = true;
    decided = false;
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (!active) return;
    dx = e.touches[0].clientX - sx;
    dy = e.touches[0].clientY - sy;
    if (!decided) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      decided = true;
      const horizontal = Math.abs(dx) > Math.abs(dy) * 1.2;
      if ((axis === 'x') !== horizontal) { active = false; return; }
    }
    if (e.cancelable) e.preventDefault();
    onMove(dx, dy);
  }, { passive: false });
  const end = () => {
    if (!active) return;
    active = false;
    if (decided) onEnd(dx, dy);
  };
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', () => { if (active && decided) onEnd(0, 0); active = false; });
}

// Swallow the click that follows a drag so it doesn't open the row.
function blockNextClick(el) {
  const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
  el.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => el.removeEventListener('click', stop, { capture: true }), 400);
}

export function swipeToDelete(root, onDelete) {
  root.querySelectorAll('.swipe').forEach((wrap) => {
    const row = wrap.querySelector('.row');
    const bg = wrap.querySelector('.swipe-bg');
    track(wrap, {
      onMove: (dx) => {
        const x = Math.min(0, dx);
        wrap.classList.add('dragging');
        row.style.transform = `translateX(${x}px)`;
        bg.style.opacity = Math.min(1, -x / 80);
      },
      onEnd: (dx) => {
        wrap.classList.remove('dragging');
        blockNextClick(wrap);
        row.classList.add('settle');
        if (dx < -110) {
          row.style.transform = 'translateX(-100%)';
          setTimeout(() => onDelete(row.dataset.id), 200);
        } else {
          row.style.transform = '';
          bg.style.opacity = 0;
        }
      },
    });
  });
}

export function swipeDays(el, { prev, next }) {
  track(el, {
    onMove: (dx) => { el.style.transform = `translateX(${dx * 0.35}px)`; },
    onEnd: (dx) => {
      el.style.transform = '';
      if (dx > 70) prev();
      else if (dx < -70) next();
    },
  });
}

export function dragToClose(sheet, handle, close) {
  track(handle, {
    axis: 'y',
    onMove: (_, dy) => {
      sheet.style.transition = 'none';
      sheet.style.transform = `translateY(${Math.max(0, dy)}px)`;
    },
    onEnd: (_, dy) => {
      sheet.style.transition = '';
      sheet.style.transform = '';
      if (dy > 120) close();
    },
  });
}
