import { useLayoutEffect, useRef } from "react";

type Props = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

/** A textarea that grows to fit its content — no inner scrollbar, no fixed
 *  height. Re-fits whenever the controlled `value` changes (mount + each edit)
 *  and when the window resizes (width change reflows the text).
 *
 *  scrollHeight excludes the border, but the box is `border-box`, so we add the
 *  border back (`offsetHeight - clientHeight`) to avoid clipping the last line. */
export function AutoTextarea({ value, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [value]);

  return <textarea ref={ref} value={value} {...rest} />;
}
