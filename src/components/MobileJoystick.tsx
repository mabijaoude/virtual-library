import { ArrowUp } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { joystickInputFromDelta, type MovementInput } from "../navigation";

const JOYSTICK_RADIUS = 42;
const MOVE_EVENT = "library:mobile-move";

type ThumbPosition = { x: number; y: number };

export default function MobileJoystick() {
  const pointerId = useRef<number | undefined>(undefined);
  const origin = useRef({ x: 0, y: 0 });
  const [thumb, setThumb] = useState<ThumbPosition>({ x: 0, y: 0 });
  const [active, setActive] = useState(false);

  useEffect(() => () => emitMovement({ forward: 0, strafe: 0 }), []);

  const update = (clientX: number, clientY: number) => {
    const deltaX = clientX - origin.current.x;
    const deltaY = clientY - origin.current.y;
    const distance = Math.hypot(deltaX, deltaY);
    const scale = distance > JOYSTICK_RADIUS ? JOYSTICK_RADIUS / distance : 1;
    setThumb({ x: deltaX * scale, y: deltaY * scale });
    emitMovement(joystickInputFromDelta(deltaX, deltaY, JOYSTICK_RADIUS));
  };

  const start = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointerId.current !== undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    pointerId.current = event.pointerId;
    origin.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    event.currentTarget.setPointerCapture(event.pointerId);
    setActive(true);
    update(event.clientX, event.clientY);
  };

  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointerId.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    update(event.clientX, event.clientY);
  };

  const stop = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointerId.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    pointerId.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setThumb({ x: 0, y: 0 });
    setActive(false);
    emitMovement({ forward: 0, strafe: 0 });
  };

  const jump = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    window.dispatchEvent(new Event("library:mobile-jump"));
  };

  return (
    <>
      <button
        className="mobile-joystick"
        type="button"
        aria-label="Move through the library"
        data-active={active || undefined}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={stop}
      >
        <span className="mobile-joystick-ring" aria-hidden="true" />
        <span
          className="mobile-joystick-thumb"
          aria-hidden="true"
          style={{ transform: `translate3d(${thumb.x}px, ${thumb.y}px, 0)` }}
        />
      </button>
      <button className="mobile-jump" type="button" aria-label="Jump" title="Jump" onPointerDown={jump}>
        <ArrowUp aria-hidden="true" />
      </button>
    </>
  );
}

function emitMovement(input: MovementInput) {
  window.dispatchEvent(new CustomEvent<MovementInput>(MOVE_EVENT, { detail: input }));
}
