import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import { parseArgs } from "util";

interface DataRow {
  text: string;
  humanLabel: string;
  humanExplanation?: string;
  llmLabel: string;
  llmExplanation?: string;
}

interface AccuracyStats {
  model: string;
  target: string;
  dataset: "train" | "test";
  totalSamples: number;
  correctPredictions: number;
  accuracy: number;
  f1Score: number;
  labelStats: { [label: string]: { total: number; correct: number; accuracy: number; precision: number; recall: number; f1Score: number } };
  confusionMatrix: { [actualLabel: string]: { [predictedLabel: string]: number } };
}

interface ComparisonStats {
  model1: string;
  model2: string;
  target: string;
  dataset: "train" | "test";
  agreementRate: number;
  disagreements: Array<{
    text: string;
    humanLabel: string;
    model1Label: string;
    model2Label: string;
    model1Explanation?: string;
    model2Explanation?: string;
  }>;
}

const readProcessedFile = async (filePath: string): Promise<DataRow[]> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.getWorksheet(1);

  const dataRows: DataRow[] = [];
  worksheet?.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      const text = row.getCell(1).value?.toString()?.trim() || "";
      const humanLabel = row.getCell(3).value?.toString()?.toLowerCase().trim() || "";
      const humanExplanation = row.getCell(7).value?.toString()?.trim();
      const llmLabel = row.getCell(8).value?.toString()?.toLowerCase().trim() || "";
      const llmExplanation = row.getCell(9).value?.toString()?.trim();

      if (text && humanLabel && llmLabel) {
        dataRows.push({ text, humanLabel, humanExplanation, llmLabel, llmExplanation });
      }
    }
  });

  return dataRows;
};

const calculateAccuracy = (data: DataRow[]): Omit<AccuracyStats, 'model' | 'target' | 'dataset'> => {
  let totalCorrect = 0;
  const labelStats: { [label: string]: { total: number; correct: number; accuracy: number; precision: number; recall: number; f1Score: number } } = {};
  const confusionMatrix: { [actualLabel: string]: { [predictedLabel: string]: number } } = {};

  // Build confusion matrix
  for (const row of data) {
    if (!labelStats[row.humanLabel]) {
      labelStats[row.humanLabel] = { total: 0, correct: 0, accuracy: 0, precision: 0, recall: 0, f1Score: 0 };
    }
    labelStats[row.humanLabel].total++;

    if (!confusionMatrix[row.humanLabel]) {
      confusionMatrix[row.humanLabel] = {};
    }
    if (!confusionMatrix[row.humanLabel][row.llmLabel]) {
      confusionMatrix[row.humanLabel][row.llmLabel] = 0;
    }
    confusionMatrix[row.humanLabel][row.llmLabel]++;

    if (row.humanLabel === row.llmLabel) {
      totalCorrect++;
      labelStats[row.humanLabel].correct++;
    }
  }

  // Calculate per-label metrics
  const allLabels = new Set([...Object.keys(labelStats), ...data.map(d => d.llmLabel)]);

  for (const label of allLabels) {
    if (!labelStats[label]) {
      labelStats[label] = { total: 0, correct: 0, accuracy: 0, precision: 0, recall: 0, f1Score: 0 };
    }

    const stats = labelStats[label];

    // True Positives: correctly predicted as this label
    const truePositives = stats.correct;

    // False Positives: predicted as this label but actually another label
    let falsePositives = 0;
    for (const actualLabel in confusionMatrix) {
      if (actualLabel !== label && confusionMatrix[actualLabel][label]) {
        falsePositives += confusionMatrix[actualLabel][label];
      }
    }

    // Precision: TP / (TP + FP)
    const precision = (truePositives + falsePositives) > 0
      ? truePositives / (truePositives + falsePositives)
      : 0;

    // Recall: TP / (TP + FN)
    const recall = stats.total > 0
      ? truePositives / stats.total
      : 0;

    // F1 Score: 2 * (Precision * Recall) / (Precision + Recall)
    const f1Score = (precision + recall) > 0
      ? 2 * (precision * recall) / (precision + recall)
      : 0;

    stats.accuracy = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
    stats.precision = precision;
    stats.recall = recall;
    stats.f1Score = f1Score;
  }

  // Calculate macro-averaged F1 score
  const f1Scores = Object.values(labelStats).map(s => s.f1Score);
  const macroF1 = f1Scores.length > 0 ? f1Scores.reduce((sum, f1) => sum + f1, 0) / f1Scores.length : 0;

  const overallAccuracy = data.length > 0 ? (totalCorrect / data.length) * 100 : 0;

  return {
    totalSamples: data.length,
    correctPredictions: totalCorrect,
    accuracy: overallAccuracy,
    f1Score: macroF1,
    labelStats,
    confusionMatrix
  };
};

