export const BATCH_SIZE = 100;
export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 2000;

export const cleanTsvOutput = (text: string): string => {
  return text.replace(/^```tsv\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
};

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));