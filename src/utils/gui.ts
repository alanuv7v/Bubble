import is_true_object from "./is_true_object.ts"

const 
  q = (query: string): any => document.querySelector(query),
  
  qa = (query: string): any => document.querySelectorAll(query),
  
  qf = (el: HTMLElement, query: string): any => el.querySelector(query),

  cr = <T extends keyof HTMLElementTagNameMap>(
    tag: T | string,
    inner?:
      | string
      | Partial<HTMLElementTagNameMap[T]>
      | Partial<HTMLElement>
      | Node,
    ...others: (Node|undefined)[]
  ): any => {
    let res = document.createElement(tag || "div");
    if (typeof inner === "string") res.innerHTML = inner;
    else if (inner instanceof Node) res.append(inner);
    else if (is_true_object(inner)) {
      res = Object.assign(res, inner);
    }
    if (others) {
      res.append(...others.filter((o) => !!o));
    }
    return res;
  }

const sleep_c = q("sleep-c") as HTMLDivElement
const load = (name: string) => sleep_c.querySelector(name);

[q, qa, qf, cr].forEach((f) => (window[f.name] = f));

export { q, qa, qf, cr, load };
