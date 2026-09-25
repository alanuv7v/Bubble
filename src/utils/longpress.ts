let longpress_timer;

export function on_down (e: MouseEvent | TouchEvent | PointerEvent, callback: Function, duration = 500) {
  longpress_timer = window.setTimeout(() => {
    callback();
  }, duration); // Duration in milliseconds
};

export function on_up () {
  window.clearTimeout(longpress_timer);
};

export function make (el: HTMLElement, callback: Function, duration = 500) {

  el.addEventListener("mousedown", (e) => on_down(e, callback, duration))
  el.addEventListener("mouseup", on_up)
  el.addEventListener("mouseleave", on_up)
  
  el.addEventListener("touchstart", (e) => on_down(e, callback, duration),{ passive: true })
  el.addEventListener("touchend", on_up)
  el.addEventListener("touchmove", on_up)
}

export default {
  on_down,
  on_up,
  make
}