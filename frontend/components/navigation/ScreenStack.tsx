"use client";

// Client-side screen stack with iOS-style push navigation: a pushed screen
// slides in from the right and covers the current one, which parks slightly
// to the left and dims. Pop (back button, Escape, or a swipe starting at
// the right edge) reverses the motion. A component stack - not routed
// pages - so the home screen keeps its state while covered, and tomorrow
// the voice backend can drive navigation by pushing plain descriptors.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { ScreenDescriptor } from "@/lib/screens";

const TRANSITION_MS = 320;
// Fraction of the stack width the covered screen parks to the left, and
// how much it dims - mirrors the native push parallax.
const PARALLAX = 0.28;
const DIM_OPACITY = 0.22;
// Swipe-back tuning: gesture must start this close to the right edge,
// travel this far before it claims the pointer, and pass this fraction of
// the width on release to commit the pop.
const EDGE_ZONE_PX = 32;
const DRAG_CLAIM_PX = 12;
const COMMIT_FRACTION = 0.3;

type Phase = "entering" | "active" | "exiting";
type StackEntry = { key: number; descriptor: ScreenDescriptor; phase: Phase };

// Key used for the always-mounted home layer.
const HOME_KEY = -1;

type NavApi = {
  push: (descriptor: ScreenDescriptor) => void;
  pop: () => void;
  popAll: () => void;
  // Descriptors of the screens currently on the stack (bottom to top,
  // excluding home). Lets voice-driven navigation reuse the same push/pop
  // transitions without blindly duplicating screens already showing.
  stack: ScreenDescriptor[];
};

const NavContext = createContext<NavApi | null>(null);

export function useNav(): NavApi {
  const nav = useContext(NavContext);
  if (!nav) throw new Error("useNav must be used inside <ScreenStack>");
  return nav;
}

