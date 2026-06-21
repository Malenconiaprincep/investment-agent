type WorkflowPipelineProps = {
  steps: string[];
  currentStep: string | null;
  className?: string;
};

export function WorkflowPipeline({
  steps,
  currentStep,
  className = '',
}: WorkflowPipelineProps) {
  const currentIndex = currentStep ? steps.indexOf(currentStep) : -1;

  return (
    <ol className={`pipeline ${className}`.trim()} aria-label="Workflow 进度">
      {steps.map((label, index) => {
        let state: 'pending' | 'active' | 'done' = 'pending';
        if (currentIndex === index) state = 'active';
        else if (currentIndex > index) state = 'done';

        return (
          <li key={label} className={`pipeline-step pipeline-step--${state}`}>
            <span className="pipeline-step-index" aria-hidden>
              {index + 1}
            </span>
            <span className="pipeline-step-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