const compareModels = async (
  model1Name: string,
  model2Name: string,
  target: string,
  dataset: "train" | "test"
): Promise<ComparisonStats> => {
  // Try both flat structure and directory structure
  let model1File = `processed-${model1Name.toLowerCase().replace(/[\s.]/g, '-')}-${target}-${dataset}.xlsx`;
  let model2File = `processed-${model2Name.toLowerCase().replace(/[\s.]/g, '-')}-${target}-${dataset}.xlsx`;

  // Check if files exist in model directories
  let model1Dir = model1Name.toLowerCase().replace(/[\s.]/g, '-');
  let model2Dir = model2Name.toLowerCase().replace(/[\s.]/g, '-');

  // Special handling for directory names
  if (model1Name === 'Gemini-2-5-Pro') {
    model1Dir = 'gemini-2.5-pro';
  } else if (model1Name === 'GPT-5') {
    model1Dir = 'gpt-5';
  }

  if (model2Name === 'Gemini-2-5-Pro') {
    model2Dir = 'gemini-2.5-pro';
  } else if (model2Name === 'GPT-5') {
    model2Dir = 'gpt-5';
  }

  if (fs.existsSync(`${model1Dir}/${model1File}`)) {
    model1File = `${model1Dir}/${model1File}`;
  }
  if (fs.existsSync(`${model2Dir}/${model2File}`)) {
    model2File = `${model2Dir}/${model2File}`;
  }

  if (!fs.existsSync(model1File)) {
    throw new Error(`File not found: ${model1File}`);
  }
  if (!fs.existsSync(model2File)) {
    throw new Error(`File not found: ${model2File}`);
  }

  const model1Data = await readProcessedFile(model1File);
  const model2Data = await readProcessedFile(model2File);

  const dataMap = new Map<string, {
    humanLabel: string;
    model1Label?: string;
    model1Explanation?: string;
    model2Label?: string;
    model2Explanation?: string;
  }>();

  model1Data.forEach(item => {
    dataMap.set(item.text, {
      humanLabel: item.humanLabel,
      model1Label: item.llmLabel,
      model1Explanation: item.llmExplanation
    });
  });

  model2Data.forEach(item => {
    const existing = dataMap.get(item.text);
    if (existing) {
      existing.model2Label = item.llmLabel;
      existing.model2Explanation = item.llmExplanation;
    }
  });

  let agreements = 0;
  const disagreements: ComparisonStats["disagreements"] = [];

  dataMap.forEach((value, text) => {
    if (value.model1Label && value.model2Label) {
      if (value.model1Label === value.model2Label) {
        agreements++;
      } else {
        disagreements.push({
          text,
          humanLabel: value.humanLabel,
          model1Label: value.model1Label,
          model2Label: value.model2Label,
          model1Explanation: value.model1Explanation,
          model2Explanation: value.model2Explanation
        });
      }
    }
  });

  const agreementRate = (agreements / dataMap.size) * 100;

  return {
    model1: model1Name,
    model2: model2Name,
    target,
    dataset,
    agreementRate,
    disagreements: disagreements.slice(0, 10)
  };
};

