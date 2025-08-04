import { intro, outro, select, spinner, text, log } from "@clack/prompts";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import fs from "fs";
import { generateText } from "ai";
import ExcelJS from "exceljs";

const model = google("gemini-2.0-flash-001");
const BATCH_SIZE = 100;

const spin = spinner();

const readExcelFile = async (filePath: string): Promise<string[]> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.getWorksheet(1);

  const texts: string[] = [];
  worksheet?.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      const cellValue = row.getCell(1).value;
      if (cellValue) {
        texts.push(cellValue.toString());
      }
    }
  });

  return texts;
};

const cleanTsvOutput = (text: string): string => {
  return text.replace(/^```tsv\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
};

const writeExcelFile = async (filePath: string, data: Array<{ text: string, label: string, explanation: string }>) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Results');

  worksheet.addRow(['text', 'label', 'label_explanation']);

  data.forEach(row => {
    worksheet.addRow([row.text, row.label, row.explanation]);
  });

  worksheet.columns.forEach(column => {
    column.width = 30;
  });

  await workbook.xlsx.writeFile(filePath);
};

const validateWithZod =
  (
    schema:
      | z.ZodString
      | z.ZodEffects<z.ZodString>
      | z.ZodEffects<z.ZodEffects<z.ZodString>>
  ) =>
    (value: string): string | Error | undefined => {
      const result = schema.safeParse(value);
      if (!result.success) {
        return result.error.message;
      }

      return undefined;
    };

intro("Label Explainer 🪄");

const action = await select({
  message: "What do you want to do?",
  options: [
    {
      value: "explain-stance-labels-tweets",
      label: "Explain Stance Labels in Tweets",
    },
    {
      value: "classify-and-explain-stance-tweets",
      label: "Classify and Explain Stance Labels in Tweets",
    },
    {
      value: "measure-classification-accuracy",
      label: "Measure Classification Accuracy",
    },
  ],
});

switch (action) {
  case "explain-stance-labels-tweets": {
    const target = z.string().parse(
      await text({
        message: "Enter the target.",
        validate: validateWithZod(z.string().min(1)),
      })
    );

    const language = z.enum(["portuguese", "english"]).parse(
      await select({
        message: "Enter the language of the dataset.",
        options: [
          { value: "portuguese", label: "Portuguese" },
          { value: "english", label: "English" },
        ],
      })
    );

    const fileFormat = z.enum(["csv", "tsv", "xlsx"]).parse(
      await select({
        message: "Enter the file format.",
        options: [
          { value: "csv", label: "CSV" },
          { value: "tsv", label: "TSV" },
          { value: "xlsx", label: "XLSX (Excel)" },
        ],
      })
    );

    const datasetPath = z.string().parse(
      await text({
        message: `Enter the dataset path.\n The dataset should be a ${fileFormat === "xlsx"
          ? "Excel file with text and label columns"
          : fileFormat === "csv" ? "," : "\\t"
          }${fileFormat !== "xlsx" ? "-separated file." : "."}`,
        validate: validateWithZod(
          z
            .string()
            .refine((value) => fs.existsSync(value), "Dataset does not exist")
        ),
      })
    );

    let dataRows: { text: string; label: string }[] = [];

    if (fileFormat === "xlsx") {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(datasetPath);
      const worksheet = workbook.getWorksheet(1);

      worksheet?.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
          const text = row.getCell(1).value?.toString() || "";
          const label = row.getCell(3).value?.toString() || "";
          if (text && label) {
            dataRows.push({ text, label });
          }
        }
      });
    } else {
      const dataset = fs.readFileSync(datasetPath, "utf-8");
      for (const line of dataset.split("\n")) {
        if (line.trim()) {
          const [text, label] = line.split(fileFormat === "csv" ? "," : "\t");
          if (text && label) {
            dataRows.push({ text, label });
          }
        }
      }
    }

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

    const promises = batches.map(async (batch) => {
      const { text } = await generateText({
        model,
        prompt: `
**Objective:** To generate clear and concise explanations for why a given tweet is classified as being "for" or "against" a specific target.

**Input:** You will be provided with a dataset of tweets, each with a pre-assigned stance label ("for" or "against") towards a given target.

**Output:** Your task is to generate a TSV (tab-separated values) output with the following columns: \`text\`, \`label\`, and \`label_explanation\`.

**Instructions:**

For each tweet, carefully analyze the text and its relationship with the designated **${target}**. Your explanation should be based on the following principles:

* **"against" Label:** A tweet is labeled "against" if it expresses a negative sentiment, criticism, opposition, or disagreement with the **${target}**. This can be a direct attack, an expression of disapproval, or the highlighting of negative consequences or aspects related to the **${target}**.
* **"for" Label:** A tweet is labeled "for" if it expresses a positive sentiment, support, agreement, or endorsement of the **${target}**. This can be through direct praise, highlighting benefits, or defending the **${target}** against criticism.

**Your generated \`label_explanation\` should:**

1.  **Directly reference the content of the tweet.** Quote or paraphrase specific words or phrases that are indicative of the stance.
2.  **Clearly state the reasoning.** Explicitly connect the textual evidence to the assigned stance label.
3.  **Be concise and easy to understand.** Aim for a one to two-sentence explanation.
4.  **Remain neutral and objective in your explanation.** Your role is to explain the stance, not to agree or disagree with it.
5.  **Return the explanation in ${language}.**

**Example of Expected Output:**
text\tlabel\tlabel_explanation
eu odeio tudo que o governo Bolsonaro é! não vai ter um dia sequer da minha vida que eu não esteja desejando esse cara fora do comando do país\tagainst\tO texto expressa sentimentos negativos explícitos, como 'odeio', e um desejo claro de que o alvo, 'o governo Bolsonaro', seja removido do poder ('desejando esse cara fora do comando do país'), o que demonstra uma forte oposição.
um dos vídeos mais engraçados é o do Bolsonaro fazendo flexão KAKSKSKAKSKAKSKAKSS\tagainst\tO texto utiliza o humor e a risada ('KAKSKSKAKSKAKSKAKSS') para se referir a uma ação do alvo (Bolsonaro). Neste contexto, o ato de achar 'engraçado' um vídeo do presidente sugere zombaria ou ridicularização, em vez de apoio, caracterizando uma postura contrária.
Eu tomei multa demais esse ano pqp... Aí agora mudou a lei né? Você vê que tá fazendo merda na vida quando uma lei aprovada pelo Bolsonaro te favorece! Peço perdão desde já viu\tfor\tApesar do tom irônico e da aparente relutância, o autor admite explicitamente que uma 'lei aprovada pelo Bolsonaro' o favorece. A postura é considerada 'a favor' porque o texto afirma que a ação do alvo (a lei) é benéfica para o autor, independentemente de seus sentimentos pessoais sobre o político.

**Input:**
${batch.map(({ text, label }) => `${text}\t${label}`).join("\n")}`,
      });

      return text;
    });

    spin.start("Generating explanations...");
    const results = await Promise.all(promises);
    spin.stop();

    const allResults: Array<{ text: string, label: string, explanation: string }> = [];

    for (const batchResult of results) {
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

    await writeExcelFile(`results-${target}-${language}.xlsx`, allResults);

    break;
  }
  case "classify-and-explain-stance-tweets": {
    const target = z.string().parse(
      await text({
        message: "Enter the target.",
        validate: validateWithZod(z.string().min(1)),
      })
    );

    const language = z.enum(["portuguese", "english"]).parse(
      await select({
        message: "Enter the language of the dataset.",
        options: [
          { value: "portuguese", label: "Portuguese" },
          { value: "english", label: "English" },
        ],
      })
    );

    const fileFormat = z.enum(["csv", "tsv", "xlsx"]).parse(
      await select({
        message: "Enter the file format.",
        options: [
          { value: "csv", label: "CSV" },
          { value: "tsv", label: "TSV" },
          { value: "xlsx", label: "XLSX (Excel)" },
        ],
      })
    );

    const datasetPath = z.string().parse(
      await text({
        message: `Enter the dataset path.\n The dataset should be a ${fileFormat === "xlsx"
          ? "Excel file with only a text column"
          : fileFormat === "csv" ? "," : "\\t"
          }${fileFormat !== "xlsx" ? "-separated file with only a text column." : "."}`,
        validate: validateWithZod(
          z
            .string()
            .refine((value) => fs.existsSync(value), "Dataset does not exist")
        ),
      })
    );

    let texts: string[] = [];

    if (fileFormat === "xlsx") {
      texts = await readExcelFile(datasetPath);
    } else {
      const dataset = fs.readFileSync(datasetPath, "utf-8");
      for (const line of dataset.split("\n")) {
        if (line.trim()) {
          const text = line.split(fileFormat === "csv" ? "," : "\t")[0];
          if (text) {
            texts.push(text);
          }
        }
      }
    }

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

    const promises = batches.map(async (batch) => {
      const { text } = await generateText({
        model,
        prompt: `
**Objective:** To classify tweets as "for" or "against" a specific target and provide clear explanations for each classification.

**Input:** You will be provided with a list of tweets about **${target}**.

**Output:** Your task is to generate a TSV (tab-separated values) output with the following columns: \`text\`, \`label\`, and \`label_explanation\`.

**Classification Guidelines:**

* **"against" Label:** A tweet should be labeled "against" if it expresses:
  - Negative sentiment, criticism, or opposition towards **${target}**
  - Disagreement with policies, actions, or statements related to **${target}**
  - Mocking, sarcasm, or ridicule directed at **${target}**
  - Expressions of disappointment, anger, or frustration about **${target}**
  - Calls for removal, replacement, or cessation of **${target}**

* **"for" Label:** A tweet should be labeled "for" if it expresses:
  - Positive sentiment, support, or endorsement of **${target}**
  - Agreement with policies, actions, or statements of **${target}**
  - Praise, admiration, or celebration of **${target}**
  - Defense of **${target}** against criticism
  - Expressions of hope, satisfaction, or gratitude related to **${target}**

**Your generated \`label_explanation\` should:**

1. **Quote specific words or phrases** from the tweet that indicate the stance
2. **Clearly connect the evidence to the classification** - explain why these elements indicate "for" or "against"
3. **Be concise** - aim for 1-2 sentences maximum
4. **Remain objective** - explain the stance without personal judgment
5. **Be written in ${language}**
6. **Consider context and tone** - detect sarcasm, irony, or implicit meanings

**Example Output Format:**
text\tlabel\tlabel_explanation

**Input Tweets:**
${batch.map(({ text }) => text).join("\n")}

**Important:** Return ONLY the TSV format with no additional text or headers. Each line should contain exactly: tweet_text[TAB]label[TAB]explanation`,
      });

      return text;
    });

    spin.start("Classifying and generating explanations...");
    const results = await Promise.all(promises);
    spin.stop();

    const allResults: Array<{ text: string, label: string, explanation: string }> = [];

    for (const batchResult of results) {
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

    await writeExcelFile(`classified-${target}-${language}.xlsx`, allResults);

    break;
  }
  case "measure-classification-accuracy": {
    const originalDatasetPath = z.string().parse(
      await text({
        message: "Enter the original dataset path (Excel file with text and actual labels).",
        validate: validateWithZod(
          z
            .string()
            .refine((value) => fs.existsSync(value), "Original dataset does not exist")
            .refine((value) => value.endsWith('.xlsx'), "Original dataset must be an Excel file (.xlsx)")
        ),
      })
    );

    const classifiedResultsPath = z.string().parse(
      await text({
        message: "Enter the classified results path (Excel file from classify action).",
        validate: validateWithZod(
          z
            .string()
            .refine((value) => fs.existsSync(value), "Classified results file does not exist")
            .refine((value) => value.endsWith('.xlsx'), "Classified results must be an Excel file (.xlsx)")
        ),
      })
    );

    spin.start("Reading datasets and calculating accuracy...");

    const originalWorkbook = new ExcelJS.Workbook();
    await originalWorkbook.xlsx.readFile(originalDatasetPath);
    const originalWorksheet = originalWorkbook.getWorksheet(1);

    const originalData: { text: string, actualLabel: string }[] = [];
    originalWorksheet?.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        const text = row.getCell(1).value?.toString() || "";
        const actualLabel = row.getCell(3).value?.toString() || "";
        if (text && actualLabel) {
          originalData.push({ text: text.trim(), actualLabel: actualLabel.toLowerCase().trim() });
        }
      }
    });

    const classifiedWorkbook = new ExcelJS.Workbook();
    await classifiedWorkbook.xlsx.readFile(classifiedResultsPath);
    const classifiedWorksheet = classifiedWorkbook.getWorksheet(1);

    const classifiedData: { text: string, predictedLabel: string }[] = [];
    classifiedWorksheet?.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        const text = row.getCell(1).value?.toString() || "";
        const predictedLabel = row.getCell(2).value?.toString() || "";
        if (text && predictedLabel) {
          classifiedData.push({ text: text.trim(), predictedLabel: predictedLabel.toLowerCase().trim() });
        }
      }
    });

    const classifiedMap = new Map<string, string>();
    classifiedData.forEach(item => {
      classifiedMap.set(item.text, item.predictedLabel);
    });

    let totalCorrect = 0;
    let totalSamples = 0;
    const labelStats: { [label: string]: { total: number, correct: number } } = {};
    const confusionMatrix: { [actualLabel: string]: { [predictedLabel: string]: number } } = {};

    for (const original of originalData) {
      const predictedLabel = classifiedMap.get(original.text);

      if (predictedLabel !== undefined) {
        totalSamples++;

        if (!labelStats[original.actualLabel]) {
          labelStats[original.actualLabel] = { total: 0, correct: 0 };
        }
        labelStats[original.actualLabel].total++;

        if (!confusionMatrix[original.actualLabel]) {
          confusionMatrix[original.actualLabel] = {};
        }
        if (!confusionMatrix[original.actualLabel][predictedLabel]) {
          confusionMatrix[original.actualLabel][predictedLabel] = 0;
        }
        confusionMatrix[original.actualLabel][predictedLabel]++;

        if (original.actualLabel === predictedLabel) {
          totalCorrect++;
          labelStats[original.actualLabel].correct++;
        }
      }
    }

    spin.stop();

    log.message("📊 CLASSIFICATION ACCURACY REPORT");
    log.message("=".repeat(50));

    const overallAccuracy = totalSamples > 0 ? (totalCorrect / totalSamples * 100).toFixed(2) : "0.00";
    log.success(`🎯 Overall Accuracy: ${overallAccuracy}% (${totalCorrect}/${totalSamples})`);

    log.message("📈 Accuracy by Label:");
    log.message("-".repeat(30));
    for (const [label, stats] of Object.entries(labelStats)) {
      const accuracy = stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(2) : "0.00";
      log.info(`  ${label.toUpperCase()}: ${accuracy}% (${stats.correct}/${stats.total})`);
    }

    log.message("🔀 Confusion Matrix:");
    log.message("-".repeat(30));
    const allLabels = [...new Set([...Object.keys(confusionMatrix), ...Object.values(confusionMatrix).flatMap(row => Object.keys(row))])];

    let confusionMatrixOutput = "Actual \\ Predicted".padEnd(20);
    allLabels.forEach(label => {
      confusionMatrixOutput += label.padEnd(10);
    });
    confusionMatrixOutput += "\n";

    allLabels.forEach(actualLabel => {
      confusionMatrixOutput += actualLabel.padEnd(20);
      allLabels.forEach(predictedLabel => {
        const count = confusionMatrix[actualLabel]?.[predictedLabel] || 0;
        confusionMatrixOutput += count.toString().padEnd(10);
      });
      confusionMatrixOutput += "\n";
    });

    log.message(confusionMatrixOutput);
    log.message("=".repeat(50));
    log.info(`📝 Summary: Analyzed ${totalSamples} samples with ${totalCorrect} correct predictions`);

    break;
  }
  default: {
    throw new Error("Invalid action");
  }
}

outro("Done! 🎉");
