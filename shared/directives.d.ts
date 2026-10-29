export interface ModelSpec {
  label: string;
  tier: "preview" | "master";
  maxChars: number;
  instruction: boolean;
  events: "square" | "angle" | "none";
  voiceCatalog?: string;
  note: string;
}

export type Token =
  | { type: "text"; value: string; kind?: undefined; name?: undefined }
  | { type: "tag"; kind: "event" | "pause" | "style"; name: string; value: string };

export const VOCAL_EVENTS: string[];
export const PAUSES: Record<string, number>;
export const MODELS: Record<string, ModelSpec>;
export const PREVIEW_MODEL: string;
export const MASTER_MODELS: string[];
export function tokenize(text: string): Token[];
export function translateText(text: string, model: string): string;
export function combineInstruction(trackDirection?: string, segmentInstruction?: string): string;
