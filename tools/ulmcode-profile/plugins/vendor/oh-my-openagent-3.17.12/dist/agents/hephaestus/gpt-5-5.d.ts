/**
 * GPT-5.5 Hephaestus prompt - outcome-first autonomous deep worker,
 * gated on personal manual QA of the artifact through its surface.
 */
import type { AvailableAgent, AvailableTool, AvailableSkill, AvailableCategory } from "../dynamic-agent-prompt-builder";
export declare function buildGpt55HephaestusPrompt(availableAgents: AvailableAgent[], _availableTools?: AvailableTool[], availableSkills?: AvailableSkill[], availableCategories?: AvailableCategory[], useTaskSystem?: boolean): string;
