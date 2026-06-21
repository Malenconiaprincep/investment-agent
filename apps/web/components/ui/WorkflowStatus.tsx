import { WorkflowPipeline } from './WorkflowPipeline';

type WorkflowStatusProps = {
  label: string;
  steps: string[];
  currentStep: string | null;
  horizontal?: boolean;
  children?: React.ReactNode;
};

export function WorkflowStatus({
  label,
  steps,
  currentStep,
  horizontal = false,
  children,
}: WorkflowStatusProps) {
  return (
    <div className="workflow-status" role="status" aria-live="polite">
      <p className="workflow-status-label">{label}</p>
      <WorkflowPipeline
        steps={steps}
        currentStep={currentStep}
        className={horizontal ? 'pipeline--horizontal' : undefined}
      />
      {children}
    </div>
  );
}
