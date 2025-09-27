import ExcelJS from "exceljs";
import fs from "fs";
import { parseArgs } from "util";
import { generateText } from "ai";
import { getModel, getModelDisplayName, type ModelType, type LanguageModel } from "./utils/models";
import { getExplanationPrompt } from "./prompts/explanation";
import { getClassificationPrompt } from "./prompts/classification";
import { cleanTsvOutput, BATCH_SIZE } from "./utils/common";

interface MissingCellInfo {
  rowNumber: number;
  text: string;
  missingColumns: string[];
}

interface FileReport {
  filePath: string;
  totalRows: number;
  rowsWithMissing: number;
  missingDetails: MissingCellInfo[];
  relativePath: string;
}

interface MissingReport {
  summary: {
    totalFilesChecked: number;
    totalFilesWithMissing: number;
    totalRows: number;
    totalMissingRows: number;
    checkedAt: string;
  };
  reports: FileReport[];
}

const extractModelAndTarget = (filePath: string): { model: ModelType; target: string; dataset: 'train' | 'test' } | null => {
  const fileName = filePath.split('/').pop();
  if (!fileName) return null;

  // Pattern: processed-{model}-{target}-{dataset}.xlsx
  const match = fileName.match(/processed-(.*?)-(bolsonaro|cloroquina|coronavac|globo|igreja|lula)-(train|test)\.xlsx/);
  if (!match) return null;

  const modelStr = match[1];
  const target = match[2];
  const dataset = match[3] as 'train' | 'test';

  // Map model string to ModelType
  let modelType: ModelType;
  if (modelStr === 'gpt-5') {
    modelType = 'gpt-5';
  } else if (modelStr === 'gemini-2-5-pro') {
    modelType = 'gemini-2.5-pro';
  } else if (modelStr === 'gemini-2-0-flash') {
    modelType = 'gemini-2.0-flash';
  } else {
    return null;
  }

  return { model: modelType, target, dataset };
};

const explainBatchStanceLabels = async (
  model: LanguageModel,
  target: string,
  batch: { text: string; label: string }[],
  language: string = "portuguese"
): Promise<{ explanations: Map<string, string>; rawResponse: string }> => {
  const prompt = getExplanationPrompt({
    target,
    language,
    batch
  });

  const { text: result } = await generateText({
    ...(model.provider === 'openai' ? { temperature: 1 } : {}),
    model,
    prompt,
  });

  const cleanedResult = cleanTsvOutput(result);
  const lines = cleanedResult.split('\n').filter(line => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith("text");
  });

  const explanations = new Map<string, string>();

  // Match responses by index, not by text content
  for (let i = 0; i < Math.min(lines.length, batch.length); i++) {
    const parts = lines[i].split('\t');
    if (parts.length >= 3) {
      // Use original batch text as key, not the LLM's returned text
      explanations.set(batch[i].text, parts[2]); // Map original text -> explanation
    }
  }

  return { explanations, rawResponse: result };
};

const classifyAndExplainBatchStance = async (
  model: LanguageModel,
  target: string,
  batch: { text: string }[],
  language: string = "portuguese"
): Promise<{ classifications: Map<string, { label: string; explanation: string }>; rawResponse: string }> => {
  const prompt = getClassificationPrompt({
    target,
    language,
    batch
  });

  const { text: result } = await generateText({
    model,
    prompt,
  });

  const cleanedResult = cleanTsvOutput(result);
  const lines = cleanedResult.split('\n').filter(line => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith("text");
  });

  const classifications = new Map<string, { label: string; explanation: string }>();

  // Match responses by index, not by text content
  for (let i = 0; i < Math.min(lines.length, batch.length); i++) {
    const parts = lines[i].split('\t');
    if (parts.length >= 3) {
      // Use original batch text as key, not the LLM's returned text
      classifications.set(batch[i].text, {
        label: parts[1],
        explanation: parts[2]
      });
    }
  }

  return { classifications, rawResponse: result };
};

