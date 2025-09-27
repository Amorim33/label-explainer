import { generateText } from "ai";
import { getClassificationPrompt } from "../prompts/classification";
import { getExplanationPrompt } from "../prompts/explanation";
import { BATCH_SIZE, cleanTsvOutput, MAX_RETRIES, RETRY_DELAY_MS, sleep } from "../utils/common";
import { type LanguageModel } from "../utils/models";
import {
  getCheckpointPath,
  loadCheckpoint,
  saveBatchResult,
  saveCheckpoint
} from "./checkpoint";

export const processBatchWithRetry = async (
  model: LanguageModel,
  prompt: string,
  retries = MAX_RETRIES
): Promise<string | null> => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { text } = await generateText({
        ...(model.provider === 'openai' ? { temperature: 1 } : {}),
        model,
        prompt,
      });
      return text;
    } catch (error: any) {
      const isTimeout = error?.name === 'TimeoutError' || error?.code === 23;
      const isRetryable = isTimeout || error?.message?.includes('rate limit') || error?.message?.includes('503');

      if (isRetryable && attempt < retries) {
        console.log(`  ⚠️ Attempt ${attempt} failed: ${error.message || error.name}. Retrying in ${RETRY_DELAY_MS}ms...`);
        await sleep(RETRY_DELAY_MS * attempt);
      } else {
        console.error(`  ❌ Failed after ${attempt} attempts: ${error.message || error.name}`);
        return null;
      }
    }
  }
  return null;
};

export const explainStanceLabels = async (
  model: LanguageModel,
  modelType: string,
  target: string,
  dataRows: { text: string; label: string }[],
  language: string = "portuguese",
  isTrainFile: boolean = true
): Promise<Array<{ text: string, explanation: string }>> => {
  console.log(`🔍 Explaining human stance labels for ${target}`);

  const checkpointPath = getCheckpointPath(modelType, target, 'explain', isTrainFile);
  let checkpoint = loadCheckpoint(checkpointPath);

  // Create batches
  const batches: { text: string; label: string }[][] = [[]];
  let lineCount = 0;
  let batchIndex = 0;

  for (const row of dataRows) {
    batches[batchIndex].push(row);
    lineCount++;
    if (lineCount === BATCH_SIZE) {
      batchIndex++;
      batches.push([]);
      lineCount = 0;
    }
  }

  // Initialize or validate checkpoint
  if (!checkpoint) {
    checkpoint = {
      processedBatches: [],
      results: {},
      target,
      language,
      action: 'explain',
      totalBatches: batches.length,
      modelType,
      lastUpdated: new Date().toISOString()
    };
    saveCheckpoint(checkpointPath, checkpoint);
  } else {
    console.log(`📂 Found existing checkpoint with ${checkpoint.processedBatches.length}/${batches.length} batches completed`);
  }

  // Process only unprocessed batches
  const promises = batches.map(async (batch, index) => {
    // Skip if already processed
    if (checkpoint!.processedBatches.includes(index)) {
      console.log(`  ⏭️ Skipping batch ${index + 1}/${batches.length} (already processed)`);
      return { index, result: checkpoint!.results[index], skipped: true };
    }

    console.log(`  📝 Processing batch ${index + 1}/${batches.length} (${batch.length} items)...`);

    try {
      const prompt = getExplanationPrompt({ target, language, batch });
      const { text } = await generateText({
        ...(model.provider === 'openai' ? { temperature: 1 } : {}),
        model,
        prompt,
      });

      // Save successful batch immediately
      saveBatchResult(checkpointPath, index, text, checkpoint!);
      console.log(`  ✓ Batch ${index + 1}/${batches.length} completed and saved`);
      return { index, result: text, skipped: false };
    } catch (error: any) {
      console.error(`  ❌ Batch ${index + 1} failed: ${error.message || error}`);
      return { index, result: null, skipped: false };
    }
  });

  console.log(`⏳ Processing ${batches.length - checkpoint.processedBatches.length} remaining batches...`);
  const batchResults = await Promise.all(promises);

  // Collect all results (including previously processed ones)
  const allResults: string[] = [];
  for (let i = 0; i < batches.length; i++) {
    const result = checkpoint.results[i];
    if (result) {
      allResults.push(result);
    }
  }

  // Check for failed batches
  const failedBatches = batchResults.filter(r => !r.skipped && r.result === null);
  if (failedBatches.length > 0) {
    console.error(`⚠️ ${failedBatches.length} batches failed. Re-run to retry failed batches.`);
  }

  const allExplanations: Array<{ text: string, explanation: string }> = [];

  for (const batchResult of allResults) {
    const cleanedResult = cleanTsvOutput(batchResult);
    const lines = cleanedResult.split('\n');

    for (const line of lines) {
      if (line.startsWith("text")) {
        continue;
      }

      if (line.trim()) {
        const parts = line.split('\t');
        if (parts.length >= 3) {
          allExplanations.push({
            text: parts[0],
            explanation: parts[2]
          });
        }
      }
    }
  }

  return allExplanations;
};

