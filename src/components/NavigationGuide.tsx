import { CircleHelp, X } from "lucide-react";
import type { SceneMode } from "../types";

type NavigationGuideProps = {
  mode: SceneMode;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
};

export default function NavigationGuide({ mode, expanded, onExpandedChange }: NavigationGuideProps) {
  if (!expanded) {
    return (
      <aside className="navigation-guide collapsed" aria-label="Navigation controls">
        <button
          className="navigation-guide-toggle"
          type="button"
          title="Show navigation controls"
          aria-label="Show navigation controls"
          onClick={() => onExpandedChange(true)}
        >
          <CircleHelp size={20} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="navigation-guide expanded" aria-label="Navigation controls">
      <header>
        <div>
          <span>{mode === "immersive" ? "Immersive navigation" : "Explore this world"}</span>
          <strong>Movement controls</strong>
        </div>
        <button type="button" title="Hide navigation controls" aria-label="Hide navigation controls" onClick={() => onExpandedChange(false)}>
          <X size={17} />
        </button>
      </header>

      <div className="navigation-control-list desktop-controls">
        <span><kbd>{mode === "immersive" ? "Mouse" : "Drag"}</kbd> look</span>
        <span><kbd>WASD</kbd> or arrows walk</span>
        <span><kbd>Shift</kbd> sprint</span>
        <span><kbd>Ctrl</kbd> crouch</span>
        <span><kbd>Space</kbd> jump</span>
        <span><kbd>{mode === "immersive" ? "E" : "Click"}</kbd> inspect a book</span>
        {mode === "immersive" && <span><kbd>Esc</kbd> exit</span>}
      </div>

      <div className="navigation-control-list touch-controls">
        <span><kbd>Drag</kbd> look</span>
        <span><kbd>Pad</kbd> walk</span>
        <span><kbd>Jump</kbd> jump</span>
        <span><kbd>Tap</kbd> inspect a book</span>
      </div>
    </aside>
  );
}
