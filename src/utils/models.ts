import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";

export type ModelType = "gpt-5" | "gemini-2.0-flash" | "gemini-2.5-pro";

export const getModel = (modelType: ModelType) => {
  switch (modelType) {
    case "gpt-5":
      return openai("gpt-5");
    case "gemini-2.0-flash":
      return google("gemini-2.0-flash-001");
    case "gemini-2.5-pro":
      return google("gemini-2.5-pro");
    default:
      throw new Error(`Unsupported model: ${modelType}`);
  }
};

export type LanguageModel = ReturnType<typeof getModel>

export const getModelDisplayName = (modelType: ModelType): string => {
  switch (modelType) {
    case "gpt-5":
      return "GPT-5";
    case "gemini-2.0-flash":
      return "Gemini-2.0-Flash";
    case "gemini-2.5-pro":
      return "Gemini-2.5-Pro";
    default:
      return modelType;
  }
};