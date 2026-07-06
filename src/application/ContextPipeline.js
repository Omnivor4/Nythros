export class ContextPipeline {
  constructor(kernel) {
    this.kernel = kernel;
    this.stages = [];
  }

  addStage(stageFn) {
    this.stages.push(stageFn);
    return this;
  }

  async build(contextEntity) {
    let currentContext = { ...contextEntity };
    
    for (const stage of this.stages) {
      currentContext = await stage(currentContext, this.kernel) || currentContext;
    }
    
    return currentContext;
  }
}
