import { useLayoutEffect, useRef } from 'react'

/**
 * A textarea that grows to fit its content.
 *
 * Support messages and drafted replies vary wildly in length; a fixed height
 * either wastes space on short ones or forces scrolling inside a small box on
 * long ones. Growth stops at `maxHeight` so a very long paste cannot push the
 * action buttons off screen.
 *
 * @param {object} props
 * @param {string} props.value
 * @param {number} [props.minHeight] - Starting height in px
 * @param {number} [props.maxHeight] - Height at which the textarea starts scrolling
 */
function AutoTextarea({ value, minHeight = 160, maxHeight = 420, className = '', ...props }) {
  const ref = useRef(null)

  // Layout effect so the resize lands in the same frame as the text change —
  // in a passive effect the box visibly jumps a frame late while typing.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto' // measure content, not the current box
    el.style.height = `${Math.max(minHeight, Math.min(el.scrollHeight, maxHeight))}px`
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [value, minHeight, maxHeight])

  return (
    <textarea
      ref={ref}
      value={value}
      style={{ minHeight }}
      className={`w-full resize-none rounded-xl border border-slate-200 bg-white p-3.5 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 ${className}`}
      {...props}
    />
  )
}

export default AutoTextarea
