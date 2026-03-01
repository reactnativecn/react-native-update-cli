import type { CommandContext, CustomWorkflow } from './types';

export async function runWorkflow(
  workflowName: string,
  workflow: CustomWorkflow,
  context: CommandContext,
): Promise<unknown> {
  if (workflow.validate && !workflow.validate(context)) {
    throw new Error(`Workflow '${workflowName}' validation failed`);
  }

  let previousResult: unknown;
  for (const step of workflow.steps) {
    if (step.condition && !step.condition(context)) {
      console.log(`Skipping step '${step.name}' due to condition`);
      continue;
    }

    console.log(`Executing step '${step.name}'`);
    previousResult = await step.execute(context, previousResult);
  }

  return previousResult;
}