const processBatch = async (
  model: LanguageModel,
  target: string,
  batchRows: Array<{
    rowNumber: number;
    text: string;
    humanLabel?: string;
    missingColumns: string[];
  }>
): Promise<{
  results: Map<number, {
    humanExplanation?: string;
    llmLabel?: string;
    llmExplanation?: string;
  }>;
  errors: Map<number, string[]>;
}> => {
  const results = new Map<number, any>();
  const errors = new Map<number, string[]>();

  // Separate rows needing human explanations vs LLM classifications
  const needsHumanExplanation = batchRows.filter(
    r => r.missingColumns.includes("human-label-explanation") && r.humanLabel
  );
  const needsLlmClassification = batchRows.filter(
    r => r.missingColumns.includes("llm-label") || r.missingColumns.includes("llm-label-explanation")
  );

  // Process human explanations in batch
  if (needsHumanExplanation.length > 0) {
    try {
      console.log(`    Generating ${needsHumanExplanation.length} human label explanations...`);
      const batch = needsHumanExplanation.map(r => ({ text: r.text, label: r.humanLabel! }));
      const { explanations, rawResponse } = await explainBatchStanceLabels(model, target, batch, "portuguese");

      for (const row of needsHumanExplanation) {
        const explanation = explanations.get(row.text);
        if (explanation) {
          if (!results.has(row.rowNumber)) {
            results.set(row.rowNumber, {});
          }
          results.get(row.rowNumber)!.humanExplanation = explanation;
        } else {
          if (!errors.has(row.rowNumber)) {
            errors.set(row.rowNumber, []);
          }
          const errorMsg = `Failed to get human explanation from batch response. Raw API response: ${rawResponse.substring(0, 500)}${rawResponse.length > 500 ? '...' : ''}`;
          errors.get(row.rowNumber)!.push(errorMsg);
        }
      }
    } catch (error) {
      const errorMsg = `Failed to generate human explanations batch: ${error}`;
      console.error(`    ⚠️  ${errorMsg}`);
      for (const row of needsHumanExplanation) {
        if (!errors.has(row.rowNumber)) {
          errors.set(row.rowNumber, []);
        }
        errors.get(row.rowNumber)!.push(errorMsg);
      }
    }
  }

  // Process LLM classifications in batch
  if (needsLlmClassification.length > 0) {
    try {
      console.log(`    Generating ${needsLlmClassification.length} LLM classifications and explanations...`);
      const batch = needsLlmClassification.map(r => ({ text: r.text }));
      const { classifications, rawResponse } = await classifyAndExplainBatchStance(model, target, batch, "portuguese");

      for (const row of needsLlmClassification) {
        const classification = classifications.get(row.text);
        if (classification) {
          if (!results.has(row.rowNumber)) {
            results.set(row.rowNumber, {});
          }
          results.get(row.rowNumber)!.llmLabel = classification.label;
          results.get(row.rowNumber)!.llmExplanation = classification.explanation;
        } else {
          if (!errors.has(row.rowNumber)) {
            errors.set(row.rowNumber, []);
          }
          const errorMsg = `Failed to get LLM classification from batch response. Raw API response: ${rawResponse.substring(0, 500)}${rawResponse.length > 500 ? '...' : ''}`;
          errors.get(row.rowNumber)!.push(errorMsg);
        }
      }
    } catch (error) {
      const errorMsg = `Failed to generate LLM classifications batch: ${error}`;
      console.error(`    ⚠️  ${errorMsg}`);
      for (const row of needsLlmClassification) {
        if (!errors.has(row.rowNumber)) {
          errors.set(row.rowNumber, []);
        }
        errors.get(row.rowNumber)!.push(errorMsg);
      }
    }
  }

  return { results, errors };
};

const updateExcelRow = async (
  filePath: string,
  rowNumber: number,
  updates: {
    humanExplanation?: string;
    llmLabel?: string;
    llmExplanation?: string;
  }
): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.getWorksheet(1);

  if (!worksheet) {
    throw new Error(`No worksheet found in ${filePath}`);
  }

  const row = worksheet.getRow(rowNumber);

  if (updates.humanExplanation) {
    row.getCell(7).value = updates.humanExplanation; // Column 7: human-label-explanation
  }
  if (updates.llmLabel) {
    row.getCell(8).value = updates.llmLabel; // Column 8: llm-label
  }
  if (updates.llmExplanation) {
    row.getCell(9).value = updates.llmExplanation; // Column 9: llm-label-explanation
  }

  await workbook.xlsx.writeFile(filePath);
};