const printAccuracyReport = (stats: AccuracyStats) => {
  console.log(`\n📊 ACCURACY REPORT: ${stats.model} - ${stats.target.toUpperCase()} (${stats.dataset})`);
  console.log("=".repeat(60));
  console.log(`🎯 Overall Accuracy: ${stats.accuracy.toFixed(2)}% (${stats.correctPredictions}/${stats.totalSamples})`);
  console.log(`🎯 Macro F1 Score: ${(stats.f1Score * 100).toFixed(2)}%`);

  console.log("\n📈 Metrics by Label:");
  console.log("-".repeat(80));
  console.log("Label".padEnd(15) + "Accuracy".padEnd(12) + "Precision".padEnd(12) + "Recall".padEnd(12) + "F1 Score".padEnd(12) + "Count");
  console.log("-".repeat(80));
  for (const [label, labelStats] of Object.entries(stats.labelStats)) {
    console.log(
      label.toUpperCase().padEnd(15) +
      `${labelStats.accuracy.toFixed(1)}%`.padEnd(12) +
      `${(labelStats.precision * 100).toFixed(1)}%`.padEnd(12) +
      `${(labelStats.recall * 100).toFixed(1)}%`.padEnd(12) +
      `${(labelStats.f1Score * 100).toFixed(1)}%`.padEnd(12) +
      `${labelStats.correct}/${labelStats.total}`
    );
  }

  console.log("\n🔀 Confusion Matrix:");
  console.log("-".repeat(40));
  const allLabels = [...new Set([
    ...Object.keys(stats.confusionMatrix),
    ...Object.values(stats.confusionMatrix).flatMap(row => Object.keys(row))
  ])];

  let matrixOutput = "Actual \\ Predicted".padEnd(20);
  allLabels.forEach(label => {
    matrixOutput += label.padEnd(12);
  });
  matrixOutput += "\n";

  allLabels.forEach(actualLabel => {
    matrixOutput += actualLabel.padEnd(20);
    allLabels.forEach(predictedLabel => {
      const count = stats.confusionMatrix[actualLabel]?.[predictedLabel] || 0;
      matrixOutput += count.toString().padEnd(12);
    });
    matrixOutput += "\n";
  });

  console.log(matrixOutput);
  console.log("=".repeat(60));
};

