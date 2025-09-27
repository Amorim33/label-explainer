import fs from "fs";
import path from "path";

export const CHECKPOINT_DIR = './dataset/checkpoints';

export interface CheckpointData {
  processedBatches: number[];
  results: { [batchIndex: number]: string };
  target: string;
  language: string;
  action: 'explain' | 'classify';
  totalBatches: number;
  modelType: string;
  lastUpdated: string;
}

// Ensure checkpoint directory exists
if (!fs.existsSync(CHECKPOINT_DIR)) {
  fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
}

export const getCheckpointPath = (
  modelType: string,
  target: string,
  action: 'explain' | 'classify',
  isTrainFile: boolean
): string => {
  return path.join(
    CHECKPOINT_DIR,
    `checkpoint-${modelType}-${target}-${action}-${isTrainFile ? 'train' : 'test'}.json`
  );
};

export const saveCheckpoint = (checkpointPath: string, data: CheckpointData) => {
  fs.writeFileSync(checkpointPath, JSON.stringify(data, null, 2));
};

export const loadCheckpoint = (checkpointPath: string): CheckpointData | null => {
  if (!fs.existsSync(checkpointPath)) {
    return null;
  }
  try {
    const data = fs.readFileSync(checkpointPath, 'utf-8');
    return JSON.parse(data) as CheckpointData;
  } catch (error) {
    console.error(`Error loading checkpoint: ${error}`);
    return null;
  }
};

export const saveBatchResult = (
  checkpointPath: string,
  batchIndex: number,
  result: string,
  checkpoint: CheckpointData
) => {
  checkpoint.processedBatches.push(batchIndex);
  checkpoint.results[batchIndex] = result;
  checkpoint.lastUpdated = new Date().toISOString();
  saveCheckpoint(checkpointPath, checkpoint);
  console.log(`  💾 Saved batch ${batchIndex + 1}/${checkpoint.totalBatches} to checkpoint`);
};

export const clearCheckpoints = () => {
  console.log('🗑️ Clearing all checkpoint files...');
  if (fs.existsSync(CHECKPOINT_DIR)) {
    const files = fs.readdirSync(CHECKPOINT_DIR);
    files.forEach(file => {
      fs.unlinkSync(path.join(CHECKPOINT_DIR, file));
    });
    console.log(`✅ Cleared ${files.length} checkpoint files`);
  }
};