export function ScreenStack({
  home,
  renderScreen,
  overlay,
}: {
  home: ReactNode;
  renderScreen: (descriptor: ScreenDescriptor) => ReactNode;
  // Rendered above every screen layer, inside the nav context - used for
  // the voice response cards and confirmation prompts that must stay
  // visible across pushes and pops.
  overlay?: ReactNode;
}) {
  const [entries, setEntries] = useState<StackEntry[]>([]);
  // Horizontal offset (px) of the top screen while a swipe-back is in
  // progress, plus the stack width the offset is measured against; null
  // when not dragging.
  const [drag, setDrag] = useState<{ x: number; width: number } | null>(null);

  const nextKey = useRef(1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const layerRefs = useRef(new Map<number, HTMLDivElement>());
  const removalTimeouts = useRef<ReturnType<typeof setTimeout>[]>([]);
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    width: number;
    claimed: boolean;
  } | null>(null);

  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    const timeouts = removalTimeouts.current;
    return () => timeouts.forEach(clearTimeout);
  }, []);

  const push = useCallback((descriptor: ScreenDescriptor) => {
    const key = nextKey.current++;
    setEntries((es) => [...es, { key, descriptor, phase: "entering" }]);
    // Two frames so the browser paints the off-screen position first and
    // the move to translateX(0) actually transitions.
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        setEntries((es) => es.map((e) => (e.key === key ? { ...e, phase: "active" } : e))),
      ),
    );
  }, []);

  const pop = useCallback(() => {
    const top = [...entriesRef.current].reverse().find((e) => e.phase !== "exiting");
    if (!top) return;
    setDrag(null);
    setEntries((es) => es.map((e) => (e.key === top.key ? { ...e, phase: "exiting" } : e)));
    removalTimeouts.current.push(
      setTimeout(
        () => setEntries((es) => es.filter((e) => e.key !== top.key)),
        TRANSITION_MS + 40,
      ),
    );
  }, []);

  const popAll = useCallback(() => {
    const active = entriesRef.current.filter((e) => e.phase !== "exiting");
    if (active.length === 0) return;
    setDrag(null);
    const keys = new Set(active.map((e) => e.key));
    setEntries((es) => es.map((e) => (keys.has(e.key) ? { ...e, phase: "exiting" } : e)));
    removalTimeouts.current.push(
      setTimeout(
        () => setEntries((es) => es.filter((e) => !keys.has(e.key))),
        TRANSITION_MS + 40,
      ),
    );
  }, []);

  const activeEntries = entries.filter((e) => e.phase !== "exiting");
  const stack = useMemo(
    () => activeEntries.map((e) => e.descriptor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries],
  );
  const nav = useMemo<NavApi>(() => ({ push, pop, popAll, stack }), [push, pop, popAll, stack]);
  const topEntry = activeEntries[activeEntries.length - 1] ?? null;
  const topKey = topEntry ? topEntry.key : HOME_KEY;
  const underKey =
    activeEntries.length >= 2
      ? activeEntries[activeEntries.length - 2].key
      : activeEntries.length === 1
        ? HOME_KEY
        : null;

  // Keep the pointer stream alive during an edge swipe: without a
  // non-passive preventDefault on touchmove, the browser reinterprets the
  // horizontal drag as a scroll attempt and fires pointercancel mid-gesture
  // (React's synthetic touch handlers are passive, so this needs a native
  // listener).
  useEffect(() => {
    if (topKey === HOME_KEY) return;
    const el = layerRefs.current.get(topKey);
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (dragState.current) e.preventDefault();
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, [topKey]);

  // Move focus to the newly revealed screen after a push or pop, but not
  // on the initial mount.
  const prevTopKey = useRef<number | null>(null);
  useEffect(() => {
    if (prevTopKey.current !== null && prevTopKey.current !== topKey) {
      layerRefs.current.get(topKey)?.focus({ preventScroll: true });
    }
    prevTopKey.current = topKey;
  }, [topKey]);

  const dragging = drag !== null;
  const dragProgress = drag ? Math.min(drag.x / drag.width, 1) : 0;

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.right - e.clientX > EDGE_ZONE_PX) return;
    dragState.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      width: rect.width,
      claimed: false,
    };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragState.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = d.startX - e.clientX; // leftward drag from the right edge
    const dy = Math.abs(e.clientY - d.startY);
    if (!d.claimed) {
      // Don't steal the pointer from taps or vertical scrolling: claim it
      // only once the move is clearly horizontal and away from the edge.
      if (dx > DRAG_CLAIM_PX && dx > dy) {
        d.claimed = true;
        e.currentTarget.setPointerCapture(d.pointerId);
      } else if (dy > DRAG_CLAIM_PX || dx < -DRAG_CLAIM_PX) {
        dragState.current = null;
        return;
      } else {
        return;
      }
    }
    // The screen mirrors the drag: it exits toward the right as the finger
    // travels left from the edge.
    setDrag({ x: Math.max(0, Math.min(dx, d.width)), width: d.width });
  }

  function onPointerEnd(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragState.current;
    if (!d || e.pointerId !== d.pointerId) return;
    dragState.current = null;
    if (!d.claimed) return;
    if ((drag?.x ?? 0) / d.width > COMMIT_FRACTION) pop();
    else setDrag(null);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && topKey !== HOME_KEY) {
      e.stopPropagation();
      pop();
    }
  }

  function layerStyle(key: number, phase: Phase): CSSProperties {
    if (phase === "entering" || phase === "exiting") {
      return { transform: "translateX(100%)" };
    }
    if (key === topKey) {
      return drag
        ? { transform: `translateX(${drag.x}px)`, transition: "none" }
        : { transform: "translateX(0)" };
    }
    // Covered layer: parked left. While the top screen is being dragged
    // back, the layer directly beneath follows the finger back to center.
    if (key === underKey && drag) {
      return {
        transform: `translateX(${-PARALLAX * (1 - dragProgress) * drag.width}px)`,
        transition: "none",
      };
    }
    return { transform: `translateX(-${PARALLAX * 100}%)` };
  }

  function dimStyle(key: number, phase: Phase): CSSProperties {
    const covered = phase === "active" && key !== topKey;
    if (covered && key === underKey && dragging) {
      return { opacity: DIM_OPACITY * (1 - dragProgress), transition: "none" };
    }
    return { opacity: covered ? DIM_OPACITY : 0 };
  }

  function renderLayer(key: number, phase: Phase, content: ReactNode) {
    const isTop = key === topKey;
    const swipeHandlers =
      isTop && key !== HOME_KEY
        ? {
            onPointerDown,
            onPointerMove,
            onPointerUp: onPointerEnd,
            onPointerCancel: onPointerEnd,
          }
        : {};
    return (
      <div
        key={key}
        ref={(el) => {
          if (el) layerRefs.current.set(key, el);
          else layerRefs.current.delete(key);
        }}
        tabIndex={-1}
        inert={!isTop}
        className="screen-layer absolute inset-0 touch-pan-y outline-none"
        style={layerStyle(key, phase)}
        {...swipeHandlers}
      >
        {content}
        <div
          className="screen-dim pointer-events-none absolute inset-0 bg-black"
          style={dimStyle(key, phase)}
          aria-hidden="true"
        />
      </div>
    );
  }

  return (
    <NavContext.Provider value={nav}>
      <div
        ref={containerRef}
        className="relative h-full w-full overflow-hidden bg-ink"
        onKeyDown={onKeyDown}
      >
        {renderLayer(HOME_KEY, "active", home)}
        {entries.map((e) => renderLayer(e.key, e.phase, renderScreen(e.descriptor)))}
        {overlay}
      </div>
    </NavContext.Provider>
  );
}