const main = async () => {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      report: {
        type: 'string',
        short: 'r',
        default: 'missing_report.json'
      },
      files: {
        type: 'string',
        short: 'f',
        multiple: true
      },
      'max-rows': {
        type: 'string',
        short: 'n'
      },
      help: {
        type: 'boolean',
        short: 'h'
      }
    }
  });

  if (values.help) {
    console.log(`
Usage: bun run retry-missing -- [options]

Options:
  -r, --report <file>     Path to the missing report JSON file
                          Default: missing_report.json
  -f, --files <files>     Specific files to process (relative paths from report)
                          Can be specified multiple times
                          Example: -f gpt-5/processed-gpt-5-bolsonaro-test.xlsx
  -n, --max-rows <num>    Maximum number of rows to process per file
                          Default: process all rows
  -h, --help              Show this help message

Examples:
  bun run retry-missing
  bun run retry-missing -- -r missing_report.json -n 10
  bun run retry-missing -- -f gpt-5/processed-gpt-5-bolsonaro-test.xlsx
`);
    process.exit(0);
  }

  const reportPath = values.report as string;
  const maxRowsPerFile = values['max-rows'] ? parseInt(values['max-rows'] as string) : undefined;
  const specificFiles = values.files as string[] | undefined;

  if (!fs.existsSync(reportPath)) {
    console.error(`❌ Report file not found: ${reportPath}`);
    process.exit(1);
  }

  console.log(`\n📖 Reading missing report from: ${reportPath}\n`);
  const reportData: MissingReport = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));

  console.log(`📊 Report Summary:`);
  console.log(`   Total files: ${reportData.summary.totalFilesChecked}`);
  console.log(`   Files with missing data: ${reportData.summary.totalFilesWithMissing}`);
  console.log(`   Total missing rows: ${reportData.summary.totalMissingRows}\n`);

  let filesToProcess = reportData.reports.filter(r => r.rowsWithMissing > 0);

  // Filter by specific files if requested
  if (specificFiles && specificFiles.length > 0) {
    filesToProcess = filesToProcess.filter(r =>
      specificFiles.some(f => r.relativePath.includes(f) || r.filePath.includes(f))
    );
    console.log(`🎯 Processing only ${filesToProcess.length} specified file(s)\n`);
  }

  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalFailed = 0;

  for (const fileReport of filesToProcess) {
    const fileInfo = extractModelAndTarget(fileReport.filePath);
    if (!fileInfo) {
      console.log(`⚠️  Skipping ${fileReport.relativePath}: Could not parse model/target`);
      continue;
    }

    console.log(`\n📁 Processing: ${fileReport.relativePath}`);
    console.log(`   Model: ${fileInfo.model}, Target: ${fileInfo.target}, Dataset: ${fileInfo.dataset}`);
    console.log(`   Rows with missing data: ${fileReport.rowsWithMissing}`);

    const model = getModel(fileInfo.model);
    const modelName = getModelDisplayName(fileInfo.model);

    // Read the Excel file to get current data
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(fileReport.filePath);
    const worksheet = workbook.getWorksheet(1);

    if (!worksheet) {
      console.log(`⚠️  No worksheet found in file`);
      continue;
    }

    const rowsToProcess = maxRowsPerFile
      ? fileReport.missingDetails.slice(0, maxRowsPerFile)
      : fileReport.missingDetails;

    console.log(`   Processing ${rowsToProcess.length} row(s) in batches of ${BATCH_SIZE}...\n`);

    // Process rows in batches
    for (let i = 0; i < rowsToProcess.length; i += BATCH_SIZE) {
      const batch = rowsToProcess.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(rowsToProcess.length / BATCH_SIZE);

      console.log(`   📦 Batch ${batchNum}/${totalBatches} (${batch.length} rows)\n`);

      // Prepare batch data with human labels from Excel
      const batchData = batch.map(missingRow => {
        const row = worksheet.getRow(missingRow.rowNumber);
        const humanLabel = row.getCell(3).value?.toString()?.toLowerCase().trim();
        return {
          rowNumber: missingRow.rowNumber,
          text: missingRow.text,
          humanLabel,
          missingColumns: missingRow.missingColumns
        };
      });

      try {
        // Process entire batch in one or two LLM calls
        const { results: batchResults, errors: batchErrors } = await processBatch(model, fileInfo.target, batchData);

        // Update Excel with results
        for (const missingRow of batch) {
          totalProcessed++;
          const updates = batchResults.get(missingRow.rowNumber);
          const rowErrors = batchErrors.get(missingRow.rowNumber);

          if (updates && Object.keys(updates).length > 0) {
            await updateExcelRow(fileReport.filePath, missingRow.rowNumber, updates);
            console.log(`   ✅ Row ${missingRow.rowNumber}: Updated successfully`);
            totalUpdated++;
          } else {
            if (rowErrors && rowErrors.length > 0) {
              console.log(`   ⚠️  Row ${missingRow.rowNumber}: No updates generated`);
              console.log(`       Errors: ${rowErrors.join(', ')}`);
            } else {
              console.log(`   ⚠️  Row ${missingRow.rowNumber}: No updates generated (no matching columns needed)`);
            }
            totalFailed++;
          }
        }
      } catch (error) {
        console.error(`   ❌ Batch ${batchNum} failed: ${error}`);
        totalFailed += batch.length;
      }

      console.log(`   ✓ Batch ${batchNum}/${totalBatches} completed\n`);
    }

    console.log(`   Completed file: ${fileReport.relativePath}`);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`\n📊 RETRY SUMMARY`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Files processed: ${filesToProcess.length}`);
  console.log(`Rows attempted: ${totalProcessed}`);
  console.log(`Rows updated: ${totalUpdated}`);
  console.log(`Rows failed: ${totalFailed}`);
  console.log(`\n🎉 Retry completed!\n`);
};

main().catch(console.error);
