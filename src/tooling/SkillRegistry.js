export class SkillRegistry {
  constructor() {
    this.skills = new Map();
  }

  register(name, skillData) {
    this.skills.set(name, skillData);
  }

  getSkill(name) {
    return this.skills.get(name);
  }

  getAllSkills() {
    return Array.from(this.skills.values());
  }
}