const generateSummaryReport = (allStats: AccuracyStats[], comparisonStats?: ComparisonStats[]) => {
  const modelGroups = new Map<string, AccuracyStats[]>();

  allStats.forEach(stat => {
    if (!modelGroups.has(stat.model)) {
      modelGroups.set(stat.model, []);
    }
    modelGroups.get(stat.model)!.push(stat);
  });

  console.log("\n📋 ACCURACY SUMMARY BY MODEL");
  console.log("=".repeat(80));

  modelGroups.forEach((stats, model) => {
    console.log(`\n🤖 Model: ${model}`);
    console.log("-".repeat(100));
    console.log("Target".padEnd(15) + "Dataset".padEnd(10) + "Accuracy".padEnd(12) + "F1 Score".padEnd(12) + "Correct/Total".padEnd(20) + "For F1".padEnd(12) + "Against F1");
    console.log("-".repeat(100));

    let totalSamples = 0;
    let totalCorrect = 0;
    let totalF1 = 0;

    stats.forEach(stat => {
      totalSamples += stat.totalSamples;
      totalCorrect += stat.correctPredictions;
      totalF1 += stat.f1Score;

      const forF1 = stat.labelStats["for"]?.f1Score ? (stat.labelStats["for"].f1Score * 100).toFixed(1) : "N/A";
      const againstF1 = stat.labelStats["against"]?.f1Score ? (stat.labelStats["against"].f1Score * 100).toFixed(1) : "N/A";

      console.log(
        stat.target.padEnd(15) +
        stat.dataset.padEnd(10) +
        `${stat.accuracy.toFixed(1)}%`.padEnd(12) +
        `${(stat.f1Score * 100).toFixed(1)}%`.padEnd(12) +
        `${stat.correctPredictions}/${stat.totalSamples}`.padEnd(20) +
        `${forF1}%`.padEnd(12) +
        `${againstF1}%`
      );
    });

    const overallAccuracy = totalSamples > 0 ? (totalCorrect / totalSamples) * 100 : 0;
    const avgF1 = stats.length > 0 ? (totalF1 / stats.length) * 100 : 0;
    console.log("-".repeat(100));
    console.log(`OVERALL`.padEnd(15) + ``.padEnd(10) + `${overallAccuracy.toFixed(1)}%`.padEnd(12) + `${avgF1.toFixed(1)}%`.padEnd(12) + `${totalCorrect}/${totalSamples}`);
  });

  if (comparisonStats && comparisonStats.length > 0) {
    console.log("\n\n📊 MODEL COMPARISON SUMMARY");
    console.log("=".repeat(80));
    console.log("Models".padEnd(30) + "Target".padEnd(15) + "Dataset".padEnd(10) + "Agreement Rate");
    console.log("-".repeat(80));

    comparisonStats.forEach(stat => {
      console.log(
        `${stat.model1} vs ${stat.model2}`.padEnd(30) +
        stat.target.padEnd(15) +
        stat.dataset.padEnd(10) +
        `${stat.agreementRate.toFixed(1)}%`
      );
    });

    const avgAgreement = comparisonStats.reduce((sum, stat) => sum + stat.agreementRate, 0) / comparisonStats.length;
    console.log("-".repeat(80));
    console.log(`Average Agreement Rate: ${avgAgreement.toFixed(1)}%`);
  }

  console.log("=".repeat(80));
};

