// Step header for multi-step windows (stock entry, sale wizard): done steps get a tick, the current one
// is highlighted. Purely visual; the parent keeps the current step.
export default function Stepper({ steps, current }) {
  return (
    <ol className="ui-stepper">
      {steps.map((step, index) => {
        const state = index < current ? "done" : index === current ? "current" : "todo";
        return (
          <li key={step} className={`ui-step ui-step-${state}`} aria-current={state === "current" ? "step" : undefined}>
            <span className="ui-step-mark" aria-hidden="true">{state === "done" ? "✓" : index + 1}</span>
            <span>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}
