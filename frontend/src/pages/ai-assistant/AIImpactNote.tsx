import { FiCrosshair, FiLayers, FiUsers } from "react-icons/fi";
import type { ConfigImpact } from "../../api/ai";

// The model's impact analysis, rendered in the chat bubble under its explanation.
//
// WHY THIS COMPONENT EXISTS
// The impact analysis used to be three bullets the model wrote at the end of its explanation, so it
// rendered for free as part of the answer text. It is now three fields on the tool call
// (ConfigImpact), which is far more reliable to read — see the note in api/ai.ts — but it also
// means nothing shows it unless something draws it. Without this the chat would have quietly
// stopped telling the reader which subnets a proposal touches, which is the single thing most worth
// knowing before pressing Apply.
//
// Labelled rather than bulleted: the three fields answer three different questions, and the labels
// are what let the reader skip to the one they care about. Each field is a role, not a colour — the
// icons carry the distinction and the text stays in the normal ink ramp.
const Row = ({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) => (
  <li className="flex gap-1.5 text-[11.5px] leading-relaxed ink-3">
    <span className="mt-[3px] shrink-0 opacity-70">{icon}</span>
    <span className="min-w-0">
      <span className="t-label mr-1 ink-4">{label}</span>
      {children}
    </span>
  </li>
);

export const AIImpactNote = ({ impact }: { impact: ConfigImpact }) => {
  const subnets = (impact.subnets ?? []).map((s) => s.trim()).filter(Boolean);
  const affected = (impact.affected ?? []).map((s) => s.trim()).filter(Boolean);
  const placement = (impact.placement ?? "").trim();
  // "-" is what the prompt asks for when the answer creates no policy: an answer, not a line worth
  // showing. A proposal with nothing to say in any of the three fields draws nothing at all.
  const hasPlacement = placement !== "" && placement !== "-";
  if (subnets.length === 0 && affected.length === 0 && !hasPlacement) return null;

  return (
    <div className="mt-2 rounded-[5px] border hairline px-2.5 py-2">
      <ul className="m-0 list-none space-y-1 p-0">
        {subnets.length > 0 && (
          <Row icon={<FiLayers size={11} />} label="Subnets">{subnets.join(", ")}</Row>
        )}
        {affected.length > 0 && (
          <Row icon={<FiUsers size={11} />} label="Affected">{affected.join(" · ")}</Row>
        )}
        {hasPlacement && (
          <Row icon={<FiCrosshair size={11} />} label="Placement">{placement}</Row>
        )}
      </ul>
    </div>
  );
};