const createComprehensiveComparison = async (
  models: string[],
  targets: string[],
  outputPath: string
) => {
  const workbook = new ExcelJS.Workbook();

  // Create summary sheet
  const summarySheet = workbook.addWorksheet('Summary');
  const summaryHeaders = ['Target', 'Dataset', 'Total Samples'];
  for (const model of models) {
    summaryHeaders.push(`${model} Accuracy (%)`, `${model} Correct`);
  }
  summarySheet.addRow(summaryHeaders);

  const summaryData: any[][] = [];

  for (const target of targets) {
    for (const dataset of ['train', 'test'] as const) {
      const sheetName = `${target}-${dataset}`;
      const worksheet = workbook.addWorksheet(sheetName);

      // Create headers
      const headers = ['text', 'human-label', 'human-label-explanation'];
      for (const model of models) {
        const modelPrefix = model.toLowerCase().replace(/[\s.]/g, '-');
        headers.push(
          `${modelPrefix}-label`,
          `${modelPrefix}-label-explanation`,
          `${modelPrefix}-correct`
        );
      }
      worksheet.addRow(headers);

      // Read all model data
      const modelData = new Map<string, DataRow[]>();
      for (const model of models) {
        let filePath = `processed-${model.toLowerCase().replace(/[\s.]/g, '-')}-${target}-${dataset}.xlsx`;

        // Check if file exists in model directory
        // For Gemini-2-5-Pro, check the gemini-2.5-pro directory
        let modelDir = model.toLowerCase().replace(/[\s.]/g, '-');
        if (model === 'Gemini-2-5-Pro') {
          modelDir = 'gemini-2.5-pro';
        } else if (model === 'GPT-5') {
          modelDir = 'gpt-5';
        }

        const fullPath = `dataset/${modelDir}/${filePath}`;
        if (fs.existsSync(fullPath)) {
          filePath = fullPath;
        }

        if (fs.existsSync(filePath)) {
          const data = await readProcessedFile(filePath);
          modelData.set(model, data);
          console.log(`  ✓ Loaded ${model} data from ${filePath}`);
        } else {
          console.log(`  ⚠️ File not found for ${model}: ${filePath}`);
        }
      }

      // Get all unique texts
      const allTexts = new Set<string>();
      modelData.forEach(data => {
        data.forEach(row => allTexts.add(row.text));
      });

      // Create rows for each text
      allTexts.forEach(text => {
        const row: any[] = [text];

        // Get human label and explanation (should be same across all models)
        let humanLabel = '';
        let humanExplanation = '';
        for (const [_, data] of modelData) {
          const item = data.find(d => d.text === text);
          if (item) {
            humanLabel = item.humanLabel;
            humanExplanation = item.humanExplanation || '';
            break;
          }
        }
        row.push(humanLabel, humanExplanation);

        // Add each model's predictions
        for (const model of models) {
          const data = modelData.get(model);
          const item = data?.find(d => d.text === text);
          if (item) {
            row.push(
              item.llmLabel,
              item.llmExplanation || '',
              item.llmLabel === humanLabel ? 'YES' : 'NO'
            );
          } else {
            row.push('', '', '');
          }
        }

        worksheet.addRow(row);
      });

      // Calculate accuracy for summary
      const summaryRow = [target, dataset];
      let totalSamples = 0;
      const modelAccuracies: { [model: string]: { correct: number, total: number } } = {};

      for (const model of models) {
        modelAccuracies[model] = { correct: 0, total: 0 };
      }

      allTexts.forEach(text => {
        let humanLabel = '';
        for (const [_, data] of modelData) {
          const item = data.find(d => d.text === text);
          if (item) {
            humanLabel = item.humanLabel;
            break;
          }
        }

        if (humanLabel) {
          totalSamples++;
          for (const model of models) {
            const data = modelData.get(model);
            const item = data?.find(d => d.text === text);
            if (item) {
              modelAccuracies[model].total++;
              if (item.llmLabel === humanLabel) {
                modelAccuracies[model].correct++;
              }
            }
          }
        }
      });

      summaryRow.push(String(totalSamples));
      for (const model of models) {
        const acc = modelAccuracies[model];
        const accuracy = acc.total > 0 ? ((acc.correct / acc.total) * 100).toFixed(2) : '0.00';
        summaryRow.push(accuracy, `${acc.correct}/${acc.total}`);
      }
      summaryData.push(summaryRow);

      // Auto-adjust column widths
      worksheet.columns.forEach((column, index) => {
        if (index === 0) {
          column.width = 50; // Text column
        } else if (headers[index]?.includes('explanation')) {
          column.width = 40; // Explanation columns
        } else {
          column.width = 15; // Label columns
        }
      });

      // Add conditional formatting for correct/incorrect
      const correctColumns: number[] = [];
      headers.forEach((header, index) => {
        if (header.includes('-correct')) {
          correctColumns.push(index + 1); // Excel is 1-indexed
        }
      });

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) { // Skip header
          correctColumns.forEach(colIndex => {
            const cell = row.getCell(colIndex);
            if (cell.value === 'YES') {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF90EE90' } // Light green
              };
            } else if (cell.value === 'NO') {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFFB6C1' } // Light red
              };
            }
          });
        }
      });
    }
  }

  // Add summary data to summary sheet
  summaryData.forEach(row => {
    summarySheet.addRow(row);
  });

  // Format summary sheet
  summarySheet.columns.forEach((column, index) => {
    if (index === 0) {
      column.width = 15; // Target column
    } else if (index === 1) {
      column.width = 10; // Dataset column
    } else {
      column.width = 20; // Model columns
    }
  });

  // Add header formatting
  summarySheet.getRow(1).font = { bold: true };
  summarySheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  };

  // Move summary sheet to the first position by reordering
  const worksheets = workbook.worksheets;
  if (worksheets[0] !== summarySheet) {
    const summaryIndex = worksheets.indexOf(summarySheet);
    if (summaryIndex > 0) {
      worksheets.splice(summaryIndex, 1);
      worksheets.unshift(summarySheet);
    }
  }

  await workbook.xlsx.writeFile(outputPath);
  console.log(`\n📁 Comprehensive comparison saved to: ${outputPath}`);
};

