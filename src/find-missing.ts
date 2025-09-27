import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import { parseArgs } from "util";

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
}

const analyzeMissingCells = async (filePath: string): Promise<FileReport> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.getWorksheet(1);

  if (!worksheet) {
    throw new Error(`No worksheet found in ${filePath}`);
  }

  const missingDetails: MissingCellInfo[] = [];
  let totalRows = 0;

  // Expected columns based on compare.ts and process.ts
  // Column 1: text
  // Column 3: human-label
  // Column 7: human-label-explanation
  // Column 8: llm-label
  // Column 9: llm-label-explanation
  const columnMap: Record<number, string> = {
    1: "text",
    3: "human-label",
    7: "human-label-explanation",
    8: "llm-label",
    9: "llm-label-explanation"
  };

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header

    totalRows++;
    const missingColumns: string[] = [];

    for (const [colIndex, colName] of Object.entries(columnMap)) {
      const cellValue = row.getCell(Number(colIndex)).value;
      const isEmpty = !cellValue || cellValue.toString().trim() === "";

      if (isEmpty) {
        missingColumns.push(colName);
      }
    }

    if (missingColumns.length > 0) {
      const text = row.getCell(1).value?.toString()?.trim() || "[MISSING TEXT]";
      missingDetails.push({
        rowNumber,
        text: text.substring(0, 100), // Truncate for readability
        missingColumns
      });
    }
  });

  return {
    filePath,
    totalRows,
    rowsWithMissing: missingDetails.length,
    missingDetails
  };
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
      output: {
        type: 'string',
        short: 'o'
      },
      help: {
        type: 'boolean',
        short: 'h'
      }
    }
  });

  if (values.help) {
    console.log(`
Usage: bun run find-missing -- [options]

Options:
  -m, --models <models>   Models to check (can be specified multiple times)
                          Options: gpt-5, gemini-2.5-pro
                          Default: all available models
  -t, --targets <targets> Specific targets to check (can be specified multiple times)
                          Default: all targets
  -o, --output <file>     Output JSON file with detailed missing data report
  -h, --help              Show this help message

Examples:
  bun run find-missing -- -m gpt-5
  bun run find-missing -- --models gpt-5 --targets bolsonaro
  bun run find-missing -- -o missing-report.json
`);
    process.exit(0);
  }

  const datasetDir = "/Users/aluisioamorim/Code/AluisioDev/label-explainer/dataset";
  const allTargets = ["bolsonaro", "cloroquina", "coronavac", "globo", "igreja", "lula"];
  const allModels = ["gpt-5", "gemini-2.5-pro"];

  const targets = values.targets as string[] || allTargets;
  const models = values.models as string[] || allModels;

  console.log(`\n🔍 Analyzing missing cells...`);
  console.log(`📁 Models: ${models.join(', ')}`);
  console.log(`📋 Targets: ${targets.join(', ')}\n`);

  const allReports: FileReport[] = [];
  let totalFilesChecked = 0;
  let totalFilesWithMissing = 0;

  for (const model of models) {
    const modelDir = path.join(datasetDir, model);

    if (!fs.existsSync(modelDir)) {
      console.log(`⚠️  Directory not found: ${modelDir}`);
      continue;
    }

    console.log(`\n🤖 Checking ${model}...`);
    console.log("=".repeat(80));

    for (const target of targets) {
      for (const dataset of ["train", "test"]) {
        // Determine file naming pattern based on model
        let fileName: string;
        if (model === "gpt-5") {
          fileName = `processed-gpt-5-${target}-${dataset}.xlsx`;
        } else if (model === "gemini-2.5-pro") {
          fileName = `processed-gemini-2-5-pro-${target}-${dataset}.xlsx`;
        } else {
          continue;
        }

        const filePath = path.join(modelDir, fileName);

        if (!fs.existsSync(filePath)) {
          console.log(`  ⚠️  File not found: ${fileName}`);
          continue;
        }

        totalFilesChecked++;
        const report = await analyzeMissingCells(filePath);
        allReports.push(report);

        if (report.rowsWithMissing > 0) {
          totalFilesWithMissing++;
          console.log(`  ❌ ${fileName}`);
          console.log(`     Missing: ${report.rowsWithMissing}/${report.totalRows} rows`);

          // Show first few examples
          const examples = report.missingDetails.slice(0, 3);
          examples.forEach(detail => {
            console.log(`     Row ${detail.rowNumber}: Missing [${detail.missingColumns.join(', ')}]`);
            console.log(`       Text: "${detail.text}..."`);
          });

          if (report.missingDetails.length > 3) {
            console.log(`     ... and ${report.missingDetails.length - 3} more rows`);
          }
        } else {
          console.log(`  ✅ ${fileName} (Complete)`);
        }
      }
    }
  }

  // Summary
  console.log("\n" + "=".repeat(80));
  console.log(`\n📊 SUMMARY`);
  console.log("=".repeat(80));
  console.log(`Total files checked: ${totalFilesChecked}`);
  console.log(`Files with missing data: ${totalFilesWithMissing}`);
  console.log(`Files complete: ${totalFilesChecked - totalFilesWithMissing}`);

  const totalMissingRows = allReports.reduce((sum, r) => sum + r.rowsWithMissing, 0);
  const totalRows = allReports.reduce((sum, r) => sum + r.totalRows, 0);
  console.log(`\nTotal rows with missing data: ${totalMissingRows}/${totalRows}`);

  // Output to JSON if requested
  if (values.output) {
    const outputPath = values.output as string;
    const jsonReport = {
      summary: {
        totalFilesChecked,
        totalFilesWithMissing,
        totalRows,
        totalMissingRows,
        checkedAt: new Date().toISOString()
      },
      reports: allReports.map(r => ({
        ...r,
        relativePath: path.relative(datasetDir, r.filePath)
      }))
    };

    fs.writeFileSync(outputPath, JSON.stringify(jsonReport, null, 2));
    console.log(`\n📁 Detailed report saved to: ${outputPath}`);
  }

  console.log("\n🎉 Analysis completed!\n");
};

main().catch(console.error);
