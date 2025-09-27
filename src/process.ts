import fs from "fs";
import path from "path";
import { parseArgs } from "util";
import {
  classifyAndExplainStance,
  explainStanceLabels
} from "./services/batch-processor";
import { clearCheckpoints } from "./services/checkpoint";
import {
  readExcelFile,
  readExcelFileWithLabels,
  updateExcelWithClassifications,
  updateExcelWithExplanations
} from "./services/excel";
import { getModel, getModelDisplayName, type LanguageModel, type ModelType } from "./utils/models";

const processDataset = async (
  model: LanguageModel,
  modelType: ModelType,
  target: string,
  filePath: string,
  isTrainFile: boolean
) => {
  const modelName = getModelDisplayName(modelType);
  const outputPath = `processed-${modelName.toLowerCase().replace(/[\s.]/g, '-')}-${target}-${isTrainFile ? 'train' : 'test'}.xlsx`;

  const fileType = isTrainFile ? "training" : "test";
  console.log(`📖 Processing ${fileType} file for ${target} using ${modelName}...`);

  // Step 1: Explain human labels
  const dataRowsWithLabels = await readExcelFileWithLabels(filePath);
  const humanExplanations = await explainStanceLabels(
    model,
    modelType,
    target,
    dataRowsWithLabels,
    "portuguese",
    isTrainFile
  );
  await updateExcelWithExplanations(filePath, humanExplanations, outputPath);
  console.log(`✅ Added human label explanations to ${outputPath}`);

  // Step 2: Classify and explain using LLM
  const texts = await readExcelFile(filePath);
  const llmClassifications = await classifyAndExplainStance(
    model,
    modelType,
    target,
    texts,
    "portuguese",
    isTrainFile
  );
  await updateExcelWithClassifications(outputPath, llmClassifications, outputPath);
  console.log(`✅ Added LLM classifications to ${outputPath}`);

  return outputPath;
};

const main = async () => {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      model: {
        type: 'string',
        short: 'm',
        default: 'gemini-2.0-flash'
      },
      targets: {
        type: 'string',
        short: 't',
        multiple: true
      },
      'clear-checkpoints': {
        type: 'boolean',
        short: 'c'
      },
      help: {
        type: 'boolean',
        short: 'h'
      }
    }
  });

  if (values.help) {
    console.log(`
Usage: bun run process -- [options]

Options:
  -m, --model <model>     AI model to use (gpt-4, gemini-2.0-flash, gemini-2.5-pro)
                          Default: gemini-2.0-flash
  -t, --targets <targets> Specific targets to process (can be specified multiple times)
                          Default: all targets (bolsonaro, cloroquina, coronavac, globo, igreja, lula)
  -c, --clear-checkpoints Clear all checkpoint files before processing
  -h, --help              Show this help message
`);
    process.exit(0);
  }

  // Clear checkpoints if requested
  if (values['clear-checkpoints']) {
    clearCheckpoints();
  }

  const modelType = values.model as ModelType || 'gemini-2.0-flash';
  const validModels: ModelType[] = ['gpt-5', 'gemini-2.0-flash', 'gemini-2.5-pro'];

  if (!validModels.includes(modelType)) {
    console.error(`❌ Invalid model: ${modelType}`);
    console.log(`Valid models: ${validModels.join(', ')}`);
    process.exit(1);
  }

  const model = getModel(modelType);
  const modelName = getModelDisplayName(modelType);

  console.log(`\n🤖 Using model: ${modelName}\n`);

  const trainTestDir = "/Users/aluisioamorim/Code/AluisioDev/label-explainer/train_test";
  const files = fs.readdirSync(trainTestDir);

  const allTargets = ["bolsonaro", "cloroquina", "coronavac", "globo", "igreja", "lula"];
  const targets = values.targets as string[] || allTargets;

  // Validate targets
  for (const target of targets) {
    if (!allTargets.includes(target)) {
      console.error(`❌ Invalid target: ${target}`);
      console.log(`Valid targets: ${allTargets.join(', ')}`);
      process.exit(1);
    }
  }

  console.log(`📋 Processing targets: ${targets.join(', ')}\n`);

  for (const target of targets) {
    console.log(`\n🎯 Processing ${target.toUpperCase()} datasets with ${modelName}...`);

    const trainFile = files.find(f => f.includes(target) && f.includes("train"));
    const testFile = files.find(f => f.includes(target) && f.includes("test"));

    if (trainFile) {
      const trainPath = path.join(trainTestDir, trainFile);
      await processDataset(model, modelType, target, trainPath, true);
    }

    if (testFile) {
      const testPath = path.join(trainTestDir, testFile);
      await processDataset(model, modelType, target, testPath, false);
    }
  }

  console.log(`\n🎉 All datasets processed with ${modelName}!`);
};

main()
