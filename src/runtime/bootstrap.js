import { Kernel } from '../application/Kernel.js';
import { StateManager } from '../infrastructure/StateManager.js';
import { ProviderRegistry } from '../providers/ProviderRegistry.js';
import { ToolRegistry } from '../tooling/ToolRegistry.js';
import { SkillRegistry } from '../tooling/SkillRegistry.js';
import { MemoryRegistry } from '../memory/MemoryRegistry.js';
import { ExecutionEngine } from '../execution/ExecutionEngine.js';
import { ToolExecutor } from '../execution/ToolExecutor.js';
import { Planner } from '../execution/Planner.js';
import { ContextPipeline } from '../application/ContextPipeline.js';
import { LLMRouter } from '../providers/LLMRouter.js';

export async function bootstrap() {
  const kernel = new Kernel();
  const container = kernel.container;

  // 1. Initialize Infrastructure
  const stateManager = new StateManager();
  await stateManager.init();
  container.register('stateManager', stateManager);

  // 2. Initialize Registries
  const providerRegistry = new ProviderRegistry();
  // Register the LLMRouter as the default provider adapter
  providerRegistry.register('default', new LLMRouter(kernel));
  container.register('providerRegistry', providerRegistry);

  container.register('toolRegistry', new ToolRegistry());
  container.register('skillRegistry', new SkillRegistry());
  container.register('memoryRegistry', new MemoryRegistry());

  // 3. Initialize Execution Engine & Tooling
  container.register('toolExecutor', new ToolExecutor(kernel));
  container.register('planner', new Planner(kernel));
  container.register('executionEngine', new ExecutionEngine(kernel));

  // 4. Initialize Context Pipeline
  const pipeline = new ContextPipeline(kernel);
  // Add basic stages
  pipeline.addStage(async (ctx, k) => {
    // Inject skills, memory, etc.
    return ctx;
  });
  container.register('contextPipeline', pipeline);

  // Boot kernel
  await kernel.boot();

  return kernel;
}
