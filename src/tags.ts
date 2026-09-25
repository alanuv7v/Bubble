import is_true_object from "./utils/is_true_object"
import proxify from "./utils/proxify"

export default proxify(
  {},
  <T extends keyof HTMLElementTagNameMap>(key: T, value) => {
    let key_ = key.replaceAll("_", "-") // support customElement
    return (
      inner?:
        | string
        | Partial<HTMLElementTagNameMap[T]>
        | Partial<HTMLElement>
        | Node,
      ...others: (Node|undefined)[]
    ) => {
      let res = document.createElement(key_)
      if (typeof inner === "string") res.innerHTML = inner;
      else if (inner instanceof Node) res.append(inner);
      else if (is_true_object(inner)) {
        res = Object.assign(res, inner);
      }
      if (others) {
        res.append(...others.filter((o) => !!o));
      }
      return res
    }
  },
  () => {}
) as ReturnType<<T extends keyof HTMLElementTagNameMap>() => Record<
  string,
  (
    inner?:
      | string
      | Partial<HTMLElementTagNameMap[T]>
      | Partial<HTMLElement>
      | Node,
    ...others: (Node | undefined)[]
  ) => HTMLElement
>>