const writeComparisonReport = async (stats: AccuracyStats[], comparisons: ComparisonStats[], outputPath: string) => {
  const workbook = new ExcelJS.Workbook();

  const summarySheet = workbook.addWorksheet("Accuracy Summary");
  summarySheet.addRow(["Model", "Target", "Dataset", "Total Samples", "Accuracy (%)", "F1 Score (%)", "Correct Predictions", "For F1 (%)", "Against F1 (%)"]);

  stats.forEach(stat => {
    summarySheet.addRow([
      stat.model,
      stat.target,
      stat.dataset,
      stat.totalSamples,
      stat.accuracy.toFixed(2),
      (stat.f1Score * 100).toFixed(2),
      stat.correctPredictions,
      stat.labelStats["for"]?.f1Score ? (stat.labelStats["for"].f1Score * 100).toFixed(2) : "N/A",
      stat.labelStats["against"]?.f1Score ? (stat.labelStats["against"].f1Score * 100).toFixed(2) : "N/A"
    ]);
  });

  const comparisonSheet = workbook.addWorksheet("Model Comparisons");
  comparisonSheet.addRow(["Model 1", "Model 2", "Target", "Dataset", "Agreement Rate (%)", "Sample Disagreements"]);

  comparisons.forEach(comp => {
    const sampleDisagreements = comp.disagreements.slice(0, 3).map(d =>
      `"${d.text.substring(0, 50)}..." - Human: ${d.humanLabel}, ${comp.model1}: ${d.model1Label}, ${comp.model2}: ${d.model2Label}`
    ).join(" | ");

    comparisonSheet.addRow([
      comp.model1,
      comp.model2,
      comp.target,
      comp.dataset,
      comp.agreementRate.toFixed(2),
      sampleDisagreements
    ]);
  });

  [summarySheet, comparisonSheet].forEach(sheet => {
    sheet.columns.forEach(column => {
      column.width = 20;
    });
  });

  await workbook.xlsx.writeFile(outputPath);
};