export const classifyAndExplainStance = async (
  model: LanguageModel,
  modelType: string,
  target: string,
  texts: string[],
  language: string = "portuguese",
  isTrainFile: boolean = true
): Promise<Array<{ text: string, label: string, explanation: string }>> => {
  console.log(`🔍 Classifying and explaining LLM stance for ${target}`);

  const checkpointPath = getCheckpointPath(modelType, target, 'classify', isTrainFile);
  let checkpoint = loadCheckpoint(checkpointPath);

  // Create batches
  const batches: { text: string }[][] = [[]];
  let lineCount = 0;
  let batchIndex = 0;

  for (const text of texts) {
    batches[batchIndex].push({ text });
    lineCount++;
    if (lineCount === BATCH_SIZE) {
      batchIndex++;
      batches.push([]);
      lineCount = 0;
    }
  }

  // Initialize or validate checkpoint
  if (!checkpoint) {
    checkpoint = {
      processedBatches: [],
      results: {},
      target,
      language,
      action: 'classify',
      totalBatches: batches.length,
      modelType,
      lastUpdated: new Date().toISOString()
    };
    saveCheckpoint(checkpointPath, checkpoint);
  } else {
    console.log(`📂 Found existing checkpoint with ${checkpoint.processedBatches.length}/${batches.length} batches completed`);
  }

  // Process only unprocessed batches
  const promises = batches.map(async (batch, index) => {
    // Skip if already processed
    if (checkpoint!.processedBatches.includes(index)) {
      console.log(`  ⏭️ Skipping batch ${index + 1}/${batches.length} (already processed)`);
      return { index, result: checkpoint!.results[index], skipped: true };
    }

    console.log(`  📝 Processing batch ${index + 1}/${batches.length} (${batch.length} items)...`);

    try {
      const prompt = getClassificationPrompt({ target, language, batch });
      const { text } = await generateText({
        model,
        prompt,
      });

      // Save successful batch immediately
      saveBatchResult(checkpointPath, index, text, checkpoint!);
      console.log(`  ✓ Batch ${index + 1}/${batches.length} completed and saved`);
      return { index, result: text, skipped: false };
    } catch (error: any) {
      console.error(`  ❌ Batch ${index + 1} failed: ${error.message || error}`);
      return { index, result: null, skipped: false };
    }
  });

  console.log(`⏳ Processing ${batches.length - checkpoint.processedBatches.length} remaining batches...`);
  const batchResults = await Promise.all(promises);

  // Collect all results (including previously processed ones)
  const allResultStrings: string[] = [];
  for (let i = 0; i < batches.length; i++) {
    const result = checkpoint.results[i];
    if (result) {
      allResultStrings.push(result);
    }
  }

  // Check for failed batches
  const failedBatches = batchResults.filter(r => !r.skipped && r.result === null);
  if (failedBatches.length > 0) {
    console.error(`⚠️ ${failedBatches.length} batches failed. Re-run to retry failed batches.`);
  }

  const allResults: Array<{ text: string, label: string, explanation: string }> = [];

  for (const batchResult of allResultStrings) {
    const cleanedResult = cleanTsvOutput(batchResult);
    const lines = cleanedResult.split('\n');

    for (const line of lines) {
      if (line.startsWith("text")) {
        continue;
      }

      if (line.trim()) {
        const parts = line.split('\t');
        if (parts.length >= 3) {
          allResults.push({
            text: parts[0],
            label: parts[1],
            explanation: parts[2]
          });
        }
      }
    }
  }

  return allResults;
};