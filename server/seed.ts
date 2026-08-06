import 'dotenv/config';
import { createRepository } from './repository.js';

const repository = createRepository();
const state = await repository.reset();
console.log(`Pind seeded in ${repository.mode} mode with ${state.projects.length} projects.`);