const main = async () => {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      models: {
        type: 'string',
        short: 'm',
        multiple: true
      },
      targets: {
        type: 'string',
        short: 't',
        multiple: true
      },
      compare: {
        type: 'boolean',
        short: 'c',
        default: false
      },
      output: {
        type: 'string',
        short: 'o',
        default: 'comparison-report.xlsx'
      },
      help: {
        type: 'boolean',
        short: 'h'
      }
    }
  });

  if (values.help) {
    console.log(`
Usage: bun run compare -- [options]

Options:
  -m, --models <models>   Models to analyze (can be specified multiple times)
                          Options: gpt-5, gemini-2.0-flash, gemini-2.5-pro
                          Default: all available models
  -t, --targets <targets> Specific targets to analyze (can be specified multiple times)
                          Default: all targets
  -c, --compare           Enable model comparison analysis
  -o, --output <file>     Output Excel file for detailed report
                          Default: comparison-report.xlsx
  -h, --help              Show this help message

Examples:
  bun run compare -- -m gpt-5 -m gemini-2.5-pro --compare
  bun run compare -- --models gpt-5 --targets bolsonaro --targets lula
  bun run compare -- -c -o detailed-comparison.xlsx
`);
    process.exit(0);
  }

  const currentDir = "/Users/aluisioamorim/Code/AluisioDev/label-explainer/dataset";
  const allTargets = ["bolsonaro", "cloroquina", "coronavac", "globo", "igreja", "lula"];
  const targets = values.targets as string[] || allTargets;

  const modelNameMap: Record<string, string> = {
    'gpt-5': 'GPT-5',
    'gemini-2.0-flash': 'Gemini-2.0-Flash',
    'gemini-2.5-pro': 'Gemini-2-5-Pro'  // Match the actual file naming
  };

  let models: string[] = [];
  if (values.models) {
    models = (values.models as string[]).map(m => modelNameMap[m] || m);
  } else {
    // Auto-detect available models by checking for files
    for (const [key, modelName] of Object.entries(modelNameMap)) {
      const testFile = `processed-${modelName.toLowerCase().replace(/[\s.]/g, '-')}-${targets[0]}-test.xlsx`;
      const modelDir = modelName.toLowerCase().replace(/[\s.]/g, '-');

      // Check both flat structure and directory structure
      if (fs.existsSync(path.join(currentDir, testFile)) ||
        fs.existsSync(path.join(currentDir, modelDir, testFile))) {
        models.push(modelName);
      }
    }
  }

  if (models.length === 0) {
    console.error("❌ No models specified or found. Please run the process script first.");
    process.exit(1);
  }

  console.log(`\n📊 Analyzing models: ${models.join(', ')}`);
  console.log(`📁 Targets: ${targets.join(', ')}\n`);

  const allStats: AccuracyStats[] = [];
  const comparisonStats: ComparisonStats[] = [];

  // Analyze each model
  for (const modelName of models) {
    console.log(`\n🤖 Analyzing ${modelName}...`);
    console.log("=".repeat(60));

    for (const target of targets) {
      for (const dataset of ["train", "test"] as const) {
        let filePath = `processed-${modelName.toLowerCase().replace(/[\s.]/g, '-')}-${target}-${dataset}.xlsx`;

        // Check if file exists in model directory
        let modelDir = modelName.toLowerCase().replace(/[\s.]/g, '-');
        if (modelName === 'Gemini-2-5-Pro') {
          modelDir = 'gemini-2.5-pro';
        } else if (modelName === 'GPT-5') {
          modelDir = 'gpt-5';
        }

        const modelDirPath = path.join(currentDir, modelDir, filePath);
        if (fs.existsSync(modelDirPath)) {
          filePath = modelDirPath;
        } else {
          filePath = path.join(currentDir, filePath);
        }

        if (fs.existsSync(filePath)) {
          const data = await readProcessedFile(filePath);
          if (data.length > 0) {
            const stats = calculateAccuracy(data);
            const fullStats: AccuracyStats = {
              model: modelName,
              target,
              dataset,
              ...stats
            };

            if (dataset === "test") {
              printAccuracyReport(fullStats);
            }
            allStats.push(fullStats);
          }
        }
      }
    }
  }

  // Model comparison if requested and multiple models available
  if (values.compare && models.length >= 2) {
    console.log("\n\n🔄 Performing model comparisons...");
    console.log("=".repeat(60));

    for (let i = 0; i < models.length; i++) {
      for (let j = i + 1; j < models.length; j++) {
        const model1 = models[i];
        const model2 = models[j];

        console.log(`\nComparing ${model1} vs ${model2}...`);

        for (const target of targets) {
          for (const dataset of ["train", "test"] as const) {
            try {
              const comparison = await compareModels(model1, model2, target, dataset);
              comparisonStats.push(comparison);

              if (comparison.disagreements.length > 0) {
                console.log(`  ${target} (${dataset}): ${comparison.agreementRate.toFixed(1)}% agreement`);
              }
            } catch (error) {
              // Files might not exist for all combinations
            }
          }
        }
      }
    }
  }

  // Generate summary report
  if (allStats.length > 0) {
    generateSummaryReport(allStats, comparisonStats);

    // Write Excel report
    const outputPath = values.output as string || 'comparison-report.xlsx';
    await writeComparisonReport(allStats, comparisonStats, outputPath);
    console.log(`\n📁 Detailed report saved to: ${outputPath}`);

    // Create comprehensive comparison Excel
    const comparisonPath = outputPath.replace('.xlsx', '-comprehensive.xlsx');
    await createComprehensiveComparison(models, targets, comparisonPath);
  }

  console.log("\n🎉 Analysis completed!");
};

main().catch(console.error);