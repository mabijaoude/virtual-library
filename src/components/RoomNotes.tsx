import { useRef } from "react";
import { X } from "lucide-react";
import type { WorldDefinition, WorldId } from "../worlds/types";
import { useDialogFocus } from "./useDialogFocus";

const NOTES: Record<WorldId, string> = {
  modern: "Follow the cobalt floor inlay past the central reading island. The daylight armillary traces slow orbits above its engraved dial; moving along the window reveals the layers of the garden.",
  heritage: "The fireplace gathers the room around one shared reading table. Look up at the oak gallery, then follow the warm light back to the green chairs and the small pools of lamplight.",
  gothic: "The rose window is the visual anchor of the nave. Walk down the open center to see the stone rhythm change, with cooler window light above and warmer candles close to the shelves.",
  renaissance: "Beyond the marble opening, a stone terrace and cypress garden lead toward the distant hills. Approach from either arcade to watch the view open up, then look between the shelves for small studies in bronze, laurel and inlaid stone.",
  deco: "The octagon repeats in the floor, ceiling, and central index. Follow the brass lines past the emerald seating, then look up at the warm perimeter cove and back toward the stepped entrance.",
  foundry: "Trace the copper floor circuits toward the aether machinery. Twin copper relay chambers flank the shutter. Follow their slowly travelling cyan and magenta signals through the machined rings, then look back toward the rotating index.",
  lunar: "Follow the clear route to the Earthwatch window. The long crater shadows and black sky give the habitat its scale; the warm task lights keep the reading area distinct from that exterior.",
  arkship: "The starboard promenade opens beside the protected archive stacks. Follow the observation glass to see the hull and passing planet; the passenger almanac shares journey progress, habitat conditions and life aboard.",
  alexandria: "Papyrus scrolls replace book spines in this room. Follow the colonnade toward the harbor, or select the Antikythera exhibit to investigate its mechanism and the sources behind the display."
};

export default function RoomNotes({ world, motionPaused, onMotionChange, onClose }: {
  world: WorldDefinition;
  motionPaused: boolean;
  onMotionChange: (paused: boolean) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useDialogFocus(ref, '[title="Display settings"]');
  return <div className="room-notes-layer">
    <section ref={ref} className="room-notes" role="dialog" aria-modal="true" aria-labelledby="room-notes-title" tabIndex={-1}>
      <button className="icon-button compact" type="button" title="Close room notes" onClick={onClose}><X size={18} /></button>
      <span>{world.label}</span>
      <h1 id="room-notes-title">{world.landmark}</h1>
      <p>{NOTES[world.id]}</p>
      <div>
        <button type="button" aria-pressed={motionPaused} onClick={() => onMotionChange(!motionPaused)}>{motionPaused ? "Resume room motion" : "Pause to study the details"}</button>
        <button type="button" onClick={onClose}>Return to the room</button>
      </div>
    </section>
  </div>;
}
